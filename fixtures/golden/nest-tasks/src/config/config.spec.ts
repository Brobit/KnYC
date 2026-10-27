import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("uses defaults when the environment says nothing", () => {
    expect(loadConfig({})).toEqual({ port: 3000, apiKey: "dev-key", maxTitleLength: 80 });
  });

  it("reads the port, the key and the title limit from the environment", () => {
    expect(loadConfig({ PORT: "4100", API_KEY: "s3cret", MAX_TITLE_LENGTH: "20" })).toEqual({ port: 4100, apiKey: "s3cret", maxTitleLength: 20 });
  });

  it("ignores numbers that aren't positive integers", () => {
    expect(loadConfig({ PORT: "abc", MAX_TITLE_LENGTH: "-3" })).toMatchObject({ port: 3000, maxTitleLength: 80 });
  });
});
