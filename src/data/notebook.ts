import { openDB, type IDBPDatabase } from 'idb'
import type { Answer, GradeReport, Question } from '../quiz/types'

export type ReviewEntry = {
  id: string
  timestamp: number
  question: Question
  answer: Answer
  report: GradeReport
  // Indexed fields
  coreMisses: string[]
  falseClaims: string[]
  score: number
  symbol: string
}

export interface NotebookDB {
  save(entry: ReviewEntry): Promise<void>
  listAll(): Promise<ReviewEntry[]>
  findById(id: string): Promise<ReviewEntry | undefined>
  /** coreMisses 나 falseClaims 에 주어진 태그 id 가 포함된 엔트리를 반환 (최신순) */
  findByWrongTag(tagId: string): Promise<ReviewEntry[]>
  clear(): Promise<void>
}

const DB_NAME = 'ChartDrillNotebook'
const DB_VERSION = 1
const STORE_NAME = 'entries'

export class IndexedDBNotebook implements NotebookDB {
  private dbPromise: Promise<IDBPDatabase>

  constructor() {
    this.dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('timestamp', 'timestamp')
          // multiEntry: true 는 배열 내의 각 요소를 독립적인 키로 인덱싱한다
          store.createIndex('coreMisses', 'coreMisses', { multiEntry: true })
          store.createIndex('falseClaims', 'falseClaims', { multiEntry: true })
          store.createIndex('score', 'score')
          store.createIndex('symbol', 'symbol')
        }
      },
    })
  }

  async save(entry: ReviewEntry): Promise<void> {
    const db = await this.dbPromise
    await db.put(STORE_NAME, entry)
  }

  async listAll(): Promise<ReviewEntry[]> {
    const db = await this.dbPromise
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('timestamp')
    // prev: 내림차순 (최신순 정렬)
    let cursor = await index.openCursor(null, 'prev')
    const results: ReviewEntry[] = []
    while (cursor) {
      results.push(cursor.value)
      cursor = await cursor.continue()
    }
    return results
  }

  async findById(id: string): Promise<ReviewEntry | undefined> {
    const db = await this.dbPromise
    return db.get(STORE_NAME, id)
  }

  async findByWrongTag(tagId: string): Promise<ReviewEntry[]> {
    const db = await this.dbPromise
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    
    const missesIndex = store.index('coreMisses')
    const falseIndex = store.index('falseClaims')

    const [misses, falseClaims] = await Promise.all([
      missesIndex.getAll(tagId),
      falseIndex.getAll(tagId)
    ])

    const seen = new Set<string>()
    const results: ReviewEntry[] = []

    for (const entry of [...misses, ...falseClaims]) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id)
        results.push(entry)
      }
    }

    return results.sort((a, b) => b.timestamp - a.timestamp)
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise
    await db.clear(STORE_NAME)
  }
}

export class MemoryNotebook implements NotebookDB {
  private entries: Map<string, ReviewEntry> = new Map()

  async save(entry: ReviewEntry): Promise<void> {
    this.entries.set(entry.id, entry)
  }

  async listAll(): Promise<ReviewEntry[]> {
    return Array.from(this.entries.values()).sort((a, b) => b.timestamp - a.timestamp)
  }

  async findById(id: string): Promise<ReviewEntry | undefined> {
    return this.entries.get(id)
  }

  async findByWrongTag(tagId: string): Promise<ReviewEntry[]> {
    const results = Array.from(this.entries.values()).filter(
      (e) => e.coreMisses.includes(tagId) || e.falseClaims.includes(tagId)
    )
    return results.sort((a, b) => b.timestamp - a.timestamp)
  }

  async clear(): Promise<void> {
    this.entries.clear()
  }
}
