import { testNetwork } from '../traffic/testNetwork';
import type { Sign } from '../shared/district';
import { plateKey, signPose } from './signs';
import { CODE } from '../shared/signCatalogue';

const edge = testNetwork().graph.edges.find(e => e.id === 'e')!;
const sign = (dir: 1 | -1): Sign => ({ id: 's', code: CODE.stop, edgeId: 'e', dir, at: 100, origin: 'hand' });

describe('signPose', () => {
  it('stands at the right curb of eastbound traffic, facing west', () => {
    // e runs east along z = 0; the right of eastbound travel is south (+z).
    const p = signPose(edge, sign(1));
    expect(p.x).toBeCloseTo(100);
    expect(p.z).toBeCloseTo(edge.width / 2 + 1);
    expect(Math.sin(p.heading)).toBeCloseTo(-1);
  });

  it('stands on the north side for westbound traffic, facing east', () => {
    const p = signPose(edge, sign(-1));
    expect(p.z).toBeCloseTo(-(edge.width / 2 + 1));
    expect(Math.sin(p.heading)).toBeCloseTo(1);
  });
});

describe('plateKey', () => {
  it('gives each speed limit value its own plate', () => {
    const limit = (value: number): Sign => ({ ...sign(1), code: CODE.speedLimit, value });
    expect(plateKey(limit(50))).not.toBe(plateKey(limit(60)));
    expect(plateKey(sign(1))).toBe('stop');
  });
});
