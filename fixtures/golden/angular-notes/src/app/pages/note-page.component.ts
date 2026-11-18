import { Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { NotesService } from "../notes.service";

/** "/notes/:id": one note; `id` comes from the route (component input binding). */
@Component({
  selector: "app-note-page",
  imports: [RouterLink],
  template: `
    @if (note(); as note) {
      <article>
        <h2>{{ note.title }}</h2>
        <p>{{ note.body || "No details." }}</p>
        @if (note.pinned) {
          <p>Pinned</p>
        }
      </article>
    } @else {
      <p role="alert">No such note.</p>
    }
    <a routerLink="/">All notes</a>
  `,
})
export class NotePageComponent {
  readonly id = input.required<string>();
  private readonly notes = inject(NotesService);
  protected readonly note = computed(() => this.notes.byId(Number(this.id())));
}
