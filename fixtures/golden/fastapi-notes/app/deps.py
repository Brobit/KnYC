from functools import lru_cache

from .config import get_settings
from .store import NotesStore


@lru_cache
def get_store() -> NotesStore:
    """One store for the app; tests override this dependency with a fresh one."""
    return NotesStore(max_notes=get_settings().max_notes)
