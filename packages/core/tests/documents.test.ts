import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CURRENT_VERSION,
  DocumentError,
  documents,
  jsonSchemaFor,
  learningPath,
  loadDocument,
  migrations,
  progress,
} from "../src/index.ts";
import { pathExample, progressExample } from "./examples.ts";

// Tests swap schemas in the registry to simulate future versions.
const registry = documents as unknown as Record<string, z.ZodType>;

describe("loadDocument", () => {
  afterEach(() => {
    CURRENT_VERSION.progress = 1;
    migrations.progress = {};
    registry.progress = progress;
  });

  it("parses a current document", () => {
    const doc = loadDocument("path", pathExample);
    expect(doc.steps).toHaveLength(2);
    expect(doc.steps[0]?.prep).toBe("planned");
  });

  it("refuses non-objects and missing versions", () => {
    expect(() => loadDocument("path", null)).toThrow(DocumentError);
    expect(() => loadDocument("path", [])).toThrow(/JSON object/);
    expect(() => loadDocument("path", { ...pathExample, schemaVersion: undefined })).toThrow(/schemaVersion/);
  });

  it("refuses documents written by a newer KnYC", () => {
    expect(() => loadDocument("path", { ...pathExample, schemaVersion: 2 })).toThrow(/newer than this KnYC/);
  });

  it("reports every issue with its path", () => {
    try {
      loadDocument("path", { ...pathExample, size: "huge", trackId: "mobile" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentError);
      const { issues } = error as DocumentError;
      expect(issues.some((i) => i.startsWith("size:"))).toBe(true);
      expect(issues.some((i) => i.startsWith("trackId:"))).toBe(true);
    }
  });

  it("runs migrations step by step up to the current version", () => {
    // Pretend progress is at v3: v1 used `active`, v2 renamed it, v3 added `note`.
    CURRENT_VERSION.progress = 3;
    registry.progress = progress.extend({ schemaVersion: z.literal(3), note: z.string() });
    migrations.progress[1] = ({ active, ...rest }) => ({ ...rest, activePathId: active, schemaVersion: 2 });
    migrations.progress[2] = (raw) => ({ ...raw, note: "migrated", schemaVersion: 3 });
    const { activePathId: _drop, ...v1 } = { ...progressExample, active: "backend-overview" };

    const doc = loadDocument("progress", v1) as unknown as { activePathId: string; note: string; schemaVersion: number };
    expect(doc).toMatchObject({ schemaVersion: 3, activePathId: "backend-overview", note: "migrated" });
  });

  it("fails clearly when a migration is missing", () => {
    CURRENT_VERSION.progress = 3;
    expect(() => loadDocument("progress", progressExample)).toThrow(/no migration for progress from schemaVersion 1/);
  });
});

describe("jsonSchemaFor", () => {
  it("describes a learning path for the AI", () => {
    const schema = jsonSchemaFor(learningPath);
    expect(schema.type).toBe("object");
    const properties = schema.properties as Record<string, { enum?: string[] }>;
    expect(properties.size?.enum).toEqual(["overview", "standard", "deep"]);
    expect(schema.required).toContain("steps");
    // Fields with defaults are optional for the producer.
    expect(schema.required).not.toContain("sharedUnits");
  });
});
