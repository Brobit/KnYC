import { addBook } from "../queries/catalog.js";
import { addMember } from "../queries/members.js";
import { createDb } from "./client.js";

// Sample data for development: `npm run db:seed` after `npm run db:migrate`.
const db = createDb();
for (const book of [
  { title: "The Left Hand of Darkness", year: 1969, author: "Ursula K. Le Guin" },
  { title: "The Dispossessed", year: 1974, author: "Ursula K. Le Guin" },
  { title: "Kindred", year: 1979, author: "Octavia E. Butler" },
  { title: "Parable of the Sower", year: 1993, author: "Octavia E. Butler" },
]) {
  addBook(db, book);
}
addMember(db, { email: "ada@example.com", name: "Ada" });
db.$client.close();
