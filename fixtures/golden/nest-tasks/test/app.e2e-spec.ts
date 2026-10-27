import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module.js";

describe("nest-tasks over HTTP", () => {
  let app: INestApplication;
  const key = { "x-api-key": "dev-key" };

  beforeEach(async () => {
    delete process.env.API_KEY;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("answers GET /health", async () => {
    await request(app.getHttpServer()).get("/health").expect(200, { status: "ok" });
  });

  it("creates a task with the API key, then lists and gets it", async () => {
    const created = await request(app.getHttpServer()).post("/tasks").set(key).send({ title: "Write docs" }).expect(201);
    expect(created.body).toMatchObject({ id: 1, title: "Write docs", status: "todo" });
    const list = await request(app.getHttpServer()).get("/tasks").expect(200);
    expect(list.body).toHaveLength(1);
    await request(app.getHttpServer()).get("/tasks/1").expect(200);
    await request(app.getHttpServer()).get("/tasks/abc").expect(400);
  });

  it("refuses changes without the API key", async () => {
    await request(app.getHttpServer()).post("/tasks").send({ title: "Write docs" }).expect(401);
    await request(app.getHttpServer()).delete("/tasks/1").set({ "x-api-key": "wrong" }).expect(401);
  });

  it("validates bodies before the service sees them", async () => {
    await request(app.getHttpServer()).post("/tasks").set(key).send({ title: "" }).expect(400);
    await request(app.getHttpServer()).post("/tasks").set(key).send({ title: "x".repeat(81) }).expect(400);
  });

  it("moves a task through its statuses, filters by status, and deletes it", async () => {
    await request(app.getHttpServer()).post("/tasks").set(key).send({ title: "Plan" }).expect(201);
    await request(app.getHttpServer()).patch("/tasks/1/status").set(key).send({ status: "done" }).expect(200);
    await request(app.getHttpServer()).patch("/tasks/1/status").set(key).send({ status: "todo" }).expect(400);
    const done = await request(app.getHttpServer()).get("/tasks?status=done").expect(200);
    expect(done.body.map((t: { title: string }) => t.title)).toEqual(["Plan"]);
    await request(app.getHttpServer()).delete("/tasks/1").set(key).expect(204);
    await request(app.getHttpServer()).get("/tasks/1").expect(404);
  });
});
