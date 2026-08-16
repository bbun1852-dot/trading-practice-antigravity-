# Part 8 — UI 설계

2026-08-14 · 상태 **확정 (구현 전 스펙)**

선행 결정 두 개를 전제한다. 여기서 다시 다투지 않는다.
- 태그 선택 UX: `2026-08-13-tag-selection-ux-decision.md` (34점 시트 행 + 금지 5)
- 스택: `2026-08-13-ui-stack-comparison.md` (React 19 + Vite + lightweight-charts 5 + zustand)

## 1. 목표와 비목표

**목표** — 브라우저에서: 문제 생성 → 차트 보고 답안 작성 → 채점 → 재생 → 복기 → 오답노트. 헤드리스 엔진(`src/analysis`·`src/quiz`)은 **한 줄도 고치지 않는 것이 기본값**이다. 고쳐야 한다면 그건 엔진 결함 발견이고, 별도 커밋으로 뗀다.

**비목표**
- 로그인·서버·배포 (로컬 도구다. 배포는 UI가 선 다음)
- **치팅 방지.** 클라이언트 단독 앱이라 Question 전체가 결국 브라우저 메모리에 있다. devtools 로 은닉 봉을 까볼 수 있고, 막을 수 없고, 막지 않는다 — 본인 연습 도구다. 우리가 지키는 것은 "UI 가 **실수로** 흘리지 않는다" 이다 (4절)
- 15m·1h 타임프레임. **calibrate 가 4h·1d 만 검증했다.** 다른 TF 는 게이트를 다시 재는 별도 파트다. 따라서 v1 에서 34점 프로파일은 swing(4h)·position(1d)만 실제로 쓰인다 — scalp 은 코드에 있지만 도달 불가
- 모바일 레이아웃, 사용자 프로파일 편집

## 2. 아키텍처 — 레이어 경계

```
src/analysis, src/quiz     엔진. 순수 함수. UI 를 모른다 (기존 그대로)
src/data                   cache.ts(IndexedDB·브라우저) / fileCache.ts(fs·스크립트 전용)
src/ui                     ★ 신설. React 컴포넌트 + zustand store
scripts                    Node 스크립트 (drill·calibrate·verify)
```

**경계 규칙 (테스트로 잠근다, 6절):** `src/ui/**` 는 `fileCache` 와 `node:*` 를 import 하지 않는다. 브라우저 데이터는 `cache.ts` 로만 온다.

실측으로 확인한 재사용 가능 자산 — **데이터 계층은 거의 이미 있다**:
- `binance.ts` 의 `fetchKlines` 는 전역 `fetch` 사용 → 브라우저 그대로 동작
- `cache.ts` 는 **이미 idb 기반 IndexedDB 캔들 캐시**다 (Part 2 때 만들고 소비자가 없던 것). Task 3 은 신규 구현이 아니라 fileCache 와의 의미론 동등(버전·검증·손상 시 폐기) 확인·보강이다

### 화면 상태 머신

라우터를 쓰지 않는다. 화면 3개·전이 단방향이라 상태 하나로 충분하다.

```
idle ──시작──▶ loading ──▶ answering ──제출──▶ replaying ──▶ review ──다음──▶ loading
  │                                                            │
  └────────────── notebook (오답노트, 어디서든 진입/복귀) ◀────┘
```

### store (zustand) 슬라이스

| 슬라이스 | 내용 | 은닉 규약 |
|---|---|---|
| question | `phase`, `view: SolverView`, `question: Question` | **answering 단계 컴포넌트는 `view` 만 구독한다.** `question` 은 grade·replay·review 에서만 읽는다 |
| answer | `direction`, `entry`, `stopLoss`, `takeProfit`, `tags: Set<string>`, `memo` | — |
| replay | `revealedCount`, `playing`, `speed` | revealedCount 는 재생 중에만 증가 |
| notebook | `NotebookDB` 인스턴스(IndexedDBNotebook) + 목록·통계 캐시 | — |

## 3. 문제 생성 파이프라인 (브라우저)

```
심볼 선택(SYMBOL_POOL 중 랜덤 또는 지정) · TF 선택(4h/1d, 랜덤 가능)
→ cache.getCandles(sym, tf, 1000) + getCandles(sym, HIGHER_TF[tf], 1000)
→ 문제 창을 확보할 수 있는 봉 범위를 150봉 구간으로 쪼개 무작위 순서로 한 구간씩
  → scanForSetups(구간 슬라이스, { tf, htfCs, htfTf })   // 2단계 지름길
  → 후보를 균등 랜덤 순서로 makeQuestion(…, { htfCs, htfTf })
  → 전부 null 이면 다음 구간, 구간을 소진하면 다른 심볼(지정하지 않은 경우 최대 3종)
→ solverView(q) 를 store 에, q 는 비공개 슬롯에
```

- 데이터 창은 **latest** (고정 창은 calibrate 전용 — 연습은 최신 시장이 맞다)
- 같은 문제 중복 회피(오답노트의 `symbol+startTime+decisionIndex` 대조)는 v1.1 로 미룬다

**구간 스캔은 Task 4 실측이 강제한 변경이다** (이 절의 원안은 1000봉을 통째로 `scanForSetups` 에 넘기는 것이었다). 실측: 통째 스캔은 심볼당 **8.3~9.6초**다 — 봉당 약 10.6ms 인 2단계(`activeSignalsAt`)가 880봉 전부에 돌고, 1단계 지름길은 사실상 열려 있다(coarseFloor = minScore 85 − COARSE_SLACK 100 = −15). 그런데 그중 앞 219봉과 뒤 60봉은 **makeQuestion 이 창을 못 잡는 자리라 계산 자체가 낭비**다. 유효 범위만 구간으로 쪼개 훑으면 대개 첫 구간에서 끝난다. 구간 크기 150봉은 스윕으로 정했다(근거·수치는 `src/ui/pipeline.ts` 머리주석).

**Web Worker 는 도입하지 않는다.** 원안은 "p50 > 3초면 워커" 였지만, 워커는 벽시계 시간을 줄이지 않고 UI 스레드만 비운다. 진짜 원인은 낼 수 없는 자리를 계산한 것이었고 그건 위에서 없앴다. 구간 사이마다 이벤트 루프에 양보하므로 로딩 화면의 진행 표시(`심볼 TF 구간 훑는 중… (2/5)`)는 실제로 갱신된다.

**오류는 상태 머신에 넣지 않는다.** 실패는 "loading 화면이 아직 문제를 못 만든 상태" 이고, 재시도는 phase 를 건드리지 않고 그 화면 안에서 다시 돈다. 머신에 error 단계를 파지 않는다.

## 4. 은닉 규율 — UI 가 실수로 흘리지 않는다

이 저장소의 급소다. 엔진은 이미 지키고 있고(`guards.test.ts` 의 solverView 검사), UI 가 새 누출 경로를 만들지 않아야 한다.

**U1. answering 단계의 데이터 소스는 SolverView 뿐이다.** 차트·시트·HTF 미니 전부. 키 4개(`candles`·`difficulty`·`htfCandles`·`timeframe`) 외를 소비하면 테스트가 깨진다.

**U2. 34점 패널은 복기 전용이다.** `ruleCheck(active, tf)` 의 입력이 **정답 유효 근거**다 — answering 단계에 그리면 답안지를 보여주는 것이다. 렌더만 막는 게 아니라 **answering 단계에서는 계산 자체를 하지 않는다** (코드 경로 테스트로 잠금).

**U3. 재생은 데이터 추가지 공개가 아니다.** 차트는 solverView 봉으로 시작하고, 재생 tick 마다 `question.candles[revealedCount]` 를 `series.update()` 로 **하나씩** 추가한다. "전체를 넣고 가려두는" 방식은 금지 — 스크롤·줌·크로스헤어로 샌다.

**U4. HTF 미니 차트도 U3 과 동일.** 재생 중에는 그 시점까지 닫힌 상위 봉만 추가한다 (solverView 와 같은 시간 조건).

**U5. 태그 시트 금지 5** (UX 결정 문서에서 승계, 테스트로 잠금):
① 해당 행 강조·정렬 변경 금지 ② 감지 태그 사전 체크 금지 ③ 연관 추천 금지 ④ 답안 작성 중 오답노트 통계 노출 금지 ⑤ 선택 개수 상한 금지 — 대신 선택 수와 **최악 감점**(Σ `falseClaimPenalty(id)`, "전부 헛다리일 경우 −N점")을 실시간 표시.

참고: `Answer.tags` 주석의 "최대 15개" 는 **grader 가 강제하지 않는 낡은 주석**이다(실측 — grader.ts 에 상한 코드 없음, 헛다리 44개 산탄총 테스트도 존재). UX 결정(상한 없음)이 우선이고, 주석은 Task 6 에서 정리한다.

## 5. 화면 설계

### 5.1 풀이 (answering)

```
┌────────────────────────────┬──────────────────┐
│ 메인 차트 (solverView 봉)  │ HTF 미니 차트     │
│                            ├──────────────────┤
│                            │ 34점 시트 행      │
│                            │  [핵심] 행들…     │
│                            │  [보조] 행들…     │
│                            │ ▸ 시트에 없는 근거│
│                            │ 검색(보조 입력)   │
├────────────────────────────┴──────────────────┤
│ 방향 ○롱 ○숏 ○관망 │ 진입/손절/익절 │ 제출  │
│ 선택 7개 · 전부 헛다리면 −13.5점              │
└───────────────────────────────────────────────┘
```

- 시트 행 = `PROFILES[profileOf(tf)].rows` 순서 그대로. 행 펼침 → 태그 체크박스(`TAG_BY_ID` 의 한글 label)
- "시트에 없는 근거" = `unscored`, 기본 접힘, kind 별 묶음
- 주문 입력: 진입 기본값 = 마지막 종가. 성립하지 않는 주문(롱인데 손절이 위)은 **경고만 하고 제출은 허용** — 실격 판정은 엔진의 몫이고(`execution.orderValid`), 실격 리포트를 받는 것도 학습이다. 관망이면 주문 필드 비활성
- 제출 확인 다이얼로그 없음 (연습 루프 속도가 우선)

### 5.2 재생 (replaying)

U3 방식으로 은닉 60봉을 순차 추가. 속도 1×/4×/스킵. TP·SL 터치 시점에 수평 레벨 프리미티브로 표시. 끝나면 자동으로 review 전이.

### 5.3 복기 (review)

**GradeReport 렌더링 계약 — 타입 주석이 이미 규정했고, UI 테스트로 잠근다:**

| # | 계약 | 근거 (types.ts 주석) |
|---|---|---|
| R1 | `execution.max === 0` 이면 실행 축을 **그리지 않는다** ("0/40" 금지) | 관망은 0점이 아니라 판정 대상 아님 |
| R2 | `totalScore` 는 반드시 `applicableMax` 와 함께 그린다 | 관망 20점 ≠ 진입 20점 |
| R3 | `replay === null` 이면 R·PnL 을 그리지 않고 "주문 불성립" 을 그린다 | 실격 주문의 이익을 그리면 안 된다 |

구성: 점수 헤더(축별 + applicableMax) → ✅맞힘/❌헛다리/⚠️핵심 놓침/📋참고 목록 → 차트 오버레이(기본: ✅+⚠️ 표시, 📋 는 토글, 태그별 on/off) → 34점 패널(정답 근거 기준) → 메모 입력 → 자동 저장(ReviewEntry) → 다음 문제.

### 5.4 오답노트 (notebook)

목록(날짜·심볼·TF·점수) → 상세(저장된 Question+Answer+GradeReport 로 복기 화면 재현) → 통계(자주 놓친 핵심 / 자주 착각한 근거 — coreMisses·falseClaims 분리).

**통계 로직은 `drill.ts --review` 에 인라인으로 있는 것을 `src/quiz/reviewStats.ts` 순수 함수로 추출해 공유한다.** 스크립트와 UI 가 다른 집계를 갖는 순간 어긋난다.

## 6. 차트 — lightweight-charts 5 + 프리미티브 4종

| 프리미티브 | refs 매핑 | 소비 태그 |
|---|---|---|
| PriceBox | `priceHigh~priceLow × fromBar~toBar` | 오더블록·FVG·매물대 |
| SlopedLine | `(fromBar, ?) → (toBar, price)` 두 점 | 추세선·채널 |
| PriceLevel | `price` (+구간 `fromBar~toBar`) | 스윕·피보·SR |
| BarMarker | `pivotBar` 또는 `barIndex` | 캔들 패턴·와이코프 사건 |

- 좌표 변환(`priceToCoordinate`·`timeToCoordinate`)만 라이브러리에 의존하고, **도형 배치 계산은 순수 함수로 분리해 단위 테스트한다** (canvas 는 jsdom 에 없으므로 렌더러 자체는 스파이크·눈검증으로)
- 봉 인덱스 → time 변환은 `view.candles[i].time` 조회로 한다 (재생 중 인덱스가 늘어나는 것과 정합)
- 지표 패널(RSI·MACD): **`indicators.ts` 의 값을 line series 로 그린다.** 차트 라이브러리가 재계산하지 않는다 — 감지기가 본 값과 패널이 같아야 한다 (비교안의 핵심 논거). v1 은 복기 화면 토글로만
- 다크 테마 단일 (TradingView 다크 룩). 라이트는 비목표

## 7. 검증 전략

엔진처럼 전부 자동일 수는 없다. **자동화 가능한 것은 전부 자동으로, 시각 품질만 체크리스트로.**

**자동 (vitest, `npm run verify` 가 자동 포괄):**
- `src/ui/guards.ui.test.ts` ★ 신설 — U1~U5 + 경계 규칙(§2) + R1~R3. **`scripts/locked.json` 에 등재해 잠근다** (locked 갱신은 이 파일을 만드는 커밋에서 명시적으로)
- 프리미티브 배치 계산 단위 테스트
- store 전이 테스트 (phase 머신, 재생 tick 단조 증가)
- 시트 렌더 테스트 (@testing-library/react + jsdom: 행 순서 = 프로파일 상수, 사전 체크 0개, 최악 감점 표시)

**수동 체크리스트 (Task 9, PR 본문에 결과 기록):**
- drill 리포트와 같은 문제를 UI 로 풀어 오버레이 3사례 눈검증 (박스·사선·레벨 각 1)
- 재생 중 스크롤/줌으로 미래 봉이 보이지 않는지
- 새로고침 후 오답노트 생존

## 8. 태스크

| # | 내용 | 게이트 (통과 못 하면 다음으로 안 간다) |
|---|---|---|
| 1 | **스파이크**: Vite+React+LWC 캔들 렌더 → PriceBox 1종을 실제 `detectOrderBlocks` refs 로 → 재생(`series.update`) | 셋 다 동작. **프리미티브에서 막히면 KLC 전환** — 비교안의 게이트. 이 스펙은 6절만 갱신하면 된다 |
| 2 | 골격: `@vitejs/plugin-react`, `index.html`, `src/ui/` 상태 머신 + store, 화면 껍데기 3개 | typecheck·기존 테스트 전부 그대로 초록. dev 서버에서 상태 전이 확인 |
| 3 | 데이터: `cache.ts` 를 fileCache 의미론(버전·검증·폐기)과 동등하게 보강, 부족분 테스트 | 계약 테스트(fake-indexeddb) 통과. 같은 요청이 fileCache 와 같은 캔들을 내는지 파서 공유로 확인 |
| 4 | 문제 생성 파이프라인 + loading 화면 | 생성 10회 실측 **p50 < 3초**. ✅ 통과 — 캐시를 비운 브라우저에서 랜덤 심볼 10회 **p50 1375ms · p90 1706ms · 실패 0** (구간 스캔 도입 후. 원안대로 통째 스캔했으면 8~9초로 탈락) |
| 5 | 차트 컴포넌트 + 프리미티브 4종 + HTF 미니 | 배치 계산 단위 테스트. 오버레이 3사례 눈검증 |
| 6 | 태그 시트 + 답안 입력 + `Answer.tags` 주석 정리 | **U5 금지 5 가 테스트로 잠김.** `guards.ui.test.ts` 생성 + locked.json 등재 |
| 7 | 제출 → 채점 → 재생 → 복기 | R1~R3 테스트. U1~U4 테스트. 34점 패널이 answering 경로에서 미계산임을 테스트 |
| 8 | 오답노트 화면 + `reviewStats.ts` 추출 (drill --review 공유) | 저장 → 재초기화 → 조회 왕복. drill --review 출력이 추출 후에도 동일 |
| 9 | 전체 리뷰 | `npm run verify` exit 0 + 수동 체크리스트 전부 기록 + PR |

작업 순서 근거: 위험한 것(스파이크·프리미티브)이 앞이고, 갈아엎기 쉬운 것(시트·오답노트)이 뒤다 — 이 저장소의 파트 분할 방침 그대로.

## 9. 리스크

| 리스크 | 대응 |
|---|---|
| 프리미티브 난이도 오판 | Task 1 게이트에서 반나절 안에 판정, KLC 전환 경로 문서화됨 |
| 문제 생성이 브라우저에서 느림 | ✅ 해소 — Task 4 실측에서 통째 스캔이 8~9초로 드러났고, 유효 범위만 구간으로 훑어 p50 1.4초로 내렸다(§3). Worker 는 불필요 |
| Binance CORS/차단 | `fetchKlines` 는 공개 REST. 실패 시 오류 화면 + 재시도. 프록시는 비목표 (로컬 도구) |
| jsdom 으로 차트 테스트 불가 | 설계로 회피 — 배치 계산을 순수 함수로 분리(§7) |
| UI 작업 중 엔진 회귀 | 기존 `verify` 가 그대로 게이트. 엔진 수정은 별도 커밋 원칙(§1) |

## 10. 이 스펙이 확정하지 않는 것

- Tailwind 여부 — Task 2 에서 정한다. 기본은 plain CSS 로 시작 (화면 3개에 빌드 체인 추가는 증명 책임이 추가하는 쪽에 있다) → **plain CSS 확정** (Task 2)
- ~~Web Worker — Task 4 실측이 정한다~~ → **도입하지 않는다** (Task 4, §3)
- 15m/1h·모바일·배포·중복 회피 — v1.1 이후, 각각 별도 결정
