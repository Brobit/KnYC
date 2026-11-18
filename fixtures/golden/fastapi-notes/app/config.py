import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    """What the app reads from its environment."""

    title: str = "Notes"
    max_notes: int = 100


def get_settings() -> Settings:
    return Settings(
        title=os.environ.get("NOTES_TITLE", "Notes"),
        max_notes=int(os.environ.get("NOTES_MAX", "100")),
    )
