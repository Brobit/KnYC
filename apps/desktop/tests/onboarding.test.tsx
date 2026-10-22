import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type Settings } from "@knyc/core/schemas";
import { loadSettings, SettingsProvider } from "@/lib/settings";
import { Onboarding } from "@/screens/Onboarding";
import { createFakeSettingsBackend, type ClaudeCliStatus, type SettingsBackend } from "@/settings/settings-backend";

const LOGGED_IN: ClaudeCliStatus = { path: "/usr/local/bin/claude", version: "2.1.0", loggedIn: true };

function renderOnboarding(backend: SettingsBackend = createFakeSettingsBackend(), initial: Settings = defaultSettings()) {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(
    <SettingsProvider initial={initial}>
      <Onboarding onDone={onDone} backend={backend} />
    </SettingsProvider>,
  );
  return { user, onDone };
}

const heading = () => screen.getByRole("heading", { level: 1 });
const next = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /Continue/ }));

afterEach(() => vi.restoreAllMocks());

describe("Onboarding", () => {
  it("starts with Welcome, which can't be skipped", () => {
    renderOnboarding();
    expect(heading()).toHaveTextContent("Welcome to KnYC");
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "How learning with KnYC works" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set up later" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back/ })).not.toBeInTheDocument();
  });

  it("can be skipped from the second card, and records it", async () => {
    const { user, onDone } = renderOnboarding();
    await next(user);
    expect(heading()).toHaveTextContent("Connect an AI");
    await user.click(screen.getByRole("button", { name: "Set up later" }));
    expect(onDone).toHaveBeenCalledOnce();
    await waitFor(async () => expect((await loadSettings()).onboardedAt).toMatch(/^\d{4}-\d\d-\d\dT/));
  });

  it("shows Claude Code ready, with a working test call and the role models", async () => {
    const { user } = renderOnboarding(createFakeSettingsBackend(LOGGED_IN));
    await next(user);
    const claude = screen.getByRole("status", { name: "Claude Code" });
    expect(await within(claude).findByText("Claude Code v2.1.0 · logged in")).toBeInTheDocument();
    await user.click(within(claude).getByRole("button", { name: /Test/ }));
    expect(await within(claude).findByText("Claude Code answered with haiku in 0.9 s.")).toBeInTheDocument();
    // The three roles, with their defaults.
    for (const role of ["Summaries", "Planning", "Lessons & hints"]) expect(screen.getByRole("heading", { name: role })).toBeInTheDocument();
    expect(screen.getByDisplayValue("haiku")).toBeInTheDocument();
  });

  it("says how to fix a missing or logged-out Claude Code", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { user } = renderOnboarding(createFakeSettingsBackend({ path: null, version: null, loggedIn: null }));
    await next(user);
    const claude = screen.getByRole("status", { name: "Claude Code" });
    expect(await within(claude).findByText(/Claude Code isn’t installed/)).toBeInTheDocument();
    expect(within(claude).getByRole("button", { name: /Test/ })).toBeDisabled();
    await user.click(within(claude).getByRole("button", { name: /Install Claude Code/ }));
    expect(open).toHaveBeenCalledWith("https://docs.claude.com/en/docs/claude-code/setup", "_blank", "noopener");
  });

  it("explains how to log in", async () => {
    const { user } = renderOnboarding(createFakeSettingsBackend({ ...LOGGED_IN, loggedIn: false }));
    await next(user);
    expect(await screen.findByText(/not logged in. Open a terminal, run claude, then type \/login/)).toBeInTheDocument();
  });

  it("lists toolchains with versions or an install link, and finishes", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { user, onDone } = renderOnboarding();
    await next(user);
    await next(user);
    expect(heading()).toHaveTextContent("Toolchains");
    const needed = screen.getByRole("list", { name: "Needed now" });
    expect(await within(needed).findByText("22.23.2")).toBeInTheDocument();
    const git = within(needed).getByRole("listitem", { name: "Git" });
    expect(within(git).getByText("Not found")).toBeInTheDocument();
    await user.click(within(git).getByRole("button", { name: "Install Git" }));
    expect(open).toHaveBeenCalledWith("https://git-scm.com/downloads", "_blank", "noopener");
    const later = screen.getByRole("list", { name: "Later stacks (not needed yet)" });
    expect(within(later).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["Docker", "Python", "Go", ".NET"]);

    // The last card has no "Set up later": its button finishes.
    expect(screen.queryByRole("button", { name: "Set up later" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Start using KnYC/ }));
    expect(onDone).toHaveBeenCalledOnce();
    await waitFor(async () => expect((await loadSettings()).onboardedAt).toBeDefined());
  });

  it("goes back to the previous card", async () => {
    const { user } = renderOnboarding();
    await next(user);
    await user.click(screen.getByRole("button", { name: /Back/ }));
    expect(heading()).toHaveTextContent("Welcome to KnYC");
  });
});

describe("first launch", () => {
  it("opens on onboarding only until it was done once", async () => {
    const { default: App } = await import("@/App");
    const { unmount } = render(
      <SettingsProvider initial={defaultSettings()}>
        <App />
      </SettingsProvider>,
    );
    expect(heading()).toHaveTextContent("Welcome to KnYC");
    unmount();

    render(
      <SettingsProvider initial={{ ...defaultSettings(), onboardedAt: "2026-10-22T14:00:00.000Z" }}>
        <App />
      </SettingsProvider>,
    );
    expect(screen.queryByRole("heading", { name: "Connect an AI" })).not.toBeInTheDocument();
    expect(screen.queryByText("Step 1 of 3")).not.toBeInTheDocument();
  });
});
