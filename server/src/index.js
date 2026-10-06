import { createApp } from './app.js';
import { config } from './config/index.js';
import { connectDatabase } from './db/connect.js';

await connectDatabase();

const { host, port, apiPrefix } = config.server;
createApp().listen(port, host, () => {
  console.log(`${config.app.name} API running at http://${host}:${port}${apiPrefix}`);
});
