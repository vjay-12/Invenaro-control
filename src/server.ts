import { app } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();

app.listen(config.PORT, () => {
  console.log(`[invenaro-control] Server listening on port ${config.PORT}`);
});
