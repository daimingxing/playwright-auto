import { createApp } from './app';
import { getAppConfig } from './lib/app-config';
import { recoverImportJobs } from './services/import/import-worker';

const port = getAppConfig().server.port;
const app = createApp();

app.listen(port, () => {
  console.log(`本地服务已启动：http://localhost:${port}`);
  recoverImportJobs().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`AI 导入任务恢复失败：${message}`);
  });
});
