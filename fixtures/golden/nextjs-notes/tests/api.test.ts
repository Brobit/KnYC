import { beforeEach, describe, expect, it } from "vitest";
import { GET as health } from "../app/api/health/route";
import { DELETE, PATCH } from "../app/api/notes/[id]/route";
import { GET, POST } from "../app/api/notes/route";
import { store } from "../server/notes-store";

const json = (body: unknown) => new Request("http://localhost/api/notes", { method: "POST", body: JSON.stringify(body) });
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

beforeEach(() => store.clear());

describe("the API routes", () => {
  it("answer the health check", async () => {
    expect(await health().json()).toEqual({ status: "ok" });
  });

  it("create notes and list them", async () => {
    const created = await POST(json({ title: "  Buy milk " }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: 1, title: "Buy milk", pinned: false });
    expect((await POST(json({ title: " " }))).status).toBe(400);
    expect((await GET().json()).map((n: { title: string }) => n.title)).toEqual(["Buy milk"]);
  });

  it("pin and delete a note, and say when it doesn't exist", async () => {
    await POST(json({ title: "Call Ann" }));
    const pin = (body: unknown) => new Request("http://localhost/api/notes/1", { method: "PATCH", body: JSON.stringify(body) });
    expect(await (await PATCH(pin({ pinned: true }), params(1))).json()).toMatchObject({ pinned: true });
    expect((await PATCH(pin({ pinned: "yes" }), params(1))).status).toBe(400);
    expect((await PATCH(pin({ pinned: true }), params(9))).status).toBe(404);
    expect((await DELETE(new Request("http://localhost/api/notes/1"), params(1))).status).toBe(204);
    expect((await DELETE(new Request("http://localhost/api/notes/1"), params(1))).status).toBe(404);
  });
});
