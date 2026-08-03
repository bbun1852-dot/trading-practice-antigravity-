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

/** 한 단계 상위 타임프레임 (탑다운 분석용) */
export const HIGHER_TF: Record<Timeframe, Timeframe> = {
  '15m': '1h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
  '1w': '1w',
}
