import type { Candle } from '../data/types'
import type { Signal, SignalSide, Tier, SignalKind } from './signalTypes'
import { rsi, macd, bollinger, atr, ema, sma, closes, volumes } from './indicators'

const crossUp = (a: number[], b: number[], i: number) =>
  i > 0 && !Number.isNaN(a[i - 1]) && !Number.isNaN(b[i - 1]) && a[i - 1] <= b[i - 1] && a[i] > b[i]
const crossDown = (a: number[], b: number[], i: number) =>
  i > 0 && !Number.isNaN(a[i - 1]) && !Number.isNaN(b[i - 1]) && a[i - 1] >= b[i - 1] && a[i] < b[i]

export function detectIndicatorSignals(cs: Candle[]): Signal[] {
  const out: Signal[] = []

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
