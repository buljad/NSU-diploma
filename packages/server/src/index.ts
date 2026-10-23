import { StabilogramServer } from './StabilogramServer.js';

const server = new StabilogramServer();
console.log('Стабилометр: локальный сервер ws://127.0.0.1:3001');
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.shutdown().then(() => process.exit(0));
  });
}
