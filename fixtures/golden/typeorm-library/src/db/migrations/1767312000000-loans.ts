import type { MigrationInterface, QueryRunner } from "typeorm";

export class Loans1767312000000 implements MigrationInterface {
  name = "Loans1767312000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "member" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "email" text NOT NULL, "name" text NOT NULL, "joinedAt" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "UQ_member_email" UNIQUE ("email"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "loan" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "borrowedAt" datetime NOT NULL, "dueAt" datetime NOT NULL, "returnedAt" datetime, "bookId" integer NOT NULL, "memberId" integer NOT NULL, CONSTRAINT "FK_loan_book" FOREIGN KEY ("bookId") REFERENCES "book" ("id"), CONSTRAINT "FK_loan_member" FOREIGN KEY ("memberId") REFERENCES "member" ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_loan_book" ON "loan" ("bookId")`);
    await queryRunner.query(`CREATE INDEX "IDX_loan_member" ON "loan" ("memberId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_loan_member"`);
    await queryRunner.query(`DROP INDEX "IDX_loan_book"`);
    await queryRunner.query(`DROP TABLE "loan"`);
    await queryRunner.query(`DROP TABLE "member"`);
  }
}
