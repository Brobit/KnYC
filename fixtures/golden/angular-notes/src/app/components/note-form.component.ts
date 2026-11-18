import { Component, output, signal } from "@angular/core";

/** A title field and Add; emits the title (Add is disabled while it's empty). */
@Component({
  selector: "app-note-form",
  template: `
    <form (submit)="submit($event)">
      <label>Title <input [value]="title()" (input)="title.set($any($event.target).value)" /></label>
      <button type="submit" [disabled]="!title().trim()">Add</button>
    </form>
  `,
})
export class NoteFormComponent {
  readonly add = output<string>();
  protected readonly title = signal("");

  protected submit(event: Event) {
    event.preventDefault();
    if (!this.title().trim()) return;
    this.add.emit(this.title());
    this.title.set("");
  }
}
