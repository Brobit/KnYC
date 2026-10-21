import { Router } from "express";
import type { NoteInput } from "./note.js";
import type { NotesStore } from "./notes.store.js";
import { parseNoteInput } from "./notes.validation.js";
import { NotFoundError, ValidationError } from "../errors.js";

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new ValidationError(["id must be a positive integer"]);
  return id;
}

export function notesRouter(store: NotesStore, maxTitleLength: number): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const tag = typeof req.query.tag === "string" ? req.query.tag.toLowerCase() : undefined;
    res.json(store.list(tag));
  });

  router.get("/:id", (req, res) => {
    const note = store.get(parseId(req.params.id));
    if (!note) throw new NotFoundError("Note");
    res.json(note);
  });

  router.post("/", (req, res) => {
    const input = parseNoteInput(req.body, maxTitleLength) as NoteInput;
    res.status(201).json(store.create(input));
  });

  router.patch("/:id", (req, res) => {
    const id = parseId(req.params.id);
    const note = store.update(id, parseNoteInput(req.body, maxTitleLength, true));
    if (!note) throw new NotFoundError("Note");
    res.json(note);
  });

  router.delete("/:id", (req, res) => {
    if (!store.remove(parseId(req.params.id))) throw new NotFoundError("Note");
    res.status(204).end();
  });

  return router;
}
