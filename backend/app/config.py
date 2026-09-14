"""
BrainTrust AI Configuration
"""

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings"""

    app_name: str = "BrainTrust AI"
    debug: bool = True
    demo_mode: bool = True
    model_name: str = "resnet50"
    model_dir: Path = Path(__file__).parent.parent / "models" / "checkpoints"
    max_image_size: int = 10 * 1024 * 1024
    allowed_extensions: list[str] = [".png", ".jpg", ".jpeg"]
    image_size: tuple[int, int] = (224, 224)
    class_names: dict[int, str] = {
        0: "No Tumor",
        1: "Glioma",
        2: "Meningioma",
        3: "Pituitary Tumor",
    }
    perturbation_methods: list[str] = [
        "generative_inpainting",
        "adversarial_masking",
        "demo_fallback",
    ]
    ofi_formula_version: str = "1.0.0"
    data_dir: Path = Path(__file__).parent.parent / "data"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
