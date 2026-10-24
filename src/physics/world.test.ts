import { readFileSync } from 'node:fs';
import type { DistrictData } from '../shared/district';
import { LAMP_SEED, lampPositions } from '../world/streetside';
import { createPhysics } from './world';

const d: DistrictData = JSON.parse(readFileSync(new URL('../../public/districts/tashkent-center/district.json', import.meta.url), 'utf8'));

describe('lamp colliders', () => {
  it('sit at the rendered lamp positions and cover the 0.24 m pole base', async () => {
    const { world } = await createPhysics(d);
    const lamps = lampPositions(d, LAMP_SEED);
    const poles: { x: number; z: number; r: number }[] = [];
    world.colliders.forEach(c => {
      if (c.shapeType() !== 10 /* cylinder */) return;
      const t = c.translation();
      poles.push({ x: t.x, z: t.z, r: c.radius() });
    });
    expect(poles.length).toBe(lamps.length);
    lamps.forEach((l, i) => {
      expect(poles[i].x).toBeCloseTo(l.x, 3);
      expect(poles[i].z).toBeCloseTo(l.z, 3);
      expect(poles[i].r).toBeGreaterThanOrEqual(0.2 - 1e-6);
    });
  });
});
