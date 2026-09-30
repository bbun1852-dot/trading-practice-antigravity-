import { SYMBOL_POOL } from '../../data/binance'
import { DRILL_TIMEFRAMES, type DrillTimeframe } from '../pipeline'
import { useQuizStore } from '../store'

/**
 * 시작 화면 — 심볼·TF 를 고르거나 랜덤에 맡긴다 (스펙 §3).
 * TF 는 4h·1d 뿐이다. calibrate 가 그 둘만 검증했다 (스펙 §1 비목표).
 */
export function RandomSetupScreen() {
  const config = useQuizStore((s) => s.config)
  const setConfig = useQuizStore((s) => s.setConfig)
  const start = useQuizStore((s) => s.start)
  const goHome = useQuizStore((s) => s.goHome)

  return (
    <div className="center-box">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>랜덤 실전 연습</h2>
        <button onClick={goHome} className="secondary">돌아가기</button>
      </div>
      <p>랜덤한 차트를 생성하여 실전 감각을 기릅니다.</p>

      <div className="config-row">
        <label>
          심볼{' '}
          <select
            value={config.symbol ?? ''}
            onChange={(e) => setConfig({ symbol: e.target.value || null })}
          >
            <option value="">랜덤</option>
            {SYMBOL_POOL.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          타임프레임{' '}
          <select
            value={config.tf ?? ''}
            onChange={(e) => setConfig({ tf: (e.target.value || null) as DrillTimeframe | null })}
          >
            <option value="">랜덤</option>
            {DRILL_TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
          </select>
        </label>
      </div>

      <button className="primary" onClick={start}>문제 시작</button>
    </div>
  )
}
