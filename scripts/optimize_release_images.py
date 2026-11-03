from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import PIL
from PIL import Image, features


def write_results(path: Path, results: list[dict[str, object]]) -> None:
    temporary = path.with_name(f"{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    if len(sys.argv) != 3:
        raise RuntimeError("Usage: python scripts/optimize_release_images.py <jobs.json> <results.json>")
    if not features.check("webp"):
        raise RuntimeError("The bundled Pillow build does not support WebP.")

    jobs_path = Path(sys.argv[1])
    results_path = Path(sys.argv[2])
    jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
    results: list[dict[str, object]] = []

    for job in jobs:
        output_path = Path(job["outputPath"])
        try:
            with Image.open(job["sourcePath"]) as source:
                source.load()
                width, height = source.size
                save_options: dict[str, object] = {
                    "format": "WEBP",
                    "method": 6 if job["mode"] == "lossless" else 5,
                }
                if job["mode"] == "lossless":
                    save_options["lossless"] = True
                    save_options["exact"] = True
                else:
                    save_options["quality"] = 90
                    save_options["alpha_quality"] = 100
                source.save(output_path, **save_options)
            with Image.open(output_path) as converted:
                if converted.size != (width, height):
                    raise RuntimeError("converted dimensions differ from the source")
            results.append({
                "assetId": job["assetId"],
                "ok": True,
                "sizeBytes": output_path.stat().st_size,
                "width": width,
                "height": height,
                "imageBackend": f"Pillow {PIL.__version__}",
            })
        except Exception as error:  # noqa: BLE001 - per-resource fallback is intentional.
            output_path.unlink(missing_ok=True)
            results.append({
                "assetId": job["assetId"],
                "ok": False,
                "error": str(error),
            })
        write_results(results_path, results)

    print(json.dumps({
        "ok": True,
        "processed": len(results),
        "optimized": sum(1 for item in results if item["ok"]),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
