// What the learning screens need from the system (#62): the workspace folder as core's
// WorkspaceFiles, and a check runner (src-tauri `workspace_check_run`). A plain browser (`pnpm dev`)
// gets a pretend runner: a demo check passes once the file it names has code.
import { invoke } from "@tauri-apps/api/core";
import type { CheckCommand, CheckOutcome, LearnerFiles, WorkspaceFiles } from "@knyc/core";
import { DEMO_REQUIRES } from "@/jobs/demo-jobs";
import { isTauri } from "@/lib/settings";
import { WorkspaceFsError, type WorkspaceFs } from "@/lib/workspace-fs";

export type RunCheckCommand = (request: CheckCommand) => Promise<CheckOutcome>;

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** The open folder for core: `write` creates the folders it needs. */
export function workspaceFiles(fs: WorkspaceFs): WorkspaceFiles {
  const ensureDir = async (dir: string): Promise<void> => {
    if (!dir || (await fs.exists(dir))) return;
    await ensureDir(parentOf(dir));
    await fs.createDir(dir).catch((error: unknown) => {
      if (!(error instanceof WorkspaceFsError && error.kind === "alreadyExists")) throw error;
    });
  };
  return {
    read: (path) => fs.read(path),
    write: async (path, content) => {
      await ensureDir(parentOf(path));
      await fs.write(path, content);
    },
    remove: (path) => fs.delete(path),
    exists: (path) => fs.exists(path),
  };
}

export const tauriCheckRun: RunCheckCommand = (request) => invoke<CheckOutcome>("workspace_check_run", { request });

/** The learner's files and other text as they may go to the AI: through the secret guard. */
export type ReadForAi = (paths: string[], texts: string[]) => Promise<{ files: LearnerFiles; texts: string[] }>;

export const tauriReadForAi: ReadForAi = async (paths, texts) => {
  const out = await invoke<{ files: { path: string; content: string | null }[]; texts: string[] }>("workspace_read_for_ai", { paths, texts });
  return { files: new Map(out.files.map((f) => [f.path, f.content])), texts: out.texts };
};

/** The browser preview's sample project has no secrets: files are read as they are. */
export function fakeReadForAi(fs: WorkspaceFs): ReadForAi {
  return async (paths, texts) => {
    const files: LearnerFiles = new Map();
    for (const path of paths) files.set(path, (await fs.exists(path)) ? await fs.read(path).catch(() => null) : null);
    return { files, texts };
  };
}

export const readForAiFor = (fs: WorkspaceFs): ReadForAi => (isTauri() || !import.meta.env.DEV ? tauriReadForAi : fakeReadForAi(fs));

const outcome = (pass: boolean, text: string): CheckOutcome => ({
  status: pass ? "pass" : "fail",
  run: { exitCode: pass ? 0 : 1, timedOut: false, durationMs: 300, stdout: pass ? text : "", stderr: pass ? "" : text, truncated: false },
});

/** The browser preview's runner: installs and builds pass; a demo check needs its file to have code. */
export function fakeCheckRun(fs: WorkspaceFs): RunCheckCommand {
  const files = workspaceFiles(fs);
  return async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (request.command.includes("install")) {
      await files.write("node_modules/.package-lock.json", "{}");
      return outcome(true, "added 64 packages (browser preview)");
    }
    if (!request.command.startsWith("node --test ")) return outcome(true, `${request.command}: ok (browser preview)`);
    const first = (await fs.read(request.command.slice("node --test ".length))).split("\n")[0] ?? "";
    const required = first.startsWith(DEMO_REQUIRES) ? first.slice(DEMO_REQUIRES.length).trim() : null;
    if (!required) return outcome(true, "ok");
    const code = (await fs.exists(required)) ? (await fs.read(required)).trim() : "";
    return code
      ? outcome(true, `✔ ${required} has its code (browser preview)`)
      : outcome(false, `✖ ${required} is missing or empty\n  AssertionError: expected ${required} to export the step's code`);
  };
}

export const checkRunFor = (fs: WorkspaceFs): RunCheckCommand => (isTauri() || !import.meta.env.DEV ? tauriCheckRun : fakeCheckRun(fs));
