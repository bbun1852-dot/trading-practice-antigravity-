import { useCampaignStore } from '../campaignStore'
import { CAMPAIGN_STAGES } from '../../quiz/campaignStages'
import { useQuizStore } from '../store'

export function CampaignMapScreen() {
  const stars = useCampaignStore((s) => s.stars)
  const isUnlocked = useCampaignStore((s) => s.isUnlocked)
  const startStage = useQuizStore((s) => s.startCampaignStage)
  const goHome = useQuizStore((s) => s.goHome)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header className="topbar">
        <h2>차트분석바이블 100강</h2>
        <span className="spacer" />
        <button onClick={goHome} className="secondary">홈으로</button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {CAMPAIGN_STAGES.map((stage) => {
            const unlocked = isUnlocked(stage.id)
            const stageStars = stars[stage.id] || 0
            
            return (
              <div 
                key={stage.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '16px',
                  background: unlocked ? 'var(--bg)' : 'rgba(255,255,255,0.05)',
                  opacity: unlocked ? 1 : 0.5,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontWeight: 'bold' }}>{stage.title}</div>
                  {!unlocked && <div>🔒</div>}
                </div>
                
                {unlocked && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[1, 2, 3].map(n => (
                        <span key={n} style={{ color: n <= stageStars ? '#FFD700' : '#444' }}>★</span>
                      ))}
                    </div>
                    <button 
                      className="primary" 
                      style={{ padding: '4px 12px' }}
                      onClick={() => startStage(stage.id)}
                    >
                      도전
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
