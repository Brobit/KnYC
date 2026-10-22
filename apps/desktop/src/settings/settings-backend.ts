// What Settings needs from Rust beyond settings.json: API keys in the OS keychain
// (src-tauri/src/keychain.rs) and the Claude Code CLI status (src-tauri/src/providers.rs).
// A plain browser (`pnpm dev`) gets an in-memory stand-in.
import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";
import { AiClient, AiError, type AiProvider } from "@knyc/core";
import { AppClaudeProvider } from "@/lib/claude-provider";
import { isTauri } from "@/lib/settings";

const testAnswer = z.object({ ok: z.literal(true) });

/** A real schema-validated call through the same AiClient the pipeline uses. */
export async function testClaudeCall(provider: AiProvider, model: string): Promise<number> {
  const role = { providerId: provider.id, model };
  const client = new AiClient({ providers: [provider], roles: { summaries: role, planning: role, lessons: role } });
  const started = Date.now();
  await client.generate({
    role: "summaries",
    system: "You check that KnYC can reach you. Answer with the JSON asked for, nothing else.",
    prompt: 'Reply with {"ok": true}.',
    schema: testAnswer,
    retries: 0,
    timeoutMs: 90_000,
  });
  return Date.now() - started;
}

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
  /** One tiny structured call with `model`: resolves to its duration in ms, rejects with an AiError. */
  testClaude(model: string): Promise<number>;
}

export function createTauriSettingsBackend(): SettingsBackend {
  return {
    saveKey: (keyRef, secret) => invoke("keychain_set", { keyRef, secret }),
    keyHint: (keyRef) => invoke("keychain_hint", { keyRef }),
    deleteKey: (keyRef) => invoke("keychain_delete", { keyRef }),
    claudeCli: () => invoke("claude_cli_status"),
    testClaude: (model) => testClaudeCall(new AppClaudeProvider(), model),
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
    async testClaude() {
      if (!claude.path) throw new AiError("unavailable", "Claude Code CLI not found");
      if (claude.loggedIn === false) throw new AiError("auth", "Claude Code is not logged in");
      return 900;
    },
  };
}

export const settingsBackend: SettingsBackend = isTauri() || !import.meta.env.DEV ? createTauriSettingsBackend() : createFakeSettingsBackend();
