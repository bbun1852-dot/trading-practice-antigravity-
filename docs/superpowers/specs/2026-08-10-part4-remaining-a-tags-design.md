# chart-drill Part 4 — 남은 A등급 15종

## 0. 범위와 이유

Part 3 이 실측으로 확인한 미구현 57종 중 **기존 기계로 되는 A등급 15종**이다. 피벗·ATR·
지표 등 Part 1~3 이 이미 가진 것만 쓰므로 **채점기를 한 줄도 고치지 않는다.** 남은
`htf_*` 3종(데이터 계층 필요)과 B·C등급 32종(기하 피팅 엔진 필요)은 다음 파트다.

| 묶음 | 태그 | 파일 |
|---|---|---|
| 지표 6종 | `bb_walking` `rsi_failure_swing` `macd_hist_turn` `ma_support` `ma_resistance` `obv_trend_confirm` | `indicatorExtras.ts` (신규) |
| 거래량 2종 | `vol_divergence` `vol_absorption` | `indicatorExtras.ts` |
| SMC 3종 | `ob_double_engulfing` `liq_pool_untapped` `fvg_rebalance` | `smcExtras.ts` (신규) |
| 구조 4종 | `choch` `sr_flip` `retest_success` `retest_fail` | `structureExtras.ts` (신규) |

**Part 1~3 의 기존 감지기 파일은 수정하지 않는다.** 새 파일을 만들고 `DETECTORS` 에
등록하는 것이 Part 3 에서 확립된 방식이다 — 기존 파일에 끼워 넣으면 diff 가 섞이고
Part 1 이 테스트로 고정한 출력을 건드릴 위험이 생긴다.

## 1. Part 3 이 남긴 교훈 — 이번에 처음부터 지킨다

세 가지가 Part 3 에서 게이트에 걸려서야 드러났다. 이번에는 설계 단계에서 적용한다.

1. **봉마다 재평가되는 신호에는 발화 억제가 필요하다.** 조건이 참인 동안 매 봉 내면
   1000봉당 수백 회가 된다. "처음 성립한 순간" 만 사건이다. 상태를 함수 지역 `Set` 으로
   들고 순서대로 재생하면 인과적이다.
2. **그런 신호에 `zone`/긴 `recent` 수명을 주면 같은 자리가 겹겹이 쌓인다.**
   매봉 재평가 조건의 기본값은 `bar()` 또는 `recent(RECENT_MOMENTARY)` 다.
3. **`assertNoLookAhead` 의 동일성 키는 `refs` 와 `evidence` 문자열까지 포함한다.**
   전역 극값("전체에서 가장 큰 스윙")으로 무언가를 고르면 전부 위반이다. 관측 시점까지
   확정된 값만 쓴다.

## 2. 태그 정의

### 2.1 지표 6종

| id | tier / kind | 정의 | side |
|---|---|---|---|
| `bb_walking` | 3 / volatility | 종가가 밴드 밖에 **연속 3봉** 머무름. 런이 3에 도달한 봉에서만 낸다 | 상단 bullish / 하단 bearish |
| `rsi_failure_swing` | 4 / momentum | 확정된 RSI 피벗 기준. 약세: 직전 RSI 고점이 70 이상이고 다음 고점이 더 낮으며, 그 사이 저점을 하향 돌파 | 약세 bearish / 강세 bullish |
| `macd_hist_turn` | 4 / momentum | 히스토그램이 `h[i-2] > h[i-1] < h[i]` 로 저점을 찍고 방향을 튼 봉(강세). 반대는 약세 | bullish / bearish |
| `ma_support` | 4 / ma | 저가가 EMA50 을 찍었으나 종가는 위에서 마감, 직전 봉도 위였음 | bullish |
| `ma_resistance` | 4 / ma | 고가가 EMA50 을 찍었으나 종가는 아래서 마감, 직전 봉도 아래였음 | bearish |
| `obv_trend_confirm` | 4 / volume | 종가와 OBV 가 **동시에** 최근 20봉 최고(최저) | bullish / bearish |

`macd_hist_turn` 은 `macd_divergence` 와 별개다 — 전자는 히스토그램의 기울기 전환이고
후자는 가격과 지표의 방향 불일치다.

### 2.2 거래량 2종

| id | tier / kind | 정의 | side |
|---|---|---|---|
| `vol_divergence` | 2 / volume | 종가가 최근 20봉 최고(최저)인데 거래량은 20봉 평균 미만 — 힘없는 신고가 | 신고가 bearish / 신저가 bullish |
| `vol_absorption` | 2 / volume | 거래량이 20봉 평균의 2배 이상인데 몸통이 레인지의 30% 미만 — 대량 거래에도 가격이 안 밀린 흡수 | neutral |

`vol_absorption` 이 중립인 이유는 매물대와 같다 — 흡수가 매집인지 분산인지는 위치가
정하지 감지기가 정하지 않는다.

### 2.3 SMC 3종

| id | tier / kind | 정의 |
|---|---|---|
| `ob_double_engulfing` | 1 / smc | 오더블록 봉이 직전 **2봉의 몸통을 모두** 장악. 단일 장악보다 강한 수급 흔적 |
| `liq_pool_untapped` | 1 / smc | 확정 피벗 2개 이상이 ATR 대비 사실상 같은 가격에 쌓였고(등고점/등저점), 그 뒤 아직 그 너머로 거래되지 않음 |
| `fvg_rebalance` | 2 / smc | 미충족 FVG 가 있고 가격이 그쪽으로 접근 중 — 자석 효과 진행 |

`fvg_rebalance` 는 **`lifetime.ts` 의 `'touch'` 무효화 분기의 첫 소비자다.** Part 2 설계
스펙 §170 이 이 태그를 위해 그 분기를 미리 구현해 뒀다고 적었고, 그동안 도달 불가였다.
FVG 를 건드리면 리밸런스가 끝난 것이므로 `touch` 가 정확히 맞는 의미다.

### 2.4 구조 4종

| id | tier / kind | 정의 |
|---|---|---|
| `choch` | 1 / structure | 추세 방향과 **반대로** 구조가 깨짐. 상승 구조에서 직전 스윙로우 하향 이탈(약세) |
| `sr_flip` | 1 / structure | `srLevels` 의 S/R 구간을 종가로 돌파한 뒤 되돌아와 그 위(아래)에서 지켜냄 |
| `retest_success` | 1 / structure | 직전 MSB/BOS 돌파 레벨로 되돌아왔다가 돌파 방향으로 마감 |
| `retest_fail` | 1 / structure | 같은 상황에서 돌파 이전 쪽으로 되돌아 마감 — 페이크아웃 |

**`choch` 와 `msb_*` 는 겹칠 수 있다.** 둘 다 구조 붕괴를 보지만 `msb_*` 는 사건 자체,
`choch` 는 "그것이 추세를 거스르는가" 라는 맥락이다. 겹치는 것이 정상이며, 겹침이
과도하면 §4 의 발화율 게이트가 잡는다.

`sr_flip` 은 `srLevels`(군집된 S/R), `retest_*` 는 MSB 돌파 레벨을 본다 — 둘이 같은
사건을 두 번 세지 않도록 **다른 레벨 출처**를 쓰는 것이 구분의 핵심이다.

## 3. 배점과 수명 (초안)

`WEIGHT` 표의 그룹을 따른다. 3점 = 수급·기하, 2점 = 모멘텀·캔들.

| 태그 | 배점 | 수명 |
|---|---|---|
| `choch` `sr_flip` `retest_success` `retest_fail` | 4 | `recent(RECENT_STRUCTURAL)` |
| `ob_double_engulfing` | 3 | `zone(ZONE_MAX_BARS, 'close_through')` |
| `liq_pool_untapped` | 4 | `recent(RECENT_STRUCTURAL)` |
| `fvg_rebalance` | 4 | **`zone(ZONE_MAX_BARS, 'touch')`** |
| `vol_divergence` `vol_absorption` | 4 | `recent(RECENT_MOMENTARY)` |
| `bb_walking` | 3 | `recent(RECENT_MOMENTARY)` |
| `obv_trend_confirm` | 3 | `recent(RECENT_MOMENTARY)` |
| `rsi_failure_swing` `macd_hist_turn` `ma_support` `ma_resistance` | 2 | `recent(RECENT_MOMENTARY)` |

전부 초안이며 §4 가 확정한다.

## 4. 게이트 (전부 PASS 여야 완료)

Part 3 과 동일한 회귀 장치다. `calibrate.ts` 가 실패 시 0 이 아닌 코드로 끝난다.

1. **발화율**: 신규 태그 각각 1000봉당 **5~150회**
2. **유효 근거**: 계열별 중앙값 **8~15**
3. **후보 밀도**: 계열별 1000봉당 **15~40개**
4. **핵심 근거 K**: 커버리지 중앙값 **60~80%**, 참고 소멸 5% 미만
5. **미래참조**: 신규 감지기 3개가 `assertNoLookAhead` 통과(공허하지 않게)
6. **결정론**: `drill` 2회 출력 완전 동일

태그가 56 → 71종이 되므로 2~4 는 반드시 다시 흔들린다. 수명부터 조정하고, 그래도
안 되면 `DEFAULT_MIN_SCORE` 와 `DEFAULT_CORE_K` 를 재확정한다.

## 5. 태스크

1. 지표 6종 (`indicatorExtras.ts`)
2. 거래량 2종 (같은 파일)
3. SMC 3종 (`smcExtras.ts`) — `fvg_rebalance` 가 `'touch'` 분기를 살린다
4. 구조 4종 (`structureExtras.ts`)
5. taxonomy 등재 15종 + ruleCheck 배치
6. calibrate 확장과 임계값 확정 — **위험 체크포인트**
7. 전체 브랜치 리뷰

## 6. 미결

- `ma_support`/`ma_resistance` 를 EMA50 하나로 볼지 EMA200 도 볼지는 발화율을 보고 6번에서
  정한다. 초안은 EMA50 뿐이다
- `ob_double_engulfing` 이 `ob_bull_support` 와 항상 함께 나오면 배점이 이중 계상된다.
  6번에서 동시 발화율을 재고, 높으면 `ob_double_engulfing` 의 배점을 낮춘다
