/**
 * Every API endpoint must be either mapped to a permission or deliberately
 * open. Unmapped routes are denied once enforcement is on, so an uncovered
 * endpoint is a future outage; this turns that into a failing check now.
 *
 * Run: node apps/api/scripts/check-rbac-coverage.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { permissionForRequest, openRouteReason } from '../src/rbac/route-permissions.js';
import { allPermissionKeys } from '../src/rbac/permission-registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const API = path.resolve(here, '../src');

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.js$/.test(entry.name)) out.push(full);
  }
  return out;
};

// Where each router factory is mounted, so router-relative paths resolve.
// Read every file rather than server.js alone: server.js became a thin loader
// for app.js, and looking in only one of them found no mounts at all, so the
// router-based endpoints -- most of the API -- silently left this check while
// it still reported success.
const mountByFactory = new Map();
for (const file of walk(API)) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z0-9_]+)\(/g)) {
    if (!mountByFactory.has(m[2])) mountByFactory.set(m[2], m[1]);
  }
}

const endpoints = [];
for (const file of walk(API)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(API, file).replace(/\\/g, '/');
  // Diagnostic and one-off scripts are not part of the served surface.
  if (/-qa\.js$|^inspect-db\.js$|^smoke-|^debug-|^migrate\.js$|^data\.js$/.test(rel)) continue;

  for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
    endpoints.push({ method: m[1].toUpperCase(), path: m[2], file: rel });
  }

  const factory = src.match(/export function (create[A-Za-z0-9_]+)\(/)?.[1];
  const mount = factory ? mountByFactory.get(factory) : null;
  for (const m of src.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
    if (!mount) continue; // unmounted router: not reachable
    const full = (mount + (m[2] === '/' ? '' : m[2])).replace(/\/+/g, '/');
    endpoints.push({ method: m[1].toUpperCase(), path: full, file: rel });
  }
}

// Express params -> a concrete value, so the matchers see a realistic path.
const concrete = (p) => p.replace(/:[A-Za-z0-9_]+\??/g, '123').replace(/\*/g, 'x');

const unmapped = [];
const open = [];
const mapped = [];
for (const endpoint of endpoints) {
  const pathname = concrete(endpoint.path);
  if (!pathname.startsWith('/api')) continue;
  const reason = openRouteReason(pathname);
  if (reason) { open.push({ ...endpoint, reason }); continue; }
  const key = permissionForRequest(endpoint.method, pathname);
  if (key === undefined) unmapped.push(endpoint);
  else mapped.push({ ...endpoint, key });
}

// A rule pointing at a key the registry does not define would deny forever.
const known = new Set(allPermissionKeys());
const badKeys = [...new Set(mapped.map((m) => m.key))].filter((k) => !known.has(k));

console.log(`endpoints scanned : ${endpoints.length}`);
console.log(`  mapped          : ${mapped.length}`);
console.log(`  deliberately open: ${open.length}`);
console.log(`  UNMAPPED        : ${unmapped.length}`);

if (unmapped.length) {
  console.error('\nFAIL: these endpoints would be denied once enforcement is on:');
  for (const e of unmapped.slice(0, 40)) console.error(`  ${e.method.padEnd(6)} ${e.path}   (${e.file})`);
  if (unmapped.length > 40) console.error(`  ... and ${unmapped.length - 40} more`);
}
if (badKeys.length) {
  console.error('\nFAIL: route rules reference permissions that do not exist:');
  badKeys.forEach((k) => console.error(`  ${k}`));
}

if (unmapped.length || badKeys.length) process.exit(1);
console.log('\nOK: every endpoint is mapped to a permission or explicitly open.');
