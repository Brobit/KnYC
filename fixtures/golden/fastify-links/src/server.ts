import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp(config);
await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`fastify-links listening on http://localhost:${config.port}`);
