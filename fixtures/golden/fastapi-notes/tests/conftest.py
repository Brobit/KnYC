import pytest
from fastapi.testclient import TestClient

from app.deps import get_store
from app.main import create_app
from app.store import NotesStore


@pytest.fixture
def store() -> NotesStore:
    return NotesStore(max_notes=3)


@pytest.fixture
def client(store: NotesStore) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_store] = lambda: store
    return TestClient(app)
