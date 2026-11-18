import { store } from "../../../server/notes-store";

export function GET() {
  return Response.json(store.list());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  return Response.json(store.create(title), { status: 201 });
}
