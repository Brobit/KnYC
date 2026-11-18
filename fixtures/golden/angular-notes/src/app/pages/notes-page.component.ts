import { Component, computed, inject, signal } from "@angular/core";
import { NoteFormComponent } from "../components/note-form.component";
import { NoteListComponent } from "../components/note-list.component";
import { SearchBoxComponent } from "../components/search-box.component";
import { countLabel, visibleNotes } from "../lib/notes";
import { NotesService } from "../notes.service";

/** "/": the form, the search, the list and the count, on the notes service. */
@Component({
  selector: "app-notes-page",
  imports: [NoteFormComponent, SearchBoxComponent, NoteListComponent],
  template: `
    <app-note-form (add)="notes.add($event)" />
    <app-search-box [(query)]="query" />
    <app-note-list [notes]="shown()" (togglePin)="notes.togglePin($event)" (remove)="notes.remove($event)" />
    <footer>{{ count() }}</footer>
  `,
})
export class NotesPageComponent {
  protected readonly notes = inject(NotesService);
  protected readonly query = signal("");
  protected readonly shown = computed(() => visibleNotes(this.notes.notes(), this.query()));
  protected readonly count = computed(() => countLabel(this.notes.notes().length));
}
