import express from "express";
import type { Config } from "./config.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { NotesStore } from "./notes/notes.store.js";
import { notesRouter } from "./notes/notes.routes.js";

export function createApp(config: Config, store = new NotesStore()) {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/notes", notesRouter(store, config.maxTitleLength));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
