# chart-drill Part 2 — 출제·재생·채점 엔진 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Part 1의 감지 계층 위에 출제 → 재생 → 채점 루프를 헤드리스로 완성한다. 문제를 생성하고 답안을 채점해 마크다운 리포트를 내는 것까지가 완료 상태다.

**Architecture:** 태그 49종의 정의와 **수명 클래스**를 `taxonomy.ts`에 단일 원천으로 두고, `lifetime.ts`의 `activeSignalsAt()`이 유일한 소비 진입점이 된다. 감지기 40종은 수정하지 않는다(트위저 분리 1건 예외). 스캐너만 성능을 위해 2단계로 나뉘어 1단계에서 `detectAll().filter()` 근사를 쓰고, 2단계와 채점은 정확 경로를 탄다.

**Tech Stack:** TypeScript 7 · Vitest 4 · tsx (신규) · Node 24 · Binance klines API

## Global Constraints

- 설계 스펙: `docs/superpowers/specs/2026-08-04-part2-quiz-engine-design.md`. 이 계획과 스펙이 어긋나면 스펙이 우선한다.
- `src/analysis/` 의 감지기는 **Task 2 외에는 수정하지 않는다.** Part 1이 테스트 124개로 고정한 미래참조 보증을 깨지 않기 위해서다.
- **채점 경로에서 `detectAll(cs).filter(...)` 를 쓰지 않는다.** 스캐너 1단계에서만 허용한다. 이유는 스펙 2.5·6절.
- 모든 `quiz/` 모듈은 순수 함수다. DOM·네트워크·전역 상태·`Date.now()` 금지. 네트워크는 `scripts/` 와 `data/` 에만 존재한다.
- 각 태스크 종료 시 `npx vitest run` 전부 통과 + `npx tsc --noEmit` exit 0. 하나라도 실패하면 그 태스크는 미완료다.
- 태스크마다 커밋한다. 브랜치는 `feat/part2-quiz-engine`.
- 새 의존성은 `tsx` 하나뿐이다. 다른 것을 추가하지 않는다.
- 주석과 커밋 메시지는 한국어로 쓴다 (Part 1 관례).

## File Structure

| 파일 | 책임 |
|---|---|
| `src/quiz/types.ts` | `Question` `Answer` `GradeReport` `SetupCandidate` `ReplayResult` — 타입만, 로직 없음 |
| `src/quiz/taxonomy.ts` | 태그 49종 정의 + 수명 클래스. 데이터만 |
| `src/quiz/lifetime.ts` | 수명 규칙 적용. `activeSignalsAt()` |
| `src/quiz/scanner.ts` | 셋업 점수 계산과 2단계 스캔 |
| `src/quiz/generator.ts` | 창 절단, 유형 분류, 마스킹, 재현 키 |
| `src/quiz/replay.ts` | 은닉 봉 체결 시뮬레이션 |
| `src/quiz/grader.ts` | 3축 채점, 핵심/참고 분리 |
| `src/quiz/report.ts` | `GradeReport` → 마크다운 |
| `src/data/fileCache.ts` | 스크립트용 파일 캔들 캐시 (Node 전용) |
| `scripts/calibrate.ts` | 실측으로 임계값 4종 확정 |
| `scripts/drill.ts` | 엔드투엔드 실행 + 리포트 출력 |

`taxonomy` ← `lifetime` ← {`scanner`, `grader`}, `scanner` ← `generator`, `replay` ← `grader`, `grader` ← `report`.
`src/analysis/` 는 `src/quiz/` 를 알지 못한다.

## 스펙이 위임한 숫자 4종 — 확정 시점

스펙 12절이 `calibrate.ts` 에 위임한 값들이다. 초안으로 시작해 지정된 태스크에서 실측으로 확정한다.

| 값 | 초안 | 확정 태스크 | 목표 |
|---|---|---|---|
| `recent.bars` (태그별) | 5 | Task 5 | 유효 근거 8~15개 |
| `zone.maxBars` | 50 | Task 5 | 위와 같음 |
| `setupScore` 임계값 | 25 | Task 6 | 1000봉당 후보 15~40개 |
| 핵심 근거 K | 6 | Task 9 | 리포트가 잔소리로 읽히지 않을 것 |

---

### Task 1: 스크립트 실행 기반 (tsx)

`scripts/*.ts` 를 실행할 수단이 없다. 확인된 사실 두 가지:
`vite-node` CLI는 vitest 4/5에서 제거되었고, Node 24의 네이티브 TS 실행은 이 프로젝트의
확장자 없는 import(`from './structure'`)에서 `ERR_MODULE_NOT_FOUND` 로 실패한다.
전 모듈에 `.ts` 확장자를 붙이는 것은 Part 1 파일 15개를 건드리는 churn이므로 `tsx` 를 추가한다.

**Files:**
- Modify: `package.json`
- Create: `scripts/hello.ts` (검증용, Task 5에서 삭제)

**Interfaces:**
- Consumes: 없음
- Produces: `npm run script -- <path>` 로 임의의 TS 스크립트를 실행할 수 있다

- [ ] **Step 1: tsx 설치**

```bash
npm install -D tsx
```

- [ ] **Step 2: package.json 에 스크립트 추가**

`scripts` 블록에 아래 두 줄을 더한다. 기존 `test`/`test:watch`/`typecheck` 는 그대로 둔다.

```json
"script": "tsx",
"calibrate": "tsx scripts/calibrate.ts"
```

- [ ] **Step 3: 실행기가 프로젝트 모듈을 임포트할 수 있는지 확인하는 스크립트 작성**

`scripts/hello.ts`:

```ts
import { detectAll } from '../src/analysis/signals'
import { synthCandles } from '../src/analysis/fixtures'

const cs = synthCandles(300)
console.log(`캔들 ${cs.length}봉 → 신호 ${detectAll(cs).length}개`)
```

- [ ] **Step 4: 실행해서 확장자 없는 import 가 해결되는지 확인**

Run: `npm run script -- scripts/hello.ts`
Expected: `캔들 300봉 → 신호 N개` 가 출력된다(N > 0). `ERR_MODULE_NOT_FOUND` 가 나오면 실패다.

- [ ] **Step 5: 기존 테스트와 타입체크가 깨지지 않았는지 확인**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 124 passed, exit 0

- [ ] **Step 6: 커밋**

```bash
git add package.json package-lock.json scripts/hello.ts
git commit -m "chore: tsx 추가 — 스크립트 실행 기반

vite-node CLI는 vitest 4/5에서 제거됐고, Node 24 네이티브 TS 실행은
확장자 없는 import에서 ERR_MODULE_NOT_FOUND로 실패한다. 전 모듈에
확장자를 붙이는 것보다 devDependency 1개가 싸다."
```

---

### Task 2: `candle_tweezer` 분리와 임계값 보강

인계문서 D3과 실측에서 드러난 과다 발화를 함께 고친다. taxonomy(Task 3)의 전제다.

현재 코드(`candlePatterns.ts:60-65`)의 결함은 셋이다.
① 같은 id `candle_tweezer` 가 상반된 `side` 로 발화해 id가 키 노릇을 못 한다.
② 허용오차가 가격의 0.1%다 — BTC $60,000에서 $60이며, 인접 4h 봉의 저점이 그 안에 드는 건 흔하다.
실측 결과 4h 1000봉당 163~314회(4봉 중 1봉)로 발화한다.
③ **두 봉의 색이 반대여야 한다는 조건이 아예 없다.** 트위저는 반전 패턴이므로 이게 본질이다.

허용오차는 ATR 상대로 바꾼다. 가격의 몇 %는 종목·타임프레임에 따라 의미가 달라지지만,
ATR의 몇 %는 "이 자산이 움직이는 폭에 비해 사실상 같은 저점"을 뜻한다.

**Files:**
- Modify: `src/analysis/candlePatterns.ts:60-65`
- Modify: `src/analysis/candlePatterns.test.ts`

**Interfaces:**
- Consumes: `atr` (이미 `candlePatterns.ts:18` 에서 `a` 로 계산되어 있다)
- Produces: 신호 id `tweezer_top`(bearish) / `tweezer_bottom`(bullish). `candle_tweezer` 는 더 이상 배출되지 않는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/analysis/candlePatterns.test.ts` 에 추가한다. `mk(open, high, low, close, volume, i)` 는 기존 픽스처 헬퍼다.

```ts
describe('트위저 분리와 임계값', () => {
  // ATR을 안정시키기 위한 도입부 20봉
  const lead = () => Array.from({ length: 20 }, (_, i) => mk(100, 102, 98, 100, 100, i))

  it('색이 반대이고 저점이 일치하면 tweezer_bottom 을 낸다', () => {
    const cs = [...lead(), mk(100, 101, 95, 96, 100, 20), mk(96, 101, 95, 100, 100, 21)]
    const ids = detectCandlePatterns(cs).filter(s => s.barIndex === 21).map(s => s.id)
    expect(ids).toContain('tweezer_bottom')
    expect(ids).not.toContain('candle_tweezer')
  })

  it('색이 반대이고 고점이 일치하면 tweezer_top 을 낸다', () => {
    const cs = [...lead(), mk(96, 105, 95, 100, 100, 20), mk(100, 105, 95, 96, 100, 21)]
    const ids = detectCandlePatterns(cs).filter(s => s.barIndex === 21).map(s => s.id)
    expect(ids).toContain('tweezer_top')
  })

  it('두 봉의 색이 같으면 트위저를 내지 않는다', () => {
    const cs = [...lead(), mk(96, 101, 95, 100, 100, 20), mk(96, 101, 95, 100, 100, 21)]
    const ids = detectCandlePatterns(cs).filter(s => s.barIndex === 21).map(s => s.id)
    expect(ids).not.toContain('tweezer_bottom')
    expect(ids).not.toContain('tweezer_top')
  })

  it('저점 차이가 ATR의 10%를 넘으면 내지 않는다', () => {
    // lead 의 TR 은 4 이므로 ATR ≈ 4, 허용오차 ≈ 0.4. 저점을 2 만큼 벌린다.
    const cs = [...lead(), mk(100, 101, 95, 96, 100, 20), mk(96, 101, 97, 100, 100, 21)]
    const ids = detectCandlePatterns(cs).filter(s => s.barIndex === 21).map(s => s.id)
    expect(ids).not.toContain('tweezer_bottom')
  })

  it('한 봉에서 상반된 side 의 트위저가 동시에 나오지 않는다', () => {
    const cs = synthCandles(400)
    const sigs = detectCandlePatterns(cs).filter(s => s.id.startsWith('tweezer_'))
    const byBar = new Map<number, Set<string>>()
    for (const s of sigs) {
      const set = byBar.get(s.barIndex) ?? new Set()
      set.add(s.side)
      byBar.set(s.barIndex, set)
    }
    for (const [bar, sides] of byBar) {
      expect(sides.size, `bar ${bar} 에서 양방향 동시 발화`).toBe(1)
    }
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/analysis/candlePatterns.test.ts`
Expected: FAIL — `tweezer_bottom` 을 찾지 못한다 (현재 id는 `candle_tweezer`)

- [ ] **Step 3: 구현한다**

`src/analysis/candlePatterns.ts` 의 60~65행을 아래로 교체한다.

```ts
      // 트위저: 두 봉의 색이 반대이고 저점(또는 고점)이 ATR 대비 사실상 일치.
      // 허용오차를 가격 %가 아니라 ATR 상대로 두는 이유는, 같은 0.1%라도
      // 자산·타임프레임에 따라 "일치"의 의미가 달라지기 때문이다.
      const tol = 0.1 * (a[i] || 0)
      const oppositeColor = isBull(c) !== isBull(p)
      if (tol > 0 && oppositeColor) {
        if (Math.abs(c.low - p.low) <= tol && isBull(c)) {
          out.push(sig('tweezer_bottom', 'bullish', i, `저점 ${c.low.toFixed(2)} 이 직전 봉과 일치 (ATR 대비 ${(Math.abs(c.low - p.low) / a[i] * 100).toFixed(1)}%)`, 1))
        }
        if (Math.abs(c.high - p.high) <= tol && !isBull(c)) {
          out.push(sig('tweezer_top', 'bearish', i, `고점 ${c.high.toFixed(2)} 이 직전 봉과 일치 (ATR 대비 ${(Math.abs(c.high - p.high) / a[i] * 100).toFixed(1)}%)`, 1))
        }
      }
```

`isBull(c)` / `!isBull(c)` 조건이 양방향 동시 발화를 구조적으로 막는다 — 현재 봉은 양봉이거나 음봉이지 둘 다일 수 없다.

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run`
Expected: 전부 통과. `candle_tweezer` 를 참조하던 기존 테스트가 있으면 새 id로 갱신한다.

- [ ] **Step 5: 발화율이 실제로 줄었는지 확인한다**

`scripts/hello.ts` 를 아래로 바꾸고 실행한다.

```ts
import { fetchKlines } from '../src/data/binance'
import { detectCandlePatterns } from '../src/analysis/candlePatterns'

for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
  const cs = await fetchKlines(sym, '4h', { limit: 1000 })
  const n = detectCandlePatterns(cs).filter(s => s.id.startsWith('tweezer_')).length
  console.log(`${sym} 4h: 트위저 ${n}회 / 1000봉`)
}
```

Run: `npm run script -- scripts/hello.ts`
Expected: 각 종목 1000봉당 **150회 미만**. 보강 전 실측은 163~314회였다.
여전히 150회를 넘으면 `tol` 계수를 0.1에서 0.05로 낮추고 Step 4부터 다시 한다.

- [ ] **Step 6: 커밋**

```bash
git add src/analysis/candlePatterns.ts src/analysis/candlePatterns.test.ts scripts/hello.ts
git commit -m "fix(candle): 트위저를 tweezer_top/bottom 으로 분리하고 임계값 보강 (D3)

세 가지를 고쳤다.
- 같은 id가 상반된 side로 발화해 id가 키 노릇을 못 하던 문제
- 허용오차가 가격의 0.1%라 4h 1000봉당 163~314회 발화하던 문제 → ATR 상대로 변경
- 두 봉의 색이 반대여야 한다는 조건이 아예 없던 문제"
```

---

### Task 3: `types.ts` 와 `taxonomy.ts`

**Files:**
- Create: `src/quiz/types.ts`
- Create: `src/quiz/taxonomy.ts`
- Create: `src/quiz/taxonomy.test.ts`

**Interfaces:**
- Consumes: `Signal` `Tier` `SignalKind` `Confidence` (`analysis/signalTypes`), `Candle` `Timeframe` (`data/types`)
- Produces: 아래 타입 전부와 `TAGS: TagDef[]`, `TAG_BY_ID: Map<string, TagDef>`

- [ ] **Step 1: `types.ts` 를 쓴다**

```ts
import type { Candle, Timeframe } from '../data/types'

export type Direction = 'long' | 'short' | 'flat'
export type QuestionType = 'normal' | 'trap' | 'no_setup'
export type Difficulty = 'easy' | 'medium' | 'hard'

export type SetupCandidate = {
  barIndex: number
  setupScore: number
  difficulty: Difficulty
  /** 유효 근거의 가중 합이 큰 쪽 */
  dominantSide: 'bullish' | 'bearish' | 'neutral'
  activeCount: number
}

export type Question = {
  symbol: string
  timeframe: Timeframe
  /** 창 첫 봉의 time (초). {symbol, timeframe, startTime, decisionIndex} 가 재현 키다 */
  startTime: number
  /** 창 내 인덱스. 이 봉까지가 사용자에게 보인다 */
  decisionIndex: number
  type: QuestionType
  difficulty: Difficulty
  /** 은닉 구간을 포함한 창 전체 */
  candles: Candle[]
}

export type Answer = {
  direction: Direction
  entry?: number
  stopLoss?: number
  takeProfit?: number
  /** 체크한 태그 id. 최대 15개 */
  tags: string[]
  memo?: string
}

export type ReplayResult = {
  filled: boolean
  exit: 'tp' | 'sl' | 'forced' | 'none'
  exitBarIndex: number | null
  pnlPct: number
  /** 손실 1R 기준 배수. 손절폭이 0이면 0 */
  r: number
}

export type EvidenceVerdict = {
  /** 체크했고 유효한 근거 */
  hits: string[]
  /** 핵심 근거인데 체크하지 않음 — 감점 대상 */
  coreMisses: string[]
  /** 유효하지만 핵심이 아닌 미체크 근거 — 감점 없음 */
  reference: string[]
  /** 체크했으나 그 시점에 존재하지 않은 근거 */
  falseClaims: string[]
}

export type GradeReport = {
  direction: { correct: Direction; answered: Direction; score: number }
  execution: { score: number; notes: string[] }
  evidence: { score: number; verdict: EvidenceVerdict }
  /** 근거 + 실행 */
  processScore: number
  /** 방향 + 재생 결과 */
  outcomeScore: number
  totalScore: number
  judgement: string
  replay: ReplayResult
}
```

- [ ] **Step 2: `taxonomy.ts` 를 쓴다**

수명 클래스 배정은 스펙 3.2를 그대로 옮긴 것이다. `recent.bars` 는 초안 5, `zone.maxBars` 는 초안 50이며 Task 5에서 실측으로 확정한다.

```ts
import type { Tier, SignalKind, Confidence } from '../analysis/signalTypes'

export type LifetimeClass =
  | { kind: 'bar' }
  | { kind: 'recent'; bars: number }
  | { kind: 'zone'; maxBars: number; invalidateOn: 'touch' | 'close_through' }
  | { kind: 'state' }

export type TagDef = {
  id: string
  label: string
  tier: Tier
  kind: SignalKind
  confidence: Confidence
  lifetime: LifetimeClass
}

const bar = (): LifetimeClass => ({ kind: 'bar' })
const recent = (bars: number): LifetimeClass => ({ kind: 'recent', bars })
const state = (): LifetimeClass => ({ kind: 'state' })
const zone = (maxBars: number, invalidateOn: 'touch' | 'close_through'): LifetimeClass =>
  ({ kind: 'zone', maxBars, invalidateOn })

const t = (
  id: string, label: string, tier: Tier, kind: SignalKind, lifetime: LifetimeClass,
  confidence: Confidence = 'A',
): TagDef => ({ id, label, tier, kind, confidence, lifetime })

/**
 * 감지기가 실제로 배출하는 태그만 올린다. 감지기 없는 태그를 노출하면
 * 사용자가 체크하는 족족 확정 ❌ 가 된다 (인계문서 2절).
 */
export const TAGS: TagDef[] = [
  // ── Tier 1 ──
  t('liq_sweep_low', '저점 유동성 스윕 (롱 손절 사냥)', 1, 'smc', recent(5)),
  t('liq_sweep_high', '고점 유동성 스윕 (숏 손절 사냥)', 1, 'smc', recent(5)),
  t('ob_bull_support', '강세 오더블록 지지', 1, 'smc', zone(50, 'close_through')),
  t('ob_bear_resistance', '약세 오더블록 저항', 1, 'smc', zone(50, 'close_through')),
  t('msb_bull', '시장구조 상향 돌파 (BOS/MSB)', 1, 'structure', recent(5)),
  t('msb_bear', '시장구조 하향 붕괴', 1, 'structure', recent(5)),

  // ── Tier 2 ──
  // FVG는 detectFVG가 이미 미충족만 배출하므로 zone이 아니라 recent다 (스펙 2.3)
  t('fvg_bull', '상승 FVG (미충족)', 2, 'smc', recent(5)),
  t('fvg_bear', '하락 FVG (미충족)', 2, 'smc', recent(5)),
  t('vol_breakout_confirm', '돌파 시 거래량 급증', 2, 'volume', recent(5)),
  t('vol_breakout_weak', '거래량 없는 돌파 (트랩)', 2, 'volume', recent(5)),
  t('vol_climax', '거래량 클라이맥스', 2, 'volume', recent(5)),

  // ── Tier 3 ──
  t('trend_up_structure', '상승 구조 (HH/HL)', 3, 'structure', state()),
  t('trend_down_structure', '하락 구조 (LH/LL)', 3, 'structure', state()),
  t('trend_range', '횡보 레인지', 3, 'structure', state()),
  t('bb_squeeze', '볼린저 스퀴즈', 3, 'volatility', state()),
  t('bb_break_upper', '볼린저 상단 돌파', 3, 'volatility', bar()),
  t('bb_break_lower', '볼린저 하단 이탈', 3, 'volatility', bar()),

  // ── Tier 4: 캔들패턴 17종 ──
  t('candle_hammer', '해머', 4, 'candle', bar()),
  t('candle_inv_hammer', '역해머', 4, 'candle', bar()),
  t('candle_shooting_star', '유성형', 4, 'candle', bar()),
  t('candle_doji', '도지', 4, 'candle', bar()),
  t('candle_bull_engulf', '강세 장악형', 4, 'candle', bar()),
  t('candle_bear_engulf', '약세 장악형', 4, 'candle', bar()),
  t('candle_bull_harami', '강세 하라미', 4, 'candle', bar()),
  t('candle_bear_harami', '약세 하라미', 4, 'candle', bar()),
  t('candle_morning_star', '샛별형', 4, 'candle', bar()),
  t('candle_evening_star', '석별형', 4, 'candle', bar()),
  t('candle_three_soldiers', '적삼병', 4, 'candle', bar()),
  t('candle_three_crows', '흑삼병', 4, 'candle', bar()),
  t('candle_tri_star', '트라이스타', 4, 'candle', bar()),
  t('tweezer_top', '트위저 탑', 4, 'candle', bar()),
  t('tweezer_bottom', '트위저 바텀', 4, 'candle', bar()),
  t('candle_long_wick', '긴 꼬리', 4, 'candle', bar()),
  t('candle_inside_bar', '인사이드 바', 4, 'candle', bar()),

  // ── Tier 4: 지표 ──
  t('ma_aligned_bull', '이동평균 정배열', 4, 'ma', state()),
  t('ma_aligned_bear', '이동평균 역배열', 4, 'ma', state()),
  t('ma_golden_cross', '골든크로스', 4, 'ma', bar()),
  t('ma_dead_cross', '데드크로스', 4, 'ma', bar()),
  t('macd_golden', 'MACD 골든크로스', 4, 'momentum', bar()),
  t('macd_dead', 'MACD 데드크로스', 4, 'momentum', bar()),
  t('macd_zero_break', 'MACD 0선 돌파', 4, 'momentum', bar()),
  t('macd_divergence', 'MACD 다이버전스', 4, 'momentum', recent(5)),
  t('rsi_overbought', 'RSI 과매수', 4, 'momentum', state()),
  t('rsi_oversold', 'RSI 과매도', 4, 'momentum', state()),
  t('rsi_50_break', 'RSI 50선 돌파', 4, 'momentum', bar()),
  t('rsi_bull_div', 'RSI 강세 다이버전스', 4, 'momentum', recent(5)),
  t('rsi_bear_div', 'RSI 약세 다이버전스', 4, 'momentum', recent(5)),
  t('rsi_hidden_div', 'RSI 히든 다이버전스', 4, 'momentum', recent(5)),
  t('obv_divergence', 'OBV 다이버전스', 4, 'volume', recent(5)),
]

export const TAG_BY_ID = new Map(TAGS.map((d) => [d.id, d]))
```

- [ ] **Step 3: 정합성 테스트를 쓴다**

`src/quiz/taxonomy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TAGS, TAG_BY_ID } from './taxonomy'
import { detectAll } from '../analysis/signals'
import { synthCandles } from '../analysis/fixtures'

describe('taxonomy 정합성', () => {
  it('id 가 중복되지 않는다', () => {
    expect(TAG_BY_ID.size).toBe(TAGS.length)
  })

  it('감지기가 배출하는 모든 id 가 taxonomy 에 있다', () => {
    // 감지기 없는 태그를 노출하면 사용자가 체크하는 족족 확정 ❌ 가 되고,
    // 반대로 taxonomy 에 없는 id 를 감지기가 내면 영구 유령 ⚠️놓침이 된다.
    const emitted = new Set(detectAll(synthCandles(600)).map((s) => s.id))
    const missing = [...emitted].filter((id) => !TAG_BY_ID.has(id))
    expect(missing, `taxonomy 에 없는 배출 id: ${missing.join(', ')}`).toEqual([])
  })

  it('zone 으로 선언된 태그는 감지기가 가격 구간을 채운다', () => {
    const zoneIds = new Set(TAGS.filter((d) => d.lifetime.kind === 'zone').map((d) => d.id))
    const sigs = detectAll(synthCandles(600)).filter((s) => zoneIds.has(s.id))
    expect(sigs.length, 'zone 태그가 픽스처에서 하나도 안 나오면 검증이 공허하다').toBeGreaterThan(0)
    for (const s of sigs) {
      expect(s.refs?.priceLow, `${s.id} @${s.barIndex} 에 priceLow 없음`).toBeTypeOf('number')
      expect(s.refs?.priceHigh, `${s.id} @${s.barIndex} 에 priceHigh 없음`).toBeTypeOf('number')
    }
  })

  it('taxonomy 의 tier·kind 가 감지기 출력과 일치한다', () => {
    for (const s of detectAll(synthCandles(600))) {
      const def = TAG_BY_ID.get(s.id)
      if (!def) continue
      expect(def.tier, `${s.id} tier 불일치`).toBe(s.tier)
      expect(def.kind, `${s.id} kind 불일치`).toBe(s.kind)
    }
  })
})
```

- [ ] **Step 4: 테스트를 돌린다**

Run: `npx vitest run src/quiz/taxonomy.test.ts`
Expected: 4개 통과. 실패하면 taxonomy 쪽을 고친다 — **감지기를 고치지 않는다.**
`synthCandles(600)` 에서 `zone` 태그가 하나도 안 나오면 캔들 수를 늘린다.

- [ ] **Step 5: 타입체크와 전체 테스트**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 6: 커밋**

```bash
git add src/quiz/types.ts src/quiz/taxonomy.ts src/quiz/taxonomy.test.ts
git commit -m "feat(quiz): 타입 계약과 태그 49종 taxonomy

수명 클래스를 태그 정의에 함께 선언한다. 감지기는 건드리지 않는다.
recent.bars 와 zone.maxBars 는 초안값이며 calibrate 로 확정한다.

정합성 테스트 4개로 taxonomy 와 감지기의 어긋남을 막는다."
```

---

### Task 4: `lifetime.ts` — 유효 근거 필터

**Files:**
- Create: `src/quiz/lifetime.ts`
- Create: `src/quiz/lifetime.test.ts`

**Interfaces:**
- Consumes: `TAG_BY_ID` (Task 3), `detectSignals` (`analysis/signals`), `Signal`
- Produces:
  - `type ActiveSignal = Signal & { ageBars: number }`
  - `filterActive(cs: Candle[], signals: Signal[], atIndex: number): ActiveSignal[]` — 순수 필터. 스캐너 1단계가 미리 계산한 신호에 쓴다
  - `activeSignalsAt(cs: Candle[], atIndex: number): ActiveSignal[]` — 정확 경로. 채점과 스캐너 2단계가 쓴다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/quiz/lifetime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { filterActive, activeSignalsAt } from './lifetime'
import type { Signal } from '../analysis/signalTypes'
import { mk, synthCandles } from '../analysis/fixtures'

const flat = (n: number, price = 100) =>
  Array.from({ length: n }, (_, i) => mk(price, price + 1, price - 1, price, 100, i))

const sig = (id: string, barIndex: number, over: Partial<Signal> = {}): Signal => ({
  id, tier: 4, kind: 'candle', side: 'bullish', barIndex,
  confidence: 'A', strength: 1, evidence: '', ...over,
})

describe('수명 클래스', () => {
  it('bar: 그 봉에서만 유효하다', () => {
    const cs = flat(30)
    const s = [sig('candle_doji', 20, { side: 'neutral' })]
    expect(filterActive(cs, s, 20).map(x => x.id)).toEqual(['candle_doji'])
    expect(filterActive(cs, s, 21)).toEqual([])
  })

  it('recent: N봉 이내만 유효하다', () => {
    const cs = flat(30)
    const s = [sig('liq_sweep_low', 20, { tier: 1, kind: 'smc' })]
    expect(filterActive(cs, s, 24)).toHaveLength(1)   // ageBars 4 < 5
    expect(filterActive(cs, s, 25)).toHaveLength(0)   // ageBars 5
  })

  it('state: 같은 id 중 최신 1개만 남긴다', () => {
    const cs = flat(30)
    const s = [
      sig('ma_aligned_bull', 10, { kind: 'ma' }),
      sig('ma_aligned_bull', 15, { kind: 'ma' }),
      sig('ma_aligned_bull', 18, { kind: 'ma' }),
    ]
    const out = filterActive(cs, s, 25)
    expect(out).toHaveLength(1)
    expect(out[0].barIndex).toBe(18)
  })

  it('state: 관측 시점 이후의 것은 쓰지 않는다', () => {
    const cs = flat(30)
    const s = [sig('ma_aligned_bull', 10, { kind: 'ma' }), sig('ma_aligned_bull', 22, { kind: 'ma' })]
    const out = filterActive(cs, s, 15)
    expect(out).toHaveLength(1)
    expect(out[0].barIndex).toBe(10)
  })

  it('zone close_through: 종가가 구간 아래로 마감하면 무효', () => {
    const cs = flat(30)
    cs[24] = mk(100, 101, 88, 89, 100, 24)   // 종가 89 < priceLow 95
    const s = [sig('ob_bull_support', 20, {
      tier: 1, kind: 'smc', refs: { priceLow: 95, priceHigh: 99 },
    })]
    expect(filterActive(cs, s, 23)).toHaveLength(1)
    expect(filterActive(cs, s, 25)).toHaveLength(0)
  })

  it('zone: maxBars 를 넘으면 무효', () => {
    const cs = flat(200)
    const s = [sig('ob_bull_support', 20, {
      tier: 1, kind: 'smc', refs: { priceLow: 95, priceHigh: 99 },
    })]
    expect(filterActive(cs, s, 69)).toHaveLength(1)    // ageBars 49
    expect(filterActive(cs, s, 71)).toHaveLength(0)    // ageBars 51 > 50
  })

  it('taxonomy 에 없는 id 는 버린다', () => {
    const cs = flat(30)
    expect(filterActive(cs, [sig('존재하지_않는_태그', 20)], 20)).toEqual([])
  })

  it('ageBars 를 채운다', () => {
    const cs = flat(30)
    const out = filterActive(cs, [sig('liq_sweep_low', 20, { tier: 1, kind: 'smc' })], 23)
    expect(out[0].ageBars).toBe(3)
  })

  it('미래 신호는 절대 통과시키지 않는다', () => {
    const cs = flat(30)
    expect(filterActive(cs, [sig('candle_doji', 25, { side: 'neutral' })], 20)).toEqual([])
  })
})

describe('activeSignalsAt', () => {
  it('총량을 크게 줄인다', () => {
    const cs = synthCandles(400)
    const active = activeSignalsAt(cs, 340)
    // 수명 없이는 수백 개다. 목표는 8~15개이며 Task 5에서 조정한다.
    expect(active.length).toBeGreaterThan(0)
    expect(active.length).toBeLessThan(60)
  })

  it('결정 시점 이후 봉을 바꿔도 결과가 같다 (미래참조 없음)', () => {
    const cs = synthCandles(400)
    const before = activeSignalsAt(cs, 200)
    const tampered = [...cs]
    for (let i = 201; i < tampered.length; i++) {
      tampered[i] = mk(1, 2, 0.5, 1.5, 999, i)
    }
    expect(activeSignalsAt(tampered, 200)).toEqual(before)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/quiz/lifetime.test.ts`
Expected: FAIL — `./lifetime` 모듈이 없다

- [ ] **Step 3: 구현한다**

`src/quiz/lifetime.ts`:

```ts
import type { Candle } from '../data/types'
import type { Signal } from '../analysis/signalTypes'
import { detectSignals } from '../analysis/signals'
import { TAG_BY_ID, type LifetimeClass } from './taxonomy'

export type ActiveSignal = Signal & { ageBars: number }

/** zone 구간이 barIndex+1..atIndex 사이에 무효화되었는가 */
function zoneInvalidated(
  cs: Candle[], s: Signal, atIndex: number, mode: 'touch' | 'close_through',
): boolean {
  const lo = s.refs?.priceLow
  const hi = s.refs?.priceHigh
  if (lo === undefined || hi === undefined) return false

  for (let j = s.barIndex + 1; j <= atIndex && j < cs.length; j++) {
    const c = cs[j]
    if (mode === 'touch') {
      if (c.low <= hi && c.high >= lo) return true
    } else {
      // 종가가 구간을 완전히 통과해 마감 = 오더블록이 깨짐
      if (s.side === 'bullish' && c.close < lo) return true
      if (s.side === 'bearish' && c.close > hi) return true
    }
  }
  return false
}

function isAlive(cs: Candle[], s: Signal, atIndex: number, lt: LifetimeClass): boolean {
  const age = atIndex - s.barIndex
  switch (lt.kind) {
    case 'bar':    return age === 0
    case 'recent': return age < lt.bars
    case 'state':  return true   // 최신 1개 선별은 호출부에서 한다
    case 'zone':   return age <= lt.maxBars && !zoneInvalidated(cs, s, atIndex, lt.invalidateOn)
  }
}

/**
 * 주어진 신호 목록에 수명 규칙을 적용한다.
 * 스캐너 1단계처럼 신호를 미리 계산해 둔 경우에 쓴다.
 */
export function filterActive(cs: Candle[], signals: Signal[], atIndex: number): ActiveSignal[] {
  const out: ActiveSignal[] = []
  const latestState = new Map<string, Signal>()

  for (const s of signals) {
    if (s.barIndex > atIndex) continue          // 미래 신호는 무조건 배제
    const def = TAG_BY_ID.get(s.id)
    if (!def) continue                          // taxonomy 에 없는 id 는 채점 대상이 아니다
    if (!isAlive(cs, s, atIndex, def.lifetime)) continue

    if (def.lifetime.kind === 'state') {
      const prev = latestState.get(s.id)
      if (!prev || s.barIndex > prev.barIndex) latestState.set(s.id, s)
      continue
    }
    out.push({ ...s, ageBars: atIndex - s.barIndex })
  }

  for (const s of latestState.values()) {
    out.push({ ...s, ageBars: atIndex - s.barIndex })
  }

  return out.sort((a, b) => a.barIndex - b.barIndex || a.id.localeCompare(b.id))
}

/**
 * atIndex 시점의 유효 근거 집합. **채점과 스캐너 2단계의 유일한 진입점이다.**
 * detectAll(cs).filter() 지름길을 여기서 쓰면 안 된다 — 상태 의존 신호(미충족 FVG 등)가
 * 관측 시점에 따라 정당하게 달라지므로 두 경로는 동치가 아니다.
 */
export function activeSignalsAt(cs: Candle[], atIndex: number): ActiveSignal[] {
  return filterActive(cs, detectSignals(cs, atIndex), atIndex)
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run src/quiz/lifetime.test.ts`
Expected: 11개 전부 통과

- [ ] **Step 5: 비공허성 확인 — 조건을 뒤집으면 테스트가 잡는가**

`isAlive` 의 `case 'bar': return age === 0` 을 `return true` 로 임시 변경하고
`npx vitest run src/quiz/lifetime.test.ts` 를 돌린다.
Expected: "bar: 그 봉에서만 유효하다" 가 FAIL. 확인 후 되돌린다.

같은 방법으로 `case 'recent': return age < lt.bars` 를 `return true` 로 바꿔
"recent: N봉 이내만 유효하다" 가 FAIL 하는지 확인하고 되돌린다.

- [ ] **Step 6: 전체 테스트와 타입체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 7: 커밋**

```bash
git add src/quiz/lifetime.ts src/quiz/lifetime.test.ts
git commit -m "feat(quiz): 신호 수명 필터 — activeSignalsAt

수명 4클래스(bar/recent/zone/state)를 적용해 유효 근거 집합을 낸다.
채점과 스캐너 2단계의 유일한 진입점이다.

state 는 같은 id 중 최신 1개만 남긴다 — ma_aligned_* 만으로 10000봉당
5580회 발화하던 것이 여기서 접힌다."
```

---

### Task 5: 파일 캐시와 `calibrate.ts` — **위험 체크포인트 ①**

**이 태스크가 Part 2에서 가장 위험한 지점이다.** 수명 규칙으로 유효 근거를 8~15개로
줄이지 못하면 채점 설계(핵심/참고 2단)의 전제가 무너지고, Task 6~10이 전부 헛일이 된다.
의존 사슬(Task 2→3→4→5)상 이것이 가장 이른 검증 시점이다.

**Files:**
- Create: `src/data/fileCache.ts`
- Create: `src/data/fileCache.test.ts`
- Create: `scripts/calibrate.ts`
- Delete: `scripts/hello.ts`
- Modify: `src/quiz/taxonomy.ts` (실측 결과로 `recent.bars` / `zone.maxBars` 확정)

**Interfaces:**
- Consumes: `fetchKlines` (`data/binance`), `activeSignalsAt` (Task 4)
- Produces: `getCandles(symbol, tf, limit): Promise<Candle[]>` — 캐시 우선, 없으면 fetch 후 저장

- [ ] **Step 1: 파일 캐시 테스트를 쓴다**

`src/data/fileCache.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { rmSync, existsSync } from 'node:fs'
import { cachePath, readCache, writeCache } from './fileCache'
import { mk } from '../analysis/fixtures'

const SYM = '__TEST__'

afterEach(() => {
  const p = cachePath(SYM, '4h', 10)
  if (existsSync(p)) rmSync(p)
})

describe('파일 캔들 캐시', () => {
  it('쓰고 읽으면 같은 값이 나온다', () => {
    const cs = Array.from({ length: 10 }, (_, i) => mk(1 + i, 2 + i, 0.5 + i, 1.5 + i, 100, i))
    writeCache(SYM, '4h', 10, cs)
    expect(readCache(SYM, '4h', 10)).toEqual(cs)
  })

  it('없으면 null 을 낸다', () => {
    expect(readCache(SYM, '4h', 10)).toBeNull()
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/data/fileCache.test.ts`
Expected: FAIL — `./fileCache` 모듈이 없다

- [ ] **Step 3: 파일 캐시를 구현한다**

`src/data/fileCache.ts`:

```ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Candle, Timeframe } from './types'
import { fetchKlines } from './binance'

/**
 * 스크립트 전용 캔들 캐시. Node 에만 존재하며 브라우저의 IndexedDB 캐시(cache.ts)와 별개다.
 * 임계값 조정은 같은 데이터로 수십 번 반복하므로 매번 네트워크를 치면 느리고 불안정하다.
 */
const DIR = join(process.cwd(), '.candle-cache')

export function cachePath(symbol: string, tf: Timeframe, limit: number): string {
  return join(DIR, `${symbol}-${tf}-${limit}.json`)
}

export function readCache(symbol: string, tf: Timeframe, limit: number): Candle[] | null {
  const p = cachePath(symbol, tf, limit)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as Candle[]
}

export function writeCache(symbol: string, tf: Timeframe, limit: number, cs: Candle[]): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(cachePath(symbol, tf, limit), JSON.stringify(cs), 'utf8')
}

export async function getCandles(symbol: string, tf: Timeframe, limit = 1000): Promise<Candle[]> {
  const hit = readCache(symbol, tf, limit)
  if (hit) return hit
  const cs = await fetchKlines(symbol, tf, { limit })
  writeCache(symbol, tf, limit, cs)
  return cs
}
```

`.candle-cache/` 를 `.gitignore` 에 추가한다. `.gitignore` 가 없으면 만든다.

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run src/data/fileCache.test.ts`
Expected: 2개 통과

- [ ] **Step 5: `calibrate.ts` 를 쓴다**

```ts
import { getCandles } from '../src/data/fileCache'
import { activeSignalsAt } from '../src/quiz/lifetime'
import { TAGS } from '../src/quiz/taxonomy'
import type { Timeframe } from '../src/data/types'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT']
const TFS: Timeframe[] = ['4h', '1d']
/** 결정 시점 표본. 워밍업 120봉을 지난 지점들 */
const AT = [200, 300, 400, 500, 600, 700, 800, 900]

const counts: number[] = []
const tagHits = new Map<string, number>()

for (const sym of SYMBOLS) {
  for (const tf of TFS) {
    const cs = await getCandles(sym, tf, 1000)
    const local: number[] = []
    for (const at of AT) {
      const active = activeSignalsAt(cs, at)
      local.push(active.length)
      counts.push(active.length)
      for (const s of active) tagHits.set(s.id, (tagHits.get(s.id) ?? 0) + 1)
    }
    console.log(`${sym} ${tf}: 유효 근거 ${local.join(', ')}`)
  }
}

const sorted = [...counts].sort((a, b) => a - b)
const pct = (p: number) => sorted[Math.floor(sorted.length * p)]
console.log(`\n=== 유효 근거 분포 (표본 ${counts.length}개) ===`)
console.log(`최소 ${sorted[0]} / p25 ${pct(0.25)} / 중앙 ${pct(0.5)} / p75 ${pct(0.75)} / 최대 ${sorted[sorted.length - 1]}`)
console.log(`목표: 중앙값 8~15`)

console.log(`\n=== 태그별 유효 출현 (표본 ${counts.length}시점) ===`)
for (const [id, n] of [...tagHits].sort((a, b) => b[1] - a[1])) {
  console.log(`${id.padEnd(26)} ${n}`)
}

const never = TAGS.filter((t) => !tagHits.has(t.id)).map((t) => t.id)
console.log(`\n한 번도 유효하지 않은 태그 ${never.length}종: ${never.join(', ') || '없음'}`)
```

- [ ] **Step 6: 돌려서 분포를 본다**

Run: `npm run calibrate`
Expected: 중앙값이 출력된다. 첫 실행은 네트워크를 타므로 10~20초 걸린다.

- [ ] **Step 7: 목표에 맞을 때까지 `taxonomy.ts` 의 수명 값을 조정한다**

중앙값이 **8~15** 안에 들어올 때까지 반복한다.

- 중앙값이 15보다 크면: `recent(5)` 를 `recent(3)` 으로, `zone(50, ...)` 을 `zone(30, ...)` 으로 낮춘다
- 8보다 작으면 반대로 올린다
- 특정 태그가 표본 대비 과도하게 자주 유효하면(예: 표본의 80% 이상) 그 태그만 `recent` 값을 낮춘다 — 스펙 3.2에 적힌 대로 `recent.bars` 는 태그별로 달라도 된다

조정할 때마다 `npm run calibrate` 를 다시 돌린다. 2회차부터는 캐시를 타서 즉시 끝난다.

- [ ] **Step 8: 목표 미달 시 — 멈추고 보고한다**

수명 값을 아무리 조정해도 중앙값이 8~15에 들어오지 않으면 **여기서 멈춘다.**
Task 6 이후를 진행하지 말고 아래를 보고한다.

- 조정해 본 값의 조합과 각각의 중앙값
- 분포를 지배하는 태그 상위 5개와 각 출현 횟수
- `state`/`recent`/`zone`/`bar` 클래스별 기여도

수명 규약 자체를 다시 설계해야 한다는 뜻이며, 이는 스펙 3절로 되돌아가는 결정이다.

- [ ] **Step 9: 확정된 값으로 lifetime 테스트를 갱신한다**

Task 4의 `recent: N봉 이내만 유효하다` 와 `zone: maxBars 를 넘으면 무효` 테스트는
초안값 5와 50을 하드코딩하고 있다. 확정값에 맞춰 고친다.

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 10: `hello.ts` 를 지우고 커밋**

```bash
rm scripts/hello.ts
git add -A
git commit -m "feat(quiz): 파일 캔들 캐시와 calibrate 스크립트, 수명 값 확정

실측으로 recent.bars 와 zone.maxBars 를 정했다. 유효 근거 중앙값 <실제 측정값>개.
스펙이 calibrate 에 위임한 4개 값 중 2개가 여기서 확정된다."
```

커밋 메시지의 `<실제 측정값>` 은 Step 7의 최종 출력에서 읽은 중앙값으로 바꾼다.

---

### Task 6: `scanner.ts` — 2단계 스캔 · **위험 체크포인트 ②**

**Files:**
- Create: `src/quiz/scanner.ts`
- Create: `src/quiz/scanner.test.ts`
- Modify: `scripts/calibrate.ts` (후보 밀도 측정 추가)

**Interfaces:**
- Consumes: `filterActive` `activeSignalsAt` (Task 4), `detectAll` (`analysis/signals`), `SetupCandidate` `Difficulty` (Task 3)
- Produces:
  - `setupScore(signals: Signal[]): number`
  - `dominantSide(signals: Signal[]): 'bullish' | 'bearish' | 'neutral'`
  - `scanForSetups(cs: Candle[], opts?: { minScore?: number; mergeWindow?: number }): SetupCandidate[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/quiz/scanner.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { setupScore, dominantSide, scanForSetups } from './scanner'
import { activeSignalsAt, filterActive } from './lifetime'
import { detectAll } from '../analysis/signals'
import type { Signal } from '../analysis/signalTypes'
import { synthCandles } from '../analysis/fixtures'

const sig = (id: string, tier: 1 | 2 | 3 | 4, kind: Signal['kind'], side: Signal['side'], strength: 1 | 2 | 3 = 1): Signal =>
  ({ id, tier, kind, side, barIndex: 10, confidence: 'A', strength, evidence: '' })

describe('setupScore', () => {
  it('base = Σ(tierWeight × strength)', () => {
    // Tier1×2 = 10, Tier4×1 = 2 → base 12, kind 2종 → diversity 4, 상충 없음
    const s = [sig('a', 1, 'smc', 'bullish', 2), sig('b', 4, 'candle', 'bullish', 1)]
    expect(setupScore(s)).toBe(12 + 4 - 0)
  })

  it('상충하면 감점한다', () => {
    // Tier1×1 각각 = 10, kind 1종 → diversity 2, min(1,1)=1 → conflict 3
    const s = [sig('a', 1, 'smc', 'bullish'), sig('b', 1, 'smc', 'bearish')]
    expect(setupScore(s)).toBe(10 + 2 - 3)
  })

  it('신호가 없으면 0이다', () => {
    expect(setupScore([])).toBe(0)
  })
})

describe('dominantSide', () => {
  it('가중 합이 큰 쪽을 낸다', () => {
    const s = [sig('a', 1, 'smc', 'bullish'), sig('b', 4, 'candle', 'bearish')]
    expect(dominantSide(s)).toBe('bullish')
  })

  it('동률이면 neutral', () => {
    const s = [sig('a', 1, 'smc', 'bullish'), sig('b', 1, 'smc', 'bearish')]
    expect(dominantSide(s)).toBe('neutral')
  })
})

describe('scanForSetups', () => {
  const cs = synthCandles(600)

  it('후보의 barIndex 가 오름차순이고 중복되지 않는다', () => {
    const out = scanForSetups(cs)
    const idx = out.map(c => c.barIndex)
    expect(idx).toEqual([...idx].sort((a, b) => a - b))
    expect(new Set(idx).size).toBe(idx.length)
  })

  it('인접 후보를 병합해 mergeWindow 안에 하나만 남긴다', () => {
    const out = scanForSetups(cs, { minScore: 0, mergeWindow: 20 })
    for (let i = 1; i < out.length; i++) {
      expect(out[i].barIndex - out[i - 1].barIndex).toBeGreaterThanOrEqual(20)
    }
  })

  it('후보의 setupScore 가 2단계(정확) 계산과 일치한다', () => {
    // 1단계는 근사, 최종 후보는 정확 경로로 다시 계산되어야 한다
    for (const c of scanForSetups(cs).slice(0, 5)) {
      expect(c.setupScore).toBe(setupScore(activeSignalsAt(cs, c.barIndex)))
    }
  })

  it('1단계 근사는 정확 집합의 부분집합이다', () => {
    // 하네스가 보증하는 부등식(스펙 2.5)이 실제로 성립하는지 고정한다.
    // 깨지면 1단계가 정확 집합에 없는 신호를 만들어낸 것이고, 지름길이 무효가 된다.
    const all = detectAll(cs)
    for (const at of [200, 350, 500]) {
      const approx = filterActive(cs, all, at)
      const exact = activeSignalsAt(cs, at)
      const exactKeys = new Set(exact.map((s) => `${s.id}|${s.barIndex}`))
      for (const s of approx) {
        expect(exactKeys.has(`${s.id}|${s.barIndex}`), `${s.id}@${s.barIndex} 가 정확 집합에 없다`).toBe(true)
      }
    }
  })

  it('워밍업 구간에서는 후보를 내지 않는다', () => {
    expect(scanForSetups(cs).every(c => c.barIndex >= 120)).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/quiz/scanner.test.ts`
Expected: FAIL — `./scanner` 모듈이 없다

- [ ] **Step 3: 구현한다**

`src/quiz/scanner.ts`:

```ts
import type { Candle } from '../data/types'
import { type Signal, TIER_WEIGHT } from '../analysis/signalTypes'
import { detectAll } from '../analysis/signals'
import { filterActive, activeSignalsAt } from './lifetime'
import type { SetupCandidate, Difficulty } from './types'

/** 지표 워밍업에 필요한 봉 수. 이전 구간은 신호가 불완전하다 */
const WARMUP = 120

export function setupScore(signals: Signal[]): number {
  let base = 0
  let bull = 0
  let bear = 0
  const kinds = new Set<string>()
  for (const s of signals) {
    base += TIER_WEIGHT[s.tier] * s.strength
    kinds.add(s.kind)
    if (s.side === 'bullish') bull++
    else if (s.side === 'bearish') bear++
  }
  return base + 2 * kinds.size - 3 * Math.min(bull, bear)
}

export function dominantSide(signals: Signal[]): 'bullish' | 'bearish' | 'neutral' {
  let bull = 0
  let bear = 0
  for (const s of signals) {
    const w = TIER_WEIGHT[s.tier] * s.strength
    if (s.side === 'bullish') bull += w
    else if (s.side === 'bearish') bear += w
  }
  if (bull === bear) return 'neutral'
  return bull > bear ? 'bullish' : 'bearish'
}

function difficultyOf(signals: Signal[]): Difficulty {
  let bull = 0
  let bear = 0
  for (const s of signals) {
    if (s.side === 'bullish') bull++
    else if (s.side === 'bearish') bear++
  }
  const agree = Math.max(bull, bear)
  const conflict = Math.min(bull, bear)
  if (agree >= 4 && conflict === 0) return 'easy'
  if (conflict > 0 && Math.abs(bull - bear) <= 1) return 'hard'
  return 'medium'
}

/**
 * 2단계 스캔.
 *
 * 1단계는 detectAll 을 1회만 돌리고 수명 규칙으로 근사 점수를 낸다 — O(n).
 * 하네스가 보증하는 부등식(스펙 2.5)에 의해 이 근사는 정확 집합의 부분집합이므로
 * 과소추정이며, 그래서 1단계 임계값을 목표보다 낮게 잡아 후보를 넉넉히 남긴다.
 *
 * 2단계는 후보에 대해서만 activeSignalsAt 로 정확히 다시 계산한다.
 * 모든 봉에 activeSignalsAt 을 부르면 O(n²)이라 1000봉에 약 10분이 걸린다.
 */
export function scanForSetups(
  cs: Candle[],
  opts: { minScore?: number; mergeWindow?: number } = {},
): SetupCandidate[] {
  const minScore = opts.minScore ?? 25
  const mergeWindow = opts.mergeWindow ?? 20
  const coarseFloor = minScore * 0.7   // 과소추정을 감안한 여유

  // ── 1단계 ──
  const all = detectAll(cs)
  const rough: { barIndex: number; score: number }[] = []
  for (let i = WARMUP; i < cs.length; i++) {
    const score = setupScore(filterActive(cs, all, i))
    if (score >= coarseFloor) rough.push({ barIndex: i, score })
  }

  // ── 2단계 ──
  const exact: SetupCandidate[] = []
  for (const r of rough) {
    const active = activeSignalsAt(cs, r.barIndex)
    const score = setupScore(active)
    if (score < minScore) continue
    exact.push({
      barIndex: r.barIndex,
      setupScore: score,
      difficulty: difficultyOf(active),
      dominantSide: dominantSide(active),
      activeCount: active.length,
    })
  }

  // ── 인접 병합: mergeWindow 안에서는 점수가 가장 높은 하나만 남긴다 ──
  const merged: SetupCandidate[] = []
  for (const c of exact) {
    const last = merged[merged.length - 1]
    if (last && c.barIndex - last.barIndex < mergeWindow) {
      if (c.setupScore > last.setupScore) merged[merged.length - 1] = c
      continue
    }
    merged.push(c)
  }
  return merged
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run src/quiz/scanner.test.ts`
Expected: 8개 전부 통과

- [ ] **Step 5: `calibrate.ts` 에 후보 밀도 측정을 추가한다**

파일 끝에 붙인다.

```ts
import { scanForSetups } from '../src/quiz/scanner'

console.log(`\n=== 후보 밀도 (목표: 1000봉당 15~40개) ===`)
for (const min of [15, 20, 25, 30, 35]) {
  const densities: number[] = []
  for (const sym of SYMBOLS) {
    const cs = await getCandles(sym, '4h', 1000)
    densities.push(scanForSetups(cs, { minScore: min }).length)
  }
  const avg = densities.reduce((a, b) => a + b, 0) / densities.length
  console.log(`minScore ${String(min).padStart(2)}: ${densities.join(', ')} → 평균 ${avg.toFixed(1)}`)
}
```

- [ ] **Step 6: 돌려서 임계값을 정한다**

Run: `npm run calibrate`
Expected: 평균이 15~40 안에 드는 `minScore` 가 보인다. 그 값을 `scanner.ts` 의 기본값으로 박는다.

표에서 어느 행도 15~40에 들지 않으면 후보 구간을 넓혀 다시 측정한다(예: 5, 10, 40, 50).
그래도 안 되면 점수식의 `diversity`/`conflict` 계수를 조정해야 하며, 이는 스펙 6절 변경이므로
**멈추고 측정 표와 함께 보고한다.**

- [ ] **Step 7: 전체 테스트와 타입체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 8: 커밋**

```bash
git add src/quiz/scanner.ts src/quiz/scanner.test.ts scripts/calibrate.ts
git commit -m "feat(quiz): 2단계 셋업 스캐너

1단계는 detectAll 1회 + 수명 필터로 O(n) 근사, 2단계는 후보에만
activeSignalsAt 로 정확 계산. 전 봉에 정확 경로를 돌리면 O(n²)이라
1000봉에 약 10분이 걸린다.

부분집합 관계를 회귀 테스트로 고정했다. 이게 깨지면 1단계 지름길이 무효다.
minScore 는 실측으로 확정."
```

---

### Task 7: `generator.ts` — 문제 생성

**Files:**
- Create: `src/quiz/generator.ts`
- Create: `src/quiz/generator.test.ts`

**Interfaces:**
- Consumes: `scanForSetups` `dominantSide` (Task 6), `activeSignalsAt` (Task 4), `atr` (`analysis/indicators`), `Question` `QuestionType` `Direction` `SetupCandidate` (Task 3)
- Produces:
  - `classifyOutcome(cs: Candle[], decisionIndex: number, hiddenCount: number): { direction: Direction; upAtr: number; downAtr: number }`
  - `makeQuestion(cs: Candle[], symbol: string, tf: Timeframe, candidate: SetupCandidate, opts?: { warmup?: number; visible?: number; hidden?: number }): Question | null`
  - `revealed(q: Question): { symbol: string; time: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/quiz/generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifyOutcome, makeQuestion, revealed } from './generator'
import { scanForSetups } from './scanner'
import { mk, synthCandles } from '../analysis/fixtures'

describe('classifyOutcome', () => {
  // ATR 을 1 근처로 안정시키는 도입부
  const lead = (n: number) => Array.from({ length: n }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i))

  it('상방으로 1.5 ATR 이상 먼저 가면 long', () => {
    const cs = [...lead(200), ...Array.from({ length: 60 }, (_, i) => mk(100, 110, 99.5, 109, 100, 200 + i))]
    expect(classifyOutcome(cs, 199, 60).direction).toBe('long')
  })

  it('하방으로 1.5 ATR 이상 먼저 가면 short', () => {
    const cs = [...lead(200), ...Array.from({ length: 60 }, (_, i) => mk(100, 100.5, 90, 91, 100, 200 + i))]
    expect(classifyOutcome(cs, 199, 60).direction).toBe('short')
  })

  it('양쪽 다 1.5 ATR 에 못 미치면 flat', () => {
    const cs = [...lead(260)]
    expect(classifyOutcome(cs, 199, 60).direction).toBe('flat')
  })
})

describe('makeQuestion', () => {
  const cs = synthCandles(1000)
  const cand = scanForSetups(cs, { minScore: 0 }).find(c => c.barIndex > 300 && c.barIndex < 800)!

  it('창 길이가 warmup + visible + hidden 이다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand)!
    expect(q.candles).toHaveLength(400)
  })

  it('decisionIndex 가 후보 봉을 가리킨다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand)!
    expect(q.decisionIndex).toBe(339)
    // 창 안의 결정 봉이 원본의 후보 봉과 같은 캔들이어야 한다
    expect(q.candles[q.decisionIndex]).toEqual(cs[cand.barIndex])
  })

  it('startTime 이 창 첫 봉의 time 이다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand)!
    expect(q.startTime).toBe(q.candles[0].time)
  })

  it('같은 입력이면 같은 문제가 나온다 (재현성)', () => {
    expect(makeQuestion(cs, 'BTCUSDT', '4h', cand)).toEqual(makeQuestion(cs, 'BTCUSDT', '4h', cand))
  })

  it('창을 확보할 수 없으면 null 을 낸다', () => {
    const short = synthCandles(200)
    expect(makeQuestion(short, 'BTCUSDT', '4h', { ...cand, barIndex: 150 })).toBeNull()
  })

  it('유형이 셋 중 하나다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand)!
    expect(['normal', 'trap', 'no_setup']).toContain(q.type)
  })

  it('revealed 로만 종목과 시각을 꺼낸다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand)!
    const r = revealed(q)
    expect(r.symbol).toBe('BTCUSDT')
    expect(r.time).toBe(q.candles[q.decisionIndex].time)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/quiz/generator.test.ts`
Expected: FAIL — `./generator` 모듈이 없다

- [ ] **Step 3: 구현한다**

`src/quiz/generator.ts`:

```ts
import type { Candle, Timeframe } from '../data/types'
import { atr } from '../analysis/indicators'
import { activeSignalsAt } from './lifetime'
import { dominantSide } from './scanner'
import type { Direction, Question, QuestionType, SetupCandidate } from './types'

const WARMUP = 120
const VISIBLE = 220
const HIDDEN = 60

/**
 * 은닉 구간에서 어느 쪽으로 1.5 ATR 이상 **먼저** 움직였는가.
 * 양쪽 다 미달이면 정답은 관망이다.
 */
export function classifyOutcome(
  cs: Candle[], decisionIndex: number, hiddenCount: number,
): { direction: Direction; upAtr: number; downAtr: number } {
  const a = atr(cs, 14)[decisionIndex]
  const base = cs[decisionIndex].close
  const end = Math.min(decisionIndex + hiddenCount, cs.length - 1)

  let upAtr = 0
  let downAtr = 0
  if (!a || a <= 0) return { direction: 'flat', upAtr, downAtr }

  for (let j = decisionIndex + 1; j <= end; j++) {
    const up = (cs[j].high - base) / a
    const down = (base - cs[j].low) / a
    upAtr = Math.max(upAtr, up)
    downAtr = Math.max(downAtr, down)
    // 먼저 1.5 ATR 에 닿은 쪽이 정답이다. 같은 봉에서 양쪽 다 닿으면 무방향으로 본다.
    if (up >= 1.5 && down >= 1.5) return { direction: 'flat', upAtr, downAtr }
    if (up >= 1.5) return { direction: 'long', upAtr, downAtr }
    if (down >= 1.5) return { direction: 'short', upAtr, downAtr }
  }
  return { direction: 'flat', upAtr, downAtr }
}

function classifyType(direction: Direction, activeCount: number, dom: string): QuestionType {
  if (direction === 'flat') return 'no_setup'
  const domDir: Direction = dom === 'bullish' ? 'long' : dom === 'bearish' ? 'short' : 'flat'
  if (activeCount >= 3 && domDir !== 'flat' && domDir !== direction) return 'trap'
  return 'normal'
}

/**
 * 후보 봉이 창의 decisionIndex 가 되도록 400봉 창을 자른다.
 * 창을 확보할 수 없으면 null.
 */
export function makeQuestion(
  cs: Candle[], symbol: string, tf: Timeframe, candidate: SetupCandidate,
  opts: { warmup?: number; visible?: number; hidden?: number } = {},
): Question | null {
  const warmup = opts.warmup ?? WARMUP
  const visible = opts.visible ?? VISIBLE
  const hidden = opts.hidden ?? HIDDEN
  const decisionIndex = warmup + visible - 1

  const start = candidate.barIndex - decisionIndex
  const end = candidate.barIndex + hidden + 1
  if (start < 0 || end > cs.length) return null

  const window = cs.slice(start, end)
  const active = activeSignalsAt(window, decisionIndex)
  const { direction } = classifyOutcome(window, decisionIndex, hidden)

  return {
    symbol,
    timeframe: tf,
    startTime: window[0].time,
    decisionIndex,
    type: classifyType(direction, active.length, dominantSide(active)),
    difficulty: candidate.difficulty,
    candles: window,
  }
}

/**
 * 종목과 시각은 채점이 끝난 뒤에만 공개한다.
 * 문제 중에 알면 기억으로 답을 맞히게 되어 연습이 성립하지 않는다(스펙 5.2).
 */
export function revealed(q: Question): { symbol: string; time: number } {
  return { symbol: q.symbol, time: q.candles[q.decisionIndex].time }
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run src/quiz/generator.test.ts`
Expected: 9개 전부 통과

- [ ] **Step 5: 전체 테스트와 타입체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 6: 커밋**

```bash
git add src/quiz/generator.ts src/quiz/generator.test.ts
git commit -m "feat(quiz): 문제 생성기

후보 봉이 decisionIndex 가 되도록 400봉 창을 자른다.
정답 방향은 은닉 구간에서 1.5 ATR 이상 먼저 나온 쪽이고,
신호 우세 방향과 반대면 함정, 무방향이면 노셋업이다.

재현 키는 {symbol, timeframe, startTime, decisionIndex} 다."
```

---

### Task 8: `replay.ts` — 체결 시뮬레이션

**Files:**
- Create: `src/quiz/replay.ts`
- Create: `src/quiz/replay.test.ts`

**Interfaces:**
- Consumes: `Question` `Answer` `ReplayResult` (Task 3)
- Produces: `replay(q: Question, a: Answer): ReplayResult`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/quiz/replay.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { replay } from './replay'
import type { Question, Answer } from './types'
import type { Candle } from '../data/types'
import { mk } from '../analysis/fixtures'

/** decisionIndex=1, 은닉 구간을 직접 지정해 만든 최소 문제 */
const q = (hidden: Candle[]): Question => ({
  symbol: 'T', timeframe: '4h', startTime: 0, decisionIndex: 1,
  type: 'normal', difficulty: 'medium',
  candles: [mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1), ...hidden],
})

const long: Answer = { direction: 'long', entry: 100, stopLoss: 95, takeProfit: 110, tags: [] }

describe('replay', () => {
  it('TP 를 터치하면 익절이다', () => {
    const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), long)
    expect(r.exit).toBe('tp')
    expect(r.exitBarIndex).toBe(2)
    expect(r.r).toBeCloseTo(2, 5)     // (110-100)/(100-95) = 2R
  })

  it('SL 을 터치하면 손절이다', () => {
    const r = replay(q([mk(100, 101, 94, 95, 100, 2)]), long)
    expect(r.exit).toBe('sl')
    expect(r.r).toBeCloseTo(-1, 5)
  })

  it('같은 봉에서 SL 과 TP 를 모두 터치하면 SL 우선이다', () => {
    // 보수적 가정. 봉 안의 체결 순서를 알 수 없으므로 불리한 쪽을 택한다.
    const r = replay(q([mk(100, 111, 94, 100, 100, 2)]), long)
    expect(r.exit).toBe('sl')
    expect(r.r).toBeCloseTo(-1, 5)
  })

  it('진입가에 닿지 않으면 미체결이다', () => {
    const a: Answer = { ...long, entry: 50 }
    const r = replay(q([mk(100, 101, 99, 100, 100, 2)]), a)
    expect(r.filled).toBe(false)
    expect(r.exit).toBe('none')
    expect(r.r).toBe(0)
  })

  it('은닉 구간 안에 청산되지 않으면 마지막 종가로 강제 청산한다', () => {
    const r = replay(q([mk(100, 102, 99, 101, 100, 2), mk(101, 103, 100, 102, 100, 3)]), long)
    expect(r.exit).toBe('forced')
    expect(r.exitBarIndex).toBe(3)
    expect(r.r).toBeCloseTo((102 - 100) / 5, 5)
  })

  it('숏도 대칭으로 처리한다', () => {
    const short: Answer = { direction: 'short', entry: 100, stopLoss: 105, takeProfit: 90, tags: [] }
    const r = replay(q([mk(100, 101, 89, 90, 100, 2)]), short)
    expect(r.exit).toBe('tp')
    expect(r.r).toBeCloseTo(2, 5)
  })

  it('관망이면 재생하지 않는다', () => {
    const r = replay(q([mk(100, 111, 94, 100, 100, 2)]), { direction: 'flat', tags: [] })
    expect(r.filled).toBe(false)
    expect(r.exit).toBe('none')
  })

  it('손절폭이 0이면 r 은 0이다', () => {
    const a: Answer = { ...long, stopLoss: 100 }
    const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
    expect(r.r).toBe(0)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/quiz/replay.test.ts`
Expected: FAIL — `./replay` 모듈이 없다

- [ ] **Step 3: 구현한다**

`src/quiz/replay.ts`:

```ts
import type { Answer, Question, ReplayResult } from './types'

const NONE: ReplayResult = { filled: false, exit: 'none', exitBarIndex: null, pnlPct: 0, r: 0 }

/**
 * 은닉 구간을 봉 단위로 재생한다.
 *
 * 같은 봉에서 SL 과 TP 를 모두 터치하면 SL 을 택한다. 봉 안의 체결 순서는 알 수 없고,
 * 유리한 쪽을 가정하면 채점이 실제보다 후해진다.
 */
export function replay(q: Question, a: Answer): ReplayResult {
  if (a.direction === 'flat') return NONE
  if (a.entry === undefined || a.stopLoss === undefined) return NONE

  const isLong = a.direction === 'long'
  const risk = Math.abs(a.entry - a.stopLoss)
  const toR = (exitPrice: number): number => {
    if (risk === 0) return 0
    return ((isLong ? exitPrice - a.entry! : a.entry! - exitPrice)) / risk
  }
  const toPct = (exitPrice: number): number =>
    ((isLong ? exitPrice - a.entry! : a.entry! - exitPrice) / a.entry!) * 100

  let filled = false
  let lastIndex = q.decisionIndex

  for (let j = q.decisionIndex + 1; j < q.candles.length; j++) {
    const c = q.candles[j]
    lastIndex = j

    if (!filled) {
      // 지정가 진입: 봉이 진입가를 관통했는가
      if (c.low <= a.entry && a.entry <= c.high) filled = true
      else continue
    }

    const hitSl = isLong ? c.low <= a.stopLoss : c.high >= a.stopLoss
    const hitTp = a.takeProfit !== undefined
      ? (isLong ? c.high >= a.takeProfit : c.low <= a.takeProfit)
      : false

    if (hitSl) {
      return { filled: true, exit: 'sl', exitBarIndex: j, pnlPct: toPct(a.stopLoss), r: toR(a.stopLoss) }
    }
    if (hitTp) {
      return { filled: true, exit: 'tp', exitBarIndex: j, pnlPct: toPct(a.takeProfit!), r: toR(a.takeProfit!) }
    }
  }

  if (!filled) return NONE

  const close = q.candles[lastIndex].close
  return { filled: true, exit: 'forced', exitBarIndex: lastIndex, pnlPct: toPct(close), r: toR(close) }
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run src/quiz/replay.test.ts`
Expected: 8개 전부 통과

- [ ] **Step 5: 비공허성 확인**

`if (hitSl)` 블록과 `if (hitTp)` 블록의 순서를 바꾼 뒤 테스트를 돌린다.
Expected: "같은 봉에서 SL 과 TP 를 모두 터치하면 SL 우선이다" 가 FAIL. 확인 후 되돌린다.

- [ ] **Step 6: 전체 테스트와 타입체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 7: 커밋**

```bash
git add src/quiz/replay.ts src/quiz/replay.test.ts
git commit -m "feat(quiz): 재생 체결 시뮬레이션

봉 단위 진행, 고가·저가로 SL/TP 터치 판정. 같은 봉에서 둘 다 터치하면
SL 우선 — 봉 안의 체결 순서를 알 수 없으니 불리한 쪽을 가정한다.
미체결과 강제청산도 처리한다."
```

---

### Task 9: `grader.ts` — 3축 채점

**Files:**
- Create: `src/quiz/grader.ts`
- Create: `src/quiz/grader.test.ts`
- Modify: `scripts/calibrate.ts` (핵심 근거 K 측정 추가)

**Interfaces:**
- Consumes: `activeSignalsAt` `ActiveSignal` (Task 4), `replay` (Task 8), `classifyOutcome` (Task 7), `TAG_BY_ID` (Task 3), `atr` `findPivots`
- Produces:
  - `coreSignals(active: ActiveSignal[], k: number): ActiveSignal[]`
  - `grade(q: Question, a: Answer, opts?: { coreK?: number }): GradeReport`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/quiz/grader.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { coreSignals, grade } from './grader'
import type { ActiveSignal } from './lifetime'
import type { Question, Answer } from './types'
import { mk } from '../analysis/fixtures'
import type { Candle } from '../data/types'

const as = (id: string, tier: 1 | 2 | 3 | 4, strength: 1 | 2 | 3, barIndex: number): ActiveSignal =>
  ({ id, tier, kind: 'smc', side: 'bullish', barIndex, confidence: 'A', strength, evidence: '', ageBars: 0 })

describe('coreSignals', () => {
  it('tierWeight × strength 내림차순 상위 K개를 낸다', () => {
    const sigs = [as('a', 4, 1, 10), as('b', 1, 3, 10), as('c', 2, 2, 10)]  // 2, 15, 8
    expect(coreSignals(sigs, 2).map(s => s.id)).toEqual(['b', 'c'])
  })

  it('동점이면 barIndex 최신 우선, 그래도 같으면 id 사전순', () => {
    const sigs = [as('zz', 1, 1, 10), as('aa', 1, 1, 10), as('mm', 1, 1, 20)]
    expect(coreSignals(sigs, 3).map(s => s.id)).toEqual(['mm', 'aa', 'zz'])
  })

  it('K 가 개수보다 크면 전부 낸다', () => {
    expect(coreSignals([as('a', 1, 1, 10)], 5)).toHaveLength(1)
  })
})

describe('grade — 방향 축', () => {
  const lead = (n: number) => Array.from({ length: n }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i))
  const up = (n: number, from: number) => Array.from({ length: n }, (_, i) => mk(100, 110, 99.5, 109, 100, from + i))

  const q = (hidden: Candle[]): Question => ({
    symbol: 'T', timeframe: '4h', startTime: 0, decisionIndex: 199,
    type: 'normal', difficulty: 'medium', candles: [...lead(200), ...hidden],
  })

  it('방향이 맞으면 30점', () => {
    const r = grade(q(up(60, 200)), { direction: 'long', entry: 100, stopLoss: 95, takeProfit: 110, tags: [] })
    expect(r.direction.correct).toBe('long')
    expect(r.direction.score).toBe(30)
  })

  it('방향이 있는데 관망하면 12점 — 기회는 놓쳤으나 손실은 없다', () => {
    const r = grade(q(up(60, 200)), { direction: 'flat', tags: [] })
    expect(r.direction.score).toBe(12)
  })

  it('방향이 반대면 0점', () => {
    const r = grade(q(up(60, 200)), { direction: 'short', entry: 100, stopLoss: 105, takeProfit: 90, tags: [] })
    expect(r.direction.score).toBe(0)
  })

  it('무방향에 관망이면 30점', () => {
    const r = grade(q(lead(60)), { direction: 'flat', tags: [] })
    expect(r.direction.correct).toBe('flat')
    expect(r.direction.score).toBe(30)
  })

  it('무방향인데 진입하면 5점', () => {
    const r = grade(q(lead(60)), { direction: 'long', entry: 100, stopLoss: 95, takeProfit: 110, tags: [] })
    expect(r.direction.score).toBe(5)
  })
})

describe('grade — 근거 축', () => {
  const lead = (n: number) => Array.from({ length: n }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i))
  const q: Question = {
    symbol: 'T', timeframe: '4h', startTime: 0, decisionIndex: 199,
    type: 'no_setup', difficulty: 'medium', candles: lead(260),
  }

  it('존재하지 않는 근거를 체크하면 헛다리로 잡는다', () => {
    const r = grade(q, { direction: 'flat', tags: ['ob_bull_support', 'liq_sweep_low'] })
    // 평평한 픽스처에는 오더블록도 스윕도 없다
    expect(r.evidence.verdict.falseClaims.length).toBeGreaterThan(0)
  })

  it('taxonomy 에 없는 태그도 헛다리다', () => {
    const r = grade(q, { direction: 'flat', tags: ['존재하지_않는_태그'] })
    expect(r.evidence.verdict.falseClaims).toContain('존재하지_않는_태그')
  })

  it('핵심과 참고를 분리하며 둘이 겹치지 않는다', () => {
    const r = grade(q, { direction: 'flat', tags: [] })
    const overlap = r.evidence.verdict.coreMisses.filter(x => r.evidence.verdict.reference.includes(x))
    expect(overlap).toEqual([])
  })

  it('점수는 0~30 범위를 벗어나지 않는다', () => {
    const r = grade(q, { direction: 'flat', tags: ['a', 'b', 'c', 'd', 'e'] })
    expect(r.evidence.score).toBeGreaterThanOrEqual(0)
    expect(r.evidence.score).toBeLessThanOrEqual(30)
  })
})

describe('grade — 프로세스와 결과의 분리', () => {
  const lead = (n: number) => Array.from({ length: n }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i))
  const q: Question = {
    symbol: 'T', timeframe: '4h', startTime: 0, decisionIndex: 199,
    type: 'no_setup', difficulty: 'medium', candles: lead(260),
  }

  it('프로세스 점수와 결과 점수를 따로 낸다', () => {
    const r = grade(q, { direction: 'flat', tags: [] })
    expect(r.processScore).toBe(r.evidence.score + r.execution.score)
    expect(r.totalScore).toBe(r.direction.score + r.execution.score + r.evidence.score)
    expect(r.judgement.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/quiz/grader.test.ts`
Expected: FAIL — `./grader` 모듈이 없다

- [ ] **Step 3: 구현한다**

`src/quiz/grader.ts`:

```ts
import { TIER_WEIGHT } from '../analysis/signalTypes'
import { atr } from '../analysis/indicators'
import { findPivots } from '../analysis/structure'
import { activeSignalsAt, type ActiveSignal } from './lifetime'
import { TAG_BY_ID } from './taxonomy'
import { classifyOutcome } from './generator'
import { replay } from './replay'
import type { Answer, Direction, EvidenceVerdict, GradeReport, Question } from './types'

const weight = (s: ActiveSignal) => TIER_WEIGHT[s.tier] * s.strength

/**
 * 감점 대상이 되는 '핵심 근거' 상위 K개.
 * 동점 처리를 고정하는 이유는 채점이 결정론적이어야 하기 때문이다 —
 * 같은 답안이 실행할 때마다 다른 점수를 받으면 안 된다.
 */
export function coreSignals(active: ActiveSignal[], k: number): ActiveSignal[] {
  return [...active]
    .sort((a, b) => weight(b) - weight(a) || b.barIndex - a.barIndex || a.id.localeCompare(b.id))
    .slice(0, k)
}

function gradeDirection(correct: Direction, answered: Direction): number {
  if (correct === 'flat') return answered === 'flat' ? 30 : 5
  if (answered === correct) return 30
  if (answered === 'flat') return 12
  return 0
}

function gradeExecution(q: Question, a: Answer): { score: number; notes: string[] } {
  const notes: string[] = []
  if (a.direction === 'flat') {
    notes.push('관망 — 실행 판정 없음')
    return { score: 40, notes }
  }
  if (a.entry === undefined || a.stopLoss === undefined) {
    notes.push('진입가 또는 손절가가 없어 실행을 평가할 수 없다')
    return { score: 0, notes }
  }

  const d = q.decisionIndex
  const a14 = atr(q.candles, 14)[d] || 0
  const risk = Math.abs(a.entry - a.stopLoss)
  let score = 40

  if (a14 > 0) {
    const riskAtr = risk / a14
    if (riskAtr < 0.5) { score -= 15; notes.push(`손절폭 ${riskAtr.toFixed(2)} ATR — 노이즈에 털릴 자리`) }
    else if (riskAtr > 4) { score -= 15; notes.push(`손절폭 ${riskAtr.toFixed(2)} ATR — R:R 붕괴`) }
    else notes.push(`손절폭 ${riskAtr.toFixed(2)} ATR — 무난`)
  }

  // 구조적 손절: 롱이면 직전 스윙 로우 아래인가
  const pivots = findPivots(q.candles.slice(0, d + 1))
  const lastLow = [...pivots].reverse().find((p) => p.kind === 'low')
  const lastHigh = [...pivots].reverse().find((p) => p.kind === 'high')
  if (a.direction === 'long' && lastLow && a.stopLoss < lastLow.price) {
    score += 5; notes.push('직전 스윙 로우 아래 — 구조적 손절')
  }
  if (a.direction === 'short' && lastHigh && a.stopLoss > lastHigh.price) {
    score += 5; notes.push('직전 스윙 하이 위 — 구조적 손절')
  }

  if (a.takeProfit !== undefined && risk > 0) {
    const rr = Math.abs(a.takeProfit - a.entry) / risk
    if (rr < 1.5) { score -= 10; notes.push(`R:R ${rr.toFixed(2)} — 1.5 미만`) }
    else notes.push(`R:R ${rr.toFixed(2)}`)
  }

  return { score: Math.max(0, Math.min(40, score)), notes }
}

function gradeEvidence(
  active: ActiveSignal[], tags: string[], coreK: number,
): { score: number; verdict: EvidenceVerdict } {
  const activeIds = new Set(active.map((s) => s.id))
  const checked = new Set(tags)
  const coreIds = new Set(coreSignals(active, coreK).map((s) => s.id))

  const hits = [...checked].filter((t) => activeIds.has(t))
  const falseClaims = [...checked].filter((t) => !activeIds.has(t))
  const coreMisses = [...coreIds].filter((t) => !checked.has(t))
  const reference = [...activeIds].filter((t) => !checked.has(t) && !coreIds.has(t))

  // 감점은 핵심 놓침과 헛다리에만 적용한다. 참고 항목은 목록으로만 보여준다 —
  // 유효 근거가 8~15개인데 미체크 전부를 지적하면 '놓쳤다'가 흔해져 신호가 되지 못한다.
  const coreTotal = coreIds.size || 1
  const hitRatio = [...coreIds].filter((t) => checked.has(t)).length / coreTotal

  let penalty = 0
  for (const t of falseClaims) {
    const conf = TAG_BY_ID.get(t)?.confidence ?? 'A'
    // B 는 근사 감지라 감점 절반, C 는 부분 감지라 감점 없음 (스펙 6.7)
    penalty += conf === 'A' ? 3 : conf === 'B' ? 1.5 : 0
  }

  const score = Math.max(0, Math.min(30, Math.round(30 * hitRatio - penalty)))
  return { score, verdict: { hits, coreMisses, reference, falseClaims } }
}

export function grade(q: Question, a: Answer, opts: { coreK?: number } = {}): GradeReport {
  const coreK = opts.coreK ?? 6
  const hidden = q.candles.length - q.decisionIndex - 1

  const active = activeSignalsAt(q.candles.slice(0, q.decisionIndex + 1), q.decisionIndex)
  const { direction: correct } = classifyOutcome(q.candles, q.decisionIndex, hidden)
  const rep = replay(q, a)

  const direction = { correct, answered: a.direction, score: gradeDirection(correct, a.direction) }
  const execution = gradeExecution(q, a)
  const evidence = gradeEvidence(active, a.tags, coreK)

  const processScore = evidence.score + execution.score
  const outcomeScore = direction.score

  let judgement: string
  if (processScore >= 50 && rep.r < 0) {
    judgement = `근거 ${evidence.verdict.hits.length}개 적중, 손절 위치 적절, ${rep.r.toFixed(1)}R — 그런데 손절당했습니다. **이건 잘한 매매입니다.** 같은 자리에 100번 들어가면 수익이 남습니다.`
  } else if (processScore < 35 && rep.r > 0) {
    judgement = `결과는 +${rep.r.toFixed(1)}R인데 근거 ${evidence.verdict.hits.length}개 적중 / ${evidence.verdict.falseClaims.length}개 헛다리입니다. **운입니다.** 같은 매매를 반복하면 계좌가 녹습니다.`
  } else {
    judgement = `프로세스 ${processScore}점 / 결과 ${outcomeScore}점.`
  }

  return {
    direction, execution, evidence,
    processScore, outcomeScore,
    totalScore: direction.score + execution.score + evidence.score,
    judgement, replay: rep,
  }
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run src/quiz/grader.test.ts`
Expected: 14개 전부 통과

- [ ] **Step 5: `calibrate.ts` 에 핵심 근거 K 측정을 추가한다**

파일 끝에 붙인다.

```ts
import { coreSignals } from '../src/quiz/grader'

console.log(`\n=== 핵심 K 별 커버리지 (유효 근거 중 핵심이 차지하는 비율) ===`)
for (const k of [4, 5, 6, 8, 10]) {
  let coreW = 0
  let totalW = 0
  for (const sym of SYMBOLS) {
    const cs = await getCandles(sym, '4h', 1000)
    for (const at of AT) {
      const active = activeSignalsAt(cs, at)
      const w = (s: { tier: 1 | 2 | 3 | 4; strength: number }) => ({ 1: 5, 2: 4, 3: 3, 4: 2 })[s.tier] * s.strength
      totalW += active.reduce((acc, s) => acc + w(s), 0)
      coreW += coreSignals(active, k).reduce((acc, s) => acc + w(s), 0)
    }
  }
  console.log(`K=${String(k).padStart(2)}: 핵심이 전체 가중치의 ${(coreW / totalW * 100).toFixed(0)}%`)
}
```

- [ ] **Step 6: 돌려서 K 를 정한다**

Run: `npm run calibrate`
Expected: 핵심이 전체 가중치의 **60~80%** 를 덮는 K 를 고른다.
너무 낮으면 중요한 근거가 참고로 밀려나고, 너무 높으면 잔소리가 된다.
고른 값을 `grader.ts` 의 `coreK` 기본값으로 박는다.

- [ ] **Step 7: 전체 테스트와 타입체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 8: 커밋**

```bash
git add src/quiz/grader.ts src/quiz/grader.test.ts scripts/calibrate.ts
git commit -m "feat(quiz): 3축 채점기 — 방향 30 / 실행 40 / 근거 30

근거 축은 핵심/참고 2단이다. 감점은 상위 K개 핵심 놓침과 헛다리에만
적용하고, 나머지 유효 근거는 목록으로만 보여준다. 유효 근거가 8~15개인데
미체크 전부를 지적하면 '놓쳤다'가 흔해져 신호가 되지 못한다.

프로세스(근거+실행)와 결과(방향)를 분리해 판정 문구를 낸다."
```

---

### Task 10: `report.ts` 와 `drill.ts` — **위험 체크포인트 ③**

숫자로는 통과했는데 사람이 읽으면 말이 안 되는 경우를 여기서 잡는다.
Part 2가 "쓸 수 있는지"를 판단하는 유일한 수단이다.

**Files:**
- Create: `src/quiz/report.ts`
- Create: `src/quiz/report.test.ts`
- Create: `scripts/drill.ts`
- Modify: `package.json` (`drill` 스크립트 추가)

**Interfaces:**
- Consumes: `GradeReport` `Question` `Answer` (Task 3), `revealed` (Task 7), `TAG_BY_ID` (Task 3)
- Produces: `toMarkdown(q: Question, a: Answer, r: GradeReport): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/quiz/report.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toMarkdown } from './report'
import { grade } from './grader'
import type { Question, Answer } from './types'
import { mk } from '../analysis/fixtures'

const q: Question = {
  symbol: 'BTCUSDT', timeframe: '4h', startTime: 1700000000, decisionIndex: 199,
  type: 'no_setup', difficulty: 'medium',
  candles: Array.from({ length: 260 }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i)),
}
const a: Answer = { direction: 'flat', tags: [] }

describe('마크다운 리포트', () => {
  it('종목과 점수와 판정을 담는다', () => {
    const md = toMarkdown(q, a, grade(q, a))
    expect(md).toContain('BTCUSDT')
    expect(md).toContain('4h')
    expect(md).toMatch(/프로세스/)
    expect(md).toMatch(/결과/)
  })

  it('태그를 한국어 라벨로 보여준다', () => {
    const withTag: Answer = { direction: 'flat', tags: ['ob_bull_support'] }
    const md = toMarkdown(q, withTag, grade(q, withTag))
    expect(md).toContain('강세 오더블록 지지')
  })

  it('알 수 없는 태그도 id 로라도 보여준다', () => {
    const withTag: Answer = { direction: 'flat', tags: ['모르는_태그'] }
    const md = toMarkdown(q, withTag, grade(q, withTag))
    expect(md).toContain('모르는_태그')
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/quiz/report.test.ts`
Expected: FAIL — `./report` 모듈이 없다

- [ ] **Step 3: 구현한다**

`src/quiz/report.ts`:

```ts
import type { Answer, GradeReport, Question } from './types'
import { TAG_BY_ID } from './taxonomy'
import { revealed } from './generator'

const label = (id: string) => TAG_BY_ID.get(id)?.label ?? id

/** 채점 결과를 사용자의 기존 오답노트와 같은 형식의 마크다운으로 낸다 (스펙 8절) */
export function toMarkdown(q: Question, a: Answer, r: GradeReport): string {
  const rev = revealed(q)
  const when = new Date(rev.time * 1000).toISOString().slice(0, 16).replace('T', ' ')
  const L: string[] = []

  L.push(`## ${rev.symbol} ${q.timeframe} (${when}) — ${q.type} / ${q.difficulty}`)
  L.push('')
  L.push(`**내 판단:** ${a.direction}` +
    (a.entry !== undefined ? ` / 진입 ${a.entry} / 손절 ${a.stopLoss} / 익절 ${a.takeProfit ?? '-'}` : ''))
  L.push(`**정답 방향:** ${r.direction.correct}`)
  L.push(`**결과:** ${r.replay.exit} ${r.replay.r.toFixed(2)}R  |  ` +
    `프로세스 ${r.processScore}점 / 결과 ${r.outcomeScore}점 / 총 ${r.totalScore}점`)
  L.push('')

  L.push('### 내가 본 근거')
  if (r.evidence.verdict.hits.length === 0 && r.evidence.verdict.falseClaims.length === 0) {
    L.push('- (없음)')
  }
  for (const t of r.evidence.verdict.hits) L.push(`- ✅ ${label(t)}`)
  for (const t of r.evidence.verdict.falseClaims) L.push(`- ❌ ${label(t)} — 그 시점에 존재하지 않았다`)
  L.push('')

  L.push('### 놓친 것')
  if (r.evidence.verdict.coreMisses.length === 0) L.push('- (없음)')
  for (const t of r.evidence.verdict.coreMisses) L.push(`- ⚠️ ${label(t)}`)
  L.push('')

  if (r.evidence.verdict.reference.length > 0) {
    L.push('### 참고 — 이것도 있었습니다 (감점 없음)')
    for (const t of r.evidence.verdict.reference) L.push(`- 📋 ${label(t)}`)
    L.push('')
  }

  L.push('### 실행')
  for (const n of r.execution.notes) L.push(`- ${n}`)
  L.push('')

  L.push('### 판정')
  L.push(r.judgement)

  return L.join('\n')
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run src/quiz/report.test.ts`
Expected: 3개 통과

- [ ] **Step 5: `drill.ts` 를 쓴다**

```ts
import { getCandles } from '../src/data/fileCache'
import { scanForSetups } from '../src/quiz/scanner'
import { makeQuestion } from '../src/quiz/generator'
import { activeSignalsAt } from '../src/quiz/lifetime'
import { grade } from '../src/quiz/grader'
import { toMarkdown } from '../src/quiz/report'
import { TAG_BY_ID } from '../src/quiz/taxonomy'
import type { Answer } from '../src/quiz/types'

const symbol = process.argv[2] ?? 'BTCUSDT'
const cs = await getCandles(symbol, '4h', 1000)

const candidates = scanForSetups(cs)
console.log(`후보 ${candidates.length}개`)
if (candidates.length === 0) {
  console.error('후보가 없다. scanner 의 minScore 를 확인할 것.')
  process.exit(1)
}

const cand = candidates[Math.floor(candidates.length / 2)]
const q = makeQuestion(cs, symbol, '4h', cand)
if (!q) {
  console.error('창을 확보할 수 없다.')
  process.exit(1)
}

// 사용자에게 보이는 것: 마스킹된 문제
console.log(`\n=== 문제 ===`)
console.log(`SYMBOL A / ${q.timeframe} / ${q.difficulty}`)
console.log(`노출 ${q.decisionIndex + 1}봉, 은닉 ${q.candles.length - q.decisionIndex - 1}봉`)
console.log(`마지막 종가 ${q.candles[q.decisionIndex].close}`)

// 유효 근거를 사람이 읽을 수 있게 나열한다
const active = activeSignalsAt(q.candles.slice(0, q.decisionIndex + 1), q.decisionIndex)
console.log(`\n=== 유효 근거 ${active.length}개 ===`)
for (const s of active) {
  console.log(`  [T${s.tier} s${s.strength} ${s.ageBars}봉전] ${TAG_BY_ID.get(s.id)?.label ?? s.id} — ${s.evidence}`)
}

// 가짜 답안: 유효 근거 중 둘을 맞히고 하나는 헛다리
const answer: Answer = {
  direction: 'long',
  entry: q.candles[q.decisionIndex].close,
  stopLoss: q.candles[q.decisionIndex].close * 0.97,
  takeProfit: q.candles[q.decisionIndex].close * 1.06,
  tags: [...active.slice(0, 2).map((s) => s.id), 'liq_sweep_high'],
}

console.log(`\n=== 채점 리포트 ===\n`)
console.log(toMarkdown(q, answer, grade(q, answer)))
```

`package.json` 의 `scripts` 에 추가한다:

```json
"drill": "tsx scripts/drill.ts"
```

- [ ] **Step 6: 돌려서 사람 눈으로 읽는다**

Run: `npm run drill`
Expected: 마크다운 리포트가 출력된다.

**아래를 눈으로 확인한다. 하나라도 아니면 멈추고 보고한다.**

- 유효 근거 개수가 8~15개인가 (Task 5의 목표가 실제 문제에서도 지켜지는가)
- ⚠️ 놓침이 6개 이하인가 — 그보다 많으면 잔소리로 읽힌다
- ❌ 헛다리로 잡힌 `liq_sweep_high` 가 실제로 그 시점에 없었는가
- 판정 문구가 상황과 맞는가
- 근거 목록의 `evidence` 문자열이 사람이 읽을 만한가

- [ ] **Step 7: 다른 종목으로도 확인한다**

Run: `npm run drill ETHUSDT`, `npm run drill SOLUSDT`
Expected: 위와 같은 기준을 만족한다. 특정 종목에서만 이상하면 그 원인을 기록한다.

- [ ] **Step 8: 전체 테스트와 타입체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 9: 커밋**

```bash
git add src/quiz/report.ts src/quiz/report.test.ts scripts/drill.ts package.json
git commit -m "feat(quiz): 마크다운 리포트와 drill 엔드투엔드 스크립트

문제 생성부터 채점 리포트까지 한 번에 돌려 사람 눈으로 확인한다.
UI가 없는 Part 2에서 '쓸 수 있는지'를 판단하는 유일한 수단이다."
```

---

### Task 11: Part 1 잔여 결함 정리 (D2 · D5 · D6 · D7)

인계문서 3절이 defer 판정한 것들 중 무해하거나 문서 수정인 4건이다.
D1(IndexedDB)은 Part 4로 미룬다 — Node 에는 IndexedDB 가 없어 헤드리스에서 검증할 수 없다.
D3·D4는 Task 2·3에서 이미 처리했다.

**Files:**
- Modify: `src/analysis/smc.ts:148,157,177,187` (D2)
- Modify: `src/analysis/signals.test.ts` (D5)
- Modify: `src/analysis/smc.test.ts` (D6)
- Modify: `docs/superpowers/specs/2026-08-02-chart-drill-design.md` (D7)

> 인계문서는 D6을 `structure.ts` 건으로 적었으나 `msb_bull` 을 내는 것은
> `smc.ts` 의 `detectMSB` 다. 테스트는 `smc.test.ts` 에 들어간다.

- [ ] **Step 1: D2 — `smc.ts` 의 중복 가드를 제거한다**

`pivotBar < i` 가드가 148·157·177·187행 네 곳에 있는데, 같은 조건절의
`barIndex <= i` 가 이미 이를 함의한다. 무해하지만 후속 독자를 오도한다.

각 행에서 `lo.pivotBar < i &&` / `hi.pivotBar < i &&` 부분만 지운다.
177·187행의 `hi.pivotBar > lastBullBreak` / `lo.pivotBar > lastBearBreak` 는
**다른 조건이므로 남긴다.**

지운 뒤 `npx vitest run src/analysis/smc.test.ts` 가 그대로 통과해야 한다 —
통과하지 않으면 그 가드는 중복이 아니므로 되돌린다.

- [ ] **Step 2: D5 — 정렬 결정론 테스트를 추가한다**

`detectAll` 의 정렬은 같은 `barIndex` + 같은 `id` 인 동률이 10건 있다.
V8 의 안정 정렬과 고정된 감지기 순서 덕에 실질적으로 결정론적이지만 명시 테스트가 없다.

`src/analysis/signals.test.ts` 에 추가한다:

```ts
it('detectAll 은 결정론적이다 — 같은 입력이면 같은 순서', () => {
  const cs = synthCandles(500)
  const a = detectAll(cs)
  const b = detectAll(cs)
  expect(a).toEqual(b)
  expect(a.map(s => `${s.barIndex}|${s.id}`)).toEqual(b.map(s => `${s.barIndex}|${s.id}`))
})
```

- [ ] **Step 3: D6 — `msb_bull` 전용 양성 테스트를 추가한다**

`msb_bear` 는 직접 테스트되지만 `msb_bull` 은 통합 픽스처에서만 발화한다(18회).

`src/analysis/smc.test.ts` 에 추가한다 — `detectMSB` 는 `smc.ts:169` 에 있다.
기존 `msb_bear` 테스트의 픽스처를 방향만 뒤집은 형태다: 스윙 하이를 만들고
그 위로 종가가 마감한다.

```ts
it('직전 스윙 하이를 종가로 돌파하면 msb_bull 을 낸다', () => {
  // 저점 → 고점(피벗) → 눌림 → 고점 돌파
  const cs = [
    ...Array.from({ length: 10 }, (_, i) => mk(100, 101, 99, 100, 100, i)),
    mk(100, 108, 100, 107, 100, 10),   // 스윙 하이 108
    ...Array.from({ length: 5 }, (_, i) => mk(107, 107.5, 103, 104, 100, 11 + i)),
    mk(104, 110, 104, 109.5, 100, 16), // 108 위로 종가 마감
  ]
  const ids = detectMSB(cs).map(s => s.id)
  expect(ids).toContain('msb_bull')
})
```

픽스처가 발화하지 않으면 `detectMSB` 의 피벗 조건(`findPivots` 의 `n=2`)을 확인해
스윙 하이 양옆에 봉이 2개씩 있도록 조정한다.

- [ ] **Step 4: D7 — 규칙표 문서를 코드에 맞게 고친다**

`inv_hammer`/`shooting_star` 의 `body > 0` 가드가 설계 스펙의 규칙표에 없다.
**코드가 옳다** — 평봉에서 `isDoji` 는 `range > 0` 조건 때문에 발화하지 않으므로
이 가드가 실제로 하중을 받는다. 스펙의 규칙 서술에 `몸통 > 0` 조건을 더한다.

- [ ] **Step 5: 전체 테스트와 타입체크**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "fix: Part 1 잔여 결함 정리 (D2·D5·D6·D7)

- D2: smc.ts 의 중복 가드 4곳 제거
- D5: detectAll 정렬 결정론 명시 테스트
- D6: msb_bull 전용 양성 테스트
- D7: 규칙표에 body > 0 조건 추가 (코드가 옳고 문서가 틀렸다)

D1(IndexedDB)은 Node 에 IndexedDB 가 없어 검증할 수 없으므로 Part 4로 미룬다."
```

---

### Task 12: 전체 브랜치 리뷰

Part 1에서 per-task 리뷰가 통과시킨 결함 3건을 최종 전체 리뷰가 잡았다.
전부 "모듈 단위로는 맞는데 통합 관점에서 틀린" 것들이었다(F1 다이버전스 한 방향 누락,
F2 `detectTrend` 호출당 1개, F3 오더블록 중복 계상). Part 2도 같은 위험이 있다.

- [ ] **Step 1: 브랜치 전체 diff 를 검토한다**

Run: `git diff master...feat/part2-quiz-engine`

아래 관점으로 본다. 각 항목은 Part 1에서 실제로 사고가 났던 지점이다.

- **taxonomy 와 감지기의 어긋남**: 정합성 테스트가 `synthCandles` 픽스처만 본다. 실데이터에서만 나오는 id 가 있는가? `npm run calibrate` 의 "한 번도 유효하지 않은 태그" 출력으로 교차 확인한다
- **수명 규칙의 방향 누락**: `zone` 무효화가 `bullish` 는 처리하는데 `bearish` 를 빠뜨리지 않았는가 (F1과 같은 유형)
- **스캐너 1단계와 2단계의 불일치**: 1단계 근사가 2단계보다 많은 후보를 내는 경우가 실데이터에 있는가
- **채점의 결정론**: 같은 `{q, a}` 로 `grade` 를 두 번 부르면 완전히 같은가
- **경계**: `decisionIndex` 가 배열 끝인 경우, 은닉 구간이 0봉인 경우, `active` 가 빈 배열인 경우

- [ ] **Step 2: 실데이터 결정론을 확인한다**

`scripts/drill.ts` 를 두 번 돌려 출력이 완전히 같은지 확인한다.

Run: `npm run drill > /tmp/a.txt && npm run drill > /tmp/b.txt && diff /tmp/a.txt /tmp/b.txt`
Expected: 차이 없음

- [ ] **Step 3: 발견한 결함을 고치고 각각 커밋한다**

발견 건마다 테스트를 먼저 쓰고 고친다. 커밋 메시지에 무엇을 놓칠 뻔했는지 적는다.

- [ ] **Step 4: 최종 확인**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 통과, exit 0

- [ ] **Step 5: PR 을 연다**

```bash
git push -u origin feat/part2-quiz-engine
```

PR 본문에 담을 것: 수명 규약의 실측 근거, calibrate 로 확정한 값 4종과 그 근거,
`drill` 출력 샘플, Part 3으로 넘기는 것.

---

## 완료 기준

- [ ] `npm run drill` 이 실제 바이낸스 데이터로 문제를 내고 채점 리포트를 출력한다
- [ ] 유효 근거가 결정 시점당 8~15개다
- [ ] 후보 밀도가 1000봉당 15~40개다
- [ ] ⚠️ 놓침이 리포트당 6개 이하다
- [ ] Part 1의 테스트 124개가 전부 통과한다 (트위저 관련 갱신 제외)
- [ ] `npx tsc --noEmit` exit 0
- [ ] 새 의존성은 `tsx` 하나뿐이다
