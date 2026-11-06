import { Column, Entity, Index, ManyToOne, OneToMany, PrimaryGeneratedColumn, type Relation } from "typeorm";
import { Author } from "./author.js";
import { Loan } from "./loan.js";

@Entity()
export class Book {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text")
  title: string;

  @Column("integer")
  year: number;

  @Index()
  @ManyToOne(() => Author, (author) => author.books, { nullable: false })
  author: Relation<Author>;

  @OneToMany(() => Loan, (loan) => loan.book)
  loans: Relation<Loan[]>;
}
