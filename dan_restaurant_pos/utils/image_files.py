from __future__ import annotations

import shutil
from pathlib import Path
from uuid import uuid4

from PyQt6.QtGui import QImageReader

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_IMAGE_SIZE = 5 * 1024 * 1024


def store_image(source: str | Path, category: str) -> str:
    source_path = Path(source).expanduser().resolve(strict=True)
    if source_path.suffix.lower() not in ALLOWED_IMAGE_EXTENSIONS:
        raise ValueError("Choose a JPG or PNG image.")
    if not source_path.is_file():
        raise ValueError("The selected image is not a file.")
    if source_path.stat().st_size > MAX_IMAGE_SIZE:
        raise ValueError("Images must be 5 MB or smaller.")
    reader = QImageReader(str(source_path))
    if not reader.canRead():
        raise ValueError("The selected file is not a readable image.")
    size = reader.size()
    if size.isValid() and (size.width() > 4096 or size.height() > 4096):
        raise ValueError("Image dimensions cannot exceed 4096 by 4096 pixels.")

    destination_dir = PROJECT_ROOT / "uploads" / category
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{uuid4().hex}{source_path.suffix.lower()}"
    shutil.copy2(source_path, destination)
    return destination.relative_to(PROJECT_ROOT).as_posix()


def resolve_image_path(image_path: str | None) -> Path | None:
    if not image_path:
        return None
    upload_root = (PROJECT_ROOT / "uploads").resolve()
    path = Path(image_path)
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    path = path.resolve()
    if not path.is_relative_to(upload_root):
        return None
    return path if path.is_file() else None
