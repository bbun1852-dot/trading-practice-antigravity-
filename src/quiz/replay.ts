import type { Answer, Question, ReplayResult } from './types'

/** 재생 대상이 없을 때 공통으로 쓰는 값 — 관망, 미체결, 필수 가격 누락이 전부 여기로 모인다. */
const NONE: ReplayResult = { filled: false, exit: 'none', exitBarIndex: null, pnlPct: 0, r: 0 }

/**
 * 은닉 구간(decisionIndex 다음 봉부터)을 봉 단위로 재생해 체결·청산을 시뮬레이션한다.
 *
 * **채점기 전용 소비자다** — `q.candles` 전체(은닉 봉 포함)를 그대로 읽는다.
 * `solverView(q)` 를 거치지 않는다: 그건 솔버가 풀 때 보는 투영을 만드는 함수고,
 * `replay` 는 답을 이미 받은 뒤 "실제로 어떻게 됐을지"를 계산하는 채점 쪽 로직이다.
 *
 * **체결 규칙(지정가 진입).** 봉의 [low, high] 구간이 entry 가격을 포함하면 그 봉에서
 * 체결된 것으로 본다.
 *
 * **체결이 일어난 바로 그 봉에서는 SL 은 인정하고 TP 는 인정하지 않는다(리뷰 C1
 * 수정 — 이전 버전은 둘 다 인정했고, 봉 모양에 따라 조작된 승패를 냈다).**
 *
 * 체결 조건 `low<=entry<=high` 가 성립했다는 건 그 봉 안에서 가격이 entry 를
 * 지나갔다는 사실은 확정하지만, "체결이 SL/TP 터치보다 봉 안에서 먼저였는지
 * 나중이었는지"는 OHLC 만으로 알 수 없다 — 이건 SL-vs-TP 동시 터치 문제와는
 * 별개의 순서 불확실성이다. 예:
 *
 * - 롱, entry=100·SL=50·TP=110, 봉 O=105 H=112 L=95 C=103(장대 음봉). 시가에서
 *   고가로 올라 TP(110)를 먼저 찍고, 그 다음 저가로 내려오며 entry(100)를 지나
 *   체결되는 경로가 있을 수 있다 — 이 경로라면 TP 는 체결 *전에* 지나간 것이라
 *   진짜 이익이 아니다. 하지만 반대 경로(체결 후 TP)도 OHLC 만으론 배제 못 한다.
 * - 롱, entry=100·SL=95, 봉 O=98 H=105 L=90 C=102(장대 양봉). 시가에서 저가로
 *   내려가 SL(95)을 먼저 찍고, 그 다음 고가로 올라오며 entry(100)를 지나
 *   체결되는 경로가 있을 수 있다 — 이 경로라면 SL 은 체결 *전*이라 진짜 손실이
 *   아니다. 하지만 반대 경로(체결 후 SL)도 배제 못 한다.
 *
 * 두 경우 모두 순서를 확정할 수 없으므로, 이 모듈 전체의 원칙("불리한 쪽을
 * 가정한다")을 체결 봉에도 똑같이 적용한다: 체결 봉에서는 불리한 쪽(SL)은
 * 인정하고 유리한 쪽(TP)은 인정하지 않는다. 위 두 예시는 각각 이 함수의
 * 테스트("리뷰어 반례" 로 표기)로 그대로 들어가 있다.
 *
 * 체결 다음 봉부터는 포지션이 이미 열려 있었다는 게 확실하므로 이 모호함
 * 자체가 없다 — SL/TP 둘 다 정상적으로, 그리고 **같은 봉에서 SL 과 TP 를
 * 모두 터치하면 SL 이 우선**한다(봉 안의 순서를 알 수 없으니 여전히 불리한
 * 쪽을 택한다).
 */
export function replay(q: Question, a: Answer): ReplayResult {
  if (a.direction === 'flat') return NONE
  // entry/stopLoss 가 없으면 체결 여부도 R 환산도 정의할 수 없다. "언젠가 닿았을
  // 수도 있다"고 얼버무리지 않고, 재생 불가 상태를 무체결과 동일하게 명시적으로
  // 취급한다 — ReplayResult 에는 "답이 불완전함"을 따로 표현할 필드가 없으므로,
  // 이것이 거짓 없이 표현할 수 있는 가장 정직한 값이다.
  if (a.entry === undefined || a.stopLoss === undefined) return NONE

  const { entry, stopLoss, takeProfit } = a
  const isLong = a.direction === 'long'
  const risk = Math.abs(entry - stopLoss)

  const toR = (exitPrice: number): number => {
    // risk===0(SL=entry)이면 R 배수의 분모가 0이라 정의되지 않는다 — NaN/Infinity 가
    // 채점 파이프라인으로 새어나가지 않도록 0으로 고정한다. 이 경우 체결 조건
    // (low<=entry<=high)과 SL 터치 조건(예: 롱은 low<=stopLoss=entry)이 대수적으로
    // 같아져서 체결되는 순간 항상 SL 도 함께 터진다 — exit 은 항상 'sl', r 은 항상
    // 0 으로 결정론적이다(테스트로 고정: "손절폭이 0이면…"). 그래서 손실 0인
    // 트레이드가 'tp' 나 'forced' 로 새서 이익처럼 보일 여지가 없다.
    if (risk === 0) return 0
    return (isLong ? exitPrice - entry : entry - exitPrice) / risk
  }
  const toPct = (exitPrice: number): number =>
    ((isLong ? exitPrice - entry : entry - exitPrice) / entry) * 100

  let filled = false
  let lastIndex = q.decisionIndex

  // 은닉 구간만 재생한다 — decisionIndex 까지는 솔버도 이미 본 화면이므로 재생
  // 대상이 아니다. 루프가 decisionIndex+1 부터 시작하는 것이 그 경계다.
  for (let j = q.decisionIndex + 1; j < q.candles.length; j++) {
    const c = q.candles[j]
    lastIndex = j

    const filledBefore = filled
    if (!filled) {
      if (c.low <= entry && entry <= c.high) filled = true
      else continue
    }
    // 이 봉에서 막 체결됐는가(직전 봉까지는 미체결이었는가) — 위 함수 설명의
    // 체결-봉 규칙이 이 플래그로 갈린다.
    const justFilled = !filledBefore

    const hitSl = isLong ? c.low <= stopLoss : c.high >= stopLoss
    // 체결이 막 이 봉에서 일어났다면 TP 는 인정하지 않는다(justFilled 가드) —
    // 체결과 TP 터치의 봉 내 순서를 알 수 없으니 유리한 쪽을 가정하지 않는다.
    // SL 은 justFilled 여부와 무관하게 그대로 인정한다(불리한 쪽이라 봉 순서를
    // 몰라도 안전하게 가정할 수 있다).
    const hitTp = takeProfit !== undefined && !justFilled
      ? (isLong ? c.high >= takeProfit : c.low <= takeProfit)
      : false

    // SL 을 먼저 검사한다 — 순서 자체가 "동시 터치 시 SL 우선" 규칙의 구현이다.
    // (체결 봉에서는 hitTp 가 이미 justFilled 로 걸러져 있으므로, 이 순서는
    // 체결 *다음* 봉부터 SL/TP 가 같이 터지는 경우에만 실제로 작동한다.)
    if (hitSl) {
      return { filled: true, exit: 'sl', exitBarIndex: j, pnlPct: toPct(stopLoss), r: toR(stopLoss) }
    }
    if (hitTp) {
      return { filled: true, exit: 'tp', exitBarIndex: j, pnlPct: toPct(takeProfit!), r: toR(takeProfit!) }
    }
  }

  if (!filled) return NONE

  // 은닉 구간이 끝나도록 SL/TP 어느 쪽도 안 터지면, 마지막 봉의 종가로 강제 청산한다.
  const close = q.candles[lastIndex].close
  return { filled: true, exit: 'forced', exitBarIndex: lastIndex, pnlPct: toPct(close), r: toR(close) }
}
