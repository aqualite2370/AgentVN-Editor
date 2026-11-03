"""Offline coverage of the real capture entry point; no microphone/device access."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import grpc

spec = importlib.util.spec_from_file_location("capture", Path(__file__).with_name("capture-emulator-audio.py"))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTest(unittest.TestCase):
    def run_capture(self, value=1000, count=100, rpc_error=False, timestamps=None):
        fmt, packet = capture.messages()
        chunks = [packet(format=fmt(samplingRate=44100, channels=1, format=1),
                         timestamp=(timestamps[i] if timestamps else i * 10000), audio=struct.pack("<h", value) * 882)
                  for i in range(count)]
        class Stream:
            def __iter__(self):
                if rpc_error:
                    raise RuntimeError("simulated emulator unavailable")
                return iter(chunks)
            def cancel(self):
                pass
        class Channel:
            def unary_stream(self, method, **kwargs):
                self_method = method
                def rpc(request, **options):
                    if not self_method.endswith("/streamAudio"):
                        raise AssertionError("Only emulator output is allowed")
                    return Stream()
                return rpc
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass
        with tempfile.TemporaryDirectory(prefix="agentvn-audio-") as temp:
            root = Path(temp)
            discovery = root / "discovery.ini"
            discovery.write_text("grpc.port=8554\ngrpc.token=test-only-token\navd.name=test\nport.serial=5554", encoding="utf-8")
            argv = ["capture", "--discovery", str(discovery), "--output", str(root), "--seconds", "1"]
            with patch("sys.argv", argv), patch.object(capture.grpc, "insecure_channel", return_value=Channel()), \
                 patch.object(capture.time, "monotonic", return_value=0), contextlib.redirect_stdout(io.StringIO()):
                code = capture.main()
            report = json.loads((root / "audio-capture-report.json").read_text(encoding="utf-8"))
            self.assertNotIn("test-only-token", json.dumps(report))
            self.assertEqual(report["status"], "BLOCKED", "capture never substitutes for listening")
            self.assertFalse(report["microphoneCaptured"])
            return code, report

    def test_complete(self):
        code, report = self.run_capture()
        self.assertEqual(code, 0)
        self.assertTrue(report["captureComplete"])
        self.assertTrue(report["nonSilent"])
        self.assertTrue(report["continuous"])
        self.assertEqual(report["listeningStatus"], "NOT_VERIFIED")

    def test_short_stream(self):
        code, report = self.run_capture(count=2)
        self.assertEqual(code, 2, "truncated stream must not report capture success")
        self.assertFalse(report["captureComplete"])

    def test_emulator_timestamp_clock_drift_does_not_shorten_pcm(self):
        # API-35 can advance packet timestamps by ~8 seconds while delivering
        # only ~0.5 seconds of PCM. Duration must be derived from PCM bytes.
        timestamps = [i * 160000 for i in range(100)]
        code, report = self.run_capture(count=100, timestamps=timestamps)
        self.assertEqual(code, 0)
        self.assertTrue(report["captureComplete"])
        self.assertGreater(report["seconds"], 0.95)

    def test_slow_emulator_stream_gets_independent_grpc_deadline(self):
        with tempfile.TemporaryDirectory(prefix="agentvn-audio-") as temp:
            root = Path(temp)
            discovery = root / "discovery.ini"
            discovery.write_text("grpc.port=8554\ngrpc.token=test-only-token\navd.name=test\nport.serial=5554", encoding="utf-8")
            deadlines = []
            fmt, packet = capture.messages()
            sample = packet(format=fmt(samplingRate=44100, channels=1, format=1),
                            timestamp=0, audio=struct.pack("<h", 1000) * 882)
            class Stream:
                def __iter__(self):
                    return iter([sample] * 100)
                def cancel(self):
                    pass
            class Channel:
                def unary_stream(self, _method, **_kwargs):
                    def rpc(_request, **options):
                        deadlines.append(options["timeout"])
                        return Stream()
                    return rpc
                def __enter__(self):
                    return self
                def __exit__(self, *_args):
                    pass
            with patch("sys.argv", ["capture", "--discovery", str(discovery), "--output", str(root), "--seconds", "8"]), \
                 patch.object(capture.grpc, "insecure_channel", return_value=Channel()), contextlib.redirect_stdout(io.StringIO()):
                capture.main()
            self.assertGreaterEqual(deadlines[0], 150)

    def test_silent_and_clipped(self):
        _, silent = self.run_capture(value=0)
        _, clipped = self.run_capture(value=32767)
        self.assertFalse(silent["nonSilent"])
        self.assertFalse(clipped["notSustainedClipping"])

    def test_capture_unavailable(self):
        code, report = self.run_capture(rpc_error=True)
        self.assertEqual(code, 2)
        self.assertIn("simulated emulator unavailable", report["error"])
        self.assertNotIn("wavPath", report)

    def test_deadline_after_complete_pcm_is_preserved(self):
        fmt, packet = capture.messages()
        values = [packet(format=fmt(samplingRate=44100, channels=1, format=1), timestamp=i * 10000,
                         audio=struct.pack("<h", 1000) * 882) for i in range(100)]
        class DeadlineStream:
            def __iter__(self):
                yield from values
                raise grpc.RpcError("deadline")
            def cancel(self): pass
        class Channel:
            def unary_stream(self, *_args, **_kwargs): return lambda *_args, **_kwargs: DeadlineStream()
            def __enter__(self): return self
            def __exit__(self, *_args): pass
        with tempfile.TemporaryDirectory(prefix="agentvn-audio-") as temp:
            root = Path(temp); discovery = root / "discovery.ini"
            discovery.write_text("grpc.port=8554\ngrpc.token=x\navd.name=test\nport.serial=5554", encoding="utf-8")
            with patch("sys.argv", ["capture", "--discovery", str(discovery), "--output", str(root), "--seconds", "1"]), \
                 patch.object(capture.grpc, "insecure_channel", return_value=Channel()), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(capture.main(), 0)
            self.assertTrue(json.loads((root / "audio-capture-report.json").read_text())["captureComplete"])


if __name__ == "__main__":
    unittest.main()
