# fastapi-notes

A small notes API with FastAPI 0.164 and Pydantic 2. KnYC golden fixture for Python (#126 and the
M5 issues after it).

- `app/models.py`: Pydantic models (a validator normalizes tags).
- `app/store.py`: the notes store, in memory; `app/deps.py`: the store as a dependency.
- `app/routes/`: the routers (`health`, `notes`); `app/main.py`: the app factory.
- `tests/`: pytest, with `TestClient` and the store dependency overridden per test.

```bash
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest
uvicorn app.main:app --port 8000
```
