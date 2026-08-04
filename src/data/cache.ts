import { openDB, type IDBPDatabase } from 'idb'
import type { Candle, Timeframe } from './types'
import { fetchKlines } from './binance'

const DB_NAME = 'chart-drill'
const DB_VERSION = 1
const STORE = 'candles'

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
        if (!d.objectStoreNames.contains('questions')) d.createObjectStore('questions', { keyPath: 'id' })
        if (!d.objectStoreNames.contains('attempts')) d.createObjectStore('attempts', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

export function cacheKey(symbol: string, tf: Timeframe, endTime: number, limit: number): string {
  return `${symbol}|${tf}|${endTime}|${limit}`
}

export async function getCachedCandles(key: string): Promise<Candle[] | undefined> {
  return (await db()).get(STORE, key)
}

export async function putCachedCandles(key: string, candles: Candle[]): Promise<void> {
  await (await db()).put(STORE, candles, key)
}

export async function fetchCandlesCached(
  symbol: string,
  tf: Timeframe,
  opts: { endTime: number; limit?: number },
): Promise<Candle[]> {
  const limit = opts.limit ?? 400
  const key = cacheKey(symbol, tf, opts.endTime, limit)
  const hit = await getCachedCandles(key)
  if (hit) return hit
  const fresh = await fetchKlines(symbol, tf, { endTime: opts.endTime, limit })
  await putCachedCandles(key, fresh)
  return fresh
}
