import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { validateCatalogue } from '../../src/shared/signCatalogue';
import { USER_AGENT, fileUrlOf, imageinfoUrl, isAcceptedLicence, isPlainSvg, licenceOf, pageOfTitle, titleOfPage } from './commons';

const CATALOGUE = 'data/signs/catalogue.json';
const OUT = 'assets-src/signs/commons';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    await sleep(Math.max(0, last + 200 - Date.now()));
    last = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return res;
    if (res.status !== 429 || attempt === 6) throw new Error(`commons: ${res.status} for ${url}`);
    const wait = Number(res.headers.get('retry-after')) || 5 * attempt;
    console.info(`rate limited, waiting ${wait} s`);
    await sleep(wait * 1000);
  }
}

// Edits the parsed JSON in place so keys outside CatalogueEntry (groupName, colours) survive the rewrite.
const data = JSON.parse(readFileSync(CATALOGUE, 'utf8')) as Record<string, any>[];
mkdirSync(OUT, { recursive: true });
const refused: string[] = [];
let fetched = 0;

for (const e of data) {
  if (e.art?.source !== 'commons') continue;
  const title = titleOfPage(e.art.page);
  const reply = await (await get(imageinfoUrl(title))).json();
  const licence = licenceOf(reply);
  if (!isAcceptedLicence(licence)) {
    refused.push(`${e.number} ${title} (${licence})`);
    e.art = null;
    e.reference = null;
    e.checked = false;
    continue;
  }
  const svg = await (await get(fileUrlOf(reply))).text();
  if (!isPlainSvg(svg)) throw new Error(`commons: ${title} is not a plain SVG`);
  const file = `${OUT}/${e.number}.svg`;
  writeFileSync(file, svg);
  e.art = { source: 'commons', file, page: pageOfTitle(title), licence };
  fetched++;
}

validateCatalogue(data);
writeFileSync(CATALOGUE, JSON.stringify(data, null, 1) + '\n');
console.info(`fetched ${fetched}, refused ${refused.length}`);
for (const r of refused) console.info(`refused ${r}`);
