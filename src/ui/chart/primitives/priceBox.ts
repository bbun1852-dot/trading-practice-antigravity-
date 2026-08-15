/**
 * PriceBox — 가격 구간 박스 프리미티브 (오더블록·FVG·매물대).
 *
 * refs 의 `priceHigh~priceLow × fromBar~toBar` 를 반투명 사각형으로 그린다.
 * 스펙 §6 의 4종 중 첫 번째이고, Task 1 스파이크의 판정 대상이다 —
 * 이 파일이 lightweight-charts 의 Series Primitives API 로 성립하지 않으면
 * KLineChart 로 전환한다.
 *
 * 좌표 변환(시간·가격 → 픽셀)만 라이브러리에 의존하고, 변환 결과로 사각형을
 * 확정하는 계산은 geometry.ts 의 순수 함수가 한다 (거기가 단위 테스트 대상).
 */
import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import { placeBox, type PixelRect } from './geometry'

export type PriceBoxData = {
  fromTime: Time
  toTime: Time
  priceHigh: number
  priceLow: number
  /** 'rgba(…)' — 채움은 이 색의 저투명, 테두리는 원색 */
  color: string
}

/** 변환은 여기서(차트 상태 접근 가능), 확정은 placeBox 에서(순수) */
type RawCoords = { x1: number | null; x2: number | null; y1: number | null; y2: number | null; color: string }

class PriceBoxRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly coords: RawCoords[]) {}

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    target.useMediaCoordinateSpace((scope) => {
      for (const c of this.coords) {
        const r: PixelRect | null = placeBox(c, scope.mediaSize.width)
        if (!r) continue
        const ctx = scope.context
        ctx.fillStyle = withAlpha(c.color, 0.14)
        ctx.fillRect(r.x, r.y, r.width, r.height)
        ctx.strokeStyle = withAlpha(c.color, 0.75)
        ctx.lineWidth = 1
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.width - 1), Math.max(0, r.height - 1))
      }
    })
  }
}

class PriceBoxPaneView implements IPrimitivePaneView {
  constructor(private readonly source: PriceBoxPrimitive) {}

  renderer(): IPrimitivePaneRenderer | null {
    const p = this.source.param
    if (!p) return null
    const timeScale = p.chart.timeScale()
    const coords: RawCoords[] = this.source.boxes.map((b) => ({
      x1: timeScale.timeToCoordinate(b.fromTime),
      x2: timeScale.timeToCoordinate(b.toTime),
      y1: p.series.priceToCoordinate(b.priceHigh),
      y2: p.series.priceToCoordinate(b.priceLow),
      color: b.color,
    }))
    return new PriceBoxRenderer(coords)
  }

  zOrder(): 'bottom' {
    // 캔들 뒤에 깔린다 — 근거 시각화가 봉을 가리면 안 된다
    return 'bottom'
  }
}

export class PriceBoxPrimitive implements ISeriesPrimitive<Time> {
  param: SeriesAttachedParameter<Time> | null = null
  boxes: PriceBoxData[] = []
  private readonly view = new PriceBoxPaneView(this)

  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param
  }

  detached(): void {
    this.param = null
  }

  setBoxes(boxes: PriceBoxData[]): void {
    this.boxes = boxes
    this.param?.requestUpdate()
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view]
  }
}

function withAlpha(color: string, alpha: number): string {
  // 'rgb(a, b, c)' 또는 '#rrggbb' 를 rgba 로. 스파이크 단계라 두 형태만 지원한다.
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return color
}
