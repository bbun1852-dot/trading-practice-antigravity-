import { useQuizStore } from '../store'
import { CAMPAIGN_STAGES } from '../../quiz/campaignStages'
import { TAG_BY_ID } from '../../quiz/taxonomy'

export function CampaignIntroScreen() {
  const config = useQuizStore((s) => s.config)
  const startLoadingCampaign = useQuizStore((s) => s.startLoadingCampaign)
  const goToCampaignMap = useQuizStore((s) => s.goToCampaignMap)

  const stage = CAMPAIGN_STAGES.find(s => s.id === config.campaignStage)
  
  if (!stage) return null

  // If intro is not defined, generate a generic one based on requiredTags
  const tagLabels = stage.requiredTags.map(t => TAG_BY_ID.get(t)?.label || t).join(', ')

  const description = stage.intro?.description || `${stage.title}에 대해 학습하는 단계입니다.`
  const condition = stage.intro?.condition || `차트 상에서 [ ${tagLabels} ] 패턴이 등장해야 합니다.`
  const method = stage.intro?.method || `해당 패턴을 작도 도구로 식별하고, 상승 또는 하락 방향을 예측하여 트레이딩하세요.`

  return (
    <div className="center-box" style={{ maxWidth: '600px', textAlign: 'left', alignItems: 'flex-start' }}>
      <h2 style={{ alignSelf: 'center', marginBottom: '24px' }}>{stage.title}</h2>
      
      <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px', width: '100%', marginBottom: '16px' }}>
        <h3 style={{ color: 'var(--primary)' }}>대략적인 설명</h3>
        <p style={{ marginTop: '8px', lineHeight: '1.6' }}>{description}</p>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px', width: '100%', marginBottom: '16px' }}>
        <h3 style={{ color: 'var(--primary)' }}>등장 조건</h3>
        <p style={{ marginTop: '8px', lineHeight: '1.6' }}>{condition}</p>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px', width: '100%', marginBottom: '32px' }}>
        <h3 style={{ color: 'var(--primary)' }}>트레이딩 방법</h3>
        <p style={{ marginTop: '8px', lineHeight: '1.6' }}>{method}</p>
      </div>

      <div style={{ display: 'flex', gap: '16px', width: '100%' }}>
        <button className="secondary" style={{ flex: 1, padding: '16px', fontSize: '18px' }} onClick={goToCampaignMap}>
          뒤로 가기
        </button>
        <button className="primary" style={{ flex: 2, padding: '16px', fontSize: '18px' }} onClick={startLoadingCampaign}>
          트레이딩 시작하기
        </button>
      </div>
    </div>
  )
}
