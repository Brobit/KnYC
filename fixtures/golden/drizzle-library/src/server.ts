import { createApp } from "./app.js";
import { createDb } from "./db/client.js";

const port = Number(process.env.PORT ?? 3000);
createApp(createDb()).listen(port, () => {
  console.log(`library API on http://localhost:${port}`);
});
