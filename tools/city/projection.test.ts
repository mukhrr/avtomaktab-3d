import { makeProjection } from './projection';

const p = makeProjection({ lat: 41.3111, lon: 69.2797 });

test('origin maps to 0,0', () => expect(p(41.3111, 69.2797)).toEqual([0, 0]));

test('east is +x, north is -z', () => {
  const [x, z] = p(41.3111 + 0.001, 69.2797 + 0.001);
  expect(x).toBeCloseTo(83.6, 0);
  expect(z).toBeCloseTo(-110.5, 0);
});
