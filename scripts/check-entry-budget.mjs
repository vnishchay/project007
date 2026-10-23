// Count all bootstrap JS in index.html, including shared module preloads, not just the entry file.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.js)"/g)].map((m) => m[1]))];
if (!assets.length) throw new Error('No bootstrap assets found; check the production HTML.');
let bytes = 0, gzip = 0;
for (const asset of assets) {
  const source = readFileSync(new URL(`../dist${asset}`, import.meta.url));
  bytes += source.length; gzip += gzipSync(source).length;
}
console.log(`Bootstrap JS: ${(bytes / 1000).toFixed(1)} kB raw, ${(gzip / 1000).toFixed(1)} kB gzip across ${assets.length} assets. Route chunks load separately.`);
if (bytes > 650000) throw new Error('Bootstrap JS exceeds 650 kB. Keep owner/admin tools behind route imports.');
