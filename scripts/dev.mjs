import { bin } from './common.mjs';
import { buildServer, root, server, client, require } from './common.mjs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
await buildServer();
const backend = spawn(process.execPath, [resolve(server, 'dist/index.js')], {
  cwd: server,
  stdio: 'inherit',
});
const frontend = spawn(
  process.execPath,
  [bin('vite', 'bin/vite.js'), '--host', '127.0.0.1', '--port', '5173'],
  { cwd: client, stdio: 'inherit' },
);
function stop() {
  backend.kill();
  frontend.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
backend.on('exit', () => frontend.kill());
frontend.on('exit', () => backend.kill());
