// The Claude Code provider of the app (#56): the call runs in Rust (src-tauri/src/ai.rs), and its
// output is read by `interpretClaudeRun` from @knyc/core, like the CLI's ClaudeCliProvider, so
// both report the same errors (not installed, not logged in, usage limit, invalid output).
import { invoke } from "@tauri-apps/api/core";
import {
  AiClient,
  AiError,
  interpretClaudeRun,
  type AiCache,
  type AiProvider,
  type ProviderRequest,
  type ProviderResponse,
  type Settings,
} from "@knyc/core";

/** What `ai_claude_call` returns (ClaudeOutcome in ai.rs). */
export interface ClaudeOutcome {
  found: boolean;
  startError: string | null;
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export type ClaudeCaller = (call: { model: string; system: string; prompt: string; jsonSchema: Record<string, unknown>; timeoutMs: number }) => Promise<ClaudeOutcome>;

const tauriCaller: ClaudeCaller = (call) => invoke<ClaudeOutcome>("ai_claude_call", { call });

export class AppClaudeProvider implements AiProvider {
  readonly id = "claude-cli";

  private readonly caller: ClaudeCaller;

  constructor(caller: ClaudeCaller = tauriCaller) {
    this.caller = caller;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    let outcome: ClaudeOutcome;
    try {
      outcome = await this.caller(request);
    } catch (error) {
      // Rust refused the call itself (e.g. a malformed model name).
      throw new AiError("provider", `Claude Code call refused: ${String(error)}`);
    }
    if (!outcome.found) {
      throw new AiError("unavailable", "Claude Code CLI not found. Install it, then check again in Settings → AI providers.");
    }
    if (outcome.startError) throw new AiError("unavailable", `could not start Claude Code: ${outcome.startError}`);
    if (outcome.truncated) throw new AiError("provider", "Claude Code's answer was too large");
    return interpretClaudeRun(outcome, request.timeoutMs);
  }
}

/** Typed AI calls for the app, with each role's provider and model from Settings. */
export function createAppAiClient(settings: Settings, options: { cache?: AiCache; provider?: AiProvider } = {}): AiClient {
  return new AiClient({ providers: [options.provider ?? new AppClaudeProvider()], roles: settings.roles, cache: options.cache });
}
