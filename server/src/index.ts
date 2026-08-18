import { createApp } from './app';
import { getAppConfig } from './lib/app-config';

const port = getAppConfig().server.port;
const app = createApp();

app.listen(port, () => {
  console.log(`本地服务已启动：http://localhost:${port}`);
});
