import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { NotebookDB, ReviewEntry } from './notebook'

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
