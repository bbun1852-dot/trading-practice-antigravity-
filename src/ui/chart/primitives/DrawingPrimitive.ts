import type {
  IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive,
  SeriesAttachedParameter, Time,
} from 'lightweight-charts'
import type { UserDrawing } from '../drawingTypes'

type PlacedDrawing = 
  | { type: 'trendline', x1: number, y1: number, x2: number, y2: number }
  | { type: 'ray', x1: number, y1: number, x2: number, y2: number }
  | { type: 'fibonacci', x1: number, y1: number, x2: number, y2: number }

class DrawingRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly placed: PlacedDrawing[]) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const width = scope.mediaSize.width

      ctx.lineWidth = 2
      ctx.strokeStyle = '#ffffff'
      
      for (const p of this.placed) {
        if (p.x1 === null || p.y1 === null || p.x2 === null || p.y2 === null) continue

        ctx.beginPath()
        if (p.type === 'trendline') {
          ctx.moveTo(p.x1, p.y1)
          ctx.lineTo(p.x2, p.y2)
          ctx.stroke()
        } else if (p.type === 'ray') {
          ctx.moveTo(p.x1, p.y1)
          const dx = p.x2 - p.x1
          const dy = p.y2 - p.y1
          if (dx === 0 && dy === 0) {
            ctx.lineTo(p.x2, p.y2)
          } else {
            const extendX = dx > 0 ? width : 0
            const extendY = p.y1 + (extendX - p.x1) * (dy / dx)
            ctx.lineTo(extendX, extendY)
          }
          ctx.stroke()
        } else if (p.type === 'fibonacci') {
          const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
          const startX = Math.min(p.x1, p.x2)
          const endX = Math.max(p.x1, p.x2)
          
          ctx.font = '12px sans-serif'
          
          levels.forEach(level => {
            const y = p.y1 + (p.y2 - p.y1) * level
            ctx.beginPath()
            ctx.moveTo(startX, y)
            ctx.lineTo(endX, y)
            
            if (level === 0 || level === 1) ctx.strokeStyle = '#787b86'
            else if (level === 0.618 || level === 0.382) ctx.strokeStyle = '#4caf50'
            else ctx.strokeStyle = '#ff9800'
            
            ctx.stroke()
            
            ctx.fillStyle = ctx.strokeStyle
            const label = (1 - level).toString()
            ctx.fillText(label.length > 5 ? label.substring(0, 5) : label, endX + 4, y + 4)
          })
          
          ctx.beginPath()
          ctx.setLineDash([5, 5])
          ctx.strokeStyle = '#787b86'
          ctx.moveTo(p.x1, p.y1)
          ctx.lineTo(p.x2, p.y2)
          ctx.stroke()
          ctx.setLineDash([])
        }
      }
    })
  }
}

class DrawingPaneView implements IPrimitivePaneView {
  private placed: PlacedDrawing[] = []

  update(drawings: readonly UserDrawing[], param: SeriesAttachedParameter<Time>) {
    this.placed = []
    
    for (const d of drawings) {
      const x1 = param.chart.timeScale().timeToCoordinate((d.p1.time / 1000) as Time)
      const x2 = param.chart.timeScale().timeToCoordinate((d.p2.time / 1000) as Time)
      const y1 = param.series.priceToCoordinate(d.p1.price)
      const y2 = param.series.priceToCoordinate(d.p2.price)

      if (x1 === null || y1 === null || x2 === null || y2 === null) continue

      this.placed.push({ type: d.type, x1, y1, x2, y2 })
    }
  }

  renderer() {
    return new DrawingRenderer(this.placed)
  }
}

export class DrawingPrimitive implements ISeriesPrimitive<Time> {
  private _param: SeriesAttachedParameter<Time> | null = null
  private readonly _paneView = new DrawingPaneView()

  private _drawings: readonly UserDrawing[] = []

  attached(param: SeriesAttachedParameter<Time>): void {
    this._param = param
    this._param.requestUpdate()
  }
  detached(): void {
    this._param = null
  }
  paneViews() {
    return [this._paneView]
  }
  updateAllViews(): void {
    if (!this._param) return
    this._paneView.update(this._drawings, this._param)
  }

  applyData(drawings: readonly UserDrawing[]) {
    this._drawings = drawings
    this._param?.requestUpdate()
  }
}