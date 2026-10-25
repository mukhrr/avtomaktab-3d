# M5a sign set: rulings, unchecked list and budget

Collected from the build ledger when M5a finished. All 297 official signs are in the catalogue, in the atlas and mountable in the city.

## Rulings

- Ruling: CODE.pedestrianCrossing is 5.16.2, because the official text puts 5.16.2 on the right-hand side; cost if wrong: one constant.
- Ruling: Task 2 keeps world/signs.ts compiling by making its plateKey read `code`; Task 5 then moves plateKey into src/shared/signCatalogue.ts so tools and game use one key format; cost if wrong: a rename.
- Ruling: Task 6 puts the spot-grouping function in src/world/signMount.ts with no three.js import, and validateSigns imports it for the 3-signs-per-spot check; cost if wrong: an import cycle fix.
- Ruling: Ukraine (UA) and Moldova (MD) public-domain Commons sets are allowed as art sources for entries refused or unmatched in UZ, RU, BY and KZ. They are the same post-Soviet sign family, and drawing 95+ signs by hand is the costlier and less faithful path; cost if wrong: a few pictograms in a slightly different national style.
- Ruling: foreign-language inscriptions on mapped art are replaced with Uzbek Latin text in Task 4, and the 1.4.x catalogue names are fixed to match the art position; cost if wrong: rework only.
- Ruling: a Commons category is not evidence under the checked rule. 5.35 and 7.4.10 (the description covers only part of the Uzbek meaning) are unchecked, with 7.20; a checked sign can be penalised, so doubt resolves to unchecked; cost if wrong: three signs not penalised until a photo check.
- Ruling: Commons art that needs editing is copied to data/signs/drawn/<n>.svg, edited there, and recorded as `{ source: 'drawn', file, basedOn, licence }`. assets-src is gitignored, so edited files must be committed, and the source page keeps its credit; cost if wrong: a schema field.
- Ruling: Sign.value and plateKey accept number or string. Time and text kinds take a pre-formatted string ('8-19'), the rest take numbers, because 7.5.4 to 7.5.7 need a range in one slot; cost if wrong: a type widening.
- Ruling: speed variants (5 to 100) are built for every speed-kind entry, including 3.25 and 4.8; cost if wrong: a few more cells.
- Ruling: text stays live `<text>`. The atlas is built on Mukher's Mac and committed, and the tool fails if fontconfig cannot match Arial, Helvetica or Liberation Sans; cost if wrong: converting text to paths later.
- Ruling: the catalogue `size` is the single source of sign size. The 13 entries whose art aspect differed by more than 5% got their size corrected from the art (1.3.1, 1.3.2, 1.31.1 to 1.31.3, 2.3.1 to 2.3.3, 4.9.1 to 4.9.3, 5.38, 5.39); the atlas now throws instead of rescaling; cost if wrong: 13 size values.
- Ruling: 5.11.2 and 5.27 art fixed so a 3-digit value fits; cost if wrong: none.
- Ruling: the atlas bleeds edge colour into transparent texels, so mips and filtering leave no dark fringe on round signs; cost if wrong: none.

## Exemptions

None. No catalogue entry has `exempt` set and none has `art: null`, so every sign renders its real art. The labelled grey placeholder (`exemptSvg`) stays in the tool and is unit tested, but nothing uses it.

## Unchecked list

61 of 297 signs are `checked: false`. They render in the city but the rules engine must not penalise a driver for them until a reference photo or a clear describing source confirms the art matches the Uzbek sign. Doubt resolves to unchecked.

- Group 1: 1.5, 1.12.2, 1.18.1, 1.18.2, 1.18.3, 1.22, 1.28, 1.31.1, 1.31.2
- Group 2: 2.3.2, 2.3.3
- Group 3: 3.21, 3.28, 3.29, 3.30, 3.31
- Group 4: 4.6.1 to 4.6.6
- Group 5: 5.7.1, 5.7.2, 5.8.3, 5.8.5, 5.8.6, 5.9, 5.10.1 to 5.10.4, 5.12, 5.15, 5.17.1 to 5.17.4, 5.20.3, 5.30.1 to 5.30.3, 5.35, 5.40
- Group 6: 6.5 to 6.11
- Group 7: 7.2.3, 7.2.4, 7.3.1, 7.3.2, 7.3.3, 7.4.10, 7.5.1, 7.5.2, 7.6.1, 7.21

Carried open from Task 3: reference photos for 5.16.1 and 5.16.2 (CODE.pedestrianCrossing) and 4.2.1 and 4.2.2 so they can be checked.

## Budget

| | Measured | Budget |
|---|---|---|
| Atlas size | 2048 x 2656, 347 cells | |
| atlas.png | 1.01 MB | 4 MB |
| GPU texture | about 27.7 MB (w x h x 4 x 4/3) | 48 MB |
| Draw calls, chase view, high | 90 before, 87 after | 92 / 120 |

Signs are two instanced meshes (faces and poles). Triangles went from 799,787 to 795,694.

Open item: the 8 ms frame budget is not measured. The numbers above come from headless Playwright throttled to about 1 fps, which only shows no regression (renderMs 5.3 to 4.3, gpuMs 13.4 to 12.8, same conditions). It still needs a measurement on Mukher's Mac.

## Source of the art

246 signs use public-domain or CC0 Commons art, 31 of them edited copies. 51 signs were drawn from scratch. The Rules text and the official sign sheets used as references are from lex.uz. Credits are generated into CREDITS.md by `npm run signs:credits`.

## Deferred minors

- Task 1: licence check accepts any 'pd' prefix (e.g. 'pdf'), tighten to a word boundary.
- Task 1: validator does not type-check checkable, reference, exempt or name strings.
- Task 1: 5.16.x English names say far/near side, Uzbek says left/right.
- Task 1: clauseQuote truncated at about 200 chars for 5 entries.
- Task 1: no test pins CODE.pedestrianCrossing to the right-hand variant; no tests for duplicate or unknown shape or drawn art.
- Task 2: world/signs.ts GLYPH_OF_CODE.get(...)! left an unmapped code with a bare pole until Task 6 (now resolved by the atlas).
- Task 2: BANNED_BY is duplicated in lanes.ts and rules/signs.ts.
- Task 3: isPlainSvg is loose (root element, on*= handlers, http hrefs); fetch retries only 429; no tests for fileUrlOf and imageinfoUrl.
- Task 4: inkscape and sodipodi attributes left in 10 drawn files; the basedOn licence error text says "undefined".
- Task 4: 3.5.1, 6.3.2 and 5.22 have small pictogram differences; edited signs keep a Cyrillic-unit Commons reference; 5.20.1 valueKind is text but its slot is a distance; 5.8.7 and 5.8.8 names come from Task 1.
- Task 5: `toThrow('x')` and `toThrow('p')` are too loose; build.ts imports atlas.ts (pulls sharp) for a pure function; the coverage test reads only tashkent-center; exempt-entry message; world/signs.ts splits the key on ':'; 4cef16d is not green alone.
- Task 6: quad scale reads the atlas cell size while mounting spaces by catalogue size (stale atlas risk).
- Task 6: MountedFace is not exported and faces carry a pole index.
- Task 6: the vMapUv overwrite drops map.matrix.
- Task 6: faces are posed per own sign on curved edges.
- Task 6: the district has no multi-sign spot (all 41 spots hold one sign), so stacking was only checked on a synthetic stack.

## For M5c

A 0.7 m sign is about 11 px at 40 m in 720p. It reads by shape and colour only, not by text.
