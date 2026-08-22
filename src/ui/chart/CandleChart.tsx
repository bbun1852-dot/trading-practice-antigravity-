/**
 * 캔들 차트 — lightweight-charts 5 를 감싸는 유일한 컴포넌트.
 *
 * **봉 추가는 append 로 한다 (은닉 규율 U3, 스펙 §4).** 재생은 은닉 봉을 하나씩
 * 공개하는데, 차트에 전부 넣어 두고 보기만 가리는 방식은 스크롤·줌·크로스헤어로
 * 샌다. 그래서 `candles` 가 이전 배열의 접두사를 유지한 채 길어졌으면 늘어난
 * 부분만 `series.update()` 로 붙이고, 그 외(다른 문제로 갈아탐)에만 setData 한다.
 * 결과적으로 차트가 들고 있는 봉은 **항상 공개된 봉뿐이다.**
 *
 * 좌표 변환은 프리미티브가 하고(chart/primitives), 이 컴포넌트는 차트 수명만 맡는다.
 */
import { useEffect, useRef } from 'react'
import {
  CandlestickSeries, createChart,
  type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp,
} from 'lightweight-charts'
import type { Candle } from '../../data/types'
import type { OverlayShape } from './overlay'
import { OverlayPrimitive, colorBySide, type ColorFor } from './primitives/overlayPrimitive'
import { DrawingPrimitive } from './primitives/DrawingPrimitive'
import { useQuizStore } from '../store'
import type { DrawingPoint, UserDrawing } from './drawingTypes'

/** styles.css 의 다크 팔레트와 같은 값이어야 한다 — 차트만 다른 테마로 뜨면 안 된다 */
const THEME = {
  bg: '#0e1116',
  text: '#7d8590',
  grid: '#1c222b',
  border: '#2a2f38',
  up: '#26a69a',
  down: '#ef5350',
}

export type CandleChartProps = {
  candles: readonly Candle[]
  className?: string
  /** 미니 차트는 축·눈금을 줄인다 */
  compact?: boolean
  /**
   * 근거 오버레이. **복기 전용이다** — 풀이 화면에서 넘기면 답을 그려 주는 것이다
   * (은닉 규율 U2, 스펙 §4).
   */
  overlays?: readonly OverlayShape[]
  colorFor?: ColorFor
}

const toBar = (c: Candle): CandlestickData<UTCTimestamp> => ({
  time: c.time as UTCTimestamp,
  open: c.open, high: c.high, low: c.low, close: c.close,
})

export function CandleChart({
  candles, className, compact = false, overlays, colorFor = colorBySide,
}: CandleChartProps) {
  const box = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const overlay = useRef<OverlayPrimitive | null>(null)
  const drawOverlay = useRef<DrawingPrimitive | null>(null)
  const isDrawing = useRef(false)
  /** 이미 차트에 들어 있는 캔들(중복 방지). append 최적화에 쓴다 */
  const drawn = useRef<{ firstTime: number; length: number } | null>(null)

  const drawingTool = useQuizStore((s) => s.drawingTool)
  const drawings = useQuizStore((s) => s.drawings)
  const previewDrawing = useQuizStore((s) => s.previewDrawing)
  const addDrawing = useQuizStore((s) => s.addDrawing)
  const setPreviewDrawing = useQuizStore((s) => s.setPreviewDrawing)

  useEffect(() => {
    const c = createChart(box.current!, {
      autoSize: true,
      layout: { background: { color: THEME.bg }, textColor: THEME.text, attributionLogo: false },
      grid: {
        vertLines: { color: THEME.grid, visible: !compact },
        horzLines: { color: THEME.grid, visible: !compact },
      },
      rightPriceScale: { borderColor: THEME.border, visible: !compact },
      timeScale: { borderColor: THEME.border, timeVisible: true, rightOffset: 4 },
      crosshair: { mode: 0 },
    })
    chart.current = c

    series.current = c.addSeries(CandlestickSeries, {
      upColor: THEME.up, downColor: THEME.down,
      wickUpColor: THEME.up, wickDownColor: THEME.down,
      borderVisible: false,
    })
    
    overlay.current = new OverlayPrimitive()
    series.current.attachPrimitive(overlay.current)
    
    drawOverlay.current = new DrawingPrimitive()
    series.current.attachPrimitive(drawOverlay.current)
    
    drawn.current = null

    return () => {
      c.remove()
      chart.current = null
      series.current = null
      overlay.current = null
      drawOverlay.current = null
      drawn.current = null
    }
  }, [compact])

  useEffect(() => {
    overlay.current?.set(overlays ?? [], candles, colorFor)
  }, [overlays, candles, colorFor])

  // Update DrawingPrimitive when drawings change
  useEffect(() => {
    const allDrawings = previewDrawing ? [...drawings, previewDrawing] : drawings
    drawOverlay.current?.applyData(allDrawings, candles)
  }, [drawings, previewDrawing, candles])

  // Handle drawing events
  useEffect(() => {
    const c = chart.current
    const s = series.current
    if (!c || !s || !drawingTool) return

    c.applyOptions({ handleScroll: false, handleScale: false })

    const clickHandler = (param: any) => {
      if (!param.point || !param.time || !param.seriesData.get(s)) return
      
      const price = s.coordinateToPrice(param.point.y)
      if (price === null) return
      
      const barIndex = candles.findIndex(c => c.time === param.time)
      if (barIndex === -1) return

      if (!isDrawing.current) {
        // First click
        isDrawing.current = true
        setPreviewDrawing({
          id: 'preview',
          type: drawingTool,
          p1: { bar: barIndex, price },
          p2: { bar: barIndex, price },
        })
      } else {
        // Second click
        isDrawing.current = false
        const finalPreview = useQuizStore.getState().previewDrawing
        if (finalPreview) {
          addDrawing({ 
            ...finalPreview, 
            id: crypto.randomUUID(),
            p2: { bar: barIndex, price: finalPreview.type === 'ray' ? finalPreview.p1.price : price }
          })
        }
        setPreviewDrawing(null)
        useQuizStore.getState().setDrawingTool(null)
      }
    }

    const moveHandler = (param: any) => {
      if (!isDrawing.current || !param.point || !param.time) return
      
      const price = s.coordinateToPrice(param.point.y)
      if (price === null) return
      
      const barIndex = candles.findIndex(c => c.time === param.time)
      if (barIndex === -1) return

      const currentPreview = useQuizStore.getState().previewDrawing
      if (currentPreview) {
        setPreviewDrawing({
          ...currentPreview,
          p2: { bar: barIndex, price: currentPreview.type === 'ray' ? currentPreview.p1.price : price }
        })
      }
    }

    c.subscribeClick(clickHandler)
    c.subscribeCrosshairMove(moveHandler)

    return () => {
      c.applyOptions({ handleScroll: true, handleScale: true })
      c.unsubscribeClick(clickHandler)
      c.unsubscribeCrosshairMove(moveHandler)
      isDrawing.current = false
      setPreviewDrawing(null)
    }
  }, [drawingTool, candles, addDrawing, setPreviewDrawing])

  useEffect(() => {
    const s = series.current
    if (!s || candles.length === 0) return

    const prev = drawn.current
    const sameSeries = prev !== null
      && prev.firstTime === candles[0].time
      && candles.length >= prev.length

    if (sameSeries) {
      for (let i = prev.length; i < candles.length; i++) s.update(toBar(candles[i]))
    } else {
      s.setData(candles.map(toBar))
      chart.current?.timeScale().fitContent()
    }
    drawn.current = { firstTime: candles[0].time, length: candles.length }
  }, [candles])

  return <div className={className} ref={box} />
}
