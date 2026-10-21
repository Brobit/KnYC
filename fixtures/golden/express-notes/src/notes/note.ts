export interface Note {
  id: number;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type NoteInput = Pick<Note, "title" | "body" | "tags">;
