from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "output" / "angle-owl-night-king-assets"
AUDIT_DIR = ASSET_DIR / "_audit"
AUDIT_PATH = AUDIT_DIR / "asset-quality-audit.json"
CONTACT_SHEET_PATH = AUDIT_DIR / "sprite-contact-sheet-audited.png"
SPRITE_PREFIX = "sprite-"
BACKGROUND_PREFIX = "background-"
UI_PREFIX = "ui-"


@dataclass
class Component:
    area: int
    bbox: tuple[int, int, int, int]
    pixels: list[tuple[int, int]]


def alpha_components(image: Image.Image) -> list[Component]:
    alpha = image.getchannel("A")
    width, height = alpha.size
    seen = [[False] * height for _ in range(width)]
    px = alpha.load()
    components: list[Component] = []
    for x in range(width):
      for y in range(height):
        if seen[x][y] or px[x, y] == 0:
          continue
        queue = deque([(x, y)])
        seen[x][y] = True
        pixels: list[tuple[int, int]] = []
        min_x = max_x = x
        min_y = max_y = y
        while queue:
          cx, cy = queue.popleft()
          pixels.append((cx, cy))
          min_x = min(min_x, cx)
          max_x = max(max_x, cx)
          min_y = min(min_y, cy)
          max_y = max(max_y, cy)
          for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
            if 0 <= nx < width and 0 <= ny < height and not seen[nx][ny] and px[nx, ny] > 0:
              seen[nx][ny] = True
              queue.append((nx, ny))
        components.append(Component(len(pixels), (min_x, min_y, max_x, max_y), pixels))
    components.sort(key=lambda item: item.area, reverse=True)
    return components


def recentered_sprite(image: Image.Image, keep_components: list[Component]) -> Image.Image:
    width, height = image.size
    left = min(component.bbox[0] for component in keep_components)
    top = min(component.bbox[1] for component in keep_components)
    right = max(component.bbox[2] for component in keep_components)
    bottom = max(component.bbox[3] for component in keep_components)
    masked = Image.new("RGBA", image.size, (0, 0, 0, 0))
    source = image.load()
    target = masked.load()
    for component in keep_components:
        for x, y in component.pixels:
            target[x, y] = source[x, y]
    crop = masked.crop((left, top, right + 1, bottom + 1))
    margin = max(8, round(max(crop.size) * 0.03))
    inner = Image.new("RGBA", (crop.width + margin * 2, crop.height + margin * 2), (0, 0, 0, 0))
    inner.alpha_composite(crop, (margin, margin))

    canvas = Image.new("RGBA", image.size, (0, 0, 0, 0))
    paste_x = max(0, (width - inner.width) // 2)
    paste_y = max(0, height - inner.height - max(10, round(height * 0.018)))
    canvas.alpha_composite(inner, (paste_x, paste_y))
    return canvas


def analyze_sprite(path: Path) -> dict:
    image = Image.open(path).convert("RGBA")
    width, height = image.size
    components = alpha_components(image)
    if not components:
      return {
        "file": path.name,
        "kind": "sprite",
        "status": "error",
        "reason": "empty-alpha",
        "width": width,
        "height": height,
      }

    largest = components[0]
    min_keep_area = max(128, round(largest.area * 0.0025))
    keep_components = [largest, *[component for component in components[1:] if component.area >= min_keep_area]]
    detached = [component for component in components[1:] if component.area < min_keep_area]
    repaired = False
    if detached:
      repaired_image = recentered_sprite(image, keep_components)
      repaired_image.save(path)
      repaired = True

    return {
      "file": path.name,
      "kind": "sprite",
      "status": "ok",
      "width": width,
      "height": height,
      "component_count": len(components),
      "largest_component_area": largest.area,
      "detached_components_removed": len(detached),
      "repaired": repaired,
      "largest_bbox": list(largest.bbox),
    }


def analyze_raster(path: Path, kind: str) -> dict:
    image = Image.open(path)
    width, height = image.size
    warnings: list[str] = []
    if kind == "background":
      aspect = width / height if height else 0
      if abs(aspect - (16 / 9)) > 0.12:
        warnings.append("aspect-not-16-9")
    if width == 0 or height == 0:
      warnings.append("invalid-dimensions")
    return {
      "file": path.name,
      "kind": kind,
      "status": "ok" if not warnings else "warning",
      "width": width,
      "height": height,
      "warnings": warnings,
    }


def analyze_font(path: Path) -> dict:
    return {
      "file": path.name,
      "kind": "font",
      "status": "ok" if path.stat().st_size > 0 else "error",
      "size_bytes": path.stat().st_size,
    }


def sprite_contact_sheet(paths: Iterable[Path]) -> None:
    paths = list(paths)
    if not paths:
      return
    cols = 3
    thumb_w = 320
    thumb_h = 360
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * thumb_w, rows * (thumb_h + 28)), (16, 18, 24, 255))
    for index, path in enumerate(paths):
      image = Image.open(path).convert("RGBA")
      tile = Image.new("RGBA", (thumb_w - 16, thumb_h - 16), (34, 38, 48, 255))
      image.thumbnail((tile.width - 12, tile.height - 12))
      offset_x = (tile.width - image.width) // 2
      offset_y = tile.height - image.height - 6
      tile.alpha_composite(image, (offset_x, max(0, offset_y)))
      x = (index % cols) * thumb_w + 8
      y = (index // cols) * (thumb_h + 28) + 8
      sheet.alpha_composite(tile, (x, y))
    sheet.save(CONTACT_SHEET_PATH)


def main() -> None:
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    sprite_paths: list[Path] = []
    for path in sorted(ASSET_DIR.iterdir()):
      if path.is_dir():
        continue
      if "contact-sheet" in path.name or "candidates-sheet" in path.name:
        continue
      if path.name == CONTACT_SHEET_PATH.name:
        continue
      if path.suffix.lower() == ".png":
        if path.name.startswith(SPRITE_PREFIX):
          sprite_paths.append(path)
          results.append(analyze_sprite(path))
        elif path.name.startswith(BACKGROUND_PREFIX) or path.name.startswith("title-cover-"):
          results.append(analyze_raster(path, "background"))
        elif path.name.startswith(UI_PREFIX):
          results.append(analyze_raster(path, "ui"))
      elif path.suffix.lower() == ".ttf":
        results.append(analyze_font(path))
      elif path.suffix.lower() == ".wav":
        results.append({
          "file": path.name,
          "kind": "audio",
          "status": "ok" if path.stat().st_size > 0 else "error",
          "size_bytes": path.stat().st_size,
        })

    sprite_contact_sheet(sprite_paths)
    summary = {
      "asset_dir": str(ASSET_DIR),
      "generated_at": __import__("datetime").datetime.now().isoformat(),
      "total_assets": len(results),
      "repaired_assets": [item["file"] for item in results if item.get("repaired")],
      "warnings": [item["file"] for item in results if item.get("status") == "warning"],
      "errors": [item["file"] for item in results if item.get("status") == "error"],
      "results": results,
    }
    AUDIT_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(AUDIT_PATH)
    print(CONTACT_SHEET_PATH)


if __name__ == "__main__":
    main()
