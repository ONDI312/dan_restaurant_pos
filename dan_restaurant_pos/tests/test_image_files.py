from pathlib import Path

import pytest
from PyQt6.QtGui import QImage

from dan_restaurant_pos.utils import image_files


def test_image_is_copied_and_resolved_under_managed_upload_directory(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setattr(image_files, "PROJECT_ROOT", tmp_path)
    source = tmp_path / "source.png"
    image = QImage(1, 1, QImage.Format.Format_ARGB32)
    image.fill(0xFF336699)
    assert image.save(str(source))

    relative_path = image_files.store_image(source, "products")

    stored_path = image_files.resolve_image_path(relative_path)
    assert stored_path is not None
    assert stored_path.is_file()
    assert stored_path.parent == tmp_path / "uploads" / "products"


def test_image_upload_rejects_unsupported_and_invalid_files(tmp_path: Path) -> None:
    unsupported = tmp_path / "image.gif"
    unsupported.write_bytes(b"gif")
    with pytest.raises(ValueError, match="JPG or PNG"):
        image_files.store_image(unsupported, "products")

    invalid = tmp_path / "image.png"
    invalid.write_bytes(b"not an image")
    with pytest.raises(ValueError, match="readable image"):
        image_files.store_image(invalid, "products")
