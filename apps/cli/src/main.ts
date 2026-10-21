#!/usr/bin/env node
// knyc: the KnYC command-line tool (M1). Runs on Node 22.18+ directly, without a build.

import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { AiError, KnycSysError, pathSize, trackId, type PathSize, type TrackId } from "@knyc/core";
import { analyze } from "./analyze.ts";

export const USAGE = `knyc: rebuild any project step by step

Usage:
  knyc analyze <folder> [options]

Options:
  --track <track>       frontend | backend | database | deployment | full (default: backend)
  --size <size>         overview | standard | deep (default: standard)
  --workspace <folder>  where .knyc/ is written (default: the project folder)
  --summaries <model>   model for summaries (default: haiku)
  --planning <model>    model for the learning path (default: sonnet)
  --checks <model>      model for generated checks (default: sonnet)
  -y, --yes             don't ask for confirmation after the estimate
  -h, --help            show this help

The AI runs through your Claude Code CLI (it must be installed and logged in).
The analysis cache lives in $KNYC_HOME or ~/.knyc.`;

export interface ParsedArgs {
  command: "analyze" | "help";
  folder?: string;
  track: TrackId;
  size: PathSize;
  workspace?: string;
  models: { summaries: string; planning: string; checks: string };
  yes: boolean;
}

export function parse(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      track: { type: "string", default: "backend" },
      size: { type: "string", default: "standard" },
      workspace: { type: "string" },
      summaries: { type: "string", default: "haiku" },
      planning: { type: "string", default: "sonnet" },
      checks: { type: "string", default: "sonnet" },
      yes: { type: "boolean", short: "y", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, folder, ...rest] = positionals;
  if (values.help || !command || command === "help") return { command: "help", track: "backend", size: "standard", models: { summaries: "", planning: "", checks: "" }, yes: false };
  if (command !== "analyze") throw new UsageError(`unknown command "${command}"`);
  if (!folder) throw new UsageError("missing the project folder: knyc analyze <folder>");
  if (rest.length > 0) throw new UsageError(`unexpected argument "${rest[0]}"`);
  const track = trackId.safeParse(values.track);
  if (!track.success) throw new UsageError(`--track must be one of ${trackId.options.join(", ")}`);
  const size = pathSize.safeParse(values.size);
  if (!size.success) throw new UsageError(`--size must be one of ${pathSize.options.join(", ")}`);
  return {
    command: "analyze",
    folder,
    track: track.data,
    size: size.data,
    workspace: values.workspace,
    models: { summaries: values.summaries!, planning: values.planning!, checks: values.checks! },
    yes: values.yes!,
  };
}

export class UsageError extends Error {}

/** Human messages for the errors a learner can do something about. */
export function explain(error: unknown): string {
  if (error instanceof UsageError) return `${error.message}\n\n${USAGE}`;
  if (error instanceof AiError) {
    const hint = {
      auth: "Log in to Claude Code: run `claude`, then /login.",
      limit: "Your Claude plan's usage limit is reached. Wait for it to reset, then run the same command again: finished stages come from the cache.",
      unavailable: "Install Claude Code (https://claude.com/claude-code), then try again.",
      timeout: "The AI took too long. Run the same command again: finished stages come from the cache.",
      "invalid-output": "The AI kept answering in the wrong shape. Try again, or with --planning opus.",
      provider: "Claude Code reported an error.",
    }[error.kind];
    return `${error.message}\n${hint}`;
  }
  if (error instanceof KnycSysError) return `${error.message}\nBuild it with: cargo build -p knyc-sys`;
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.command === "help") {
    console.log(USAGE);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await analyze(
      { folder: args.folder!, track: args.track, size: args.size, workspace: args.workspace, models: args.models, yes: args.yes },
      {
        log: (line) => console.log(line),
        confirm: async (question) => {
          try {
            return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
          } catch {
            // stdin already closed (a pipe, CI): no answer means no.
            console.log("\nNo answer (input closed). Run with --yes to skip the confirmation.");
            return false;
          }
        },
      },
    );
  } finally {
    rl.close();
  }
}

// Run only when executed (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`\nknyc: ${explain(error)}`);
    process.exit(1);
  });
}
