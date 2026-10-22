// What Settings needs from Rust beyond settings.json: API keys in the OS keychain
// (src-tauri/src/keychain.rs) and the Claude Code CLI status (src-tauri/src/providers.rs).
// A plain browser (`pnpm dev`) gets an in-memory stand-in.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/settings";

export interface ClaudeCliStatus {
  /** null when Claude Code is not installed. */
  path: string | null;
  version: string | null;
  /** null when unknown. */
  loggedIn: boolean | null;
}

export interface SettingsBackend {
  /** Saves the key under `keyRef` and returns its masked hint ("sk-ant-••••••••Q4mA"). */
  saveKey(keyRef: string, secret: string): Promise<string>;
  /** The masked hint of the saved key, or null. The key itself never reaches the frontend. */
  keyHint(keyRef: string): Promise<string | null>;
  deleteKey(keyRef: string): Promise<void>;
  claudeCli(): Promise<ClaudeCliStatus>;
}

export function createTauriSettingsBackend(): SettingsBackend {
  return {
    saveKey: (keyRef, secret) => invoke("keychain_set", { keyRef, secret }),
    keyHint: (keyRef) => invoke("keychain_hint", { keyRef }),
    deleteKey: (keyRef) => invoke("keychain_delete", { keyRef }),
    claudeCli: () => invoke("claude_cli_status"),
  };
}

/** Same masking as keychain.rs. */
export function maskKey(secret: string): string {
  const dots = "••••••••";
  const chars = [...secret];
  if (chars.length < 16) return dots;
  const head = chars.slice(0, 8).join("");
  const prefix = head.slice(0, head.lastIndexOf("-") + 1);
  return `${prefix}${dots}${chars.slice(-4).join("")}`;
}

export function createFakeSettingsBackend(claude: ClaudeCliStatus = { path: "/usr/local/bin/claude", version: "2.1.0", loggedIn: true }): SettingsBackend {
  const keys = new Map<string, string>();
  return {
    async saveKey(keyRef, secret) {
      const trimmed = secret.trim();
      if (!trimmed) throw new Error("the key is empty");
      keys.set(keyRef, trimmed);
      return maskKey(trimmed);
    },
    async keyHint(keyRef) {
      const secret = keys.get(keyRef);
      return secret === undefined ? null : maskKey(secret);
    },
    async deleteKey(keyRef) {
      keys.delete(keyRef);
    },
    async claudeCli() {
      return claude;
    },
  };
}

export const settingsBackend: SettingsBackend = isTauri() || !import.meta.env.DEV ? createTauriSettingsBackend() : createFakeSettingsBackend();
