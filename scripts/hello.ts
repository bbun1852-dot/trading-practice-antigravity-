import { detectAll } from '../src/analysis/signals'
import { synthCandles } from '../src/analysis/fixtures'

const cs = synthCandles(300)
console.log(`캔들 ${cs.length}봉 → 신호 ${detectAll(cs).length}개`)
