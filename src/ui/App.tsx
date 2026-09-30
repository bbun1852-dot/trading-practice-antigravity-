/**
 * 화면 라우팅 — 라우터 없이 phase 하나로 가른다 (스펙 §2).
 * 오답노트는 phase 와 독립된 오버레이 축이다.
 */
import { useQuizStore } from './store'
import { HomeMenuScreen } from './screens/HomeMenuScreen'
import { RandomSetupScreen } from './screens/RandomSetupScreen'
import { CampaignMapScreen } from './screens/CampaignMapScreen'
import { CampaignIntroScreen } from './screens/CampaignIntroScreen'
import { LoadingScreen } from './screens/LoadingScreen'
import { AnsweringScreen } from './screens/AnsweringScreen'
import { ReplayScreen } from './screens/ReplayScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { NotebookScreen } from './screens/NotebookScreen'

export function App() {
  const phase = useQuizStore((s) => s.phase)
  const notebookOpen = useQuizStore((s) => s.notebookOpen)
  const openNotebook = useQuizStore((s) => s.openNotebook)

  return (
    <div className="app">
      <header className="topbar">
        <strong>chart-drill</strong>
        <span className="phase-indicator" data-phase={phase}>{phaseLabel(phase)}</span>
        <span className="spacer" />
        <button onClick={openNotebook}>오답노트</button>
      </header>
      <main className="screen">
        {phase === 'idle' && <HomeMenuScreen />}
        {phase === 'random_setup' && <RandomSetupScreen />}
        {phase === 'campaign_map' && <CampaignMapScreen />}
        {phase === 'campaign_intro' && <CampaignIntroScreen />}
        {phase === 'loading' && <LoadingScreen />}
        {phase === 'answering' && <AnsweringScreen />}
        {phase === 'replaying' && <ReplayScreen />}
        {phase === 'review' && <ReviewScreen />}
      </main>
      {notebookOpen && <NotebookScreen />}
    </div>
  )
}

function phaseLabel(p: string): string {
  switch (p) {
    case 'idle': return '홈'
    case 'random_setup': return '랜덤설정'
    case 'campaign_map': return '캠페인맵'
    case 'loading': return '문제 출제중'
    case 'answering': return '풀이중'
    case 'replaying': return '결과재생'
    case 'review': return '정답확인'
    default: return p
  }
}
