import { treePositions } from './vegetation';
import { testDistrict } from './testDistrict';

const d = testDistrict();

test('same seed gives identical trees', () => {
  expect(treePositions(d, 7)).toEqual(treePositions(d, 7));
});

test('plants along the primary avenue and inside the park', () => {
  const t = treePositions(d, 7);
  expect(t.some(([, z]) => Math.abs(Math.abs(z) - 7) < 0.01)).toBe(true); // 8/2 + 3 from the avenue
  expect(t.some(([x, z]) => x > 0 && x < 40 && z > 30 && z < 70)).toBe(true);
});

test('no tree on a carriageway or inside a building', () => {
  for (const [x, z] of treePositions(d, 7)) {
    expect(Math.abs(z) > 4 || x < -100 || x > 100).toBe(true);
    expect(x > -40 && x < -20 && z > 20 && z < 40).toBe(false);
  }
});
