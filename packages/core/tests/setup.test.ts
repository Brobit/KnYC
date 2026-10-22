import { describe, expect, it } from "vitest";
import { withNodeTypes } from "../src/index.ts";

const nodeTypes = { devDependencies: { "@types/node": "^26.6.5", typescript: "^7.0.2" } };

const golden = `{
  "compilerOptions": {
    "target": "ES2022",
    // Node's ESM resolution.
    "module": "NodeNext",
    "strict": true
  },
  "include": ["src"]
}
`;

describe("withNodeTypes", () => {
  it("names Node's types first in compilerOptions, keeping comments and layout", () => {
    expect(withNodeTypes(golden, nodeTypes)).toBe(`{
  "compilerOptions": {
    "types": ["node"],
    "target": "ES2022",
    // Node's ESM resolution.
    "module": "NodeNext",
    "strict": true
  },
  "include": ["src"]
}
`);
  });

  it("keeps Windows line endings and handles an empty compilerOptions", () => {
    expect(withNodeTypes(golden.replace(/\n/g, "\r\n"), nodeTypes)).toContain('"compilerOptions": {\r\n    "types": ["node"],\r\n    "target"');
    expect(withNodeTypes('{ "compilerOptions": {} }', nodeTypes)).toBe('{ "compilerOptions": { "types": ["node"] } }');
  });

  it("changes nothing when the project chose otherwise", () => {
    expect(withNodeTypes(golden, { dependencies: { express: "^5" } })).toBeNull(); // no @types/node
    expect(withNodeTypes(golden.replace('"strict": true', '"strict": true,\n    "types": ["vitest/globals"]'), nodeTypes)).toBeNull();
    expect(withNodeTypes(`{ "extends": "./base.json", "compilerOptions": {} }`, nodeTypes)).toBeNull();
    expect(withNodeTypes(`{ "include": ["src"] }`, nodeTypes)).toBeNull();
  });
});
