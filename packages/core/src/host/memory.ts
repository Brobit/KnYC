// An in-memory host for tests: files in a Map, git and knyc-sys answered by the test. Records
// every git and knyc-sys call so tests can check what the pipeline asked for.

import type { Host, SysRequest } from "./host.ts";

export interface MemoryHostOptions {
  files?: Record<string, string>;
  git?: (cwd: string, args: string[]) => string | Promise<string>;
  sys?: (request: SysRequest) => unknown;
}

export class MemoryHost implements Host {
  readonly files: Map<string, string>;
  readonly gitCalls: { cwd: string; args: string[] }[] = [];
  readonly sysCalls: SysRequest[] = [];
  private readonly options: MemoryHostOptions;

  constructor(options: MemoryHostOptions = {}) {
    this.files = new Map(Object.entries(options.files ?? {}));
    this.options = options;
  }

  async readFile(path: string) {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`no such file: ${path}`);
    return content;
  }

  async writeFile(path: string, content: string) {
    this.files.set(path, content);
  }

  async appendFile(path: string, content: string) {
    this.files.set(path, (this.files.get(path) ?? "") + content);
  }

  async copyFile(from: string, to: string) {
    this.files.set(to, await this.readFile(from));
  }

  async remove(path: string) {
    for (const key of [...this.files.keys()]) if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
  }

  async git(cwd: string, args: string[]) {
    this.gitCalls.push({ cwd, args });
    return (await this.options.git?.(cwd, args)) ?? "";
  }

  async sys(request: SysRequest) {
    this.sysCalls.push(request);
    if (!this.options.sys) throw new Error(`no knyc-sys answer for ${request.op}`);
    return this.options.sys(request);
  }
}
