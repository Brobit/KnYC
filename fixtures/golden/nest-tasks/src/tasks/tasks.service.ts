import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { NEXT_STATUSES, Task, TaskStatus } from "./task.entity.js";
import { TasksRepository } from "./tasks.repository.js";

@Injectable()
export class TasksService {
  constructor(
    private readonly repository: TasksRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  create(title: string): Task {
    const trimmed = title.trim();
    if (trimmed.length > this.config.maxTitleLength) {
      throw new BadRequestException(`title is longer than ${this.config.maxTitleLength} characters`);
    }
    return this.repository.create(trimmed);
  }

  list(status?: TaskStatus): Task[] {
    return this.repository.findAll(status);
  }

  get(id: number): Task {
    const task = this.repository.findById(id);
    if (!task) throw new NotFoundException(`task ${id} not found`);
    return task;
  }

  /** Moves a task to another status; a done task can't move again. */
  move(id: number, status: TaskStatus): Task {
    const task = this.get(id);
    if (task.status === status) return task;
    if (!NEXT_STATUSES[task.status].includes(status)) {
      throw new BadRequestException(`a ${task.status} task can't become ${status}`);
    }
    return this.repository.updateStatus(id, status)!;
  }

  remove(id: number): void {
    if (!this.repository.remove(id)) throw new NotFoundException(`task ${id} not found`);
  }
}
