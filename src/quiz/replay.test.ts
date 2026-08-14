import { describe, it, expect } from 'vitest'
import { replay } from './replay'
import type { Answer, Question } from './types'
import type { Candle } from '../data/types'
import { mk } from '../analysis/fixtures'

/**
 * decisionIndex=1, 은닉 구간을 직접 지정해 만든 최소 문제.
 * index0/1(=decisionIndex)은 항상 100 근방(99~101)에 머무는 평평한 봉이다 —
 * "결정 봉 이하는 재생하지 않는다" 테스트가 이 평탄함에 기대어 경계를 검증한다.
 */
const q = (hidden: Candle[]): Question => ({
  symbol: 'T', timeframe: '4h', startTime: 0, decisionIndex: 1,
  type: 'normal', difficulty: 'medium',
  candles: [mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1), ...hidden],
  htfCandles: [],
})

const long: Answer = { direction: 'long', entry: 100, stopLoss: 95, takeProfit: 110, tags: [] }
const short: Answer = { direction: 'short', entry: 100, stopLoss: 105, takeProfit: 90, tags: [] }

describe('replay', () => {
  describe('롱', () => {
    it('체결 다음 봉에서 TP 를 터치하면 익절이다', () => {
      // bar2 에서 체결만 되고(SL/TP 어느 쪽도 안 닿음), bar3(체결 다음 봉)에서
      // TP 가 터진다 — TP 는 체결 봉 자체에서는 인정하지 않으므로(리뷰 C1),
      // "TP 로 익절" 을 검증하려면 반드시 봉을 나눠야 한다.
      const r = replay(
        q([mk(100, 102, 99, 101, 100, 2), mk(101, 111, 100, 110, 100, 3)]),
        long,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('tp')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(2, 5) // (110-100)/(100-95) = 2R
      expect(r.pnlPct).toBeCloseTo(10, 5)
    })

    it('[리뷰어 반례 CE2] 체결 봉에서도 SL 은 보수적으로 유효하다', () => {
      // entry=100·SL=95, 봉 O=98 H=105 L=90 C=102(장대 양봉). 실제 봉 내부 경로가
      // O→L→H→C 라면 저가(90)에서 SL(95)을 이미 지나간 뒤에야 entry(100)를
      // 지나 체결됐을 수 있다 — 그렇다면 SL 은 체결 *전* 이벤트라 진짜 손실이
      // 아니다. 하지만 그 반대 순서(체결 후 SL)도 OHLC 만으로는 배제할 수 없다.
      // 순서를 모르니 불리한 쪽(SL 유효)을 택한다 — 이게 여전히 'sl' 이 맞는
      // 이유다. TP 는 없으므로 순서 문제와 무관하게 애초에 등장하지 않는다.
      const a: Answer = { direction: 'long', entry: 100, stopLoss: 95, tags: [] }
      const r = replay(q([mk(98, 105, 90, 102, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('[리뷰어 반례 CE1] 체결 봉에서는 TP 가 조작된 승리를 만들지 않는다 — 불확실한 경우', () => {
      // entry=100·SL=50·TP=110, 봉 O=105 H=112 L=95 C=103(장대 음봉). 이전 구현은
      // 이 봉에서 체결과 TP 터치를 모두 인정해 'tp', r=0.2 를 냈다 — 하지만 실제
      // 봉 내부 경로가 O→H→L→C 라면 고가(112)에서 TP(110)를 이미 지나간 뒤에야
      // 저가로 내려오며 entry(100)를 지나 체결됐을 수 있다. 그 경로라면 TP 는
      // 체결 *전* 이벤트라 진짜 이익이 아니다 — 체결도, 반대쪽 SL(50)도 이 봉
      // 안에서 터지지 않으므로, 은닉 구간이 여기서 끝나면 마지막 종가로
      // 강제청산해야 한다. close(103)가 TP(110)에 못 미치므로(리뷰 C2 의 "확실"
      // 조건 close>=TP 를 만족하지 못한다) 여전히 불확실하다 — 아래 "확실한
      // 경우" 테스트와 대조된다.
      const a: Answer = { direction: 'long', entry: 100, stopLoss: 50, takeProfit: 110, tags: [] }
      const r = replay(q([mk(105, 112, 95, 103, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('forced')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo((103 - 100) / 50, 5)
      expect(r.pnlPct).toBeCloseTo(3, 5)
    })

    it('[리뷰 C2] 체결 봉이라도 종가가 TP 를 넘었으면 확실하니 TP 로 인정한다', () => {
      // 리뷰어가 낸 반례: entry=100·SL=90·TP=105, 봉 O=101 H=112 L=99 C=110.
      // 이전(C1 직후) 구현은 체결 봉의 TP 를 무조건 봉쇄했다 — 그러면 이 봉에서
      // SL/TP 어느 쪽도 안 터진 것으로 처리돼 마지막 종가(110)로 강제청산되고,
      // r=(110-100)/10=1 이 나온다. 이건 TP 를 정직하게 인정했을 때(r=0.5)보다
      // 오히려 *두 배* 큰 승리다 — "불리한 쪽을 가정한다"는 원칙과 정반대다.
      // close(110)가 이미 TP(105)를 넘었으므로, 체결가(100)에서 종가(110)까지
      // 이어지는 구간(전부 체결 이후로 확정)이 중간값 정리에 의해 TP 를 반드시
      // 지나간다 — 순서가 봉 모양과 무관하게 증명되므로 이번엔 인정해야 한다.
      const a: Answer = { direction: 'long', entry: 100, stopLoss: 90, takeProfit: 105, tags: [] }
      const r = replay(q([mk(101, 112, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('tp')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(0.5, 5) // (105-100)/(100-90)
      expect(r.pnlPct).toBeCloseTo(5, 5) // (105-100)/100*100
    })

    it('[리뷰 C2] 종가가 TP 와 정확히 같은 경계에서도 확실로 취급해 인정한다', () => {
      // close===takeProfit 인 경계 — ">=" 를 쓰므로 여기서도 "확실" 쪽으로 판정된다.
      const a: Answer = { direction: 'long', entry: 100, stopLoss: 90, takeProfit: 105, tags: [] }
      const r = replay(q([mk(101, 112, 99, 105, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('tp')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(0.5, 5)
      expect(r.pnlPct).toBeCloseTo(5, 5)
    })

    it('[리뷰 C2] 체결 봉에서 SL 도 닿고 TP 확정 조건도 만족하면 그래도 SL 이 우선한다', () => {
      // 종가(107)가 TP(105)를 넘어 "확실" 조건을 만족하지만, 같은 봉의 저가(90)가
      // SL(95)도 건드린다 — SL 터치가 TP 확정보다 먼저였는지는 여전히 알 수
      // 없으므로(그 쌍 자체는 여전히 불확실하다) 기존 우선순위(SL 먼저 검사)가
      // 그대로 적용돼 'sl' 이 나와야 한다. C2 수정이 SL 우선순위를 깨지 않는지
      // 확인하는 테스트다.
      const a: Answer = { direction: 'long', entry: 100, stopLoss: 95, takeProfit: 105, tags: [] }
      const r = replay(q([mk(101, 112, 90, 107, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('체결 봉에서 SL·TP 가 둘 다 구조적으로 닿아도 결과는 같다(TP 봉쇄가 먼저 적용된다)', () => {
      // 이 봉은 SL(95)과 TP(110) 양쪽 조건을 다 만족하지만, 체결 봉이므로 TP 는
      // justFilled 가드에서 이미 걸러진다 — hitSl/hitTp 검사 순서와 무관하게
      // 'sl' 이 나온다(검사 순서에 의존하는 시나리오는 아래 별도 테스트가 맡는다).
      const r = replay(q([mk(100, 111, 94, 100, 100, 2)]), long)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('체결 다음 봉에서 SL 과 TP 를 모두 터치하면 SL 이 우선한다(검사 순서 의존)', () => {
      // bar2 에서 체결만 되고, bar3(체결 다음 봉, justFilled=false)에서 SL·TP 가
      // 동시에 터진다 — 이 봉은 체결 봉이 아니므로 justFilled 가드가 적용되지
      // 않는다. 여기서만 hitSl/hitTp 검사 순서가 실제로 결과를 가른다.
      const r = replay(
        q([mk(100, 102, 99, 101, 100, 2), mk(101, 111, 94, 100, 100, 3)]),
        long,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('[연쇄 사례] 체결 봉에서 TP 가 봉쇄되고 살아남은 포지션이 다음 봉에서 진짜 SL 을 맞는다', () => {
      // 리뷰가 승인하되 문서화를 요구한 사례. bar2: entry=100·SL=90·TP=110, 봉
      // O=101 H=112 L=99 C=105 — close(105)가 TP(110)에 못 미치므로 여전히
      // 불확실해 봉쇄된다(위 CE1 과 같은 종류). 봉쇄됐다고 트레이드가 끝나는
      // 게 아니라 포지션이 열린 채로 다음 봉으로 넘어간다 — bar3 에서 진짜
      // SL(90)을 맞으면 그대로 손실 처리된다. 이건 "체결 봉에서 안 터지면
      // 무조건 이 봉에서 강제청산"이 아니라 "포지션이 살아있는 채로 계속
      // 재생된다"는 걸 보여준다 — bar2 가 봉쇄됐어도 이후 봉은 정상적으로
      // SL/TP 를 판정한다(justFilled 가 bar3 에서는 이미 false 이므로).
      const r = replay(
        q([mk(101, 112, 99, 105, 100, 2), mk(104, 106, 88, 90, 100, 3)]),
        { direction: 'long', entry: 100, stopLoss: 90, takeProfit: 110, tags: [] },
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-10, 5)
    })

    it('진입가에 닿지 않으면 미체결이다', () => {
      const a: Answer = { ...long, entry: 50 }
      const r = replay(q([mk(100, 101, 99, 100, 100, 2)]), a)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('은닉 구간 안에 청산되지 않으면 마지막 종가로 강제 청산한다', () => {
      // (리뷰 Minor 정정) bar3(청산 봉)의 범위를 [101,103]으로 둬서 entry(100)를
      // 포함하지 않게 했다 — filled 상태 유지 여부와 무관하게 이 봉만 봐서는
      // 체결 조건을 만족하지 못하므로, I2 류 회귀에도 진단력이 생긴다.
      const r = replay(q([mk(100, 102, 99, 101, 100, 2), mk(101, 103, 101, 102, 100, 3)]), long)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('forced')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo((102 - 100) / 5, 5)
      expect(r.pnlPct).toBeCloseTo(2, 5)
    })

    it('체결 봉과 청산 봉이 다를 수 있다 — 청산 봉이 entry 를 포함하지 않아도 SL 이 터진다', () => {
      // (리뷰 I2 수정) bar3(청산 봉)의 범위 [80,96] 은 entry(100)를 포함하지
      // 않는다 — 만약 구현이 "그 봉의 범위가 entry 를 포함할 때만 filled 로
      // 취급"하는 식으로 매 봉 다시 계산한다면(즉 filled 상태를 봉 사이에서
      // 유지하지 못하는 회귀가 생긴다면), 이 봉에서 SL 판정 자체를 안 하게 되어
      // 결과가 달라진다. filled 가 봉을 넘어 정말 유지되는지는 이 테스트가
      // 아니면 잡히지 않는다(entry 를 포함하는 청산 봉으로는 상태 없이 매번
      // 다시 계산해도 우연히 같은 결과가 나온다).
      const r = replay(
        q([mk(100, 102, 99, 101, 100, 2), mk(90, 96, 80, 85, 100, 3)]),
        long,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('takeProfit 이 없으면 TP 로는 청산되지 않는다 — 강제청산으로 빠진다', () => {
      // 값만 보면 TP=110 을 터치할 법한 봉이지만, takeProfit 을 아예 안 정했으므로
      // hitTp 판정 자체가 없다 — 마지막 종가로 강제 청산해야 한다.
      const a: Answer = { ...long, takeProfit: undefined }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('forced')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(2, 5)
      expect(r.pnlPct).toBeCloseTo(10, 5)
    })

    it('entry 가 없으면 재생하지 않는다', () => {
      const a: Answer = { ...long, entry: undefined }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('stopLoss 가 없으면 재생하지 않는다', () => {
      const a: Answer = { ...long, stopLoss: undefined }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('손절폭이 0이면 r 은 0이고, 체결과 동시에 SL 로 처리된다', () => {
      // entry===stopLoss 면 체결 조건(low<=entry<=high)과 SL 터치 조건(long: low<=stopLoss)이
      // 대수적으로 같아진다 — 체결되는 순간 항상 SL 도 함께 터진다. 이 픽스처는
      // close(110)가 TP(110)와 같아 리뷰 C2 의 "확실" 조건도 함께 만족한다 —
      // 그래서 hitTp 도 true 가 될 수 있는 상태지만, hitSl 을 먼저 검사하는
      // 우선순위 덕에 여전히 'sl' 이 나온다(검사 순서를 실제로 뒤집으면 이
      // 테스트도 깨진다 — Fix Round 2 리포트의 순서 재검증 참고). r=0 자체는
      // toR 의 risk===0 가드가 검사 순서와 무관하게 보장한다.
      const a: Answer = { ...long, stopLoss: 100 }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('결정 봉 이하는 재생 대상이 아니다 — 결정 봉이 진입가를 포함해도 무시한다', () => {
      // 결정 봉(index1)은 low=99/high=101 이라 entry=100 을 포함하지만, 이건 솔버가
      // 이미 본 화면이라 재생 대상이면 안 된다. 은닉 봉은 entry(100)와 전혀 무관한
      // 범위(199~201)라서, 루프가 decisionIndex+1 부터 도는 구현이면 끝까지 미체결이어야
      // 한다. 만약 구현이 실수로 decisionIndex 부터(결정 봉 포함) 돈다면 결정 봉에서
      // 체결된 뒤 은닉 봉의 고가(201)가 TP(110)를 넘어서 잘못 청산된다.
      const r = replay(q([mk(200, 201, 199, 200, 100, 2)]), long)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
    })
  })

  describe('숏 (롱과 대칭)', () => {
    it('체결 다음 봉에서 TP 를 터치하면 익절이다', () => {
      const r = replay(
        q([mk(100, 101, 99, 100, 100, 2), mk(99, 100, 89, 90, 100, 3)]),
        short,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('tp')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(2, 5)
      expect(r.pnlPct).toBeCloseTo(10, 5)
    })

    it('[리뷰어 반례 CE2] 체결 봉에서도 SL 은 보수적으로 유효하다', () => {
      const a: Answer = { direction: 'short', entry: 100, stopLoss: 105, tags: [] }
      const r = replay(q([mk(98, 108, 90, 102, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('[리뷰어 반례 CE1] 체결 봉에서는 TP 가 조작된 승리를 만들지 않는다 — 불확실한 경우', () => {
      // close(92)가 TP(90)에 못 미치므로(숏은 close<=TP 가 "확실" 조건) 여전히
      // 불확실하다 — 아래 "확실한 경우" 테스트와 대조된다.
      const a: Answer = { direction: 'short', entry: 100, stopLoss: 150, takeProfit: 90, tags: [] }
      const r = replay(q([mk(95, 101, 85, 92, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('forced')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo((100 - 92) / 50, 5)
      expect(r.pnlPct).toBeCloseTo(8, 5)
    })

    it('[리뷰 C2] 체결 봉이라도 종가가 TP 를 넘었으면 확실하니 TP 로 인정한다', () => {
      // 롱 반례(entry100·SL90·TP105, 봉 O101 H112 L99 C110)를 숏으로 대칭
      // 구성했다: entry=100·SL=110·TP=95, 봉 O=99 H=101 L=88 C=90. close(90)가
      // 이미 TP(95)를 넘어(숏이므로 아래로) 확실하다.
      const a: Answer = { direction: 'short', entry: 100, stopLoss: 110, takeProfit: 95, tags: [] }
      const r = replay(q([mk(99, 101, 88, 90, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('tp')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(0.5, 5) // (100-95)/(110-100)
      expect(r.pnlPct).toBeCloseTo(5, 5)
    })

    it('[리뷰 C2] 종가가 TP 와 정확히 같은 경계에서도 확실로 취급해 인정한다', () => {
      const a: Answer = { direction: 'short', entry: 100, stopLoss: 110, takeProfit: 95, tags: [] }
      const r = replay(q([mk(99, 101, 88, 95, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('tp')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(0.5, 5)
      expect(r.pnlPct).toBeCloseTo(5, 5)
    })

    it('[리뷰 C2] 체결 봉에서 SL 도 닿고 TP 확정 조건도 만족하면 그래도 SL 이 우선한다', () => {
      const a: Answer = { direction: 'short', entry: 100, stopLoss: 105, takeProfit: 95, tags: [] }
      const r = replay(q([mk(99, 106, 88, 93, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('체결 봉에서 SL·TP 가 둘 다 구조적으로 닿아도 결과는 같다(TP 봉쇄가 먼저 적용된다)', () => {
      const r = replay(q([mk(100, 106, 89, 100, 100, 2)]), short)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('체결 다음 봉에서 SL 과 TP 를 모두 터치하면 SL 이 우선한다(검사 순서 의존)', () => {
      const r = replay(
        q([mk(100, 101, 99, 100, 100, 2), mk(100, 106, 89, 95, 100, 3)]),
        short,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('[연쇄 사례] 체결 봉에서 TP 가 봉쇄되고 살아남은 포지션이 다음 봉에서 진짜 SL 을 맞는다', () => {
      // 롱 연쇄 사례의 대칭: entry=100·SL=110·TP=90. bar2: O=99 H=105 L=88 C=95 —
      // close(95)가 TP(90)를 못 넘어 여전히 불확실해 봉쇄된다. bar3: O=96 H=111
      // L=91 C=95 에서 진짜 SL(110)을 맞는다(저가를 91로 둬서 TP(90)는 건드리지
      // 않는다 — 이 봉이 SL 우선순위 검사와까지 우연히 얽히지 않도록 분리했다).
      const r = replay(
        q([mk(99, 105, 88, 95, 100, 2), mk(96, 111, 91, 95, 100, 3)]),
        { direction: 'short', entry: 100, stopLoss: 110, takeProfit: 90, tags: [] },
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-10, 5)
    })

    it('진입가에 닿지 않으면 미체결이다', () => {
      const a: Answer = { ...short, entry: 200 }
      const r = replay(q([mk(100, 101, 99, 100, 100, 2)]), a)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('은닉 구간 안에 청산되지 않으면 마지막 종가로 강제 청산한다', () => {
      // (리뷰 Minor 정정) bar3(청산 봉)의 범위를 [97,99]로 둬서 entry(100)를
      // 포함하지 않게 했다.
      const r = replay(
        q([mk(100, 101, 99, 100, 100, 2), mk(99, 99, 97, 98, 100, 3)]),
        short,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('forced')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo((100 - 98) / 5, 5)
      expect(r.pnlPct).toBeCloseTo(2, 5)
    })

    it('체결 봉과 청산 봉이 다를 수 있다 — 청산 봉이 entry 를 포함하지 않아도 SL 이 터진다', () => {
      // (리뷰 I2 수정) bar3 의 범위 [102,112] 는 entry(100)를 포함하지 않는다.
      const r = replay(
        q([mk(100, 101, 99, 100, 100, 2), mk(108, 112, 102, 106, 100, 3)]),
        short,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('손절폭이 0이면 r 은 0이고, 체결과 동시에 SL 로 처리된다', () => {
      // 롱 버전과 달리 여기서는 close(110)가 short 의 takeProfit(90)과 멀어
      // "확실" 조건(close<=TP)을 만족하지 못한다 — 그래서 TP 는 justFilled
      // 가드로 계속 봉쇄되고, 이 테스트는 검사 순서와 무관하게 항상 'sl' 이다
      // (롱 버전만 이 봉의 close 가 우연히 takeProfit=110 과 같아서 순서에
      // 의존한다 — 실제로 순서를 뒤집어 확인했다, Fix Round 2 리포트 참고).
      const a: Answer = { ...short, stopLoss: 100 }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })
  })

  describe('관망', () => {
    it('관망이면 entry/stopLoss 를 채워놨어도 재생하지 않는다', () => {
      // (리뷰 I1 수정) 이전 테스트는 entry/stopLoss 가 둘 다 undefined 인 Answer 를
      // 썼는데, 그러면 flat 분기를 지워도 바로 다음의 "entry/stopLoss 없음" 가드가
      // 똑같이 NONE 을 반환해서 이 테스트는 flat 분기를 지운 뒤에도 그대로
      // 통과한다(공허한 테스트). 실제로 flat 가드가 막아야 하는 시나리오는
      // "이전 답에서 entry/stopLoss 를 채웠다가 관망으로 바꾼 경우" — 값이 남아
      // 있는 채로 flat 가드만 지켜야 한다. entry/stopLoss 를 채워 넣으면: flat
      // 가드가 없을 경우 `isLong = (a.direction === 'long')` 이 'flat' !== 'long'
      // 이라 false 가 되어 숏처럼 재생되고, 이 픽스처(entry=100 이 봉 범위 안,
      // stopLoss=95 가 short 식 SL 조건 high>=95 를 항상 만족)는 filled:true,
      // exit:'sl', r=1 이라는 0 아닌 결과를 낸다 — 그래서 flat 가드가 사라지면
      // 이 테스트가 확실히 깨진다.
      const a: Answer = { direction: 'flat', entry: 100, stopLoss: 95, takeProfit: 110, tags: [] }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })
  })
})
