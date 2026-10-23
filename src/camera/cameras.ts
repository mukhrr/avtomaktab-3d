import * as THREE from 'three';

export type CameraMode = 'chase' | 'cockpit' | 'top';

const MODES: CameraMode[] = ['chase', 'cockpit', 'top'];
const CHASE_BACK = 7;
const CHASE_BACK_MAX = 10;
const CHASE_UP = 2.8;
const TOP_BACK = 25;
const TOP_UP = 18;
const FOLLOW_RATE = 5;
// Driver's eye relative to the chassis centre (left-hand drive, car faces +z so the driver sits at +x).
const DRIVER_EYE = new THREE.Vector3(0.35, 0.38, -0.1);
const MAX_YAW = THREE.MathUtils.degToRad(100);
const MAX_PITCH = THREE.MathUtils.degToRad(30);
const LOOK_SENSITIVITY = 0.005;
const RECENTRE_RATE = 6;
/** Car body meshes live on this layer so the cockpit camera can hide them. */
export const CAR_LAYER = 1;

export const nextMode = (m: CameraMode): CameraMode => MODES[(MODES.indexOf(m) + 1) % MODES.length];

export function chaseOffset(_heading: number, speed: number): { back: number; up: number } {
  return { back: Math.min(CHASE_BACK_MAX, CHASE_BACK + Math.abs(speed) * 0.05), up: CHASE_UP };
}

export class CameraRig {
  mode: CameraMode = 'chase';
  private yaw = 0;
  private pitch = 0;
  private dragging = false;
  private readonly pos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    camera.layers.enable(CAR_LAYER);
    dom.addEventListener('pointerdown', () => (this.dragging = this.mode === 'cockpit'));
    addEventListener('pointerup', () => (this.dragging = false));
    addEventListener('pointermove', e => {
      if (!this.dragging) return;
      this.yaw = THREE.MathUtils.clamp(this.yaw - e.movementX * LOOK_SENSITIVITY, -MAX_YAW, MAX_YAW);
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    });
  }

  /** Head yaw in cockpit view, radians, positive = looking left. Used for mirror checks in M3. */
  get headYaw(): number {
    return this.mode === 'cockpit' ? this.yaw : 0;
  }

  cycle(): void {
    this.mode = nextMode(this.mode);
    this.yaw = this.pitch = 0;
    if (this.mode === 'cockpit') this.camera.layers.disable(CAR_LAYER);
    else this.camera.layers.enable(CAR_LAYER);
  }

  update(car: THREE.Object3D, speed: number, dt: number): void {
    const p = car.position;
    if (this.mode === 'cockpit') {
      if (!this.dragging) {
        const k = Math.exp(-dt * RECENTRE_RATE);
        this.yaw *= k;
        this.pitch *= k;
      }
      this.camera.position.copy(DRIVER_EYE).applyQuaternion(car.quaternion).add(p);
      this.camera.quaternion.copy(car.quaternion).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.pitch, Math.PI + this.yaw, 0, 'YXZ')),
      );
      return;
    }
    this.fwd.set(0, 0, 1).applyQuaternion(car.quaternion).setY(0).normalize();
    const { back, up } = this.mode === 'chase' ? chaseOffset(0, speed) : { back: TOP_BACK, up: TOP_UP };
    this.pos.copy(p).addScaledVector(this.fwd, -back).setY(p.y + up);
    this.camera.position.lerp(this.pos, 1 - Math.exp(-dt * FOLLOW_RATE));
    this.camera.lookAt(this.target.copy(p).addScaledVector(this.fwd, 4).setY(p.y + 1));
  }
}
