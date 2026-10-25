import * as THREE from 'three';
import { testNetwork } from '../traffic/testNetwork';
import type { DistrictData, Sign } from '../shared/district';
import { CODE, entry } from '../shared/signCatalogue';
import { mountSigns, signPose, signSpots } from './signMount';
import { addSigns, loadSignAtlas } from './signs';
import { validateSigns } from '../../tools/city/build';

const net = testNetwork();
const edges = new Map(net.graph.edges.map(e => [e.id, e]));
let n = 0;
const sign = (code: string, extra: Partial<Sign> = {}): Sign => ({ id: `s${n++}`, code, edgeId: 'e', dir: 1, at: 50, origin: 'hand', ...extra });
const h = (code: string) => entry(code).size[1];

describe('mountSigns', () => {
  it('puts signs within 1 m on one pole', () => {
    expect(mountSigns([sign(CODE.giveWay), sign(CODE.children, { at: 50.6 })], edges).poles).toHaveLength(1);
  });

  it('measures the 1 m from the first sign of a spot', () => {
    expect(mountSigns([sign(CODE.giveWay), sign(CODE.children, { at: 50.6 }), sign(CODE.stop, { at: 51.2 })], edges).poles).toHaveLength(2);
  });

  it('keeps opposite directions on separate poles', () => {
    const { poles } = mountSigns([sign(CODE.stop), sign(CODE.stop, { dir: -1 })], edges);
    expect(poles).toHaveLength(2);
    // e runs east along z = 0, so the two curbs are on opposite sides of it.
    expect(Math.sign(poles[0].z)).toBe(-Math.sign(poles[1].z));
  });

  it('keeps a left-side sign on its own pole on the other curb', () => {
    const right = sign(CODE.stop), left = sign(CODE.stop, { side: 'left' });
    expect(mountSigns([right, left], edges).poles).toHaveLength(2);
    const e = edges.get('e')!;
    expect(signPose(e, left).z).toBeCloseTo(-signPose(e, right).z);
    expect(signPose(e, left).heading).toBeCloseTo(signPose(e, right).heading);
  });

  it('stacks priority above warning above prohibitory', () => {
    const signs = [sign(CODE.speedLimit, { value: 60 }), sign(CODE.children), sign(CODE.giveWay)];
    const { faces } = mountSigns(signs, edges);
    const y = (code: string) => faces.find(f => f.sign.code === code && f.plateIndex === null)!.y;
    expect(y(CODE.giveWay)).toBeGreaterThan(y(CODE.children));
    expect(y(CODE.children)).toBeGreaterThan(y(CODE.speedLimit));
  });

  it('hangs plates directly under their sign', () => {
    const { faces } = mountSigns([sign(CODE.speedLimit, { value: 60, plates: [{ code: '7.2.1', value: 100 }] })], edges);
    const signFace = faces.find(f => f.plateIndex === null)!, plate = faces.find(f => f.plateIndex === 0)!;
    expect(plate.y).toBeLessThan(signFace.y);
    expect(signFace.y - h(CODE.speedLimit) / 2 - (plate.y + h('7.2.1') / 2)).toBeCloseTo(0.05);
  });

  it('keeps the lowest face edge at 2.2 m', () => {
    const signs = [sign(CODE.giveWay), sign(CODE.speedLimit, { value: 60, plates: [{ code: '7.2.1', value: 100 }] })];
    const { faces, poles } = mountSigns(signs, edges);
    const bottom = (f: (typeof faces)[number]) => f.y - h(f.plateIndex === null ? f.sign.code : f.sign.plates![f.plateIndex].code) / 2;
    expect(Math.min(...faces.map(bottom))).toBeCloseTo(2.2);
    expect(poles[0].height).toBeCloseTo(Math.max(...faces.map(f => f.y)) + h(CODE.giveWay) / 2);
  });

  it('skips signs on edges the district does not have', () => {
    expect(mountSigns([sign(CODE.stop, { edgeId: 'nope' })], edges)).toEqual({ poles: [], faces: [] });
  });
});

describe('signSpots', () => {
  it('groups by edge, direction and side', () => {
    const spots = signSpots([sign(CODE.stop), sign(CODE.giveWay, { at: 50.5 }), sign(CODE.stop, { dir: -1 }), sign(CODE.stop, { edgeId: 'w' })]);
    expect(spots.map(s => s.signs.length).sort()).toEqual([1, 1, 2]);
  });
});

describe('validateSigns', () => {
  const two = { ...edges.get('e')!, lanesForward: 1, lanesBackward: 1 };
  it('rejects a fourth sign on one spot', () => {
    const fourAtOneSpot = [sign(CODE.giveWay), sign(CODE.children), sign(CODE.noUTurn), sign(CODE.speedLimit, { value: 40, at: 50.3 })];
    expect(() => validateSigns(fourAtOneSpot, [two])).toThrow(/4 signs.*e/);
    expect(() => validateSigns(fourAtOneSpot.slice(1), [two])).not.toThrow();
  });
});

describe('without the atlas', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts without signs when the atlas fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 404 })));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadSignAtlas()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    const scene = new THREE.Scene();
    const d = { signs: [sign(CODE.stop)], graph: net.graph } as unknown as DistrictData;
    expect(() => addSigns(scene, d, null)).not.toThrow();
    expect(scene.children).toHaveLength(0);
  });
});
