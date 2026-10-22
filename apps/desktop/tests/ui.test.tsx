import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@knyc/core/schemas";
import { HintLadder } from "@/components/knyc/checks";
import { PathProgress } from "@/components/knyc/progress";
import { loadSettings, SettingsProvider } from "@/lib/settings";
import { ThemeRoot, useTheme } from "@/lib/theme";

function ThemeProbe() {
  const { name, mode, resolvedMode, setName, setMode } = useTheme();
  return (
    <div>
      <span data-testid="state">{`${name}/${mode}/${resolvedMode}`}</span>
      <button onClick={() => setName("sage-camel")}>sage</button>
      <button onClick={() => setMode("dark")}>dark</button>
    </div>
  );
}

describe("theme", () => {
  it("applies the saved theme to <html> and saves changes", async () => {
    render(
      <SettingsProvider initial={defaultSettings()}>
        <ThemeRoot />
        <ThemeProbe />
      </SettingsProvider>,
    );
    // Default: Focus, following the OS (light in tests).
    expect(screen.getByTestId("state")).toHaveTextContent("focus/system/light");
    expect(document.documentElement.dataset).toMatchObject({ theme: "focus", mode: "light" });

    await userEvent.click(screen.getByText("sage"));
    await userEvent.click(screen.getByText("dark"));
    expect(document.documentElement.dataset).toMatchObject({ theme: "sage-camel", mode: "dark" });
    expect(JSON.parse(localStorage.getItem("knyc.settings")!).theme).toEqual({ name: "sage-camel", mode: "dark" });
  });
});

describe("loadSettings", () => {
  it("gives the defaults on first launch and for a corrupt file", async () => {
    expect((await loadSettings()).theme.name).toBe("focus");
    localStorage.setItem("knyc.settings", "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await loadSettings()).roles.planning.model).toBe("sonnet");
    expect(warn).toHaveBeenCalled();
  });

  it("reads back what was saved", async () => {
    localStorage.setItem("knyc.settings", JSON.stringify({ ...defaultSettings(), theme: { name: "sage-camel", mode: "light" } }));
    expect((await loadSettings()).theme).toEqual({ name: "sage-camel", mode: "light" });
  });
});

describe("HintLadder", () => {
  it("only lets the learner take the next hint", async () => {
    const onHint = vi.fn();
    render(<HintLadder used={1} onHint={onHint} />);
    expect(screen.getByRole("button", { name: "Hint 3" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Hint 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Hint 2" }));
    expect(onHint).toHaveBeenCalledExactlyOnceWith(2);
    expect(screen.getByRole("button", { name: "Reveal original" })).toBeEnabled();
  });
});

describe("PathProgress", () => {
  it("shows one segment per step and the position", async () => {
    await act(async () => {
      render(<PathProgress total={15} current={8} />);
    });
    const bar = screen.getByRole("progressbar");
    expect(bar.children).toHaveLength(15);
    expect(bar).toHaveAttribute("aria-valuenow", "8");
    expect(screen.getByText("Step 8 of 15")).toBeInTheDocument();
  });
});
