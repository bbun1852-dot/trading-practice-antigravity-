import { openDB, type IDBPDatabase } from 'idb'
import type { Answer, GradeReport, Question } from '../quiz/types'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

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
          // multiEntry: true 를 주면 배열의 각 원소가 인덱스 키로 잡힌다
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
    // prev: 역순 (최신순 정렬)
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

const FILE_DB_VERSION = 1

export class FileNotebook implements NotebookDB {
  private dir: string
  private filePath: string

  constructor(filename = 'reviews.json') {
    this.dir = join(process.cwd(), '.notebook-cache')
    this.filePath = join(this.dir, filename)
  }

  private readAll(): ReviewEntry[] {
    if (!existsSync(this.filePath)) return []
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed.version !== FILE_DB_VERSION || !Array.isArray(parsed.entries)) {
        return []
      }
      return parsed.entries
    } catch {
      return []
    }
  }

  private writeAll(entries: ReviewEntry[]): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true })
    }
    const data = { version: FILE_DB_VERSION, entries }
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }

  async save(entry: ReviewEntry): Promise<void> {
    const entries = this.readAll()
    const idx = entries.findIndex(e => e.id === entry.id)
    if (idx >= 0) entries[idx] = entry
    else entries.push(entry)
    this.writeAll(entries)
  }

  async listAll(): Promise<ReviewEntry[]> {
    return this.readAll().sort((a, b) => b.timestamp - a.timestamp)
  }

  async findById(id: string): Promise<ReviewEntry | undefined> {
    return this.readAll().find(e => e.id === id)
  }

  async findByWrongTag(tagId: string): Promise<ReviewEntry[]> {
    const entries = this.readAll()
    const results = entries.filter(
      (e) => e.coreMisses.includes(tagId) || e.falseClaims.includes(tagId)
    )
    return results.sort((a, b) => b.timestamp - a.timestamp)
  }

  async clear(): Promise<void> {
    this.writeAll([])
  }
}
