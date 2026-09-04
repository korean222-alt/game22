/* 1인칭 모드의 가상 조이스틱.

   폰에서 가상 스틱이 "이상하게 간다"고 느껴지는 원인은 대개 셋 중 하나다.

     1. 스틱을 화면 한 곳에 고정해 두면, 엄지가 실제로 닿는 위치와 어긋난다.
        → **뜨는 스틱**: 왼쪽 영역을 누른 그 자리에 스틱이 생긴다.
     2. 손가락을 스틱 밖으로 끌면 벡터가 튄다.
        → 반경 밖은 **정규화해서 클램프**한다. 최대 속도로 계속 간다.
     3. 화면 좌표를 그대로 월드에 넣는다.
        → 여기서는 벡터만 만들고, 월드 변환은 카메라가 한다
          (`OrbitCamera.walkVector`). 방향 규약이 한 곳에만 있어야 한다.

   포인터 하나가 스틱을 잡으면 그 포인터는 끝까지 스틱의 것이다. 나머지
   포인터는 시점 회전으로 간다 — 걸으면서 둘러보는 조작이 성립하려면
   이 분리가 필요하다. */

const DEAD = 0.16;        // 이 아래는 정지 — 엄지가 가만히 있어도 흔들리지 않게
const RADIUS = 54;        // 스틱 최대 반경(px)

export class Joystick {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'stick';
    this.el.innerHTML = '<span class="knob"></span>';
    this.el.style.display = 'none';
    root.appendChild(this.el);
    this.knob = this.el.querySelector('.knob');

    this.pointer = null;      // 스틱을 잡은 포인터 id
    this.ox = 0; this.oy = 0; // 스틱이 생긴 자리
    this.vx = 0; this.vy = 0; // -1..1, 화면 좌표계 (y 아래가 +)
    this.enabled = false;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this.release();
  }

  /* 이 좌표에서 시작한 터치를 스틱이 가져갈 것인가.
     왼쪽 절반의 아래쪽 — 왼손 엄지가 닿는 자리다. */
  claims(x, y, vw, vh) {
    if (!this.enabled || this.pointer !== null) return false;
    return x < vw * 0.46 && y > vh * 0.32;
  }

  begin(id, x, y) {
    this.pointer = id;
    this.ox = x; this.oy = y;
    this.vx = 0; this.vy = 0;
    this.el.style.display = '';
    this.el.style.left = x + 'px';
    this.el.style.top = y + 'px';
    this._knob(0, 0);
  }

  move(id, x, y) {
    if (this.pointer !== id) return false;
    let dx = x - this.ox, dy = y - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) { dx = dx / d * RADIUS; dy = dy / d * RADIUS; }
    this._knob(dx, dy);
    const nx = dx / RADIUS, ny = dy / RADIUS;
    const n = Math.hypot(nx, ny);
    if (n < DEAD) { this.vx = 0; this.vy = 0; } else {
      // 데드존 바깥을 0..1 로 다시 펴준다. 이걸 안 하면 스틱을 조금만 밀어도
      // 이미 DEAD 만큼의 속도가 나와 튀는 느낌이 난다.
      const k = (n - DEAD) / (1 - DEAD) / n;
      this.vx = nx * k; this.vy = ny * k;
    }
    return true;
  }

  end(id) {
    if (this.pointer !== id) return false;
    this.release();
    return true;
  }

  release() {
    this.pointer = null;
    this.vx = 0; this.vy = 0;
    this.el.style.display = 'none';
  }

  /* 키보드(WASD)도 같은 벡터로 들어온다: 조작 경로가 하나면 버그도 하나다. */
  setKeys(k) {
    if (this.pointer !== null) return;
    const x = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const y = (k.back ? 1 : 0) - (k.fwd ? 1 : 0);
    const n = Math.hypot(x, y) || 1;
    this.vx = x / n * (x || y ? 1 : 0);
    this.vy = y / n * (x || y ? 1 : 0);
  }

  magnitude() { return Math.min(1, Math.hypot(this.vx, this.vy)); }

  _knob(dx, dy) {
    this.knob.style.transform = `translate(${dx}px,${dy}px)`;
  }

  dispose() { this.el.remove(); }
}
