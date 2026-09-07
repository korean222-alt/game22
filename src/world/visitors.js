/* 전시장에 온 사람들.

   부스 앞이 비어 있으면 그건 부스가 아니라 가구다. 방문자 수가 이 행사의
   유일한 결과인데 화면에 사람이 하나도 없으면, 그 숫자는 팝업 안의 글자로만
   존재한다.

   직원과 같은 몸(char/rig.js)과 같은 상태 기계(world/agents.js)를 쓴다.
   다른 것은 둘뿐이다: 길찾기 격자가 없고(전시장 바닥은 통째로 열려 있다),
   회사에 소속되지 않는다(이름표도 말풍선도 없다). 그래서 걷기는 목적지
   하나를 직선으로 향하는 것으로 충분하다.

   몸 하나당 VAO 가 하나 올라간다. 최대 규모에서 스물둘이면 사무실의 직원
   정원과 비슷한 수라, 폰에서도 이미 감당하는 만큼이다. 행사가 끝나면
   통째로 버린다. */

import { Agent, ST } from './agents.js';
import { Rig } from '../char/rig.js';
import { disposeMesh } from '../core/gl.js';
import { SKINS, HAIRS, SHIRTS, PANTS } from './palette.js';

const HAIRSTYLES = ['short', 'crop', 'curly', 'long', 'bob', 'pony', 'bun', 'balding'];

/* 관람객의 겉모습. game/staff.js 의 makeLook 과 같은 재료를 쓰되, 사원증
   목걸이 대신 관람객 배지 색이 훨씬 다양하다 — 무리로 보이려면 색이
   흩어져야 한다. */
function visitorLook(rnd) {
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const feminine = rnd() > 0.5;
  const look = {
    height: 0.90 + rnd() * 0.20,
    build: 0.86 + rnd() * 0.34,
    skin: pick(SKINS),
    hairCol: pick(HAIRS),
    hair: feminine ? pick(['long', 'bob', 'pony', 'bun', 'short']) : pick(HAIRSTYLES),
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    shoe: rnd() > 0.5 ? '#26221d' : '#3a3630',
    eyeCol: pick(['#4a5a6a', '#3a2e24', '#2f4a3a', '#5a4a3a']),
    glasses: rnd() > 0.55,
    shortSleeve: rnd() > 0.5,
    collar: rnd() > 0.6,
    lanyard: true,
    lanyardCol: pick(['#e8b055', '#c2354a', '#3f7ac2', '#4a9c62', '#8a5ec2']),
  };
  if (rnd() > 0.72) look.hoodie = pick(['#3a4048', '#4a3a48', '#38484a', '#403a52']);
  return look;
}

let _vid = 900000;

export class Visitors {
  constructor() {
    this.list = [];
    this.t = 0;
  }

  get count() { return this.list.length; }

  /* 사람을 세운다. 전부 입구에 서서, 시간차를 두고 하나씩 부스로 걸어간다 —
     한꺼번에 출발하면 군무가 되고, 군무는 사람으로 안 보인다. */
  spawn(n, hall, rnd) {
    this.dispose();
    this.t = 0;
    const e = hall.entrance;
    for (let i = 0; i < n; i++) {
      const id = _vid++;
      const a = new Agent({ id, name: '' }, new Rig(visitorLook(rnd)), (id * 2.399) % 6.28);
      a.placeAt(e.x + (rnd() - 0.5) * 20, e.z + rnd() * 8, Math.PI, 0);
      a.state = ST.STAND;
      a.goalYaw = Math.PI;
      // 언제 걷기 시작하는가. 앞사람이 자리를 잡을 때쯤 다음 사람이 들어온다.
      a.waitFor = 0.25 + i * (0.42 + rnd() * 0.3);
      a.spot = hall.spots[i % hall.spots.length];
      a.restUntil = 0;
      this.list.push(a);
    }
    return this.list.length;
  }

  dispose() {
    for (const a of this.list) disposeMesh(a.rig);
    this.list = [];
  }

  /* 직선으로 걷는다. 전시장 바닥에는 막는 것이 없으므로 격자가 필요 없다 —
     Agent 의 path 를 한 점짜리로 직접 채운다. */
  _walkTo(a, x, z) {
    a.path = [[x, z]];
    a.pathI = 0;
    a.endState = ST.STAND;
    a.state = ST.WALK;
    a.onArrive = null;
  }

  update(dt, time, hall, rnd) {
    this.t += dt;
    for (const a of this.list) {
      if (a.waitFor > 0) {
        a.waitFor -= dt;
        if (a.waitFor <= 0) this._walkTo(a, a.spot.x, a.spot.z);
      } else if (a.state === ST.STAND && this.t > a.restUntil) {
        /* 자리를 잡은 뒤에도 가끔 옆으로 옮긴다. 부스 앞에 붙박여 서 있는
           스무 명은 사람이 아니라 울타리다. */
        a.restUntil = this.t + 3.5 + rnd() * 6;
        if (rnd() < 0.55) {
          const s = hall.spots[Math.floor(rnd() * hall.spots.length)];
          this._walkTo(a, s.x + (rnd() - 0.5) * 3, s.z + (rnd() - 0.5) * 3);
        } else {
          // 부스 쪽을 본다. 안 보면 등을 돌린 관객이 된다.
          a.goalYaw = Math.atan2(hall.booth.x - a.x, hall.booth.z - a.z);
        }
      }
      a.update(dt, time);
      if (a.state === ST.STAND && !a.path) {
        a.goalYaw = Math.atan2(hall.booth.x - a.x, hall.booth.z - a.z);
      }
      a.solve(time);
    }
  }

  /* 다 같이 환호한다. 발표가 끝나는 순간에 부른다. */
  cheer(time, secs = 3.2) {
    for (const a of this.list) a.cheerUntil = time + secs;
  }

  draw(L, renderer) {
    for (const a of this.list) renderer.drawMesh(L, a.rig, a.rig.world);
  }
}
