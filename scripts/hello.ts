import { fetchKlines } from '../src/data/binance'
import { detectCandlePatterns } from '../src/analysis/candlePatterns'

for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
  const cs = await fetchKlines(sym, '4h', { limit: 1000 })
  const n = detectCandlePatterns(cs).filter(s => s.id.startsWith('tweezer_')).length
  console.log(`${sym} 4h: 트위저 ${n}회 / 1000봉`)
}
