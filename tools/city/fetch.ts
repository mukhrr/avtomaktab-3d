import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DistrictConfig } from '../../src/shared/district';

const district = process.argv[2];
if (!district) throw new Error('usage: npm run city:fetch -- <district>');

const config: DistrictConfig = JSON.parse(readFileSync(`data/districts/${district}/district.config.json`, 'utf8'));
// The main API rather than Overpass: Overpass mirrors were all at capacity when this was written.
const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${config.bbox.join(',')}`;
const res = await fetch(url, { headers: { 'User-Agent': 'avtomaktab-3d/0.1' } });
if (!res.ok) throw new Error(`OSM API ${res.status}: ${await res.text()}`);

mkdirSync('data/raw', { recursive: true });
const out = `data/raw/${district}.osm.xml`;
writeFileSync(out, await res.text());
console.info(`wrote ${out}`);
