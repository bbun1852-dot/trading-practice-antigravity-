import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { atr } from './indicators'
import { findPivots, type Pivot } from './structure'
import { fmtPrice } from '../format'

/**
 * Part 5 — 추세선과 채널. **기하 작도 계열의 첫 기계다.**
 *
 * 차트패턴 16종(쐐기·삼각수렴·플래그·이중천정)이 전부 이 위에 세워지므로, 작은
 * 소비자 5종으로 먼저 검증한다.
 *
 * **전부 B등급이다.** 추세선은 작도 기준에 따라 답이 달라진다 — 어느 피벗을 잇느냐,
 * 꼬리를 쓰느냐 종가를 쓰느냐에 따라 선이 움직이고 사람마다 다르게 긋는다. 엔진이 그은
 * 선과 사용자가 그은 선이 다를 수 있으므로 헛다리 감점을 절반만 받는다(스펙 6.7).
 * 등급은 taxonomy 가 들고 있고 여기서는 confidence 필드로 내보낸다.
 *
 * **인과성은 선 긋기에 달려 있다.** "전체에서 가장 잘 맞는 선" 같은 전역 최적화는
 * 뒤에 봉이 붙을 때마다 선이 움직여 이미 지나간 봉의 evidence 를 바꾼다. 확정 피벗
 * 두 개로만 정하면 이후 봉이 무엇이든 값이 변하지 않는다.
 */

/** 선에 닿았다고 볼 허용오차 (ATR 배수) */
export const TOUCH_TOL_ATR = 0.3
/** 두 피벗이 이보다 가까우면 선으로 보지 않는다 — 기울기가 과장된다 */
export const MIN_PIVOT_GAP = 5
/** 두 피벗이 이보다 멀면 그 선은 낡았다 */
export const MAX_PIVOT_GAP = 120
/** 채널로 볼 두 기울기의 상대 오차 */
export const CHANNEL_SLOPE_TOL = 0.35

type Line = {
  p1: Pivot
  p2: Pivot
  slope: number
  /** 그 봉에서 선의 값 */
  at: (x: number) => number
}

function makeLine(p1: Pivot, p2: Pivot): Line {
  const span = p2.pivotBar - p1.pivotBar
  const slope = (p2.price - p1.price) / span
  return { p1, p2, slope, at: (x) => p1.price + slope * (x - p1.pivotBar) }
}

/**
 * i 시점에 확정된 저점(또는 고점) 피벗 뒤 두 개로 선을 만든다.
 *
 * **기울기 부호를 여기서 강제하지 않는다.** 처음엔 지지선에 상승, 저항선에 하락을
 * 요구했는데 그러면 두 선이 반드시 수렴해 채널이 **원리적으로 성립할 수 없었다**
 * (실측: 채널 2종이 한 번도 발화하지 않았다). 그건 채널이 아니라 삼각수렴이다.
 * 부호 요구는 추세선 태그의 조건이지 선 자체의 성질이 아니므로 호출부로 옮겼다.
 */
function lineAt(cs: Candle[], pivots: Pivot[], i: number, kind: 'low' | 'high'): Line | undefined {
  const conf = pivots.filter((p) => p.kind === kind && p.barIndex <= i)
  if (conf.length < 2) return undefined

  const p2 = conf[conf.length - 1]
  const p1 = conf[conf.length - 2]
  const gap = p2.pivotBar - p1.pivotBar
  if (gap < MIN_PIVOT_GAP || gap > MAX_PIVOT_GAP) return undefined

  const line = makeLine(p1, p2)

  // 두 피벗 사이에서 이미 뚫린 선은 무효다 — 그런 선은 시장이 존중하지 않았다.
  // 판정 방향은 선의 종류가 정하지 기울기가 정하지 않는다.
  for (let j = p1.pivotBar + 1; j < p2.pivotBar; j++) {
    const v = line.at(j)
    if (kind === 'low' ? cs[j].close < v : cs[j].close > v) return undefined
  }
  return line
}

export function detectTrendline(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  if (cs.length === 0) return out

  const a = atr(cs, 14)
  const pivots = findPivots(cs, 2)

  /** 선 하나당 사건은 한 번. 키는 확정 피벗 두 개라 인과적이다 */
  const fired = new Set<string>()
  /** 이탈한 선은 죽는다 — 다시 짚지 않는다 */
  const broken = new Set<string>()

  const key = (l: Line, what: string) => `${l.p1.pivotBar}|${l.p2.pivotBar}|${what}`

  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    const tol = TOUCH_TOL_ATR * (a[i] || 0)
    if (!(tol > 0)) continue

    const sup = lineAt(cs, pivots, i, 'low')
    const res = lineAt(cs, pivots, i, 'high')

    const supV = sup && i > sup.p2.pivotBar ? sup.at(i) : undefined
    const resV = res && i > res.p2.pivotBar ? res.at(i) : undefined

    // ── 채널 ──────────────────────────────────────────────────────────────
    // 두 선이 다 살아 있고 기울기가 비슷하면 채널이다. 평행하지 않으면 수렴/발산이고
    // 그건 쐐기·삼각이라 이번 범위가 아니다.
    let inChannel = false
    if (sup && res && supV !== undefined && resV !== undefined && resV > supV) {
      const denom = Math.max(Math.abs(sup.slope), Math.abs(res.slope))
      // 같은 방향으로 기울어야 채널이다. 부호가 반대면 수렴(삼각·쐐기)이라
      // 이번 범위가 아니다.
      const sameDirection = sup.slope * res.slope > 0
      if (sameDirection && denom > 0 && Math.abs(sup.slope - res.slope) / denom <= CHANNEL_SLOPE_TOL) {
        inChannel = true
        const ck = `${sup.p1.pivotBar}|${sup.p2.pivotBar}|${res.p1.pivotBar}|${res.p2.pivotBar}`
        if (c.high >= resV - tol && !fired.has(`${ck}|up`)) {
          fired.add(`${ck}|up`)
          out.push({
            id: 'channel_upper', tier: 3, kind: 'pattern', side: 'bearish',
            barIndex: i, confidence: 'B', strength: 2,
            evidence: `채널 상단 ${fmtPrice(resV)} 도달 (하단 ${fmtPrice(supV)})`,
            refs: { price: resV, priceLow: supV, priceHigh: resV, fromBar: res.p1.pivotBar, toBar: i },
          })
        } else if (c.low <= supV + tol && !fired.has(`${ck}|dn`)) {
          fired.add(`${ck}|dn`)
          out.push({
            id: 'channel_lower', tier: 3, kind: 'pattern', side: 'bullish',
            barIndex: i, confidence: 'B', strength: 2,
            evidence: `채널 하단 ${fmtPrice(supV)} 도달 (상단 ${fmtPrice(resV)})`,
            refs: { price: supV, priceLow: supV, priceHigh: resV, fromBar: sup.p1.pivotBar, toBar: i },
          })
        }
      }
    }

    // **채널이 성립한 봉에서는 추세선을 따로 내지 않는다.** 채널 상단은 곧 저항선이라
    // 둘 다 내면 같은 사건을 두 번 세는 것이다 (Part 4 의 choch/msb_* 가 98% 겹친
    // 것과 같은 실수).
    if (inChannel) continue

    // ── 지지선 ────────────────────────────────────────────────────────────
    // 여기서 기울기 부호를 요구한다. 수평선은 Part 4 의 sr_flip 이 이미 다루므로
    // 중복해 내지 않는다.
    if (sup && supV !== undefined && sup.slope > 0) {
      const bk = key(sup, 'break')
      if (!broken.has(bk)) {
        if (c.close < supV - tol) {
          broken.add(bk)
          out.push({
            id: 'trendline_break', tier: 3, kind: 'pattern', side: 'bearish',
            barIndex: i, confidence: 'B', strength: 3,
            evidence: `종가 ${fmtPrice(c.close)} 가 상승 추세선 ${fmtPrice(supV)} 이탈`,
            refs: { price: supV, fromBar: sup.p1.pivotBar, toBar: i },
          })
        } else if (c.low <= supV + tol && c.close > supV) {
          const tk = key(sup, 'touch')
          if (!fired.has(tk)) {
            fired.add(tk)
            out.push({
              id: 'trendline_support', tier: 3, kind: 'pattern', side: 'bullish',
              barIndex: i, confidence: 'B', strength: 2,
              evidence: `저가 ${fmtPrice(c.low)} 가 상승 추세선 ${fmtPrice(supV)} 을 딛고 마감`,
              refs: { price: supV, fromBar: sup.p1.pivotBar, toBar: i },
            })
          }
        }
      }
    }

    // ── 저항선 ────────────────────────────────────────────────────────────
    if (res && resV !== undefined && res.slope < 0) {
      const bk = key(res, 'break')
      if (!broken.has(bk)) {
        if (c.close > resV + tol) {
          broken.add(bk)
          out.push({
            id: 'trendline_break', tier: 3, kind: 'pattern', side: 'bullish',
            barIndex: i, confidence: 'B', strength: 3,
            evidence: `종가 ${fmtPrice(c.close)} 가 하락 추세선 ${fmtPrice(resV)} 돌파`,
            refs: { price: resV, fromBar: res.p1.pivotBar, toBar: i },
          })
        } else if (c.high >= resV - tol && c.close < resV) {
          const tk = key(res, 'touch')
          if (!fired.has(tk)) {
            fired.add(tk)
            out.push({
              id: 'trendline_resistance', tier: 3, kind: 'pattern', side: 'bearish',
              barIndex: i, confidence: 'B', strength: 2,
              evidence: `고가 ${fmtPrice(c.high)} 가 하락 추세선 ${fmtPrice(resV)} 에 막히고 마감`,
              refs: { price: resV, fromBar: res.p1.pivotBar, toBar: i },
            })
          }
        }
      }
    }
  }

  return out.sort((x, y) => x.barIndex - y.barIndex || x.id.localeCompare(y.id))
}
