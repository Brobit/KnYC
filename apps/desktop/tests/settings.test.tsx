import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "@knyc/core/schemas";
import { loadSettings, SettingsProvider } from "@/lib/settings";
import { withoutProvider, withProvider } from "@/settings/providers";
import { createFakeSettingsBackend, maskKey, type ClaudeCliStatus, type SettingsBackend } from "@/settings/settings-backend";
import { SettingsScreen } from "@/settings/SettingsScreen";

const KEY = "sk-ant-api03-abcdefghijklmnopQ4mA";

/** What the app would read at its next launch (in a plain browser, settings.json is localStorage). */
const saved = () => loadSettings();

function renderSettings({ backend = createFakeSettingsBackend(), initial = defaultSettings() }: { backend?: SettingsBackend; initial?: Settings } = {}) {
  const user = userEvent.setup();
  render(
    <SettingsProvider initial={initial}>
      <SettingsScreen backend={backend} />
    </SettingsProvider>,
  );
  return { user, backend };
}

const row = (name: string) => screen.getByRole("listitem", { name });

describe("maskKey", () => {
  it("keeps the provider prefix and the last 4 characters, like keychain.rs", () => {
    expect(maskKey(KEY)).toBe("sk-ant-••••••••Q4mA");
    expect(maskKey("AIzaSyA1234567890abcdWXYZ")).toBe("••••••••WXYZ");
    expect(maskKey("short")).toBe("••••••••");
  });
});

describe("provider changes", () => {
  it("adds, replaces in place and removes providers", () => {
    const base = defaultSettings();
    const added = withProvider(base, { id: "ollama", type: "ollama", label: "Ollama", baseUrl: "http://localhost:11434" });
    expect(added.providers.map((p) => p.id)).toEqual(["claude-cli", "ollama"]);
    const replaced = withProvider(added, { id: "claude-cli", type: "claude-cli", label: "Claude" });
    expect(replaced.providers.map((p) => p.label)).toEqual(["Claude", "Ollama"]);
    expect(withoutProvider(replaced, "claude-cli").providers.map((p) => p.id)).toEqual(["ollama"]);
  });
});

describe("Settings · API keys", () => {
  it("saves a key to the keychain, keeps only its name in settings, and removes it", async () => {
    const { user, backend } = renderSettings();
    const anthropic = row("Anthropic");
    await user.click(await within(anthropic).findByRole("button", { name: "Add key" }));
    await user.type(within(anthropic).getByLabelText("Anthropic API key"), KEY);
    await user.click(within(anthropic).getByRole("button", { name: "Save" }));

    expect(await within(anthropic).findByText("sk-ant-••••••••Q4mA")).toBeInTheDocument();
    expect(within(anthropic).getByText("Connected")).toBeInTheDocument();
    expect(await backend.keyHint("anthropic-api-key")).toBe("sk-ant-••••••••Q4mA");
    await waitFor(async () =>
      expect((await saved()).providers).toContainEqual({ id: "anthropic", type: "anthropic", label: "Anthropic", keyRef: "anthropic-api-key" }),
    );
    expect(localStorage.getItem("knyc.settings")).not.toContain(KEY);

    await user.click(within(anthropic).getByRole("button", { name: "Remove the Anthropic key" }));
    await user.click(await screen.findByRole("button", { name: "Remove key" }));
    expect(await within(anthropic).findByRole("button", { name: "Add key" })).toBeInTheDocument();
    expect(await backend.keyHint("anthropic-api-key")).toBeNull();
    await waitFor(async () => expect((await saved()).providers.map((p) => p.id)).toEqual(["claude-cli"]));
  });

  it("shows a key saved in an earlier session", async () => {
    const backend = createFakeSettingsBackend();
    await backend.saveKey("openai-api-key", "sk-proj-1234567890abcdefWXYZ");
    const initial = withProvider(defaultSettings(), { id: "openai", type: "openai", label: "OpenAI", keyRef: "openai-api-key" });
    renderSettings({ backend, initial });
    expect(await within(row("OpenAI")).findByText("sk-proj-••••••••WXYZ")).toBeInTheDocument();
  });

  it("shows keychain errors and keeps settings unchanged", async () => {
    const failing: SettingsBackend = { ...createFakeSettingsBackend(), saveKey: () => Promise.reject("keychain unavailable: locked") };
    const { user } = renderSettings({ backend: failing });
    const google = row("Google Gemini");
    await user.click(await within(google).findByRole("button", { name: "Add key" }));
    await user.type(within(google).getByLabelText("Google Gemini API key"), "AIza-whatever-key{Enter}");
    expect(await within(google).findByText("keychain unavailable: locked")).toBeInTheDocument();
    expect(localStorage.getItem("knyc.settings")).toBeNull();
  });
});

describe("Settings · local providers", () => {
  it("sets the Ollama URL and refuses an invalid one", async () => {
    const { user } = renderSettings();
    const ollama = row("Ollama");
    await user.click(within(ollama).getByRole("button", { name: "Add" }));
    const url = within(ollama).getByLabelText("Ollama server URL");
    expect(url).toHaveValue("http://localhost:11434");
    await user.clear(url);
    await user.type(url, "localhost");
    expect(within(ollama).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(url);
    await user.type(url, "http://192.168.1.20:11434{Enter}");
    expect(await within(ollama).findByText("http://192.168.1.20:11434")).toBeInTheDocument();
    await waitFor(async () => expect((await saved()).providers.find((p) => p.id === "ollama")?.baseUrl).toBe("http://192.168.1.20:11434"));
  });

  it.each<[string, ClaudeCliStatus, string]>([
    ["logged in", { path: "/bin/claude", version: "2.1.272", loggedIn: true }, "v2.1.272 · logged in"],
    ["logged out", { path: "/bin/claude", version: "2.1.272", loggedIn: false }, "v2.1.272 · not logged in: run claude, then /login"],
    ["missing", { path: null, version: null, loggedIn: null }, "Not found. Install Claude Code, then check again."],
  ])("shows Claude Code %s", async (_, status, text) => {
    renderSettings({ backend: createFakeSettingsBackend(status) });
    expect(await within(row("Claude Code")).findByText(text)).toBeInTheDocument();
  });

  it("disables and enables Claude Code", async () => {
    const { user } = renderSettings();
    const claude = row("Claude Code");
    await user.click(within(claude).getByRole("button", { name: "Disable" }));
    await waitFor(async () => expect((await saved()).providers).toEqual([]));
    await user.click(within(claude).getByRole("button", { name: "Enable" }));
    await waitFor(async () => expect((await saved()).providers.map((p) => p.id)).toEqual(["claude-cli"]));
  });
});

describe("Settings · model roles", () => {
  it("switches a role to another provider with its first suggested model", async () => {
    const initial = withProvider(defaultSettings(), { id: "anthropic", type: "anthropic", label: "Anthropic", keyRef: "anthropic-api-key" });
    const { user } = renderSettings({ initial });
    const planning = screen.getByRole("region", { name: "Planning" });
    await user.selectOptions(within(planning).getByLabelText("Provider"), "anthropic");
    expect(within(planning).getByLabelText("Model")).toHaveValue("claude-haiku-5-5");
    await waitFor(async () => expect((await saved()).roles.planning).toEqual({ providerId: "anthropic", model: "claude-haiku-5-5" }));
  });

  it("never saves an empty model", async () => {
    const { user } = renderSettings();
    const lessons = screen.getByRole("region", { name: "Lessons & hints" });
    const model = within(lessons).getByLabelText("Model");
    await user.clear(model);
    expect(within(lessons).getByText("Enter a model name.")).toBeInTheDocument();
    await user.type(model, "opus");
    await waitFor(async () => expect((await saved()).roles.lessons.model).toBe("opus"));
    await user.clear(model);
    expect((await saved()).roles.lessons.model).toBe("opus");
  });

  it("flags a role whose provider was removed", async () => {
    const { user } = renderSettings();
    await user.click(within(row("Claude Code")).getByRole("button", { name: "Disable" }));
    const summaries = screen.getByRole("region", { name: "Summaries" });
    expect(within(summaries).getByText("This provider is not set up any more. Pick another one.")).toBeInTheDocument();
    expect(within(summaries).getByLabelText("Provider")).toHaveDisplayValue("claude-cli (not set up)");
  });
});

describe("Settings · editor and appearance", () => {
  it("saves valid editor sizes only", async () => {
    const { user } = renderSettings();
    await user.click(screen.getByRole("button", { name: "Editor" }));
    const fontSize = screen.getByLabelText("Font size");
    await user.clear(fontSize);
    await user.type(fontSize, "40");
    expect(fontSize).toBeInvalid();
    expect((await saved()).editor.fontSize).toBe(13);
    await user.clear(fontSize);
    await user.type(fontSize, "16");
    await waitFor(async () => expect((await saved()).editor.fontSize).toBe(16));

    await user.clear(screen.getByLabelText("Tab size"));
    await user.type(screen.getByLabelText("Tab size"), "4");
    await waitFor(async () => expect((await saved()).editor).toEqual({ fontSize: 16, tabSize: 4, vimMode: false }));
  });

  it("changes the theme", async () => {
    const { user } = renderSettings();
    await user.click(screen.getByRole("button", { name: "Appearance" }));
    await user.click(screen.getByRole("radio", { name: "Sage & Camel" }));
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    await waitFor(async () => expect((await saved()).theme).toEqual({ name: "sage-camel", mode: "dark" }));
  });
});
