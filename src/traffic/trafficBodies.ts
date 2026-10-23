import RAPIER from '@dimforge/rapier3d-compat';
import { DRIVE_SURFACE_Y } from '../physics/world';
import { CAR_CLASSES, type AgentView, type CarClass } from './trafficSim';

const CAR_HEIGHT = 1.5;
const PARKED_Y = -100;

interface Slot {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  carClass: CarClass | null;
}

/** One kinematic cuboid per traffic pool slot so the player collides with AI cars. */
export class TrafficBodies {
  private slots: Slot[] = [];
  private handles = new Set<number>();

  constructor(world: RAPIER.World, count: number) {
    for (let i = 0; i < count; i++) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PARKED_Y, 0));
      const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(1, CAR_HEIGHT / 2, 2).setFriction(0.3), body);
      this.slots.push({ body, collider, carClass: null });
      this.handles.add(collider.handle);
    }
  }

  sync(agents: readonly AgentView[]): void {
    for (const a of agents) {
      const s = this.slots[a.id];
      if (!s) continue;
      if (!a.active) {
        s.body.setNextKinematicTranslation({ x: 0, y: PARKED_Y, z: 0 });
        continue;
      }
      if (s.carClass !== a.carClass) {
        const size = CAR_CLASSES[a.carClass];
        s.collider.setHalfExtents({ x: size.width / 2, y: CAR_HEIGHT / 2, z: size.length / 2 });
        s.carClass = a.carClass;
      }
      s.body.setNextKinematicTranslation({ x: a.position[0], y: DRIVE_SURFACE_Y + CAR_HEIGHT / 2, z: a.position[1] });
      s.body.setNextKinematicRotation({ x: 0, y: Math.sin(a.heading / 2), z: 0, w: Math.cos(a.heading / 2) });
    }
  }

  isTrafficCollider(handle: number): boolean {
    return this.handles.has(handle);
  }
}
