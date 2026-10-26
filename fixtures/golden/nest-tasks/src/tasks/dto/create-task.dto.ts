import { BadRequestException, PipeTransform } from "@nestjs/common";
import { TASK_STATUSES, TaskStatus } from "../task.entity.js";

export interface CreateTaskDto {
  title: string;
}

export interface MoveTaskDto {
  status: TaskStatus;
}

/** Checks a request body is { title: non-empty string } before the controller sees it. */
export class CreateTaskPipe implements PipeTransform<unknown, CreateTaskDto> {
  transform(value: unknown): CreateTaskDto {
    const title = (value as { title?: unknown } | null)?.title;
    if (typeof title !== "string" || title.trim() === "") {
      throw new BadRequestException("title must be a non-empty string");
    }
    return { title };
  }
}

/** Checks a request body is { status: "todo" | "doing" | "done" }. */
export class MoveTaskPipe implements PipeTransform<unknown, MoveTaskDto> {
  transform(value: unknown): MoveTaskDto {
    const status = (value as { status?: unknown } | null)?.status;
    if (!TASK_STATUSES.includes(status as TaskStatus)) {
      throw new BadRequestException(`status must be one of ${TASK_STATUSES.join(", ")}`);
    }
    return { status: status as TaskStatus };
  }
}
