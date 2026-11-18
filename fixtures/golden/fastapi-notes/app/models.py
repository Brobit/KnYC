from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class NoteIn(BaseModel):
    """A note as the client sends it."""

    text: str = Field(min_length=1, max_length=500)
    tags: list[str] = []

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, tags: list[str]) -> list[str]:
        # "Work", " work " and "work" are the same tag.
        return sorted({tag.strip().lower() for tag in tags if tag.strip()})


class Note(NoteIn):
    """A stored note."""

    id: int
    created_at: datetime
    done: bool = False


class NotePatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=500)
    done: bool | None = None
