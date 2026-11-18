from datetime import UTC, datetime

from .models import Note, NoteIn, NotePatch


class NoteNotFound(Exception):
    def __init__(self, note_id: int):
        super().__init__(f"note {note_id} not found")
        self.note_id = note_id


class StoreFull(Exception):
    pass


class NotesStore:
    """Notes in memory, ids counting from 1."""

    def __init__(self, max_notes: int = 100):
        self.max_notes = max_notes
        self._notes: dict[int, Note] = {}
        self._next_id = 1

    def add(self, note: NoteIn) -> Note:
        if len(self._notes) >= self.max_notes:
            raise StoreFull()
        created = Note(id=self._next_id, created_at=datetime.now(UTC), **note.model_dump())
        self._notes[created.id] = created
        self._next_id += 1
        return created

    def get(self, note_id: int) -> Note:
        try:
            return self._notes[note_id]
        except KeyError:
            raise NoteNotFound(note_id) from None

    def list(self, tag: str | None = None, done: bool | None = None) -> list[Note]:
        notes = sorted(self._notes.values(), key=lambda n: n.id)
        if tag is not None:
            notes = [n for n in notes if tag.lower() in n.tags]
        if done is not None:
            notes = [n for n in notes if n.done == done]
        return notes

    def update(self, note_id: int, patch: NotePatch) -> Note:
        changes = patch.model_dump(exclude_unset=True, exclude_none=True)
        updated = self.get(note_id).model_copy(update=changes)
        self._notes[note_id] = updated
        return updated

    def delete(self, note_id: int) -> None:
        self.get(note_id)
        del self._notes[note_id]

    def tags(self) -> dict[str, int]:
        """How many notes carry each tag."""
        counts: dict[str, int] = {}
        for note in self._notes.values():
            for tag in note.tags:
                counts[tag] = counts.get(tag, 0) + 1
        return dict(sorted(counts.items()))
