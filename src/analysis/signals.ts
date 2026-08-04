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
