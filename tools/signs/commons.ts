export { isAcceptedLicence } from '../../src/shared/signCatalogue';

const WIKI = 'https://commons.wikimedia.org/wiki/';
export const API = 'https://commons.wikimedia.org/w/api.php';
export const USER_AGENT = 'avtomaktab-3d/0.1 (https://github.com/mukhrr/avtomaktab-3d)';

interface ImageinfoReply {
  query?: { pages?: Record<string, { title?: string; imageinfo?: { url?: string; extmetadata?: { LicenseShortName?: { value?: string } } }[] }> };
}

function firstImageinfo(reply: unknown) {
  const page = Object.values((reply as ImageinfoReply)?.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error(`commons: no imageinfo for ${page?.title ?? 'unknown page'}`);
  return { title: page.title ?? '', info };
}

export function licenceOf(imageinfo: unknown): string {
  const { title, info } = firstImageinfo(imageinfo);
  const licence = info.extmetadata?.LicenseShortName?.value;
  if (!licence) throw new Error(`commons: ${title} has no licence`);
  return licence;
}

export function fileUrlOf(imageinfo: unknown): string {
  const { title, info } = firstImageinfo(imageinfo);
  if (!info.url) throw new Error(`commons: ${title} has no file url`);
  return info.url;
}

export function titleOfPage(page: string): string {
  if (!page.startsWith(WIKI)) throw new Error(`commons: not a Commons page: ${page}`);
  return decodeURIComponent(page.slice(WIKI.length)).replace(/_/g, ' ');
}

export function pageOfTitle(title: string): string {
  return WIKI + encodeURI(title.replace(/ /g, '_'));
}

export function imageinfoUrl(title: string): string {
  return `${API}?${new URLSearchParams({ action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata', format: 'json', titles: title })}`;
}

// The downloads are untrusted; they are only ever read as text and rasterised later, never opened in a browser.
export function isPlainSvg(text: string): boolean {
  const head = text.trimStart().slice(0, 512);
  return (head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!')) && text.includes('<svg') && !/<script|javascript:|<foreignObject/i.test(text);
}
