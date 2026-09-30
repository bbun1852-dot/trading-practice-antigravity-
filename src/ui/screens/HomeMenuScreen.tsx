import { useQuizStore } from '../store'

export function HomeMenuScreen() {
  const goToRandomSetup = useQuizStore((s) => s.goToRandomSetup)
  const goToCampaignMap = useQuizStore((s) => s.goToCampaignMap)

  return (
    <div className="center-box">
      <h1>chart-drill</h1>
      <p>원하시는 모드를 선택해주세요.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '24px' }}>
        <button className="primary" style={{ padding: '16px', fontSize: '18px' }} onClick={goToCampaignMap}>
          차트분석바이블 100강 (캠페인)
        </button>
        <button className="secondary" style={{ padding: '16px', fontSize: '18px' }} onClick={goToRandomSetup}>
          랜덤 실전 연습
        </button>
      </div>
    </div>
  )
}
