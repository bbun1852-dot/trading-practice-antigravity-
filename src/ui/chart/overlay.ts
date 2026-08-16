/**
 * 신호 → 도형 매핑 (스펙 §6). **순수 함수다** — 차트도 캔버스도 모른다.
 *
 * 감지기가 남긴 `refs` 의 모양만 보고 어떤 도형인지 정한다. 태그 목록을 여기에
 * 베껴 두면 감지기가 늘 때마다 두 곳을 고쳐야 하고, 언젠가 어긋난다.
 *
 *   1. 추세선·채널  → line   (기울기가 있는 유일한 종류라 id 로 가른다, 아래 참고)
 *   2. priceHigh+priceLow → box     (오더블록·FVG·매물대·다이버전스 구간)
 *   3. price              → level   (스윕·피보·SR·넥라인)
 *   4. 가격 참조 없음      → marker  (캔들 패턴처럼 refs 가 아예 없는 신호)
 *
 * **사선의 두 번째 가격은 refs 에 없다.** 감지기는 "지금 봉에서 선의 값"(price)과
 * 시작 피벗 봉(fromBar)만 남긴다. 그래서 시작점 가격은 그 피벗 봉의 극값으로
 * 복원한다 — 추세선의 앵커는 피벗이므로 저항선이면 고가, 지지선이면 저가가 정확히
 * 그 점이다. 근사가 아니라 앵커의 정의를 되짚는 것이고, 어긋나면 선이 봉에서
 * 떠 보이므로 눈으로 바로 잡힌다.
 *
 * 지지/저항을 "선의 값과 종가 중 어느 쪽이 위냐" 로 가르는 건 틀린다 — **돌파
 * 신호는 정의상 반대편에 있다.** 실데이터로 잡았다(SEIUSDT 1d `trendline_break`:
 * 저항선을 위로 뚫었는데 종가가 선 위라 지지선으로 오판, 앵커가 고점 대신 저점으로
 * 갔다). 그래서 감지기 의미를 그대로 표로 적는다.
 *
 * 봉 인덱스는 창 밖을 가리킬 수 있다 (예: chartPatterns 의 `fromBar: startBar - 10`).
 * 여기서 창 안으로 자른다 — 차트에 없는 봉은 시각이 없어 좌표로 바뀌지 않는다.
 */
import type { Candle } from '../../data/types'
import type { Signal, SignalSide } from '../../analysis/signalTypes'

export type OverlayShape =
  | { kind: 'box'; id: string; side: SignalSide; fromBar: number; toBar: number; priceHigh: number; priceLow: number }
  | { kind: 'level'; id: string; side: SignalSide; fromBar: number; toBar: number; price: number }
  | { kind: 'line'; id: string; side: SignalSide; fromBar: number; fromPrice: number; toBar: number; toPrice: number }
  | { kind: 'marker'; id: string; side: SignalSide; bar: number; price: number }

/**
 * 기울기를 가진 신호와 그 선의 앵커가 어느 극값인지. 나머지 신호는 전부 수평이거나 점이다.
 * `break` 는 방향이 정한다 — 강세 돌파는 저항선을 위로 뚫은 것이므로 앵커가 고점이다.
 */
const SLOPED_ANCHOR: Record<string, 'high' | 'low' | 'break'> = {
  trendline_support: 'low',
  trendline_resistance: 'high',
  channel_lower: 'low',
  channel_upper: 'high',
  trendline_break: 'break',
}

const clampBar = (bar: number, n: number) => Math.max(0, Math.min(n - 1, bar))

export function shapeFor(s: Signal, candles: readonly Candle[]): OverlayShape | null {
  if (candles.length === 0) return null
  const n = candles.length
  const r = s.refs
  const at = clampBar(s.refs?.pivotBar ?? s.barIndex, n)
  const from = clampBar(r?.fromBar ?? r?.pivotBar ?? s.barIndex, n)
  const to = clampBar(r?.toBar ?? s.barIndex, n)

  const anchor = SLOPED_ANCHOR[s.id]
  if (r?.price !== undefined && anchor !== undefined) {
    const extreme = anchor === 'break' ? (s.side === 'bullish' ? 'high' : 'low') : anchor
    const fromPrice = extreme === 'high' ? candles[from].high : candles[from].low
    return { kind: 'line', id: s.id, side: s.side, fromBar: from, fromPrice, toBar: to, toPrice: r.price }
  }

  if (r?.priceHigh !== undefined && r.priceLow !== undefined) {
    return {
      kind: 'box', id: s.id, side: s.side,
      fromBar: from, toBar: to, priceHigh: r.priceHigh, priceLow: r.priceLow,
    }
  }

  if (r?.price !== undefined) {
    return { kind: 'level', id: s.id, side: s.side, fromBar: from, toBar: to, price: r.price }
  }

  // 가격 참조가 없는 신호(캔들 패턴 등)는 그 봉을 가리킨다. 표시는 방향 쪽 극값에 붙인다 —
  // 강세 신호는 저가 아래, 약세 신호는 고가 위가 차트 관행이다.
  const price = s.side === 'bearish' ? candles[at].high : candles[at].low
  return { kind: 'marker', id: s.id, side: s.side, bar: at, price }
}

export function toShapes(signals: readonly Signal[], candles: readonly Candle[]): OverlayShape[] {
  const out: OverlayShape[] = []
  for (const s of signals) {
    const shape = shapeFor(s, candles)
    if (shape) out.push(shape)
  }
  return out
}
