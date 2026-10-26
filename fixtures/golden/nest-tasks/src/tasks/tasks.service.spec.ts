import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_CONFIG } from "../config/config.js";
import { CreateTaskPipe, MoveTaskPipe } from "./dto/create-task.dto.js";
import { TasksRepository } from "./tasks.repository.js";
import { TasksService } from "./tasks.service.js";

describe("TasksRepository", () => {
  it("numbers tasks from 1 and starts them as todo", () => {
    const repository = new TasksRepository();
    const now = new Date("2026-10-26T10:00:00.000Z");
    expect(repository.create("Write docs", now)).toEqual({ id: 1, title: "Write docs", status: "todo", createdAt: "2026-10-26T10:00:00.000Z" });
    expect(repository.create("Ship it", now).id).toBe(2);
  });

  it("filters by status and hands out copies", () => {
    const repository = new TasksRepository();
    repository.create("a");
    repository.create("b");
    repository.updateStatus(2, "doing");
    expect(repository.findAll("doing").map((t) => t.title)).toEqual(["b"]);
    repository.findById(1)!.title = "changed outside";
    expect(repository.findById(1)!.title).toBe("a");
  });
});

describe("TasksService", () => {
  async function service(maxTitleLength = 10) {
    const moduleRef = await Test.createTestingModule({
      providers: [TasksService, TasksRepository, { provide: APP_CONFIG, useValue: { port: 0, apiKey: "k", maxTitleLength } }],
    }).compile();
    return moduleRef.get(TasksService);
  }

  it("trims titles and refuses ones over the configured length", async () => {
    const tasks = await service(10);
    expect(tasks.create("  Plan  ").title).toBe("Plan");
    expect(() => tasks.create("x".repeat(11))).toThrow(BadRequestException);
  });

  it("says when a task doesn't exist", async () => {
    const tasks = await service();
    expect(() => tasks.get(42)).toThrow(NotFoundException);
    expect(() => tasks.remove(42)).toThrow(NotFoundException);
  });

  it("moves tasks forward, back from doing, and never out of done", async () => {
    const tasks = await service();
    const task = tasks.create("Plan");
    expect(tasks.move(task.id, "doing").status).toBe("doing");
    expect(tasks.move(task.id, "todo").status).toBe("todo");
    expect(tasks.move(task.id, "done").status).toBe("done");
    expect(() => tasks.move(task.id, "doing")).toThrow("a done task can't become doing");
  });
});

describe("pipes", () => {
  it("accept a non-empty title and a known status only", () => {
    expect(new CreateTaskPipe().transform({ title: "Plan", extra: 1 })).toEqual({ title: "Plan" });
    expect(() => new CreateTaskPipe().transform({ title: "  " })).toThrow("title must be a non-empty string");
    expect(new MoveTaskPipe().transform({ status: "done" })).toEqual({ status: "done" });
    expect(() => new MoveTaskPipe().transform({ status: "later" })).toThrow("status must be one of todo, doing, done");
  });
});
