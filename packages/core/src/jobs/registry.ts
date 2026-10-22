// The jobs KnYC knows about (#57): `<data>/jobs/index.json` lists them, `<data>/jobs/<id>.json`
// holds each one's state. The app reads it at start to go on with unfinished analyses.

import { joinPath, type Host } from "../host/host.ts";
import { loadDocument } from "../schemas/documents.ts";
import type { Job, Jobs } from "../schemas/job.ts";

export class JobRegistry {
  private readonly host: Host;
  private readonly dir: string;
  /** Index changes run one after the other, each from the saved file. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(host: Host, dataDir: string) {
    this.host = host;
    this.dir = joinPath(dataDir, "jobs");
  }

  statePath(id: string): string {
    return joinPath(this.dir, `${id}.json`);
  }

  private get indexPath() {
    return joinPath(this.dir, "index.json");
  }

  private async readIndex(): Promise<Jobs> {
    try {
      return loadDocument("jobs", JSON.parse(await this.host.readFile(this.indexPath)));
    } catch {
      return { schemaVersion: 1, ids: [] };
    }
  }

  private changeIndex(change: (ids: string[]) => string[]): Promise<void> {
    const next = this.queue.then(async () => {
      const index = await this.readIndex();
      await this.host.writeFile(this.indexPath, JSON.stringify({ ...index, ids: change(index.ids) }));
    });
    this.queue = next.catch(() => {});
    return next;
  }

  async load(id: string): Promise<Job> {
    return loadDocument("job", JSON.parse(await this.host.readFile(this.statePath(id))));
  }

  /** Every readable job, oldest first. A job file that can't be read is skipped. */
  async list(): Promise<Job[]> {
    const { ids } = await this.readIndex();
    const loaded = await Promise.all(ids.map((id) => this.load(id).catch(() => null)));
    return loaded.filter((job): job is Job => job !== null);
  }

  async add(job: Job): Promise<void> {
    await this.host.writeFile(this.statePath(job.id), JSON.stringify(job, null, 2));
    await this.changeIndex((ids) => [...ids.filter((id) => id !== job.id), job.id]);
  }

  /** Forgets the job (its cached results stay, for a later analysis of the same code). */
  async remove(id: string): Promise<void> {
    await this.changeIndex((ids) => ids.filter((other) => other !== id));
    await this.host.remove(this.statePath(id));
  }
}
