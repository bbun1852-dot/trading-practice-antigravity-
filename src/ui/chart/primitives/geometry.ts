/**
 * 프리미티브의 **배치 계산**만 모아둔 순수 함수.
 *
 * lightweight-charts 의 좌표 변환(timeToCoordinate·priceToCoordinate)은 캔버스와
 * 차트 상태에 묶여 있어 jsdom 으로 테스트할 수 없다. 그래서 변환 결과(픽셀 또는
 * null)를 받아 도형을 확정하는 단계를 분리한다 — 여기가 단위 테스트 대상이다 (스펙 §7).
 */

export type PixelRect = { x: number; y: number; width: number; height: number }
export type PixelSegment = { x1: number; y1: number; x2: number; y2: number }
export type PixelPoint = { x: number; y: number }

/**
 * 가격 박스 배치. 좌표는 이미 픽셀로 변환된 값이고, **null 은 "화면 범위 밖"** 이다.
 *
 * - 세로(y): 가격 축은 보이는 범위 밖도 좌표를 주므로 null 이면 레이아웃 전이다 → 그리지 않는다
 * - 가로(x): 시간 축은 보이는 범위 밖에서 null 을 준다. 박스의 한쪽 끝만 밖이면
 *   **화면 가장자리로 잘라서** 그린다 — 오더블록이 왼쪽으로 스크롤돼도 남은 부분은 보여야 한다.
 *   양쪽 다 밖이면 전체가 화면 밖이므로 그리지 않는다.
 */
export function placeBox(
  c: { x1: number | null; x2: number | null; y1: number | null; y2: number | null },
  paneWidth: number,
): PixelRect | null {
  if (c.y1 === null || c.y2 === null) return null
  if (c.x1 === null && c.x2 === null) return null
  const x1 = c.x1 ?? 0
  const x2 = c.x2 ?? paneWidth
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const top = Math.min(c.y1, c.y2)
  const bottom = Math.max(c.y1, c.y2)
  // 클램프 후 폭이 0 이하이면(전부 화면 밖으로 잘림) 그릴 것이 없다
  const clampedLeft = Math.max(0, left)
  const clampedRight = Math.min(paneWidth, right)
  if (clampedRight <= clampedLeft) return null
  return {
    x: clampedLeft,
    y: top,
    width: clampedRight - clampedLeft,
    height: Math.max(1, bottom - top), // 얇은 FVG 도 최소 1px 은 보이게
  }
}

/**
 * 수평 레벨 배치. 박스와 같은 가로 규칙(한쪽 끝만 밖이면 가장자리로 자른다)을 쓰고,
 * 세로는 한 값뿐이라 null 이면 그릴 수 없다.
 */
export function placeLevel(
  c: { x1: number | null; x2: number | null; y: number | null },
  paneWidth: number,
): PixelSegment | null {
  if (c.y === null) return null
  if (c.x1 === null && c.x2 === null) return null
  const left = Math.max(0, Math.min(c.x1 ?? 0, c.x2 ?? paneWidth))
  const right = Math.min(paneWidth, Math.max(c.x1 ?? 0, c.x2 ?? paneWidth))
  if (right <= left) return null
  return { x1: left, y1: c.y, x2: right, y2: c.y }
}

/**
 * 사선 배치. 두 끝점이 다 있어야 기울기가 정해지므로 **하나라도 없으면 그리지 않는다.**
 *
 * 화면 밖으로 이어 그리는 연장은 하지 않는다 — 추세선을 임의로 늘리면 실제 감지기가
 * 본 구간과 다른 것을 보여 주게 된다. 화면 밖 부분은 캔버스가 알아서 잘라 낸다.
 */
export function placeLine(
  c: { x1: number | null; y1: number | null; x2: number | null; y2: number | null },
): PixelSegment | null {
  if (c.x1 === null || c.y1 === null || c.x2 === null || c.y2 === null) return null
  return { x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 }
}

/** 봉 표시 배치. 봉 하나를 가리키므로 좌표가 없으면(화면 밖) 그릴 것이 없다. */
export function placeMarker(
  c: { x: number | null; y: number | null },
  paneWidth: number,
): PixelPoint | null {
  if (c.x === null || c.y === null) return null
  if (c.x < 0 || c.x > paneWidth) return null
  return { x: c.x, y: c.y }
}
