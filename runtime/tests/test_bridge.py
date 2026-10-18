"""Protocol and adapter contract tests; no models or GPU required."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import Mock, patch

BRIDGE = Path(__file__).resolve().parents[1] / "bridge.py"
spec = importlib.util.spec_from_file_location("bridge", BRIDGE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

WORK_ID = "0123456789abcdef0123456789abcdef"


def generate_request(directory, **fields):
    return {"protocolVersion": 2, "operation": "generate", "workId": WORK_ID,
            "style": "folk", "lyrics": "a line", "modelRoot": str(directory),
            "outputRoot": str(Path(directory) / "works")} | fields


class BridgeTests(unittest.TestCase):
    def test_invalid_inputs_fail_before_importing_engine(self):
        for request in [[], {}, {"protocolVersion": 1, "operation": "probe"},
                        {"protocolVersion": 2, "operation": "shell"},
                        {"protocolVersion": 2, "operation": "probe", "command": "anything"}]:
            with self.assertRaises(ValueError):
                bridge.validate_request(request)

    def test_paths_text_and_controls_are_bounded(self):
        request = generate_request(BRIDGE.parent)
        self.assertEqual(bridge.validate_request(request), "generate")
        for update in [{"style": "x" * 1001}, {"lyrics": None}, {"outputRoot": "../escape"},
                       {"style": "", "lyrics": ""}, {"backend": "custom"}, {"abc": "X:1"},
                       {"workId": "../x"}, {"weirdness": 101}, {"styleInfluence": True},
                       {"vocal": "robot"}, {"instrumental": "yes"}, {"lyrics": ""}]:
            with self.assertRaises(ValueError):
                bridge.validate_request(request | update)

    def test_simple_controls_map_to_groove_defaults_and_recipes(self):
        self.assertIsNone(bridge.cfg_scale(0))
        self.assertEqual(bridge.cfg_scale(50), 1.5)
        self.assertEqual(bridge.cfg_scale(100), 2.0)
        self.assertEqual(bridge.semantic_temperature(50), 1.0)
        self.assertEqual(bridge.semantic_temperature(0), 0.85)
        self.assertEqual(bridge.semantic_temperature(100), 1.25)

    def test_song_texts_follow_the_instrumental_recipe_and_vocal_hints(self):
        style, lyrics = bridge.song_texts({"style": "lofi", "instrumental": True, "vocal": "female"})
        self.assertEqual(style, "lofi, instrumental")
        self.assertIn("[Chorus]", lyrics)
        style, lyrics = bridge.song_texts({"style": "pop", "lyrics": "hello", "vocal": "male"})
        self.assertEqual(style, "pop, male vocal")
        self.assertEqual(lyrics, "[Verse]\nhello")
        style, _ = bridge.song_texts({"style": "Pop, Female Vocal", "lyrics": "x", "vocal": "female"})
        self.assertEqual(style, "Pop, Female Vocal")
        _, lyrics = bridge.song_texts({"style": "pop", "lyrics": "[Chorus]\nhey"})
        self.assertEqual(lyrics, "[Chorus]\nhey")

    def test_backend_selection_delegates_to_groove(self):
        adapter, gguf = Mock(), Mock()
        gguf.auto_backend.return_value = ("gguf", "small card")
        self.assertEqual(bridge.select_backend("cuda", adapter, gguf), "gguf")
        gguf.auto_backend.return_value = ("torch", "")
        adapter.cuda_flash_attention_usable.return_value = False
        self.assertEqual(bridge.select_backend("cuda", adapter, gguf), "torch-eager")
        self.assertEqual(bridge.select_backend("mps", adapter, gguf), "torch")
        self.assertIsNone(bridge.select_backend("cpu", adapter, gguf))

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
        bridge.emit(stream, "progress", stage="preparing")
        self.assertEqual(json.loads(stream.getvalue())["protocolVersion"], 2)

    def test_cancel_line_sets_the_flag(self):
        event = threading.Event()
        bridge.watch_for_cancel(io.BytesIO(b"noise\ncancel\n"), event)
        self.assertTrue(event.wait(2))

    def fake_engine(self):
        adapter = Mock()
        adapter.load_pipeline.return_value = ("pipeline", "bfloat16")
        adapter.generate.return_value.save_artifacts.side_effect = (
            lambda target: (target / "audio.flac").write_bytes(b"test fixture")
        )
        gguf = Mock()
        gguf.semantic_budget.return_value = (100, 9000)
        soundfile = Mock()
        soundfile.info.return_value = types.SimpleNamespace(frames=48000, samplerate=48000,
                                                            duration=1.0)
        modules = {"yue2_groove": types.SimpleNamespace(adapter=adapter, gguf_engine=gguf),
                   "soundfile": soundfile}
        return adapter, gguf, soundfile, modules

    def test_generation_delegates_and_only_completes_with_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "YuE2-3B").mkdir()
            (root / "YuE2-Vae").mkdir()
            adapter, _, soundfile, modules = self.fake_engine()
            request = generate_request(directory, styleInfluence=50, weirdness=100)
            runtime = {"device": "mps", "backend": "torch"}
            with patch.dict(sys.modules, modules):
                record = bridge.generate(request, Mock(), runtime, lambda: False)
                work = root / "works" / WORK_ID
                self.assertEqual(record["duration"], 1.0)
                self.assertFalse((work / "pending.json").exists())
                load = adapter.load_pipeline.call_args.kwargs
                self.assertTrue(load["local_files_only"])
                self.assertEqual((load["backend"], load["ode_steps"]), ("torch", 32))
                self.assertEqual(adapter.song_request.call_args.kwargs["cfg_scale"], 1.5)
                self.assertEqual(adapter.sampling.call_args_list[1].kwargs["temperature"], 1.25)
                adapter.close_pipeline.assert_called_once_with("pipeline")
                # A corrupt output must remain an unfinished work.
                soundfile.info.side_effect = RuntimeError("invalid audio")
                with self.assertRaises(RuntimeError):
                    bridge.generate(request, Mock(), runtime, lambda: False)
                pending = json.loads((work / "pending.json").read_text())
                self.assertEqual(pending["state"], "failed")

    def test_gguf_engine_is_opened_through_groove(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "YuE2-3B").mkdir()
            (root / "YuE2-Vae").mkdir()
            adapter, gguf, _, modules = self.fake_engine()
            gguf.GgufPipeline.open.return_value = "gguf-pipeline"
            with patch.dict(sys.modules, modules):
                bridge.generate(generate_request(directory), Mock(),
                                {"device": "cuda", "backend": "gguf"}, lambda: False)
            adapter.load_pipeline.assert_not_called()
            self.assertEqual(gguf.GgufPipeline.open.call_args.kwargs["ode_steps"], 32)
            adapter.close_pipeline.assert_called_once_with("gguf-pipeline")

    def test_cancellation_is_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "YuE2-3B").mkdir()
            (root / "YuE2-Vae").mkdir()
            adapter, _, _, modules = self.fake_engine()
            adapter.generate.side_effect = InterruptedError("Cancelled")
            with patch.dict(sys.modules, modules), self.assertRaises(InterruptedError):
                bridge.generate(generate_request(directory), Mock(),
                                {"device": "mps", "backend": "torch"}, lambda: True)
            pending = json.loads((root / "works" / WORK_ID / "pending.json").read_text())
            self.assertEqual(pending["state"], "cancelled")

    def test_cpu_fallback_is_not_silent(self):
        _, _, _, modules = self.fake_engine()
        with patch.dict(sys.modules, modules):
            with self.assertRaisesRegex(RuntimeError, "accelerator"):
                bridge.generate({}, Mock(), {"device": "cpu", "backend": None}, lambda: False)


if __name__ == "__main__":
    unittest.main()
