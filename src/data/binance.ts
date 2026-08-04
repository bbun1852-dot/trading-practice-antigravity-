import type { Candle, Timeframe } from './types'

const BASE = 'https://api.binance.com/api/v3/klines'

/** 거래량 상위 USDT 페어 25종 */
export const SYMBOL_POOL = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'DOGEUSDT',
  'MATICUSDT', 'LTCUSDT', 'ATOMUSDT', 'UNIUSDT', 'ETCUSDT',
  'FILUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT',
  'INJUSDT', 'SUIUSDT', 'TIAUSDT', 'SEIUSDT', 'RUNEUSDT',
]

export function parseKlines(raw: unknown[][]): Candle[] {
  return raw.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }))
}

export async function fetchKlines(
  symbol: string,
  tf: Timeframe,
  opts: { endTime?: number; limit?: number } = {},
): Promise<Candle[]> {
  const limit = opts.limit ?? 400
  const params = new URLSearchParams({ symbol, interval: tf, limit: String(limit) })
  if (opts.endTime !== undefined) params.set('endTime', String(opts.endTime * 1000))

  const res = await fetch(`${BASE}?${params}`)
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`)
  return parseKlines(await res.json())
}
