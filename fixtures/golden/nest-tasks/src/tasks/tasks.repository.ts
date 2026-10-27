import { Injectable } from "@nestjs/common";
import { Task, TaskStatus } from "./task.entity.js";

/** Where tasks are kept: in memory, behind the methods a database repository would have. */
@Injectable()
export class TasksRepository {
  private readonly tasks = new Map<number, Task>();
  private nextId = 1;

  create(title: string, now: Date = new Date()): Task {
    const task: Task = { id: this.nextId++, title, status: "todo", createdAt: now.toISOString() };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  findAll(status?: TaskStatus): Task[] {
    return [...this.tasks.values()].filter((t) => !status || t.status === status).map((t) => ({ ...t }));
  }

  findById(id: number): Task | undefined {
    const task = this.tasks.get(id);
    return task && { ...task };
  }

  updateStatus(id: number, status: TaskStatus): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    task.status = status;
    return { ...task };
  }

  remove(id: number): boolean {
    return this.tasks.delete(id);
  }
}
