# 2026-08-12 detectMSB 분리 (BOS vs CHoCH) 설계 스펙

## 1. 개요
현재 `src/analysis/smc.ts`의 `detectMSB`는 시장 구조의 붕괴(돌파) 방향만 판별할 뿐, 그것이 기존 추세를 이어가는 연속(BOS, Break of Structure)인지, 아니면 반전(CHoCH, Change of Character)인지 구분하지 않는다. 
이로 인해 `choch` 태그와 `msb_*` 태그가 98% 확률로 중복 발화하며, 사용자가 구조 붕괴를 한 번만 짚어도 2개의 근거(점수)를 얻는 오류가 발생한다.

## 2. 목표
- `detectMSB`를 상태 머신 기반으로 변경하여 BOS와 CHoCH를 구분하여 배출한다.
- 겹침률을 20% 미만으로 낮춘다.
- `choch` 배점을 2점에서 4점으로 롤백할 수 있는지 검토한다.

## 3. 상세 설계

### 3.1 상태 머신 (State Machine)
- `currentTrend: 'up' | 'down' | 'none'` (초기값: `'none'`)
- 상승 붕괴 (Close > Swing High Pivot) 발생 시:
  - `currentTrend === 'up'` 이면: 추세 지속이므로 **BOS (msb_bull)** 배출
  - `currentTrend === 'down'` 또는 `'none'` 이면: 추세 반전(또는 첫 확정)이므로 **CHoCH (choch)** 배출. 단, side는 `bullish`.
  - 이후 `currentTrend`를 `'up'`으로 업데이트.
- 하락 붕괴 (Close < Swing Low Pivot) 발생 시:
  - `currentTrend === 'down'` 이면: 추세 지속이므로 **BOS (msb_bear)** 배출
  - `currentTrend === 'up'` 또는 `'none'` 이면: 추세 반전이므로 **CHoCH (choch)** 배출. side는 `bearish`.
  - 이후 `currentTrend`를 `'down'`으로 업데이트.

### 3.2 태그 매핑
- `msb_bull`: side='bullish'
- `msb_bear`: side='bearish'
- `choch`: side='bullish' 또는 'bearish' (방향에 따라 다름)
  - `taxonomy.ts`의 `choch` 정의에 따르면, CHoCH는 독립적인 태그이며 side를 가질 수 있다.

### 3.3 겹침률 및 점수 롤백
- 분리 전후의 `choch`와 `msb_*` 겹침률을 `scripts/_overlap.ts`를 통해 측정한다.
- 겹침률이 20% 미만이 된다면, `choch`가 더 이상 `msb_*`의 보조 라벨이 아니라 독립적인 배타적 신호가 되므로, `taxonomy.ts`에서 `choch`의 배점을 기존 의도인 4점으로 올리는 것을 제안한다.
