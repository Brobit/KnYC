import pytest

from app.models import NoteIn, NotePatch
from app.store import NoteNotFound, NotesStore, StoreFull


def test_adds_lists_and_filters_notes():
    store = NotesStore()
    store.add(NoteIn(text="buy milk", tags=["home"]))
    second = store.add(NoteIn(text="write report", tags=["work"]))
    store.update(second.id, NotePatch(done=True))
    assert [n.id for n in store.list()] == [1, 2]
    assert [n.text for n in store.list(tag="WORK")] == ["write report"]
    assert [n.text for n in store.list(done=False)] == ["buy milk"]


def test_counts_tags():
    store = NotesStore()
    store.add(NoteIn(text="a", tags=["work", "urgent"]))
    store.add(NoteIn(text="b", tags=["work"]))
    assert store.tags() == {"urgent": 1, "work": 2}


def test_refuses_missing_notes_and_a_full_store():
    store = NotesStore(max_notes=1)
    store.add(NoteIn(text="only"))
    with pytest.raises(StoreFull):
        store.add(NoteIn(text="one too many"))
    with pytest.raises(NoteNotFound):
        store.delete(42)
