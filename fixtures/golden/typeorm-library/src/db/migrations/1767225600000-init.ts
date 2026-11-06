import type { MigrationInterface, QueryRunner } from "typeorm";

export class Init1767225600000 implements MigrationInterface {
  name = "Init1767225600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "author" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, CONSTRAINT "UQ_author_name" UNIQUE ("name"))`);
    await queryRunner.query(
      `CREATE TABLE "book" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "title" text NOT NULL, "year" integer NOT NULL, "authorId" integer NOT NULL, CONSTRAINT "FK_book_author" FOREIGN KEY ("authorId") REFERENCES "author" ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_book_author" ON "book" ("authorId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_book_author"`);
    await queryRunner.query(`DROP TABLE "book"`);
    await queryRunner.query(`DROP TABLE "author"`);
  }
}
