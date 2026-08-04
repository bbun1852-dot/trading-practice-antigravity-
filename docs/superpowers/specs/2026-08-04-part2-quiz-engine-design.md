# Part 2 — 출제·재생·채점 엔진 설계

작성일: 2026-08-04
기반: Part 1 (`141dfc8`, PR #1 병합 완료), 124 테스트 통과
선행 문서: `2026-08-02-chart-drill-design.md` (전체 설계), `2026-08-02-part2-handoff.md` (인계)

## 1. 목적과 범위

Part 1은 감지 계층을 만들었다. Part 2는 그 위에 **출제 → 재생 → 채점** 기계를 올린다.
전부 순수 함수이며 UI는 없다. Node에서 실행하고 Vitest로 검증한다.

### 범위에 있는 것

| 모듈 | 역할 |
|---|---|
| `taxonomy.ts` | 태그 49종 정의 — Tier·kind·confidence·**수명 클래스**. 단일 원천 |
| `lifetime.ts` | `activeSignalsAt()` — 유효 근거 집합의 유일한 진입점 |
| `scanner.ts` | 2단계 셋업 스캔 |
| `generator.ts` | 문제 생성, 유형 배분, 마스킹, 재현 키 |
| `replay.ts` | 은닉 봉 재생, SL/TP 체결, R·PnL |
| `grader.ts` | 방향 30 + 실행 40 + 근거 30 채점 |
| `scripts/calibrate.ts` | 실데이터로 임계값 조정 |
| `scripts/drill.ts` | 문제 1개를 실제로 풀어보고 마크다운 리포트 출력 |

### 범위 밖 (9절 로드맵에 복귀 시점 명시)

미구현 태그 약 20종, UI 전체, 34점 룰 패널(M6), 오답노트·대시보드(M7),
탑다운 채점(`htf_*` 태그 미구현), 와이코프(M5), `cache.ts` D1 결함.

## 2. Part 1 인계 상태 — 실측

설계 근거를 추측이 아니라 실측에 둔다. 2026-08-04, 5종목(BTC·ETH·SOL·XRP·LINK) ×
2 TF(4h·1d) × 1000봉 = **10,000봉**에 `detectAll`을 돌린 결과다.

### 2.1 배출되는 태그는 48종이다

전체 설계 스펙은 40종, M3 정정표는 50종으로 적었으나 실제 배출은 **48종**이다.
`taxonomy.ts`는 실측 48종으로 만든다(`candle_tweezer` 분리 후 49종).

| Tier | kind | 태그 |
|---|---|---|
| 1 | smc | `liq_sweep_high` `liq_sweep_low` `ob_bear_resistance` `ob_bull_support` |
| 1 | structure | `msb_bear` `msb_bull` |
| 2 | smc | `fvg_bear` `fvg_bull` |
| 2 | volume | `vol_breakout_confirm` `vol_breakout_weak` `vol_climax` |
| 3 | volatility | `bb_break_lower` `bb_break_upper` `bb_squeeze` |
| 3 | structure | `trend_down_structure` `trend_range` `trend_up_structure` |
| 4 | candle | `candle_bear_engulf` `candle_bear_harami` `candle_bull_engulf` `candle_bull_harami` `candle_doji` `candle_evening_star` `candle_hammer` `candle_inside_bar` `candle_inv_hammer` `candle_long_wick` `candle_morning_star` `candle_shooting_star` `candle_three_crows` `candle_three_soldiers` `candle_tri_star` `candle_tweezer` |
| 4 | ma | `ma_aligned_bear` `ma_aligned_bull` `ma_dead_cross` `ma_golden_cross` |
| 4 | momentum | `macd_dead` `macd_divergence` `macd_golden` `macd_zero_break` `rsi_50_break` `rsi_bear_div` `rsi_bull_div` `rsi_hidden_div` `rsi_overbought` `rsi_oversold` |
| 4 | volume | `obv_divergence` |

`macd_divergence`는 전체 설계 스펙 6.4 태그표에 없지만 감지기가 실재하며 10,000봉에서
227회 발화한다(인계문서 D4). 감지기가 있으므로 taxonomy에 정식 등재한다 — 그래야
사용자가 청구할 수 있고, 영구 유령 ⚠️놓침이 되지 않는다.

### 2.2 발화 빈도 — 수명 규약이 필요한 이유

10,000봉 합산 상위:

```
ma_aligned_bear   3257     candle_doji        1150
ma_aligned_bull   2323     rsi_50_break       1139
candle_inside_bar 1920     trend_range        1065
candle_tweezer    1517     trend_up_structure  814
```

BTCUSDT 4h 단일 창에서 시점별 신호 총량:

| 결정 시점 | 총량 | 최근 5봉 | 최근 10봉 | 최근 20봉 |
|---|---|---|---|---|
| 340 | 772 | 14 | 30 | 67 |
| 600 | 1545 | 20 | 31 | 64 |
| 900 | 2343 | 11 | 20 | 33 |

총량은 봉 수에 비례해 무한정 늘어난다. 반면 최근 봉에 속한 건 10~30개다.
수명 없이 총량을 답안지로 쓰면 채점이 성립하지 않는다.

단순히 "최근 20봉"으로 자르는 것도 답이 아니다 — 33~67개로 여전히 많고,
`trend_up_structure` 같은 상태 신호는 20봉 전에 확정됐어도 지금 유효하다.
신호 부류마다 규칙이 달라야 한다.

### 2.3 `detectFVG`는 이미 무효화를 내장하고 있다

`fvg_bull` 14회 vs `fvg_bear` 66회로 4.7배 비대칭이며, 표본 10개 중 6개에서
`fvg_bull`이 0이다. 감지기 코드는 대칭이다(`smc.ts:7-32` — 갭 경계 산출과 충족 판정 모두
방향 대칭). 원인은 다른 데 있다:

> `detectFVG`는 관측 시점까지 **메워지지 않은** FVG만 배출한다.

즉 FVG는 구간 무효화가 이미 감지기에 들어 있다. 그래서 taxonomy에서 `fvg_*`를 다시
`zone`으로 걸면 이중 적용이 된다. **`zone` 규칙이 실제로 필요한 건 오더블록 2종뿐**이다
— 오더블록은 무효화를 하지 않아 FVG보다 약 14배 많이 발화한다(1146 vs 80).

### 2.4 `candle_tweezer`가 과다 발화한다

10,000봉에서 1517회로 캔들패턴 중 최다다. 4h에서는 1000봉당 163~314회 —
**4봉 중 1봉이 트위저**다. 1d에서는 49~93회로 정상 범위다.
트위저는 드문 반전 패턴이어야 하므로 임계값이 느슨하다. Part 2에서 보강한다.
인계문서 D3(한 봉에서 양방향 동시 발화)와는 별개의 문제이며, 둘 다 이번에 처리한다.

### 2.5 하네스가 보증하는 것 — 부분집합 관계

`assertNoLookAhead`(`testing.ts:44`)가 강제하는 불변식은 등식이 아니라 **부등식**이다:

> 전체 실행이 bar k에서 낸 신호 개수 ≤ 0..k 로 잘라 실행했을 때 bar k에서 낸 개수

따라서 `detectAll(cs).filter(s => s.barIndex <= i)`는 정확한 집합 `detectSignals(cs, i)`의
**부분집합**이다. 과대추정이 아니라 과소추정이다. 이 성질이 6절 스캐너 설계의 근거다.

인계문서 5절은 이 filter 지름길을 금지했다. 그 근거였던 F2(`detectTrend`가 호출당 신호 1개)는
이미 수정됐고, 현재 실측상 두 경로가 갈리는 것은 FVG뿐이다(1000봉당 최대 11개).
**금지는 채점 경로에 대해서만 유지한다.**

## 3. 신호 수명 규약

Part 2의 첫 번째 결정이며 나머지 전부가 여기에 의존한다.

### 3.1 방식 — taxonomy 선언 + 소비 시점 필터

수명은 `taxonomy.ts`의 태그 정의에 선언하고, `lifetime.ts`가 소비 시점에 적용한다.
**감지기 40종은 수정하지 않는다** — Part 1이 테스트 124개로 고정한 미래참조 보증이
그대로 살아 있어야 한다.

```ts
type LifetimeClass =
  | { kind: 'bar' }                                        // 그 봉에서만
  | { kind: 'recent'; bars: number }                       // N봉 이내
  | { kind: 'zone'; maxBars: number
      invalidateOn: 'touch' | 'close_through' }            // 구간 미침범 + 상한
  | { kind: 'state' }                                      // 같은 id 중 최신 1개
```

### 3.2 클래스 배정 (49종)

| 클래스 | 태그 | 수 |
|---|---|---|
| `state` | `trend_up_structure` `trend_down_structure` `trend_range` `ma_aligned_bull` `ma_aligned_bear` `bb_squeeze` `rsi_overbought` `rsi_oversold` | 8 |
| `zone` | `ob_bull_support` `ob_bear_resistance` | 2 |
| `recent` | `liq_sweep_low` `liq_sweep_high` `msb_bull` `msb_bear` `fvg_bull` `fvg_bear` `rsi_bull_div` `rsi_bear_div` `rsi_hidden_div` `macd_divergence` `obv_divergence` `vol_breakout_confirm` `vol_breakout_weak` `vol_climax` | 14 |
| `bar` | 캔들패턴 17(트위저 분리 후) · `macd_golden` `macd_dead` `macd_zero_break` · `ma_golden_cross` `ma_dead_cross` · `bb_break_upper` `bb_break_lower` · `rsi_50_break` | 25 |

`state`에 실측 상위 신호가 몰려 있다 — `ma_aligned_*` 만으로 5,580회이며 최신 1개로 접힌다.
감축 효과의 대부분이 여기서 나온다.

`recent.bars`는 태그마다 다를 수 있다. 유동성 스윕과 다이버전스는 유효 기간이 다르다.
`calibrate.ts`가 태그별로 정한다.

`fvg_*`가 `zone`이 아니라 `recent`인 이유는 2.3절이다. 감지기가 이미 미충족만 배출하므로
상한 봉 수만 걸면 된다.

### 3.3 `zone` 무효화 판정

오더블록 2종에만 적용된다. 신호의 `refs.priceLow`~`refs.priceHigh` 구간을
`barIndex+1` 부터 `atIndex` 까지의 봉이 침범했는지 본다.

- `close_through` — 종가가 구간을 완전히 통과해 마감하면 무효 (오더블록이 깨짐)
  - 강세 오더블록: 종가 < `priceLow`
  - 약세 오더블록: 종가 > `priceHigh`
- `touch` — 고가/저가가 구간에 닿으면 무효. 이번 배정에서는 사용하지 않으나
  Part 3의 `fvg_rebalance` 등을 위해 구현한다

오더블록 2종이 `refs`에 구간을 100% 보유함을 실측으로 확인했다(1146/1146).

### 3.4 소비 진입점

```ts
function activeSignalsAt(candles: Candle[], atIndex: number): ActiveSignal[]
type ActiveSignal = Signal & { ageBars: number }
```

스캐너 2단계·채점기·리포트가 전부 이 함수를 쓴다. `detectSignals`를 직접 부르는
소비자는 없다. 인계문서 5절의 지름길을 구조적으로 막는다.

`recent.bars`, `zone.maxBars`의 실제 값은 `calibrate.ts`가 정한다.
**목표: 결정 시점의 유효 근거 8~15개** — 사용자가 최대 15개를 체크하는 것과 맞물린다.

## 4. 모듈 구조

```
src/
  analysis/      (Part 1 — 수정 없음. 단 4.1의 감지기 보강 2건 예외)
  quiz/
    types.ts      Question · Answer · GradeReport · SetupCandidate · ReplayResult
    taxonomy.ts   태그 49종 — Tier · kind · confidence · 수명 클래스
    lifetime.ts   activeSignalsAt()
    scanner.ts    scanForSetups()
    generator.ts  makeQuestion()
    replay.ts     replay()
    grader.ts     grade()
  data/
    fileCache.ts  스크립트용 파일 기반 캔들 캐시
scripts/
  calibrate.ts
  drill.ts
```

의존 방향은 한 방향이다: `taxonomy ← lifetime ← {scanner, grader}`,
`scanner ← generator`, `replay ← grader`. `analysis/`는 `quiz/`를 알지 못한다.

### 4.1 감지기 보강 2건

감지기의 **출력을 바꾸는** 유일한 항목이며, 둘 다 채점 정확성에 직결된다.
(11절의 D2·D5·D6·D7은 동작을 바꾸지 않는 정리 작업이다.)

**D3 — `candle_tweezer` 분리와 임계값 보강**
한 봉에서 양방향이 동시에 발화해 같은 id가 상반된 `side`를 갖는다(400봉당 3회).
id가 키 노릇을 못 하게 된다. `tweezer_top`(약세) / `tweezer_bottom`(강세)로 분리한다.
동시에 2.4절의 과다 발화(4h 1000봉당 163~314회)를 잡는다.
목표 발화율은 1d 실측(1000봉당 49~93회)을 기준으로 삼는다.

**D4 — `macd_divergence` 등재**
감지기가 실재하므로 taxonomy에 올린다(2.1절).

## 5. taxonomy

```ts
type TagDef = {
  id: string
  label: string          // 사용자에게 보이는 한국어 라벨
  tier: 1 | 2 | 3 | 4
  kind: SignalKind
  confidence: 'A' | 'B' | 'C'
  lifetime: LifetimeClass
}
```

**감지기가 존재하는 태그만 올린다.** 감지기 없는 태그를 노출하면 사용자가 체크하는 족족
확정 ❌ 가 된다(인계문서 2절).

`confidence`는 감지기 출력에서 그대로 가져온다. 이번 49종은 전부 A일 것으로 보인다 —
전체 설계 스펙에서 B·C로 지정된 태그(차트패턴·추세선·채널·와이코프)가 모두 미구현이기
때문이다. 등급 차등 로직은 Part 3에서 B·C가 들어올 때를 위해 지금 구현하고 테스트한다.

### 정합성 테스트 2개

1. 감지기가 실데이터에서 배출하는 모든 id ⊆ taxonomy의 id 집합
2. `zone`으로 선언된 태그는 `refs.priceLow`/`refs.priceHigh`를 반드시 보유

두 테스트가 taxonomy와 감지기의 어긋남을 막는다. 이 어긋남이 방치되면
사용자가 정확히 읽은 근거를 청구하지 못하거나(D4), 무효화 판정이 조용히 실패한다.

## 6. 스캐너 — 2단계

`activeSignalsAt`은 내부적으로 잘린 배열에 `detectAll`을 돌린다. 모든 봉에 대해
호출하면 O(n²)이며, 1000봉 `detectAll`이 1.2초라는 실측을 감안하면 전체 스캔은
약 10분이다. 쓸 수 없다.

**1단계 (거친 필터, O(n))** — `detectAll(cs)`를 **1회** 돌리고, 각 봉에 대해
`barIndex` + 수명 규칙으로 근사 `setupScore`를 계산한다. 2.5절에 의해 이 결과는
정확한 집합의 부분집합이므로 **과소추정**이다. 임계값을 목표보다 낮게 잡아 후보를
넉넉히 남긴다.

**2단계 (정확)** — 1단계 후보에 대해서**만** `activeSignalsAt`을 다시 돌려 확정
`setupScore`·난이도·유효 근거 집합을 낸다. 후보가 수십 개이므로 감당된다.

점수식은 전체 설계 스펙 5.3 그대로다:

```
base       = Σ (tierWeight[tier] × strength)      tierWeight = {1:5, 2:4, 3:3, 4:2}
diversity  = 2 × (서로 다른 kind 개수)
conflict   = 3 × min(bullish 수, bearish 수)
setupScore = base + diversity − conflict
```

**임계값은 다시 잡는다.** 인계문서 4절은 `setupScore >= 25`가 1000봉당 178개를 내므로
임계값을 올려야 한다고 적었으나, 그 측정은 **수명 필터 이전** 기준이다. 수명을 적용하면
유효 신호가 크게 줄어 점수도 함께 내려가므로 오히려 내려야 할 수 있다.
`calibrate.ts`가 실측으로 정한다. 목표는 4h 기준 1000봉당 후보 15~40개다.

인접 봉의 중복 셋업은 병합한다(연속 20봉이면 대표 1개).
난이도는 신호 상충 정도로 자동 산정한다(전체 설계 스펙 5.3의 쉬움/보통/어려움 기준).

**원칙**: 지름길은 후보를 고르는 1단계에만 허용한다. **채점은 절대 filter를 쓰지 않는다.**
1단계 결과 ⊆ 2단계 결과를 회귀 테스트로 고정한다.

## 7. 출제

후보 봉이 창의 `decisionIndex`가 되도록 400봉 창을 자른다
(워밍업 120 + 노출 220 + 은닉 60).

유형 배분은 전체 설계 스펙 5.4를 따른다 — 정상 60% / 함정 20% / 노셋업 20%.
분류는 은닉 60봉을 보고 결정한다. **출제자는 미래를 봐도 된다. 사용자에게 숨길 뿐이다.**

- 정답 방향 = 은닉 구간에서 1.5 ATR 이상 **먼저** 나온 쪽. 양쪽 다 미달이면 `관망`
- **신호 우세 방향** = 유효 근거의 `Σ(tierWeight × strength)`를 side별로 합산해 큰 쪽
- **함정** = 유효 근거 3개 이상이고, 정답 방향이 신호 우세 방향과 반대
- **노셋업** = 정답 방향이 무방향

마스킹은 `Question`에 종목·시각을 담되 `reveal()` 전에는 꺼내지 않는 구조로 둔다.
재현 키는 `{symbol, timeframe, startTime, decisionIndex}` — 난수 시드가 아니라
실제 좌표이므로 같은 문제를 다시 풀거나 공유할 수 있다.

## 8. 재생과 채점

### 8.1 재생

전체 설계 스펙 7.5 그대로다.

- 봉 단위 진행, 고가·저가로 SL/TP 터치 판정
- **같은 봉에서 SL과 TP를 모두 터치하면 SL 우선** (보수적 가정)
- 지정가 진입 미체결 시 "진입 실패"로 기록
- 은닉 60봉 내 미청산이면 마지막 종가로 강제 청산

### 8.2 채점 — 3축 100점

방향 30점과 실행 40점은 전체 설계 스펙 7.1의 표를 그대로 구현한다.

**근거 30점 — 핵심/참고 2단 분리**

유효 근거는 `activeSignalsAt(cs, decisionIndex)`이다. 수명 필터를 걸어도 8~15개가
나오므로, 미체크 전부를 ⚠️놓침으로 처리하면 매 문제마다 지적이 10개씩 찍혀 무뎌진다.
"놓쳤다"가 흔해지면 신호가 되지 못한다. 그래서 감점 대상과 표시 대상을 분리한다.

| 판정 | 대상 | 감점 |
|---|---|---|
| ✅ 적중 | 체크한 태그가 유효 근거에 있음 | — |
| ⚠️ 핵심 놓침 | Tier × strength 상위 K개 중 미체크 | 있음 |
| 📋 참고 | 유효하지만 핵심이 아닌 미체크 근거 | **없음**, 목록만 표시 |
| ❌ 헛다리 | 체크했는데 유효 근거에 없음 | confidence 차등 (A 100% / B 50% / C 0%) |

K는 `calibrate.ts`가 정한다(초안 6). 상위 K개를 고를 때 `tierWeight × strength`가
동점이면 `barIndex` 최신 우선, 그래도 같으면 id 사전순으로 자른다 — 채점이
결정론적이어야 같은 답안이 항상 같은 점수를 받는다.

❌가 가장 중요한 피드백이라는 전체 설계 스펙 7.1의 판단은 유지된다 —
"MACD 골든크로스를 보고 들어갔다"는데 실제로는 3봉 뒤에 발생했다면 차트를 잘못 읽은 게
아니라 **없는 것을 본 것**이다.

**프로세스/결과 분리** (전체 설계 스펙 7.2)

프로세스 = 근거 + 실행, 결과 = 방향 + PnL. 두 점수를 따로 표시하고 명시적 판정을 낸다.
"근거 4/4 적중, 손절 적절, R:R 2.4인데 손절당함 → 잘한 매매",
"결과 +3.2R인데 근거 1적중 3헛다리, 손절 0.3 ATR → 운". 중급에서 상급으로의 전환은
정확히 이 구분에서 갈린다.

## 9. 검증 스크립트

UI가 없으므로 임계값 조정과 실물 확인을 스크립트로 한다.

**`scripts/calibrate.ts`** — 실데이터를 스캔해 아래를 출력한다. 이 값들을 보고
`recent.bars`, `zone.maxBars`, `setupScore` 임계값, 핵심 근거 K를 정한다.

- 결정 시점별 유효 근거 개수 분포 (목표 8~15개)
- 1000봉당 후보 밀도 (목표 15~40개)
- 태그별 발화율 — 과다/과소 발화 태그 식별
- taxonomy 커버리지 — 한 번도 안 나오는 태그

**`scripts/drill.ts`** — 문제 1개를 생성하고 답안을 넣어 채점 리포트를 마크다운으로
출력한다. 수명 규약과 채점 강도가 **실제로 말이 되는지**를 사람 눈으로 확인하는 용도다.
이게 Part 2에서 "쓸 수 있는지" 판단하는 유일한 수단이다.

**`data/fileCache.ts`** — 받은 캔들을 파일로 저장해 반복 조정 때 매번 네트워크를
치지 않게 한다. `cache.ts`(IndexedDB)와는 별개다. Node엔 IndexedDB가 없다.

## 10. 테스트

Part 1의 규율을 유지한다 — 구현과 함께 테스트를 쓰고, 조건을 뒤집으면 테스트가
잡아내는지(비공허성)를 확인한다.

| 대상 | 내용 |
|---|---|
| taxonomy | 정합성 2개 (5절) |
| lifetime | 클래스 4종 각각의 경계 조건. `zone` 무효화 `touch`/`close_through` 양쪽 |
| scanner | 1단계 결과 ⊆ 2단계 결과 (부분집합 회귀) |
| generator | 재현성 — 같은 키면 같은 문제. 유형 분류 3종 |
| replay | SL·TP 동시 터치 시 SL 우선 / 미체결 / 강제청산 / R 계산 |
| grader | ✅⚠️📋❌ 4판정, 핵심/참고 분리, confidence 차등, 프로세스/결과 분리 |

look-ahead 회귀 테스트(Part 1)는 그대로 통과해야 한다.
`candle_tweezer` 분리로 기존 테스트가 깨지므로 함께 갱신한다.

## 11. 로드맵 — 이번에 뺀 것들의 복귀 시점

Part 2가 안정화된 뒤 아래 순서로 되돌린다.

| 순서 | 항목 | 이번에 뺀 이유 |
|---|---|---|
| Part 3 | **미구현 태그 20종 전부** — `choch` `sr_flip` `retest_*` `liq_pool_untapped` `volume_node_*` `ob_double_engulfing` `fvg_rebalance` `vol_divergence` `vol_absorption` `fib_*`(5) `bb_walking` `rsi_failure_swing` `macd_hist_turn` `ma_support/resistance` `obv_trend_confirm` | 49종으로 채점 루프를 먼저 검증한다. 태그 추가는 순수 추가 작업이라 채점기를 고칠 일이 없다 |
| Part 3 | B·C 등급 감지 (차트패턴·와이코프, M5) | 위와 같음. 등급 차등 로직은 Part 2에서 미리 구현해 둔다 |
| Part 4 | UI 전체 — 차트·매매 입력·태그 패널·결과 패널 | 스펙 하나로 감당할 크기가 아니다 |
| Part 4 | `cache.ts` D1 결함 (`openDB` 거부도 캐싱) | Node엔 IndexedDB가 없어 헤드리스에서 쓰지 않는다. 실제로 연결할 때 왕복 테스트와 함께 고친다 |
| Part 5 | 34점 룰 패널 (M6) | 주 채점이 아니라 별도 검증 뷰다 |
| Part 5 | 오답노트·대시보드 (M7) | 채점 결과가 안정된 뒤 위에 얹는다 |
| 미정 | 탑다운 채점 (`htf_*`) | `htf_*` 태그 3종의 감지기가 없다. 상위 TF fetch 계층도 필요하다 |

Part 1의 잔여 결함 D2·D5·D6·D7은 무해하거나 문서 수정 건이므로 Part 2에서 함께 정리한다.

## 12. 미결 사항

없다. 구현 계획 수립으로 진행 가능하다.

수치로 남은 것은 전부 `calibrate.ts`가 실데이터로 정하도록 설계에 위임했다 —
`recent.bars`, `zone.maxBars`, `setupScore` 임계값, 핵심 근거 K.
이 값들은 추측으로 스펙에 박는 것보다 측정으로 정하는 것이 옳다.
