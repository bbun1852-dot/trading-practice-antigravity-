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
      }
      if (Math.abs(c.high - p.high) <= 0.001 * c.high) {
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
