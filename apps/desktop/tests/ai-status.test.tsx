import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultSettings, type Settings } from "@knyc/core/schemas";
import { SettingsProvider } from "@/lib/settings";
import { useAiStatus } from "@/settings/ai-status";
import { withoutProvider, withProvider } from "@/settings/providers";
import { createFakeSettingsBackend, type ClaudeCliStatus, type SettingsBackend } from "@/settings/settings-backend";

function Status({ backend }: { backend: SettingsBackend }) {
  const { label, ok, problem } = useAiStatus(backend);
  return <p data-testid="status">{`${label} | ${ok ? "ok" : "warning"} | ${problem ?? ""}`}</p>;
}

function renderStatus(settings: Settings, backend: SettingsBackend) {
  render(
    <SettingsProvider initial={settings}>
      <Status backend={backend} />
    </SettingsProvider>,
  );
  return screen.getByTestId("status");
}

const cli = (status: ClaudeCliStatus) => createFakeSettingsBackend(status);

describe("AI status", () => {
  it("is ready when Claude Code is installed and logged in", async () => {
    const status = renderStatus(defaultSettings(), cli({ path: "/bin/claude", version: "2.1.0", loggedIn: true }));
    expect(status).toHaveTextContent("Claude Code · sonnet | ok |");
  });

  it.each<[string, ClaudeCliStatus, string]>([
    ["missing", { path: null, version: null, loggedIn: null }, "Claude Code was not found."],
    ["logged out", { path: "/bin/claude", version: "2.1.0", loggedIn: false }, "Claude Code is not logged in"],
  ])("warns when Claude Code is %s", async (_, cliStatus, problem) => {
    const status = renderStatus(defaultSettings(), cli(cliStatus));
    expect(await screen.findByText(new RegExp(`warning \\| ${problem}`))).toBe(status);
  });

  const anthropic = { id: "anthropic", type: "anthropic" as const, label: "Anthropic", keyRef: "anthropic-api-key" };
  const withAnthropic = withProvider(defaultSettings(), anthropic);
  const anthropicPlanning = { ...withAnthropic, roles: { ...withAnthropic.roles, planning: { providerId: "anthropic", model: "claude-opus-5-5" } } };

  it("warns when an API provider has no key", async () => {
    const status = renderStatus(anthropicPlanning, createFakeSettingsBackend());
    expect(await screen.findByText(/warning \| No API key saved/)).toBe(status);
  });

  it("is ready when the API key is in the keychain", async () => {
    const backend = createFakeSettingsBackend();
    await backend.saveKey("anthropic-api-key", "sk-ant-api03-abcdefghijklmnop");
    expect(renderStatus(anthropicPlanning, backend)).toHaveTextContent("Anthropic · claude-opus-5-5 | ok |");
  });

  it("says so when the planning provider is gone", () => {
    const status = renderStatus(withoutProvider(defaultSettings(), "claude-cli"), createFakeSettingsBackend());
    expect(status).toHaveTextContent("No AI set up | warning | Pick a provider for planning in Settings.");
  });
});
