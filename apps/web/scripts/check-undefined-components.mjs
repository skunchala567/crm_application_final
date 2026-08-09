/**
 * Finds components used in JSX that are never imported or defined.
 *
 * Vite does not catch this: `<Settings />` where `Settings` is undefined
 * compiles cleanly and throws "Settings is not defined" only when that branch
 * of the interface actually renders. A component behind a dropdown can stay
 * broken through a green build and a full page load.
 *
 * That is exactly how the Settings icon in the profile menu broke -- its
 * import was removed with a batch of genuinely unused ones.
 *
 * Run: node apps/web/scripts/check-undefined-components.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../src');

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.jsx$/.test(entry.name)) out.push(full);
  }
  return out;
};

// Things that look like components in JSX but are not identifiers we resolve.
const HTML_LIKE = /^[a-z]/;
const BUILT_IN = new Set(['Fragment', 'React', 'Suspense', 'StrictMode', 'Profiler']);

let problems = [];

for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(SRC, file).replace(/\\/g, '/');

  // Capitalised tags: <Foo ...>, <Foo/>, <Foo>. Ignores <Foo.Bar> members.
  const used = new Set();
  for (const m of src.matchAll(/<([A-Z][A-Za-z0-9_]*)(?=[\s/>])/g)) used.add(m[1]);

  if (!used.size) continue;

  // Everything the file brings into scope or declares itself.
  const defined = new Set(BUILT_IN);
  for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    // default and namespace imports
    const dflt = clause.match(/^\s*([A-Za-z0-9_$]+)/);
    if (dflt && !clause.trimStart().startsWith('{')) defined.add(dflt[1]);
    for (const n of clause.matchAll(/\*\s+as\s+([A-Za-z0-9_$]+)/g)) defined.add(n[1]);
    // named imports, including `as` aliases
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part.includes(' as ') ? part.split(' as ')[1] : part;
        const clean = name.replace(/[^A-Za-z0-9_$]/g, '').trim();
        if (clean) defined.add(clean);
      }
    }
  }
  // Locally declared components and any capitalised binding.
  for (const m of src.matchAll(/(?:function|class)\s+([A-Z][A-Za-z0-9_]*)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/g)) defined.add(m[1]);
  // Bound by destructuring, in any position and in either pattern shape:
  //   const { icon: Icon } = action
  //   ({ label, path, Icon }) => ...
  //   cards.map(([label, value, trend, Icon, color]) => ...)
  // Components are very often received this way rather than imported, so
  // missing these would drown the real findings in false positives.
  for (const m of src.matchAll(/[{[,]\s*([A-Z][A-Za-z0-9_]*)\s*[,}\]:=]/g)) defined.add(m[1]);
  for (const m of src.matchAll(/:\s*([A-Z][A-Za-z0-9_]*)\s*[,}\]=]/g)) defined.add(m[1]);
  for (const m of src.matchAll(/\bas\s+([A-Z][A-Za-z0-9_]*)/g)) defined.add(m[1]);

  for (const name of used) {
    if (HTML_LIKE.test(name) || defined.has(name)) continue;
    const line = src.slice(0, src.indexOf(`<${name}`)).split('\n').length;
    problems.push({ file: rel, name, line });
  }
}

if (problems.length) {
  console.error(`FAIL: ${problems.length} component(s) used in JSX but never defined:\n`);
  for (const p of problems) console.error(`  ${p.file}:${p.line}  <${p.name} />`);
  console.error('\nThese throw "<name> is not defined" at runtime, not at build time.');
  process.exit(1);
}

console.log('OK: every component used in JSX is imported or defined.');
