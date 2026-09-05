# 3D 에셋 — 무엇을 받아서 어떻게 넣나

보스 몬스터가 들어가면서 이 프로젝트도 외부 3D 모델을 쓸 수 있게 됐다.
이 문서는 **가구를 3D 모델로 바꾸고 싶을 때 어디서 무엇을 받아야 하는지**,
그리고 받은 파일을 어떻게 넣는지를 적는다.

지금 사무실 가구는 전부 `world/props.js` 의 절차적 지오메트리다.
그건 그것대로 잘 돌아가지만, 종류를 크게 늘리려면 손으로 박스를 쌓는
것보다 완성된 모델을 얹는 편이 빠르다.

---

## 0. 결론부터

**Quaternius 의 `Ultimate House Interior Pack` 을 먼저 받으세요.**

<https://quaternius.com/> → Interior/House 카테고리

이유는 하나다. **보스 몬스터와 같은 제작자, 같은 규격**이다.
지금 `assets/monsters/*.glb` 를 읽는 코드가 그대로 읽는다:

- 텍스처가 **아틀라스 한 장** (모델마다 이미지가 따로 붙지 않는다)
- **glTF/GLB** 로 바로 나온다 (변환 도구가 필요 없다)
- **CC0** (저작자 표시 의무 없음, 상업적 사용 가능)
- 로우폴리 · 셀 톤 — 지금 사무실의 절차적 머티리얼과 톤이 어긋나지 않는다

부족하면 그다음은 **Kenney 의 `Furniture Kit`** (140종, CC0).

---

## 1. 받을 곳

| 출처 | 링크 | 무엇이 있나 | 형식 | 라이선스 |
|---|---|---|---|---|
| **Quaternius** ★추천 | [quaternius.com](https://quaternius.com/) · [Ultimate House Interior Pack (poly.pizza)](https://poly.pizza/bundle/Ultimate-House-Interior-Pack-2SXnFbwFzm) | 실내 가구 80종+ (소파·책상·의자·선반·주방) | **GLB** + FBX | CC0 |
| **Kenney** | [kenney.nl/assets/furniture-kit](https://kenney.nl/assets/furniture-kit) · [GLB 재포장본](https://eclair-assets.itch.io/furniture-kit-glb-pack-140-free-cc0-3d-models) | 가구 140종 | OBJ/FBX, GLB 재포장본 있음 | CC0 |
| **Poly Pizza** | [poly.pizza](https://poly.pizza/) | 구 Google Poly 아카이브. 낱개로 검색해서 받기 좋다 | **GLB** 다운로드 버튼 | 대부분 CC0 / 일부 CC-BY |
| **KayKit** | [kaylousberg.itch.io/furniture-bits](https://kaylousberg.itch.io/furniture-bits) | 가구 파츠. 몬스터 팩과 스타일이 잘 붙는다 | GLB/FBX | CC0 |
| **Kenney 3D 전체** | [kenney.nl/assets/category:3D](https://kenney.nl/assets/category:3D) | 가구 말고도 소품 다수 | 다양 | CC0 |

**Poly Pizza 가 가장 편하다.** 낱개 모델마다 GLB 다운로드 버튼이 있어서
필요한 것만 골라 받을 수 있고, Quaternius·Kenney 팩도 거기 올라와 있다.

### 라이선스 확인

CC0 만 받으세요. CC-BY 는 표시 의무가 붙고, 그러면 게임 안에 크레딧
화면을 만들어야 한다. Poly Pizza 는 모델 페이지마다 라이선스가
적혀 있으니 받기 전에 확인할 것.

---

## 2. 어떤 가구가 필요한가

`game/furniture.js` 의 카탈로그가 지금 20종이다. 우선순위 순으로:

**꼭 필요한 것 (업무)**
- 책상 (1인용, 듀얼 모니터, 스탠딩) — 게임 진행의 핵심
- 사무용 의자
- 파티션 / 칸막이

**있으면 좋은 것 (휴게 — 쾌적도)**
- 소파 (2인/3인), 안락의자
- 커피 머신, 정수기, 자판기
- 원탁, 화분 (작은 것/큰 것), 러그

**분위기 (수납·전문)**
- 책장, 서류함, 사물함, 비품 선반
- 화이트보드, 게시판
- 서버 랙, 복합기

**모델 하나가 몇 폴리곤이면 되나**: 몬스터가 3~5천 삼각형이다.
가구는 **200~800 삼각형**이면 충분하다. 사무실에 40개가 놓이므로
개당 5천 짜리를 쓰면 건물(11,518 삼각형)보다 가구가 무거워진다.

---

## 3. 나에게 줄 때

파일을 그대로 주면 된다. **여러 개면 한꺼번에**, 형식은 상관없다:

- `.glb` — 가장 좋다. 바로 들어간다
- `.gltf` (base64 내장) — `tools/gltf2glb.mjs` 로 재포장한다
- `.fbx` / `.obj` — 변환이 필요하다. 되도록 GLB 판이 있는 곳에서 받을 것

**같이 알려주면 좋은 것**
- 출처와 라이선스 (Poly Pizza 링크면 그것만으로 충분)
- 어떤 가구로 쓸 건지 (책상? 소파? 새 카테고리?)

**피해야 할 것**
- 텍스처가 모델마다 따로 붙은 팩 (아틀라스 한 장짜리를 고를 것)
- 4K 텍스처. 모바일 게임이다. 몬스터 아틀라스는 9KB짜리 PNG 한 장이다
- 유료 에셋, 라이선스가 불분명한 것

---

## 4. 넣는 방법 (작업자용)

```bash
# 1. GLB 로 재포장 (.gltf 를 받았거나, 안 쓰는 애니메이션을 버리고 싶을 때)
node tools/gltf2glb.mjs 받은파일.gltf assets/furniture/desk.glb

# 2. 검증
node tools/monster.mjs        # 몬스터 정의를 늘렸다면
```

그다음 두 곳에 줄을 하나씩 추가한다.

```js
// game/furniture.js — 값과 효과
{ id: 'deskOak', ko: '원목 책상', cat: 'work', price: 18000, seats: true,
  comfort: 3, w: 5.4, d: 4.6, desc: '...' },

// world/placed.js — 어떻게 그리나
deskOak: (m, x, z, ry) => { /* 절차적 부품, 또는 GLB 인스턴스 */ },
```

**애니메이션 없는 GLB 는 몬스터와 같은 셰이더를 탄다.** `render/skinned.js`
가 `uSkinned = 0` 이면 스키닝을 건너뛰고 모델 행렬만 쓴다. 다만 지금
`DRAW` 표는 `MeshBuilder` 를 받도록 돼 있으므로, GLB 가구를 넣으려면
`world/placed.js` 에 "이 가구는 절차적이 아니라 모델" 이라는 분기를
하나 만들고 `main.js` 의 draw 에서 `SkinnedPass` 로 넘겨야 한다.
몬스터가 이미 그 경로를 쓰므로 새로 만들 것은 없다.

### 스케일 맞추기

이 게임의 1 유닛은 대략 **한 뼘(15cm 남짓)** 이다. 기준점:

| 것 | 높이 (유닛) |
|---|---|
| 사람 | 약 6.2 |
| 책상 상판 | 2.42 (`DESK_Y`) |
| 층 높이 | 13 (`STOREY`) |
| 아이디어 냥이 / 난제 오크 / 마감 데몬 | 4.2 / 7.6 / 9.4 |

`SkinnedModel` 이 모델의 바운딩 박스를 재두므로, 몬스터처럼
**원하는 높이를 적고 스케일은 계산시키는** 방식이 안전하다
(`game/monsters.js` 의 `height` 필드가 그것이다).

---

## 4-2. 가구는 GLB 가 아니라 삼각형으로 들여왔다

Kenney Furniture Kit 을 받아서 **OBJ 를 이 게임의 지오메트리로 구워** 넣었다.
GLB 를 `SkinnedPass` 로 따로 그리는 길도 있었지만, 삼각형만 뽑아서 사무실과
같은 메시에 섞으면 벽 자르기·AO 베이크·머티리얼 셰이더가 전부 그대로
따라오고 그리는 경로가 하나도 늘지 않는다. 텍스처도 한 장 안 들어온다 —
Kenney 의 OBJ 는 머티리얼마다 Kd(확산색)만 붙어 있어서 정점 색으로 옮기면
끝이고, 그 색이 절차적 가구와 톤이 어긋나지 않는다.

```bash
node tools/kit.mjs "<압축 푼 곳>/Models/OBJ format" assets/furniture/kit.json
```

- 배율은 `tools/kit.mjs` 의 `SCALE = 6.4` (Kenney 1 유닛 = 2m). 책상 상판이
  정확히 `DESK_Y`(2.42) 에 온다.
- 들여올 모델은 같은 파일의 `WANT` 목록. 140종을 다 넣을 이유가 없다 —
  파일 크기가 그대로 첫 로딩 시간이다 (지금 46종 · 173KB · gzip 36KB).
- 런타임은 `world/kit.js` 의 `kitPut(mesh, id, x, z, ry, opts)` 하나뿐이고,
  `world/placed.js` 의 `DRAW` 표가 그것을 세트로 조합한다 (책상 = 책상 +
  모니터 + 키보드 + 의자).
- 모델은 **ry=0 에서 북(-Z)을 본다**. 게임의 책상 약속과 같다.

## 5. 지금 들어 있는 것

```
assets/monsters/cat.glb     96 KB   아이디어 냥이  (조인트 4,  클립 5)
assets/monsters/orc.glb    425 KB   난제 오크      (조인트 43, 클립 5)
assets/monsters/demon.glb  414 KB   마감 데몬      (조인트 43, 클립 5)
assets/furniture/kit.json  173 KB   가구 46종 · 삼각형 13,194 (Kenney, CC0)
```

**Quaternius** 의 CC0 몬스터 팩(원본 아틀라스 이름 `Atlas_Monsters`,
Blender glTF 익스포터 v1.7.33)에서 왔다. 원본은 클립이 14개인데
게임이 쓰는 5개(Idle/Walk/Punch|Bite/HitReact/Death)만 남기고
`tools/gltf2glb.mjs` 로 재포장했다 — 오크 기준 1.25MB → 425KB.

CC0 이므로 표시 의무는 없지만, 출처를 적어두는 편이 낫다.
