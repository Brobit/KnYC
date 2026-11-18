import pytest
from pydantic import ValidationError

from app.models import NoteIn


def test_tags_are_trimmed_lowercased_and_unique():
    assert NoteIn(text="x", tags=[" Work", "work", "home", " "]).tags == ["home", "work"]


def test_text_is_required_and_bounded():
    with pytest.raises(ValidationError):
        NoteIn(text="")
    with pytest.raises(ValidationError):
        NoteIn(text="x" * 501)
