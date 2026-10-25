import * as THREE from 'three';
import { testNetwork } from '../traffic/testNetwork';
import type { DistrictData, Sign } from '../shared/district';
import { addSigns, signPose } from './signs';
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

describe('addSigns', () => {
  const cell = (size: [number, number]) => ({ u: 0.1, v: 0.2, w: 0.05, h: 0.04, size });
  const art = {
    atlas: { width: 64, height: 64, cells: { '2.5': cell([0.7, 0.7]), '3.24:60': cell([0.7, 0.7]), '7.2.1:100': cell([0.6, 0.3]) } },
    texture: new THREE.Texture(),
  };
  const district = (signs: Sign[]) => ({ signs, graph: testNetwork().graph }) as unknown as DistrictData;
  const instanced = (scene: THREE.Scene) => scene.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh);

  it('draws every face as one instanced quad mesh and every pole as another', () => {
    const scene = new THREE.Scene();
    addSigns(scene, district([sign(1), { ...sign(-1), id: 't', code: CODE.speedLimit, value: 60, plates: [{ code: '7.2.1', value: 100 }] }]), art);
    const [faces, poles] = instanced(scene);
    expect(instanced(scene)).toHaveLength(2);
    expect(faces.count).toBe(3);
    expect(poles.count).toBe(2);
    expect(faces.geometry.getAttribute('aCell').itemSize).toBe(4);
    expect((faces.material as THREE.MeshLambertMaterial).alphaTest).toBe(0.5);
    expect(faces.receiveShadow && poles.receiveShadow).toBe(true);
  });

  it('skips a sign whose art is missing and says so once', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = new THREE.Scene();
    addSigns(scene, district([sign(1), { ...sign(-1), id: 'a', code: CODE.giveWay }, { ...sign(1), id: 'b', at: 150, code: CODE.giveWay }]), art);
    expect(instanced(scene)[0].count).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
