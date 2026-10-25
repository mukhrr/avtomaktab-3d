import raw from '../../data/signs/catalogue.json';

export type SignShape = 'triangle' | 'invertedTriangle' | 'circle' | 'octagon' | 'square' | 'rectangle' | 'diamond' | 'plate';
export type ValueKind = 'speed' | 'mass' | 'height' | 'width' | 'length' | 'distance' | 'time' | 'text';

export type SignArt =
  | { source: 'commons'; file: string; page: string; licence: string }
  | { source: 'drawn'; file: string };

export interface CatalogueEntry {
  number: string;
  group: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  name: { uz: string; ru: string; en: string };
  translated: true;
  shape: SignShape;
  size: [number, number];
  valueKind: ValueKind | null;
  meaning: string;
  carRelevant: boolean;
  checkable: string | null;
  clauseQuote: string;
  art: SignArt | null;
  reference: string | null;
  checked: boolean;
  exempt: string | null;
}

const SHAPES: readonly SignShape[] = ['triangle', 'invertedTriangle', 'circle', 'octagon', 'square', 'rectangle', 'diamond', 'plate'];
const VALUE_KINDS: readonly ValueKind[] = ['speed', 'mass', 'height', 'width', 'length', 'distance', 'time', 'text'];

// 5.16.2 stands on the right-hand side of the road at the near edge of the crossing (Appendix 1).
export const CODE = {
  stop: '2.5',
  giveWay: '2.4',
  priorityRoad: '2.1',
  noEntry: '3.1',
  noRightTurn: '3.18.1',
  noLeftTurn: '3.18.2',
  noUTurn: '3.19',
  speedLimit: '3.24',
  pedestrianCrossing: '5.16.2',
  children: '1.21',
} as const;

export function isAcceptedLicence(licence: string): boolean {
  const l = licence.trim().toLowerCase();
  return l.startsWith('public domain') || l.startsWith('pd') || l === 'cc0' || l === 'cc0 1.0';
}

export function validateCatalogue(input: unknown): CatalogueEntry[] {
  if (!Array.isArray(input)) throw new Error('signCatalogue: expected an array');
  const seen = new Set<string>();
  return input.map((r, i) => {
    const e = r as Partial<CatalogueEntry> | null;
    const n = e?.number;
    if (!e || typeof n !== 'string' || n === '') throw new Error(`signCatalogue: entry ${i} has no number`);
    const fail = (why: string): never => { throw new Error(`signCatalogue: ${n} ${why}`); };
    if (seen.has(n)) fail('is duplicated');
    seen.add(n);
    if (!Number.isInteger(e.group) || e.group! < 1 || e.group! > 7) fail('has a bad group');
    for (const lang of ['uz', 'ru', 'en'] as const) {
      if (!e.name?.[lang]) fail(`has no ${lang} name`);
    }
    if (e.translated !== true) fail('is not marked translated');
    if (!SHAPES.includes(e.shape as SignShape)) fail(`has unknown shape "${e.shape}"`);
    const s = e.size;
    if (!Array.isArray(s) || s.length !== 2 || !s.every((v) => Number.isFinite(v) && v > 0)) {
      fail('needs a positive size [width, height]');
    }
    if (e.valueKind != null && !VALUE_KINDS.includes(e.valueKind)) fail(`has unknown valueKind "${e.valueKind}"`);
    if (!e.meaning) fail('has no meaning');
    if (typeof e.carRelevant !== 'boolean') fail('needs carRelevant');
    if (!e.clauseQuote) fail('has no clauseQuote');
    const art = e.art ?? null;
    if (art) {
      if (art.source === 'commons') {
        if (!art.file || !art.page) fail('commons art needs file and page');
        if (!isAcceptedLicence(art.licence ?? '')) fail(`art licence "${art.licence}" is not public domain or CC0`);
      } else if (art.source !== 'drawn' || !art.file) {
        fail('has malformed art');
      }
    }
    if (e.checked === true && !e.reference) fail('is checked without a reference');
    if (typeof e.checked !== 'boolean') fail('needs checked');
    return { ...e, art, reference: e.reference ?? null, exempt: e.exempt ?? null, checkable: e.checkable ?? null, valueKind: e.valueKind ?? null } as CatalogueEntry;
  });
}

let cache: CatalogueEntry[] | null = null;

export function loadCatalogue(): CatalogueEntry[] {
  return (cache ??= validateCatalogue(raw));
}

export function entry(code: string): CatalogueEntry {
  const found = loadCatalogue().find((e) => e.number === code);
  if (!found) throw new Error(`signCatalogue: unknown sign code "${code}"`);
  return found;
}
