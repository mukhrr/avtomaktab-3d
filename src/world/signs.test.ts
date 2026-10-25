import { testNetwork } from '../traffic/testNetwork';
import type { Sign } from '../shared/district';
import { signPose } from './signs';
import { CODE, plateKey } from '../shared/signCatalogue';

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
    expect(plateKey(CODE.speedLimit, 50)).not.toBe(plateKey(CODE.speedLimit, 60));
    expect(plateKey(CODE.stop)).toBe('2.5');
    expect(plateKey(CODE.speedLimit, 60)).toBe('3.24:60');
    expect(plateKey('7.5.4', '8-19')).toBe('7.5.4:8-19');
  });
});
