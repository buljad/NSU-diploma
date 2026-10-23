import { bin } from './common.mjs';
import { buildServer, run, require, client } from './common.mjs';
await buildServer();
await import('./notices.mjs');
await run(bin('@sveltejs/kit', 'svelte-kit.js'), ['sync'], client);
await run(bin('vite', 'bin/vite.js'), ['build'], client);
console.log('Production build ready. Run npm start.');
