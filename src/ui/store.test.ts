import { describe, it, expect, beforeEach } from 'vitest'
import { useQuizStore, hiddenCount } from './store'
import { stubQuestion } from './dev/stubQuestion'

/**
 * 화면 상태 머신의 성질을 잠근다 (스펙 §7).
 *
 * 핵심은 두 가지다 — (1) 전이는 정해진 경로로만 일어나고, 맞지 않는 단계의
 * 액션은 **무시된다**. (2) 재생 카운터는 단조 증가하고 은닉 봉 수를 넘지 않는다.
 */

const store = useQuizStore

/** zustand 는 모듈 싱글턴이라 테스트마다 초기 상태로 되돌린다 */
beforeEach(() => {
  store.setState({
    phase: 'idle',
    notebookOpen: false,
    view: null,
    question: null,
    draft: { direction: null, tags: new Set(), memo: '' },
    report: null,
    replay: { revealed: 0, playing: false, speed: 1 },
  })
})

const toAnswering = () => {
  store.getState().start()
  store.getState().questionReady(stubQuestion())
}

describe('상태 머신 — 정상 경로', () => {
  it('idle → loading → answering → replaying → review → loading 을 완주한다', () => {
    expect(store.getState().phase).toBe('idle')
    store.getState().start()
    expect(store.getState().phase).toBe('loading')
    store.getState().questionReady(stubQuestion())
    expect(store.getState().phase).toBe('answering')
    store.getState().setDirection('long')
    store.getState().submit()
    expect(store.getState().phase).toBe('replaying')
    store.getState().replayDone()
    expect(store.getState().phase).toBe('review')
    store.getState().next()
    expect(store.getState().phase).toBe('loading')
  })

  it('questionReady 가 view 를 solverView 로 파생한다 — 키 4개, 결정 봉까지만', () => {
    toAnswering()
    const s = store.getState()
    expect(Object.keys(s.view!).sort()).toEqual(['candles', 'difficulty', 'htfCandles', 'timeframe'])
    expect(s.view!.candles).toHaveLength(s.question!.decisionIndex + 1)
  })

  it('next 는 이전 문제의 흔적을 전부 지운다', () => {
    toAnswering()
    store.getState().setDirection('long')
    store.getState().toggleTag('fvg_bull')
    store.getState().submit()
    store.getState().replayDone()
    store.getState().next()
    const s = store.getState()
    expect(s.view).toBeNull()
    expect(s.question).toBeNull()
    expect(s.draft.direction).toBeNull()
    expect(s.draft.tags.size).toBe(0)
    expect(s.replay.revealed).toBe(0)
  })
})

describe('상태 머신 — 잘못된 단계의 액션은 무시된다', () => {
  it('idle 에서 submit·replayTick·next 는 아무 일도 하지 않는다', () => {
    store.getState().submit()
    store.getState().replayTick()
    store.getState().next()
    expect(store.getState().phase).toBe('idle')
  })

  it('answering 이 아닐 때 questionReady 는 무시된다 — 늦게 도착한 문제가 진행 중인 판을 덮지 않는다', () => {
    toAnswering()
    const q1 = store.getState().question
    store.getState().questionReady(stubQuestion())
    expect(store.getState().question).toBe(q1)
  })

  it('방향을 고르지 않으면 submit 이 막힌다', () => {
    toAnswering()
    store.getState().submit()
    expect(store.getState().phase).toBe('answering')
  })

  it('review 단계에서는 draft 를 고칠 수 없다 — 채점 뒤 답안 조작 방지', () => {
    toAnswering()
    store.getState().setDirection('long')
    store.getState().submit()
    store.getState().replayDone()
    store.getState().toggleTag('fvg_bull')
    store.getState().setDirection('short')
    const d = store.getState().draft
    expect(d.tags.size).toBe(0)
    expect(d.direction).toBe('long')
  })
})

describe('재생 카운터', () => {
  it('단조 증가하고 은닉 봉 수에서 멈춘다', () => {
    toAnswering()
    const cap = hiddenCount(store.getState().question!)
    expect(cap).toBeGreaterThan(0)
    store.getState().setDirection('flat')
    store.getState().submit()
    for (let i = 0; i < cap + 10; i++) store.getState().replayTick()
    expect(store.getState().replay.revealed).toBe(cap)
  })

  it('replaying 이 아니면 tick 이 무시된다', () => {
    toAnswering()
    store.getState().replayTick()
    expect(store.getState().replay.revealed).toBe(0)
  })
})

describe('오답노트 축', () => {
  it('어느 단계에서든 열고 닫아도 phase 가 변하지 않는다', () => {
    toAnswering()
    store.getState().openNotebook()
    expect(store.getState().notebookOpen).toBe(true)
    expect(store.getState().phase).toBe('answering')
    store.getState().closeNotebook()
    expect(store.getState().notebookOpen).toBe(false)
    expect(store.getState().phase).toBe('answering')
  })
})

describe('답안 초안', () => {
  it('태그 토글이 넣고 빼기를 오간다', () => {
    toAnswering()
    store.getState().toggleTag('fvg_bull')
    expect(store.getState().draft.tags.has('fvg_bull')).toBe(true)
    store.getState().toggleTag('fvg_bull')
    expect(store.getState().draft.tags.has('fvg_bull')).toBe(false)
  })

  it('주문 필드는 부분 갱신된다', () => {
    toAnswering()
    store.getState().setOrder({ entry: 100 })
    store.getState().setOrder({ stopLoss: 97 })
    expect(store.getState().draft.entry).toBe(100)
    expect(store.getState().draft.stopLoss).toBe(97)
  })
})
