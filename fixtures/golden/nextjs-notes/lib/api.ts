import type { Note } from "./types";

/** What the API answered when it refused a request. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`/api${path}`, { headers: { "content-type": "application/json" }, ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body.error ?? `the API answered ${response.status}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const fetchNotes = (fetcher?: typeof fetch) => call<Note[]>("/notes", undefined, fetcher);

export const createNote = (title: string, fetcher?: typeof fetch) => call<Note>("/notes", { method: "POST", body: JSON.stringify({ title }) }, fetcher);

export const setPinned = (id: number, pinned: boolean, fetcher?: typeof fetch) =>
  call<Note>(`/notes/${id}`, { method: "PATCH", body: JSON.stringify({ pinned }) }, fetcher);

export const deleteNote = (id: number, fetcher?: typeof fetch) => call<void>(`/notes/${id}`, { method: "DELETE" }, fetcher);
