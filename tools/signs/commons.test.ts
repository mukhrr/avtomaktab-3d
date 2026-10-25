import { describe, expect, it } from 'vitest';
import pdFixture from './fixtures/imageinfo-pd.json';
import ccBySaFixture from './fixtures/imageinfo-ccbysa.json';
import { isAcceptedLicence, isPlainSvg, licenceOf, pageOfTitle, titleOfPage } from './commons';

describe('commons', () => {
  it('reads the licence short name from a Commons imageinfo reply', () => expect(licenceOf(pdFixture)).toMatch(/^Public domain|^PD/));
  it('accepts a public-domain file', () => expect(isAcceptedLicence(licenceOf(pdFixture))).toBe(true));
  it('refuses a CC BY-SA file', () => expect(isAcceptedLicence(licenceOf(ccBySaFixture))).toBe(false));
  it('throws on a reply without imageinfo', () => expect(() => licenceOf({ query: { pages: { '-1': { missing: '' } } } })).toThrow());
  it('turns a page URL back into an API title', () =>
    expect(titleOfPage('https://commons.wikimedia.org/wiki/File:RU_road_sign_1.1.svg')).toBe('File:RU road sign 1.1.svg'));
  it('round-trips a title with brackets through its page URL', () =>
    expect(titleOfPage(pageOfTitle('File:7.2.1 (Road sign).svg'))).toBe('File:7.2.1 (Road sign).svg'));
  it('accepts a plain SVG and refuses one with a script', () => {
    expect(isPlainSvg('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')).toBe(true);
    expect(isPlainSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).toBe(false);
    expect(isPlainSvg('<html><body>rate limited</body></html>')).toBe(false);
  });
});
