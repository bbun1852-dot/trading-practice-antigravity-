import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { atr } from './indicators'
import { findPivots } from './structure'
import { detectFVG, detectOrderBlocks } from './smc'
import { fmtPrice } from '../format'

/**
 * Part 4 — SMC 계열의 남은 A등급 3종.
 *
 * Part 1 의 `smc.ts` 를 건드리지 않고 그 출력을 소비한다. `detectFVG` / `detectOrderBlocks`
 * 를 내부에서 부르는데, 둘 다 인과적이고 비용도 각각 0.2ms / 0.8ms 로 무해하다
 * (Part 3 에서 실측했다).
 *
 * **`detectFVG` 는 전체 배열에서 끝내 메워지지 않은 FVG 만 낸다.** 잘린 실행은 더 많은
 * FVG 를 보므로 이 감지기의 출력도 잘린 쪽이 더 많다 — `assertNoLookAhead` 가 허용하는
 * 방향이라 안전하다(전체 ⊆ 잘린). 반대 방향이었다면 위반이다.
 */

/** 등고점/등저점으로 볼 허용오차 (ATR 배수) */
export const POOL_TOL_ATR = 0.25
/**
 * FVG 로 접근 중이라고 볼 최대 거리 (ATR 배수).
 *
 * 1.5 로 두니 1000봉당 2~10회로 하한(5)을 밑돌았다 — 갭이 사거리에 들어오는 순간
 * 종가가 마침 그쪽으로 움직인 봉이어야 해서 조건이 두 겹으로 좁았다. 자석 효과는
 * 그보다 먼 거리에서도 성립하므로 사거리를 넓힌다.
 */
export const REBALANCE_NEAR_ATR = 3
/** 이보다 오래된 FVG 는 자석으로 보지 않는다 */
export const REBALANCE_MAX_AGE = 50

/** 두 봉의 몸통 구간 */
const bodyLo = (c: Candle) => Math.min(c.open, c.close)
const bodyHi = (c: Candle) => Math.max(c.open, c.close)

export function detectSmcExtras(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  if (cs.length === 0) return out

  const a = atr(cs, 14)
  const pivots = findPivots(cs, 2)

  // ── ob_double_engulfing ───────────────────────────────────────────────────
  // 오더블록 봉이 직전 **2봉의 몸통을 모두** 삼켰다면 단일 장악보다 강한 수급 흔적이다.
  // 오더블록 자체를 다시 찾지 않고 detectOrderBlocks 의 판정을 그대로 받는다 —
  // 같은 자리를 두 규칙으로 판정하면 둘이 어긋날 때 조용히 갈린다.
  for (const ob of detectOrderBlocks(cs)) {
    const p = ob.refs?.pivotBar
    if (p === undefined || p < 2) continue
    const c = cs[p]
    const a1 = cs[p - 1]
    const a2 = cs[p - 2]
    const lo = Math.min(bodyLo(a1), bodyLo(a2))
    const hi = Math.max(bodyHi(a1), bodyHi(a2))
    // 몸통 대 몸통으로 재면 1000봉당 4~12회로 하한(5)을 밑돌았다. 장악의 통상적
    // 판정은 **삼킨 봉의 전 범위**가 앞 몸통들을 덮었는가이므로 레인지로 잰다 —
    // 조건을 바꾼 것이 아니라 원래 뜻에 맞춘 것이다.
    if (c.low > lo || c.high < hi) continue
    out.push({
      id: 'ob_double_engulfing', tier: 1, kind: 'smc', side: ob.side,
      barIndex: ob.barIndex, confidence: 'A', strength: 3,
      evidence: `오더블록 봉이 직전 2봉 몸통(${fmtPrice(lo)}~${fmtPrice(hi)})을 모두 장악`,
      refs: { ...ob.refs },
    })
  }

  // ── liq_pool_untapped ────────────────────────────────────────────────────
  // 같은 가격에 피벗이 겹치면(등고점/등저점) 그 너머에 손절이 쌓인다. 아직 그쪽으로
  // 거래되지 않았다면 미체결 유동성이고, 가격은 그것을 노리고 움직인다.
  const poolFired = new Set<string>()
  // 한 봉이 등고점 풀과 등저점 풀을 동시에 확정시킬 수 있다(그 봉이 스윙하이와
  // 스윙로우를 함께 확정하는 경우). 봉당 하나만 내되 **현재가에 가까운 쪽**을
  // 대표로 삼는다 — 가까운 유동성이 먼저 노려지기 때문이다.
  const pools: Array<{ dist: number; sig: Signal }> = []
  for (const kind of ['high', 'low'] as const) {
    const ps = pivots.filter((p) => p.kind === kind)
    for (let k = 1; k < ps.length; k++) {
      const p1 = ps[k - 1]
      const p2 = ps[k]
      const confirmedAt = p2.barIndex          // 둘 다 확정된 시점
      if (confirmedAt >= cs.length) continue
      const tol = POOL_TOL_ATR * (a[confirmedAt] || 0)
      if (!(tol > 0)) continue
      if (Math.abs(p1.price - p2.price) > tol) continue

      const level = (p1.price + p2.price) / 2
      const key = `${kind}|${p1.pivotBar}|${p2.pivotBar}`
      if (poolFired.has(key)) continue

      // 확정 시점까지 그 너머로 거래된 적이 없어야 '미체결' 이다
      let tapped = false
      for (let j = p2.pivotBar + 1; j <= confirmedAt; j++) {
        if (kind === 'high' ? cs[j].high > level + tol : cs[j].low < level - tol) { tapped = true; break }
      }
      if (tapped) continue

      poolFired.add(key)
      pools.push({
        dist: Math.abs(level - cs[confirmedAt].close),
        sig: {
          id: 'liq_pool_untapped', tier: 1, kind: 'smc',
          // 미체결 유동성은 가격을 끌어당긴다 — 위에 쌓였으면 위로 간다
          side: kind === 'high' ? 'bullish' : 'bearish',
          barIndex: confirmedAt, confidence: 'A', strength: 3,
          evidence: `${kind === 'high' ? '등고점' : '등저점'} ${fmtPrice(p1.price)}·${fmtPrice(p2.price)} 에 미체결 유동성 — 아직 건드리지 않음`,
          refs: { price: level, fromBar: p1.pivotBar, toBar: p2.pivotBar },
        },
      })
    }
  }

  // 봉당 현재가에 가장 가까운 풀 하나. 동률이면 위쪽(bullish)이 이긴다 — 완전순서라
  // 입력 순서가 결과에 새지 않는다.
  const bestPool = new Map<number, { dist: number; sig: Signal }>()
  for (const p of pools) {
    const cur = bestPool.get(p.sig.barIndex)
    if (!cur || p.dist < cur.dist ||
        (p.dist === cur.dist && p.sig.side === 'bullish')) {
      bestPool.set(p.sig.barIndex, p)
    }
  }
  for (const p of bestPool.values()) out.push(p.sig)

  // ── fvg_rebalance ────────────────────────────────────────────────────────
  // 미충족 FVG 는 자석이다. 가격이 그쪽으로 방향을 잡고 사거리에 들어왔을 때가 사건이고,
  // 실제로 닿으면 리밸런스가 끝난 것이다 — 그래서 수명이 zone(touch) 다.
  const rebalanceFired = new Set<number>()
  // 서로 다른 갭이 같은 봉에서 동시에 자석이 될 수 있다. 봉당 하나만 내되 **가장 가까운
  // 갭**을 대표로 삼는다 — 쌍마다 내면 갭이 여럿인 구간에서 배점이 부풀려진다.
  const rebalance: Array<{ dist: number; sig: Signal }> = []
  for (const f of detectFVG(cs)) {
    const lo = f.refs?.priceLow
    const hi = f.refs?.priceHigh
    if (lo === undefined || hi === undefined) continue

    for (let i = f.barIndex + 1; i < cs.length && i - f.barIndex <= REBALANCE_MAX_AGE; i++) {
      if (rebalanceFired.has(f.barIndex)) break
      const near = REBALANCE_NEAR_ATR * (a[i] || 0)
      if (!(near > 0)) continue
      const c = cs[i]
      const prev = cs[i - 1]
      if (c.low <= hi && c.high >= lo) break        // 이미 닿았다 — 리밸런스 완료

      // **사거리에 들어온 것 자체가 사건이다.** 처음에는 "그 봉에서 종가가 갭 쪽으로
      // 움직였을 것" 까지 겹으로 요구했는데, 대상 갭이 애초에 적어서(detectFVG 는 끝내
      // 안 메워진 갭만 낸다) 1000봉당 2~10회로 하한을 밑돌았다. 자석은 다가가는 한 봉의
      // 방향이 아니라 거리가 정하므로, 조건을 원래 뜻으로 되돌린다.
      const below = c.close < lo
      const dist = below ? lo - c.close : c.close - hi
      if (dist > near) continue
      void prev

      rebalanceFired.add(f.barIndex)
      rebalance.push({
        dist: below ? lo - c.close : c.close - hi,
        sig: {
          id: 'fvg_rebalance', tier: 2, kind: 'smc',
          // 갭을 메우러 가는 방향이 곧 단기 방향이다
          side: below ? 'bullish' : 'bearish',
          barIndex: i, confidence: 'A', strength: 2,
          evidence: `미충족 FVG ${fmtPrice(lo)}~${fmtPrice(hi)} 로 접근 중 — 자석 효과`,
          refs: { priceLow: lo, priceHigh: hi, fromBar: f.barIndex, toBar: i },
        },
      })
      break
    }
  }

  // 봉당 가장 가까운 갭 하나. 동률이면 이른 갭이 이긴다(fromBar 오름차순) — 정렬 키가
  // 완전순서라 입력 순서가 결과에 새지 않는다.
  const bestPerBar = new Map<number, { dist: number; sig: Signal }>()
  for (const r of rebalance) {
    const cur = bestPerBar.get(r.sig.barIndex)
    if (!cur || r.dist < cur.dist ||
        (r.dist === cur.dist && r.sig.refs!.fromBar! < cur.sig.refs!.fromBar!)) {
      bestPerBar.set(r.sig.barIndex, r)
    }
  }
  for (const r of bestPerBar.values()) out.push(r.sig)

  return out.sort((x, y) => x.barIndex - y.barIndex || x.id.localeCompare(y.id))
}
