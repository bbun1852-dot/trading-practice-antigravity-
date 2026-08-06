import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Candle, Timeframe } from './types'
import { fetchKlines } from './binance'

/**
 * 스크립트 전용 캔들 캐시. Node 에만 존재하며 브라우저의 IndexedDB 캐시(cache.ts)와 별개다.
 * 임계값 조정은 같은 데이터로 수십 번 반복하므로 매번 네트워크를 치면 느리고 불안정하다.
 */
const DIR = join(process.cwd(), '.candle-cache')

export function cachePath(symbol: string, tf: Timeframe, limit: number): string {
  return join(DIR, `${symbol}-${tf}-${limit}.json`)
}

export function readCache(symbol: string, tf: Timeframe, limit: number): Candle[] | null {
  const p = cachePath(symbol, tf, limit)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as Candle[]
}

export function writeCache(symbol: string, tf: Timeframe, limit: number, cs: Candle[]): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(cachePath(symbol, tf, limit), JSON.stringify(cs), 'utf8')
}

export async function getCandles(symbol: string, tf: Timeframe, limit = 1000): Promise<Candle[]> {
  const hit = readCache(symbol, tf, limit)
  if (hit) return hit
  const cs = await fetchKlines(symbol, tf, { limit })
  writeCache(symbol, tf, limit, cs)
  return cs
}
