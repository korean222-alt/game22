/* 소리.

   이 게임은 완전 무음이었다. 화면은 3D 로 굴러가는데 아무 소리도 나지 않으면,
   눌렀는지 안 눌렀는지·맞았는지 안 맞았는지가 전부 눈으로만 온다. 타격감의
   절반은 소리다.

   ── 왜 절차적인가
   에셋 파일을 한 장도 들이지 않는 것이 이 프로젝트의 규칙이다 (HANDOFF 7).
   그래서 WebAudio 의 오실레이터와 노이즈 버퍼만으로 만든다. 파일 0바이트,
   첫 로딩 0초, 오프라인에서도 그대로 난다. 배경음악도 같은 재료로 짠다 —
   음표를 데이터로 적고, 스케줄러가 박자에 맞춰 오실레이터를 하나씩 띄운다.

   ── 진짜 음원을 쓰고 싶으면
   `assets/bgm/index.json` 에 이름을 적으면 그때부터 그쪽이 이긴다. 형식은
     { "dev": "tense.mp3", "boss": "final.mp3", "award": "gala.mp3" }
   이고, 파일은 같은 폴더에 둔다. 기본값은 빈 객체 `{}` 라서 아무 파일도
   안 받고 절차적 트랙으로 돈다 — 받아 온 음원이 있든 없든 게임은 같은
   소리로 난다는 뜻이다. (파일을 아예 안 두면 404 가 콘솔에 남으므로,
   빈 객체를 두는 편이 낫다.)

   ── 브라우저의 규칙
   오디오 컨텍스트는 **사용자 제스처 안에서만** 열린다. 그래서 첫 터치까지는
   아무것도 만들지 않고, 열리기 전의 모든 호출은 조용히 버린다. 소리가 안 나는
   것은 버그가 아니라 아직 안 만진 것이다.

   ── 겹침
   자동 전투는 초당 서너 방이 나간다. 같은 소리가 겹쳐 쌓이면 귀가 아프므로
   같은 이름의 소리는 최소 간격을 둔다. */

let ctx = null;
let master = null;              // 효과음 버스
let musicBus = null;            // 배경음 버스 — 따로 두어야 음악만 줄일 수 있다
let enabled = true;
let musicEnabled = true;
const last = new Map();          // 소리 이름 → 마지막으로 낸 시각

/* localStorage 는 감싼다 — 사파리 프라이빗에서 던진다. */
const KEY = 'socialdev3d.sound';
const MKEY = 'socialdev3d.music';
try {
  if (localStorage.getItem(KEY) === '0') enabled = false;
  if (localStorage.getItem(MKEY) === '0') musicEnabled = false;
} catch (e) { /* 저장이 안 되면 기본값으로 */ }

export function soundOn() { return enabled; }
export function musicOn() { return musicEnabled; }

export function setSound(on) {
  enabled = !!on;
  try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) { /* ignore */ }
  if (enabled && ctx && ctx.state === 'suspended') ctx.resume();
  return enabled;
}

export function setMusic(on) {
  musicEnabled = !!on;
  try { localStorage.setItem(MKEY, musicEnabled ? '1' : '0'); } catch (e) { /* ignore */ }
  if (!musicEnabled) stopMusicNow();
  else if (wantTrack) music(wantTrack, true);
  return musicEnabled;
}

/* ── 아이폰의 무음 스위치 ──
   iOS 사파리는 WebAudio 를 **벨소리** 취급한다. 옆면 스위치가 무음이면
   게임 소리도 통째로 안 난다 — 코드는 멀쩡히 도는데 아무 소리도 안 들리는,
   가장 알아채기 어려운 종류의 무음이다. iOS 16.4 부터 오디오 세션의 종류를
   직접 정할 수 있으므로, 여기서 '재생' 이라고 못 박는다. 없는 브라우저에서는
   그냥 아무 일도 안 일어난다. */
function claimPlayback() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch (e) { /* 지원하지 않는 브라우저 */ }
}

/* 첫 제스처에서 부른다. 여기 말고 다른 곳에서 컨텍스트를 만들면
   브라우저가 정지 상태로 만들어 놓고, 그 뒤로는 영영 안 울린다. */
export function initSound() {
  claimPlayback();
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    // 탭을 오래 두면 컨텍스트가 잠든다. 깨어난 김에 돌던 음악도 되살린다.
    if (wantTrack) music(wantTrack, true);
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    /* 0.28 이었다. 소리표의 한 방이 0.15 안팎이므로 스피커에 닿는 것은
       0.04 — 조용한 방에서 이어폰을 꽂아야 겨우 들리는 크기였고, 폰
       스피커로는 사실상 무음이었다. 게임 소리는 배경이지만, 들려야 배경이다. */
    master.gain.value = 0.62;
    /* 소리를 키운 만큼 겹칠 때가 무섭다. 자동 전투는 타격·번뜩임·상자·콤보가
       같은 0.1초 안에 겹쳐 나가고, 그 합이 1을 넘으면 스피커에서 지직거린다.
       리미터 한 장을 물려 두면 무엇을 얼마나 겹쳐 내든 그 위로는 안 올라간다 —
       소리표를 손볼 때마다 총합을 계산하지 않아도 된다는 뜻이다. */
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.0001;  // 트랙이 붙을 때 페이드인한다
    musicBus.connect(ctx.destination);
    /* 컨텍스트가 정지 상태로 태어나는 경우가 있다(제스처 밖에서 불렸거나,
       사파리가 늦게 붙잡을 때). 조용히 두면 그 판 내내 무음이므로 바로 깨운다. */
    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* 다음 터치에서 다시 */ });
    loadExternal();
    if (wantTrack) music(wantTrack, true);
  } catch (e) { ctx = null; }
  return ctx;
}

/* 살아 있는가. 설정 화면이 "소리가 왜 안 나지" 를 스스로 답할 수 있어야 한다. */
export function soundState() {
  if (!ctx) return 'off';
  return ctx.state;
}

/* ── 재료 ── */

function env(node, t0, a, d, peak, bus) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  node.connect(g);
  g.connect(bus || master);
  return g;
}

function tone({ freq = 440, to = null, type = 'sine', a = 0.004, d = 0.12, gain = 0.5, at = 0, bus = null, detune = 0 }) {
  const t0 = (at > 1e6 ? at : ctx.currentTime + at);   // 큰 값은 절대 시각으로 읽는다
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (detune) o.detune.setValueAtTime(detune, t0);
  if (to !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + a + d);
  env(o, t0, a, d, gain, bus);
  o.start(t0);
  o.stop(t0 + a + d + 0.02);
  return o;
}

let noiseBuf = null;
function noiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function noise({ d = 0.12, gain = 0.4, at = 0, hp = 400, lp = 6000, bus = null }) {
  const t0 = (at > 1e6 ? at : ctx.currentTime + at);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const f1 = ctx.createBiquadFilter(); f1.type = 'highpass'; f1.frequency.value = hp;
  const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp;
  src.connect(f1); f1.connect(f2);
  env(f2, t0, 0.003, d, gain, bus);
  src.start(t0);
  src.stop(t0 + d + 0.05);
}

/* ── 소리표 ──
   이름 하나가 게임의 사건 하나다. min 은 같은 소리를 다시 낼 수 있기까지의
   최소 간격(초) — 자동 전투가 초당 서너 방을 뿜기 때문에 이게 없으면
   타격음이 잡음이 된다. */
const SOUNDS = {
  // ── UI ──
  tap: { min: 0.03, play: () => tone({ freq: 660, to: 520, type: 'triangle', d: 0.05, gain: 0.16 }) },
  // 탭 전환은 손끝이 아니라 화면이 통째로 바뀌는 사건이다. tap 보다 넓게 낸다.
  tab: { min: 0.04, play: () => { tone({ freq: 520, to: 780, type: 'triangle', d: 0.07, gain: 0.15 }); noise({ d: 0.05, gain: 0.05, hp: 2600, lp: 11000 }); } },
  open: { min: 0.05, play: () => { tone({ freq: 420, to: 720, type: 'sine', d: 0.12, gain: 0.16 }); noise({ d: 0.09, gain: 0.05, hp: 1800, lp: 9000 }); } },
  close: { min: 0.05, play: () => tone({ freq: 640, to: 340, type: 'sine', d: 0.11, gain: 0.14 }) },
  buy: {
    min: 0.06,
    play: () => { tone({ freq: 880, type: 'triangle', d: 0.07, gain: 0.2 }); tone({ freq: 1320, type: 'sine', d: 0.09, gain: 0.14, at: 0.05 }); },
  },
  bad: { min: 0.1, play: () => tone({ freq: 190, to: 120, type: 'sawtooth', d: 0.16, gain: 0.18 }) },
  // 못 누르는 것을 눌렀을 때. bad 보다 짧고 마른 소리라야 "실패" 가 아니라 "잠김" 으로 읽힌다.
  deny: { min: 0.08, play: () => { tone({ freq: 230, type: 'square', d: 0.05, gain: 0.12 }); tone({ freq: 200, type: 'square', d: 0.07, gain: 0.11, at: 0.06 }); } },
  // 가구를 바닥에 내려놓을 때. 나무가 바닥에 닿는 소리.
  place: { min: 0.06, play: () => { noise({ d: 0.07, gain: 0.14, hp: 200, lp: 2600 }); tone({ freq: 150, to: 90, type: 'sine', d: 0.09, gain: 0.14 }); } },
  // 페이지·목록이 스르륵 넘어갈 때.
  swipe: { min: 0.05, play: () => noise({ d: 0.13, gain: 0.07, hp: 900, lp: 7000 }) },
  // 가방에서 무엇을 꺼내 쓸 때 — 밥, 음료, 장난감.
  eat: { min: 0.08, play: () => { noise({ d: 0.09, gain: 0.11, hp: 300, lp: 3200 }); tone({ freq: 260, to: 420, type: 'triangle', d: 0.12, gain: 0.13, at: 0.05 }); } },
  drink: { min: 0.08, play: () => { noise({ d: 0.14, gain: 0.07, hp: 1400, lp: 8000 }); tone({ freq: 700, to: 1100, type: 'sine', d: 0.16, gain: 0.13, at: 0.06 }); } },
  // 장비를 채운다. 금속이 걸리는 소리.
  equip: { min: 0.1, play: () => { tone({ freq: 1400, type: 'square', d: 0.04, gain: 0.09 }); tone({ freq: 700, to: 980, type: 'triangle', d: 0.13, gain: 0.14, at: 0.04 }); } },
  // 연구가 끝났다. 기계가 한 칸 돌아가는 소리.
  research: { min: 0.3, play: () => { [440, 587, 740].forEach((f, i) => tone({ freq: f, type: 'square', d: 0.11, gain: 0.11, at: i * 0.06 })); noise({ d: 0.2, gain: 0.05, hp: 2000, lp: 9000, at: 0.1 }); } },
  // 1인칭으로 걸을 때의 한 걸음. 카펫 위라 마르고 낮다.
  step: { min: 0.16, play: () => { noise({ d: 0.045, gain: 0.06 + Math.random() * 0.02, hp: 260, lp: 1700 }); tone({ freq: 96 + Math.random() * 22, to: 58, type: 'sine', d: 0.06, gain: 0.05 }); } },
  // 외주 계약서에 도장을 찍는다.
  stamp: { min: 0.2, play: () => { noise({ d: 0.05, gain: 0.2, hp: 150, lp: 2000 }); tone({ freq: 120, to: 60, type: 'sine', d: 0.12, gain: 0.16 }); } },

  // ── 개발 배틀 ──
  // 던지기. 타격이 나기 전에 뭔가가 날아간다는 것을 귀가 먼저 안다.
  swing: { min: 0.05, play: () => noise({ d: 0.11, gain: 0.09, hp: 700, lp: 5200 }) },
  hit: {
    min: 0.05,
    play: () => {
      noise({ d: 0.05, gain: 0.18, hp: 900, lp: 5200 });
      tone({ freq: 340 + Math.random() * 90, to: 190, type: 'square', d: 0.06, gain: 0.11 });
      // 아래를 한 겹 깐다. 고역만 있으면 '틱' 이지 '퍽' 이 아니다.
      tone({ freq: 120, to: 62, type: 'sine', d: 0.09, gain: 0.13 });
    },
  },
  // 큰 한 방 — 도우미의 능력, 약점 구간의 타격.
  hitHeavy: {
    min: 0.09,
    play: () => {
      noise({ d: 0.13, gain: 0.26, hp: 240, lp: 4200 });
      tone({ freq: 190, to: 55, type: 'square', d: 0.18, gain: 0.2 });
      tone({ freq: 90, to: 40, type: 'sine', d: 0.26, gain: 0.18 });
    },
  },
  crit: {
    min: 0.09,
    play: () => {
      noise({ d: 0.09, gain: 0.22, hp: 1400, lp: 9000 });
      tone({ freq: 880, to: 1760, type: 'triangle', d: 0.16, gain: 0.22 });
      tone({ freq: 1320, to: 2640, type: 'sine', d: 0.2, gain: 0.14, at: 0.05 });
      tone({ freq: 160, to: 70, type: 'sine', d: 0.2, gain: 0.16 });
    },
  },
  urge: { min: 0.05, play: () => tone({ freq: 520, to: 980, type: 'triangle', d: 0.09, gain: 0.2 }) },
  combo: {
    min: 0.04,
    play: (n = 1) => tone({
      // 콤보가 쌓일수록 음이 올라간다. 손끝이 아니라 귀로 콤보를 세게 된다.
      freq: 440 * Math.pow(2, Math.min(18, n) / 12), type: 'triangle', d: 0.09, gain: 0.2,
    }),
  },
  boss: {
    min: 0.25,
    play: () => { noise({ d: 0.22, gain: 0.26, hp: 60, lp: 900 }); tone({ freq: 150, to: 60, type: 'sawtooth', d: 0.26, gain: 0.2 }); },
  },
  // 새 보스가 무대에 선다. 아래에서 솟는 것이 소리로도 와야 한다.
  bossIn: {
    min: 0.5,
    play: () => {
      tone({ freq: 55, to: 165, type: 'sawtooth', a: 0.02, d: 0.7, gain: 0.2 });
      noise({ d: 0.55, gain: 0.14, hp: 40, lp: 700 });
      tone({ freq: 110, to: 82, type: 'square', d: 0.5, gain: 0.12, at: 0.2 });
    },
  },
  // 버그를 밟았다. 마지막 공정의 그 소리.
  squish: { min: 0.07, play: () => { noise({ d: 0.06, gain: 0.16, hp: 1800, lp: 12000 }); tone({ freq: 900, to: 220, type: 'sawtooth', d: 0.08, gain: 0.1 }); } },
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
  revive: { min: 0.2, play: () => { tone({ freq: 330, to: 660, type: 'triangle', d: 0.22, gain: 0.16 }); tone({ freq: 990, type: 'sine', d: 0.18, gain: 0.1, at: 0.12 }); } },

  // ── 회사 ──
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
  /* ── 시상식 ──
     사회자가 말을 하고, 북이 굴러가고, 봉투가 열리고, 박수가 터진다.
     네 소리가 순서대로 나야 그 자리가 '결과 화면' 이 아니라 '무대' 가 된다. */
  // 사회자의 한 마디. 실제 말이 아니라 말의 리듬이다 — 짧은 두 음.
  mc: { min: 0.05, play: () => { tone({ freq: 300 + Math.random() * 60, type: 'square', d: 0.035, gain: 0.05 }); tone({ freq: 250 + Math.random() * 50, type: 'square', d: 0.03, gain: 0.04, at: 0.045 }); } },
  // 드럼롤. 발표 직전의 그 소리.
  drum: {
    min: 0.9,
    play: () => {
      // 점점 커진다. 굴러가는 동안 커지지 않으면 그건 북이 아니라 잡음이다.
      for (let i = 0; i < 26; i++) {
        noise({ d: 0.045, gain: 0.05 + i * 0.005, hp: 120, lp: 2400, at: i * 0.048 });
      }
      noise({ d: 0.3, gain: 0.22, hp: 60, lp: 1400, at: 26 * 0.048 });
    },
  },
  // 봉투를 뜯는다.
  envelope: { min: 0.2, play: () => noise({ d: 0.22, gain: 0.1, hp: 2400, lp: 13000 }) },
  // 박수. 필터를 태운 노이즈 알갱이 수십 개.
  applause: {
    min: 1.0,
    play: () => {
      for (let i = 0; i < 46; i++) {
        noise({ d: 0.03 + Math.random() * 0.05, gain: 0.035 + Math.random() * 0.03,
          hp: 1200 + Math.random() * 1400, lp: 8000 + Math.random() * 4000,
          at: Math.random() * 1.5 });
      }
    },
  },
  // 트로피가 손에 들어온다.
  trophy: {
    min: 0.6,
    play: () => {
      [784, 988, 1175, 1568, 1976].forEach((f, i) => tone({ freq: f, type: 'sine', d: 0.5, gain: 0.16, at: i * 0.08 }));
      noise({ d: 0.8, gain: 0.06, hp: 3000, lp: 14000, at: 0.1 });
    },
  },
  // 남이 받았다. 축하는 하지만 우리 것이 아니다 — 장3도 대신 단3도.
  rival: { min: 0.4, play: () => { [523, 622, 784].forEach((f, i) => tone({ freq: f, type: 'triangle', d: 0.3, gain: 0.13, at: i * 0.1 })); } },
  coin: { min: 0.08, play: () => { tone({ freq: 1319, type: 'square', d: 0.05, gain: 0.12 }); tone({ freq: 1976, type: 'square', d: 0.09, gain: 0.1, at: 0.04 }); } },
  week: { min: 0.2, play: () => { tone({ freq: 587, type: 'triangle', d: 0.12, gain: 0.16 }); tone({ freq: 880, type: 'triangle', d: 0.16, gain: 0.13, at: 0.09 }); } },
  // 랭크가 올랐다. 회사에 한 번뿐인 사건이라 가장 넓게 낸다.
  rank: {
    min: 0.8,
    play: () => {
      [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone({ freq: f, type: 'triangle', d: 0.42, gain: 0.18, at: i * 0.08 }));
      noise({ d: 0.9, gain: 0.07, hp: 2400, lp: 13000, at: 0.2 });
    },
  },
  levelup: { min: 0.3, play: () => { [659, 880, 1319].forEach((f, i) => tone({ freq: f, type: 'triangle', d: 0.22, gain: 0.16, at: i * 0.07 })); } },
  hire: { min: 0.3, play: () => { tone({ freq: 523, type: 'triangle', d: 0.16, gain: 0.16 }); tone({ freq: 784, type: 'triangle', d: 0.24, gain: 0.14, at: 0.1 }); } },
  mail: { min: 0.3, play: () => { tone({ freq: 988, type: 'sine', d: 0.1, gain: 0.14 }); tone({ freq: 1319, type: 'sine', d: 0.14, gain: 0.11, at: 0.08 }); } },
  // 전화가 온다. 외주 의뢰의 그 소리.
  phone: {
    min: 0.8,
    play: () => {
      for (let k = 0; k < 2; k++) {
        for (let i = 0; i < 8; i++) tone({ freq: 1000, type: 'sine', d: 0.03, gain: 0.1, at: k * 0.7 + i * 0.05 });
      }
    },
  },
  // 룰렛이 도는 동안 한 칸씩.
  spin: { min: 0.02, play: () => tone({ freq: 1200, type: 'square', d: 0.02, gain: 0.07 }) },
  spinStop: { min: 0.3, play: () => { tone({ freq: 880, to: 1760, type: 'triangle', d: 0.18, gain: 0.2 }); noise({ d: 0.12, gain: 0.1, hp: 2000, lp: 12000 }); } },
  // 창밖에서 차가 지나간다. 아주 작게.
  horn: { min: 4.0, play: () => { tone({ freq: 392, type: 'sawtooth', d: 0.22, gain: 0.045 }); tone({ freq: 523, type: 'sawtooth', d: 0.22, gain: 0.035, at: 0.02 }); } },
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

export function hasSfx(name) { return !!SOUNDS[name]; }

/* ══════════════════════ 배경음악 ══════════════════════

   음표를 데이터로 적고, 스케줄러가 앞으로 0.4초치를 미리 예약한다. rAF 에
   맞춰 소리를 내면 탭이 백그라운드로 갈 때마다 박자가 무너지므로, 오디오
   시계(ctx.currentTime)만 보고 예약한다.

   한 트랙은 16분음 16칸짜리 한 마디다. 칸마다 무엇이 울릴지를 네 줄로 적는다:
     bass  반음 오프셋(루트 기준) 또는 null
     lead  아르페지오
     hat   0/1
     kick  0/1
   숫자가 아니라 소리의 모양은 트랙의 `voice` 가 정한다. */

const A1 = 55;                                   // 기준음
const semi = (n) => A1 * Math.pow(2, n / 12);

const TRACKS = {
  /* 개발 현장. 단5음계 위를 8분음 베이스가 계속 민다 — 쉬는 칸이 없어야
     "지금 시간이 가고 있다" 가 들린다. */
  dev: {
    bpm: 104, gain: 0.16,
    bass: [0, 0, null, 0, null, 0, null, 0, -4, -4, null, -4, null, -4, 3, 3],
    lead: [12, null, 15, null, 19, null, 15, null, 8, null, 12, null, 15, null, 12, 10],
    hat: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    leadType: 'triangle', bassType: 'square',
  },
  /* 마지막 공정. 반음 위아래로 흔들리는 베이스와 두 배로 빨라진 하이햇.
     같은 조성인데 조여드는 느낌만 다르다 — 무대가 바뀐 것이 아니라
     시간이 없어진 것이기 때문이다. */
  boss: {
    bpm: 132, gain: 0.18,
    bass: [0, 0, 1, 0, 0, 0, 1, 0, -2, -2, -1, -2, -2, -2, -1, -2],
    lead: [24, 23, 24, 27, 24, 23, 22, 20, 22, 20, 22, 24, 22, 20, 19, 17],
    hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    kick: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1],
    leadType: 'sawtooth', bassType: 'sawtooth',
  },
  /* 시상식. 넓고 느리고 밝다. 베이스는 마디의 첫 칸에만 있고, 나머지는
     종소리 하나가 천천히 떨어진다. */
  award: {
    bpm: 76, gain: 0.14,
    bass: [3, null, null, null, null, null, null, null, 8, null, null, null, null, null, null, null],
    lead: [27, null, null, 31, null, null, 34, null, 32, null, null, 34, null, null, 39, null],
    hat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    kick: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    leadType: 'sine', bassType: 'triangle',
  },
  /* 사무실. 게임의 절반은 여기서 흐른다 — 책상을 놓고, 사람을 뽑고,
     기획서를 뽑고, 정산을 읽는다. 그 시간이 통째로 무음이었다.

     그래서 가장 얌전한 트랙이다: 베이스는 두 마디에 한 번만 자리를 옮기고,
     리드는 넉 칸에 하나씩 떨어지고, 킥도 하이햇도 없다. 일하는 동안 계속
     도는 음악은 눈에 띄면 지는 것이라, "있다는 것을 모르는 채로 있는" 쪽을
     노렸다. */
  office: {
    bpm: 84, gain: 0.10,
    bass: [0, null, null, null, null, null, null, null, -5, null, null, null, null, null, 3, null],
    lead: [19, null, null, null, 22, null, null, 24, null, null, 19, null, null, null, 15, null],
    hat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    kick: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    leadType: 'sine', bassType: 'triangle',
  },
  /* 게임덱스 부스. 밝고 바쁘다. */
  expo: {
    bpm: 118, gain: 0.13,
    bass: [3, null, 3, null, 10, null, 10, null, 8, null, 8, null, 5, null, 5, 7],
    lead: [15, 19, 22, 19, 15, 19, 27, 22, 20, 24, 27, 24, 20, 17, 15, 17],
    hat: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    leadType: 'triangle', bassType: 'triangle',
  },
};

export function musicTracks() { return Object.keys(TRACKS); }

let wantTrack = null;      // 지금 울려야 하는 트랙 이름 (컨텍스트가 없어도 기억한다)
let curTrack = null;       // 실제로 돌고 있는 트랙
let timer = null;          // 스케줄러 인터벌
let nextTime = 0;          // 다음 칸의 오디오 시각
let step = 0;
let extSrc = null;         // 외부 음원을 쓰는 경우의 BufferSource

/* 외부 음원 목록. 없으면(기본) 조용히 포기하고 절차적 트랙만 쓴다. */
let extIndex = null;       // { dev: 'tense.mp3', ... }
const extBuf = new Map();  // 트랙 이름 → AudioBuffer | 'loading' | null
function loadExternal() {
  if (extIndex !== null) return;
  extIndex = {};
  fetch('./assets/bgm/index.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && typeof j === 'object') { extIndex = j; if (wantTrack) music(wantTrack, true); } })
    .catch(() => { /* 없는 것이 기본이다 */ });
}

function extLoad(name) {
  if (!extIndex || !extIndex[name]) return null;
  const have = extBuf.get(name);
  if (have === 'loading') return null;
  if (have !== undefined) return have;
  extBuf.set(name, 'loading');
  fetch('./assets/bgm/' + extIndex[name])
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((b) => ctx.decodeAudioData(b))
    .then((buf) => { extBuf.set(name, buf); if (curTrack === name) startTrack(name); })
    .catch(() => extBuf.set(name, null));
  return null;
}

function fade(to, secs = 0.6) {
  if (!musicBus) return;
  const t = ctx.currentTime;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), t);
  musicBus.gain.exponentialRampToValueAtTime(Math.max(0.0001, to), t + secs);
}

/* 트랙을 바꾼다. 같은 트랙을 다시 부르면 아무 일도 안 한다 — 화면 갱신
   때마다 부르는 자리가 많아서, 그때마다 처음부터 다시 시작하면 음악이
   영원히 첫 마디만 반복한다. */
export function music(name, force = false) {
  wantTrack = name || null;
  if (!ctx || ctx.state !== 'running') return;
  if (!musicEnabled || !name) { stopMusicNow(); return; }
  if (curTrack === name && !force && (timer || extSrc)) return;
  startTrack(name);
}

export function stopMusic() { music(null); }

function stopMusicNow() {
  if (timer) { clearInterval(timer); timer = null; }
  if (extSrc) { try { extSrc.stop(); } catch (e) { /* 이미 멈췄다 */ } extSrc = null; }
  curTrack = null;
  fade(0.0001, 0.4);
}

function startTrack(name) {
  const def = TRACKS[name];
  const buf = extLoad(name);
  if (timer) { clearInterval(timer); timer = null; }
  if (extSrc) { try { extSrc.stop(); } catch (e) { /* 이미 멈췄다 */ } extSrc = null; }
  curTrack = name;

  if (buf) {
    // 받아 온 음원이 있으면 그쪽이 이긴다.
    extSrc = ctx.createBufferSource();
    extSrc.buffer = buf;
    extSrc.loop = true;
    extSrc.connect(musicBus);
    extSrc.start();
    fade(0.5, 1.2);
    return;
  }
  if (!def) { curTrack = null; return; }

  step = 0;
  nextTime = ctx.currentTime + 0.06;
  fade(def.gain, 1.0);
  timer = setInterval(() => scheduler(def), 40);
  scheduler(def);
}

/* 앞으로 0.4초치를 미리 예약한다. 40ms 마다 도므로 늦어도 열 번은 겹쳐 본다 —
   탭이 잠깐 멈춰도 박자가 끊기지 않는다. */
function scheduler(def) {
  if (!ctx || ctx.state !== 'running') return;
  const spb = 60 / def.bpm / 4;                 // 16분음 한 칸의 길이
  /* 탭이 뒤로 가면 setInterval 이 초당 한 번으로 줄어든다. 그동안 밀린
     시간을 그대로 따라잡으려 들면, 돌아온 순간 수십 개의 음이 **전부 과거
     시각**으로 예약되어 한꺼번에 터진다. 많이 밀렸으면 따라잡지 말고
     지금부터 다시 센다 — 박자가 한 번 끊기는 편이 폭발보다 낫다. */
  if (nextTime < ctx.currentTime - 0.4) { nextTime = ctx.currentTime + 0.05; step = 0; }
  while (nextTime < ctx.currentTime + 0.4) {
    const i = step % 16;
    playStep(def, i, nextTime);
    nextTime += spb;
    step += 1;
  }
}

function playStep(def, i, t) {
  const b = def.bass[i];
  if (b !== null && b !== undefined) {
    tone({ freq: semi(b), type: def.bassType, a: 0.008, d: 0.16, gain: 0.5, at: t, bus: musicBus });
  }
  const l = def.lead[i];
  if (l !== null && l !== undefined) {
    tone({ freq: semi(l), type: def.leadType, a: 0.006, d: 0.2, gain: 0.22, at: t, bus: musicBus });
    // 아주 살짝 어긋난 한 겹을 더 얹는다. 한 겹이면 삐 소리, 두 겹이면 악기다.
    tone({ freq: semi(l), type: def.leadType, a: 0.006, d: 0.2, gain: 0.12, at: t + 0.012, bus: musicBus, detune: 7 });
  }
  if (def.hat[i]) noise({ d: 0.03, gain: 0.09, hp: 6000, lp: 15000, at: t, bus: musicBus });
  if (def.kick[i]) {
    tone({ freq: 110, to: 42, type: 'sine', a: 0.004, d: 0.12, gain: 0.7, at: t, bus: musicBus });
  }
}
