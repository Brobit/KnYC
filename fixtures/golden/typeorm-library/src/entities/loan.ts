import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn, type Relation } from "typeorm";
import { Book } from "./book.js";
import { Member } from "./member.js";

/** A book lent to a member. Open while returnedAt is null; a book has at most one open loan. */
@Entity()
export class Loan {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @ManyToOne(() => Book, (book) => book.loans, { nullable: false })
  book: Relation<Book>;

  @Index()
  @ManyToOne(() => Member, (member) => member.loans, { nullable: false })
  member: Relation<Member>;

  @Column("datetime")
  borrowedAt: Date;

  @Column("datetime")
  dueAt: Date;

  @Column("datetime", { nullable: true })
  returnedAt: Date | null;
}
