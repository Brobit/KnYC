import { describe, expect, it } from "vitest";
import { parseNoteInput } from "../src/notes/notes.validation.js";
import { ValidationError } from "../src/errors.js";

describe("parseNoteInput", () => {
  it("accepts a full note and normalizes tags", () => {
    expect(parseNoteInput({ title: " Hi ", body: "b", tags: ["A", "a", "B"] }, 120)).toEqual({
      title: "Hi",
      body: "b",
      tags: ["a", "b"],
    });
  });

  it("defaults tags to an empty list", () => {
    expect(parseNoteInput({ title: "Hi", body: "" }, 120).tags).toEqual([]);
  });

  it("rejects a missing title and a long title", () => {
    expect(() => parseNoteInput({ body: "" }, 120)).toThrow(ValidationError);
    expect(() => parseNoteInput({ title: "x".repeat(10), body: "" }, 5)).toThrow(ValidationError);
  });

  it("allows partial input when patching", () => {
    expect(parseNoteInput({ body: "only body" }, 120, true)).toEqual({ body: "only body" });
  });
});
