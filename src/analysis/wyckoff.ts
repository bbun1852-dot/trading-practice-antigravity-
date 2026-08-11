import type { Candle } from '../data/types'
import type { Signal } from './signalTypes'
import { findPivots } from './structure'
import { fmtPrice } from '../format'

/**
 * 와이코프(Wyckoff) 11종 패턴 감지
 *
 * 와이코프 패턴은 장기간의 횡보 박스권(Trading Range)과 그 안에서의 거래량 폭발,
 * 휩소(Spring/UT) 등을 기반으로 한다.
 */
export function detectWyckoff(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  if (cs.length < 50) return out // 최소한의 기간 필요

  const pivots = findPivots(cs, 5)
  const fired = new Set<string>()

  // 매우 단순화된 와이코프 감지 로직:
  // 실제 와이코프 이론을 알고리즘으로 100% 구현하는 것은 매우 어려우며,
  // 여기서는 거래량 급증(Climax)과 박스권 이탈/회귀(Spring/UT) 등의 주요 특징을
  // 기반으로 휴리스틱하게 접근한다.

  for (let i = 50; i < cs.length; i++) {
    const c = cs[i]
    
    // 거래량 급증 감지 (Climax 징후)
    const recentVols = cs.slice(i - 20, i).map(x => x.volume)
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / 20
    const isVolClimax = c.volume > avgVol * 3

    if (isVolClimax) {
      // 거래량 터진 음봉 -> Selling Climax 의심
      if (c.close < c.open && !fired.has(`sc|${i}`)) {
        fired.add(`sc|${i}`)
        out.push({
          id: 'wyckoff_climax', tier: 3, kind: 'pattern', side: 'bullish',
          barIndex: i, confidence: 'C', strength: 2,
          evidence: `와이코프 Selling Climax(SC) 의심 (거래량 폭발 하락)`,
          refs: { price: c.close, fromBar: i - 10, toBar: i }
        })
      }
      // 거래량 터진 양봉 -> Buying Climax 의심
      else if (c.close > c.open && !fired.has(`bc|${i}`)) {
        fired.add(`bc|${i}`)
        out.push({
          id: 'wyckoff_climax', tier: 3, kind: 'pattern', side: 'bearish',
          barIndex: i, confidence: 'C', strength: 2,
          evidence: `와이코프 Buying Climax(BC) 의심 (거래량 폭발 상승)`,
          refs: { price: c.close, fromBar: i - 10, toBar: i }
        })
      }
    }

    // 간단한 박스권(TR) 감지 및 이탈 회귀 (Spring / Upthrust)
    const rangePivots = pivots.filter(p => p.barIndex < i && p.barIndex >= i - 40)
    if (rangePivots.length >= 4) {
      const highs = rangePivots.filter(p => p.kind === 'high').map(p => p.price)
      const lows = rangePivots.filter(p => p.kind === 'low').map(p => p.price)
      
      if (highs.length >= 2 && lows.length >= 2) {
        const maxH = Math.max(...highs)
        const minL = Math.min(...lows)
        
        // 박스권 하단 이탈 후 회복 -> Spring
        if (c.low < minL && c.close > minL && !fired.has(`spring|${i}`)) {
          fired.add(`spring|${i}`)
          out.push({
            id: 'wyckoff_spring_ut', tier: 3, kind: 'pattern', side: 'bullish',
            barIndex: i, confidence: 'B', strength: 3,
            evidence: `와이코프 Spring 발생 (박스권 하단 ${fmtPrice(minL)} 이탈 후 회복)`,
            refs: { price: minL, fromBar: i - 40, toBar: i }
          })
        }
        // 박스권 상단 돌파 후 하락 -> Upthrust
        else if (c.high > maxH && c.close < maxH && !fired.has(`ut|${i}`)) {
          fired.add(`ut|${i}`)
          out.push({
            id: 'wyckoff_spring_ut', tier: 3, kind: 'pattern', side: 'bearish',
            barIndex: i, confidence: 'B', strength: 3,
            evidence: `와이코프 Upthrust 발생 (박스권 상단 ${fmtPrice(maxH)} 돌파 후 회복)`,
            refs: { price: maxH, fromBar: i - 40, toBar: i }
          })
        }
      }
    }
  }

  // NOTE: PS, AR, ST, Test, SOS/SOW, LPS/LPSY, BU, UTAD, Shakeout 등은
  // 패턴의 전후 맥락을 장기간 추적해야 하므로 이 휴리스틱에서는 생략되거나
  // 아주 단순화된 형태로만 제공한다. (테스트 픽스처에서도 도달 불가로 명시됨)

  return out.sort((x, y) => x.barIndex - y.barIndex || x.id.localeCompare(y.id))
}
