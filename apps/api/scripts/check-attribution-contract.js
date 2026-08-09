/**
 * Fails if the browser capture script and the server contract disagree about
 * the attribution field names.
 *
 * The two lists have to be stated twice: the server file is an ES module in
 * this workspace, the capture script is unbundled and has to run on the
 * marketing site, which is not built from this repository. Duplication is the
 * price of that, and this check is what stops it turning into drift -- the
 * exact failure the scope document warns about, where each part of the system
 * invents its own field names and the data is lost at the handovers.
 *
 * Run: node apps/api/scripts/check-attribution-contract.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTRIBUTION_FIELDS } from '../src/attribution/attribution-contract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, '../../web/public/crm-attribution.js');

const source = fs.readFileSync(scriptPath, 'utf8');
const block = source.match(/\/\* CONTRACT_FIELDS_START \*\/([\s\S]*?)\/\* CONTRACT_FIELDS_END \*\//);

if (!block) {
  console.error(`FAIL: no CONTRACT_FIELDS markers in ${scriptPath}`);
  process.exit(1);
}

const clientFields = [...block[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
const serverSet = new Set(ATTRIBUTION_FIELDS);
const clientSet = new Set(clientFields);

const missingInClient = ATTRIBUTION_FIELDS.filter((f) => !clientSet.has(f));
const missingInServer = clientFields.filter((f) => !serverSet.has(f));

if (missingInClient.length || missingInServer.length) {
  console.error('FAIL: attribution contract has drifted.');
  if (missingInClient.length) console.error(`  in server, not in capture script: ${missingInClient.join(', ')}`);
  if (missingInServer.length) console.error(`  in capture script, not in server: ${missingInServer.join(', ')}`);
  console.error('\n  Update both apps/api/src/attribution/attribution-contract.js');
  console.error('  and apps/web/public/crm-attribution.js so they match.');
  process.exit(1);
}

console.log(`OK: attribution contract matches on both sides (${ATTRIBUTION_FIELDS.length} fields).`);
