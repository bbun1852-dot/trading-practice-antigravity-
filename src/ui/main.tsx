import { createRoot } from 'react-dom/client'
import { SpikeApp } from './spike/SpikeApp'

// StrictMode 를 일부러 뺐다 — 개발 모드의 이펙트 이중 실행이 차트 생성/파괴를
// 두 번 돌려 스파이크 판정을 흐린다. Task 2 골격에서 cleanup 을 검증한 뒤 켠다.
createRoot(document.getElementById('root')!).render(<SpikeApp />)
