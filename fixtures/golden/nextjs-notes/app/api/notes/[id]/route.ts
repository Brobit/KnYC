import { store } from "../../../../server/notes-store";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const body = await request.json().catch(() => null);
  if (typeof body?.pinned !== "boolean") return Response.json({ error: "pinned must be true or false" }, { status: 400 });
  const note = store.setPinned(Number((await params).id), body.pinned);
  if (!note) return Response.json({ error: "no such note" }, { status: 404 });
  return Response.json(note);
}

export async function DELETE(_request: Request, { params }: Context) {
  if (!store.remove(Number((await params).id))) return Response.json({ error: "no such note" }, { status: 404 });
  return new Response(null, { status: 204 });
}
