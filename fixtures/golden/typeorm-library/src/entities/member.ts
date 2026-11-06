import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, type Relation } from "typeorm";
import { Loan } from "./loan.js";

@Entity()
export class Member {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  email: string;

  @Column("text")
  name: string;

  @CreateDateColumn({ type: "datetime" })
  joinedAt: Date;

  @OneToMany(() => Loan, (loan) => loan.member)
  loans: Relation<Loan[]>;
}
