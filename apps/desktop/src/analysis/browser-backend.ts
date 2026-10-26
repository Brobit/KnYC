// Chromium for the UI checks (#89, design/06 H4): whether it's downloaded, how big the download
// is, and the download itself, which only starts when the learner asks for it.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/settings";

export interface BrowserBackend {
  status(): Promise<{ installed: boolean }>;
  /** Bytes to download. */
  size(): Promise<{ bytes: number }>;
  install(): Promise<{ installed: boolean; error?: string }>;
}

export const tauriBrowser: BrowserBackend = {
  status: () => invoke("browser_status"),
  size: () => invoke("browser_size"),
  install: () => invoke("browser_install"),
};

/** The browser preview: a pretend download of a realistic size. */
export function fakeBrowser(installed = false): BrowserBackend {
  return {
    status: async () => ({ installed }),
    size: async () => ({ bytes: 112_400_000 }),
    install: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      installed = true;
      return { installed };
    },
  };
}

export const browserBackendFor = (): BrowserBackend => (isTauri() || !import.meta.env.DEV ? tauriBrowser : fakeBrowser());
