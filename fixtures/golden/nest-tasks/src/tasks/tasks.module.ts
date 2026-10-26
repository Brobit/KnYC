import { Module } from "@nestjs/common";
import { ApiKeyGuard } from "../auth/api-key.guard.js";
import { TasksController } from "./tasks.controller.js";
import { TasksRepository } from "./tasks.repository.js";
import { TasksService } from "./tasks.service.js";

@Module({
  controllers: [TasksController],
  providers: [TasksRepository, TasksService, ApiKeyGuard],
})
export class TasksModule {}
