import { Component, input, output } from "@angular/core";
import type { Note } from "../types";
import { NoteItemComponent } from "./note-item.component";

/** The notes, or "No notes yet."; passes each item's events up. */
@Component({
  selector: "app-note-list",
  imports: [NoteItemComponent],
  template: `
    @if (notes().length === 0) {
      <p>No notes yet.</p>
    } @else {
      <ul aria-label="Notes">
        @for (note of notes(); track note.id) {
          <li><app-note-item [note]="note" (togglePin)="togglePin.emit($event)" (remove)="remove.emit($event)" /></li>
        }
      </ul>
    }
  `,
})
export class NoteListComponent {
  readonly notes = input.required<Note[]>();
  readonly togglePin = output<number>();
  readonly remove = output<number>();
}
