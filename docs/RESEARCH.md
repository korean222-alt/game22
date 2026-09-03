# 리서치 — 소셜게임 스토리 (Social Dev Story)

원작 조사 기록. 3D 리메이크의 시스템 설계 근거가 되는 자료다.

## 1. 원작 식별

| 항목 | 값 |
|---|---|
| 한국어 제목 | 소셜게임 스토리 |
| 영어 제목 | Social Dev Story |
| 일본어 원제 | ソーシャル夢物語 |
| 개발사 | 카이로소프트 (Kairosoft Co., Ltd) |
| 패키지명 | `net.kairosoft.android.snsdev` |
| 장르 | 경영 시뮬레이션 |
| 최신 버전 | 2.45 |

`게임개발 스토리`(Game Dev Story)의 계보를 잇지만, **개발 과정이 턴제 배틀**이라는 점에서
전작과 결정적으로 다르다. 이 배틀 시스템이 3D화의 핵심 볼거리다.

## 2. 카이로소프트 공통 시스템

- 첫 해 운영비는 스폰서가 대납한다.
- 자금이 바닥나면 게임에 따라 1~3회 비상금이 나온다.
- **숙련도가 회차 간 이월**되어 2회차 플레이가 반드시 유리하다.
- 도트 그래픽 + 건설/경영 시뮬레이션 + 랭킹 경쟁.

## 3. 개발 루프 (Development)

게임 내에서 게임을 만드는 것이 **수입·아이템·직원의 주 공급원**이다.

```
개발 시작
  → 플랫폼 선택
  → 직원이 기획서(proposal) 생성 (재고로 쌓아두거나 즉시 개발)
  → 하드웨어 선택 (플랫폼이 지원하는 최대 4종)
  → 수익 모델 3종 중 택 1
  → ★ 개발 배틀 ★
  → 완성 → 출시 → 운영
```

### 3.1 개발 배틀

- 아이디어에 **HP**가 있고, 직원이 데미지를 넣어 0으로 만들면 개발 완료.
- **스태미나**를 소모한다.
- 장르와 처음 맞붙은 뒤 **게임 내용(Game Content)** 아이디어를 고르고,
  이어서 **개발 방식(Development Method)** 아이디어를 고른다.
- 이 아이디어들과 장르의 **궁합(compatibility)** 이 최종 품질을 좌우하는 주요 인자다.
- 시리즈물(속편)은 편수가 늘수록 HP·데미지·스태미나 소모가 모두 증가한다.
  - 단독작: HP 60,000 미만
  - 7편째 5성 아이디어: HP 250,000 초과, 최대 데미지 999

### 3.2 수익 모델

| 모델 | 특징 |
|---|---|
| 유료 (Paid) | 초반 안정적 |
| 부분유료 (Free-to-Play) | 매출 상한이 높음 |
| 부분유료 장기운영 (F2P Long Term) | 랭크 25~30 이후에 최적 |

### 3.3 운영 (Managing)

- 최대 **3개**의 출시작을 동시 운영하며, 오프라인에서도 수익이 발생한다.
- 보유 자금 상한은 **회사 랭크**의 영향을 받는다.

## 4. 게임 품질 스탯

원작은 5개 품질 축을 쓴다.

| 스탯 | 원문 | 기여 직업 |
|---|---|---|
| 화제성 | Craze | 프로그래머, 사운드 |
| 조작성 | Usability | 프로그래머 |
| 임팩트 | Impact | 디자이너, 사운드 |
| 소셜 | Social | 네트워커 |
| 지속성 | Retention | 네트워커 |

## 5. 직원 (Employees)

| 직업 | 영향 스탯 |
|---|---|
| 프로그래머 (Programmer) | 화제성 + 조작성 |
| 디자이너 (Designer) | 임팩트 |
| 사운드 엔지니어 (Sound Engineer) | 화제성 + 임팩트 |
| 네트워커 (Networker) | 소셜 + 지속성 |
| 작가/기획자 (Writer) | 기획서 등급·랭크 |

### 5.1 성장

- **아이템을 줘서 레벨을 올린다.** 아이템 지급에는 돈이 들고, 레벨이 오를수록
  비용이 커진다 (레벨 98 근처에서 회당 약 $12,000).
- 지정된 **아이템 3종 + 최대 레벨** 도달 시 **전직**이 가능하다.
  전직하면 스탯과 최대 레벨이 오르고 직함이 바뀌지만 인건비(Job Cost)는 그대로다.
- **레벨 99**에서 "환생(reincarnate)"이 가능하다. 직업이 바뀌고 보너스 스탯·레벨이
  0으로 리셋되지만, 이전 직업의 기본 스탯과 성장 방식은 유지된다.

### 5.2 의욕 (Motivation)

- 주황색 초승달 아이콘으로 표시.
- **1포인트당 +0.5%** 의 스탯 배율. 기획·개발 등 여러 상황에 적용된다.
- 해당 직원의 기획서로 게임을 완성하면 의욕 +1.
- 의욕 상한은 회사 랭크에 따라 오른다.

## 6. 사무실 / 층 (Floors)

- 여러 층으로 사무실을 확장하고 직원을 배치한다.
- **모든 층의 작가가 기획서의 등급·랭크에 기여**하므로,
  작가 층과 개발자 층을 분리하는 편이 좋다.
- 자체 플랫폼 개발 이후에야 공간이 본격적으로 필요해진다.

## 7. 플랫폼 개발 (Platform Development)

- 자체 소셜 플랫폼을 만들고 육성한다.
- 업그레이드하면 **개발비 증가 + 팬층 변동 + 아이디어 HP 증가**.
- 한 번에 최대 4개 콘텐츠 타입을 올릴 수 있지만 **하나씩 올리는 편이 효율적**.
- 반복할수록 효율이 떨어지므로, 플랫폼 지식(Platform Knowledge)은 가장 값진
  콘텐츠 타입의 **첫 업그레이드**에 쓰는 것이 좋다.
- 협력사 업그레이드에는 스태미나가 든다.

## 8. 기타

- **코인(Coins)**: 프리미엄 재화. 아이템 상점에서 사용. 설치한 게임에 따라 지급량이 다름.
- **명예의 전당(Hall of Fame)**: 평론가 점수 합계가 기준치(전작 기준 32점) 이상이면 진입,
  이후 속편 제작이 가능해진다.
- **장르 × 내용 조합(combo)** 표가 존재하며, 궁합이 좋아야 고득점이 나온다.

## 9. 앱스토어 스크린샷에서 확인된 HUD

첨부된 한국어 앱스토어 스크린샷 기준:

```
Rank 10 | Stamina 13 | 💵 9988320 | 🪙 198 | [2F]
```

→ 랭크 · 스태미나 · 자금 · 코인 · 현재 층. 3D판 HUD는 이 구성을 그대로 따른다.

## 출처

- [카이로소프트 — 나무위키](https://namu.wiki/w/%EC%B9%B4%EC%9D%B4%EB%A1%9C%EC%86%8C%ED%94%84%ED%8A%B8)
- [Social Dev Story — Kairosoft Wiki](https://kairosoft.wiki.gg/wiki/Social_Dev_Story)
- [Development (Social Dev Story) — Kairosoft Wiki](https://kairosoft.wiki.gg/wiki/Development_(Social_Dev_Story))
- [Tips (Social Dev Story) — Kairosoft Wiki](https://kairosoft.wiki.gg/wiki/Tips_(Social_Dev_Story))
- [Employees (Social Dev Story) — Kairosoft Wiki](https://kairosoft.wiki.gg/wiki/Employees_(Social_Dev_Story))
- [Platform Development (Social Dev Story) — Kairosoft Wiki](https://kairosoft.fandom.com/wiki/Platform_Development_(Social_Dev_Story))
- [Social Dev Story — Google Play](https://play.google.com/store/apps/details?id=net.kairosoft.android.snsdev_en)
- [소셜게임 스토리 APK 정보](https://m.memuplay.com/ko/download-net.kairosoft.android.snsdev_en-apk.html)
