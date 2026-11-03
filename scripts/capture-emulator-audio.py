"""Capture only emulator output via its documented streamAudio RPC (never microphone)."""
import argparse
import hashlib
import json
import math
import struct
import time
import wave
from pathlib import Path

import grpc
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory


def messages():
    schema = descriptor_pb2.FileDescriptorProto(name="agentvn_audio.proto", package="android.emulation.control", syntax="proto3")
    fmt = schema.message_type.add(name="AudioFormat")
    for name, number in [("samplingRate", 1), ("channels", 2), ("format", 3), ("mode", 4)]:
        fmt.field.add(name=name, number=number, type=4, label=1)
    packet = schema.message_type.add(name="AudioPacket")
    packet.field.add(name="format", number=1, type=11, type_name=".android.emulation.control.AudioFormat", label=1)
    packet.field.add(name="timestamp", number=2, type=4, label=1)
    packet.field.add(name="audio", number=3, type=12, label=1)
    pool = descriptor_pool.DescriptorPool()
    pool.Add(schema)
    return [message_factory.GetMessageClass(pool.FindMessageTypeByName("android.emulation.control." + name)) for name in ["AudioFormat", "AudioPacket"]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--discovery", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--seconds", type=int, default=8)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"status": "BLOCKED", "source": "emulator-grpc-output", "microphoneCaptured": False,
              "hostLoopbackCaptured": False, "listeningStatus": "NOT_VERIFIED", "startedAt": time.time()}
    chunks, timestamps = [], []
    try:
        settings = dict(line.split("=", 1) for line in args.discovery.read_text(encoding="utf-8").splitlines() if "=" in line)
        report.update({"avd": settings.get("avd.name"), "serialPort": settings.get("port.serial"), "grpcPort": int(settings["grpc.port"])})
        fmt, packet = messages()
        with grpc.insecure_channel("127.0.0.1:" + settings["grpc.port"]) as channel:
            rpc = channel.unary_stream("/android.emulation.control.EmulatorController/streamAudio",
                                       request_serializer=lambda value: value.SerializeToString(), response_deserializer=packet.FromString)
            grpc_timeout = max(args.seconds * 16, args.seconds + 150)
            stream = rpc(fmt(samplingRate=44100, channels=1, format=1), timeout=grpc_timeout,
                         metadata=[("authorization", "Bearer " + settings["grpc.token"])])
            requested_bytes = args.seconds * 44100 * 2 * 2
            stream_error = None
            try:
                for item in stream:
                    if item.format.samplingRate != 44100 or item.format.channels != 1 or item.format.format != 1:
                        raise ValueError("Unexpected emulator audio format")
                    chunks.append(item.audio)
                    timestamps.append(int(item.timestamp))
                    # The emulator packet timestamp clock can drift far ahead
                    # under load. Stop only when the stream has delivered the
                    # requested amount of output PCM.
                    if sum(map(len, chunks)) >= requested_bytes:
                        break
            except grpc.RpcError as error:
                stream_error = error
            finally:
                stream.cancel()
        pcm = b"".join(chunks)
        if len(pcm) < 4 or len(pcm) % 4:
            raise ValueError("Missing or incomplete stereo samples")
        values = struct.unpack("<" + "h" * (len(pcm) // 2), pcm)
        rms = math.sqrt(sum(value * value for value in values) / len(values)) / 32768
        clipped = sum(abs(value) >= 32760 for value in values) / len(values)
        wav_path = args.output / "emulator-output.wav"
        with wave.open(str(wav_path), "wb") as wav:
            wav.setnchannels(2)
            wav.setsampwidth(2)
            wav.setframerate(44100)
            wav.writeframes(pcm)
        gaps = [(b - a) / 1000 for a, b in zip(timestamps, timestamps[1:])]
        captured_seconds = len(pcm) / 176400
        capture_complete = captured_seconds >= args.seconds * 0.95
        report.update({"wavPath": str(wav_path.resolve()), "sha256": hashlib.sha256(wav_path.read_bytes()).hexdigest(),
                       "seconds": captured_seconds, "requestedSeconds": args.seconds, "captureComplete": capture_complete,
                       "packetCount": len(chunks), "rms": rms, "clippedFraction": clipped,
                       "maxPacketGapMs": max(gaps, default=0), "nonSilent": rms > 0.0001,
                       "continuous": bool(gaps) and all(0 <= gap < 250 for gap in gaps),
                       "notSustainedClipping": clipped < 0.01, "sourceComparisonStatus": "NOT_VERIFIED"})
        report["reason"] = "APK_SOURCE_COMPARISON_AND_LISTENING_REQUIRED" if capture_complete else "AUDIO_CAPTURE_TRUNCATED"
        if stream_error is not None:
            report["streamEndedWith"] = stream_error.code().name if hasattr(stream_error, "code") else type(stream_error).__name__
    except Exception as error:
        report["error"] = str(error)
    finally:
        report["finishedAt"] = time.time()
        (args.output / "audio-capture-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "error"}, ensure_ascii=False))
    return 0 if report.get("captureComplete") else 2


if __name__ == "__main__":
    raise SystemExit(main())
