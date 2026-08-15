/**
 * Task 1 스파이크 — lightweight-charts 결정의 실증 (스펙 §8 Task 1).
 *
 * 판정 세 가지: ① 캔들 렌더 ② 실제 detectOrderBlocks refs 로 PriceBox
 * ③ 재생(series.update 로 은닉 봉 순차 추가). 셋 다 되면 진행, 프리미티브에서
 * 막히면 KLineChart 전환.
 *
 * 은닉 규율 U3 을 스파이크부터 지킨다 — 차트에는 보이는 봉만 넣고 시작하고,
 * 재생은 추가이지 공개가 아니다.
 */
import { useEffect, useRef, useState } from 'react'
import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts'
import { fetchCandlesCached } from '../../data/cache'
import { detectOrderBlocks } from '../../analysis/smc'
import { DURATION, type Candle } from '../../data/types'
import { PriceBoxPrimitive } from '../chart/primitives/priceBox'

const SYMBOL = 'BTCUSDT'
const TF = '4h' as const
const TOTAL = 400
const HIDDEN = 60

type Phase = 'loading' | 'ready' | 'replaying' | 'done' | 'error'

export function SpikeApp() {
  const containerRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const hiddenRef = useRef<Candle[]>([])
  const [phase, setPhase] = useState<Phase>('loading')
  const [revealed, setRevealed] = useState(0)
  const [boxCount, setBoxCount] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let chart: IChartApi | null = null
    let cancelled = false

    ;(async () => {
      // 창 끝을 TF 경계로 내림 — 같은 세션에서 캐시 키가 안정된다
      const dur = DURATION[TF]
      const endTime = Math.floor(Date.now() / 1000 / dur) * dur
      const cs = await fetchCandlesCached(SYMBOL, TF, { endTime, limit: TOTAL })
      if (cancelled) return

      const visible = cs.slice(0, TOTAL - HIDDEN)
      hiddenRef.current = cs.slice(TOTAL - HIDDEN)

      chart = createChart(el, {
        layout: { background: { color: '#0e1116' }, textColor: '#c8ccd4' },
        grid: { vertLines: { color: '#1c2128' }, horzLines: { color: '#1c2128' } },
        timeScale: { timeVisible: true, borderColor: '#2a2f38' },
        rightPriceScale: { borderColor: '#2a2f38' },
      })
      const series = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
        wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      })
      series.setData(visible.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })))
      seriesRef.current = series

      // ② 실제 감지기 refs 로 박스 — 보이는 창 기준으로 감지한다 (U1 과 같은 원칙)
      const obs = detectOrderBlocks(visible)
      const boxes = obs
        .filter((s) => s.refs?.priceHigh !== undefined && s.refs.priceLow !== undefined
          && s.refs.fromBar !== undefined && s.refs.toBar !== undefined)
        .map((s) => ({
          fromTime: visible[s.refs!.fromBar!].time as Time,
          toTime: visible[s.refs!.toBar!].time as Time,
          priceHigh: s.refs!.priceHigh!,
          priceLow: s.refs!.priceLow!,
          color: s.side === 'bullish' ? '#26a69a' : '#ef5350',
        }))
      const primitive = new PriceBoxPrimitive()
      series.attachPrimitive(primitive)
      primitive.setBoxes(boxes)
      setBoxCount(boxes.length)

      chart.timeScale().fitContent()
      // 스파이크 검증용 훅 — 프리뷰 페인이 표시되지 않으면 rAF 가 멈춰 그리기 경로가
      // 실행되지 않는다. takeScreenshot() 은 동기 렌더라 이걸로 판정한다. Task 2 에서 제거.
      ;(window as unknown as Record<string, unknown>).__spikeChart = chart
      setPhase('ready')
    })().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    })

    return () => {
      cancelled = true
      chart?.remove()
      seriesRef.current = null
    }
  }, [])

  const replay = () => {
    setPhase('replaying')
    let i = 0
    const timer = setInterval(() => {
      const c = hiddenRef.current[i]
      if (!c || !seriesRef.current) {
        clearInterval(timer)
        setPhase('done')
        return
      }
      // ③ 재생 = 봉 하나씩 추가 (U3)
      seriesRef.current.update({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })
      i++
      setRevealed(i)
      if (i >= hiddenRef.current.length) {
        clearInterval(timer)
        setPhase('done')
      }
    }, 50)
  }

  const visibleCount = TOTAL - HIDDEN + revealed
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0e1116', color: '#c8ccd4', fontFamily: 'sans-serif' }}>
      <div style={{ padding: '8px 16px', display: 'flex', gap: 16, alignItems: 'center', fontSize: 14 }}>
        <strong>chart-drill 스파이크</strong>
        <span>{SYMBOL} {TF}</span>
        <span data-status={phase}>
          {phase === 'loading' && '캔들 불러오는 중…'}
          {phase === 'error' && `오류: ${error}`}
          {phase !== 'loading' && phase !== 'error' && `봉 ${visibleCount}/${TOTAL} · OB 박스 ${boxCount}개`}
        </span>
        {phase === 'ready' && <button onClick={replay}>재생 (은닉 {HIDDEN}봉)</button>}
        {phase === 'replaying' && <span>재생 중… {revealed}/{HIDDEN}</span>}
        {phase === 'done' && <span>재생 완료</span>}
      </div>
      <div ref={containerRef} style={{ flex: 1 }} />
    </div>
  )
}
