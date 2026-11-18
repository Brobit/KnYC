import { Component, input, output } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { Note } from "../types";

/** One note: a link to it, Pin/Unpin and Delete (emitted with its id). */
@Component({
  selector: "app-note-item",
  imports: [RouterLink],
  template: `
    <a [routerLink]="['/notes', note().id]">{{ note().title }}</a>
    @if (note().pinned) {
      <span aria-label="Pinned"> 📌</span>
    }
    <button type="button" (click)="togglePin.emit(note().id)">{{ note().pinned ? "Unpin" : "Pin" }}</button>
    <button type="button" [attr.aria-label]="'Delete ' + note().title" (click)="remove.emit(note().id)">Delete</button>
  `,
})
export class NoteItemComponent {
  readonly note = input.required<Note>();
  readonly togglePin = output<number>();
  readonly remove = output<number>();
}
