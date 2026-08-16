/**
 * 근거 오버레이 프리미티브 — 도형 4종(박스·레벨·사선·봉표시)을 하나의 시리즈
 * 프리미티브로 그린다.
 *
 * **클래스를 4개로 나누지 않았다.** attach/detach·paneView·zOrder 보일러플레이트가
 * 네 벌로 늘 뿐, 종류마다 다른 것은 draw 한 줄 묶음뿐이다. 스펙 §6 의 "프리미티브
 * 4종" 은 도형 4종을 뜻하고, 그것은 OverlayShape 의 4가지 kind 와 geometry.ts 의
 * 배치 함수 4개로 그대로 남아 있다 — 단위 테스트도 거기 붙는다(스펙 §7).
 *
 * 좌표 변환(time·price → 픽셀)만 라이브러리에 기대고, 변환 결과로 도형을 확정하는
 * 계산은 geometry.ts 의 순수 함수가 한다.
 *
 * 봉 인덱스 → 시각 변환은 `candles[i].time` 조회다 (스펙 §6). 재생으로 봉이 늘어나도
 * 인덱스가 그대로 맞는 유일한 방법이다.
 */
import type {
  IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive,
  SeriesAttachedParameter, Time,
} from 'lightweight-charts'
import type { Candle } from '../../../data/types'
import type { OverlayShape } from '../overlay'
import { placeBox, placeLevel, placeLine, placeMarker } from './geometry'

/** 도형 하나를 그릴 때 필요한 픽셀 이전 값들 */
type Placed =
  | { kind: 'box'; x1: number | null; x2: number | null; y1: number | null; y2: number | null; color: string }
  | { kind: 'level'; x1: number | null; x2: number | null; y: number | null; color: string }
  | { kind: 'line'; x1: number | null; y1: number | null; x2: number | null; y2: number | null; color: string }
  | { kind: 'marker'; x: number | null; y: number | null; up: boolean; color: string }

export type ColorFor = (shape: OverlayShape) => string

/** 기본 배색 — 방향으로만 가른다. 채점 결과별 배색(Task 7)은 colorFor 로 갈아끼운다 */
export const colorBySide: ColorFor = (s) =>
  s.side === 'bullish' ? '#26a69a' : s.side === 'bearish' ? '#ef5350' : '#7d8590'

class OverlayRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly placed: Placed[]) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const width = scope.mediaSize.width
      for (const p of this.placed) {
        switch (p.kind) {
          case 'box': {
            const r = placeBox(p, width)
            if (!r) break
            ctx.fillStyle = withAlpha(p.color, 0.14)
            ctx.fillRect(r.x, r.y, r.width, r.height)
            ctx.strokeStyle = withAlpha(p.color, 0.75)
            ctx.lineWidth = 1
            ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.width - 1), Math.max(0, r.height - 1))
            break
          }
          case 'level': {
            const g = placeLevel(p, width)
            if (!g) break
            ctx.strokeStyle = withAlpha(p.color, 0.85)
            ctx.lineWidth = 1
            ctx.setLineDash([4, 3])
            stroke(ctx, g)
            ctx.setLineDash([])
            break
          }
          case 'line': {
            const g = placeLine(p)
            if (!g) break
            ctx.strokeStyle = withAlpha(p.color, 0.85)
            ctx.lineWidth = 1.5
            stroke(ctx, g)
            break
          }
          case 'marker': {
            const g = placeMarker(p, width)
            if (!g) break
            // 강세는 봉 아래에서 위를 가리키고, 약세는 봉 위에서 아래를 가리킨다
            const dir = p.up ? -1 : 1
            const tip = g.y + dir * 4
            ctx.fillStyle = withAlpha(p.color, 0.9)
            ctx.beginPath()
            ctx.moveTo(g.x, tip)
            ctx.lineTo(g.x - 4, tip + dir * 7)
            ctx.lineTo(g.x + 4, tip + dir * 7)
            ctx.closePath()
            ctx.fill()
            break
          }
        }
      }
    })
  }
}

function stroke(
  ctx: CanvasRenderingContext2D,
  g: { x1: number; y1: number; x2: number; y2: number },
): void {
  ctx.beginPath()
  ctx.moveTo(g.x1, g.y1)
  ctx.lineTo(g.x2, g.y2)
  ctx.stroke()
}

class OverlayPaneView implements IPrimitivePaneView {
  constructor(private readonly source: OverlayPrimitive) {}

  renderer(): IPrimitivePaneRenderer | null {
    const p = this.source.param
    if (!p) return null
    const ts = p.chart.timeScale()
    const candles = this.source.candles
    const x = (bar: number): number | null =>
      bar >= 0 && bar < candles.length ? ts.timeToCoordinate(candles[bar].time as Time) : null
    const y = (price: number) => p.series.priceToCoordinate(price)

    const placed = this.source.shapes.map((s): Placed => {
      const color = this.source.colorFor(s)
      switch (s.kind) {
        case 'box':
          return { kind: 'box', x1: x(s.fromBar), x2: x(s.toBar), y1: y(s.priceHigh), y2: y(s.priceLow), color }
        case 'level':
          return { kind: 'level', x1: x(s.fromBar), x2: x(s.toBar), y: y(s.price), color }
        case 'line':
          return { kind: 'line', x1: x(s.fromBar), y1: y(s.fromPrice), x2: x(s.toBar), y2: y(s.toPrice), color }
        case 'marker':
          return { kind: 'marker', x: x(s.bar), y: y(s.price), up: s.side !== 'bearish', color }
      }
    })
    return new OverlayRenderer(placed)
  }

  zOrder(): 'bottom' {
    // 캔들 뒤에 깔린다 — 근거 시각화가 봉을 가리면 안 된다
    return 'bottom'
  }
}

export class OverlayPrimitive implements ISeriesPrimitive<Time> {
  param: SeriesAttachedParameter<Time> | null = null
  shapes: readonly OverlayShape[] = []
  candles: readonly Candle[] = []
  colorFor: ColorFor = colorBySide
  private readonly view = new OverlayPaneView(this)

  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param
  }

  detached(): void {
    this.param = null
  }

  set(shapes: readonly OverlayShape[], candles: readonly Candle[], colorFor: ColorFor = colorBySide): void {
    this.shapes = shapes
    this.candles = candles
    this.colorFor = colorFor
    this.param?.requestUpdate()
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }
}

function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return color
}
