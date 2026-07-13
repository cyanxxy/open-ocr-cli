"""Build deterministic raster-only and degraded OCR fixtures from local PDFs."""

from __future__ import annotations

import random
import shutil
import subprocess
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
except ImportError as error:
    raise SystemExit("Pillow is required: python3 -m pip install pillow") from error


ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus"
RASTER = CORPUS / "raster"
DEGRADED = CORPUS / "degraded"
PDF_NAMES = ("invoice", "receipt", "resume", "business-card", "operations-note")


def render_first_page(pdf_path: Path, output_path: Path, dpi: int = 200) -> None:
    executable = shutil.which("pdftoppm")
    if not executable:
        raise SystemExit("pdftoppm is required. Install Poppler before building eval fixtures.")

    with tempfile.TemporaryDirectory() as temporary_directory:
        prefix = Path(temporary_directory) / "page"
        subprocess.run(
            [executable, "-f", "1", "-singlefile", "-r", str(dpi), "-png", str(pdf_path), str(prefix)],
            check=True,
        )
        with Image.open(prefix.with_suffix(".png")) as image:
            image.convert("RGB").save(output_path, format="PNG", optimize=True)


def add_shadow(image: Image.Image) -> Image.Image:
    overlay = Image.new("L", image.size, 0)
    draw = ImageDraw.Draw(overlay)
    width, height = image.size
    for x in range(width):
        opacity = int(70 * (x / max(width - 1, 1)))
        draw.line((x, 0, x, height), fill=opacity)
    shadow = Image.new("RGB", image.size, (55, 45, 35))
    return Image.composite(shadow, image, overlay)


def degrade(source: Path, destination: Path, seed: int) -> None:
    randomizer = random.Random(seed)
    with Image.open(source) as original:
        image = original.convert("RGB")
        target_width = max(720, int(image.width * 0.55))
        target_height = max(1, int(image.height * target_width / image.width))
        image = image.resize((target_width, target_height), Image.Resampling.LANCZOS)
        image = image.rotate(
            randomizer.uniform(-2.2, 2.2),
            resample=Image.Resampling.BICUBIC,
            expand=True,
            fillcolor=(236, 232, 224),
        )
        image = ImageEnhance.Contrast(image).enhance(0.82)
        image = ImageEnhance.Brightness(image).enhance(0.94)
        image = image.filter(ImageFilter.GaussianBlur(radius=0.65))
        image = add_shadow(image)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, format="JPEG", quality=58, optimize=True, progressive=True)


def main() -> None:
    RASTER.mkdir(parents=True, exist_ok=True)
    DEGRADED.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(PDF_NAMES):
        raster_path = RASTER / f"{name}.png"
        render_first_page(CORPUS / f"{name}.pdf", raster_path)
        degrade(raster_path, DEGRADED / f"{name}.jpg", seed=20260713 + index)


if __name__ == "__main__":
    main()
