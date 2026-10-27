import express, { Router } from "express";
import { NotesStore } from "./notes.store.js";

/** The API, under /api (the web app's dev server proxies /api here). */
export function createApp(store = new NotesStore()) {
  const api = Router();

  api.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  api.get("/notes", (_req, res) => {
    res.json(store.list());
  });

  api.post("/notes", (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    res.status(201).json(store.create(title));
  });

  api.patch("/notes/:id", (req, res) => {
    if (typeof req.body?.pinned !== "boolean") {
      res.status(400).json({ error: "pinned must be true or false" });
      return;
    }
    const note = store.setPinned(Number(req.params.id), req.body.pinned);
    if (!note) {
      res.status(404).json({ error: "no such note" });
      return;
    }
    res.json(note);
  });

  api.delete("/notes/:id", (req, res) => {
    if (!store.remove(Number(req.params.id))) {
      res.status(404).json({ error: "no such note" });
      return;
    }
    res.status(204).end();
  });

  const app = express();
  app.use(express.json());
  app.use("/api", api);
  return app;
}
