import { bundler, root, server, run } from './common.mjs';
import { resolve } from 'node:path';
import { readdir, mkdir } from 'node:fs/promises';
const { build } = await bundler();
const out = resolve(server, '.test-dist');
await mkdir(out, { recursive: true });
const outputs = [];
for (const name of (await readdir(resolve(root, 'tests'))).filter((n) =>
  n.endsWith('.test.ts'),
)) {
  const file = resolve(out, name.replace('.ts', '.cjs'));
  await build({
    entryPoints: [resolve(root, 'tests', name)],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['serialport'],
    alias: {
      '@stabilometer/shared': resolve(root, 'packages/shared/src/index.ts'),
    },
    logLevel: 'warning',
  });
  outputs.push(file);
}
await run('--test', outputs);
