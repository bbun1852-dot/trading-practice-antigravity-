/**
 * 프리미티브의 **배치 계산**만 모아둔 순수 함수.
 *
 * lightweight-charts 의 좌표 변환(timeToCoordinate·priceToCoordinate)은 캔버스와
 * 차트 상태에 묶여 있어 jsdom 으로 테스트할 수 없다. 그래서 변환 결과(픽셀 또는
 * null)를 받아 도형을 확정하는 단계를 분리한다 — 여기가 단위 테스트 대상이다 (스펙 §7).
 */

export type PixelRect = { x: number; y: number; width: number; height: number }

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
