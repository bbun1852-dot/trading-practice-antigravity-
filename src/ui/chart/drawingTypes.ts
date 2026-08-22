export type DrawingType = 'trendline' | 'ray' | 'fibonacci'

export interface DrawingPoint {
  time: number
  price: number
}

export interface UserDrawing {
  id: string
  type: DrawingType
  p1: DrawingPoint
  p2: DrawingPoint
}