import { fitBounds, markerLayout, MARKER_GAP, project } from './debriefMap';

const bounds = { minX: -100, maxX: 300, minZ: -50, maxZ: 150 };

describe('project', () => {
  it('maps the bounds to the canvas corners, x east to the right and z south downwards', () => {
    expect(project([[-100, -50], [300, 150], [100, 50]], bounds, { w: 400, h: 200 })).toEqual([[0, 0], [400, 200], [200, 100]]);
  });
});

describe('fitBounds', () => {
  it('pads the points and widens the short axis to the canvas aspect', () => {
    const b = fitBounds([[0, 0], [100, 0], [100, 20]], { w: 200, h: 200 }, 10);
    expect(b.maxX - b.minX).toBeCloseTo(120);
    expect(b.maxZ - b.minZ).toBeCloseTo(120);
    expect((b.minZ + b.maxZ) / 2).toBeCloseTo(10);
  });
});

describe('markerLayout', () => {
  const gap = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  it('separates overlapping markers by at least 14 px', () => {
    expect(MARKER_GAP).toBeGreaterThanOrEqual(14);
    const out = markerLayout([[50, 50], [50, 50], [52, 49], [50, 50]]);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) expect(gap(out[i], out[j])).toBeGreaterThanOrEqual(14);
    }
  });

  it('leaves markers that are already apart where they are', () => {
    expect(markerLayout([[10, 10], [100, 10]])).toEqual([[10, 10], [100, 10]]);
  });
});
