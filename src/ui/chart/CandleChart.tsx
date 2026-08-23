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
  CandlestickSeries, LineSeries, HistogramSeries, createChart,
  type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp,
  type MouseEventParams,
} from 'lightweight-charts'
import type { Candle } from '../../data/types'
import { rsi, macd, bollinger } from '../../analysis/indicators'
import type { OverlayShape } from './overlay'
import { OverlayPrimitive, colorBySide, type ColorFor } from './primitives/overlayPrimitive'
import { DrawingPrimitive } from './primitives/DrawingPrimitive'
import { useQuizStore } from '../store'

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
  /** 공간이 좁을 때는 눈금·그리드를 숨긴다 */
  compact?: boolean
  /**
   * 보조 지표들. **이곳이 유일하다.** 왜냐하면 정답 화면(Review)에서는 사용자가 직접 도형을 그릴
   * 수 없고(U2), 오답 노트(U4)에서도 마찬가지이기 때문이다.
   */
  overlays?: readonly OverlayShape[]
  colorFor?: ColorFor
  syncGroupId?: string
}

type CrosshairMoveEvent = {
  groupId: string;
  sourceChart: IChartApi;
  time: UTCTimestamp | null;
}
const crosshairListeners = new Set<(ev: CrosshairMoveEvent) => void>()

const toBar = (c: Candle): CandlestickData<UTCTimestamp> => ({
  time: c.time as UTCTimestamp,
  open: c.open, high: c.high, low: c.low, close: c.close,
})

export function CandleChart({
  candles, className, compact = false, overlays, colorFor = colorBySide, syncGroupId
}: CandleChartProps) {
  const box = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const overlay = useRef<OverlayPrimitive | null>(null)
  const drawOverlay = useRef<DrawingPrimitive | null>(null)
  const isDrawing = useRef(false)
  /** 이미 차트에 들어 있는 캔들(중복 방지). append 최적화에 쓴다 */
  const drawn = useRef<{ firstTime: number; length: number } | null>(null)
  const indRefs = useRef<any>({})

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
      rightPriceScale: { borderColor: THEME.border, visible: !compact, scaleMargins: { top: 0.1, bottom: 0.25 } },
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
    
    indRefs.current.bbUpper = c.addSeries(LineSeries, { color: 'rgba(255, 255, 255, 0.3)', lineWidth: 1, crosshairMarkerVisible: false })
    indRefs.current.bbLower = c.addSeries(LineSeries, { color: 'rgba(255, 255, 255, 0.3)', lineWidth: 1, crosshairMarkerVisible: false })
    indRefs.current.bbMid = c.addSeries(LineSeries, { color: 'rgba(255, 152, 0, 0.5)', lineWidth: 1, crosshairMarkerVisible: false })

    if (!compact) {
      indRefs.current.rsi = c.addSeries(LineSeries, { color: '#ce93d8', lineWidth: 1, priceScaleId: 'rsi', priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
      indRefs.current.macdLine = c.addSeries(LineSeries, { color: '#2962FF', lineWidth: 1, priceScaleId: 'macd', priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
      indRefs.current.macdSignal = c.addSeries(LineSeries, { color: '#FF6D00', lineWidth: 1, priceScaleId: 'macd', priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
      indRefs.current.macdHist = c.addSeries(HistogramSeries, { priceScaleId: 'macd', priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })

      c.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.75, bottom: 0.15 }, borderColor: THEME.border })
      c.priceScale('macd').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, borderColor: THEME.border })
    }
    
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
    drawOverlay.current?.applyData(allDrawings)
  }, [drawings, previewDrawing, candles])

  // Handle drawing events
  useEffect(() => {
    const c = chart.current
    const s = series.current
    if (!c || !s || !drawingTool) return

    c.applyOptions({ handleScroll: false, handleScale: false })

    const clickHandler = (param: MouseEventParams) => {
      if (!param.point || !param.time) return
      
      const price = s.coordinateToPrice(param.point.y)
      if (price === null) return
      
      const time = param.time as number
      if (!time) return

      if (!isDrawing.current) {
        // First click
        isDrawing.current = true
        setPreviewDrawing({
          id: 'preview',
          type: drawingTool,
          p1: { time, price },
          p2: { time, price },
        })
      } else {
        // Second click
        isDrawing.current = false
        const finalPreview = useQuizStore.getState().previewDrawing
        if (finalPreview) {
          addDrawing({ 
            ...finalPreview, 
            id: crypto.randomUUID(),
            p2: { time, price: finalPreview.type === 'ray' ? finalPreview.p1.price : price }
          })
        }
        setPreviewDrawing(null)
        useQuizStore.getState().setDrawingTool(null)
      }
    }

    const mouseMoveHandler = (param: MouseEventParams) => {
      if (!isDrawing.current || !param.point || !param.time) return
      
      const price = s.coordinateToPrice(param.point.y)
      if (price === null) return
      
      const time = param.time as number
      if (!time) return

      const currentPreview = useQuizStore.getState().previewDrawing
      if (currentPreview) {
        setPreviewDrawing({
          ...currentPreview,
          p2: { time, price: currentPreview.type === 'ray' ? currentPreview.p1.price : price }
        })
      }
    }

    c.subscribeClick(clickHandler)
    c.subscribeCrosshairMove(mouseMoveHandler)

    return () => {
      c.applyOptions({ handleScroll: true, handleScale: true })
      c.unsubscribeClick(clickHandler)
      c.unsubscribeCrosshairMove(mouseMoveHandler)
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
    }
    
    // Compute and apply indicators
    const cl = candles.map(c => c.close)
    const bb = bollinger(cl)
    const bbUp = bb.upper.map((v, i) => ({ time: (candles[i].time / 1000) as UTCTimestamp, value: v })).filter(d => !Number.isNaN(d.value))
    const bbDn = bb.lower.map((v, i) => ({ time: (candles[i].time / 1000) as UTCTimestamp, value: v })).filter(d => !Number.isNaN(d.value))
    const bbMd = bb.mid.map((v, i) => ({ time: (candles[i].time / 1000) as UTCTimestamp, value: v })).filter(d => !Number.isNaN(d.value))
    
    indRefs.current.bbUpper?.setData(bbUp)
    indRefs.current.bbLower?.setData(bbDn)
    indRefs.current.bbMid?.setData(bbMd)

    if (!compact) {
      const r = rsi(cl)
      const rsiData = r.map((v, i) => ({ time: (candles[i].time / 1000) as UTCTimestamp, value: v })).filter(d => !Number.isNaN(d.value))
      
      const m = macd(cl)
      const macdL = m.macd.map((v, i) => ({ time: (candles[i].time / 1000) as UTCTimestamp, value: v })).filter(d => !Number.isNaN(d.value))
      const macdS = m.signal.map((v, i) => ({ time: (candles[i].time / 1000) as UTCTimestamp, value: v })).filter(d => !Number.isNaN(d.value))
      const macdH = m.hist.map((v, i) => ({ time: (candles[i].time / 1000) as UTCTimestamp, value: v, color: v >= 0 ? THEME.up : THEME.down })).filter(d => !Number.isNaN(d.value))
      
      indRefs.current.rsi?.setData(rsiData)
      indRefs.current.macdLine?.setData(macdL)
      indRefs.current.macdSignal?.setData(macdS)
      indRefs.current.macdHist?.setData(macdH)
    }

    if (!sameSeries) {
      chart.current?.timeScale().fitContent()
    }
    drawn.current = { firstTime: candles[0].time, length: candles.length }
  }, [candles])

  // Crosshair Synchronization
  useEffect(() => {
    if (!syncGroupId) return
    
    const moveHandler = (param: any) => {
      if (param.sourceEvent) {
        crosshairListeners.forEach(l => l({
          groupId: syncGroupId,
          sourceChart: chart.current!,
          time: (param.time as UTCTimestamp | undefined) || null
        }))
      }
    }
    
    const listener = (ev: CrosshairMoveEvent) => {
      if (ev.groupId !== syncGroupId || ev.sourceChart === chart.current) return
      const c = chart.current
      const s = series.current
      if (!c || !s) return
      
      if (ev.time) {
        // Find the latest candle whose time is <= ev.time
        let match: Candle | null = null
        for (const cd of candles) {
          if (cd.time <= ev.time) match = cd
          else break
        }
        if (match) {
          c.setCrosshairPosition(match.close, match.time as UTCTimestamp, s)
        } else {
          c.clearCrosshairPosition()
        }
      } else {
        c.clearCrosshairPosition()
      }
    }
    
    chart.current?.subscribeCrosshairMove(moveHandler)
    crosshairListeners.add(listener)
    
    return () => {
      chart.current?.unsubscribeCrosshairMove(moveHandler)
      crosshairListeners.delete(listener)
    }
  }, [syncGroupId, candles])

  return <div className={className} ref={box} />
}
