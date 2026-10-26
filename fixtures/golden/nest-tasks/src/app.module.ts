import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { HealthController } from "./health/health.controller.js";
import { TasksModule } from "./tasks/tasks.module.js";

@Module({
  imports: [ConfigModule, TasksModule],
  controllers: [HealthController],
})
export class AppModule {}
