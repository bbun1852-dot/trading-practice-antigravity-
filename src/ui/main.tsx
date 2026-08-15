import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// 스파이크에서 빼뒀던 StrictMode 를 되돌린다 — 골격의 이펙트는 전부 cleanup 을
// 갖췄다(App 의 타이머, ReplayScreen 의 interval). 차트 마운트(Task 5)도
// chart.remove() cleanup 을 전제로 들어온다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
