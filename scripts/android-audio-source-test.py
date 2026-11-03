"""Verify exact-asset comparison accepts gain changes, rejects other audio/silence."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location("compare", Path(__file__).with_name("compare-android-audio.py"))
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)


class SourceTest(unittest.TestCase):
    def test_gain_offset_foreign_and_silence(self):
        rng = np.random.default_rng(4318)
        reference = rng.normal(0, 0.1, (24000, 2))
        encoded = io.BytesIO()
        sf.write(encoded, reference, 8000, format="WAV", subtype="FLOAT")
        with tempfile.TemporaryDirectory(prefix="agentvn-audio-source-") as temp:
            root = Path(temp)
            apk = root / "来源.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("assets/embedded-cartridge/manifest.json", json.dumps({"assets": [{"asset_id": "愿", "path": "assets/愿.wav"}]}))
                archive.writestr("assets/embedded-cartridge/assets/愿.wav", encoded.getvalue())
            samples = [(reference[8000:16000] * 0.3, "PASS"),
                       (rng.normal(0, 0.1, (8000, 2)), "BLOCKED"),
                       (np.zeros((8000, 2)), "BLOCKED")]
            for sample, expected in samples:
                wav = root / "输出.wav"
                report = root / "report.json"
                sf.write(wav, sample, 8000, subtype="FLOAT")
                with patch("sys.argv", ["compare", "--apk", str(apk), "--capture", str(wav), "--asset-id", "愿", "--output", str(report)]), \
                     contextlib.redirect_stdout(io.StringIO()):
                    compare.main()
                data = json.loads(report.read_text(encoding="utf-8"))
                self.assertEqual(data["status"], expected)
                self.assertEqual(data["listeningStatus"], "NOT_VERIFIED")
                if expected == "PASS":
                    self.assertAlmostEqual(data["offsetSeconds"], 1)
                    self.assertGreater(data["correlation"], 0.999)


if __name__ == "__main__":
    unittest.main()
