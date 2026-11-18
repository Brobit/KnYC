from fastapi import FastAPI

from .config import get_settings
from .routes import health, notes


def create_app() -> FastAPI:
    app = FastAPI(title=get_settings().title)
    app.include_router(health.router)
    app.include_router(notes.router)
    return app


app = create_app()
