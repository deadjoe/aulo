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
    return {"operation": "generate", "workId": WORK_ID,
            "style": "folk", "lyrics": "a line", "modelRoot": str(directory),
            "outputRoot": str(Path(directory) / "works")} | fields


class BridgeTests(unittest.TestCase):
    def test_first_line_is_probe_or_serve(self):
        self.assertEqual(bridge.validate_request({"protocolVersion": 3, "operation": "probe"}),
                         "probe")
        self.assertEqual(bridge.validate_request({"protocolVersion": 3, "operation": "serve"}),
                         "serve")
        for request in [[], {}, {"protocolVersion": 2, "operation": "probe"},
                        {"protocolVersion": 3, "operation": "shell"},
                        {"protocolVersion": 3, "operation": "probe", "command": "anything"}]:
            with self.assertRaises(ValueError):
                bridge.validate_request(request)

    def test_paths_text_and_controls_are_bounded(self):
        request = generate_request(BRIDGE.parent)
        self.assertEqual(bridge.validate_command(request), "generate")
        self.assertEqual(bridge.validate_command({"operation": "cancel", "workId": WORK_ID}),
                         "cancel")
        self.assertEqual(bridge.validate_command({"operation": "shutdown"}), "shutdown")
        for update in [{"style": None}, {"lyrics": "x" * 16001}, {"lyrics": None}, {"outputRoot": "../escape"},
                       {"style": "", "lyrics": ""}, {"backend": "custom"}, {"abc": "X:1"},
                       {"workId": "../x"}, {"weirdness": 101}, {"styleInfluence": True},
                       {"vocal": "robot"}, {"instrumental": "yes"}, {"lyrics": ""},
                       {"operation": "shell"}, {"seed": -1}, {"seed": 2**31}, {"seed": True},
                       {"seed": 1.5}]:
            with self.assertRaises(ValueError):
                bridge.validate_command(request | update)

    def test_long_style_survives_the_command_reader(self):
        style = "warm piano, " * 200
        request = generate_request(BRIDGE.parent, style=style)
        stream = io.BytesIO((json.dumps(request) + "\n").encode())
        commands = bridge.Commands(stream)
        commands.start().thread.join(2)
        operation, received = commands.queue.get_nowait()
        self.assertEqual(operation, "generate")
        self.assertEqual(received["style"], style)
        self.assertEqual(bridge.song_texts(received)[0], style.strip())

    def test_simple_controls_map_to_groove_defaults_and_recipes(self):
        self.assertIsNone(bridge.cfg_scale(0))
        self.assertEqual(bridge.cfg_scale(50), 1.5)
        self.assertEqual(bridge.cfg_scale(100), 2.0)
        self.assertEqual(bridge.semantic_temperature(50), 1.0)
        self.assertEqual(bridge.semantic_temperature(0), 0.85)
        self.assertEqual(bridge.semantic_temperature(100), 1.25)

    def test_song_texts_follow_the_instrumental_recipe_and_vocal_hints(self):
        style, lyrics = bridge.song_texts({"style": "lofi", "instrumental": True, "vocal": "female"})
        self.assertEqual(style, "lofi, instrumental, no vocals")
        self.assertIn("[Chorus]", lyrics)
        style, lyrics = bridge.song_texts({"style": "pop", "lyrics": "hello", "vocal": "male"})
        self.assertEqual(style, "pop, male vocal")
        self.assertEqual(lyrics, "[Verse]\nhello")
        style, _ = bridge.song_texts({"style": "Pop, Female Vocal", "lyrics": "x", "vocal": "female"})
        self.assertEqual(style, "Pop, Female Vocal")
        _, lyrics = bridge.song_texts({"style": "pop", "lyrics": "[Chorus]\nhey"})
        self.assertEqual(lyrics, "[Chorus]\nhey")

    def test_instrumentals_drop_only_style_parts_that_describe_a_voice(self):
        style, _ = bridge.song_texts({
            "style": "dreamy indie pop, Female Vocal, airy choir\nwarm analog synths, English, "
                     "rap verses, lyrical piano, 92 bpm, tape hum",
            "instrumental": True})
        self.assertEqual(style, "dreamy indie pop, warm analog synths, lyrical piano, 92 bpm, "
                                "tape hum, instrumental, no vocals")
        style, _ = bridge.song_texts({"style": "lofi, chinese guzheng", "instrumental": True})
        self.assertEqual(style, "lofi, chinese guzheng, instrumental, no vocals")
        style, _ = bridge.song_texts({"style": "soft male vocals", "instrumental": True})
        self.assertEqual(style, "instrumental, no vocals")

    def test_the_chosen_voice_replaces_the_other_gender_in_the_style(self):
        style, _ = bridge.song_texts(
            {"style": "rock, deep male vocals, man choir, male energy", "lyrics": "x", "vocal": "female"})
        self.assertEqual(style, "rock, male energy, female vocal")
        style, _ = bridge.song_texts(
            {"style": "pop, Female Vocal", "lyrics": "x", "vocal": "male"})
        self.assertEqual(style, "pop, male vocal")
        style, _ = bridge.song_texts({"style": "pop, female vocal", "lyrics": "x", "vocal": "auto"})
        self.assertEqual(style, "pop, female vocal")
        style, _ = bridge.song_texts({"style": "pop\nfemale singer", "lyrics": "x", "vocal": "female"})
        self.assertEqual(style, "pop\nfemale singer, female vocal")

    def test_backend_selection_delegates_to_groove(self):
        adapter, gguf = Mock(), Mock()
        gguf.auto_backend.return_value = ("gguf", "small card")
        self.assertEqual(bridge.select_backend("cuda", adapter, gguf), "gguf")
        gguf.auto_backend.return_value = ("torch", "")
        adapter.cuda_flash_attention_usable.return_value = False
        self.assertEqual(bridge.select_backend("cuda", adapter, gguf), "torch-eager")
        self.assertEqual(bridge.select_backend("mps", adapter, gguf), "torch")
        self.assertIsNone(bridge.select_backend("cpu", adapter, gguf))

    def test_the_planned_engine_is_used_and_never_swapped(self):
        adapter, gguf = Mock(), Mock()
        gguf.auto_backend.return_value = ("torch", "")
        gguf.available.return_value = True
        self.assertEqual(bridge.select_backend("mps", adapter, gguf, "gguf"), "gguf")
        self.assertEqual(bridge.select_backend("cpu", adapter, gguf, "gguf"), "gguf")
        # Missing yue2.cpp binaries are reported, not replaced by another engine.
        gguf.available.return_value = False
        self.assertIsNone(bridge.select_backend("mps", adapter, gguf, "gguf"))
        gguf.auto_backend.return_value = ("gguf", "small card")
        self.assertEqual(bridge.select_backend("mps", adapter, gguf, "torch"), "torch")
        self.assertIsNone(bridge.select_backend("cpu", adapter, gguf, "torch"))
        gguf.auto_backend.assert_not_called()

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
        self.assertEqual(json.loads(stream.getvalue())["protocolVersion"], 3)

    def test_commands_cancel_only_the_current_song_and_end_with_shutdown(self):
        other = "f" * 32
        lines = [json.dumps({"operation": "cancel", "workId": other}),
                 "not json",
                 json.dumps({"operation": "cancel", "workId": WORK_ID})]
        commands = bridge.Commands(io.BytesIO(("\n".join(lines) + "\n").encode()))
        commands.begin(WORK_ID)
        commands.start().thread.join(2)
        self.assertTrue(commands.cancel.is_set())
        self.assertEqual(commands.queue.get_nowait(), ("invalid", None))
        self.assertEqual(commands.queue.get_nowait(), ("shutdown", None))

    def test_a_cancel_that_overtakes_its_song_still_stops_it(self):
        later = "e" * 32
        lines = [json.dumps(generate_request(BRIDGE.parent)),
                 json.dumps({"operation": "cancel", "workId": WORK_ID})]
        commands = bridge.Commands(io.BytesIO(("\n".join(lines) + "\n").encode()))
        commands.start().thread.join(2)
        self.assertEqual(commands.queue.get_nowait()[0], "generate")
        self.assertFalse(commands.cancel.is_set())
        commands.begin(WORK_ID)
        self.assertTrue(commands.cancel.is_set())
        commands.end()
        commands.begin(later)
        self.assertFalse(commands.cancel.is_set())
        self.assertEqual(commands.pending_cancels, set())

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
            request = generate_request(directory, styleInfluence=50, weirdness=100, seed=1234)
            runtime = {"device": "mps", "backend": "torch"}
            with patch.dict(sys.modules, modules):
                engine = bridge.Engine(runtime)
                record = engine.generate(request, Mock(), lambda: False)
                work = root / "works" / WORK_ID
                self.assertEqual(record["duration"], 1.0)
                self.assertFalse((work / "pending.json").exists())
                load = adapter.load_pipeline.call_args.kwargs
                self.assertTrue(load["local_files_only"])
                self.assertEqual((load["backend"], load["ode_steps"]), ("torch", 32))
                self.assertEqual(adapter.song_request.call_args.kwargs["cfg_scale"], 1.5)
                self.assertEqual(adapter.song_request.call_args.kwargs["seed"], 1234)
                self.assertEqual(adapter.sampling.call_args_list[1].kwargs["temperature"], 1.25)
                # The loaded model is reused for the next song.
                soundfile.info.side_effect = RuntimeError("invalid audio")
                with self.assertRaises(RuntimeError):
                    engine.generate(request, Mock(), lambda: False)
                adapter.load_pipeline.assert_called_once()
                engine.close(adapter)
                adapter.close_pipeline.assert_called_once_with("pipeline")
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
                engine = bridge.Engine({"device": "cuda", "backend": "gguf"})
                engine.generate(generate_request(directory), Mock(), lambda: False)
                engine.close(adapter)
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
                bridge.Engine({"device": "mps", "backend": "torch"}).generate(
                    generate_request(directory), Mock(), lambda: True)
            pending = json.loads((root / "works" / WORK_ID / "pending.json").read_text())
            self.assertEqual(pending["state"], "cancelled")

    def test_cpu_fallback_is_not_silent(self):
        _, _, _, modules = self.fake_engine()
        with patch.dict(sys.modules, modules):
            with self.assertRaisesRegex(RuntimeError, "accelerator"):
                bridge.Engine({"device": "cpu", "backend": None}).generate({}, Mock(), lambda: False)


if __name__ == "__main__":
    unittest.main()


class ServeTests(unittest.TestCase):
    def test_serve_reports_each_song_and_keeps_going_after_a_failure(self):
        events = []
        engine = Mock()
        engine.generate.side_effect = [RuntimeError("boom"), {"audio": "audio.flac"}]
        commands = bridge.Commands(io.BytesIO())
        for _ in range(2):
            commands.queue.put(("generate", {"workId": WORK_ID}))
        commands.queue.put(("invalid", None))
        commands.queue.put(("shutdown", None))
        with patch.object(bridge, "Engine", return_value=engine):
            bridge.serve({"backend": "torch"}, commands,
                         lambda event, **fields: events.append((event, fields.get("workId"))))
        self.assertEqual([e for e, _ in events], ["ready", "failed", "completed", "failed"])
        self.assertEqual(events[2][1], WORK_ID)
        engine.close.assert_called_once()
