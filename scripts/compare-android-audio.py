"""Compare an emulator-only PCM capture with the exact audio bytes inside its APK."""
import argparse
import hashlib
import io
import json
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import correlate, resample_poly
from math import gcd


def file_hash(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--capture', type=Path, required=True)
    parser.add_argument('--asset-id', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with zipfile.ZipFile(args.apk, metadata_encoding='utf-8') as apk:
        manifest = json.loads(apk.read('assets/embedded-cartridge/manifest.json'))
        asset = next(item for item in manifest['assets'] if item['asset_id'] == args.asset_id)
        entry = 'assets/embedded-cartridge/' + asset['path']
        audio = apk.read(entry)
    reference, reference_rate = sf.read(io.BytesIO(audio), always_2d=True)
    capture, capture_rate = sf.read(args.capture, always_2d=True)
    def mono_downsample(data, rate):
        divisor = gcd(rate, 8000)
        return resample_poly(data.mean(axis=1), 8000 // divisor, rate // divisor)
    ref = mono_downsample(reference, reference_rate)
    sample = mono_downsample(capture, capture_rate)
    sample -= sample.mean()
    numerator = correlate(ref, sample, mode='valid', method='fft')
    squares = np.concatenate(([0.], np.cumsum(ref * ref)))
    sums = np.concatenate(([0.], np.cumsum(ref)))
    n = len(sample)
    energy = squares[n:] - squares[:-n] - (sums[n:] - sums[:-n]) ** 2 / n
    scores = numerator / np.sqrt(np.maximum(energy * np.dot(sample, sample), 1e-30))
    offset = int(np.argmax(np.abs(scores)))
    score = float(abs(scores[offset]))
    report = {'status': 'PASS' if score >= 0.9 else 'BLOCKED', 'method': 'normalized-waveform-cross-correlation-8kHz',
              'apkPath': str(args.apk.resolve()), 'apkSha256': file_hash(args.apk),
              'assetId': args.asset_id, 'apkEntry': entry, 'sourceSha256': hashlib.sha256(audio).hexdigest(),
              'capturePath': str(args.capture.resolve()), 'captureSha256': file_hash(args.capture),
              'correlation': score, 'offsetSeconds': offset / 8000, 'listeningStatus': 'NOT_VERIFIED'}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
