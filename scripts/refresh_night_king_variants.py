from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "output" / "angle-owl-night-king-assets"


def load_sprite(name: str) -> Image.Image:
    return Image.open(ASSET_DIR / name).convert("RGBA")


def tint_variant(
    source: Image.Image,
    *,
    brightness: float = 1.0,
    contrast: float = 1.0,
    color: float = 1.0,
    sharpen: bool = False,
) -> Image.Image:
    rgba = source.copy()
    rgb = rgba.convert("RGB")
    rgb = ImageEnhance.Brightness(rgb).enhance(brightness)
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast)
    rgb = ImageEnhance.Color(rgb).enhance(color)
    if sharpen:
      rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.6, percent=85, threshold=3))
    return Image.merge("RGBA", (*rgb.split(), rgba.getchannel("A")))


def save_variant(name: str, image: Image.Image) -> None:
    image.save(ASSET_DIR / name)
    print(f"refreshed {name}")


def main() -> None:
    calm = load_sprite("sprite-night-king-calm.png")
    confused = load_sprite("sprite-night-king-confused.png")

    save_variant(
        "sprite-night-king-awe.png",
        tint_variant(calm, brightness=0.94, contrast=1.12, color=0.9, sharpen=True),
    )
    save_variant(
        "sprite-night-king-refusal.png",
        tint_variant(confused, brightness=0.97, contrast=1.05, color=0.92, sharpen=True),
    )
    save_variant(
        "sprite-night-king-smile.png",
        tint_variant(calm, brightness=1.03, contrast=0.98, color=1.02, sharpen=False),
    )


if __name__ == "__main__":
    main()
