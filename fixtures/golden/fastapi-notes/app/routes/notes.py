from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..deps import get_store
from ..models import Note, NoteIn, NotePatch
from ..store import NoteNotFound, NotesStore, StoreFull

router = APIRouter(prefix="/notes", tags=["notes"])


def found(store: NotesStore, note_id: int) -> Note:
    try:
        return store.get(note_id)
    except NoteNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(error)) from error


@router.get("")
def list_notes(tag: str | None = None, done: bool | None = None, store: NotesStore = Depends(get_store)) -> list[Note]:
    return store.list(tag=tag, done=done)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_note(note: NoteIn, store: NotesStore = Depends(get_store)) -> Note:
    try:
        return store.add(note)
    except StoreFull as error:
        raise HTTPException(status.HTTP_409_CONFLICT, "too many notes") from error


@router.get("/tags")
def tag_counts(store: NotesStore = Depends(get_store)) -> dict[str, int]:
    return store.tags()


@router.get("/{note_id}")
def get_note(note_id: int, store: NotesStore = Depends(get_store)) -> Note:
    return found(store, note_id)


@router.patch("/{note_id}")
def update_note(note_id: int, patch: NotePatch, store: NotesStore = Depends(get_store)) -> Note:
    found(store, note_id)
    return store.update(note_id, patch)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: int, store: NotesStore = Depends(get_store)) -> Response:
    found(store, note_id)
    store.delete(note_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
