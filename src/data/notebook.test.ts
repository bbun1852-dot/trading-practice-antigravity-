import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryNotebook, type ReviewEntry } from './notebook'
import type { Answer, GradeReport, Question } from '../quiz/types'

describe('MemoryNotebook', () => {
  let db: MemoryNotebook

  beforeEach(() => {
    db = new MemoryNotebook()
  })

  function createDummyEntry(id: string, overrides: Partial<ReviewEntry> = {}): ReviewEntry {
    return {
      id,
      timestamp: Date.now(),
      question: {} as Question,
      answer: {} as Answer,
      report: {} as GradeReport,
      coreMisses: [],
      falseClaims: [],
      score: 100,
      symbol: 'BTCUSDT',
      ...overrides,
    }
  }

  it('saves and retrieves entries', async () => {
    const entry = createDummyEntry('1')
    await db.save(entry)

    const retrieved = await db.findById('1')
    expect(retrieved).toEqual(entry)
  })

  it('lists all entries sorted by timestamp (newest first)', async () => {
    const e1 = createDummyEntry('1', { timestamp: 1000 })
    const e2 = createDummyEntry('2', { timestamp: 2000 })
    const e3 = createDummyEntry('3', { timestamp: 1500 })

    await db.save(e1)
    await db.save(e2)
    await db.save(e3)

    const all = await db.listAll()
    expect(all.length).toBe(3)
    expect(all[0].id).toBe('2') // newest
    expect(all[1].id).toBe('3')
    expect(all[2].id).toBe('1') // oldest
  })

  it('finds entries by wrong tag (coreMisses or falseClaims) and sorts them', async () => {
    const e1 = createDummyEntry('1', { timestamp: 1000, coreMisses: ['tagA'] })
    const e2 = createDummyEntry('2', { timestamp: 2000, falseClaims: ['tagB'] })
    const e3 = createDummyEntry('3', { timestamp: 1500, coreMisses: ['tagC'], falseClaims: ['tagA'] })
    const e4 = createDummyEntry('4', { timestamp: 3000, falseClaims: ['tagD'] }) // tagA 없음

    await db.save(e1)
    await db.save(e2)
    await db.save(e3)
    await db.save(e4)

    const results = await db.findByWrongTag('tagA')
    expect(results.length).toBe(2)
    // 최신순 (e3: 1500, e1: 1000)
    expect(results[0].id).toBe('3')
    expect(results[1].id).toBe('1')
  })

  it('clears all entries', async () => {
    await db.save(createDummyEntry('1'))
    await db.save(createDummyEntry('2'))
    
    await db.clear()
    const all = await db.listAll()
    expect(all.length).toBe(0)
  })
})
