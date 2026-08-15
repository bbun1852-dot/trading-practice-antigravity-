import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { TAGS } from './taxonomy'
import { solverView } from './generator'
import type { Question } from './types'
import { DURATION, HIGHER_TF, type Candle } from '../data/types'

/**
 * ════════════════════════════════════════════════════════════════════════════
 * 협상 불가능한 불변식. **이 파일은 잠겨 있다.**
 * ════════════════════════════════════════════════════════════════════════════
 *
 * scripts/verify.ts 가 이 파일의 SHA-256 을 scripts/locked.json 과 대조한다.
 * 한 글자라도 바뀌면 `npm run verify` 가 실패한다.
 *
 * **왜 잠그나.** 2026-08-12 인계에서 실제로 있었던 일이다 — 코드가 불변식을
 * 어기자 코드가 아니라 **불변식이 수정됐다.**
 *   · `'와이코프 11종과 HTF 3종이 전부 B등급이다'` 검사에서 HTF 3종이 삭제됐다
 *   · 배출불가 예외 목록에 htf_* 3종이 추가됐다
 * 둘 다 `npm test` 는 초록이었다. 검사가 스스로를 지킬 수 없으면 검사가 아니다.
 *
 * **여기 있는 것을 바꿔야 한다고 판단되면, 그건 작업이 잘못됐다는 신호다.**
 * 멈추고 사장에게 물어라. 정말 바꿔야 하는 경우도 있지만 그건 사람이 정한다.
 */

// ── 1. 등급표 ────────────────────────────────────────────────────────────────

/**
 * B등급 31종. 이 집합은 **정확히** 일치해야 한다 — 하나가 빠지거나 더해지면 실패다.
 *
 * B는 "사람마다 답이 갈리는 판단" 이라는 뜻이고, falseClaimPenalty 가 절반이다.
 * 기하 작도(추세선·차트패턴)와 국면 라벨링(와이코프)이 여기 해당한다.
 *
 * htf_* 3종이 여기 **없는** 것은 의도다. 처음엔 B였다 — 배수 4 고정에 캘린더가
 * 아니라 배열 인덱스 기준으로 4봉씩 묶은 합성이라 사용자가 실제 상위 차트에서
 * 본 것과 달랐기 때문이다. 2026-08-12 에 진짜 상위 봉(4h→1d, 1d→1w)을 시간
 * 기준으로 참조하도록 바뀌면서 그 이유가 사라져 A로 올렸다.
 * **이 조건이 깨지면 — 합성으로 되돌아가거나 닫히지 않은 상위 봉을 쓰기 시작하면 —
 * 다시 B로 내려야 한다.** 아래 3번 검사가 그 조건을 지킨다.
 */
const GRADE_B = new Set([
  // 추세선·채널 5종 (Part 5) — 어느 두 점을 잇느냐에 따라 선이 달라진다
  'trendline_support', 'trendline_resistance', 'trendline_break',
  'channel_upper', 'channel_lower',
  // 차트패턴 15종 (Part 6) — 어디부터를 패턴으로 보느냐가 갈린다
  'pattern_double_top', 'pattern_double_bottom',
  'pattern_triple_top', 'pattern_triple_bottom',
  'pattern_head_shoulders', 'pattern_inv_head_shoulders',
  'pattern_sym_triangle', 'pattern_asc_triangle', 'pattern_desc_triangle',
  'pattern_rising_wedge', 'pattern_falling_wedge',
  'pattern_bull_flag', 'pattern_bear_flag', 'pattern_bear_pennant',
  'pattern_rectangle',
  // 와이코프 11종 (Part 6) — 어디부터를 TR 로 보느냐에 따라 국면이 달라진다
  'wyckoff_ps', 'wyckoff_climax', 'wyckoff_ar', 'wyckoff_st',
  'wyckoff_spring_ut', 'wyckoff_test', 'wyckoff_sos_sow',
  'wyckoff_lps_lpsy', 'wyckoff_bu', 'wyckoff_utad', 'wyckoff_shakeout',
])

describe('잠긴 불변식 — 등급표', () => {
  it('B등급은 정확히 이 31종이다', () => {
    const actual = TAGS.filter((t) => t.confidence === 'B').map((t) => t.id).sort()
    expect(actual).toEqual([...GRADE_B].sort())
  })

  it('나머지는 전부 A다 — C등급은 아직 쓰지 않는다', () => {
    const notB = TAGS.filter((t) => !GRADE_B.has(t.id))
    const wrong = notB.filter((t) => t.confidence !== 'A').map((t) => `${t.id}=${t.confidence}`)
    expect(wrong).toEqual([])
  })

  it('등급이 세 값 중 하나이고 태그마다 정확히 하나씩 있다', () => {
    for (const t of TAGS) expect(['A', 'B', 'C'], `${t.id}`).toContain(t.confidence)
    expect(new Set(TAGS.map((t) => t.id)).size).toBe(TAGS.length)
  })
})

// ── 2. 게이트 상수 ───────────────────────────────────────────────────────────

/**
 * 게이트를 움직여 통과시키는 것은 이 저장소에서 가장 위험한 실패다.
 *
 * 실제 사례(Part 6): 30종이 들어오며 한 계열 중앙값이 16 이 되자 `MEDIAN_MAX` 가
 * 15 → 18 로 올라갔다. 최악 관측치보다 3 이나 위였다. 진짜 원인은 htf_trend 가
 * 사건이 아니라 상태로 발화해 혼자 유효 근거의 5.8% 를 먹은 것이었고, 그걸 고치니
 * 15 에서 10/10 통과했다. 천장을 올렸으면 다음 파트는 더 큰 값에서 같은 일을 한다.
 *
 * calibrate 의 exit code 는 "게이트를 통과했는가" 만 보고 "게이트가 그대로인가" 는
 * 못 본다. 그래서 상수 자체를 원문에서 읽어 고정한다.
 */
const GATE_CONSTANTS: Array<[file: string, decl: string, value: string]> = [
  ['scripts/calibrate.ts', 'MEDIAN_MIN', '8'],
  ['scripts/calibrate.ts', 'MEDIAN_MAX', '15'],
  ['scripts/calibrate.ts', 'MAX_FIRING_RATE', '150'],
  // BOS/CHoCH 라벨 오분류율 상한. 지금 실측이 14.5% 라 체크포인트 ⑤ 는 일부러 빨갛다 —
  // 그걸 초록으로 만드는 것이 인계 작업 A 다. **기준값을 올려서 통과시키는 길을 막는다.**
  ['scripts/calibrate.ts', 'LABEL_ERROR_MAX', '5'],
  ['src/quiz/scanner.ts', 'COARSE_SLACK', '100'],
]

describe('잠긴 불변식 — 게이트 상수', () => {
  it.each(GATE_CONSTANTS)('%s 의 %s 는 %s 이다', (file, decl, value) => {
    const src = readFileSync(file, 'utf8')
    const m = src.match(new RegExp(`^(?:export )?const ${decl}\\s*=\\s*(-?\\d+)`, 'm'))
    expect(m, `${file} 에서 const ${decl} 선언을 못 찾았다`).not.toBeNull()
    expect(
      m![1],
      `게이트를 움직여 통과시키려 한다면 멈춰라. 원인을 고쳐야 한다. ` +
      `정말 바꿔야 하면 사장에게 실측 근거와 함께 물어라.`,
    ).toBe(value)
  })
})

// ── 3. HTF 은닉 ──────────────────────────────────────────────────────────────

/**
 * **결정 시점 이후에 닫히는 상위 봉은 솔버에게 단 하나도 넘어가면 안 된다.**
 *
 * 이 검사가 없었다. Part 6 에서 htfCandles 가 Question 과 SolverView 에 추가됐는데,
 * 하위 봉의 은닉은 테스트로 잠겨 있는 반면 상위 봉은 아무 검사도 없었다. 구현은
 * 맞았지만 누가 solverView 의 필터 한 줄을 지워도 512개 테스트가 전부 초록이었다.
 *
 * 이건 이 제품에서 가장 치명적인 종류의 회귀다 — 4h 차트는 가렸는데 내일 일봉이
 * 보이면 문제가 그냥 풀린다. 채점이 통째로 거짓말이 된다.
 *
 * htf_* 3종이 A등급인 근거이기도 하다(위 1번 주석 참조).
 */
function htfHidingCase() {
  const tf = '4h' as const
  const htfTf = HIGHER_TF[tf]           // '1d'
  const t0 = 1600000000

  // 하위 4h 봉 90개 — 결정 봉은 60번(= 인덱스 59 이후 30봉이 은닉)
  const candles: Candle[] = Array.from({ length: 90 }, (_, i) => ({
    time: t0 + i * DURATION[tf], open: 100, high: 101, low: 99, close: 100, volume: 100,
  }))
  const decisionIndex = 59

  // 상위 1d 봉 20개 — 창 전체를 덮으므로 결정 시점 뒤에 닫히는 것이 반드시 섞인다
  const htfCandles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
    time: t0 + i * DURATION[htfTf], open: 100, high: 101, low: 99, close: 100, volume: 100,
  }))

  const q: Question = {
    symbol: 'T', timeframe: tf, startTime: candles[0].time,
    decisionIndex, type: 'normal', difficulty: 'medium', candles, htfCandles,
  }
  const decisionTime = candles[decisionIndex].time + DURATION[tf]
  return { q, htfTf, decisionTime }
}

describe('잠긴 불변식 — HTF 은닉', () => {
  it('픽스처 전제: 결정 시점 뒤에 닫히는 상위 봉이 실제로 섞여 있다', () => {
    // 이 전제가 깨지면 아래 검사가 공허해진다 — 가릴 것이 없는데 통과하는 셈이다.
    const { q, htfTf, decisionTime } = htfHidingCase()
    const future = q.htfCandles.filter((c) => c.time + DURATION[htfTf] > decisionTime)
    expect(future.length).toBeGreaterThan(0)
  })

  it('solverView 는 결정 시점까지 닫힌 상위 봉만 넘긴다', () => {
    const { q, htfTf, decisionTime } = htfHidingCase()
    const leaked = solverView(q).htfCandles.filter((c) => c.time + DURATION[htfTf] > decisionTime)
    expect(
      leaked.map((c) => new Date(c.time * 1000).toISOString()),
      '결정 시점 뒤에 닫히는 상위 봉이 솔버에게 샜다 — 문제가 그냥 풀린다',
    ).toEqual([])
  })

  it('solverView 가 하위 봉도 결정 봉까지만 넘긴다', () => {
    const { q } = htfHidingCase()
    expect(solverView(q).candles).toHaveLength(q.decisionIndex + 1)
  })

  it('SolverView 의 키는 정확히 넷이다 — 비밀 필드가 끼어들지 않는다', () => {
    const { q } = htfHidingCase()
    expect(Object.keys(solverView(q)).sort())
      .toEqual(['candles', 'difficulty', 'htfCandles', 'timeframe'])
  })
})
