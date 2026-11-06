import { Column, Entity, OneToMany, PrimaryGeneratedColumn, type Relation } from "typeorm";
import { Book } from "./book.js";

/** A writer; their name is unique, so adding a book can find or create them by name. */
@Entity()
export class Author {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  name: string;

  @OneToMany(() => Book, (book) => book.author)
  books: Relation<Book[]>;
}
