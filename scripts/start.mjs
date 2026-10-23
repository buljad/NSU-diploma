import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = resolve(root, 'packages/client/build'),
  entry = resolve(root, 'packages/server/dist/index.js');
if (!existsSync(resolve(site, 'index.html')) || !existsSync(entry)) {
  console.error('Build missing. Run npm run build before START.');
  process.exit(1);
}
const backend = spawn(process.execPath, [entry], {
  cwd: root,
  stdio: 'inherit',
});
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};
const app = createServer((req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    let relative = decodeURIComponent(
      new URL(req.url, 'http://127.0.0.1').pathname,
    );
    let file = resolve(site, '.' + relative);
    if (file !== site && !file.startsWith(site + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!extname(file)) file = resolve(site, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else
      createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
  }
});
function stop() {
  backend.kill();
  app.close();
}
app.on('error', (e) => {
  console.error(e.message);
  stop();
  process.exitCode = 1;
});
backend.on('error', (e) => {
  console.error(e.message);
  app.close();
  process.exitCode = 1;
});
backend.on('exit', (code) => {
  app.close();
  if (code) process.exitCode = code;
});
app.listen(5173, '127.0.0.1', () => {
  console.log(
    'Stabilometer: http://127.0.0.1:5173 (keep this process running)',
  );
  if (!process.argv.includes('--no-open')) {
    if (process.platform === 'win32')
      spawn('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:5173'], {
        windowsHide: true,
        stdio: 'ignore',
      }).unref();
    else
      spawn(
        process.platform === 'darwin' ? 'open' : 'xdg-open',
        ['http://127.0.0.1:5173'],
        { stdio: 'ignore' },
      )
        .on('error', () => {})
        .unref();
  }
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
