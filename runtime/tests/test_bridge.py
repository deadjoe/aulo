"""Protocol and adapter contract tests; no models or GPU required."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

BRIDGE = Path(__file__).resolve().parents[1] / "bridge.py"
spec = importlib.util.spec_from_file_location("bridge", BRIDGE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_invalid_inputs_fail_before_importing_engine(self):
        for request in [[], {}, {"protocolVersion": 2, "operation": "probe"},
                        {"protocolVersion": 1, "operation": "shell"},
                        {"protocolVersion": 1, "operation": "probe", "command": "anything"}]:
            with self.assertRaises(ValueError):
                bridge.validate_request(request)

    def test_paths_and_text_are_bounded(self):
        request = {"protocolVersion": 1, "operation": "generate", "style": "folk",
                   "modelRoot": str(BRIDGE.parent), "outputRoot": str(BRIDGE.parent)}
        self.assertEqual(bridge.validate_request(request), "generate")
        for update in [{"style": "x" * 4001}, {"lyrics": None}, {"outputRoot": "../escape"},
                       {"style": "", "lyrics": ""}, {"backend": "custom"}]:
            with self.assertRaises(ValueError):
                bridge.validate_request(request | update)

    def test_error_protocol_is_clean_and_exit_is_nonzero(self):
        result = subprocess.run([sys.executable, "-I", str(BRIDGE)], input=b"{}\n",
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        event = json.loads(result.stdout)
        self.assertEqual(event["event"], "failed")
        self.assertNotIn("Traceback", result.stdout.decode())

    def test_oversized_request_is_rejected(self):
        result = subprocess.run([sys.executable, "-I", str(BRIDGE)],
                                input=b"x" * 65537 + b"\n", capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)["event"], "failed")

    def test_events_are_versioned(self):
        stream = io.StringIO()
        bridge.emit(stream, "progress", stage="loading")
        self.assertEqual(json.loads(stream.getvalue())["protocolVersion"], 1)

    def test_generation_delegates_and_only_completes_with_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "YuE2-3B").mkdir()
            (root / "YuE2-Vae").mkdir()
            adapter = Mock()
            adapter.load_pipeline.return_value = ("pipeline", "bfloat16")
            adapter.generate.return_value.save_artifacts.side_effect = (
                lambda target: (target / "audio.flac").write_bytes(b"test fixture")
            )
            soundfile = Mock()
            soundfile.info.return_value = types.SimpleNamespace(frames=48000, samplerate=48000, duration=1.0)
            request = {"modelRoot": directory, "outputRoot": str(root / "works"), "style": "folk"}
            with patch.dict(sys.modules, {"yue2_groove": types.SimpleNamespace(adapter=adapter), "soundfile": soundfile}):
                record = bridge.generate(request, Mock(), {"device": "mps"})
                work = root / "works" / record["id"]
                self.assertTrue((work / "aulo.json").is_file())
                self.assertFalse((work / "pending.json").exists())
                self.assertTrue(adapter.load_pipeline.call_args.kwargs["local_files_only"])
                adapter.close_pipeline.assert_called_once_with("pipeline")
                # A corrupt output must remain an unfinished work.
                soundfile.info.side_effect = RuntimeError("invalid audio")
                with self.assertRaises(RuntimeError):
                    bridge.generate(request, Mock(), {"device": "mps"})
                pending = list((root / "works").glob("*/pending.json"))
                self.assertEqual(len(pending), 1)
                self.assertEqual(json.loads(pending[0].read_text())["state"], "failed")

    def test_cpu_fallback_is_not_silent(self):
        with patch.dict(sys.modules, {"yue2_groove": Mock(), "soundfile": Mock()}):
            with self.assertRaisesRegex(RuntimeError, "accelerator"):
                bridge.generate({}, Mock(), {"device": None})


if __name__ == "__main__":
    unittest.main()
