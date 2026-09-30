/**
 * 출제 화면 — 파이프라인을 돌리고, 진행 단계를 보여주고, 실패하면 재시도를 준다.
 *
 * **오류는 상태 머신에 넣지 않는다.** 스펙 §2 의 화면 머신에는 error 단계가 없고,
 * 실패는 "이 화면이 아직 문제를 못 만든 상태" 일 뿐이다. 재시도는 phase 를 건드리지
 * 않고 이 화면 안에서 다시 돈다 — 머신에 예외 경로를 파는 것보다 이쪽이 작다.
 *
 * StrictMode 는 이펙트를 두 번 태운다. 첫 실행은 cleanup 에서 abort 되고, 파이프라인은
 * 구간 사이마다 중단 신호를 확인하므로 버려질 계산을 끝까지 태우지 않는다.
 */
import { useCallback, useEffect, useState } from 'react'
import { useQuizStore } from '../store'
import { generateQuestion, type Stage } from '../pipeline'
import { CAMPAIGN_STAGES } from '../../quiz/campaignStages'

export function LoadingScreen() {
  const config = useQuizStore((s) => s.config)
  const questionReady = useQuizStore((s) => s.questionReady)
  const [stage, setStage] = useState<Stage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setStage(null)
    setError(null)

    const requiredTags = config.campaignStage 
      ? CAMPAIGN_STAGES.find(s => s.id === config.campaignStage)?.requiredTags 
      : undefined

    generateQuestion({
      symbol: config.symbol,
      tf: config.tf,
      signal: controller.signal,
      requiredTags,
      onStage: (s) => { if (!controller.signal.aborted) setStage(s) },
    }).then(
      (q) => { if (!controller.signal.aborted) questionReady(q) },
      (e: unknown) => {
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : String(e))
      },
    )

    return () => controller.abort()
  }, [config.symbol, config.tf, config.campaignStage, questionReady, attempt])

  if (error) {
    return (
      <div className="center-box">
        <h2>문제를 만들지 못했다</h2>
        <p className="error-detail">{error}</p>
        <button className="primary" onClick={retry}>다시 시도</button>
      </div>
    )
  }

  return (
    <div className="center-box">
      <p className="loading" data-stage={stage?.kind ?? 'start'}>{stageLabel(stage)}</p>
    </div>
  )
}

function stageLabel(s: Stage | null): string {
  if (!s) return '문제 만드는 중…'
  switch (s.kind) {
    case 'candles': return `${s.symbol} ${s.tf} 캔들 받는 중…`
    case 'scan': return `${s.symbol} ${s.tf} 구간 훑는 중… (${s.chunk}/${s.chunks})`
    case 'compose': return '문제 만드는 중…'
  }
}
