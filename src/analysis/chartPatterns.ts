import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { atr } from './indicators'
import { findPivots, type Pivot } from './structure'
import { fmtPrice } from '../format'

// trendline.ts 의 상수들을 차용하여 일관성 유지
const TOUCH_TOL_ATR = 0.3
const MIN_PIVOT_GAP = 5
const MAX_PIVOT_GAP = 120

type Line = {
  p1: Pivot
  p2: Pivot
  slope: number
  at: (x: number) => number
}

function makeLine(p1: Pivot, p2: Pivot): Line {
  const span = p2.pivotBar - p1.pivotBar
  const slope = (p2.price - p1.price) / span
  return { p1, p2, slope, at: (x) => p1.price + slope * (x - p1.pivotBar) }
}

function lineAt(cs: Candle[], pivots: Pivot[], i: number, kind: 'low' | 'high'): Line | undefined {
  const conf = pivots.filter((p) => p.kind === kind && p.barIndex <= i)
  if (conf.length < 2) return undefined

  const p2 = conf[conf.length - 1]
  const p1 = conf[conf.length - 2]
  const gap = p2.pivotBar - p1.pivotBar
  if (gap < MIN_PIVOT_GAP || gap > MAX_PIVOT_GAP) return undefined

  const line = makeLine(p1, p2)
  for (let j = p1.pivotBar + 1; j < p2.pivotBar; j++) {
    const v = line.at(j)
    if (kind === 'low' ? cs[j].close < v : cs[j].close > v) return undefined
  }
  return line
}

export function detectChartPatterns(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  if (cs.length === 0) return out

  const a = atr(cs, 14)
  const pivots = findPivots(cs, 2)
  const fired = new Set<string>()

  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    const tol = TOUCH_TOL_ATR * (a[i] || 0)
    if (!(tol > 0)) continue

    const conf = pivots.filter(p => p.barIndex <= i)
    const highs = conf.filter(p => p.kind === 'high')
    const lows = conf.filter(p => p.kind === 'low')
    
    // 최소 2개의 고점/저점이 있어야 함
    if (highs.length >= 2 && lows.length >= 1) {
      const h1 = highs[highs.length - 2]
      const h2 = highs[highs.length - 1]
      const l = lows.filter(p => p.pivotBar > h1.pivotBar && p.pivotBar < h2.pivotBar).pop()
      
      // 이중 천정 (Double Top)
      if (l && Math.abs(h1.price - h2.price) <= tol * 2) {
        if (c.close < l.price && c.open >= l.price) {
          const k = `dt|${h1.pivotBar}|${h2.pivotBar}`
          if (!fired.has(k)) {
            fired.add(k)
            out.push({
              id: 'pattern_double_top', tier: 3, kind: 'pattern', side: 'bearish',
              barIndex: i, confidence: 'B', strength: 2,
              evidence: `이중 천정 넥라인 ${fmtPrice(l.price)} 붕괴`,
              refs: { price: l.price, fromBar: h1.pivotBar, toBar: i }
            })
          }
        }
      }
      
      // 삼중 천정 (Triple Top)
      if (highs.length >= 3 && lows.length >= 2) {
        const h0 = highs[highs.length - 3]
        if (Math.abs(h0.price - h2.price) <= tol * 2 && Math.abs(h1.price - h2.price) <= tol * 2) {
          const l1 = lows.filter(p => p.pivotBar > h0.pivotBar && p.pivotBar < h1.pivotBar).pop()
          const l2 = l
          if (l1 && l2) {
            const neckline = Math.min(l1.price, l2.price)
            if (c.close < neckline && c.open >= neckline) {
              const k = `tt|${h0.pivotBar}|${h2.pivotBar}`
              if (!fired.has(k)) {
                fired.add(k)
                out.push({
                  id: 'pattern_triple_top', tier: 3, kind: 'pattern', side: 'bearish',
                  barIndex: i, confidence: 'B', strength: 2,
                  evidence: `삼중 천정 넥라인 ${fmtPrice(neckline)} 붕괴`,
                  refs: { price: neckline, fromBar: h0.pivotBar, toBar: i }
                })
              }
            }
          }
        }
      }
      
      // 헤드앤숄더 (Head and Shoulders)
      if (highs.length >= 3 && lows.length >= 2) {
        const h0 = highs[highs.length - 3] // Left Shoulder
        const h1 = highs[highs.length - 2] // Head
        const h2 = highs[highs.length - 1] // Right Shoulder
        if (h1.price > h0.price + tol && h1.price > h2.price + tol && Math.abs(h0.price - h2.price) <= tol * 3) {
          const l1 = lows.filter(p => p.pivotBar > h0.pivotBar && p.pivotBar < h1.pivotBar).pop()
          const l2 = lows.filter(p => p.pivotBar > h1.pivotBar && p.pivotBar < h2.pivotBar).pop()
          if (l1 && l2) {
            const nlLine = makeLine(l1, l2)
            const nlPrice = nlLine.at(i)
            if (c.close < nlPrice && c.open >= nlPrice) {
              const k = `hs|${h0.pivotBar}|${h2.pivotBar}`
              if (!fired.has(k)) {
                fired.add(k)
                out.push({
                  id: 'pattern_head_shoulders', tier: 3, kind: 'pattern', side: 'bearish',
                  barIndex: i, confidence: 'B', strength: 3,
                  evidence: `헤드앤숄더 넥라인 ${fmtPrice(nlPrice)} 붕괴`,
                  refs: { price: nlPrice, fromBar: h0.pivotBar, toBar: i }
                })
              }
            }
          }
        }
      }
    }

    if (lows.length >= 2 && highs.length >= 1) {
      const l1 = lows[lows.length - 2]
      const l2 = lows[lows.length - 1]
      const h = highs.filter(p => p.pivotBar > l1.pivotBar && p.pivotBar < l2.pivotBar).pop()
      
      // 이중 바닥 (Double Bottom)
      if (h && Math.abs(l1.price - l2.price) <= tol * 2) {
        if (c.close > h.price && c.open <= h.price) {
          const k = `db|${l1.pivotBar}|${l2.pivotBar}`
          if (!fired.has(k)) {
            fired.add(k)
            out.push({
              id: 'pattern_double_bottom', tier: 3, kind: 'pattern', side: 'bullish',
              barIndex: i, confidence: 'B', strength: 2,
              evidence: `이중 바닥 넥라인 ${fmtPrice(h.price)} 돌파`,
              refs: { price: h.price, fromBar: l1.pivotBar, toBar: i }
            })
          }
        }
      }
      
      // 삼중 바닥 (Triple Bottom)
      if (lows.length >= 3 && highs.length >= 2) {
        const l0 = lows[lows.length - 3]
        if (Math.abs(l0.price - l2.price) <= tol * 2 && Math.abs(l1.price - l2.price) <= tol * 2) {
          const h1 = highs.filter(p => p.pivotBar > l0.pivotBar && p.pivotBar < l1.pivotBar).pop()
          const h2 = h
          if (h1 && h2) {
            const neckline = Math.max(h1.price, h2.price)
            if (c.close > neckline && c.open <= neckline) {
              const k = `tb|${l0.pivotBar}|${l2.pivotBar}`
              if (!fired.has(k)) {
                fired.add(k)
                out.push({
                  id: 'pattern_triple_bottom', tier: 3, kind: 'pattern', side: 'bullish',
                  barIndex: i, confidence: 'B', strength: 2,
                  evidence: `삼중 바닥 넥라인 ${fmtPrice(neckline)} 돌파`,
                  refs: { price: neckline, fromBar: l0.pivotBar, toBar: i }
                })
              }
            }
          }
        }
      }
      
      // 역헤드앤숄더 (Inverse Head and Shoulders)
      if (lows.length >= 3 && highs.length >= 2) {
        const l0 = lows[lows.length - 3] // Left Shoulder
        const l1 = lows[lows.length - 2] // Head
        const l2 = lows[lows.length - 1] // Right Shoulder
        if (l1.price < l0.price - tol && l1.price < l2.price - tol && Math.abs(l0.price - l2.price) <= tol * 3) {
          const h1 = highs.filter(p => p.pivotBar > l0.pivotBar && p.pivotBar < l1.pivotBar).pop()
          const h2 = highs.filter(p => p.pivotBar > l1.pivotBar && p.pivotBar < l2.pivotBar).pop()
          if (h1 && h2) {
            const nlLine = makeLine(h1, h2)
            const nlPrice = nlLine.at(i)
            if (c.close > nlPrice && c.open <= nlPrice) {
              const k = `ihs|${l0.pivotBar}|${l2.pivotBar}`
              if (!fired.has(k)) {
                fired.add(k)
                out.push({
                  id: 'pattern_inv_head_shoulders', tier: 3, kind: 'pattern', side: 'bullish',
                  barIndex: i, confidence: 'B', strength: 3,
                  evidence: `역헤드앤숄더 넥라인 ${fmtPrice(nlPrice)} 돌파`,
                  refs: { price: nlPrice, fromBar: l0.pivotBar, toBar: i }
                })
              }
            }
          }
        }
      }
    }
    
    // 선 기반 패턴 (수렴/평행)
    const sup = lineAt(cs, pivots, i, 'low')
    const res = lineAt(cs, pivots, i, 'high')

    if (sup && res) {
      const supV = sup.at(i)
      const resV = res.at(i)
      
      const flatRes = Math.abs(res.slope) < tol / 10
      const flatSup = Math.abs(sup.slope) < tol / 10
      const supUp = sup.slope > tol / 10
      const resDn = res.slope < -tol / 10
      const bothUp = sup.slope > tol / 10 && res.slope > tol / 10
      const bothDn = sup.slope < -tol / 10 && res.slope < -tol / 10
      
      const isConverging = (supUp && resDn) || (flatRes && supUp) || (flatSup && resDn) || 
                           (bothUp && res.slope < sup.slope) || (bothDn && sup.slope > res.slope)
                           
      if (resV > supV) { // 상단이 하단보다 위에 있을 때
        const k = `geom|${sup.p1.pivotBar}|${res.p1.pivotBar}`
        
        // 돌파 검사
        const breakUp = c.close > resV + tol && c.open <= resV
        const breakDn = c.close < supV - tol && c.open >= supV
        
        if (breakUp || breakDn) {
          if (isConverging) {
            if (flatRes && supUp && breakUp && !fired.has(`${k}|asc`)) {
              fired.add(`${k}|asc`)
              out.push({
                id: 'pattern_asc_triangle', tier: 3, kind: 'pattern', side: 'bullish',
                barIndex: i, confidence: 'B', strength: 2,
                evidence: `상승 삼각수렴 상단 ${fmtPrice(resV)} 돌파`,
                refs: { price: resV, fromBar: sup.p1.pivotBar, toBar: i }
              })
            } else if (flatSup && resDn && breakDn && !fired.has(`${k}|desc`)) {
              fired.add(`${k}|desc`)
              out.push({
                id: 'pattern_desc_triangle', tier: 3, kind: 'pattern', side: 'bearish',
                barIndex: i, confidence: 'B', strength: 2,
                evidence: `하락 삼각수렴 하단 ${fmtPrice(supV)} 이탈`,
                refs: { price: supV, fromBar: res.p1.pivotBar, toBar: i }
              })
            } else if (supUp && resDn && !fired.has(`${k}|sym`)) {
              fired.add(`${k}|sym`)
              out.push({
                id: 'pattern_sym_triangle', tier: 3, kind: 'pattern', side: breakUp ? 'bullish' : 'bearish',
                barIndex: i, confidence: 'B', strength: 2,
                evidence: `대칭 삼각수렴 ${breakUp ? '돌파' : '이탈'}`,
                refs: { price: breakUp ? resV : supV, fromBar: Math.min(sup.p1.pivotBar, res.p1.pivotBar), toBar: i }
              })
            } else if (bothUp && res.slope < sup.slope && breakDn && !fired.has(`${k}|rwedge`)) {
              fired.add(`${k}|rwedge`)
              out.push({
                id: 'pattern_rising_wedge', tier: 3, kind: 'pattern', side: 'bearish',
                barIndex: i, confidence: 'B', strength: 2,
                evidence: `상승 쐐기 하단 ${fmtPrice(supV)} 이탈`,
                refs: { price: supV, fromBar: sup.p1.pivotBar, toBar: i }
              })
            } else if (bothDn && sup.slope > res.slope && breakUp && !fired.has(`${k}|fwedge`)) {
              fired.add(`${k}|fwedge`)
              out.push({
                id: 'pattern_falling_wedge', tier: 3, kind: 'pattern', side: 'bullish',
                barIndex: i, confidence: 'B', strength: 2,
                evidence: `하락 쐐기 상단 ${fmtPrice(resV)} 돌파`,
                refs: { price: resV, fromBar: res.p1.pivotBar, toBar: i }
              })
            }
          } else if (flatRes && flatSup && (breakUp || breakDn) && !fired.has(`${k}|box`)) {
            fired.add(`${k}|box`)
            out.push({
              id: 'pattern_rectangle', tier: 3, kind: 'pattern', side: breakUp ? 'bullish' : 'bearish',
              barIndex: i, confidence: 'B', strength: 2,
              evidence: `박스권 ${breakUp ? '상단' : '하단'} ${fmtPrice(breakUp ? resV : supV)} 돌파`,
              refs: { price: breakUp ? resV : supV, fromBar: Math.min(sup.p1.pivotBar, res.p1.pivotBar), toBar: i }
            })
          }
          
          // Flag / Pennant logic (needs a strong pole prior to the pattern)
          const startBar = Math.min(sup.p1.pivotBar, res.p1.pivotBar)
          if (startBar > 10) {
            const poleStartPrice = cs[Math.max(0, startBar - 10)].close
            const poleEndPrice = cs[startBar].close
            const isBullPole = poleEndPrice - poleStartPrice > 3 * a[startBar]
            const isBearPole = poleStartPrice - poleEndPrice > 3 * a[startBar]
            
            const isFlag = bothDn && breakUp && isBullPole
            const isBearFlag = bothUp && breakDn && isBearPole
            const isPennant = supUp && resDn && breakUp && isBullPole
            const isBearPennant = supUp && resDn && breakDn && isBearPole
            
            if (isFlag && !fired.has(`${k}|bflag`)) {
              fired.add(`${k}|bflag`)
              out.push({
                id: 'pattern_bull_flag', tier: 3, kind: 'pattern', side: 'bullish',
                barIndex: i, confidence: 'B', strength: 2,
                evidence: `상승 플래그 상단 ${fmtPrice(resV)} 돌파`,
                refs: { price: resV, fromBar: startBar - 10, toBar: i }
              })
            } else if (isBearFlag && !fired.has(`${k}|brflag`)) {
              fired.add(`${k}|brflag`)
              out.push({
                id: 'pattern_bear_flag', tier: 3, kind: 'pattern', side: 'bearish',
                barIndex: i, confidence: 'B', strength: 2,
                evidence: `하락 플래그 하단 ${fmtPrice(supV)} 이탈`,
                refs: { price: supV, fromBar: startBar - 10, toBar: i }
              })
            } else if (isPennant && !fired.has(`${k}|bpennant`)) {
              fired.add(`${k}|bpennant`)
              out.push({
                id: 'pattern_bull_pennant', tier: 3, kind: 'pattern', side: 'bullish',
                barIndex: i, confidence: 'B', strength: 2,
                evidence: `상승 페넌트 상단 ${fmtPrice(resV)} 돌파`,
                refs: { price: resV, fromBar: startBar - 10, toBar: i }
              })
            } else if (isBearPennant && !fired.has(`${k}|brpennant`)) {
              fired.add(`${k}|brpennant`)
              out.push({
                id: 'pattern_bear_pennant', tier: 3, kind: 'pattern', side: 'bearish',
                barIndex: i, confidence: 'B', strength: 2,
                evidence: `하락 페넌트 하단 ${fmtPrice(supV)} 이탈`,
                refs: { price: supV, fromBar: startBar - 10, toBar: i }
              })
            }
          }
        }
      }
    }
  }

  return out.sort((x, y) => x.barIndex - y.barIndex || x.id.localeCompare(y.id))
}
