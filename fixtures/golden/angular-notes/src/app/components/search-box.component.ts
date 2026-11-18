import { Component, model } from "@angular/core";

/** A search field bound both ways to `query`. */
@Component({
  selector: "app-search-box",
  template: `<input type="search" aria-label="Search notes" placeholder="Search" [value]="query()" (input)="query.set($any($event.target).value)" />`,
})
export class SearchBoxComponent {
  readonly query = model.required<string>();
}
