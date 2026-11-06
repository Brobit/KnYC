import { createApp } from "./app.js";
import { createDataSource } from "./db/data-source.js";

const port = Number(process.env.PORT ?? 3000);
const ds = await createDataSource().initialize();
createApp(ds).listen(port, () => {
  console.log(`library API on http://localhost:${port}`);
});
