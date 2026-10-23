import { buildServer, root, run, require } from './common.mjs';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  copyFileSync,
  readdirSync,
} from 'node:fs';
if (process.platform !== 'win32')
  throw new Error(
    'Build the Windows distribution on Windows (native serial-port bindings).',
  );
await run(resolve(root, 'scripts/build.mjs'));
const version = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
).version;
const out = resolve(
  root,
  'release',
  `Stabilometer-${version}-windows-${process.arch}`,
);
if (existsSync(out))
  throw new Error(
    'Distribution already exists: ' +
      out +
      '. Move it aside before rebuilding.',
  );
mkdirSync(out, { recursive: true });
function copy(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, dereference: true });
}
copy(
  resolve(root, 'packages/client/build'),
  resolve(out, 'packages/client/build'),
);
copy(
  resolve(root, 'packages/server/dist'),
  resolve(out, 'packages/server/dist'),
);
copy(resolve(root, 'scripts/start.mjs'), resolve(out, 'scripts/start.mjs'));
copy(resolve(root, 'START.cmd'), resolve(out, 'START.cmd'));
for (const name of ['README.md', 'RELEASE_NOTES.md', 'LICENSE-NODE.txt', 'THIRD_PARTY_NOTICES.txt'])
  if (existsSync(resolve(root, name)))
    copy(resolve(root, name), resolve(out, name));
mkdirSync(resolve(out, 'runtime'));
copyFileSync(process.execPath, resolve(out, 'runtime/node.exe'));
writeFileSync(
  resolve(out, 'package.json'),
  JSON.stringify(
    { name: 'stabilometer', version, private: true, type: 'module' },
    null,
    2,
  ),
);
writeFileSync(
  resolve(out, 'packages/server/package.json'),
  JSON.stringify(
    { name: '@stabilometer/server', version, type: 'module' },
    null,
    2,
  ),
);
function dependency(name, from, destination, ancestors = new Set()) {
  const r = createRequire(join(from, 'package.json'));
  let directory = dirname(r.resolve(name));
  let manifest;
  while (directory !== dirname(directory)) {
    const f = join(directory, 'package.json');
    if (existsSync(f)) {
      const value = JSON.parse(readFileSync(f, 'utf8'));
      if (value.name === name) {
        manifest = value;
        break;
      }
    }
    directory = dirname(directory);
  }
  if (!manifest) throw new Error('Cannot locate runtime dependency ' + name);
  const key = name + '@' + manifest.version;
  if (ancestors.has(key)) return;
  const target = join(destination, 'node_modules', name);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(directory, target, {
    recursive: true,
    dereference: true,
    filter: (file) => file !== join(directory, 'node_modules'),
  });
  const seen = new Set(ancestors);
  seen.add(key);
  for (const dep of Object.keys(manifest.dependencies ?? {}))
    dependency(dep, directory, target, seen);
  for (const dep of Object.keys(manifest.optionalDependencies ?? {})) {
    try {
      r.resolve(dep);
    } catch {
      continue;
    }
    dependency(dep, directory, target, seen);
  }
}
for (const name of ['serialport', 'ws'])
  dependency(
    name,
    resolve(root, 'packages/server'),
    resolve(out, 'packages/server'),
  );
console.log(
  'Portable Windows distribution ready: ' +
    out +
    '\nDouble-click START.cmd. Node.js and pnpm are not needed on the recipient computer.',
);
