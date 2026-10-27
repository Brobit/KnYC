import { describe, expect, it } from "vitest";
import { ApiError, createNote, deleteNote, fetchNotes } from "./api";

/** A fetch that records the request and answers `status` with `body`. */
function fakeFetch(status: number, body?: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("the API client", () => {
  it("calls /api with JSON", async () => {
    const { calls, fetcher } = fakeFetch(201, { id: 1, title: "Buy milk", pinned: false, createdAt: "x" });
    expect((await createNote("Buy milk", fetcher)).id).toBe(1);
    expect(calls[0]!.url).toBe("/api/notes");
    expect(calls[0]!.init).toMatchObject({ method: "POST", body: '{"title":"Buy milk"}' });
  });

  it("reads lists and empty answers", async () => {
    expect(await fetchNotes(fakeFetch(200, []).fetcher)).toEqual([]);
    expect(await deleteNote(1, fakeFetch(204).fetcher)).toBeUndefined();
  });

  it("turns a refusal into an ApiError with the API's message", async () => {
    await expect(createNote("", fakeFetch(400, { error: "title is required" }).fetcher)).rejects.toEqual(new ApiError(400, "title is required"));
  });
});
