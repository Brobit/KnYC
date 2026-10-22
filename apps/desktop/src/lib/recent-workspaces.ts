// workspaces.json: the folders opened lately (Home screen). Same storage as settings.json:
// the app's config folder in the desktop app, localStorage in a plain browser.
import { invoke } from "@tauri-apps/api/core";
import { emptyWorkspaces, loadDocument, type Workspaces } from "@knyc/core/schemas";
import { isTauri } from "./settings";

export interface RecentStore {
  load(): Promise<Workspaces>;
  save(doc: Workspaces): Promise<void>;
}

const BROWSER_KEY = "knyc.workspaces";

export const recentStore: RecentStore = {
  /** An unreadable file gives an empty list, never a crash. */
  async load() {
    try {
      const raw = isTauri() ? await invoke<string | null>("workspaces_read") : localStorage.getItem(BROWSER_KEY);
      return raw ? loadDocument("workspaces", JSON.parse(raw)) : emptyWorkspaces();
    } catch (error) {
      console.warn("workspaces.json is unreadable; starting with no recent workspaces", error);
      return emptyWorkspaces();
    }
  },
  async save(doc) {
    const json = JSON.stringify(doc, null, 2);
    if (isTauri()) await invoke("workspaces_write", { json });
    else localStorage.setItem(BROWSER_KEY, json);
  },
};

/** For tests: starts with `initial`, keeps what is saved. */
export function createMemoryRecentStore(initial: Workspaces = emptyWorkspaces()): RecentStore & { saved: Workspaces } {
  const store = {
    saved: initial,
    load: async () => store.saved,
    save: async (doc: Workspaces) => {
      store.saved = doc;
    },
  };
  return store;
}
