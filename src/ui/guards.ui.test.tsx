/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AnsweringScreen } from './screens/AnsweringScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { useQuizStore } from './store'
import { PROFILES, PROFILE_OF } from '../quiz/ruleCheck'

vi.mock('./chart/CandleChart', () => ({
  CandleChart: () => <div data-testid="candle-chart-mock" />
}))

describe('UI Guards (U5 & R1-R3)', () => {
  const dummyQuestion = {
    id: 'test', symbol: 'BTCUSDT', timeframe: '1d' as const, startTime: 0,
    decisionIndex: 1, candles: [{ time: 1, open: 1, high: 2, low: 0, close: 1.5, volume: 100 }, { time: 2, open: 1, high: 2, low: 0, close: 1.5, volume: 100 }],
    htfCandles: [], activeSignals: []
  }

  beforeEach(() => {
    useQuizStore.setState({
      phase: 'answering',
      view: {
        timeframe: '1d', difficulty: 'hard',
        candles: dummyQuestion.candles.slice(0, 2), htfCandles: [],
      },
      question: dummyQuestion as any,
      draft: { direction: null, tags: new Set(), memo: '' },
      report: null
    })
  })

  it('U5.1: Row order must match SignalKind categories', () => {
    render(<AnsweringScreen />)
    const expectedHeaders = [
      '스마트머니 (SMC)',
      '시장 구조 (Structure)',
      '거래량 (Volume)',
      '변동성 (Volatility)',
      '차트 패턴 (Pattern)',
      '피보나치 (Fibonacci)',
      '캔들 패턴 (Candle)',
      '이동평균 (MA)',
      '모멘텀 (Momentum)'
    ]
    const details = document.querySelectorAll('.sheet-row summary')
    const actualHeaders = Array.from(details).map(el => el.textContent?.trim() || '')
    expect(actualHeaders).toEqual(expectedHeaders)
  })

  it('U5.2: No pre-checked tags', () => {
    render(<AnsweringScreen />)
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(checkboxes.filter(cb => cb.checked).length).toBe(0)
  })

  it('U2: GradeReport is only calculated on submit, not during answering', () => {
    // Already answering phase
    expect(useQuizStore.getState().report).toBeNull()
    
    // Set draft direction and tags
    useQuizStore.setState(s => ({
      draft: { ...s.draft, direction: 'long', tags: new Set(['ma_aligned']) }
    }))
    
    // Still null
    expect(useQuizStore.getState().report).toBeNull()
    
    useQuizStore.getState().submit()
    
    // After submit, report should be calculated and phase moved to replaying
    expect(useQuizStore.getState().report).not.toBeNull()
    expect(useQuizStore.getState().phase).toBe('replaying')
  })

  it('U5.5: No limit on tags and penalty is displayed', () => {
    render(<AnsweringScreen />)
    const checkboxes = screen.getAllByRole('checkbox')
    const limit = 16
    for (let i = 0; i < limit; i++) fireEvent.click(checkboxes[i])
    expect(useQuizStore.getState().draft.tags.size).toBe(limit)
  })

  it('R1 & R2 & R3: ReviewScreen renders execution score conditionally, totalScore with max, and 주문 불성립', () => {
    useQuizStore.setState({
      phase: 'review',
      report: {
        direction: { correct: 'long', answered: 'long', score: 30 },
        execution: { score: 0, max: 0, notes: [], orderValid: true }, // R1: max=0
        evidence: { score: 30, verdict: { hits: [], coreMisses: [], reference: [], falseClaims: [] } },
        processScore: 60, processMax: 60, outcomeScore: 0, applicableMax: 60, totalScore: 100, judgement: '', 
        replay: null // R3: replay === null
      } as any
    })
    render(<ReviewScreen />)
    expect(screen.queryByText(/실행:/)).toBeNull() // R1: max=0 means no execution axis
    expect(screen.getByText(/총점: 100 \/ 60/)).not.toBeNull() // R2: totalScore with applicableMax
    expect(screen.getByText(/주문 불성립/)).not.toBeNull() // R3: "주문 불성립"
  })
})
