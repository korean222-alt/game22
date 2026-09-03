/* Staff agents: the people you can see.

   An Agent owns one rig and a small state machine — sit, walk, stand, meet,
   talk. It knows how to path across a floor and how to hold a pose; it knows
   nothing about game rules. The Crew above it decides where people should be:
   at their desk while the company works, round the table when a game is being
   planned, and wandering to the coffee machine the rest of the time.

   Everything is driven from world position, so the same code serves a staffer
   walking to a meeting and one strolling to the window. */

import { angLerp, clamp } from '../core/math.js';
import { SEAT_HIP } from '../char/rig.js';
import {
  poseSit, poseSitBack, poseStand, poseWalk, poseTalk, poseCheer, poseSlump, applyReact,
} from '../char/poses.js';
import { STOREY } from './props.js';

export const ST = { SIT: 'sit', WALK: 'walk', STAND: 'stand', MEET: 'meet', TALK: 'talk' };

const WALK_SPEED = 8.0;      // world units per second
const TURN_RATE = 7.0;

export class Agent {
  constructor(staff, rig, seed) {
    this.id = staff.id;
    this.name = staff.name;
    this.rig = rig;
    this.seed = seed;
    this.state = ST.SIT;
    this.x = 0; this.z = 0; this.yaw = 0; this.floor = 0;
    this.path = null; this.pathI = 0;
    this.goalYaw = 0;
    this.phase = 0;
    this.bubble = null;        // { text, left, kind }
    this.react = null;         // { kind, life, left }
    this.onArrive = null;
    this.home = null;          // the desk this person belongs to
    this.busy = false;         // on the current project's team
    this.cheerUntil = 0;
    this.mood = 3;
    this.idleUntil = 0;        // ambient scheduler cooldown
    this.hipY = 0;
  }

  placeAt(x, z, yaw, floor) {
    this.x = x; this.z = z; this.yaw = yaw; this.floor = floor;
    this.path = null; this.onArrive = null;
  }

  sitAt(seat) {
    this.placeAt(seat.x, seat.z, seat.yaw, seat.floor ?? this.floor);
    this.state = ST.SIT;
  }

  /* Walk to a point. `nav` is the floor's grid; when it cannot find a route the
     agent teleports rather than freezing — a stuck body in the middle of the
     office is worse than an unexplained one at the desk. */
  goTo(target, nav, onArrive) {
    const sameFloor = (target.floor ?? this.floor) === this.floor;
    if (!sameFloor) {
      // Between floors the agent uses the stairwell off-screen: the player is
      // only ever looking at one storey, so a cut is honest and cheap.
      this.floor = target.floor;
      this.placeAt(target.x, target.z, target.yaw ?? this.yaw, target.floor);
      this.state = target.state || ST.SIT;
      if (onArrive) onArrive(this);
      return;
    }
    const route = nav ? nav.path(this.x, this.z, target.x, target.z) : null;
    if (!route || !route.length) {
      this.placeAt(target.x, target.z, target.yaw ?? this.yaw, this.floor);
      this.state = target.state || ST.SIT;
      if (onArrive) onArrive(this);
      return;
    }
    this.path = route;
    this.pathI = 0;
    this.goalYaw = target.yaw ?? this.yaw;
    this.endState = target.state || ST.SIT;
    this.state = ST.WALK;
    this.onArrive = onArrive || null;
  }

  say(text, secs = 3.2, kind = '') {
    this.bubble = { text, left: secs, kind };
  }

  reactWith(kind, secs) {
    this.react = { kind, life: 0, left: secs };
  }

  get walking() { return this.state === ST.WALK; }

  update(dt, t) {
    if (this.bubble) {
      this.bubble.left -= dt;
      if (this.bubble.left <= 0) this.bubble = null;
    }
    if (this.react) {
      this.react.life += dt;
      this.react.left -= dt;
      if (this.react.left <= 0) this.react = null;
    }

    if (this.state === ST.WALK && this.path) {
      const [tx, tz] = this.path[this.pathI];
      const dx = tx - this.x, dz = tz - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.35) {
        this.pathI++;
        if (this.pathI >= this.path.length) {
          this.path = null;
          this.state = this.endState || ST.SIT;
          const cb = this.onArrive; this.onArrive = null;
          if (cb) cb(this);
        }
      } else {
        const step = Math.min(d, WALK_SPEED * dt);
        this.x += dx / d * step;
        this.z += dz / d * step;
        this.yaw = angLerp(this.yaw, Math.atan2(dx, dz), clamp(dt * TURN_RATE, 0, 1));
        this.phase += step * 1.15;
      }
    } else {
      this.yaw = angLerp(this.yaw, this.goalYaw || this.yaw, clamp(dt * TURN_RATE, 0, 1));
    }
  }

  /* Pick the pose for this frame and push it through the rig. */
  solve(t) {
    const D = this.rig.D;
    const base = this.floor * STOREY;
    let pose, hip, x = this.x, z = this.z;

    if (this.state === ST.WALK) {
      pose = poseWalk(this.phase, t, this.seed);
      hip = base + D.hipY;
    } else if (this.cheerUntil > t) {
      pose = poseCheer(t, this.seed);
      hip = base + D.hipY;
    } else if (this.state === ST.TALK) {
      pose = poseTalk(t, this.seed);
      hip = base + D.hipY;
    } else if (this.state === ST.STAND) {
      pose = poseStand(t, this.seed);
      hip = base + D.hipY;
    } else if (this.state === ST.MEET) {
      // Around a table people lean back and look at whoever is talking, rather
      // than typing; the bubble timer doubles as "this person has the floor".
      pose = this.bubble ? poseTalk(t, this.seed) : poseSitBack(t, this.seed, D);
      hip = base + SEAT_HIP;
      if (this.bubble) hip = base + SEAT_HIP;
    } else {
      if (this.mood <= 1) pose = poseSlump(t, this.seed, D);
      else if (this.busy) pose = poseSit(t, this.seed, true, D);
      else if (((this.id * 7 + Math.floor(t / 9)) % 5) === 0) pose = poseSitBack(t, this.seed, D);
      else pose = poseSit(t, this.seed, false, D);
      hip = base + SEAT_HIP;
    }

    // A seated meeting pose keeps the hips over the chair; a talking one at the
    // table must not stand the body up out of it.
    if (this.state === ST.MEET && this.bubble) {
      pose = { ...pose, hipL: -1.48, kneeL: 1.15, hipR: -1.48, kneeR: 1.15 };
    }

    pose = applyReact(pose, this.react, t);
    if (pose.bob) hip += pose.bob;
    this.hipY = hip;
    this.rig.solve(x, hip, z, this.yaw, pose);

    // Where a name tag or a speech bubble should hang.
    this.headY = hip + D.pelvis + D.spine + D.chest + D.neck + D.headR * 1.7;
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */

/* The Crew places agents. It holds the meeting choreography and the ambient
   wandering that makes an idle office look inhabited rather than frozen. */
export class Crew {
  constructor() {
    this.agents = new Map();
    this.navs = [];            // one NavGrid per floor
    this.meetings = [];
    this.spots = [];
    this.meeting = null;       // { floor, seated:Set, teamIds }
    this.spotTaken = new Set();
  }

  setWorld({ navs, meetings, spots }) {
    this.navs = navs || [];
    this.meetings = meetings || [];
    this.spots = spots || [];
  }

  navFor(floor) { return this.navs[floor] || this.navs[0] || null; }
  meetingOn(floor) { return this.meetings.find((mm) => mm.floor === floor) || this.meetings[0]; }

  add(agent) { this.agents.set(agent.id, agent); }
  remove(id) { this.agents.delete(id); }
  get(id) { return this.agents.get(id); }
  all() { return [...this.agents.values()]; }

  /* Send everyone home to their desk. */
  sendHome(ids) {
    for (const a of this.all()) {
      if (ids && !ids.includes(a.id)) continue;
      if (!a.home) continue;
      a.goTo({ x: a.home.seatX, z: a.home.seatZ, yaw: a.home.yaw, floor: a.home.floor, state: ST.SIT },
        this.navFor(a.floor));
    }
  }

  /* ---- the meeting ----
     Everyone on the team walks to the room and takes a chair. `onSeated` fires
     once the last of them is down, which is when the dialogue starts. */
  startMeeting(teamIds, floor, onSeated) {
    const mtg = this.meetingOn(floor);
    if (!mtg) { if (onSeated) onSeated(); return null; }
    const team = teamIds.map((id) => this.get(id)).filter(Boolean);
    if (!team.length) { if (onSeated) onSeated(); return null; }

    const seats = [mtg.head, ...mtg.seats];
    let pending = team.length;
    const arrived = () => { if (--pending <= 0 && onSeated) onSeated(); };

    // Set before dispatching anyone: goTo can complete synchronously when there
    // is no route, and forceSeat needs the meeting to exist by then.
    this.meeting = { floor: mtg.floor, teamIds: team.map((a) => a.id), room: mtg };

    team.forEach((a, i) => {
      const seat = seats[i % seats.length];
      // Everyone gathers on the meeting floor, whichever storey they work on.
      if (a.floor !== mtg.floor) a.floor = mtg.floor;
      a.busy = true;
      a.seatTarget = { ...seat, floor: mtg.floor };
      a.goTo({ x: seat.x, z: seat.z, yaw: seat.yaw, floor: mtg.floor, state: ST.MEET },
        this.navFor(mtg.floor), arrived);
    });
    return mtg;
  }

  /* Put anyone still on their feet straight into their chair.
     A cutscene cannot wait on the walk finishing: frame time is clamped for
     simulation stability, so on a slow device the walk runs in slow motion and
     a scene that waits for it would stall for half a minute. */
  forceSeat() {
    if (!this.meeting) return 0;
    let moved = 0;
    for (const id of this.meeting.teamIds) {
      const a = this.get(id);
      if (!a || !a.seatTarget || a.state === ST.MEET) continue;
      a.placeAt(a.seatTarget.x, a.seatTarget.z, a.seatTarget.yaw, this.meeting.floor);
      a.goalYaw = a.seatTarget.yaw;
      a.state = ST.MEET;
      moved++;
    }
    return moved;
  }

  endMeeting() {
    if (!this.meeting) return;
    const ids = this.meeting.teamIds;
    this.meeting = null;
    for (const id of ids) { const a = this.get(id); if (a) a.seatTarget = null; }
    this.sendHome(ids);
  }

  inMeeting() { return !!this.meeting; }

  /* ---- ambient life ----
     Occasionally an idle staffer gets up, walks to an amenity, stands there a
     moment and comes back. Deliberately rare: a floor where everyone is
     permanently in motion reads as chaos, not as an office. */
  ambient(dt, t, rnd) {
    if (this.meeting) return;
    for (const a of this.all()) {
      if (a.busy || a.walking || a.state === ST.MEET) continue;
      if (t < a.idleUntil) continue;

      if (a.state === ST.STAND) {
        // Been standing at a spot long enough; head back to the desk.
        if (a.home) {
          this.spotTaken.delete(a.spotKey);
          a.spotKey = null;
          a.goTo({ x: a.home.seatX, z: a.home.seatZ, yaw: a.home.yaw, floor: a.home.floor, state: ST.SIT },
            this.navFor(a.floor));
        }
        a.idleUntil = t + 40 + rnd() * 70;
        continue;
      }

      // Roughly once every couple of minutes per person.
      if (rnd() > 0.0016) { a.idleUntil = t + 0.6; continue; }
      const options = this.spots.filter((s) => s.floor === a.floor && !this.spotTaken.has(s.kind + s.x));
      if (!options.length) { a.idleUntil = t + 20; continue; }
      const spot = options[Math.floor(rnd() * options.length)];
      const key = spot.kind + spot.x;
      this.spotTaken.add(key);
      a.spotKey = key;
      a.goTo({ x: spot.x, z: spot.z, yaw: spot.yaw, floor: spot.floor, state: ST.STAND },
        this.navFor(a.floor), () => { a.idleUntil = t + 6 + rnd() * 10; });
    }
  }

  update(dt, t, rnd) {
    for (const a of this.all()) a.update(dt, t);
    this.ambient(dt, t, rnd);
    for (const a of this.all()) a.solve(t);
  }
}
