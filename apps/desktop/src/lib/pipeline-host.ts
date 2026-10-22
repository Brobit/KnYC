// The pipeline host of the app (#55): `@knyc/core`'s `Host` backed by the Rust commands in
// src-tauri/src/pipeline. The CLI's NodeHost does the same with Node; the pipeline code is shared.
// Rust scopes every path: writes, git and runs inside the KnYC data folder, reads there and in
// project folders picked with `pickSourceFolder`.
import { invoke } from "@tauri-apps/api/core";
import { KnycSysError, type Host, type SysRequest } from "@knyc/core";

/** Rust rejects with a message string; the pipeline gets an Error like with the Node host. */
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export class TauriHost implements Host {
  readFile(path: string) {
    return call<string>("host_read_file", { path });
  }

  writeFile(path: string, content: string) {
    return call<void>("host_write_file", { path, content });
  }

  appendFile(path: string, content: string) {
    return call<void>("host_append_file", { path, content });
  }

  copyFile(from: string, to: string) {
    return call<void>("host_copy_file", { from, to });
  }

  remove(path: string) {
    return call<void>("host_remove", { path });
  }

  git(cwd: string, args: string[]) {
    return call<string>("host_git", { cwd, args });
  }

  async sys(request: SysRequest): Promise<unknown> {
    try {
      return await invoke("host_sys", { request });
    } catch (error) {
      throw new KnycSysError(String(error));
    }
  }
}

/** The folder the pipeline writes in: sandboxes, timelines and caches go under it. */
export const pipelineDataDir = () => invoke<string>("pipeline_data_dir");

/** Shows the folder dialog for a project to import; the folder becomes readable for the pipeline. Null when cancelled. */
export const pickSourceFolder = () => invoke<string | null>("pipeline_pick_source");
