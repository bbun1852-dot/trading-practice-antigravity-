/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AnsweringScreen } from './screens/AnsweringScreen'
import { useQuizStore } from './store'

vi.mock('./chart/CandleChart', () => ({
  CandleChart: () => <div data-testid="candle-chart-mock" />
}))
import { PROFILES, PROFILE_OF } from '../quiz/ruleCheck'
import { falseClaimPenalty } from '../quiz/grader'

// A minimal test suite for U5 constraints
describe('UI Guards (U5)', () => {
  beforeEach(() => {
    // initialize store with answering phase
    useQuizStore.setState({
      phase: 'answering',
      view: {
        timeframe: '1d', // 'position' profile
        difficulty: 'hard',
        candles: [{ time: 1, open: 1, high: 2, low: 0, close: 1.5, volume: 100 }],
        htfCandles: [],
      },
      draft: { direction: null, tags: new Set(), memo: '' },
    })
  })

  it('U5.1: Row order must exactly match PROFILES', () => {
    render(<AnsweringScreen />)
    const profile = PROFILES[PROFILE_OF['1d']] // position
    const expectedHeaders = profile.rows.map(r => r.label)
    
    // Actually jsdom details support is a bit wonky in querying, let's just query dom directly
    const details = document.querySelectorAll('.sheet-row summary')
    const actualHeaders = Array.from(details).map(el => {
      let text = el.textContent || ''
      text = text.replace('[핵심]', '').trim()
      return text
    })
    
    // the last one is unscored tags summary
    const actualRowHeaders = actualHeaders.slice(0, profile.rows.length)
    expect(actualRowHeaders).toEqual(expectedHeaders)
  })

  it('U5.2: No pre-checked tags', () => {
    render(<AnsweringScreen />)
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    const checked = checkboxes.filter(cb => cb.checked)
    expect(checked.length).toBe(0)
  })

  it('U5.3 & U5.4: No recommendations or stats (just standard structure)', () => {
    render(<AnsweringScreen />)
    // There shouldn't be any "recommend" or "stats" text
    expect(screen.queryByText(/추천/)).toBeNull()
    expect(screen.queryByText(/자주 놓치는/)).toBeNull()
    expect(screen.queryByText(/통계/)).toBeNull()
  })

  it('U5.5: No limit on tags and penalty is displayed', () => {
    render(<AnsweringScreen />)
    const checkboxes = screen.getAllByRole('checkbox')
    
    // Click 16 checkboxes
    const limit = 16
    expect(checkboxes.length).toBeGreaterThan(limit)
    
    for (let i = 0; i < limit; i++) {
      fireEvent.click(checkboxes[i])
    }
    
    // all 16 should be checked
    const state = useQuizStore.getState()
    expect(state.draft.tags.size).toBe(limit)
    
    // Check penalty text
    let sum = 0
    state.draft.tags.forEach(id => sum += falseClaimPenalty(id))
    
    const penaltyText = screen.getByText(new RegExp(`전부 헛다리면 -${sum}점`))
    expect(penaltyText).not.toBeNull()
  })
})
