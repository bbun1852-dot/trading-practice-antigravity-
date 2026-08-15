/**
 * UI 전역 상태 — 화면 상태 머신과 답안 초안 (스펙 §2·§3).
 *
 * 상태 머신:  idle → loading → answering → replaying → review → (다음) loading
 * 오답노트는 별도 축이다(notebookOpen) — 어느 단계에서든 열고 닫아도 phase 를 건드리지 않는다.
 *
 * **전이는 액션으로만 일어나고, 맞지 않는 단계에서 부른 액션은 무시된다(no-op).**
 * UI 버그(버튼이 잘못된 화면에 남는 것 등)가 머신을 망가뜨리는 대신 아무 일도
 * 하지 않게 하기 위해서다. 이 성질은 store.test.ts 가 잠근다.
 *
 * 은닉 규율 U1 (스펙 §4): answering 단계 컴포넌트는 `view`(SolverView)만 구독한다.
 * `question` 은 채점·재생·복기 전용이다. 여기서는 규약이고, Task 6 의
 * guards.ui.test.ts 가 테스트로 잠근다.
 */
import { create } from 'zustand'
import { solverView } from '../quiz/generator'
import type { Direction, GradeReport, Question, SolverView } from '../quiz/types'

export type Phase = 'idle' | 'loading' | 'answering' | 'replaying' | 'review'

export type Draft = {
  /** null = 아직 방향을 고르지 않음. 기본값을 주지 않는다 — 명시적 선택이 답안이다 */
  direction: Direction | null
  entry?: number
  stopLoss?: number
  takeProfit?: number
  tags: ReadonlySet<string>
  memo: string
}

const emptyDraft = (): Draft => ({ direction: null, tags: new Set(), memo: '' })

export type QuizStore = {
  phase: Phase
  notebookOpen: boolean
  /** answering 화면의 유일한 데이터 소스 (U1) */
  view: SolverView | null
  /** 채점·재생·복기 전용. answering 컴포넌트는 읽지 않는다 (U1) */
  question: Question | null
  draft: Draft
  report: GradeReport | null
  replay: { revealed: number; playing: boolean; speed: 1 | 4 }

  start(): void
  questionReady(q: Question): void
  setDirection(d: Direction): void
  setOrder(o: { entry?: number; stopLoss?: number; takeProfit?: number }): void
  toggleTag(id: string): void
  setMemo(memo: string): void
  submit(): void
  /** 재생 중 봉 하나 공개. 은닉 봉 수를 넘지 않는다(단조·상한) */
  replayTick(): void
  replayDone(): void
  next(): void
  openNotebook(): void
  closeNotebook(): void
}

/** 은닉 봉 수 — replayTick 의 상한 */
export function hiddenCount(q: Question): number {
  return q.candles.length - q.decisionIndex - 1
}

export const useQuizStore = create<QuizStore>()((set, get) => ({
  phase: 'idle',
  notebookOpen: false,
  view: null,
  question: null,
  draft: emptyDraft(),
  report: null,
  replay: { revealed: 0, playing: false, speed: 1 },

  start() {
    if (get().phase !== 'idle') return
    set({ phase: 'loading' })
  },

  questionReady(q) {
    if (get().phase !== 'loading') return
    set({
      phase: 'answering',
      question: q,
      view: solverView(q),
      draft: emptyDraft(),
      report: null,
      replay: { revealed: 0, playing: false, speed: 1 },
    })
  },

  setDirection(direction) {
    if (get().phase !== 'answering') return
    set((s) => ({ draft: { ...s.draft, direction } }))
  },

  setOrder(o) {
    if (get().phase !== 'answering') return
    set((s) => ({ draft: { ...s.draft, ...o } }))
  },

  toggleTag(id) {
    if (get().phase !== 'answering') return
    set((s) => {
      const tags = new Set(s.draft.tags)
      if (tags.has(id)) tags.delete(id)
      else tags.add(id)
      return { draft: { ...s.draft, tags } }
    })
  },

  setMemo(memo) {
    if (get().phase !== 'answering') return
    set((s) => ({ draft: { ...s.draft, memo } }))
  },

  submit() {
    const s = get()
    // 방향 없는 제출은 답안이 아니다 — 버튼도 막지만 머신도 막는다
    if (s.phase !== 'answering' || s.draft.direction === null) return
    set({ phase: 'replaying', replay: { revealed: 0, playing: true, speed: 1 } })
  },

  replayTick() {
    const s = get()
    if (s.phase !== 'replaying' || !s.question) return
    const cap = hiddenCount(s.question)
    if (s.replay.revealed >= cap) return
    set({ replay: { ...s.replay, revealed: s.replay.revealed + 1 } })
  },

  replayDone() {
    if (get().phase !== 'replaying') return
    set((s) => ({ phase: 'review', replay: { ...s.replay, playing: false } }))
  },

  next() {
    if (get().phase !== 'review') return
    set({
      phase: 'loading',
      view: null,
      question: null,
      draft: emptyDraft(),
      report: null,
      replay: { revealed: 0, playing: false, speed: 1 },
    })
  },

  openNotebook() {
    set({ notebookOpen: true })
  },

  closeNotebook() {
    set({ notebookOpen: false })
  },
}))
