import type { Candle } from '../data/types'
import type { Signal, SignalSide } from './signalTypes'
import { atr } from './indicators'
import { fmtPrice } from '../format'

/**
 * 와이코프 11종 — 박스권(TR) 에피소드 상태기계.
 *
 * **왜 상태기계여야 하는가.** 처음 구현은 봉마다 독립적으로 "거래량 터졌나 /
 * 박스 뚫었나" 를 묻는 휴리스틱이었고, 그래서 11종 중 2종밖에 낼 수 없었다
 * (실측: 10,000봉에서 9종이 0회). 나머지는 전후 맥락이 있어야 **정의 자체가
 * 성립하는** 사건이기 때문이다 — AR 은 SC 다음에만, ST 는 AR 다음에만, LPS 는
 * SOS 다음에만 의미가 있다. 맥락 없이 "반등했다" 를 AR 이라 부르면 그건 AR 이
 * 아니라 그냥 반등이다.
 *
 * 등재만 하고 안 나오는 태그는 사용자를 **벌주기만 한다** — grader 는 활성 신호에
 * 없는 체크를 전부 헛다리로 처리하므로, 죽은 태그는 영원히 감점만 되고 맞을 수가
 * 없다. "네가 놓친 근거를 알려준다" 는 이 툴의 존재 이유가 뒤집힌다.
 *
 * **인과성은 전방 스캔이 구조적으로 보장한다.** 봉 i 의 상태는 봉 0..i 만 보고
 * 전진하며 정해지고, 뒤로 돌아가 과거 봉에 신호를 심지 않는다. 그래서 어디서 잘라
 * 주든 같은 봉에서 같은 상태가 나온다.
 *
 * 축적(강세)과 분배(약세)는 완전한 거울상이라 방향 `dir` 을 매개변수로 받는 엔진
 * 하나로 쓴다. dir = +1 이면 축적, -1 이면 분배다.
 */

/** 클라이맥스로 볼 거래량 배수 (직전 20봉 평균 대비) */
export const CLIMAX_VOL_MULT = 2.5
/** 클라이맥스로 볼 최소 레인지 (ATR 배수) */
export const CLIMAX_RANGE_ATR = 1.6
/** 클라이맥스 종가가 극단에서 이만큼은 되돌아와야 한다 (레인지 비율) */
export const CLIMAX_CLOSE_FRAC = 0.3
/** 클라이맥스 앞에 있어야 할 선행 추세의 크기 (ATR 배수) */
export const TREND_ATR = 2.5
/** 선행 추세를 재는 구간 */
export const TREND_BARS = 20

/** AR 로 인정할 최소 반등 폭 (ATR 배수) */
export const AR_MIN_ATR = 1.5
/** AR 확정에 필요한 되돌림 (반등 폭 대비 비율) */
export const AR_PULLBACK_FRAC = 0.3

/** ST 가 TR 경계에 이만큼 가까워야 한다 (ATR 배수) */
export const ST_TOL_ATR = 0.6
/** ST 는 클라이맥스보다 거래량이 낮아야 한다 */
export const ST_VOL_FRAC = 0.7

/** 이보다 깊고 거래량이 터진 침투는 스프링이 아니라 쉐이크아웃이다 (ATR 배수) */
export const SHAKEOUT_ATR = 1.0
/** 쉐이크아웃으로 볼 거래량 배수 */
export const SHAKEOUT_VOL_MULT = 2.0

/** Test 가 스프링 저점에 이만큼 가까워야 한다 (ATR 배수) */
export const TEST_TOL_ATR = 0.8
/** Test 는 스프링보다 거래량이 낮아야 한다 */
export const TEST_VOL_FRAC = 0.8

/** SOS/SOW 로 볼 거래량 배수 */
export const SOS_VOL_MULT = 1.3
/** LPS/LPSY 가 TR 경계 위에서 멈춘 거리의 상한 (ATR 배수) */
export const LPS_TOL_ATR = 0.8

/** PS 로 볼 거래량 배수 */
export const PS_VOL_MULT = 1.5
/** PS 종가가 레인지의 이만큼 위(아래)에서 마감해야 한다 */
export const PS_CLOSE_FRAC = 0.5
/** PS 재발화 금지 구간 */
export const PS_COOLDOWN = 30

/** 에피소드가 이보다 길어지면 만료한다 */
export const TR_MAX_BARS = 120
/**
 * SOS/SOW 로 국면이 markup 에 들어간 뒤의 예산.
 *
 * markup 은 **박스권을 이미 떠난 상태**다. 남은 일은 BU/LPS 같은 즉시 후속뿐이라
 * TR 전체 예산(120봉)을 계속 물고 있을 이유가 없다. 물고 있으면 그 사이에 일어난
 * 반대 방향 클라이맥스를 통째로 놓친다 — 실제로 축적 도식 바로 뒤에 분배 도식을
 * 붙였더니 BC 가 한 번도 안 잡혔다.
 */
export const MARKUP_MAX_BARS = 30
/** TR 경계를 이만큼 결정적으로 벗어나면 에피소드가 깨진 것이다 (ATR 배수) */
export const TR_ESCAPE_ATR = 2.0

/** 거래량 평균을 내는 구간 */
const VOL_BARS = 20

type Phase = 'climax' | 'range' | 'tested' | 'sprung' | 'markup'

type Episode = {
  /** +1 = 축적(강세), -1 = 분배(약세) */
  dir: 1 | -1
  phase: Phase
  /** SC 저가 / BC 고가 — TR 의 클라이맥스 쪽 경계 */
  climaxPrice: number
  climaxBar: number
  climaxVol: number
  /** 클라이맥스 이후 반대쪽 극단 추적 (AR 확정용) */
  extreme: number
  extremeBar: number
  /** AR 고가 / AR 저가 — TR 의 반대쪽 경계. 확정 시점에 고정된다 */
  arPrice?: number
  springPrice?: number
  springVol?: number
  /** SOS/SOW 가 난 봉. markup 예산의 기준점 */
  sosBar?: number
  /**
   * 이 에피소드에서 이미 낸 사건. 국면을 전진시키지 않는 사건(Test·BU·LPS)은
   * 조건이 참인 동안 매 봉 다시 나므로 여기서 막는다 — 발화 억제는 이 프로젝트가
   * 파트마다 걸린 함정이다(Part 3 Task 7, Part 4 Task 7, 이번 파트의 htf_trend).
   */
  fired: Set<string>
}

/** 클라이맥스 쪽 극단 (축적이면 저가, 분배면 고가) */
const edgeOf = (c: Candle, dir: number) => (dir > 0 ? c.low : c.high)
/** 반대쪽 극단 */
const antiEdgeOf = (c: Candle, dir: number) => (dir > 0 ? c.high : c.low)
/** 축적 방향으로 얼마나 나아갔는가. 양수면 강세 쪽 */
const along = (a: number, b: number, dir: number) => dir * (a - b)

export function detectWyckoff(cs: Candle[]): Signal[] {
  const out: Signal[] = []
  if (cs.length === 0) return out

  const a = atr(cs, 14)
  let ep: Episode | undefined
  let lastPsBar = -Infinity

  const push = (
    id: string, side: SignalSide, i: number, strength: 1 | 2 | 3,
    evidence: string, refs: Signal['refs'],
  ) => {
    // 사건 하나는 에피소드당 한 번만 낸다.
    if (ep) {
      if (ep.fired.has(id)) return
      ep.fired.add(id)
    }
    // 전부 B등급이다. 와이코프 국면 라벨링은 어디부터를 TR 로 보느냐에 따라 답이
    // 달라진다 — 추세선(Part 5)과 같은 이유로 헛다리 감점을 절반만 받는다.
    out.push({ id, tier: 3, kind: 'pattern', side, barIndex: i, confidence: 'B', strength, evidence, refs })
  }

  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]
    const tol = a[i] || 0
    if (!(tol > 0) || i < VOL_BARS || i < TREND_BARS) continue

    const range = c.high - c.low
    const avgVol = cs.slice(i - VOL_BARS, i).reduce((s, x) => s + x.volume, 0) / VOL_BARS
    if (!(avgVol > 0) || !(range > 0)) continue

    // ── 에피소드 만료 ───────────────────────────────────────────────────────
    if (ep) {
      const escaped = along(c.close, ep.climaxPrice, ep.dir) < -TR_ESCAPE_ATR * tol
      const markupDone = ep.sosBar !== undefined && i - ep.sosBar > MARKUP_MAX_BARS
      if (i - ep.climaxBar > TR_MAX_BARS || escaped || markupDone) ep = undefined
    }

    // ── 에피소드 없음: PS 와 클라이맥스만 본다 ──────────────────────────────
    if (!ep) {
      for (const dir of [1, -1] as const) {
        const prior = along(cs[i - TREND_BARS].close, c.close, dir)

        // 클라이맥스 — 선행 추세 + 거래량 폭발 + 넓은 레인지 + 극단에서 되돌아온 마감
        if (
          prior > TREND_ATR * tol &&
          c.volume >= CLIMAX_VOL_MULT * avgVol &&
          range >= CLIMAX_RANGE_ATR * tol &&
          along(c.close, edgeOf(c, dir), dir) > CLIMAX_CLOSE_FRAC * range
        ) {
          ep = {
            dir, phase: 'climax',
            climaxPrice: edgeOf(c, dir), climaxBar: i, climaxVol: c.volume,
            extreme: antiEdgeOf(c, dir), extremeBar: i,
            fired: new Set(),
          }
          push('wyckoff_climax', dir > 0 ? 'bullish' : 'bearish', i, 3,
            dir > 0
              ? `와이코프 셀링 클라이맥스(SC) — 저가 ${fmtPrice(c.low)} 에서 거래량 ${(c.volume / avgVol).toFixed(1)}배로 반등 마감`
              : `와이코프 바잉 클라이맥스(BC) — 고가 ${fmtPrice(c.high)} 에서 거래량 ${(c.volume / avgVol).toFixed(1)}배로 밀린 마감`,
            { price: edgeOf(c, dir), fromBar: i - TREND_BARS, toBar: i })
          break
        }

        // PS — 클라이맥스 이전 사건이라 에피소드 없이 자기 봉의 정보만으로 나야 한다.
        // "SC 가 확정된 뒤에 돌아가서 PS 를 낸다" 는 불가능하다: PS 의 봉으로 잘랐을 때
        // 안 나오므로 그 자체가 미래참조다. 그래서 본질적으로 가장 시끄럽고,
        // 조건을 세게 걸고 쿨다운을 둔다.
        const body = Math.abs(c.close - c.open)
        const wick = dir > 0
          ? Math.min(c.open, c.close) - c.low
          : c.high - Math.max(c.open, c.close)
        if (
          i - lastPsBar > PS_COOLDOWN &&
          prior > TREND_ATR * tol &&
          c.volume >= PS_VOL_MULT * avgVol &&
          wick > body &&
          along(c.close, edgeOf(c, dir), dir) > PS_CLOSE_FRAC * range
        ) {
          lastPsBar = i
          push('wyckoff_ps', dir > 0 ? 'bullish' : 'bearish', i, 2,
            dir > 0
              ? `와이코프 예비 지지(PS) — 하락 중 ${fmtPrice(c.low)} 에서 아래꼬리와 거래량 증가`
              : `와이코프 예비 저항(PSY) — 상승 중 ${fmtPrice(c.high)} 에서 위꼬리와 거래량 증가`,
            { price: edgeOf(c, dir), fromBar: i - TREND_BARS, toBar: i })
          break
        }
      }
      continue
    }

    const dir = ep.dir
    const side: SignalSide = dir > 0 ? 'bullish' : 'bearish'
    const opp: SignalSide = dir > 0 ? 'bearish' : 'bullish'

    // 클라이맥스 이후 반대쪽 극단을 계속 갱신한다 (AR 후보).
    if (ep.phase === 'climax' && along(antiEdgeOf(c, dir), ep.extreme, dir) > 0) {
      ep.extreme = antiEdgeOf(c, dir)
      ep.extremeBar = i
    }

    // ── AR — 자동 랠리/반락 ─────────────────────────────────────────────────
    if (ep.phase === 'climax') {
      const arMove = along(ep.extreme, ep.climaxPrice, dir)
      const pulled = along(ep.extreme, c.close, dir) > AR_PULLBACK_FRAC * arMove
      if (arMove >= AR_MIN_ATR * tol && pulled) {
        ep.arPrice = ep.extreme
        ep.phase = 'range'
        // **side 가 에피소드와 반대다.** 축적의 AR 은 상승 랠리지만, 이 신호가 확정되는
        // 순간은 그 랠리가 꺾여 되돌림이 시작된 시점이다. 그 자리에서 읽을 것은
        // "TR 상단이 여기다, 이제 되돌아간다" 이므로 방향은 반대편이다.
        push('wyckoff_ar', opp, i, 2,
          dir > 0
            ? `와이코프 자동 랠리(AR) — SC 이후 ${fmtPrice(ep.extreme)} 까지 반등하고 되돌림. TR 상단 확정`
            : `와이코프 자동 반락(AR) — BC 이후 ${fmtPrice(ep.extreme)} 까지 밀리고 되돌림. TR 하단 확정`,
          { price: ep.extreme, priceLow: Math.min(ep.climaxPrice, ep.extreme), priceHigh: Math.max(ep.climaxPrice, ep.extreme), fromBar: ep.climaxBar, toBar: i, pivotBar: ep.extremeBar })
      }
      continue
    }

    const inside = along(edgeOf(c, dir), ep.climaxPrice, dir)

    // ── Spring / UT / Shakeout / UTAD — TR 경계 침투 후 회귀 ────────────────
    // **한 침투 사건은 정확히 한 태그만 낸다.** Part 4 의 choch/msb_* 가 98% 겹친
    // 실수를 반복하지 않기 위한 규약이다.
    if ((ep.phase === 'range' || ep.phase === 'tested') && inside < 0 && along(c.close, ep.climaxPrice, dir) > 0) {
      const depth = -inside
      ep.springPrice = edgeOf(c, dir)
      ep.springVol = c.volume
      const wasTested = ep.phase === 'tested'
      ep.phase = 'sprung'

      // **진화형인가 기본형인가.** 국면이 무르익은 뒤(ST 를 거친 Phase C)이거나
      // 침투가 격렬하면 진화형이다 — 축적이면 터미널 쉐이크아웃, 분배면 UTAD.
      // UTAD 의 교과서 정의가 "분배가 진행된 뒤의 업트러스트" 이므로 두 조건은
      // 같은 것의 두 얼굴이고, 그래서 방향에 관계없이 같은 판정을 쓴다.
      //
      // 처음엔 쉐이크아웃만 격렬함으로, UTAD 만 ST 여부로 갈랐다. 그랬더니
      // 10,000봉에서 각각 1회·3회로 사실상 죽은 태그였다 — 10계열 중 9계열이
      // 쉐이크아웃을 한 번도 못 본다. 살아 있다는 것은 배출된다는 뜻이지
      // 한 번 배출된다는 뜻이 아니다.
      const violent = depth >= SHAKEOUT_ATR * tol && c.volume >= SHAKEOUT_VOL_MULT * avgVol
      const evolved = wasTested || violent

      if (evolved && dir > 0) {
        push('wyckoff_shakeout', 'bullish', i, 3,
          `와이코프 터미널 쉐이크아웃 — TR 하단 ${fmtPrice(ep.climaxPrice)} 을 깊이 뚫고 회복 마감${violent ? ` (거래량 ${(c.volume / avgVol).toFixed(1)}배)` : ' (ST 이후)'}`,
          { price: ep.climaxPrice, priceLow: edgeOf(c, dir), fromBar: ep.climaxBar, toBar: i })
      } else if (evolved && dir < 0) {
        push('wyckoff_utad', 'bearish', i, 3,
          `와이코프 UTAD — 분배가 진행된 뒤 TR 상단 ${fmtPrice(ep.climaxPrice)} 을 뚫고 되돌아온 마감${violent ? ` (거래량 ${(c.volume / avgVol).toFixed(1)}배)` : ' (ST 이후)'}`,
          { price: ep.climaxPrice, priceHigh: edgeOf(c, dir), fromBar: ep.climaxBar, toBar: i })
      } else {
        push('wyckoff_spring_ut', side, i, 3,
          dir > 0
            ? `와이코프 스프링 — TR 하단 ${fmtPrice(ep.climaxPrice)} 이탈 후 회복 마감`
            : `와이코프 업트러스트(UT) — TR 상단 ${fmtPrice(ep.climaxPrice)} 돌파 후 회귀 마감`,
          { price: ep.climaxPrice, fromBar: ep.climaxBar, toBar: i })
      }
      continue
    }

    // ── ST — 2차 테스트 ─────────────────────────────────────────────────────
    if (ep.phase === 'range' && inside >= 0 && inside < ST_TOL_ATR * tol && c.volume < ep.climaxVol * ST_VOL_FRAC) {
      ep.phase = 'tested'
      push('wyckoff_st', side, i, 2,
        `와이코프 2차 테스트(ST) — TR 경계 ${fmtPrice(ep.climaxPrice)} 재방문인데 거래량은 클라이맥스의 ${(c.volume / ep.climaxVol).toFixed(1)}배`,
        { price: ep.climaxPrice, fromBar: ep.climaxBar, toBar: i })
      continue
    }

    // ── Test — 스프링 이후 저거래량 재확인 ──────────────────────────────────
    if (ep.phase === 'sprung' && ep.springPrice !== undefined && ep.springVol !== undefined) {
      const above = along(edgeOf(c, dir), ep.springPrice, dir)
      if (above > 0 && above < TEST_TOL_ATR * tol && c.volume < ep.springVol * TEST_VOL_FRAC) {
        push('wyckoff_test', side, i, 2,
          `와이코프 테스트 — 스프링 저점 ${fmtPrice(ep.springPrice)} 위에서 거래량 줄며 멈춤`,
          { price: ep.springPrice, fromBar: ep.climaxBar, toBar: i })
        continue
      }
    }

    if (ep.arPrice === undefined) continue

    // ── SOS / SOW — TR 반대 경계 돌파 ───────────────────────────────────────
    if (ep.phase !== 'markup' && along(c.close, ep.arPrice, dir) > 0 && c.volume >= SOS_VOL_MULT * avgVol) {
      ep.phase = 'markup'
      ep.sosBar = i
      push('wyckoff_sos_sow', side, i, 3,
        dir > 0
          ? `와이코프 강세 신호(SOS) — TR 상단 ${fmtPrice(ep.arPrice)} 을 거래량 ${(c.volume / avgVol).toFixed(1)}배로 돌파 마감`
          : `와이코프 약세 신호(SOW) — TR 하단 ${fmtPrice(ep.arPrice)} 을 거래량 ${(c.volume / avgVol).toFixed(1)}배로 이탈 마감`,
        { price: ep.arPrice, fromBar: ep.climaxBar, toBar: i })
      continue
    }

    // ── BU / LPS — 돌파 이후 되돌림. 경계에 닿았으면 BU, 위에서 멈추면 LPS ──
    // 둘을 이렇게 가르면 겹치지 않는다: 침투 여부가 배타적 조건이다.
    if (ep.phase === 'markup' && along(c.close, ep.arPrice, dir) > 0) {
      const off = along(edgeOf(c, dir), ep.arPrice, dir)
      if (off <= 0) {
        push('wyckoff_bu', side, i, 2,
          dir > 0
            ? `와이코프 백업(BU/BUEC) — 돌파한 TR 상단 ${fmtPrice(ep.arPrice)} 까지 되돌아왔다 위에서 마감`
            : `와이코프 백업 — 이탈한 TR 하단 ${fmtPrice(ep.arPrice)} 까지 되돌아왔다 아래서 마감`,
          { price: ep.arPrice, fromBar: ep.climaxBar, toBar: i })
      } else if (off < LPS_TOL_ATR * tol) {
        push('wyckoff_lps_lpsy', side, i, 2,
          dir > 0
            ? `와이코프 마지막 지지(LPS) — TR 상단 ${fmtPrice(ep.arPrice)} 위에서 눌림이 멈춤`
            : `와이코프 마지막 저항(LPSY) — TR 하단 ${fmtPrice(ep.arPrice)} 아래서 반등이 멈춤`,
          { price: ep.arPrice, fromBar: ep.climaxBar, toBar: i })
      }
    }
  }

  return out.sort((x, y) => x.barIndex - y.barIndex || x.id.localeCompare(y.id))
}
