//! Database files in the code graph (#98): a Prisma schema's models and enums become symbols, so
//! a step can introduce them one by one; a SQL file (a migration) is one whole-file unit that
//! knows the tables it touches. The edges between them and the code are added in `mod.rs`.

use super::parse::{ParsedFile, Symbol, SymbolKind};
use regex::Regex;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

static BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*(model|enum|view|type)\s+(\w+)\s*\{").unwrap());
static FIELD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\s*\w+\s+(\w+)(\[\]|\?)?(.*)$").unwrap());
static MAP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"@@map\(\s*"([^"]+)""#).unwrap());
static TABLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|INSERT\s+INTO|INDEX\s+\S+\s+ON|REFERENCES)\s+["`\[]?(\w+)"#,
    )
    .unwrap()
});

/// Models, views and composite types (→ `Class`) and enums, with what each needs: the enums and
/// types its fields use, and the models it holds a foreign key to (`@relation(fields: …)`). The
/// other side of a relation (`books Book[]`) needs nothing: it's a view of the same foreign key,
/// left out of a step until its model exists. `generator` and `datasource` aren't symbols: they
/// are the file's setup, always there.
pub fn parse_prisma(source: &str) -> ParsedFile {
    let lines: Vec<&str> = source.lines().collect();
    let mut blocks = Vec::new();
    let mut has_errors = false;
    let mut i = 0;
    while i < lines.len() {
        if let Some(c) = BLOCK.captures(lines[i]) {
            let end = (i + 1..lines.len()).find(|&j| lines[j].trim_start().starts_with('}'));
            let Some(end) = end else {
                has_errors = true;
                break;
            };
            blocks.push((c[1].to_string(), c[2].to_string(), i, end));
            i = end;
        }
        i += 1;
    }

    let enums: BTreeSet<&str> = blocks
        .iter()
        .filter(|b| b.0 == "enum")
        .map(|b| b.1.as_str())
        .collect();
    let types: BTreeSet<&str> = blocks
        .iter()
        .filter(|b| b.0 == "type")
        .map(|b| b.1.as_str())
        .collect();
    let models: BTreeSet<&str> = blocks
        .iter()
        .filter(|b| b.0 == "model" || b.0 == "view")
        .map(|b| b.1.as_str())
        .collect();

    let mut file = ParsedFile {
        has_errors,
        ..ParsedFile::default()
    };
    for (keyword, name, start, end) in &blocks {
        let mut uses = BTreeSet::new();
        let mut table = name.clone();
        if keyword != "enum" {
            for line in &lines[start + 1..*end] {
                let line = line.split("//").next().unwrap_or_default();
                if let Some(m) = MAP.captures(line) {
                    table = m[1].to_string();
                }
                let Some(field) = FIELD.captures(line) else {
                    continue;
                };
                let ty = &field[1];
                let rest = &field[3];
                let owns_key = rest.contains("@relation(") && rest.contains("fields:");
                if enums.contains(ty) || types.contains(ty) || (models.contains(ty) && owns_key) {
                    uses.insert(ty.to_string());
                }
            }
            if keyword == "model" || keyword == "view" {
                file.tables.insert(table.to_lowercase(), name.clone());
            }
        }
        file.exports.push(name.clone());
        file.symbols.push(Symbol {
            name: name.clone(),
            kind: if keyword == "enum" {
                SymbolKind::Enum
            } else {
                SymbolKind::Class
            },
            exported: true,
            start_line: start + 1,
            end_line: end + 1,
            uses,
            members: BTreeSet::new(),
            outer_members: BTreeSet::new(),
        });
    }
    file
}

/// A SQL file has no symbols (one unit); it records the tables it creates, changes, indexes or
/// references. SQLite's table rebuilds (`new_Book`) count as `Book`.
pub fn parse_sql(source: &str) -> ParsedFile {
    ParsedFile {
        tables: sql_tables(source),
        ..ParsedFile::default()
    }
}

fn sql_tables(source: &str) -> BTreeMap<String, String> {
    let mut tables = BTreeMap::new();
    for line in source.lines().filter(|l| !l.trim_start().starts_with("--")) {
        for c in TABLE.captures_iter(line) {
            let name = c[1].to_lowercase();
            let name = name.strip_prefix("new_").unwrap_or(&name).to_string();
            tables.insert(name, String::new());
        }
    }
    tables
}

static DRIZZLE_TABLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)^\s*export\s+const\s+(\w+)\s*=\s*(?:sqliteTable|pgTable|mysqlTable)\(\s*["'`](\w+)["'`]"#)
        .unwrap()
});
static ENTITY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"@Entity\(\s*(?:["'`](\w+)["'`])?[^)]*\)\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)"#,
    )
    .unwrap()
});

/// The tables a TypeScript file defines or migrates (#99): Drizzle tables (`export const books =
/// sqliteTable("books", …)`, table → variable) and TypeORM entities (`@Entity() class BookLoan`,
/// "book_loan" → class); in a migration file (its path says so), the tables its SQL strings touch.
pub fn ts_tables(source: &str, path: &str) -> BTreeMap<String, String> {
    let mut tables = BTreeMap::new();
    for c in DRIZZLE_TABLE.captures_iter(source) {
        tables.insert(c[2].to_lowercase(), c[1].to_string());
    }
    for c in ENTITY.captures_iter(source) {
        let table = c
            .get(1)
            .map_or_else(|| snake_case(&c[2]), |t| t.as_str().to_lowercase());
        tables.insert(table, c[2].to_string());
    }
    if tables.is_empty() && path.to_lowercase().contains("migration") {
        return sql_tables(source);
    }
    tables
}

/// TypeORM's default table name: "BookLoan" → "book_loan".
fn snake_case(name: &str) -> String {
    let mut out = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch.is_uppercase() && i > 0 {
            out.push('_');
        }
        out.extend(ch.to_lowercase());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = r#"generator client {
  provider = "prisma-client"
}

datasource db {
  provider = "sqlite"
}

enum Role {
  READER
  LIBRARIAN
}

/// A writer.
model Author {
  id    Int    @id
  books Book[]
}

model Book {
  id       Int    @id
  author   Author @relation(fields: [authorId], references: [id])
  authorId Int
  cover    Cover?
}

model Cover {
  id     Int  @id
  book   Book @relation(fields: [bookId], references: [id])
  bookId Int  @unique
}

model Member {
  id   Int  @id
  role Role @default(READER)

  @@map("members")
}
"#;

    #[test]
    fn models_need_their_enums_and_the_models_they_hold_a_key_to() {
        let file = parse_prisma(SCHEMA);
        let summary: Vec<_> = file
            .symbols
            .iter()
            .map(|s| {
                (
                    s.name.as_str(),
                    s.kind,
                    s.start_line,
                    s.end_line,
                    s.uses.iter().cloned().collect::<Vec<_>>(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                ("Role", SymbolKind::Enum, 9, 12, vec![]),
                ("Author", SymbolKind::Class, 15, 18, vec![]),
                (
                    "Book",
                    SymbolKind::Class,
                    20,
                    25,
                    vec!["Author".to_string()]
                ),
                ("Cover", SymbolKind::Class, 27, 31, vec!["Book".to_string()]),
                (
                    "Member",
                    SymbolKind::Class,
                    33,
                    38,
                    vec!["Role".to_string()]
                ),
            ]
        );
        assert_eq!(
            file.tables.get("members").map(String::as_str),
            Some("Member")
        );
        assert_eq!(file.tables.get("book").map(String::as_str), Some("Book"));
        assert!(!file.has_errors);
    }

    #[test]
    fn drizzle_tables_typeorm_entities_and_typescript_migrations() {
        let drizzle = r#"export const books = sqliteTable(
  "books",
  { id: integer().primaryKey() },
);
export const authorsRelations = relations(authors, () => ({}));"#;
        assert_eq!(
            ts_tables(drizzle, "src/db/schema.ts")
                .into_iter()
                .collect::<Vec<_>>(),
            vec![("books".to_string(), "books".to_string())]
        );

        let entity = "@Entity()\nexport class BookLoan {}\n@Entity(\"people\")\nclass Person {}\n";
        assert_eq!(
            ts_tables(entity, "src/entities/loan.ts")
                .into_iter()
                .collect::<Vec<_>>(),
            vec![
                ("book_loan".to_string(), "BookLoan".to_string()),
                ("people".to_string(), "Person".to_string())
            ]
        );

        let migration = "await queryRunner.query(`CREATE TABLE \"author\" (\"id\" integer)`);";
        assert_eq!(
            ts_tables(migration, "src/db/migrations/1-init.ts")
                .into_keys()
                .collect::<Vec<_>>(),
            vec!["author"]
        );
        assert!(ts_tables(migration, "src/queries/raw.ts").is_empty());
    }

    #[test]
    fn a_migration_knows_its_tables() {
        let sql = r#"-- CreateTable
CREATE TABLE "Loan" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    CONSTRAINT "Loan_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Member_email_key" ON "Member"("email");
CREATE TABLE "new_Author" ("id" INTEGER);
"#;
        let tables: Vec<_> = parse_sql(sql).tables.into_keys().collect();
        assert_eq!(tables, vec!["author", "book", "loan", "member"]);
    }
}
