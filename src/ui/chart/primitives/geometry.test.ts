import { describe, it, expect } from 'vitest'
import { placeBox } from './geometry'

describe('placeBox — 가격 박스 배치', () => {
  it('네 좌표가 다 있으면 정규화된 사각형을 낸다 (뒤집힌 입력도)', () => {
    // y1(고가)이 화면에서 위(작은 값)다. 뒤집어 넣어도 같은 결과여야 한다.
    const a = placeBox({ x1: 10, x2: 50, y1: 20, y2: 80 }, 800)
    const b = placeBox({ x1: 50, x2: 10, y1: 80, y2: 20 }, 800)
    expect(a).toEqual({ x: 10, y: 20, width: 40, height: 60 })
    expect(b).toEqual(a)
  })

  it('가격 좌표가 null(레이아웃 전)이면 그리지 않는다', () => {
    expect(placeBox({ x1: 10, x2: 50, y1: null, y2: 80 }, 800)).toBeNull()
    expect(placeBox({ x1: 10, x2: 50, y1: 20, y2: null }, 800)).toBeNull()
  })

  it('왼쪽 끝이 화면 밖(null)이면 0 으로 잘라 그린다 — 스크롤된 오더블록', () => {
    expect(placeBox({ x1: null, x2: 50, y1: 20, y2: 80 }, 800))
      .toEqual({ x: 0, y: 20, width: 50, height: 60 })
  })

  it('오른쪽 끝이 화면 밖(null)이면 pane 너비로 잘라 그린다', () => {
    expect(placeBox({ x1: 700, x2: null, y1: 20, y2: 80 }, 800))
      .toEqual({ x: 700, y: 20, width: 100, height: 60 })
  })

  it('양쪽 다 화면 밖이면 그리지 않는다', () => {
    expect(placeBox({ x1: null, x2: null, y1: 20, y2: 80 }, 800)).toBeNull()
  })

  it('음수 좌표로 전부 왼쪽 밖이면 그리지 않는다', () => {
    expect(placeBox({ x1: -120, x2: -40, y1: 20, y2: 80 }, 800)).toBeNull()
  })

  it('높이 0 짜리 박스도 최소 1px 로 보인다 — 얇은 FVG', () => {
    const r = placeBox({ x1: 10, x2: 50, y1: 42, y2: 42 }, 800)
    expect(r?.height).toBe(1)
  })
})
