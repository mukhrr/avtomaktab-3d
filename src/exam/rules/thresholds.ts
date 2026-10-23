/** m/s; below this the car counts as stopped. */
export const STOP_SPEED = 0.3;
/** Centre to front bumper, metres: HALF_EXTENTS.z in src/vehicle/vehicle.ts (kept apart so rules stay free of Rapier). */
export const FRONT_OFFSET = 2.24;
/** How far the front may sit past a stop line before it counts as over it. */
export const PAST_LINE = 0.5;
/** Front this far past a red stop line counts as entering the junction; short of it a stop is only stopLinePast. */
export const REDLIGHT_ENTRY = 2;

export const YELLOW_MAX_DECEL = 4;
export const STOP_LINE_PAST_HOLD = 1;
export const RED_LIGHT_DEDUPE = 3;

export const STOP_SIGN_WINDOW = 10;

export const NO_ENTRY_REACH = 40;
/** A new edge must stay matched this long before noEntry is charged, so a matcher flicker is not a fail. */
export const NO_ENTRY_HOLD = 0.5;
export const NO_ENTRY_DEDUPE = 10;
export const WRONG_WAY_HOLD = 1.5;

/** km/h: the measurement tolerance applied to every speed rule. */
export const SPEED_TOLERANCE = 5;
export const SPEEDING_PERIOD = 5;
export const SEVERE_OVER = 40;
export const SEVERE_SUSTAINED_OVER = 20;
export const SEVERE_SUSTAINED_HOLD = 3;

export const INDICATOR_LEAD = 1;
export const MIRROR_WINDOW = 6;
export const LANE_CHANGE_HOLD = 1;
/** After a junction exit, lane changes are watched again once the exit lane has held LANE_CHANGE_HOLD or after this far. */
export const EXIT_SETTLE_DISTANCE = 15;

export const TAILGATE_HEADWAY = 1;
export const TAILGATE_MIN_SPEED = 20;
export const TAILGATE_HOLD = 3;
export const TAILGATE_REPEAT = 10;

export const BELT_SPEED = 5;

/** Float accumulation slack for durations built from summed dt. */
export const EPS = 1e-6;

export const kmh = (ms: number) => Math.abs(ms) * 3.6;
