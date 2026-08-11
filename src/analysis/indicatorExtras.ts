import type { Candle } from '../data/types'
import type { Signal, SignalSide, SignalKind, Tier } from './signalTypes'
import { rsi, macd, bollinger, ema, obv, closes, volumes } from './indicators'
import { fmtPrice } from '../format'

/**
 * Part 4 — 지표·거래량 계열의 남은 A등급 8종.
 *
 * Part 1 의 `indicatorSignals.ts` 를 건드리지 않고 새 감지기로 붙인다. 기존 파일에
 * 끼워 넣으면 Part 1 이 테스트로 고정한 출력을 건드릴 위험이 있고 diff 도 섞인다.
 *
 * **Part 3 의 교훈을 설계 단계에서 적용했다.** 조건이 참인 동안 매 봉 내면 1000봉당
 * 수백 회가 된다(Part 3 에서 신규 7종 전부가 이것으로 발화율 게이트를 실패했다).
 * 아래 신호는 전부 "처음 성립한 순간" 에만 낸다 — 상태를 함수 지역에 들고 순서대로
 * 재생하므로 잘린 실행도 같은 봉에서 같은 첫 성립을 찾는다.
 */

/** 밴드 밖에 이만큼 연속으로 머물면 '밴드 타기' 로 본다 */
export const WALK_RUN = 3
/** 최근성 판정에 쓰는 창 */
export const LOOKBACK = 20
/**
 * OBV 추세 확인의 창은 더 길다.
 *
 * 20봉으로 두니 1000봉당 116~154회로 상한(150)을 넘었다 — 20봉 신고점은 추세장에서
 * 거의 매번 갱신되므로 "확인" 이라 부를 만큼 드물지 않다. 창을 늘리면 그만큼 의미
 * 있는 갱신만 남는다.
 */
export const OBV_LOOKBACK = 40
/** 흡수: 거래량이 평균의 이 배 이상 */
export const ABSORPTION_VOL_MULT = 2
/** 흡수: 몸통이 레인지의 이 비율 미만 */
export const ABSORPTION_BODY_MAX = 0.3
/**
 * 히스토그램 전환으로 인정할 최소 깊이 — 최근 창 최대 진폭 대비 비율.
 *
 * 이게 없으면 0선 근처의 잔물결이 전부 전환으로 잡힌다(실측: 결정 시점 400개에서
 * 유효 출현 270회로 신규 태그 중 최다였다). 모멘텀이 실제로 꺾였다고 부르려면
 * 그 저점/천장이 최근 움직임에 견줘 의미 있는 깊이여야 한다.
 */
export const HIST_TURN_MIN_FRAC = 0.3

function sig(
  id: string, tier: Tier, kind: SignalKind, side: SignalSide,
  barIndex: number, evidence: string, strength: 1 | 2 | 3 = 2,
): Signal {
  return { id, tier, kind, side, barIndex, confidence: 'A', strength, evidence }
}

/** 값 배열의 국소 극값. i 는 양옆 n 개보다 극단이어야 하고 i+n 에서 확정된다 */
function seriesPivots(v: number[], n = 2): Array<{ at: number; confirmedAt: number; value: number; kind: 'high' | 'low' }> {
  const out: Array<{ at: number; confirmedAt: number; value: number; kind: 'high' | 'low' }> = []
  for (let i = n; i < v.length - n; i++) {
    if (!Number.isFinite(v[i])) continue
    let isHigh = true
    let isLow = true
    for (let j = 1; j <= n; j++) {
      if (!Number.isFinite(v[i - j]) || !Number.isFinite(v[i + j])) { isHigh = false; isLow = false; break }
      if (v[i] <= v[i - j] || v[i] <= v[i + j]) isHigh = false
      if (v[i] >= v[i - j] || v[i] >= v[i + j]) isLow = false
    }
    if (isHigh) out.push({ at: i, confirmedAt: i + n, value: v[i], kind: 'high' })
    if (isLow) out.push({ at: i, confirmedAt: i + n, value: v[i], kind: 'low' })
  }
  return out
}

export function detectIndicatorExtras(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  if (cs.length === 0) return out

  const cl = closes(cs)
  const vol = volumes(cs)
  const r = rsi(cl, 14)
  const hist = macd(cl).hist
  const bb = bollinger(cl)
  const e50 = ema(cl, 50)
  const o = obv(cs)
  const rsiPivots = seriesPivots(r, 2)

  /** 직전 봉까지의 상태로 "새로 성립했는가" 를 가른다 */
  let walkRunUp = 0
  let walkRunDown = 0

  for (let i = 1; i < cs.length; i++) {
    const c = cs[i]

    // ── bb_walking ────────────────────────────────────────────────────────
    // 런이 정확히 WALK_RUN 에 도달한 봉에서만 낸다. 그 뒤로도 계속 내면 밴드를
    // 오래 타는 구간 전체가 신호로 도배된다.
    if (Number.isFinite(bb.upper[i]) && Number.isFinite(bb.lower[i])) {
      walkRunUp = cl[i] > bb.upper[i] ? walkRunUp + 1 : 0
      walkRunDown = cl[i] < bb.lower[i] ? walkRunDown + 1 : 0
      if (walkRunUp === WALK_RUN) {
        out.push(sig('bb_walking', 3, 'volatility', 'bullish', i,
          `종가가 볼린저 상단 위에서 ${WALK_RUN}봉 연속 마감 — 강한 추세`, 2))
      }
      if (walkRunDown === WALK_RUN) {
        out.push(sig('bb_walking', 3, 'volatility', 'bearish', i,
          `종가가 볼린저 하단 아래에서 ${WALK_RUN}봉 연속 마감 — 강한 추세`, 2))
      }
    }

    // ── rsi_failure_swing ────────────────────────────────────────────────
    // 확정된 RSI 피벗만 쓴다. 약세: 과매수권에서 고점을 낮춘 뒤 그 사이 저점을 깬다.
    if (Number.isFinite(r[i]) && Number.isFinite(r[i - 1])) {
      const conf = rsiPivots.filter((p) => p.confirmedAt <= i)
      const highs = conf.filter((p) => p.kind === 'high')
      const lows = conf.filter((p) => p.kind === 'low')
      if (highs.length >= 2 && lows.length >= 1) {
        const h2 = highs[highs.length - 1]
        const h1 = highs[highs.length - 2]
        const mid = lows.filter((p) => p.at > h1.at && p.at < h2.at).pop()
        if (mid && h1.value >= 70 && h2.value < h1.value &&
            r[i] < mid.value && r[i - 1] >= mid.value) {
          out.push(sig('rsi_failure_swing', 4, 'momentum', 'bearish', i,
            `RSI 고점 ${h1.value.toFixed(1)}→${h2.value.toFixed(1)} 하락 후 사이 저점 ${mid.value.toFixed(1)} 하향 돌파`, 3))
        }
        const l2 = lows[lows.length - 1]
        const l1 = lows.length >= 2 ? lows[lows.length - 2] : undefined
        const midH = l1 ? highs.filter((p) => p.at > l1.at && p.at < l2.at).pop() : undefined
        if (l1 && midH && l1.value <= 30 && l2.value > l1.value &&
            r[i] > midH.value && r[i - 1] <= midH.value) {
          out.push(sig('rsi_failure_swing', 4, 'momentum', 'bullish', i,
            `RSI 저점 ${l1.value.toFixed(1)}→${l2.value.toFixed(1)} 상승 후 사이 고점 ${midH.value.toFixed(1)} 상향 돌파`, 3))
        }
      }
    }

    // ── macd_hist_turn ───────────────────────────────────────────────────
    // 부호 전환(macd_zero_break)이 아니라 **기울기 전환**이다. i-1 이 국소 극값이고
    // i 에서 확정된다. 0선 반대편에 있을 때만 본다 — 추세 중간의 잔물결을 거른다.
    if (i >= 2 && Number.isFinite(hist[i]) && Number.isFinite(hist[i - 1]) && Number.isFinite(hist[i - 2])) {
      // 최근 창의 최대 진폭에 견줘 얕은 전환은 잔물결이지 모멘텀 전환이 아니다
      let amp = 0
      for (let k = Math.max(0, i - LOOKBACK); k <= i; k++) {
        const h = Math.abs(hist[k])
        if (Number.isFinite(h) && h > amp) amp = h
      }
      const deep = amp > 0 && Math.abs(hist[i - 1]) >= HIST_TURN_MIN_FRAC * amp

      if (deep && hist[i - 2] > hist[i - 1] && hist[i - 1] < hist[i] && hist[i - 1] < 0) {
        out.push(sig('macd_hist_turn', 4, 'momentum', 'bullish', i,
          `MACD 히스토그램이 ${fmtPrice(hist[i - 1])} 에서 바닥을 찍고 반등 — 하락 모멘텀 둔화`, 2))
      }
      if (deep && hist[i - 2] < hist[i - 1] && hist[i - 1] > hist[i] && hist[i - 1] > 0) {
        out.push(sig('macd_hist_turn', 4, 'momentum', 'bearish', i,
          `MACD 히스토그램이 ${fmtPrice(hist[i - 1])} 에서 천장을 찍고 하락 — 상승 모멘텀 둔화`, 2))
      }
    }

    // ── ma_support / ma_resistance ───────────────────────────────────────
    // 이평을 찍었으나 그 편에서 마감. 직전 봉도 같은 편이어야 "지켰다" 가 된다 —
    // 이평을 이미 뚫고 내려온 상태에서 되돌아 닿는 것은 지지가 아니라 저항이다.
    if (Number.isFinite(e50[i]) && Number.isFinite(e50[i - 1])) {
      if (c.low <= e50[i] && c.close > e50[i] && cl[i - 1] > e50[i - 1]) {
        out.push(sig('ma_support', 4, 'ma', 'bullish', i,
          `저가 ${fmtPrice(c.low)} 가 EMA50 ${fmtPrice(e50[i])} 를 찍고 종가는 위에서 마감`, 2))
      }
      if (c.high >= e50[i] && c.close < e50[i] && cl[i - 1] < e50[i - 1]) {
        out.push(sig('ma_resistance', 4, 'ma', 'bearish', i,
          `고가 ${fmtPrice(c.high)} 가 EMA50 ${fmtPrice(e50[i])} 를 찍고 종가는 아래서 마감`, 2))
      }
    }

    // ── obv_trend_confirm / vol_divergence ───────────────────────────────
    // 둘 다 "가격이 최근 창의 극값인가" 에서 갈린다. OBV 가 같이 극값이면 확인,
    // 거래량이 평균에 못 미치면 다이버전스다.
    if (i >= LOOKBACK) {
      const from = i - LOOKBACK
      let maxC = -Infinity, minC = Infinity, maxO = -Infinity, minO = Infinity, volSum = 0
      for (let k = from; k < i; k++) {
        if (cl[k] > maxC) maxC = cl[k]
        if (cl[k] < minC) minC = cl[k]
        if (o[k] > maxO) maxO = o[k]
        if (o[k] < minO) minO = o[k]
        volSum += vol[k]
      }
      const volAvg = volSum / LOOKBACK
      const newHigh = cl[i] > maxC
      const newLow = cl[i] < minC

      if (i >= OBV_LOOKBACK) {
        let mxC = -Infinity, mnC = Infinity, mxO = -Infinity, mnO = Infinity
        for (let k = i - OBV_LOOKBACK; k < i; k++) {
          if (cl[k] > mxC) mxC = cl[k]
          if (cl[k] < mnC) mnC = cl[k]
          if (o[k] > mxO) mxO = o[k]
          if (o[k] < mnO) mnO = o[k]
        }
        if (cl[i] > mxC && o[i] > mxO) {
          out.push(sig('obv_trend_confirm', 4, 'volume', 'bullish', i,
            `종가와 OBV 가 동시에 최근 ${OBV_LOOKBACK}봉 신고점 — 수급이 가격을 따라온다`, 3))
        }
        if (cl[i] < mnC && o[i] < mnO) {
          out.push(sig('obv_trend_confirm', 4, 'volume', 'bearish', i,
            `종가와 OBV 가 동시에 최근 ${OBV_LOOKBACK}봉 신저점 — 수급이 가격을 따라온다`, 3))
        }
      }
      if (volAvg > 0 && vol[i] < volAvg) {
        if (newHigh) {
          out.push(sig('vol_divergence', 2, 'volume', 'bearish', i,
            `종가 신고점인데 거래량은 ${LOOKBACK}봉 평균의 ${(vol[i] / volAvg).toFixed(1)}배 — 힘없는 돌파`, 2))
        }
        if (newLow) {
          out.push(sig('vol_divergence', 2, 'volume', 'bullish', i,
            `종가 신저점인데 거래량은 ${LOOKBACK}봉 평균의 ${(vol[i] / volAvg).toFixed(1)}배 — 매도 소진`, 2))
        }
      }

      // ── vol_absorption ─────────────────────────────────────────────────
      // 대량 거래에도 가격이 안 밀렸다 = 누군가 받아냈다. 매집인지 분산인지는
      // 위치가 정하지 감지기가 정하지 않으므로 중립이다 (매물대와 같은 이유).
      const range = c.high - c.low
      const body = Math.abs(c.close - c.open)
      if (volAvg > 0 && range > 0 &&
          vol[i] >= ABSORPTION_VOL_MULT * volAvg && body < ABSORPTION_BODY_MAX * range) {
        out.push(sig('vol_absorption', 2, 'volume', 'neutral', i,
          `거래량 ${(vol[i] / volAvg).toFixed(1)}배인데 몸통은 레인지의 ${((body / range) * 100).toFixed(0)}% — 흡수`, 3))
      }
    }
  }

  return out
}
