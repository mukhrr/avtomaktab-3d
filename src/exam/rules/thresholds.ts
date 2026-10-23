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

/** A new edge or direction from the matcher must hold this long before fail-tier rules read it, so a wrong pick fails nobody. */
export const MATCH_SETTLE = 2;

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
/** An indicator that was on for INDICATOR_LEAD and went off this recently still signals the maneuver. */
export const INDICATOR_RECENT = 3;
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

/** Stopping distance used by the yielding and braking rules: v²/STOPPING_DIVISOR + STOPPING_MARGIN metres (v in m/s). */
export const STOPPING_DIVISOR = 8;
export const STOPPING_MARGIN = 2;
export const stoppingDistance = (v: number) => (v * v) / STOPPING_DIVISOR + STOPPING_MARGIN;
/** Half the zebra band along the road: ZEBRA_LENGTH / 2 in src/world/crossings.ts. */
export const CROSSING_HALF_DEPTH = 1.5;
/** The car's box must reach this far into the band to count as stopped on it, the same depth as the stopLinePast ceiling. */
export const CROSSING_OVERLAP = 0.5;
export const STOPPED_ON_CROSSING_HOLD = 2;
/** A stop this long short of a zebra lets the car go on while someone only waits at the curb. */
export const CURB_WAIT_RELEASE = 1;

/** A car with priority closer than this in time claims it: PRIORITY_TTA in src/traffic/trafficSim.ts. */
export const YIELD_TTA = 3;
/** Below this a car is standing, no threat until it moves off: MOVING in src/traffic/trafficSim.ts. */
export const YIELD_MOVING = 0.5;
/** A stop line this close to the end of the approach lane makes the junction signalled. */
export const SIGNAL_REACH = 40;
/** A left turner whose heading passes this from its approach heading is cutting across the oncoming lanes. */
export const LEFT_TURN_COMMIT = Math.PI / 4;

/** Half the car width: the centre this far beyond the lane divider puts the car over it. */
export const ONCOMING_LATERAL = 0.9;
export const ONCOMING_HOLD = 1;

export const COLLISION_DEBOUNCE = 3;
/** A yielding fail hides the crash that follows it within this. */
export const COLLISION_DEDUPE = 3;
/** m/s: below this the player counts as standing when a car hits it. */
export const COLLISION_STANDING = 1;
export const OBSTACLE_MIN_SPEED = 2;

export const HARSH_DECEL = 6;
export const HARSH_HOLD = 0.3;
export const HARSH_REPEAT = 10;
/** A crash this recent explains the deceleration. */
export const HARSH_CRASH_WINDOW = 1;

export const ROLLBACK_SPEED = 0.3;
export const ROLLBACK_DISTANCE = 0.5;
