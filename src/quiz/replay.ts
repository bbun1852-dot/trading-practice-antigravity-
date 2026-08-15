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
 * **체결이 일어난 바로 그 봉에서는 SL 은 인정하고, TP 는 "확실할 때만" 인정한다
 * (리뷰 C1 → C2 두 차례 수정).**
 *
 * 체결 조건 `low<=entry<=high` 가 성립했다는 건 그 봉 안에서 가격이 entry 를
 * 지나갔다는 사실은 확정하지만, "체결이 SL/TP 터치보다 봉 안에서 먼저였는지
 * 나중이었는지"는 OHLC 만으로 알 수 없다 — 이건 SL-vs-TP 동시 터치 문제와는
 * 별개의 순서 불확실성이다(C1). 그런데 이 불확실성이 **항상** 있는 건 아니다 —
 * 종가(close)는 봉이 끝나는 순간의 값이라 체결보다 반드시 나중이다. 그래서
 * entry(체결가)에서 close 까지 이어지는 구간은 전부 체결 *이후*로 확정되고,
 * 그 구간 안에 TP 가 끼어 있으면(롱: close>=TP, 숏: close<=TP) 중간값 정리에
 * 의해 그 구간에서 TP 를 반드시 지나간다 — 순서가 봉 모양과 무관하게 증명된다
 * (C2). 이 경우까지 무조건 봉쇄하면, 아래 "체결 봉에서 TP 를 인정 못 하니
 * 마지막 종가로 강제 청산" 폴백이 **TP 상한 없이** close 값을 그대로 써버려서,
 * TP 를 정직하게 인정하는 것보다 오히려 더 큰 승리를 만들어낸다(리뷰 C2가
 * 발견한 사례 — 이건 "불리한 쪽을 가정한다"는 원칙과 정반대 방향의 결함이다).
 *
 * 예(리뷰어 반례, 아래 두 갈래):
 *
 * - **불확실 — 봉쇄** (CE1). 롱, entry=100·SL=50·TP=110, 봉 O=105 H=112 L=95
 *   C=103(장대 음봉). 시가에서 고가로 올라 TP(110)를 먼저 찍고, 그 다음
 *   저가로 내려오며 entry(100)를 지나 체결되는 경로가 있을 수 있다 — 이
 *   경로라면 TP 는 체결 *전* 이벤트라 진짜 이익이 아니다. close(103)가 TP
 *   에 못 미치므로("close<TP" 는 "체결 이후 구간이 TP 까지 갔다"는 증거가
 *   못 된다) 확정할 수 없다 — 봉쇄하고 마지막 종가(103)로 강제 청산한다.
 * - **확실 — 인정** (C2 반례). 롱, entry=100·SL=90·TP=105, 봉 O=101 H=112
 *   L=99 C=110. close(110)가 이미 TP(105)를 넘었으므로, 봉 안의 정확한 경로와
 *   무관하게 entry→close 구간에서 TP 를 반드시 지나갔다 — TP 로 청산한다
 *   (exitPrice=105, close 가 아니라 TP 가격 그대로 쓴다 — "확실히 지나갔다"는
 *   것이지 "TP 이후에도 얼마나 더 갔는지"는 여전히 모른다).
 *
 * SL 쪽에는 이런 "봉쇄 후 확실할 때만 해제" 로직이 없다 — 대신 SL 은 애초에
 * 무조건 인정한다. 대칭이 깨진 게 아니라, 두 쪽 다 "불리한 쪽을 가정한다"는
 * 같은 원칙의 서로 다른 결과다: TP(유리한 쪽)는 확실하지 않으면 인정하지
 * 않는 것이 불리한 가정이고, SL(불리한 쪽)은 확실하지 않아도 인정하는 것이
 * 불리한 가정이다 — 같은 원칙이 방향에 따라 반대 행동으로 나타날 뿐이다.
 * (SL 쪽에서 "확실히 체결 전"임을 증명하는 대칭 논증도 검토했다 — close 를
 * 이용한 중간값 정리는 "close 가 SL 을 넘어섰다"는 조건에서는 SL 쪽에도
 * 똑같이 적용되지만, 그 결론은 이미 무조건 인정하는 현재 동작의 부분집합이라
 * 새로 바뀌는 게 없다. "확실히 체결 *전*"이라는 반대 방향 증명은 시가·저가
 * 같은 체결 이전 구간에 대한 가정 없이는 성립하지 않는데, 그런 가정은 C1 이
 * 명시적으로 거부한 "봉 내부 경로 모델"이라 도입하지 않는다 — 자세한 계산은
 * 리포트 Fix Round 2 참고.)
 *
 * 체결 봉에서 TP 도, SL 도 확정되지 않으면(폭이 좁아 둘 다 안 닿거나, TP 만
 * 닿았는데 봉쇄된 경우) 포지션은 그대로 다음 봉으로 이어진다 — 그 다음 봉에서
 * 진짜 SL 을 맞을 수도 있다(리포트의 "연쇄 사례" 참고, 이것도 봉 모양에
 * 부합하는 정상적인 결과다).
 *
 * 체결 다음 봉부터는 포지션이 이미 열려 있었다는 게 확실하므로 이 모호함
 * 자체가 없다 — SL/TP 둘 다 정상적으로, 그리고 **같은 봉에서 SL 과 TP 를
 * 모두 터치하면 SL 이 우선**한다(봉 안의 순서를 알 수 없으니 여전히 불리한
 * 쪽을 택한다). 체결 봉에서도 이 우선순위는 그대로다 — SL 이 닿았고 TP 도
 * "확실" 조건을 만족하더라도 SL 이 이긴다(아래 hitSl 검사가 먼저다): SL 터치가
 * TP 확정 전이었는지 후였는지는 여전히 모르므로, 그 쌍은 여전히 불확실하고
 * 보수적 규칙이 적용된다.
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

    // 체결 봉에서 TP 가 "확실"한가 — entry(체결가)에서 close 까지는 체결 이후
    // 구간으로 확정되므로, close 가 이미 TP 를 넘어섰다면(롱: close>=TP, 숏:
    // close<=TP) 중간값 정리로 그 구간에서 TP 를 반드시 지나간다(리뷰 C2).
    // 체결 봉이 아니면(justFilled=false) 이 확실성 여부와 무관하게 항상 TP 를
    // 정상 판정한다 — 애초에 순서 문제 자체가 없기 때문이다.
    const tpCertainOnFillBar = takeProfit !== undefined
      ? (isLong ? c.close >= takeProfit : c.close <= takeProfit)
      : false
    // 체결이 막 이 봉에서 일어났고, 위 확실성 조건도 못 만족하면 TP 를 인정하지
    // 않는다 — 체결과 TP 터치의 봉 내 순서를 알 수 없으니 유리한 쪽을 가정하지
    // 않는다. SL 은 justFilled 여부와 무관하게 그대로 인정한다(불리한 쪽이라
    // 봉 순서를 몰라도 안전하게 가정할 수 있다 — SL 쪽엔 이런 예외가 없다).
    const tpBlocked = justFilled && !tpCertainOnFillBar
    const hitTp = takeProfit !== undefined && !tpBlocked
      ? (isLong ? c.high >= takeProfit : c.low <= takeProfit)
      : false

    // SL 을 먼저 검사한다 — 순서 자체가 "동시 터치 시 SL 우선" 규칙의 구현이다.
    // 체결 봉에서 TP 가 확실(tpCertainOnFillBar)해도 이 순서는 그대로 적용된다 —
    // "SL 터치가 TP 확정보다 먼저였는지"는 여전히 알 수 없는 별개의 문제라서다.
    if (hitSl) {
      return { filled: true, exit: 'sl', exitBarIndex: j, pnlPct: toPct(stopLoss), r: toR(stopLoss) }
    }
    if (hitTp) {
      return { filled: true, exit: 'tp', exitBarIndex: j, pnlPct: toPct(takeProfit!), r: toR(takeProfit!) }
    }
  }

  if (!filled) return NONE

  // 은닉 구간이 끝나도록 SL/TP 어느 쪽도 안 터지면, 마지막 봉의 종가로 강제 청산한다.
  // (리뷰 C2 관련 메모: 체결 봉이 봉쇄된 TP 때문에 여기로 떨어지는 경우, 봉쇄
  // 조건 자체가 "close < TP(롱) / close > TP(숏)" 이므로 이 close 값은 구조적으로
  // TP 를 절대 넘지 않는다 — TP 를 정직하게 인정했을 때보다 더 큰 승리를 주는
  // 일이 생길 수 없다. TP 가 확실했던 경우는 위 tpCertainOnFillBar 분기에서
  // 이미 반환되고 여기까지 오지 않는다.)
  const close = q.candles[lastIndex].close
  return { filled: true, exit: 'forced', exitBarIndex: lastIndex, pnlPct: toPct(close), r: toR(close) }
}
