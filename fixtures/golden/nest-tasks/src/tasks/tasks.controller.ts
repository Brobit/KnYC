import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "../auth/api-key.guard.js";
import { CreateTaskPipe, MoveTaskPipe, type CreateTaskDto, type MoveTaskDto } from "./dto/create-task.dto.js";
import { TASK_STATUSES, TaskStatus } from "./task.entity.js";
import { TasksService } from "./tasks.service.js";

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Query("status") status?: string) {
    return this.tasks.list(TASK_STATUSES.includes(status as TaskStatus) ? (status as TaskStatus) : undefined);
  }

  @Get(":id")
  get(@Param("id", ParseIntPipe) id: number) {
    return this.tasks.get(id);
  }

  @Post()
  @UseGuards(ApiKeyGuard)
  create(@Body(new CreateTaskPipe()) body: CreateTaskDto) {
    return this.tasks.create(body.title);
  }

  @Patch(":id/status")
  @UseGuards(ApiKeyGuard)
  move(@Param("id", ParseIntPipe) id: number, @Body(new MoveTaskPipe()) body: MoveTaskDto) {
    return this.tasks.move(id, body.status);
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(ApiKeyGuard)
  remove(@Param("id", ParseIntPipe) id: number) {
    this.tasks.remove(id);
  }
}
