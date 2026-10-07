import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_CAPABILITIES, PRODUCT_CAPABILITY_GROUPS } from '../lib/product-capability-registry-data.js';
import { registrySummary } from '../lib/product-capability-registry.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const summary = registrySummary();
const lines = [
  '# WhatsApp SaaS production gap matrix',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} from \`lib/product-capability-registry.js\` (do not edit this table by hand; run \`npm run docs:parity\`).`,
  '',
  `Registry: **${summary.total}** capabilities — **${summary.byStatus.strong}** strong, **${summary.byStatus.partial}** partial, **${summary.byStatus.gap}** gap.`,
  '',
  '| Capability | Group | Code | Benchmarks | Evidence | Operator note |',
  '| --- | --- | --- | --- | --- | --- |'
];

for (const item of PRODUCT_CAPABILITIES) {
  const group = PRODUCT_CAPABILITY_GROUPS.find((entry) => entry.id === item.group)?.label || item.group;
  const benchmarks = (item.benchmarks || []).join(', ');
  const evidence = (item.evidence || []).join(', ');
  const note = item.operatorNote || '';
  lines.push(`| ${item.label} | ${group} | ${item.codeStatus} | ${benchmarks} | ${evidence} | ${note} |`);
}

lines.push('', 'Live Meta entitlement and provider acceptance are merged at runtime via `GET /api/super-admin/parity` and `GET /api/workspace/parity?` (tenant-scoped).', '');
fs.writeFileSync(path.join(root, 'AISENSY_GAP_MATRIX.md'), lines.join('\n'));
console.log('Wrote AISENSY_GAP_MATRIX.md');
