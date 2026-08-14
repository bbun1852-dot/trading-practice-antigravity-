import { getCandles } from '../src/data/fileCache'
import { detectMSB } from '../src/analysis/smc'
import { detectStructureExtras } from '../src/analysis/structureExtras'

async function run() {
  const END_TIME = Math.floor(Date.UTC(2026, 7, 1) / 1000)
  const symbol = process.argv[2] ?? 'BTCUSDT'
  const tf = (process.argv[3] ?? '4h') as Timeframe
  const count = Number(process.argv[4] ?? '200')

  let totalChoch = 0
  let overlappingChoch = 0

      const pureMsbSignals = msbSignals.filter(s => s.id.startsWith('msb_'))
      
      for (const choch of chochSignals) {
        totalChoch++
        // Check if there is an msb_* signal on the same bar
        const overlap = pureMsbSignals.some(msb => Math.abs(msb.barIndex - choch.barIndex) <= 2)
        if (overlap) {
          overlappingChoch++
        }
      }
    }
  }

  console.log(`Total CHoCH: ${totalChoch}`)
  console.log(`Overlapping CHoCH: ${overlappingChoch}`)
  console.log(`Overlap Rate: ${totalChoch > 0 ? (overlappingChoch / totalChoch * 100).toFixed(2) : 0}%`)
}

run().catch(console.error)
