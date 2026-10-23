import { nearestLane } from './spawn';
import { testDistrict } from './testDistrict';

const d = testDistrict();

test('two-way road: right lane for travel along the edge, heading along it', () => {
  const lane = nearestLane(d, 0, -10)!;
  expect(lane.edge.id).toBe('avenue:0');
  expect(lane.position[1]).toBeCloseTo(2); // 8 m wide, 2 lanes: right-lane centre is 2 m south
  expect(lane.heading).toBeCloseTo(Math.PI / 2); // east
});

test('oneway road: rightmost lane, heading along travel direction', () => {
  const lane = nearestLane(d, 49, -60)!;
  expect(lane.edge.id).toBe('street:0');
  // heading south (+z); right of travel is -x; 7 m, 2 lanes: centre 1.75 m to the west
  expect(lane.position[0]).toBeCloseTo(48.25);
  expect(lane.heading).toBeCloseTo(0);
});

test('maxDistance limits the search, no limit always finds a lane', () => {
  expect(nearestLane(d, 1000, 1000, 20)).toBeNull();
  expect(nearestLane(d, 1000, 1000)?.edge.id).toBeDefined();
});
