import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const client = resolve(root, 'packages/client');
export const server = resolve(root, 'packages/server');
export const require = createRequire(resolve(client, 'package.json'));
export function run(script, args = [], cwd = root) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      stdio: 'inherit',
    });
    child.on('error', rej);
    child.on('exit', (code) =>
      code === 0
        ? res()
        : rej(new Error(`Command failed (${code}): ${script}`)),
    );
  });
}
export async function bundler() {
  const viteDir = dirname(require.resolve('vite/package.json'));
  const esbuildPath = createRequire(resolve(viteDir, 'package.json')).resolve(
    'esbuild',
  );
  return import(pathToFileURL(esbuildPath).href);
}
export async function buildServer() {
  const { build } = await bundler();
  await build({
    entryPoints: [resolve(server, 'src/index.ts')],
    outfile: resolve(server, 'dist/index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    alias: {
      '@stabilometer/shared': resolve(root, 'packages/shared/src/index.ts'),
    },
    sourcemap: true,
  });
}

export function bin(name, relative) {
  return resolve(dirname(require.resolve(name + '/package.json')), relative);
}
