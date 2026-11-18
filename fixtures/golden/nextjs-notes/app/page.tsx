import { NotesApp } from "../components/NotesApp";

// A server component: rendered on the server, it sends the heading as HTML and the client
// component that loads and changes the notes.
export default function Home() {
  return (
    <main>
      <h1>Notes</h1>
      <NotesApp />
    </main>
  );
}
