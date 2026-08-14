import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { atr } from './indicators'
import { findPivots, type Pivot } from './structure'
import { lastConfirmedPivot } from './smc'
import { fmtPrice } from '../format'

/**
 * Part 4 — 구조 계열의 남은 A등급 4종.
 *
 * **같은 사건을 두 번 세지 않는 것이 이 파일의 설계 과제다.** 네 태그가 전부 "레벨이
 * 깨지고 되돌아온다" 를 보므로, 레벨의 출처를 서로 다르게 둔다.
 *
 *   choch           — 확정 피벗. 추세와 **반대** 방향의 붕괴만 (msb_* 는 사건 자체)
 *   sr_flip         — srLevels (2회 이상 닿은 군집 레벨)
 *   retest_success  — 직전 구조 붕괴 레벨 (choch 가 쓴 것과 같은 피벗)
 *   retest_fail     — 위와 같음, 결과만 반대
 *
 * `msb_*` 와 `choch` 는 겹칠 수 있다. 둘 다 구조 붕괴를 보지만 전자는 사건 자체이고
 * 후자는 "그것이 추세를 거스르는가" 라는 맥락이다. 겹침이 과도하면 발화율 게이트가 잡는다.
 */

/** 되돌림을 기다리는 최대 봉 수 */
export const RETEST_WINDOW = 20
/** 레벨에 닿았다고 볼 허용오차 (ATR 배수) */
export const RETEST_TOL_ATR = 0.3
/** 같은 S/R 군집으로 볼 가격 허용오차 (structure.ts 의 srLevels 와 같은 값) */
export const SR_TOL_PCT = 0.005
/** 이만큼 닿아야 시장이 존중한 레벨로 본다 */
export const SR_MIN_TOUCHES = 2

/** i 시점까지 확정된 피벗으로 판정한 추세. detectTrend 와 같은 잣대다 */
function trendAt(pivots: Pivot[], i: number): 'up' | 'down' | 'range' {
  const conf = pivots.filter((p) => p.barIndex <= i)
  const highs = conf.filter((p) => p.kind === 'high').slice(-2)
  const lows = conf.filter((p) => p.kind === 'low').slice(-2)
  if (highs.length < 2 || lows.length < 2) return 'range'
  const hh = highs[1].price > highs[0].price
  const hl = lows[1].price > lows[0].price
  const lh = highs[1].price < highs[0].price
  const ll = lows[1].price < lows[0].price
  if (hh && hl) return 'up'
  if (lh && ll) return 'down'
  return 'range'
}

export function detectStructureExtras(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  if (cs.length === 0) return out

  const a = atr(cs, 14)
  const pivots = findPivots(cs, 2)

  /**
   * S/R 군집을 **관측 시점까지 확정된 피벗만으로 점진적으로** 쌓는다.
   *
   * `structure.ts` 의 `srLevels(cs)` 를 그대로 쓰면 미래참조다 — 레벨의 가격과 touches 가
   * 배열 전체의 피벗으로 계산되므로, 나중에 같은 자리에 피벗이 하나 더 생기면 **이미
   * 지나간 봉의 evidence 가 바뀐다**(동일성 키가 evidence 를 포함한다). 봉마다
   * `srLevels(cs.slice(0, i+1))` 를 부르면 정확하지만 O(n²) 이라 detectAll 예산을 넘는다.
   *
   * 피벗은 barIndex(확정 시점) 순서로 도착하므로, 훑으면서 군집에 넣으면 같은 결과를
   * O(n × 군집수) 로 얻는다.
   */
  type Cluster = { sum: number; touches: number; price: number }
  const clusters: Cluster[] = []
  const pivotsByConfirm = new Map<number, Pivot[]>()
  for (const p of pivots) {
    const arr = pivotsByConfirm.get(p.barIndex)
    if (arr) arr.push(p)
    else pivotsByConfirm.set(p.barIndex, [p])
  }

  /** 되돌림을 기다리는 붕괴. choch 와 retest_* 가 같은 레벨을 공유한다 */
  type Break = { level: number; up: boolean; at: number }
  let pending: Break | undefined

  const chochFired = new Set<string>()
  const flipFired = new Set<string>()

  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    const tol = RETEST_TOL_ATR * (a[i] || 0)

    // 이 봉에서 확정된 피벗을 군집에 넣는다. 이 시점 이후의 피벗은 아직 보지 않는다.
    for (const p of pivotsByConfirm.get(i) ?? []) {
      const hit = clusters.find((cl) => Math.abs(cl.price - p.price) <= cl.price * SR_TOL_PCT)
      if (hit) {
        hit.sum += p.price
        hit.touches += 1
        hit.price = hit.sum / hit.touches
      } else {
        clusters.push({ sum: p.price, touches: 1, price: p.price })
      }
    }

    // ── choch ────────────────────────────────────────────────────────────
    // 추세와 **반대로** 구조가 깨질 때만이다. 상승 구조에서 직전 스윙로우를 종가로
    // 이탈하면 성격이 바뀐 것(Change of Character)이고, 그것이 추세 전환의 첫 신호다.
    const trend = trendAt(pivots, i)
    const lo = lastConfirmedPivot(pivots, i, 'low')
    const hi = lastConfirmedPivot(pivots, i, 'high')

    if (trend === 'up' && lo && c.close < lo.price) {
      const key = `bear|${lo.pivotBar}`
      if (!chochFired.has(key)) {
        chochFired.add(key)
        // choch 배출은 detectMSB(smc.ts)로 위임. 여기서는 retest_* 를 위해 레벨만 기억한다.
        pending = { level: lo.price, up: false, at: i }
      }
    }
    if (trend === 'down' && hi && c.close > hi.price) {
      const key = `bull|${hi.pivotBar}`
      if (!chochFired.has(key)) {
        chochFired.add(key)
        // choch 배출은 detectMSB(smc.ts)로 위임. 여기서는 retest_* 를 위해 레벨만 기억한다.
        pending = { level: hi.price, up: true, at: i }
      }
    }

    // ── retest_success / retest_fail ─────────────────────────────────────
    // 붕괴 레벨로 되돌아왔을 때 어느 쪽에서 마감하느냐가 전부다. 돌파 방향에서
    // 마감하면 성공(지지/저항이 뒤바뀌어 작동), 되돌아 마감하면 페이크아웃이다.
    if (pending && i > pending.at) {
      if (i - pending.at > RETEST_WINDOW) {
        pending = undefined
      } else if (tol > 0 && c.low <= pending.level + tol && c.high >= pending.level - tol) {
        const held = pending.up ? c.close > pending.level : c.close < pending.level
        out.push({
          id: held ? 'retest_success' : 'retest_fail',
          tier: 1, kind: 'structure',
          // 성공은 돌파 방향, 실패는 그 반대다
          side: held === pending.up ? 'bullish' : 'bearish',
          barIndex: i, confidence: 'A', strength: held ? 3 : 2,
          evidence: held
            ? `돌파 레벨 ${fmtPrice(pending.level)} 리테스트 후 ${pending.up ? '위' : '아래'}에서 마감 — 지지/저항 전환 확인`
            : `돌파 레벨 ${fmtPrice(pending.level)} 리테스트에 실패하고 되돌아 마감 — 페이크아웃`,
          refs: { price: pending.level, fromBar: pending.at, toBar: i },
        })
        pending = undefined   // 한 붕괴당 리테스트는 한 번이다
      }
    }

    // ── sr_flip ──────────────────────────────────────────────────────────
    // srLevels 는 2회 이상 닿은 군집 레벨이다 — 피벗 하나짜리 레벨과 달리 시장이
    // 실제로 여러 번 존중한 자리라, 역할이 뒤바뀌는 것이 의미를 갖는다.
    if (tol > 0) {
      // 여러 군집이 같은 봉에서 전환될 수 있다. 봉당 하나만 내되 현재가에 가장 가까운
      // 레벨을 고른다. **선택되지 않은 군집은 fired 로 표시하지 않는다** — 그 자리도
      // 실제로 전환된 것이므로, 나중에 다시 전환하면 그때 잡혀야 한다.
      let best: { dist: number; ci: number; sig: Signal } | undefined
      for (let ci = 0; ci < clusters.length; ci++) {
        const lv = clusters[ci]
        if (lv.touches < SR_MIN_TOUCHES) continue
        // 군집 인덱스로 키를 잡는다 — lv.price 는 피벗이 붙을 때마다 움직인다
        const key = String(ci)
        if (flipFired.has(key)) continue
        // 직전 봉도 이번 봉도 레벨 위에서 마감했는데 저가가 레벨을 찍었다 → 저항이 지지로
        const prev = cs[i - 1]
        if (!prev) continue
        const touched = c.low <= lv.price + tol && c.high >= lv.price - tol
        if (!touched) continue
        let sig: Signal | undefined
        if (prev.close > lv.price && c.close > lv.price) {
          sig = {
            id: 'sr_flip', tier: 1, kind: 'structure', side: 'bullish',
            barIndex: i, confidence: 'A', strength: 3,
            evidence: `${lv.touches}회 닿았던 저항 ${fmtPrice(lv.price)} 를 딛고 지지로 전환`,
            refs: { price: lv.price, toBar: i },
          }
        } else if (prev.close < lv.price && c.close < lv.price) {
          sig = {
            id: 'sr_flip', tier: 1, kind: 'structure', side: 'bearish',
            barIndex: i, confidence: 'A', strength: 3,
            evidence: `${lv.touches}회 닿았던 지지 ${fmtPrice(lv.price)} 가 저항으로 전환`,
            refs: { price: lv.price, toBar: i },
          }
        }
        if (!sig) continue
        const dist = Math.abs(lv.price - c.close)
        if (!best || dist < best.dist || (dist === best.dist && ci < best.ci)) {
          best = { dist, ci, sig }
        }
      }
      if (best) {
        flipFired.add(String(best.ci))
        out.push(best.sig)
      }
    }
  }

  return out.sort((x, y) => x.barIndex - y.barIndex || x.id.localeCompare(y.id))
}
