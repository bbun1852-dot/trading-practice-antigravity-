export type Candle = {
  /** UNIX epoch in SECONDS (lightweight-charts 규약) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Timeframe = '15m' | '1h' | '4h' | '1d' | '1w'

export const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d', '1w']

export const HIGHER_TF: Record<Timeframe, Timeframe> = {
  '15m': '1h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
  '1w': '1w',
}

/** 타임프레임별 지속 시간 (초) */
export const DURATION: Record<Timeframe, number> = {
  '15m': 15 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1d': 24 * 60 * 60,
  '1w': 7 * 24 * 60 * 60,
}
