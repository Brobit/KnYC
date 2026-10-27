import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config/config.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  const { port } = loadConfig();
  await app.listen(port);
  console.log(`nest-tasks listening on http://localhost:${port}`);
}

await bootstrap();
