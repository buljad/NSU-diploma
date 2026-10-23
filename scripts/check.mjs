import { bin } from './common.mjs';
import { run, require, client, root } from './common.mjs';
import { resolve } from 'node:path';
const tsc = resolve(root, 'node_modules/typescript/bin/tsc');
await run(tsc, [
  '-p',
  'packages/shared/tsconfig.json',
  '--noEmit',
  '--incremental',
  'false',
  '--composite',
  'false',
]);
await run(tsc, ['-p', 'packages/server/tsconfig.json', '--noEmit']);
await run(bin('@sveltejs/kit', 'svelte-kit.js'), ['sync'], client);
await run(
  bin('svelte-check', 'bin/svelte-check'),
  ['--tsconfig', './tsconfig.json'],
  client,
);
