# 진짜 HTF 데이터 계층 구현 (작업 3)

## 1. 개요
현재 `src/analysis/htf.ts`는 하위 타임프레임(LTF) 캔들을 배열 인덱스 기준으로 4개씩 묶어 상위 타임프레임(HTF)을 합성합니다. 이로 인해 캘린더와 불일치하며 상위 차트의 실제 모양과 달라지는 한계가 있어 HTF 신호들이 B등급으로 강등되어 있습니다.
이 문서는 진짜 HTF 데이터를 Fetch하여 채점기(Question)와 감지기(detectHTF)에 연결하기 위한 데이터 계층 스펙입니다.

## 2. 데이터 모델 변경 (`src/data/types.ts`, `src/quiz/types.ts`)
- `src/data/types.ts` 에 Timeframe 별 DURATION을 상수로 추가.
- `Question`과 `SolverView` 인터페이스에 HTF 캔들 배열 추가.

```typescript
export type Question = {
  // ...
  candles: Candle[]
  htfCandles: Candle[]
}

export type SolverView = {
  // ...
  candles: Candle[]
  htfCandles: Candle[]
}
```

## 3. 스캐너 및 제너레이터 변경 (`src/quiz/scanner.ts`, `src/quiz/generator.ts`)
- `scanForSetups`, `makeQuestion`, `solverView` 함수가 `htfCandles`를 받고/보존합니다.
- `makeQuestion` 시, LTF 창(`cs.slice(start, end)`)에 대응하는 HTF 창을 잘라내어 반환합니다.
- 잘라내는 기준은 시간에 기반합니다. `htfCandles.filter(c => ...)`

## 4. 감지기 인터페이스 변경 (`src/analysis/signals.ts`)
`detectAll`과 각 감지기에 HTF 데이터와 Timeframe 정보를 넘겨야 합니다.
```typescript
export function detectAll(
  cs: Candle[], 
  tf: Timeframe = '1h', 
  htfCs?: Candle[], 
  htfTf?: Timeframe
): Signal[]
```
- 하네스의 `detectHTF` 호출 시 진짜 상위 타임프레임 캔들을 주입.

## 5. 인과성 보장 (Look-ahead 방지)
`detectHTF` 내부에서 특정 LTF 봉 `i`에서 사용할 수 있는 HTF 봉은 **"닫힌 봉"** 이어야 합니다.
- 타임프레임별 지속 시간(초)을 상수로 정의합니다. (`DURATION['4h'] = 4 * 60 * 60` 등)
- HTF 봉 `j`가 LTF 봉 `i` 시점에 닫혔는지 여부는 다음 공식으로 확인합니다:
  `htfCs[j].time + DURATION[htfTf] <= cs[i].time + DURATION[tf]`
- 이 조건을 만족하는 HTF 봉들로만 `findPivots`를 돌리고 신호를 검사합니다.

## 6. 등급 격상 (B → A)
진짜 캘린더 기반의 HTF 캔들을 사용하고 닫힌 봉만을 참조하여 인과성을 만족하므로, 사용자가 거래소 차트에서 보는 실제 HTF 캔들의 종가/피벗과 완벽히 일치하게 됩니다.
따라서 `htf_trend`, `htf_bos`, `htf_poi` 3종 태그의 `confidence`를 **B등급에서 A등급으로 승격**합니다.
