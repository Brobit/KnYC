import type { Routes } from "@angular/router";
import { NotePageComponent } from "./pages/note-page.component";
import { NotesPageComponent } from "./pages/notes-page.component";

export const routes: Routes = [
  { path: "", component: NotesPageComponent },
  { path: "notes/:id", component: NotePageComponent },
];
