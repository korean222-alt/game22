/* 소리.

   이 게임은 완전 무음이었다. 화면은 3D 로 굴러가는데 아무 소리도 나지 않으면,
   눌렀는지 안 눌렀는지·맞았는지 안 맞았는지가 전부 눈으로만 온다. 타격감의
   절반은 소리다.

   ── 왜 절차적인가
   에셋 파일을 한 장도 들이지 않는 것이 이 프로젝트의 규칙이다 (HANDOFF 7).
   그래서 WebAudio 의 오실레이터와 노이즈 버퍼만으로 만든다. 파일 0바이트,
   첫 로딩 0초, 오프라인에서도 그대로 난다.

   ── 브라우저의 규칙
   오디오 컨텍스트는 **사용자 제스처 안에서만** 열린다. 그래서 첫 터치까지는
   아무것도 만들지 않고, 열리기 전의 모든 호출은 조용히 버린다. 소리가 안 나는
   것은 버그가 아니라 아직 안 만진 것이다.

   ── 겹침
   자동 전투는 초당 서너 방이 나간다. 같은 소리가 겹쳐 쌓이면 귀가 아프므로
   같은 이름의 소리는 최소 간격을 둔다. */

let ctx = null;
let master = null;
let enabled = true;
const last = new Map();          // 소리 이름 → 마지막으로 낸 시각

/* localStorage 는 감싼다 — 사파리 프라이빗에서 던진다. */
const KEY = 'socialdev3d.sound';
try {
  const v = localStorage.getItem(KEY);
  if (v === '0') enabled = false;
} catch (e) { /* 저장이 안 되면 기본값으로 */ }

export function soundOn() { return enabled; }

export function setSound(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) { /* ignore */ }
  if (enabled && ctx && ctx.state === 'suspended') ctx.resume();
  return enabled;
}

/* 첫 제스처에서 부른다. 여기 말고 다른 곳에서 컨텍스트를 만들면
   브라우저가 정지 상태로 만들어 놓고, 그 뒤로는 영영 안 울린다. */
export function initSound() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.28;      // 게임 소리는 배경이다. 크면 바로 끈다.
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
  return ctx;
}

/* ── 재료 ── */

function env(node, t0, a, d, peak) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  node.connect(g);
  g.connect(master);
  return g;
}

function tone({ freq = 440, to = null, type = 'sine', a = 0.004, d = 0.12, gain = 0.5, at = 0 }) {
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + a + d);
  env(o, t0, a, d, gain);
  o.start(t0);
  o.stop(t0 + a + d + 0.02);
}

let noiseBuf = null;
function noise({ d = 0.12, gain = 0.4, at = 0, hp = 400, lp = 6000 }) {
  const t0 = ctx.currentTime + at;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f1 = ctx.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = hp;
  const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp;
  src.connect(f1); f1.connect(f2);
  env(f2, t0, 0.003, d, gain);
  src.start(t0);
  src.stop(t0 + d + 0.05);
}

/* ── 소리표 ──
   이름 하나가 게임의 사건 하나다. min 은 같은 소리를 다시 낼 수 있기까지의
   최소 간격(초) — 자동 전투가 초당 서너 방을 뿜기 때문에 이게 없으면
   타격음이 잡음이 된다. */
const SOUNDS = {
  // UI
  tap: { min: 0.04, play: () => tone({ freq: 660, to: 520, type: 'triangle', d: 0.05, gain: 0.16 }) },
  buy: {
    min: 0.06,
    play: () => { tone({ freq: 880, type: 'triangle', d: 0.07, gain: 0.2 }); tone({ freq: 1320, type: 'sine', d: 0.09, gain: 0.14, at: 0.05 }); },
  },
  bad: { min: 0.1, play: () => tone({ freq: 190, to: 120, type: 'sawtooth', d: 0.16, gain: 0.18 }) },

  // 개발 배틀
  hit: {
    min: 0.055,
    play: () => {
      noise({ d: 0.05, gain: 0.16, hp: 900, lp: 5200 });
      tone({ freq: 340 + Math.random() * 90, to: 190, type: 'square', d: 0.06, gain: 0.10 });
    },
  },
  crit: {
    min: 0.09,
    play: () => {
      noise({ d: 0.09, gain: 0.22, hp: 1400, lp: 9000 });
      tone({ freq: 880, to: 1760, type: 'triangle', d: 0.16, gain: 0.22 });
      tone({ freq: 1320, to: 2640, type: 'sine', d: 0.2, gain: 0.14, at: 0.05 });
    },
  },
  urge: { min: 0.05, play: () => tone({ freq: 520, to: 980, type: 'triangle', d: 0.09, gain: 0.2 }) },
  combo: {
    min: 0.05,
    play: (n = 1) => tone({
      // 콤보가 쌓일수록 음이 올라간다. 손끝이 아니라 귀로 콤보를 세게 된다.
      freq: 440 * Math.pow(2, Math.min(18, n) / 12), type: 'triangle', d: 0.09, gain: 0.2,
    }),
  },
  boss: {
    min: 0.25,
    play: () => { noise({ d: 0.22, gain: 0.26, hp: 60, lp: 900 }); tone({ freq: 150, to: 60, type: 'sawtooth', d: 0.26, gain: 0.2 }); },
  },
  clear: {
    min: 0.4,
    play: () => {
      // 완전 4도 위로 세 번. 격파는 사건이므로 짧은 팡파르가 붙는다.
      [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', d: 0.24, gain: 0.2, at: i * 0.07 }));
    },
  },
  loot: {
    min: 0.2,
    play: () => { tone({ freq: 1046, type: 'sine', d: 0.1, gain: 0.18 }); tone({ freq: 1568, type: 'sine', d: 0.16, gain: 0.14, at: 0.07 }); },
  },
  down: { min: 0.2, play: () => tone({ freq: 300, to: 90, type: 'sawtooth', d: 0.3, gain: 0.18 }) },

  // 회사
  release: {
    min: 0.6,
    play: () => {
      [392, 523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', d: 0.3, gain: 0.2, at: i * 0.09 }));
      noise({ d: 0.5, gain: 0.1, hp: 2000, lp: 12000, at: 0.1 });
    },
  },
  award: {
    min: 0.6,
    play: () => {
      [659, 784, 988, 1319].forEach((f, i) => tone({ freq: f, type: 'sine', d: 0.35, gain: 0.2, at: i * 0.11 }));
    },
  },
  coin: { min: 0.08, play: () => { tone({ freq: 1319, type: 'square', d: 0.05, gain: 0.12 }); tone({ freq: 1976, type: 'square', d: 0.09, gain: 0.1, at: 0.04 }); } },
  week: { min: 0.2, play: () => { tone({ freq: 587, type: 'triangle', d: 0.12, gain: 0.16 }); tone({ freq: 880, type: 'triangle', d: 0.16, gain: 0.13, at: 0.09 }); } },
};

/* 소리 하나. 컨텍스트가 아직 없거나 꺼져 있으면 조용히 아무것도 안 한다 —
   부르는 쪽이 매번 확인해야 한다면 호출부가 전부 지저분해진다. */
export function sfx(name, arg) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const def = SOUNDS[name];
  if (!def) return;
  const now = ctx.currentTime;
  if (now - (last.get(name) || -9) < def.min) return;
  last.set(name, now);
  try { def.play(arg); } catch (e) { /* 오디오가 죽어도 게임은 돈다 */ }
}
