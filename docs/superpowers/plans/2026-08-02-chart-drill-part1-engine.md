# chart-drill Part 1: 데이터 + 감지 엔진 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Binance 실제 캔들을 받아 캐시하고, 그 위에서 A등급 기술적 신호를 미래참조 없이 감지하는 순수 함수 계층을 완성한다. 이 계층의 출력(`Signal[]`)이 이후 출제·채점의 유일한 근거가 된다.

**Architecture:** `analysis/`는 UI를 모르는 순수 함수 계층으로, `Candle[]`를 받아 `Signal[]`을 낸다. `quiz/`가 이를 소비해 출제(scanner)·채점(grader)·재생(replay)을 하고, `ui/`는 결과만 그린다. 모든 감지 함수는 미래 봉을 참조하지 않으며 이를 자동 테스트로 강제한다.

**Tech Stack (Part 1이 실제로 쓰는 것):** TypeScript · Vitest · idb
React · Tailwind · lightweight-charts v5 · zustand 는 UI가 생기는 Part 2에서 설치한다.
Part 1에는 UI가 없으므로 지금 넣으면 미사용 의존성이 된다.

## Global Constraints

- **미래참조 금지:** 어떤 신호가 `barIndex = k` 에서 났다고 주장하면, `detect(cs.slice(0, k+1))` 에도 동일한 신호가 있어야 한다. 즉 **k까지의 데이터만으로 도출 가능해야 한다.** `assertNoLookAhead` 가 이를 강제한다.
- **barIndex 규약:** `barIndex`는 신호가 **확정된 봉**의 인덱스다. 피벗처럼 확정에 이후 봉이 필요한 경우 `barIndex = 확정 봉`, 실제 피벗 위치는 `refs.pivotBar`에 넣는다.
- **시간 단위:** Binance는 ms epoch, `Candle.time` 은 **초** 단위 UNIX 타임스탬프(lightweight-charts 규약). 경계에서 `/1000` 한다.
- **순수 함수:** `src/analysis/` 의 모든 export 는 부수효과 없는 순수 함수다. 같은 입력이면 항상 같은 출력이어야 하며, 여기에 DOM·네트워크·전역 상태가 들어가면 안 된다. (Phase 2에서 Node로 재실행할 전제)
- **지표 배열 규약:** 모든 지표 함수는 입력과 **같은 길이**의 배열을 반환하고, 계산 불가 구간은 `NaN` 이다.
- **Tier 가중치:** `{1:5, 2:4, 3:3, 4:2}` — 노트의 34점 체계.
- 스펙: `docs/superpowers/specs/2026-08-02-chart-drill-design.md`

**Part 2 이후에만 적용되는 제약** (Part 1 구현자는 무시해도 된다):
lightweight-charts는 v5 API — `chart.addSeries(CandlestickSeries, opts, paneIndex)`,
v4의 `addCandlestickSeries()`는 없음. `ChartPane`은 `symbol`이 아니라 `displayLabel`만 받는다(마스킹).

## 이 계획의 범위

**포함 — 스펙의 M1(데이터)·M2(지표·구조)·M3(A등급 감지):**
프로젝트 스캐폴딩 · Binance 클라이언트 · IndexedDB 캐시 · 지표 8종 ·
look-ahead 회귀 하네스 · 스윙 구조 · FVG · 오더블록 · 유동성 스윕 · MSB ·
캔들패턴 16종 · 다이버전스 · 지표 신호 · 통합기

**제외 — 후속 계획으로 분리:**

| 계획 | 내용 |
|---|---|
| Part 2 (M4) | taxonomy · scanner · generator · replay · grader 3축 · store · UI 4종 · 조립 |
| Part 3 (M5~M7) | B/C등급 차트패턴 · 와이코프 · 탑다운 채점 · 34점 룰 패널 · 오답노트 자동생성 · 대시보드 |

**왜 여기서 끊는가:** Part 1의 산출물은 UI가 없어 손으로 만져볼 수 없지만,
**`npm test` 전체 통과가 곧 완료 증거**다. 특히 Task 12의
`assertNoLookAhead(detectAll, ...)` 통과는 감지 계층 전체가 미래를 훔쳐보지 않는다는 증명이고,
이게 성립하지 않으면 Part 2의 채점은 전부 거짓이 된다. 이 경계에서 검증하고 넘어가는 것이 맞다.

Part 2 태스크 목록은 이 문서 맨 끝에 있다.

## File Structure

Part 1에서 만드는 파일은 아래가 전부다. `src/quiz/`, `src/store/`, `src/ui/` 는
Part 2의 것이므로 이 계획에서는 **만들지 않는다.**

| 파일 | 책임 |
|---|---|
| `src/data/types.ts` | `Candle`, `Timeframe` 타입 |
| `src/data/binance.ts` | klines fetch, ms→초 변환 |
| `src/data/cache.ts` | IndexedDB 캔들 청크 캐시 |
| `src/analysis/indicators.ts` | SMA/EMA/RSI/MACD/BB/ATR/OBV/volumeMA — 배열 in, 배열 out |
| `src/analysis/testing.ts` | `assertNoLookAhead` 하네스 (테스트 전용 export) |
| `src/analysis/structure.ts` | 스윙 하이·로우, 추세 판정, S/R 레벨 |
| `src/analysis/signalTypes.ts` | `Signal`, `SignalId`, `Tier`, `Confidence` |
| `src/analysis/smc.ts` | FVG, 오더블록, 유동성 스윕, MSB/CHoCH, S/R 플립, 리테스트 |
| `src/analysis/candlePatterns.ts` | 캔들패턴 16종 |
| `src/analysis/divergence.ts` | RSI/MACD/OBV 다이버전스 |
| `src/analysis/indicatorSignals.ts` | 지표 기반 태그 (RSI/MACD/MA/BB/OBV) |
| `src/analysis/fixtures.ts` | 테스트용 결정론적 합성 캔들 (`synthCandles`, `mk`) |
| `src/analysis/signals.ts` | `detectAll()` / `detectSignals()` — 전 감지기 통합 |

---

### Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`
- Test: `src/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` (Vitest) 가 동작하는 TypeScript 프로젝트

**주의 — `npm create vite` 를 쓰지 말 것.** 이 디렉토리에는 이미 `.git/`, `docs/`,
`.gitignore` 가 있어서 스캐폴더가 "Directory is not empty, remove existing files?"
대화형 프롬프트를 띄우고, 비대화형 환경에서는 여기서 멈춘다. 파일을 직접 만든다.

**Part 1에는 UI가 없다.** React·Tailwind·lightweight-charts·zustand 는 Part 2에서
설치한다. 지금 넣으면 쓰이지 않는 의존성이 된다. Part 1이 실제로 쓰는 것은
TypeScript · Vitest · idb 뿐이다.

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "chart-drill",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: 의존성 설치**

```bash
npm install idb
npm install -D typescript vite vitest
```

- [ ] **Step 3: tsconfig.json 작성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`include` 에 `vite.config.ts` 를 넣는 이유: `["src"]` 만 넣으면 루트의 설정 파일이
typecheck 대상에서 **아예 빠진다.** 그러면 설정에 오타가 나도 `npm run typecheck` 는
통과하고 런타임에서야 터진다. Part 2에서 `environment` 를 `jsdom` 으로 바꾸고
`setupFiles` 를 추가할 때 이 차이가 드러난다.

- [ ] **Step 4: vite.config.ts 작성**

Part 1은 순수 함수와 테스트뿐이라 `node` 환경이면 충분하다.
Part 2에서 React 컴포넌트 테스트를 추가할 때 `jsdom` 으로 바꾼다.

**`defineConfig` 는 반드시 `'vitest/config'` 에서 import한다.** `'vite'` 에서 가져오면
`test` 키가 `UserConfigExport` 타입에 없어서 `TS2769` 가 난다. Vitest의 타입 augmentation은
`vitest` 가 `node_modules` 에 설치돼 있는 것만으로는 적용되지 않고, 무언가가
`'vitest/config'` 를 import해야 로드된다.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
```

- [ ] **Step 5: 스모크 테스트 작성**

`src/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: 테스트와 타입체크 실행 확인**

Run: `npm test`
Expected: PASS — 1 test passed

Run: `npm run typecheck`
Expected: 오류 없이 종료 (exit 0)

- [ ] **Step 7: 커밋**

`node_modules/` 는 이미 `.gitignore` 에 있다. `package-lock.json` 은 커밋한다.

```bash
git add -A
git commit -m "chore: TypeScript + Vitest 스캐폴딩"
```

---

### Task 2: 데이터 타입과 Binance 클라이언트

**Files:**
- Create: `src/data/types.ts`, `src/data/binance.ts`
- Test: `src/data/binance.test.ts`

**Interfaces:**
- Produces:
  - `type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }` — `time`은 **초 단위** UNIX epoch
  - `type Timeframe = '15m' | '1h' | '4h' | '1d' | '1w'`
  - `parseKlines(raw: unknown[][]): Candle[]`
  - `fetchKlines(symbol: string, tf: Timeframe, opts: { endTime?: number; limit?: number }): Promise<Candle[]>`
  - `SYMBOL_POOL: string[]`

- [ ] **Step 1: 타입 파일 작성**

`src/data/types.ts`:

```ts
export type Candle = {
  /** UNIX epoch in SECONDS (lightweight-charts 규약) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Timeframe = '15m' | '1h' | '4h' | '1d' | '1w'

export const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d', '1w']

/** 한 단계 상위 타임프레임 (탑다운 분석용) */
export const HIGHER_TF: Record<Timeframe, Timeframe> = {
  '15m': '1h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
  '1w': '1w',
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/data/binance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseKlines } from './binance'

describe('parseKlines', () => {
  it('ms epoch을 초 단위로 변환하고 문자열 가격을 숫자로 만든다', () => {
    const raw = [
      [1785700800000, '63456.00', '63796.33', '63344.00', '63570.00', '1419.60',
       1785715199999, '90220771.40', 329091, '760.24', '48315907.60', '0'],
    ]
    expect(parseKlines(raw)).toEqual([
      { time: 1785700800, open: 63456, high: 63796.33, low: 63344, close: 63570, volume: 1419.6 },
    ])
  })

  it('빈 배열을 그대로 통과시킨다', () => {
    expect(parseKlines([])).toEqual([])
  })
})
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx vitest run src/data/binance.test.ts`
Expected: FAIL — `parseKlines` is not exported / module not found

- [ ] **Step 4: 구현**

`src/data/binance.ts`:

```ts
import type { Candle, Timeframe } from './types'

const BASE = 'https://api.binance.com/api/v3/klines'

/** 거래량 상위 USDT 페어 25종 */
export const SYMBOL_POOL = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'DOGEUSDT',
  'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'UNIUSDT', 'ETCUSDT',
  'FILUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT',
  'INJUSDT', 'SUIUSDT', 'TIAUSDT', 'SEIUSDT', 'RUNEUSDT',
]

export function parseKlines(raw: unknown[][]): Candle[] {
  return raw.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }))
}

export async function fetchKlines(
  symbol: string,
  tf: Timeframe,
  opts: { endTime?: number; limit?: number } = {},
): Promise<Candle[]> {
  const limit = opts.limit ?? 400
  const params = new URLSearchParams({ symbol, interval: tf, limit: String(limit) })
  if (opts.endTime !== undefined) params.set('endTime', String(opts.endTime * 1000))

  const res = await fetch(`${BASE}?${params}`)
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`)
  return parseKlines(await res.json())
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/data/binance.test.ts`
Expected: PASS — 2 tests passed

- [ ] **Step 6: 커밋**

```bash
git add src/data/
git commit -m "feat(data): Candle 타입과 Binance klines 클라이언트"
```

---

### Task 3: IndexedDB 캔들 캐시

**Files:**
- Create: `src/data/cache.ts`
- Test: `src/data/cache.test.ts`

**Interfaces:**
- Consumes: `Candle`, `Timeframe` (Task 2)
- Produces:
  - `cacheKey(symbol: string, tf: Timeframe, endTime: number, limit: number): string`
  - `getCachedCandles(key: string): Promise<Candle[] | undefined>`
  - `putCachedCandles(key: string, candles: Candle[]): Promise<void>`
  - `fetchCandlesCached(symbol, tf, opts): Promise<Candle[]>` — 캐시 우선, 없으면 fetch 후 저장

- [ ] **Step 1: 실패하는 테스트 작성**

`src/data/cache.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cacheKey } from './cache'

describe('cacheKey', () => {
  it('인자 조합마다 고유한 키를 만든다', () => {
    expect(cacheKey('BTCUSDT', '4h', 1785700800, 400)).toBe('BTCUSDT|4h|1785700800|400')
  })

  it('다른 endTime이면 다른 키가 된다', () => {
    const a = cacheKey('BTCUSDT', '4h', 1785700800, 400)
    const b = cacheKey('BTCUSDT', '4h', 1785700801, 400)
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/data/cache.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`src/data/cache.ts`:

```ts
import { openDB, type IDBPDatabase } from 'idb'
import type { Candle, Timeframe } from './types'
import { fetchKlines } from './binance'

const DB_NAME = 'chart-drill'
const DB_VERSION = 1
const STORE = 'candles'

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
        if (!d.objectStoreNames.contains('questions')) d.createObjectStore('questions', { keyPath: 'id' })
        if (!d.objectStoreNames.contains('attempts')) d.createObjectStore('attempts', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

export function cacheKey(symbol: string, tf: Timeframe, endTime: number, limit: number): string {
  return `${symbol}|${tf}|${endTime}|${limit}`
}

export async function getCachedCandles(key: string): Promise<Candle[] | undefined> {
  return (await db()).get(STORE, key)
}

export async function putCachedCandles(key: string, candles: Candle[]): Promise<void> {
  await (await db()).put(STORE, candles, key)
}

export async function fetchCandlesCached(
  symbol: string,
  tf: Timeframe,
  opts: { endTime: number; limit?: number },
): Promise<Candle[]> {
  const limit = opts.limit ?? 400
  const key = cacheKey(symbol, tf, opts.endTime, limit)
  const hit = await getCachedCandles(key)
  if (hit) return hit
  const fresh = await fetchKlines(symbol, tf, { endTime: opts.endTime, limit })
  await putCachedCandles(key, fresh)
  return fresh
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/data/cache.test.ts`
Expected: PASS — 2 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/data/cache.ts src/data/cache.test.ts
git commit -m "feat(data): IndexedDB 캔들 캐시"
```

---

### Task 4: 지표 계산

**Files:**
- Create: `src/analysis/indicators.ts`
- Test: `src/analysis/indicators.test.ts`

**Interfaces:**
- Consumes: `Candle` (Task 2)
- Produces: 모든 함수는 **입력 배열과 같은 길이**의 배열을 반환하고, 계산 불가 구간은 `NaN`이다.
  - `sma(values: number[], period: number): number[]`
  - `ema(values: number[], period: number): number[]`
  - `rsi(closes: number[], period?: number): number[]` (기본 14)
  - `macd(closes: number[]): { macd: number[]; signal: number[]; hist: number[] }` (12/26/9)
  - `bollinger(closes: number[], period?: number, k?: number): { mid: number[]; upper: number[]; lower: number[] }` (기본 20, 2)
  - `atr(candles: Candle[], period?: number): number[]` (기본 14)
  - `obv(candles: Candle[]): number[]`
  - `closes(candles: Candle[]): number[]`, `volumes(candles: Candle[]): number[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/analysis/indicators.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sma, ema, rsi, atr, obv, bollinger } from './indicators'
import type { Candle } from '../data/types'

const c = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  ({ time: 0, open: o, high: h, low: l, close: cl, volume: v })

describe('sma', () => {
  it('워밍업 구간은 NaN이고 이후 단순평균이다', () => {
    const out = sma([1, 2, 3, 4, 5], 3)
    expect(out.length).toBe(5)
    expect(out[0]).toBeNaN()
    expect(out[1]).toBeNaN()
    expect(out[2]).toBeCloseTo(2)
    expect(out[3]).toBeCloseTo(3)
    expect(out[4]).toBeCloseTo(4)
  })
})

describe('ema', () => {
  it('첫 유효값은 SMA이고 이후 지수평활한다', () => {
    const out = ema([1, 2, 3, 4, 5], 3)
    expect(out[2]).toBeCloseTo(2)
    // k = 2/(3+1) = 0.5 → 4*0.5 + 2*0.5 = 3
    expect(out[3]).toBeCloseTo(3)
    expect(out[4]).toBeCloseTo(4)
  })
})

describe('rsi', () => {
  it('연속 상승이면 100에 수렴한다', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i)
    const out = rsi(rising, 14)
    expect(out[29]).toBeCloseTo(100, 0)
  })

  it('연속 하락이면 0에 수렴한다', () => {
    const falling = Array.from({ length: 30 }, (_, i) => 100 - i)
    const out = rsi(falling, 14)
    expect(out[29]).toBeCloseTo(0, 0)
  })
})

describe('atr', () => {
  it('일정한 레인지면 그 레인지값이 된다', () => {
    const cs = Array.from({ length: 30 }, () => c(100, 105, 95, 100))
    const out = atr(cs, 14)
    expect(out[29]).toBeCloseTo(10)
  })
})

describe('obv', () => {
  it('종가 상승 시 거래량을 더하고 하락 시 뺀다', () => {
    const out = obv([c(1, 1, 1, 10, 100), c(1, 1, 1, 11, 50), c(1, 1, 1, 9, 30)])
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(50)
    expect(out[2]).toBe(20)
  })
})

describe('bollinger', () => {
  it('변동이 없으면 상하단이 중심선과 같다', () => {
    const flat = Array.from({ length: 25 }, () => 100)
    const out = bollinger(flat, 20, 2)
    expect(out.mid[24]).toBeCloseTo(100)
    expect(out.upper[24]).toBeCloseTo(100)
    expect(out.lower[24]).toBeCloseTo(100)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/analysis/indicators.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`src/analysis/indicators.ts`:

```ts
import type { Candle } from '../data/types'

export const closes = (cs: Candle[]) => cs.map((c) => c.close)
export const volumes = (cs: Candle[]) => cs.map((c) => c.volume)

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function rsi(cl: number[], period = 14): number[] {
  const out = new Array<number>(cl.length).fill(NaN)
  if (cl.length <= period) return out
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = cl[i] - cl[i - 1]
    if (d >= 0) avgGain += d
    else avgLoss -= d
  }
  avgGain /= period
  avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1]
    const gain = d > 0 ? d : 0
    const loss = d < 0 ? -d : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

export function macd(cl: number[]) {
  const fast = ema(cl, 12)
  const slow = ema(cl, 26)
  const line = cl.map((_, i) =>
    Number.isNaN(fast[i]) || Number.isNaN(slow[i]) ? NaN : fast[i] - slow[i],
  )
  const firstValid = line.findIndex((v) => !Number.isNaN(v))
  const signal = new Array<number>(cl.length).fill(NaN)
  if (firstValid >= 0) {
    const sig = ema(line.slice(firstValid), 9)
    for (let i = 0; i < sig.length; i++) signal[firstValid + i] = sig[i]
  }
  const hist = line.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(signal[i]) ? NaN : v - signal[i],
  )
  return { macd: line, signal, hist }
}

export function bollinger(cl: number[], period = 20, k = 2) {
  const mid = sma(cl, period)
  const upper = new Array<number>(cl.length).fill(NaN)
  const lower = new Array<number>(cl.length).fill(NaN)
  for (let i = period - 1; i < cl.length; i++) {
    const win = cl.slice(i - period + 1, i + 1)
    const m = mid[i]
    const sd = Math.sqrt(win.reduce((a, v) => a + (v - m) ** 2, 0) / period)
    upper[i] = m + k * sd
    lower[i] = m - k * sd
  }
  return { mid, upper, lower }
}

export function atr(cs: Candle[], period = 14): number[] {
  const tr = cs.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1].close), Math.abs(c.low - cs[i - 1].close)),
  )
  const out = new Array<number>(cs.length).fill(NaN)
  if (cs.length < period) return out
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < cs.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period
    out[i] = prev
  }
  return out
}

export function obv(cs: Candle[]): number[] {
  const out = new Array<number>(cs.length).fill(0)
  for (let i = 1; i < cs.length; i++) {
    const d = cs[i].close - cs[i - 1].close
    out[i] = out[i - 1] + (d > 0 ? cs[i].volume : d < 0 ? -cs[i].volume : 0)
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/analysis/indicators.test.ts`
Expected: PASS — 7 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/analysis/indicators.ts src/analysis/indicators.test.ts
git commit -m "feat(analysis): 지표 계산 (SMA/EMA/RSI/MACD/BB/ATR/OBV)"
```

---

### Task 5: Signal 타입과 look-ahead 테스트 하네스

이 태스크가 이후 모든 감지 태스크의 기반이 된다. **여기가 틀리면 채점 결과 전체가 거짓이 된다.**

**Files:**
- Create: `src/analysis/signalTypes.ts`, `src/analysis/testing.ts`, `src/analysis/fixtures.ts`
- Test: `src/analysis/testing.test.ts`

**Interfaces:**
- Produces:
  - `type Tier = 1 | 2 | 3 | 4`, `type Confidence = 'A' | 'B' | 'C'`
  - `type SignalSide = 'bullish' | 'bearish' | 'neutral'`
  - `type SignalKind = 'structure' | 'smc' | 'volume' | 'pattern' | 'candle' | 'momentum' | 'ma' | 'fib' | 'volatility'`
  - `type Signal` (아래 정의)
  - `type Detector = (candles: Candle[]) => Signal[]`
  - `TIER_WEIGHT: Record<Tier, number>`
  - `assertNoLookAhead(detect: Detector, candles: Candle[]): void`
  - `synthCandles(n: number, seed?: number): Candle[]` — 결정론적 합성 캔들 (테스트용)

- [ ] **Step 1: Signal 타입 정의**

`src/analysis/signalTypes.ts`:

```ts
import type { Candle } from '../data/types'

export type Tier = 1 | 2 | 3 | 4
export type Confidence = 'A' | 'B' | 'C'
export type SignalSide = 'bullish' | 'bearish' | 'neutral'
export type SignalKind =
  | 'structure' | 'smc' | 'volume' | 'pattern' | 'candle'
  | 'momentum' | 'ma' | 'fib' | 'volatility'

export const TIER_WEIGHT: Record<Tier, number> = { 1: 5, 2: 4, 3: 3, 4: 2 }

export type Signal = {
  id: string
  tier: Tier
  kind: SignalKind
  side: SignalSide
  /** 신호가 '확정'된 봉의 인덱스. 절대 미래 봉을 가리키지 않는다. */
  barIndex: number
  confidence: Confidence
  strength: 1 | 2 | 3
  evidence: string
  refs?: {
    price?: number
    priceHigh?: number
    priceLow?: number
    fromBar?: number
    toBar?: number
    /** 확정에 이후 봉이 필요한 신호의 실제 피벗 위치 */
    pivotBar?: number
  }
}

export type Detector = (candles: Candle[]) => Signal[]
```

- [ ] **Step 2: 합성 캔들 픽스처 작성**

`src/analysis/fixtures.ts`:

```ts
import type { Candle } from '../data/types'

/** 시드 기반 결정론적 난수 (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 테스트용 합성 캔들. 같은 seed면 항상 같은 결과. */
export function synthCandles(n: number, seed = 42): Candle[] {
  const rand = rng(seed)
  const out: Candle[] = []
  let price = 100
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.48) * 2
    const open = price
    const close = Math.max(1, open + drift)
    const high = Math.max(open, close) + rand() * 1.5
    const low = Math.min(open, close) - rand() * 1.5
    out.push({
      time: 1600000000 + i * 14400,
      open, high, low, close,
      volume: 100 + rand() * 400,
    })
    price = close
  }
  return out
}

/** OHLC 4값으로 캔들 하나를 만드는 축약 헬퍼 */
export function mk(open: number, high: number, low: number, close: number, volume = 100, i = 0): Candle {
  return { time: 1600000000 + i * 14400, open, high, low, close, volume }
}
```

- [ ] **Step 3: 하네스의 실패하는 테스트 작성**

`src/analysis/testing.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assertNoLookAhead } from './testing'
import { synthCandles } from './fixtures'
import type { Signal, Detector } from './signalTypes'

const clean: Detector = (cs) =>
  cs.map((c, i) => (c.close > c.open
    ? { id: 'up', tier: 4, kind: 'candle', side: 'bullish', barIndex: i,
        confidence: 'A', strength: 1, evidence: 'green' } as Signal
    : null))
    .filter((s): s is Signal => s !== null)

/** 다음 봉을 보고 판단하므로 look-ahead 위반이다 */
const cheating: Detector = (cs) => {
  const out: Signal[] = []
  for (let i = 0; i < cs.length - 1; i++) {
    if (cs[i + 1].close > cs[i].close) {
      out.push({ id: 'peek', tier: 4, kind: 'candle', side: 'bullish', barIndex: i,
        confidence: 'A', strength: 1, evidence: 'peeked' })
    }
  }
  return out
}

describe('assertNoLookAhead', () => {
  const candles = synthCandles(220)

  it('정직한 감지기는 통과시킨다', () => {
    expect(() => assertNoLookAhead(clean, candles)).not.toThrow()
  })

  it('미래를 참조하는 감지기는 잡아낸다', () => {
    expect(() => assertNoLookAhead(cheating, candles)).toThrow(/look-ahead/i)
  })
})
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `npx vitest run src/analysis/testing.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: 하네스 구현**

> ⚠️ **이 코드 블록은 구현 후 보강되어 폐기되었다.**
> 적대적 리뷰가 치팅 감지기 16종으로 공격해 11종이 이 버전을 통과했다.
> 실제 구현은 커밋 `d8203d3` 이며, 보강 내역은
> `.superpowers/sdd/2026-08-02-chart-drill-part1-engine/task-5-fix-spec.md` 에 있다.
> **권위 있는 소스는 `src/analysis/testing.ts` 의 현재 내용이다.**
>
> 주요 차이: `key()` 가 9개 필드 전부 커버(`tier`·`kind`·`confidence`·`refs` 포함) /
> `Set` 대신 키별 개수 비교(중복 배출 탐지) / 신호 0개면 공허 통과 대신 throw /
> `sampleEvery` 제거(전수 검사) / `barIndex` 의 NaN·소수 거부 /
> 비교는 `actual >= expected` — 잘린 실행이 더 많은 신호를 내는 것은 정상(미충족 갭이
> 나중에 메워져 전체 실행에서 사라지는 경우)이므로 등호로 조이면 Task 7~8이 깨진다.

`src/analysis/testing.ts` (폐기된 초안):

```ts
import type { Candle } from '../data/types'
import type { Detector, Signal } from './signalTypes'

function key(s: Signal): string {
  return `${s.id}@${s.barIndex}:${s.side}:${s.strength}:${s.evidence}`
}

/**
 * 불변식: 신호가 barIndex=k 에서 났다고 주장하면, k까지의 캔들만 줘도 같은 신호가 나와야 한다.
 *
 * 왜 "detect(전체).filter(<=i) === detect(0..i)" 가 아닌가:
 * FVG의 '미충족' 판정처럼 관측 시점까지의 상태에 의존하는 신호는, 나중에 갭이 메워지면
 * 전체 배열에서는 사라지는 게 정상이다. 그건 미래참조가 아니라 올바른 동작이다.
 * 반대로 여기서 잡아야 할 진짜 위반은 "k 시점에 알 수 없던 정보로 k에 신호를 낸 것"이다.
 */
export function assertNoLookAhead(
  detect: Detector,
  candles: Candle[],
  sampleEvery = 1,
): void {
  const full = detect(candles)
  const cache = new Map<number, Set<string>>()

  for (let n = 0; n < full.length; n += sampleEvery) {
    const s = full[n]
    if (s.barIndex < 0 || s.barIndex >= candles.length) {
      throw new Error(`barIndex ${s.barIndex} 가 캔들 범위(0..${candles.length - 1}) 밖이다: ${s.id}`)
    }
    if (!cache.has(s.barIndex)) {
      cache.set(s.barIndex, new Set(detect(candles.slice(0, s.barIndex + 1)).map(key)))
    }
    if (!cache.get(s.barIndex)!.has(key(s))) {
      throw new Error(
        `look-ahead 위반: 신호 "${key(s)}" 는 전체 배열에서는 나오지만\n` +
        `0..${s.barIndex} 까지만 주면 나오지 않는다. ` +
        `barIndex ${s.barIndex} 이후의 봉을 참조하고 있다.`,
      )
    }
  }
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `npx vitest run src/analysis/testing.test.ts`
Expected: PASS — 2 tests passed. 특히 두 번째 테스트가 통과해야 하네스가 실제로 위반을 잡는다는 증거가 된다.

- [ ] **Step 7: 커밋**

```bash
git add src/analysis/signalTypes.ts src/analysis/testing.ts src/analysis/fixtures.ts src/analysis/testing.test.ts
git commit -m "feat(analysis): Signal 타입과 look-ahead 회귀 테스트 하네스"
```

---

### Task 6: 시장 구조 — 스윙 하이/로우와 추세

**Files:**
- Create: `src/analysis/structure.ts`
- Test: `src/analysis/structure.test.ts`

**Interfaces:**
- Consumes: `Candle`, `Signal`, `assertNoLookAhead`, `synthCandles`
- Produces:
  - `type Pivot = { barIndex: number; pivotBar: number; price: number; kind: 'high' | 'low' }`
  - `findPivots(cs: Candle[], n?: number): Pivot[]` — 기본 n=2. `barIndex = pivotBar + n` (확정 시점)
  - `detectTrend(cs: Candle[]): Signal[]` — `trend_up_structure` / `trend_down_structure` / `trend_range`
  - `srLevels(cs: Candle[], tolerancePct?: number): { price: number; touches: number; lastBar: number }[]`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/analysis/structure.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findPivots, detectTrend, srLevels } from './structure'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'

describe('findPivots', () => {
  it('명확한 봉우리를 스윙 하이로 잡고 확정 시점을 pivot+n으로 기록한다', () => {
    // 인덱스 4가 봉우리
    const cs = [
      mk(10, 11, 9, 10), mk(10, 12, 9, 11), mk(11, 13, 10, 12),
      mk(12, 14, 11, 13), mk(13, 20, 12, 19), mk(19, 15, 12, 13),
      mk(13, 14, 11, 12), mk(12, 13, 10, 11),
    ]
    const highs = findPivots(cs, 2).filter((p) => p.kind === 'high')
    expect(highs).toContainEqual({ barIndex: 6, pivotBar: 4, price: 20, kind: 'high' })
  })

  it('확정에 필요한 오른쪽 봉이 없으면 피벗을 만들지 않는다', () => {
    const cs = [mk(10, 11, 9, 10), mk(10, 20, 9, 19), mk(19, 15, 12, 13)]
    expect(findPivots(cs, 2)).toEqual([])
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(
      (cs) => findPivots(cs, 2).map((p) => ({
        id: `pivot_${p.kind}`, tier: 3 as const, kind: 'structure' as const,
        side: 'neutral' as const, barIndex: p.barIndex, confidence: 'A' as const,
        strength: 1 as const, evidence: String(p.price),
      })),
      synthCandles(220),
    )
  })
})

describe('detectTrend', () => {
  it('계단식 상승이면 상승추세를 낸다', () => {
    const cs = Array.from({ length: 60 }, (_, i) =>
      mk(100 + i, 102 + i, 99 + i, 101 + i, 100, i))
    const sigs = detectTrend(cs)
    expect(sigs.some((s) => s.id === 'trend_up_structure')).toBe(true)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectTrend, synthCandles(220))
  })
})

describe('srLevels', () => {
  it('같은 가격을 반복 터치하면 하나의 레벨로 묶고 터치 횟수를 센다', () => {
    // 같은 고점(120)을 세 번 찍는 톱니 형태
    const cs = []
    for (let k = 0; k < 3; k++) {
      cs.push(mk(100, 105, 99, 104, 100, k * 6 + 0))
      cs.push(mk(104, 110, 103, 109, 100, k * 6 + 1))
      cs.push(mk(109, 120, 108, 119, 100, k * 6 + 2))  // 고점 120
      cs.push(mk(119, 119.5, 108, 109, 100, k * 6 + 3))
      cs.push(mk(109, 110, 100, 101, 100, k * 6 + 4))
      cs.push(mk(101, 102, 99, 100, 100, k * 6 + 5))
    }
    const levels = srLevels(cs, 0.005)
    const near120 = levels.find((l) => Math.abs(l.price - 120) < 1)
    expect(near120).toBeDefined()
    expect(near120!.touches).toBeGreaterThanOrEqual(2)
  })

  it('터치가 1회뿐인 가격은 레벨로 인정하지 않는다', () => {
    const cs = [
      mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1),
      mk(100, 150, 99, 149, 100, 2),   // 단 한 번의 고점
      mk(149, 150, 99, 100, 100, 3), mk(100, 101, 99, 100, 100, 4),
    ]
    expect(srLevels(cs).every((l) => l.touches >= 2)).toBe(true)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/analysis/structure.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`src/analysis/structure.ts`:

```ts
import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'

export type Pivot = {
  /** 신호 확정 시점 = pivotBar + n */
  barIndex: number
  /** 실제 봉우리/골짜기 봉 */
  pivotBar: number
  price: number
  kind: 'high' | 'low'
}

/**
 * fractal 방식 스윙 감지. 좌우 n봉보다 극단이면 피벗.
 * 오른쪽 n봉이 있어야 확정되므로 barIndex는 pivotBar+n 이다.
 */
export function findPivots(cs: Candle[], n = 2): Pivot[] {
  const out: Pivot[] = []
  for (let i = n; i < cs.length - n; i++) {
    let isHigh = true
    let isLow = true
    for (let j = 1; j <= n; j++) {
      if (cs[i].high <= cs[i - j].high || cs[i].high <= cs[i + j].high) isHigh = false
      if (cs[i].low >= cs[i - j].low || cs[i].low >= cs[i + j].low) isLow = false
    }
    if (isHigh) out.push({ barIndex: i + n, pivotBar: i, price: cs[i].high, kind: 'high' })
    if (isLow) out.push({ barIndex: i + n, pivotBar: i, price: cs[i].low, kind: 'low' })
  }
  return out.sort((a, b) => a.barIndex - b.barIndex || a.kind.localeCompare(b.kind))
}

/**
 * 마지막 확정 시점 기준으로 추세를 판정한다.
 * 최근 스윙하이 2개와 스윙로우 2개를 비교: HH+HL=상승, LH+LL=하락, 그 외 횡보.
 */
export function detectTrend(cs: Candle[]): Signal[] {
  const pivots = findPivots(cs, 2)
  if (pivots.length === 0) return []
  const last = pivots[pivots.length - 1].barIndex

  const highs = pivots.filter((p) => p.kind === 'high').slice(-2)
  const lows = pivots.filter((p) => p.kind === 'low').slice(-2)
  if (highs.length < 2 || lows.length < 2) return []

  const hh = highs[1].price > highs[0].price
  const hl = lows[1].price > lows[0].price
  const lh = highs[1].price < highs[0].price
  const ll = lows[1].price < lows[0].price

  const base = { tier: 3 as const, kind: 'structure' as const, confidence: 'A' as const, barIndex: last }

  if (hh && hl) {
    return [{ ...base, id: 'trend_up_structure', side: 'bullish', strength: 2,
      evidence: `고점 ${highs[0].price.toFixed(2)}→${highs[1].price.toFixed(2)} 상승, 저점 ${lows[0].price.toFixed(2)}→${lows[1].price.toFixed(2)} 상승 (HH/HL)` }]
  }
  if (lh && ll) {
    return [{ ...base, id: 'trend_down_structure', side: 'bearish', strength: 2,
      evidence: `고점 ${highs[0].price.toFixed(2)}→${highs[1].price.toFixed(2)} 하락, 저점 ${lows[0].price.toFixed(2)}→${lows[1].price.toFixed(2)} 하락 (LH/LL)` }]
  }
  return [{ ...base, id: 'trend_range', side: 'neutral', strength: 1,
    evidence: '고점·저점이 한 방향으로 정렬되지 않음 (횡보)' }]
}

/** 피벗 가격을 tolerance 내로 묶어 수평 지지·저항 레벨을 만든다 */
export function srLevels(cs: Candle[], tolerancePct = 0.005) {
  const pivots = findPivots(cs, 2)
  const clusters: { price: number; touches: number; lastBar: number }[] = []
  for (const p of pivots) {
    const hit = clusters.find((c) => Math.abs(c.price - p.price) / c.price <= tolerancePct)
    if (hit) {
      hit.price = (hit.price * hit.touches + p.price) / (hit.touches + 1)
      hit.touches += 1
      hit.lastBar = Math.max(hit.lastBar, p.barIndex)
    } else {
      clusters.push({ price: p.price, touches: 1, lastBar: p.barIndex })
    }
  }
  return clusters.filter((c) => c.touches >= 2).sort((a, b) => b.touches - a.touches)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/analysis/structure.test.ts`
Expected: PASS — 7 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/analysis/structure.ts src/analysis/structure.test.ts
git commit -m "feat(analysis): 스윙 피벗·추세 판정·S/R 레벨"
```

---

### Task 7: SMC — FVG와 오더블록

**Files:**
- Create: `src/analysis/smc.ts`
- Test: `src/analysis/smc.test.ts`

**Interfaces:**
- Consumes: `Candle`, `Signal`, `atr`, `findPivots`
- Produces:
  - `detectFVG(cs: Candle[]): Signal[]` — `fvg_bull` / `fvg_bear` (미충족인 것만)
  - `detectOrderBlocks(cs: Candle[]): Signal[]` — `ob_bull_support` / `ob_bear_resistance`

**감지 규칙**

| 신호 | 조건 | barIndex |
|---|---|---|
| `fvg_bull` | `low[i] > high[i-2]` — 갭 구간 `[high[i-2], low[i]]` | `i` |
| `fvg_bear` | `high[i] < low[i-2]` — 갭 구간 `[high[i], low[i-2]]` | `i` |
| 미충족 필터 | `i+1..end` 중 어떤 봉도 갭 구간에 진입하지 않음 | — |
| `ob_bull_support` | `i`가 음봉이고, `i+1..i+3` 중 `close > high[i]`이며 그 상승폭 ≥ 1.5×ATR[i] | 돌파 봉 |
| `ob_bear_resistance` | `i`가 양봉이고, `i+1..i+3` 중 `close < low[i]`이며 그 하락폭 ≥ 1.5×ATR[i] | 돌파 봉 |

- [ ] **Step 1: 실패하는 테스트 작성**

`src/analysis/smc.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectFVG, detectOrderBlocks } from './smc'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'

describe('detectFVG', () => {
  it('상승 갭을 잡고 갭 구간을 refs에 담는다', () => {
    // i=2의 저가(15)가 i=0의 고가(10)보다 위 → 상승 FVG [10, 15]
    const cs = [mk(8, 10, 7, 9), mk(9, 16, 9, 15), mk(15, 20, 15, 19), mk(19, 21, 18, 20)]
    const sigs = detectFVG(cs)
    const bull = sigs.find((s) => s.id === 'fvg_bull')
    expect(bull).toBeDefined()
    expect(bull!.barIndex).toBe(2)
    expect(bull!.refs).toMatchObject({ priceLow: 10, priceHigh: 15 })
  })

  it('이후 가격이 갭을 메우면 신호를 내지 않는다', () => {
    const cs = [mk(8, 10, 7, 9), mk(9, 16, 9, 15), mk(15, 20, 15, 19), mk(19, 20, 9, 10)]
    expect(detectFVG(cs).some((s) => s.id === 'fvg_bull')).toBe(false)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectFVG, synthCandles(220))
  })
})

describe('detectOrderBlocks', () => {
  it('상승 임펄스 직전 음봉을 강세 오더블록으로 잡는다', () => {
    const flat = Array.from({ length: 20 }, (_, i) => mk(100, 101, 99, 100, 100, i))
    const cs = [
      ...flat,
      mk(100, 100.5, 98, 98.5, 100, 20),   // 20: 음봉 = OB 후보
      mk(98.5, 106, 98, 105, 300, 21),     // 21: 강한 상승 돌파
      mk(105, 107, 104, 106, 200, 22),
    ]
    const sigs = detectOrderBlocks(cs)
    const ob = sigs.find((s) => s.id === 'ob_bull_support')
    expect(ob).toBeDefined()
    expect(ob!.barIndex).toBe(21)
    expect(ob!.refs?.pivotBar).toBe(20)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectOrderBlocks, synthCandles(220))
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/analysis/smc.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`src/analysis/smc.ts`:

```ts
import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { atr } from './indicators'

/** 상승/하락 FVG 중 decisionIndex 시점에 아직 메워지지 않은 것만 낸다 */
export function detectFVG(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  for (let i = 2; i < cs.length; i++) {
    const bullGap = cs[i].low > cs[i - 2].high
    const bearGap = cs[i].high < cs[i - 2].low
    if (!bullGap && !bearGap) continue

    const lo = bullGap ? cs[i - 2].high : cs[i].high
    const hi = bullGap ? cs[i].low : cs[i - 2].low

    let filled = false
    for (let j = i + 1; j < cs.length; j++) {
      if (cs[j].low <= hi && cs[j].high >= lo) { filled = true; break }
    }
    if (filled) continue

    out.push({
      id: bullGap ? 'fvg_bull' : 'fvg_bear',
      tier: 2, kind: 'smc', side: bullGap ? 'bullish' : 'bearish',
      barIndex: i, confidence: 'A', strength: 2,
      evidence: `${bullGap ? '상승' : '하락'} FVG ${lo.toFixed(2)}~${hi.toFixed(2)} 미충족`,
      refs: { priceLow: lo, priceHigh: hi, fromBar: i - 2, toBar: i },
    })
  }
  return out
}

/** 강한 임펄스 직전의 반대 캔들을 오더블록으로 본다 */
export function detectOrderBlocks(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  const a = atr(cs, 14)
  const LOOKAHEAD = 3
  const MIN_IMPULSE = 1.5

  for (let i = 1; i < cs.length - 1; i++) {
    const range = a[i]
    if (Number.isNaN(range) || range <= 0) continue

    const isDown = cs[i].close < cs[i].open
    const isUp = cs[i].close > cs[i].open

    for (let j = i + 1; j <= Math.min(i + LOOKAHEAD, cs.length - 1); j++) {
      if (isDown && cs[j].close > cs[i].high && cs[j].close - cs[i].low >= MIN_IMPULSE * range) {
        out.push({
          id: 'ob_bull_support', tier: 1, kind: 'smc', side: 'bullish',
          barIndex: j, confidence: 'A', strength: 3,
          evidence: `${j - i}봉 뒤 ${((cs[j].close - cs[i].low) / range).toFixed(1)}ATR 상승 임펄스 직전 음봉 (${cs[i].low.toFixed(2)}~${cs[i].high.toFixed(2)})`,
          refs: { priceLow: cs[i].low, priceHigh: cs[i].high, pivotBar: i, fromBar: i, toBar: j },
        })
        break
      }
      if (isUp && cs[j].close < cs[i].low && cs[i].high - cs[j].close >= MIN_IMPULSE * range) {
        out.push({
          id: 'ob_bear_resistance', tier: 1, kind: 'smc', side: 'bearish',
          barIndex: j, confidence: 'A', strength: 3,
          evidence: `${j - i}봉 뒤 ${((cs[i].high - cs[j].close) / range).toFixed(1)}ATR 하락 임펄스 직전 양봉 (${cs[i].low.toFixed(2)}~${cs[i].high.toFixed(2)})`,
          refs: { priceLow: cs[i].low, priceHigh: cs[i].high, pivotBar: i, fromBar: i, toBar: j },
        })
        break
      }
    }
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/analysis/smc.test.ts`
Expected: PASS — 5 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/analysis/smc.ts src/analysis/smc.test.ts
git commit -m "feat(analysis): FVG·오더블록 감지"
```

---

### Task 8: SMC — 유동성 스윕과 시장구조 붕괴

**Files:**
- Modify: `src/analysis/smc.ts` (함수 추가)
- Modify: `src/analysis/smc.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: `findPivots` (Task 6)
- Produces:
  - `detectLiquiditySweep(cs: Candle[]): Signal[]` — `liq_sweep_low` / `liq_sweep_high`
  - `detectMSB(cs: Candle[]): Signal[]` — `msb_bull` / `msb_bear`

**감지 규칙**

| 신호 | 조건 | barIndex |
|---|---|---|
| `liq_sweep_low` | 확정된 직전 스윙로우 `L`에 대해 `low[i] < L` 이고 `close[i] > L` | `i` |
| `liq_sweep_high` | 확정된 직전 스윙하이 `H`에 대해 `high[i] > H` 이고 `close[i] < H` | `i` |
| `msb_bull` | 확정된 직전 스윙하이 `H`에 대해 `close[i] > H` | `i` |
| `msb_bear` | 확정된 직전 스윙로우 `L`에 대해 `close[i] < L` | `i` |

**주의:** "확정된"은 `pivot.barIndex <= i` 를 뜻한다. `pivotBar <= i` 로 쓰면 look-ahead 위반이다.

- [ ] **Step 1: 실패하는 테스트 추가**

`src/analysis/smc.test.ts` 하단에 추가:

```ts
import { detectLiquiditySweep, detectMSB } from './smc'

describe('detectLiquiditySweep', () => {
  it('스윙로우를 꼬리로 깨고 종가는 위에서 마감하면 저점 스윕이다', () => {
    const cs = [
      mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1),
      mk(100, 101, 95, 96, 100, 2),   // 2: 스윙로우 95
      mk(96, 101, 97, 100, 100, 3), mk(100, 102, 99, 101, 100, 4),
      mk(101, 102, 99, 100, 100, 5), mk(100, 101, 99, 100, 100, 6),
      mk(100, 101, 93, 99, 300, 7),   // 7: 95를 꼬리로 깨고 종가 복귀
    ]
    const sigs = detectLiquiditySweep(cs)
    const s = sigs.find((x) => x.id === 'liq_sweep_low')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(7)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectLiquiditySweep, synthCandles(220))
  })
})

describe('detectMSB', () => {
  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectMSB, synthCandles(220))
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/analysis/smc.test.ts`
Expected: FAIL — `detectLiquiditySweep` is not exported

- [ ] **Step 3: 구현 추가**

먼저 `src/analysis/smc.ts` **상단 import 블록**에 다음 줄을 추가한다 (파일 하단이 아니다):

```ts
import { findPivots, type Pivot } from './structure'
```

그다음 파일 하단에 함수를 추가한다:

```ts
/** i 시점에 이미 확정된 피벗 중 가장 최근 것 */
function lastConfirmedPivot(pivots: Pivot[], i: number, kind: 'high' | 'low'): Pivot | undefined {
  let found: Pivot | undefined
  for (const p of pivots) {
    if (p.kind !== kind) continue
    if (p.barIndex > i) break
    found = p
  }
  return found
}

export function detectLiquiditySweep(cs: Candle[]): Signal[] {
  const pivots = findPivots(cs, 2)
  const out: Signal[] = []

  for (let i = 0; i < cs.length; i++) {
    const lo = lastConfirmedPivot(pivots, i, 'low')
    if (lo && lo.pivotBar < i && cs[i].low < lo.price && cs[i].close > lo.price) {
      out.push({
        id: 'liq_sweep_low', tier: 1, kind: 'smc', side: 'bullish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `스윙로우 ${lo.price.toFixed(2)} 를 저가 ${cs[i].low.toFixed(2)} 로 이탈 후 종가 ${cs[i].close.toFixed(2)} 로 복귀 (롱 손절 사냥)`,
        refs: { price: lo.price, pivotBar: lo.pivotBar, toBar: i },
      })
    }
    const hi = lastConfirmedPivot(pivots, i, 'high')
    if (hi && hi.pivotBar < i && cs[i].high > hi.price && cs[i].close < hi.price) {
      out.push({
        id: 'liq_sweep_high', tier: 1, kind: 'smc', side: 'bearish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `스윙하이 ${hi.price.toFixed(2)} 를 고가 ${cs[i].high.toFixed(2)} 로 이탈 후 종가 ${cs[i].close.toFixed(2)} 로 복귀 (숏 손절 사냥)`,
        refs: { price: hi.price, pivotBar: hi.pivotBar, toBar: i },
      })
    }
  }
  return out
}

export function detectMSB(cs: Candle[]): Signal[] {
  const pivots = findPivots(cs, 2)
  const out: Signal[] = []
  let lastBullBreak = -1
  let lastBearBreak = -1

  for (let i = 0; i < cs.length; i++) {
    const hi = lastConfirmedPivot(pivots, i, 'high')
    if (hi && hi.pivotBar < i && cs[i].close > hi.price && hi.pivotBar > lastBullBreak) {
      lastBullBreak = hi.pivotBar
      out.push({
        id: 'msb_bull', tier: 1, kind: 'structure', side: 'bullish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `종가 ${cs[i].close.toFixed(2)} 가 직전 스윙하이 ${hi.price.toFixed(2)} 상향 돌파 (구조 상승)`,
        refs: { price: hi.price, pivotBar: hi.pivotBar, toBar: i },
      })
    }
    const lo = lastConfirmedPivot(pivots, i, 'low')
    if (lo && lo.pivotBar < i && cs[i].close < lo.price && lo.pivotBar > lastBearBreak) {
      lastBearBreak = lo.pivotBar
      out.push({
        id: 'msb_bear', tier: 1, kind: 'structure', side: 'bearish',
        barIndex: i, confidence: 'A', strength: 3,
        evidence: `종가 ${cs[i].close.toFixed(2)} 가 직전 스윙로우 ${lo.price.toFixed(2)} 하향 붕괴 (구조 하락)`,
        refs: { price: lo.price, pivotBar: lo.pivotBar, toBar: i },
      })
    }
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/analysis/smc.test.ts`
Expected: PASS — 8 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/analysis/smc.ts src/analysis/smc.test.ts
git commit -m "feat(analysis): 유동성 스윕·시장구조 붕괴(MSB) 감지"
```

---

### Task 9: 캔들패턴 16종

**Files:**
- Create: `src/analysis/candlePatterns.ts`
- Test: `src/analysis/candlePatterns.test.ts`

**Interfaces:**
- Consumes: `Candle`, `Signal`, `atr`
- Produces: `detectCandlePatterns(cs: Candle[]): Signal[]`

모든 캔들패턴 신호는 `tier: 4`, `kind: 'candle'`, `confidence: 'A'` 이고 `barIndex`는 **패턴의 마지막 봉**이다.

**판정 규칙 명세** — 헬퍼: `body(c)=|close-open|`, `upper(c)=high-max(o,c)`, `lower(c)=min(o,c)-low`, `range(c)=high-low`, `isBull(c)=close>open`

| id | 라벨 | 봉 수 | 조건 | side |
|---|---|---|---|---|
| `candle_hammer` | 망치형 | 1 | `lower ≥ 2×body` 및 `upper ≤ body` 및 `body > 0` | bullish |
| `candle_inv_hammer` | 역망치형 | 1 | `upper ≥ 2×body` 및 `lower ≤ body` 및 `isBull` | bullish |
| `candle_shooting_star` | 유성형 | 1 | `upper ≥ 2×body` 및 `lower ≤ body` 및 `!isBull` | bearish |
| `candle_doji` | 도지 | 1 | `body ≤ 0.1×range` 및 `range > 0` | neutral |
| `candle_long_wick` | 긴 꼬리 | 1 | `max(upper,lower) ≥ 0.66×range` 및 `range ≥ 0.8×ATR` | 긴 쪽 반대 |
| `candle_inside_bar` | 인사이드바 | 2 | `high[i] < high[i-1]` 및 `low[i] > low[i-1]` | neutral |
| `candle_bull_engulf` | 상승 장악형 | 2 | `!isBull(i-1)` 및 `isBull(i)` 및 `close[i] > open[i-1]` 및 `open[i] < close[i-1]` | bullish |
| `candle_bear_engulf` | 하락 장악형 | 2 | `isBull(i-1)` 및 `!isBull(i)` 및 `close[i] < open[i-1]` 및 `open[i] > close[i-1]` | bearish |
| `candle_bull_harami` | 상승 잉태형 | 2 | `!isBull(i-1)` 및 `isBull(i)` 및 `open[i] > close[i-1]` 및 `close[i] < open[i-1]` | bullish |
| `candle_bear_harami` | 하락 잉태형 | 2 | `isBull(i-1)` 및 `!isBull(i)` 및 `open[i] < close[i-1]` 및 `close[i] > open[i-1]` | bearish |
| `candle_tweezer` | 트위저 | 2 | `\|low[i]-low[i-1]\| ≤ 0.001×low[i]` (바텀) 또는 고가 동일 (탑) | 바텀=bullish |
| `candle_morning_star` | 샛별형 | 3 | `!isBull(i-2)` 및 `body(i-1) ≤ 0.3×body(i-2)` 및 `isBull(i)` 및 `close[i] > (open[i-2]+close[i-2])/2` | bullish |
| `candle_evening_star` | 석별형 | 3 | `isBull(i-2)` 및 `body(i-1) ≤ 0.3×body(i-2)` 및 `!isBull(i)` 및 `close[i] < (open[i-2]+close[i-2])/2` | bearish |
| `candle_three_soldiers` | 적삼병 | 3 | 3봉 모두 `isBull`, `close` 계단 상승, 각 `body ≥ 0.5×range` | bullish |
| `candle_three_crows` | 흑삼병 | 3 | 3봉 모두 `!isBull`, `close` 계단 하락, 각 `body ≥ 0.5×range` | bearish |
| `candle_tri_star` | 세 십자형 | 3 | 3봉 모두 도지 조건 충족 | neutral |

- [ ] **Step 1: 실패하는 테스트 작성**

`src/analysis/candlePatterns.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectCandlePatterns } from './candlePatterns'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'

const idsAt = (cs: Parameters<typeof detectCandlePatterns>[0], i: number) =>
  detectCandlePatterns(cs).filter((s) => s.barIndex === i).map((s) => s.id)

describe('detectCandlePatterns', () => {
  it('망치형: 아래꼬리가 몸통의 2배 이상', () => {
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 101, 90, 100.5, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_hammer')
  })

  it('유성형: 위꼬리가 몸통의 2배 이상인 음봉', () => {
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 110, 99.5, 99.5, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_shooting_star')
  })

  it('상승 장악형: 음봉을 다음 양봉이 완전히 감싼다', () => {
    const cs = [mk(100, 101, 97, 98, 100, 0), mk(97.5, 103, 97, 102, 200, 1)]
    expect(idsAt(cs, 1)).toContain('candle_bull_engulf')
  })

  it('하락 장악형: 양봉을 다음 음봉이 완전히 감싼다', () => {
    const cs = [mk(98, 101, 97, 100, 100, 0), mk(100.5, 101, 96, 97, 200, 1)]
    expect(idsAt(cs, 1)).toContain('candle_bear_engulf')
  })

  it('적삼병: 계단식 상승 양봉 3개', () => {
    const cs = [
      mk(100, 104, 99.5, 103, 100, 0),
      mk(103, 108, 102.5, 107, 100, 1),
      mk(107, 112, 106.5, 111, 100, 2),
    ]
    expect(idsAt(cs, 2)).toContain('candle_three_soldiers')
  })

  it('샛별형: 음봉 → 작은 몸통 → 되돌리는 양봉', () => {
    const cs = [
      mk(110, 110.5, 99, 100, 100, 0),
      mk(99.5, 100.5, 99, 100, 100, 1),
      mk(100, 108, 99.5, 107, 200, 2),
    ]
    expect(idsAt(cs, 2)).toContain('candle_morning_star')
  })

  it('인사이드바: 직전 봉 레인지 안에 들어간다', () => {
    const cs = [mk(100, 110, 90, 105, 100, 0), mk(102, 108, 95, 104, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_inside_bar')
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectCandlePatterns, synthCandles(220))
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/analysis/candlePatterns.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 헬퍼와 1봉·2봉 패턴 구현**

`src/analysis/candlePatterns.ts`:

```ts
import type { Candle } from '../data/types'
import type { Signal, SignalSide } from './signalTypes'
import { atr } from './indicators'

const body = (c: Candle) => Math.abs(c.close - c.open)
const upper = (c: Candle) => c.high - Math.max(c.open, c.close)
const lower = (c: Candle) => Math.min(c.open, c.close) - c.low
const range = (c: Candle) => c.high - c.low
const isBull = (c: Candle) => c.close > c.open
const isDoji = (c: Candle) => range(c) > 0 && body(c) <= 0.1 * range(c)

function sig(id: string, side: SignalSide, barIndex: number, evidence: string, strength: 1 | 2 | 3 = 1): Signal {
  return { id, tier: 4, kind: 'candle', side, barIndex, confidence: 'A', strength, evidence }
}

export function detectCandlePatterns(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  const a = atr(cs, 14)

  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    const b = body(c)
    const r = range(c)

    // ── 1봉 패턴 ──
    if (b > 0 && lower(c) >= 2 * b && upper(c) <= b) {
      out.push(sig('candle_hammer', 'bullish', i, `아래꼬리 ${lower(c).toFixed(2)} 가 몸통 ${b.toFixed(2)} 의 ${(lower(c) / b).toFixed(1)}배`, 2))
    }
    if (b > 0 && upper(c) >= 2 * b && lower(c) <= b) {
      if (isBull(c)) out.push(sig('candle_inv_hammer', 'bullish', i, `위꼬리 ${upper(c).toFixed(2)} 가 몸통의 ${(upper(c) / b).toFixed(1)}배인 양봉`, 1))
      else out.push(sig('candle_shooting_star', 'bearish', i, `위꼬리 ${upper(c).toFixed(2)} 가 몸통의 ${(upper(c) / b).toFixed(1)}배인 음봉`, 2))
    }
    if (isDoji(c)) {
      out.push(sig('candle_doji', 'neutral', i, `몸통 ${b.toFixed(2)} 가 전체 레인지 ${r.toFixed(2)} 의 10% 이하`, 1))
    }
    if (r > 0 && !Number.isNaN(a[i]) && r >= 0.8 * a[i] && Math.max(upper(c), lower(c)) >= 0.66 * r) {
      const longUp = upper(c) >= lower(c)
      out.push(sig('candle_long_wick', longUp ? 'bearish' : 'bullish', i,
        `${longUp ? '위' : '아래'}꼬리가 레인지의 ${((Math.max(upper(c), lower(c)) / r) * 100).toFixed(0)}% — 가격 거부`, 2))
    }

    // ── 2봉 패턴 ──
    if (i >= 1) {
      const p = cs[i - 1]
      if (c.high < p.high && c.low > p.low) {
        out.push(sig('candle_inside_bar', 'neutral', i, `직전 봉 레인지(${p.low.toFixed(2)}~${p.high.toFixed(2)}) 내부에 수렴`, 1))
      }
      if (!isBull(p) && isBull(c) && c.close > p.open && c.open < p.close) {
        out.push(sig('candle_bull_engulf', 'bullish', i, `직전 음봉 몸통(${p.close.toFixed(2)}~${p.open.toFixed(2)})을 완전히 장악`, 2))
      }
      if (isBull(p) && !isBull(c) && c.close < p.open && c.open > p.close) {
        out.push(sig('candle_bear_engulf', 'bearish', i, `직전 양봉 몸통(${p.open.toFixed(2)}~${p.close.toFixed(2)})을 완전히 장악`, 2))
      }
      if (!isBull(p) && isBull(c) && c.open > p.close && c.close < p.open) {
        out.push(sig('candle_bull_harami', 'bullish', i, `직전 음봉이 현재 양봉을 품는 형태`, 1))
      }
      if (isBull(p) && !isBull(c) && c.open < p.close && c.close > p.open) {
        out.push(sig('candle_bear_harami', 'bearish', i, `직전 양봉이 현재 음봉을 품는 형태`, 1))
      }
      if (Math.abs(c.low - p.low) <= 0.001 * c.low) {
        out.push(sig('candle_tweezer', 'bullish', i, `저점 ${c.low.toFixed(2)} 이 직전 봉과 일치 (트위저 바텀)`, 1))
      } else if (Math.abs(c.high - p.high) <= 0.001 * c.high) {
        out.push(sig('candle_tweezer', 'bearish', i, `고점 ${c.high.toFixed(2)} 이 직전 봉과 일치 (트위저 탑)`, 1))
      }
    }

    // ── 3봉 패턴 ──
    if (i >= 2) {
      const a2 = cs[i - 2]
      const a1 = cs[i - 1]
      const mid2 = (a2.open + a2.close) / 2

      if (!isBull(a2) && body(a1) <= 0.3 * body(a2) && isBull(c) && c.close > mid2) {
        out.push(sig('candle_morning_star', 'bullish', i, `음봉 → 소형 몸통 → 양봉이 중간값 ${mid2.toFixed(2)} 상회`, 3))
      }
      if (isBull(a2) && body(a1) <= 0.3 * body(a2) && !isBull(c) && c.close < mid2) {
        out.push(sig('candle_evening_star', 'bearish', i, `양봉 → 소형 몸통 → 음봉이 중간값 ${mid2.toFixed(2)} 하회`, 3))
      }
      const three = [a2, a1, c]
      if (three.every((x) => isBull(x) && body(x) >= 0.5 * range(x)) && a1.close > a2.close && c.close > a1.close) {
        out.push(sig('candle_three_soldiers', 'bullish', i, `연속 양봉 3개 종가 계단 상승 ${a2.close.toFixed(2)}→${a1.close.toFixed(2)}→${c.close.toFixed(2)}`, 3))
      }
      if (three.every((x) => !isBull(x) && body(x) >= 0.5 * range(x)) && a1.close < a2.close && c.close < a1.close) {
        out.push(sig('candle_three_crows', 'bearish', i, `연속 음봉 3개 종가 계단 하락 ${a2.close.toFixed(2)}→${a1.close.toFixed(2)}→${c.close.toFixed(2)}`, 3))
      }
      if (three.every(isDoji)) {
        out.push(sig('candle_tri_star', 'neutral', i, `도지 3연속 — 극심한 균형 상태`, 2))
      }
    }
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/analysis/candlePatterns.test.ts`
Expected: PASS — 8 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/analysis/candlePatterns.ts src/analysis/candlePatterns.test.ts
git commit -m "feat(analysis): 캔들패턴 16종 감지"
```

---

### Task 10: 다이버전스

**Files:**
- Create: `src/analysis/divergence.ts`
- Test: `src/analysis/divergence.test.ts`

**Interfaces:**
- Consumes: `findPivots` (Task 6), `rsi`, `macd`, `obv`, `closes` (Task 4)
- Produces: `detectDivergence(cs: Candle[]): Signal[]`
  - `rsi_bull_div`, `rsi_bear_div`, `rsi_hidden_div`, `macd_divergence`, `obv_divergence`

**규칙** — 확정된 스윙 피벗 2개(`barIndex <= i`)를 비교한다.

| id | 조건 (저점 피벗 2개 `p0 → p1`) | side |
|---|---|---|
| `rsi_bull_div` | 가격 저점 하락 (`p1.price < p0.price`) + RSI 저점 상승 | bullish |
| `rsi_bear_div` | 고점 피벗에서 가격 고점 상승 + RSI 고점 하락 | bearish |
| `rsi_hidden_div` | 가격 저점 상승 + RSI 저점 하락 (상승추세 지속 신호) | bullish |
| `macd_divergence` | 가격 저점 하락 + MACD 히스토그램 저점 상승 | bullish |
| `obv_divergence` | 가격 저점 하락 + OBV 저점 상승 | bullish |

`barIndex`는 **두 번째 피벗의 확정 시점**(`p1.barIndex`)이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/analysis/divergence.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectDivergence } from './divergence'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'
import type { Candle } from '../data/types'

/** 급락 후 저점을 낮추지만 하락 강도는 약해지는 구간 → 강세 다이버전스 */
function bullDivSeries(): Candle[] {
  const cs: Candle[] = []
  let p = 200
  for (let i = 0; i < 40; i++) { p -= 3; cs.push(mk(p + 3, p + 3.5, p - 1, p, 100, i)) }   // 급락
  for (let i = 40; i < 50; i++) { p += 2; cs.push(mk(p - 2, p + 0.5, p - 2.5, p, 100, i)) } // 반등
  for (let i = 50; i < 62; i++) { p -= 0.4; cs.push(mk(p + 0.4, p + 0.8, p - 0.6, p, 100, i)) } // 완만한 저점 갱신
  for (let i = 62; i < 70; i++) { p += 1.5; cs.push(mk(p - 1.5, p + 0.5, p - 2, p, 100, i)) }
  return cs
}

describe('detectDivergence', () => {
  it('가격 저점은 낮아지고 RSI 저점은 높아지면 강세 다이버전스를 낸다', () => {
    const sigs = detectDivergence(bullDivSeries())
    expect(sigs.some((s) => s.id === 'rsi_bull_div')).toBe(true)
  })

  it('신호의 evidence에 실제 수치를 담는다', () => {
    const s = detectDivergence(bullDivSeries()).find((x) => x.id === 'rsi_bull_div')
    expect(s?.evidence).toMatch(/RSI/)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectDivergence, synthCandles(220))
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/analysis/divergence.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`src/analysis/divergence.ts`:

```ts
import type { Candle } from '../data/types'
import type { Signal, SignalSide } from './signalTypes'
import { findPivots, type Pivot } from './structure'
import { rsi, macd, obv, closes } from './indicators'

type DivSpec = {
  id: string
  kind: 'momentum' | 'volume'
  series: number[]
  seriesName: string
  pivotKind: 'high' | 'low'
  /** 가격 방향과 지표 방향 조합 */
  priceUp: boolean
  indicatorUp: boolean
  side: SignalSide
}

export function detectDivergence(cs: Candle[]): Signal[] {
  if (cs.length < 30) return []
  const cl = closes(cs)
  const r = rsi(cl, 14)
  const m = macd(cl).hist
  const o = obv(cs)
  const pivots = findPivots(cs, 2)

  const specs: DivSpec[] = [
    { id: 'rsi_bull_div',   kind: 'momentum', series: r, seriesName: 'RSI',  pivotKind: 'low',  priceUp: false, indicatorUp: true,  side: 'bullish' },
    { id: 'rsi_bear_div',   kind: 'momentum', series: r, seriesName: 'RSI',  pivotKind: 'high', priceUp: true,  indicatorUp: false, side: 'bearish' },
    { id: 'rsi_hidden_div', kind: 'momentum', series: r, seriesName: 'RSI',  pivotKind: 'low',  priceUp: true,  indicatorUp: false, side: 'bullish' },
    { id: 'macd_divergence', kind: 'momentum', series: m, seriesName: 'MACD 히스토그램', pivotKind: 'low', priceUp: false, indicatorUp: true, side: 'bullish' },
    { id: 'obv_divergence',  kind: 'volume',   series: o, seriesName: 'OBV', pivotKind: 'low',  priceUp: false, indicatorUp: true,  side: 'bullish' },
  ]

  const out: Signal[] = []
  for (const spec of specs) {
    const ps = pivots.filter((p) => p.kind === spec.pivotKind)
    for (let k = 1; k < ps.length; k++) {
      const p0 = ps[k - 1]
      const p1 = ps[k]
      if (p1.pivotBar - p0.pivotBar < 5 || p1.pivotBar - p0.pivotBar > 60) continue

      const v0 = spec.series[p0.pivotBar]
      const v1 = spec.series[p1.pivotBar]
      if (Number.isNaN(v0) || Number.isNaN(v1)) continue

      const priceMoved = spec.priceUp ? p1.price > p0.price : p1.price < p0.price
      const indMoved = spec.indicatorUp ? v1 > v0 : v1 < v0
      if (!priceMoved || !indMoved) continue

      out.push({
        id: spec.id, tier: 4, kind: spec.kind, side: spec.side,
        barIndex: p1.barIndex, confidence: 'A', strength: 2,
        evidence: `가격 ${spec.pivotKind === 'low' ? '저점' : '고점'} ${p0.price.toFixed(2)}→${p1.price.toFixed(2)}, ${spec.seriesName} ${v0.toFixed(1)}→${v1.toFixed(1)}`,
        refs: { fromBar: p0.pivotBar, toBar: p1.pivotBar, priceLow: Math.min(p0.price, p1.price), priceHigh: Math.max(p0.price, p1.price) },
      })
    }
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/analysis/divergence.test.ts`
Expected: PASS — 3 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/analysis/divergence.ts src/analysis/divergence.test.ts
git commit -m "feat(analysis): RSI/MACD/OBV 다이버전스 감지"
```

---

### Task 11: 지표 기반 신호

**Files:**
- Create: `src/analysis/indicatorSignals.ts`
- Test: `src/analysis/indicatorSignals.test.ts`

**Interfaces:**
- Consumes: 모든 지표 함수 (Task 4)
- Produces: `detectIndicatorSignals(cs: Candle[]): Signal[]`

**신호 명세** (모두 `confidence: 'A'`)

| id | tier | kind | 조건 (인덱스 i) | side |
|---|---|---|---|---|
| `rsi_overbought` | 4 | momentum | `rsi[i] >= 70` 이고 `rsi[i-1] < 70` | bearish |
| `rsi_oversold` | 4 | momentum | `rsi[i] <= 30` 이고 `rsi[i-1] > 30` | bullish |
| `rsi_50_break` | 4 | momentum | `rsi[i]`가 50을 상향/하향 교차 | 방향에 따름 |
| `macd_golden` | 4 | momentum | `macd[i] > signal[i]` 이고 `macd[i-1] <= signal[i-1]` | bullish |
| `macd_dead` | 4 | momentum | `macd[i] < signal[i]` 이고 `macd[i-1] >= signal[i-1]` | bearish |
| `macd_zero_break` | 4 | momentum | `macd[i]`가 0을 교차 | 방향에 따름 |
| `ma_golden_cross` | 4 | ma | `ema20[i] > ema50[i]` 이고 `ema20[i-1] <= ema50[i-1]` | bullish |
| `ma_dead_cross` | 4 | ma | `ema20[i] < ema50[i]` 이고 `ema20[i-1] >= ema50[i-1]` | bearish |
| `ma_aligned_bull` | 4 | ma | `ema20 > ema50 > ema200` | bullish |
| `ma_aligned_bear` | 4 | ma | `ema20 < ema50 < ema200` | bearish |
| `bb_squeeze` | 3 | volatility | 밴드폭 `(upper-lower)/mid` 이 직전 60봉 최저 | neutral |
| `bb_break_upper` | 3 | volatility | `close[i] > upper[i]` 이고 `close[i-1] <= upper[i-1]` | bullish |
| `bb_break_lower` | 3 | volatility | `close[i] < lower[i]` 이고 `close[i-1] >= lower[i-1]` | bearish |
| `vol_breakout_confirm` | 2 | volume | `volume[i] >= 2×volumeSMA20[i]` 이고 `body ≥ 0.6×range` | 봉 방향 |
| `vol_breakout_weak` | 2 | volume | `range[i] ≥ 1.5×ATR` 이고 `volume[i] < volumeSMA20[i]` | neutral |
| `vol_climax` | 2 | volume | `volume[i] >= 3×volumeSMA20[i]` | 봉 방향 |

- [ ] **Step 1: 실패하는 테스트 작성**

`src/analysis/indicatorSignals.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectIndicatorSignals } from './indicatorSignals'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'
import type { Candle } from '../data/types'

describe('detectIndicatorSignals', () => {
  it('연속 상승 후 RSI 과매수 진입을 잡는다', () => {
    const cs: Candle[] = []
    for (let i = 0; i < 20; i++) cs.push(mk(100, 101, 99, 100, 100, i))
    for (let i = 20; i < 45; i++) cs.push(mk(100 + i, 102 + i, 99 + i, 101 + i, 100, i))
    expect(detectIndicatorSignals(cs).some((s) => s.id === 'rsi_overbought')).toBe(true)
  })

  it('거래량이 20봉 평균의 2배 이상이면 돌파 확인 신호를 낸다', () => {
    const cs: Candle[] = []
    for (let i = 0; i < 30; i++) cs.push(mk(100, 101, 99, 100, 100, i))
    cs.push(mk(100, 106, 99.5, 105.5, 500, 30))
    const s = detectIndicatorSignals(cs).find((x) => x.id === 'vol_breakout_confirm')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(30)
  })

  it('큰 몸통인데 거래량이 평균 미만이면 가짜 돌파 신호를 낸다', () => {
    const cs: Candle[] = []
    for (let i = 0; i < 30; i++) cs.push(mk(100, 103, 97, 100, 300, i))
    cs.push(mk(100, 112, 99, 111, 50, 30))
    expect(detectIndicatorSignals(cs).some((x) => x.id === 'vol_breakout_weak')).toBe(true)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectIndicatorSignals, synthCandles(220))
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/analysis/indicatorSignals.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`src/analysis/indicatorSignals.ts`:

```ts
import type { Candle } from '../data/types'
import type { Signal, SignalSide, Tier, SignalKind } from './signalTypes'
import { rsi, macd, bollinger, atr, ema, sma, closes, volumes } from './indicators'

const crossUp = (a: number[], b: number[], i: number) =>
  i > 0 && !Number.isNaN(a[i - 1]) && !Number.isNaN(b[i - 1]) && a[i - 1] <= b[i - 1] && a[i] > b[i]
const crossDown = (a: number[], b: number[], i: number) =>
  i > 0 && !Number.isNaN(a[i - 1]) && !Number.isNaN(b[i - 1]) && a[i - 1] >= b[i - 1] && a[i] < b[i]

export function detectIndicatorSignals(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  if (cs.length < 30) return out

  const cl = closes(cs)
  const vol = volumes(cs)
  const r = rsi(cl, 14)
  const { macd: mLine, signal: mSig } = macd(cl)
  const bb = bollinger(cl, 20, 2)
  const a = atr(cs, 14)
  const e20 = ema(cl, 20)
  const e50 = ema(cl, 50)
  const e200 = ema(cl, 200)
  const volMa = sma(vol, 20)
  const zero = new Array(cl.length).fill(0)
  const fifty = new Array(cl.length).fill(50)

  const push = (id: string, tier: Tier, kind: SignalKind, side: SignalSide, i: number, evidence: string, strength: 1 | 2 | 3 = 1) =>
    out.push({ id, tier, kind, side, barIndex: i, confidence: 'A', strength, evidence })

  for (let i = 1; i < cs.length; i++) {
    // RSI
    if (!Number.isNaN(r[i]) && !Number.isNaN(r[i - 1])) {
      if (r[i] >= 70 && r[i - 1] < 70) push('rsi_overbought', 4, 'momentum', 'bearish', i, `RSI ${r[i].toFixed(1)} — 70 상향 진입`, 2)
      if (r[i] <= 30 && r[i - 1] > 30) push('rsi_oversold', 4, 'momentum', 'bullish', i, `RSI ${r[i].toFixed(1)} — 30 하향 진입`, 2)
      if (crossUp(r, fifty, i)) push('rsi_50_break', 4, 'momentum', 'bullish', i, `RSI 50 상향 돌파 (${r[i].toFixed(1)})`)
      if (crossDown(r, fifty, i)) push('rsi_50_break', 4, 'momentum', 'bearish', i, `RSI 50 하향 이탈 (${r[i].toFixed(1)})`)
    }
    // MACD
    if (crossUp(mLine, mSig, i)) push('macd_golden', 4, 'momentum', 'bullish', i, `MACD ${mLine[i].toFixed(3)} 가 시그널 ${mSig[i].toFixed(3)} 상향 교차`, 2)
    if (crossDown(mLine, mSig, i)) push('macd_dead', 4, 'momentum', 'bearish', i, `MACD ${mLine[i].toFixed(3)} 가 시그널 ${mSig[i].toFixed(3)} 하향 교차`, 2)
    if (crossUp(mLine, zero, i)) push('macd_zero_break', 4, 'momentum', 'bullish', i, `MACD 기준선 상향 돌파`)
    if (crossDown(mLine, zero, i)) push('macd_zero_break', 4, 'momentum', 'bearish', i, `MACD 기준선 하향 이탈`)
    // 이동평균
    if (crossUp(e20, e50, i)) push('ma_golden_cross', 4, 'ma', 'bullish', i, `EMA20 이 EMA50 상향 교차 (${e20[i].toFixed(2)} / ${e50[i].toFixed(2)})`, 2)
    if (crossDown(e20, e50, i)) push('ma_dead_cross', 4, 'ma', 'bearish', i, `EMA20 이 EMA50 하향 교차 (${e20[i].toFixed(2)} / ${e50[i].toFixed(2)})`, 2)
    if (!Number.isNaN(e200[i])) {
      if (e20[i] > e50[i] && e50[i] > e200[i]) push('ma_aligned_bull', 4, 'ma', 'bullish', i, `EMA 20>50>200 정배열`)
      if (e20[i] < e50[i] && e50[i] < e200[i]) push('ma_aligned_bear', 4, 'ma', 'bearish', i, `EMA 20<50<200 역배열`)
    }
    // 볼린저
    if (!Number.isNaN(bb.upper[i]) && !Number.isNaN(bb.upper[i - 1])) {
      if (cl[i] > bb.upper[i] && cl[i - 1] <= bb.upper[i - 1]) push('bb_break_upper', 3, 'volatility', 'bullish', i, `종가 ${cl[i].toFixed(2)} 가 상단 ${bb.upper[i].toFixed(2)} 이탈`, 2)
      if (cl[i] < bb.lower[i] && cl[i - 1] >= bb.lower[i - 1]) push('bb_break_lower', 3, 'volatility', 'bearish', i, `종가 ${cl[i].toFixed(2)} 가 하단 ${bb.lower[i].toFixed(2)} 이탈`, 2)
      if (i >= 80) {
        const width = (bb.upper[i] - bb.lower[i]) / bb.mid[i]
        let minW = Infinity
        for (let j = i - 60; j < i; j++) {
          if (Number.isNaN(bb.upper[j])) continue
          minW = Math.min(minW, (bb.upper[j] - bb.lower[j]) / bb.mid[j])
        }
        if (width < minW) push('bb_squeeze', 3, 'volatility', 'neutral', i, `밴드폭 ${(width * 100).toFixed(2)}% — 최근 60봉 최저 (변동성 수축)`, 2)
      }
    }
    // 거래량
    if (!Number.isNaN(volMa[i]) && volMa[i] > 0) {
      const c = cs[i]
      const bodyRatio = c.high === c.low ? 0 : Math.abs(c.close - c.open) / (c.high - c.low)
      const dir: SignalSide = c.close > c.open ? 'bullish' : 'bearish'
      if (vol[i] >= 3 * volMa[i]) {
        push('vol_climax', 2, 'volume', dir, i, `거래량 ${(vol[i] / volMa[i]).toFixed(1)}배 폭증 — 클라이맥스`, 3)
      } else if (vol[i] >= 2 * volMa[i] && bodyRatio >= 0.6) {
        push('vol_breakout_confirm', 2, 'volume', dir, i, `거래량 20봉 평균의 ${(vol[i] / volMa[i]).toFixed(1)}배 + 몸통 비중 ${(bodyRatio * 100).toFixed(0)}%`, 3)
      }
      if (!Number.isNaN(a[i]) && c.high - c.low >= 1.5 * a[i] && vol[i] < volMa[i]) {
        push('vol_breakout_weak', 2, 'volume', 'neutral', i, `레인지는 ${((c.high - c.low) / a[i]).toFixed(1)}ATR 인데 거래량은 평균의 ${(vol[i] / volMa[i]).toFixed(1)}배 — 가짜 돌파 의심`, 3)
      }
    }
  }
  return out
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/analysis/indicatorSignals.test.ts`
Expected: PASS — 4 tests passed

- [ ] **Step 5: 커밋**

```bash
git add src/analysis/indicatorSignals.ts src/analysis/indicatorSignals.test.ts
git commit -m "feat(analysis): 지표 기반 신호 (RSI/MACD/MA/BB/거래량)"
```

---

### Task 12: 신호 통합기

**Files:**
- Create: `src/analysis/signals.ts`
- Test: `src/analysis/signals.test.ts`

**Interfaces:**
- Consumes: Task 6~11의 모든 감지 함수
- Produces:
  - `detectAll(cs: Candle[]): Signal[]` — 전 감지기 통합, `barIndex` 오름차순 정렬
  - `detectSignals(cs: Candle[], atIndex: number): Signal[]` — `cs.slice(0, atIndex+1)` 에 대해 `detectAll` 실행

- [ ] **Step 1: 실패하는 테스트 작성**

`src/analysis/signals.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectAll, detectSignals } from './signals'
import { assertNoLookAhead } from './testing'
import { synthCandles } from './fixtures'

describe('detectAll', () => {
  const candles = synthCandles(300)

  it('barIndex 오름차순으로 정렬되어 나온다', () => {
    const sigs = detectAll(candles)
    const sorted = [...sigs].sort((a, b) => a.barIndex - b.barIndex)
    expect(sigs.map((s) => s.barIndex)).toEqual(sorted.map((s) => s.barIndex))
  })

  it('어떤 신호도 미래 봉을 가리키지 않는다', () => {
    expect(detectAll(candles).every((s) => s.barIndex < candles.length)).toBe(true)
  })

  it('통합 감지기 전체가 look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectAll, candles)
  })
})

describe('detectSignals', () => {
  it('atIndex 이후 봉은 절대 사용하지 않는다', () => {
    const candles = synthCandles(300)
    const at = 180
    const partial = detectSignals(candles, at)
    expect(partial.every((s) => s.barIndex <= at)).toBe(true)
    // 뒤쪽 봉을 완전히 바꿔도 결과가 같아야 한다
    const tampered = [...candles.slice(0, at + 1), ...synthCandles(119, 999)]
    expect(detectSignals(tampered, at)).toEqual(partial)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/analysis/signals.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 구현**

`src/analysis/signals.ts`:

```ts
import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { detectTrend } from './structure'
import { detectFVG, detectOrderBlocks, detectLiquiditySweep, detectMSB } from './smc'
import { detectCandlePatterns } from './candlePatterns'
import { detectDivergence } from './divergence'
import { detectIndicatorSignals } from './indicatorSignals'

const DETECTORS = [
  detectTrend,
  detectFVG,
  detectOrderBlocks,
  detectLiquiditySweep,
  detectMSB,
  detectCandlePatterns,
  detectDivergence,
  detectIndicatorSignals,
]

/** 주어진 캔들 배열 전체에 대해 모든 감지기를 돌린다 */
export function detectAll(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  for (const d of DETECTORS) out.push(...d(cs))
  return out.sort((a, b) => a.barIndex - b.barIndex || a.id.localeCompare(b.id))
}

/** atIndex 시점에 관측 가능한 신호만 낸다 */
export function detectSignals(cs: Candle[], atIndex: number): Signal[] {
  return detectAll(cs.slice(0, atIndex + 1))
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/analysis/signals.test.ts`
Expected: PASS — 4 tests passed. 특히 `assertNoLookAhead(detectAll, ...)` 통과는 **감지 계층 전체가 무결하다는 증거**다.

- [ ] **Step 5: 전체 테스트 실행**

Run: `npm test`
Expected: PASS — 모든 테스트 통과

- [ ] **Step 6: 커밋**

```bash
git add src/analysis/signals.ts src/analysis/signals.test.ts
git commit -m "feat(analysis): 신호 통합기 + 전체 look-ahead 무결성 검증"
```

---

## Task 13: 감지 경로 테스트 보강 (Task 12 완료 후)

실행 중 리뷰에서 **미검증 경로 갭이 체계적 수준**으로 드러났다. 이 계획이 태스크마다
"대표 케이스 1~2개"만 테스트로 명세한 결과, 구현은 맞는데 회귀를 잡을 그물이 없는
경로가 4개 태스크에 걸쳐 13개 이상 쌓였다. 그리고 그 갭 안에서 실제 버그가 하나 나왔다
(`candle_tweezer` 의 `else if` 가 하락 분기를 도달불가로 만든 건, 전용 테스트가 없어서 통과).

이론적 위험이 아니라는 것이 증명되었으므로 전용 태스크로 메운다.

| 출처 | 보강 대상 | 비고 |
|---|---|---|
| Task 4 | RSI Wilder 재귀 | 기존 테스트는 `avgLoss===0` / `avgGain===0` 축퇴 분기만 탄다. 혼합 등락 데이터 + 손계산 기대값 `toBeCloseTo(x, 2)` |
| Task 7 | `fvg_bear`, `ob_bear_resistance` | 하락 분기는 `lo`/`hi` 배정과 임펄스 기준 산술이 상승과 독립 |
| Task 8 | `liq_sweep_high`, `msb_bear` | look-ahead 제네릭만 통과 중, 의미 검증 없음 |
| Task 9 | `candle_inv_hammer` · `candle_doji` · `candle_long_wick` · `candle_bull_harami` · `candle_bear_harami` · `candle_evening_star` · `candle_three_crows` · `candle_tri_star` | 16종 중 8종 (tweezer는 수정 시 함께 테스트됨) |

각 테스트는 **양성 케이스와 음성 케이스를 모두** 포함한다 — 패턴이 발화하는 캔들과,
조건을 아슬아슬하게 못 채워 발화하지 않아야 하는 캔들. 양성만 있으면 조건을 느슨하게
바꿔도 통과하므로 회귀 그물이 되지 못한다.

기대값은 구현을 돌려 얻지 말고 규칙표에서 직접 유도한다. 구현 출력을 기대값으로 복사하면
버그를 정답으로 고정시키게 된다.

## Part 2 예정 태스크 (별도 계획 문서)

감지 계층(Task 1~12)이 완성되고 `npm test` 가 전부 통과한 뒤,
`docs/superpowers/plans/` 에 Part 2 계획을 작성해서 진행한다.
아래는 그 계획의 골격이며, 실제 코드와 테스트는 Part 2 문서에서 작성한다.

| # | 태스크 | 산출물 |
|---|---|---|
| 13 | `quiz/taxonomy.ts` | 태그 정의 (id·라벨·tier·confidence·카테고리) |
| 14 | `quiz/scanner.ts` | `setupScore` 계산과 후보 선별 |
| 15 | `quiz/generator.ts` | 문제 생성 (유형 60/20/20 배분, 난이도) |
| 16 | `quiz/replay.ts` | 체결 시뮬레이션 (SL 우선 규칙) |
| 17 | `quiz/grader.ts` 방향축 | 1.5 ATR 기준 정답 방향 판정 |
| 18 | `quiz/grader.ts` 실행축 | 손절 타당성·R:R·PnL |
| 19 | `quiz/grader.ts` 근거축 | 신뢰도 등급별 감점 차등 |
| 20 | `store/session.ts` | zustand 세션 상태 |
| 21 | `store/history.ts` | IndexedDB 이력 저장 |
| 22 | `ui/ChartPane.tsx` | v5 캔들 렌더 + 마스킹 |
| 23 | `ui/ChartPane.tsx` 드래그 | `coordinateToPrice` 기반 가격라인 드래그 |
| 24 | `ui/TradePanel.tsx` | 방향·가격 입력 |
| 25 | `ui/TagPanel.tsx` | 아코디언 + 검색 + 15개 제한 |
| 26 | `ui/ResultPanel.tsx` | 채점 결과 + 차트 오버레이 |
| 27 | `App.tsx` | 전체 조립 |
| 28 | 수동 E2E | 실제 Binance 데이터로 문제 1개 완주 |
