# chart-drill — 기술적 분석 학습 및 전략 연습 툴 설계

작성일: 2026-08-02
상태: 승인됨 (설계 ①②③ 확정)

## 1. 목적

실제 캔들차트를 문제로 받아 진입·손절·익절을 직접 판단하고, **어떤 근거로 그렇게 봤는지**까지 제출하면
툴이 채점·해설하는 반복 연습 도구.

이전 시도(채팅 기반 Q&A)가 실패한 이유는 두 가지였다.

1. 차트를 말로 묘사해서 주고받았기 때문에 실제 차트 판독 연습이 되지 않았다.
2. "정답 근거"가 존재하지 않아 *"내가 놓친 패턴이 있는지"* 를 판정할 수 없었다.

이 설계는 두 문제를 각각 **인터랙티브 차트**와 **룰 기반 신호 감지 엔진**으로 해결한다.

## 2. 범위

### Phase 1 (본 스펙)
로컬 웹앱. 문제 출제 → 매매 입력 → 채점 → 해설 → 오답노트 자동생성 → 성적 누적.

### Phase 2 (별도 스펙)
Claude Code 스킬. Phase 1이 export한 JSON/markdown을 읽어 심층 해설과 누적 약점 리포트를 생성.
Phase 1의 `analysis/` 모듈을 Node에서 그대로 재실행할 수 있도록 순수 함수로 유지하는 것이 전제.

### 비범위
- 실시간 매매 / 브로커 연동
- 백테스트 엔진 (전략 자동화)
- 차트 작도 도구 (추세선 직접 긋기) — 4.3 참조
- 로그인 / 서버 / 멀티유저

## 3. 사용자 컨텍스트

- 수준: 중급 — 지표와 패턴 이름은 알지만 실전 진입/손절 판단이 흔들림
- 연습 대상: 스윙(4H/1D), 데이트레이딩(15m/1H), 포지션(1D/1W). 스캘핑 제외
- 기존 학습 자산: 본인이 정리한 트레이딩 노트 (`주식.docx`, 약 2,200줄)
  - SMC(스마트머니) + 와이코프 중심
  - **본인만의 34점 가중치 진입 판단 시스템** 보유
  - 손으로 쓴 오답노트 운용 중 (2026-03-09, 03-10 등)

노트의 내용은 태그 체계·문제 유형·채점 로직 전반에 반영한다. 상세는 6절.

## 4. 아키텍처

### 4.1 프로젝트 구조

```
C:\Users\bbun1\chart-drill\
  src/
    data/
      binance.ts        Binance klines fetch + 페이지네이션
      cache.ts          IndexedDB 캔들 청크 캐시
      types.ts          Candle, Timeframe
    analysis/           ← 전부 순수 함수. UI 의존성 없음 (Phase 2 재사용 전제)
      indicators.ts     SMA/EMA/RSI/MACD/BB/ATR/OBV/VolumeMA
      structure.ts      스윙 하이·로우, 추세 판정, S/R 클러스터링, 추세선, 채널
      smc.ts            오더블록, FVG, 유동성 스윕, BOS/MSB, CHoCH, S/R 플립
      candlePatterns.ts 캔들패턴 16종
      chartPatterns.ts  차트패턴 16종
      divergence.ts     RSI/MACD/OBV 다이버전스 (일반·히든)
      wyckoff.ts        레인지 감지 + Phase 후보 라벨링
      signals.ts        detectSignals(candles, atIndex) → Signal[]   ← 정답 근거의 단일 원천
    quiz/
      taxonomy.ts       태그 정의 (id, 라벨, Tier 가중치, 감지 신뢰도 등급)
      scanner.ts        scanForSetups(candles) → SetupCandidate[]
      generator.ts      문제 생성 (종목·TF·난이도·유형 배분)
      grader.ts         grade(question, answer) → GradeReport
      ruleCheck.ts      34점 가중치 산출 + 트레이딩 룰 준수 검사
      replay.ts         은닉 봉 재생, SL/TP 체결, R·PnL 계산
      review.ts         오답노트 markdown 생성 + 반복 실수 카운트
    ui/
      ChartPane.tsx     lightweight-charts 래퍼 (메인 + 상위 TF 미니차트)
      TradePanel.tsx    방향·진입·손절·익절 입력
      TagPanel.tsx      근거 태그 선택 (카테고리 아코디언 + 검색, 최대 15개)
      ResultPanel.tsx   채점 결과·근거 대조표·차트 오버레이
      RulePanel.tsx     34점 룰 검증 (별도 패널, 클릭 시 노출)
      Dashboard.tsx     누적 성적·약점 분석·반복 실수
      ReviewArchive.tsx 오답노트 아카이브
    store/
      session.ts        현재 문제 상태 (zustand)
      history.ts        IndexedDB 이력 + JSON/markdown export
  docs/superpowers/specs/
```

### 4.2 핵심 데이터 계약

```ts
type Candle = {
  time: number      // ms epoch, 봉 시작
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type Timeframe = '15m' | '1h' | '4h' | '1d' | '1w'

type SignalId = string   // taxonomy.ts에 정의된 id

type Signal = {
  id: SignalId
  tier: 1 | 2 | 3 | 4          // 노트의 가중치 Tier (5/4/3/2점)
  kind: 'structure' | 'smc' | 'volume' | 'pattern' | 'candle'
      | 'momentum' | 'ma' | 'fib' | 'volatility' | 'wyckoff' | 'htf'
  side: 'bullish' | 'bearish' | 'neutral'
  barIndex: number             // 신호가 '확정'된 봉. 반드시 <= decisionIndex
  confidence: 'A' | 'B' | 'C'  // 감지 신뢰도 등급 (6.7 참조)
  strength: 1 | 2 | 3
  evidence: string             // "RSI 저점 28.4→35.1 상승, 가격 저점 -3.2% 하락"
  refs?: {                     // 채점 후 차트 오버레이용 좌표
    price?: number
    priceHigh?: number
    priceLow?: number
    fromBar?: number
    toBar?: number
  }
}
```

`detectSignals(candles, atIndex)` 가 이 시스템의 중심이다.
문제 출제(스캐너), 채점(근거 대조), 34점 산출이 모두 이 함수 하나의 출력을 소비한다.

### 4.3 차트 작도 도구를 제외한 이유

lightweight-charts에는 작도 기능이 없어 추세선·박스 그리기를 직접 구현해야 한다.
드래그 상태 관리, 좌표 변환, 스냅, 편집·삭제, 저장까지 하면 이 하나가 나머지 UI 전체와
맞먹는 작업량이 된다. 반면 **"추세선을 인식했는가"는 태그 체크로 이미 측정되므로**
학습 측정 목적에는 손실이 거의 없다. 진입·손절·익절 3개 가격 라인의 드래그만 지원한다.

향후 필요해지면 별도 스펙으로 추가한다.

## 5. 출제

### 5.1 데이터

| 항목 | 값 |
|---|---|
| 소스 | `https://api.binance.com/api/v3/klines` (API키 불필요, CORS `*` 확인 완료) |
| 종목 풀 | 거래량 상위 USDT 페어 25종 하드코딩 (BTC/ETH/SOL/BNB/XRP/ADA/AVAX/LINK/DOT 등) |
| 타임프레임 | `15m` `1h` `4h` `1d` `1w` |
| 문제당 봉 수 | 지표 워밍업 120 + 노출 220 + 은닉 60 = **400봉** (1회 요청, 상한 1000) |
| 상위 TF | 같은 구간을 한 단계 상위 TF로 추가 fetch (탑다운 분석용) |
| 출제 범위 | 2019-01 ~ 현재 |
| 캐시 | IndexedDB 청크 저장 → 받은 구간은 오프라인 재연습 가능 |

### 5.2 출제 무결성 규칙

세 가지 규칙이 이 툴의 신뢰성을 지탱한다.

**(1) 미래참조 금지 (look-ahead bias)**
모든 감지 함수는 `candles.slice(0, decisionIndex + 1)` 만 입력받는다.
전체 배열을 넘겨도 `barIndex <= decisionIndex` 인 신호 집합은 동일해야 한다.
**테스트로 강제한다** (9절). 이 규칙이 깨지면 아직 완성되지 않은 봉의 패턴을
"그때 보였던 신호"로 채점하게 되어 모든 채점 결과가 무의미해진다.

**(2) 종목·날짜 마스킹**
문제 중에는 `SYMBOL A / 4H` 로만 표시한다. 채점 완료 후 공개한다.
실제 종목·시점을 알면 기억으로 답을 맞히게 되어 연습이 성립하지 않는다.

**(3) 재현 가능성**
문제는 `{symbol, timeframe, startTime, decisionIndex}` 로 완전히 재현된다.
난수 시드가 아니라 실제 좌표를 저장하므로 같은 문제를 다시 풀거나 남에게 공유할 수 있다.

### 5.3 셋업 스캐너

전체 봉을 순회하며 각 시점의 `Signal[]` 을 계산하고, 교육적 가치가 있는 시점만 후보로 남긴다.

```
tierWeight  = {1: 5, 2: 4, 3: 3, 4: 2}
base        = Σ over signals of (tierWeight[tier] × strength)
diversity   = 2 × (서로 다른 kind 값의 개수)
conflict    = 3 × min(bullish 신호 수, bearish 신호 수)
setupScore  = base + diversity − conflict
```

`setupScore >= 125` 인 봉만 후보로 남긴다. 임계값은 실제 데이터로 후보 밀도를 보고 조정한다
(목표: 4H 기준 1000봉당 후보 15~40개).

> 초안은 `>= 25` 였다. 수명 필터 적용 후 실측한 점수 분포가 최소 22 / 중앙 119 라
> `25`는 사실상 모든 봉을 통과시켜 임계값 구실을 못 했다 (Task 6).

- 인접 봉의 중복 셋업은 병합 (같은 셋업이 연속 20봉 걸리면 대표 1개만).
  창 안에서 **점수가 가장 높은** 하나를 남기고, 동점이면 이른 봉이 이긴다
- 난이도는 신호 상충 정도로 자동 산정. 개수가 아니라 **가중치**로 재며,
  쏠림도 = 우세한 쪽 `Σ(tierWeight × strength)` / 양쪽 합 으로 나눈다
  - **쉬움**: 쏠림도 0.75 이상 (우세한 쪽이 반대편의 3배 이상)
  - **보통**: 쏠림도 0.62 이상 0.75 미만
  - **어려움**: 쏠림도 0.62 미만(사실상 팽팽) 또는 방향 근거가 0개

> 초안은 개수 기준이었다(같은 방향 4개 이상 + 상충 없음 → 쉬움). 유효 근거 중앙값이
> 11개인 실데이터에서는 반대편이 정확히 0개인 자리가 거의 없어 쉬움이 0.4%로 무너졌고,
> 어려움도 "개수 차 1 이하" 라는 좁은 표적이라 12%에 그쳤다. 가중치 기준의 실측 분포는
> 쉬움 37.0% / 보통 31.9% / 어려움 31.1% 다 (Task 6).

### 5.4 문제 유형 배분

| 유형 | 비율 | 설명 |
|---|---|---|
| 정상 셋업 | 60% | 근거가 깔렸고 실제로도 통한 자리 |
| **함정** | 20% | 근거가 3개 이상인데 **실패한** 자리 |
| **노셋업** | 20% | 정답이 **관망**인 자리 |

함정과 노셋업이 이 툴의 핵심 가치다. 중급에서 막히는 지점은 "신호를 못 읽어서"가 아니라
**"신호가 보이면 무조건 들어가서"** 이기 때문이다.
셋업이 있는 자리만 출제하면 관망 판단을 학습할 수 없다는 편향도 이 배분으로 해소된다.

### 5.5 와이코프 전용 문제 유형

레인지를 감지해 다음을 묻는다.

- "이 구간은 어큐뮬레이션/디스트리뷰션 중 어느 Phase인가?"
- "이 하방 돌파는 Spring인가, 진짜 구조 붕괴(MSB)인가?"

판정 근거는 노트에 이미 정리되어 있다:
**거래량 감소 시 돌파 = 가짜(Spring) / 거래량 증가 시 돌파 = 진짜(MSB)**

## 6. 태그 체계 (근거 어휘)

노트의 분류와 가중치를 그대로 따른다. 카테고리 아코디언 + 검색으로 제공하고
**문제당 최대 15개**까지 선택할 수 있다.

### 6.1 Tier 1 (5점) — 시장 구조의 핵심

노트가 Tier 1로 지정한 것은 "유동성구간 & 오더블럭"이다.
여기에 시장구조 신호(`msb_*`, `choch`, `sr_flip`, `retest_*`)를 Tier 1로 함께 편입했다.
노트의 원칙 *"시장의 구조와 돈의 흐름이 보조지표보다 언제나 선행한다"* 와
리테스트 3단계 체크리스트의 비중을 반영한 확장이다.

| id | 라벨 | 신뢰도 |
|---|---|---|
| `ob_bull_support` | 강세 오더블록 지지 | A |
| `ob_bear_resistance` | 약세 오더블록 저항 | A |
| `ob_double_engulfing` | 이중장악형 오더블록 | A |
| `liq_sweep_low` | 저점 유동성 스윕 (롱 손절 사냥) | A |
| `liq_sweep_high` | 고점 유동성 스윕 (숏 손절 사냥) | A |
| `liq_pool_untapped` | 미체결 유동성 구간 존재 | A |
| `volume_node_high` | 매물대 (고거래량 노드) | A |
| `volume_node_low` | 매물대 공백 (저거래량 노드) | A |
| `msb_bull` | 시장구조 상향 돌파 (BOS/MSB) | A |
| `msb_bear` | 시장구조 하향 붕괴 | A |
| `choch` | CHoCH (성격 전환) | A |
| `sr_flip` | S/R 플립 (저항→지지 전환) | A |
| `retest_success` | 리테스트 성공 | A |
| `retest_fail` | 리테스트 실패 (페이크아웃/트랩) | A |

### 6.2 Tier 2 (4점) — 추세 확정·거래량·FVG·차트패턴

거래량: `vol_breakout_confirm`(돌파 시 거래량 급증) · `vol_breakout_weak`(거래량 없는 돌파=트랩) ·
`vol_divergence` · `vol_climax`(셀링/바잉 클라이맥스) · `vol_absorption`(매집 흔적) — 전부 A등급

FVG: `fvg_bull` · `fvg_bear` · `fvg_rebalance`(자석 효과 진행 중) — 전부 A등급

차트패턴 (전부 B등급): `pat_falling_wedge` · `pat_rising_wedge` · `pat_tri_ascending` ·
`pat_tri_descending` · `pat_tri_symmetric` · `pat_flag_bull` · `pat_flag_bear` ·
`pat_double_top` · `pat_double_bottom` · `pat_hns` · `pat_hns_inv` · `pat_cup_handle` ·
`pat_quasimodo`
차트패턴 (C등급): `pat_wolfe` · `pat_abcd` · `pat_harmonic`

### 6.3 Tier 3 (3점) — 기하학적 분석 및 프레임

추세·구조 (A): `trend_up_structure`(HH/HL) · `trend_down_structure`(LH/LL) · `trend_range`
추세선·채널 (B): `trendline_support` · `trendline_resistance` · `trendline_break` ·
`channel_upper` · `channel_lower`
피보나치 (A): `fib_retrace_382` · `fib_retrace_5` · `fib_retrace_618` · `fib_extension` ·
`fib_confluence`(피보 + OB/FVG 중첩)
볼린저 (A): `bb_squeeze` · `bb_break_upper` · `bb_break_lower` · `bb_walking`

### 6.4 Tier 4 (2점) — 모멘텀 및 미세 신호

RSI (A): `rsi_overbought` · `rsi_oversold` · `rsi_bull_div` · `rsi_bear_div` ·
`rsi_hidden_div` · `rsi_50_break` · `rsi_failure_swing`
MACD (A): `macd_golden` · `macd_dead` · `macd_hist_turn` · `macd_zero_break`
이동평균 (A): `ma_golden_cross` · `ma_dead_cross` · `ma_support` · `ma_resistance` ·
`ma_aligned_bull` · `ma_aligned_bear`
OBV (A): `obv_divergence` · `obv_trend_confirm`
캔들패턴 (전부 A): `candle_hammer` · `candle_inv_hammer` · `candle_shooting_star` ·
`candle_doji` · `candle_bull_engulf` · `candle_bear_engulf` · `candle_bull_harami` ·
`candle_bear_harami` · `candle_morning_star` · `candle_evening_star` ·
`candle_three_soldiers` · `candle_three_crows` · `candle_tri_star` · `candle_tweezer` ·
`candle_long_wick` · `candle_inside_bar`

### 6.5 와이코프 (전부 C등급, 참고 라벨)

어큐뮬레이션: `wyckoff_sc`(셀링 클라이맥스) · `wyckoff_ar` · `wyckoff_st` ·
`wyckoff_spring` · `wyckoff_sos` · `wyckoff_lps`
디스트리뷰션: `wyckoff_bc`(바잉 클라이맥스) · `wyckoff_sow` · `wyckoff_ut`(업스러스트) ·
`wyckoff_utad`(불트랩) · `wyckoff_lpsy`

### 6.6 멀티 타임프레임 (Tier 1 취급)

`htf_trend_align`(상위TF 추세 일치) · `htf_trend_conflict`(상위TF 추세 역행) ·
`htf_ob_zone`(상위TF 오더블록 구간) — 전부 A등급

### 6.7 감지 신뢰도 등급 — 채점 강도 차등

전부 똑같이 자동 감지된다고 전제하면 채점이 거짓이 된다. 3등급으로 나눠 채점 강도를 다르게 적용한다.

| 등급 | 성격 | 채점 적용 |
|---|---|---|
| **A** | 결정론적 감지. 계산식으로 참·거짓이 확정됨 | 헛다리 감점 100% 적용 |
| **B** | 근사 감지. 작도 기준에 따라 오차 존재 | 감점 완화 (50%) |
| **C** | 부분 감지. 후보 라벨링까지만 가능 | **감점 없음.** "엔진 미감지, 성립 가능" 표시 |

B·C 항목을 엔진이 못 잡았다고 사용자 잘못으로 처리하면 채점 신뢰가 무너진다.

## 7. 채점

### 7.1 기본 채점 (주 채점 방식)

| 축 | 배점 | 내용 |
|---|---|---|
| 방향 | 30 | 롱/숏/관망이 실제 전개와 맞았는가 |
| 실행 | 40 | 손절 위치의 구조적 타당성, R:R, 실제 재생 PnL·R |
| 근거 | 30 | 체크한 태그 vs 엔진 신호 집합 (신뢰도 등급 반영) |

**방향 축 배점**

정답 방향은 은닉 구간에서 **1.5 ATR 이상의 유의미한 방향 움직임이 먼저 나온 쪽**으로 정의한다.
양쪽 다 1.5 ATR에 못 미치면 정답은 `관망`이다.

| 실제 전개 | 내 판단 | 점수 |
|---|---|---|
| 롱 / 숏 | 일치 | 30 |
| 롱 / 숏 | 관망 | 12 — 기회는 놓쳤으나 손실은 없음 |
| 롱 / 숏 | 반대 | 0 |
| 무방향 | 관망 | 30 |
| 무방향 | 롱 / 숏 | 5 |

함정 문제는 별도 규칙이 필요 없다. 실제 전개가 신호와 반대이므로 이 표로 자연히 처리된다.

**근거 축 판정**

- ✅ **적중** — 실재하는 유효 근거를 잡음
- ⚠️ **놓침** — 있었는데 체크하지 않음
- ❌ **헛다리** — 그 시점에 존재하지 않았던 근거를 체크

❌가 가장 중요한 피드백이다. "MACD 골든크로스를 보고 들어갔다"는데 실제로는 3봉 뒤에 발생했다면,
차트를 잘못 읽은 게 아니라 **없는 것을 본 것**이다.

**실행 축 — 손절 위치 판정**

| 조건 | 판정 |
|---|---|
| 직전 스윙 로우(롱 기준) 아래 | 좋음 — 구조적 손절 |
| 진입가 ± 1.5~2.0 ATR | 무난 |
| < 0.5 ATR | 경고 — 노이즈에 털릴 자리 |
| > 4 ATR | 경고 — R:R 붕괴 |
| R:R < 1.5 | 감점 |

### 7.2 프로세스와 결과의 분리

PnL만으로 채점하면 운으로 맞은 매매와 잘한 매매가 구분되지 않는다.
**프로세스 점수(근거+실행)와 결과 점수를 별도로 표시**하고 명시적 판정을 내린다.

> 근거 4/4 적중, 손절 위치 적절, R:R 2.4 — 그런데 손절당했습니다.
> **이건 잘한 매매입니다.** 같은 자리에 100번 들어가면 수익이 남습니다.

> 결과는 +3.2R인데 근거 1개 적중 / 3개 헛다리, 손절은 0.3 ATR.
> **운입니다.** 같은 매매를 반복하면 계좌가 녹습니다.

중급에서 상급으로의 전환은 정확히 이 구분에서 갈린다.

### 7.3 34점 룰 검증 패널 (별도, 클릭 시 노출)

노트의 가중치 시스템은 **"진입할까 말까"를 판단하기 위한 본인 도구**이므로
주 채점 주체가 아니라 별도 검증 뷰로 둔다. `[내 34점 룰로 보기]` 버튼으로 연다.

**가중치**: Tier 1 = 5점 / Tier 2 = 4점 / Tier 3 = 3점 / Tier 4 = 2점 (총점 34점)
**진입 룰**: +10점 이상 롱 / −10점 이하 숏 / 그 사이는 **무조건 관망(No Trade)**

```
[내가 체크한 근거]              [엔진이 실제로 감지한 것]
오더블럭 지지        +5   ✅   오더블럭 지지            +5
하방웻지 돌파        +4   ✅   하방웻지 돌파            +4
거래량 동반          +4   ❌   돌파 거래량 평균 이하     0   ← 헛다리
                          ⚠️   추세선 하단 이탈        −3   ← 놓침
──────────────────────────────────────────────────────
내 산출: +13점 → 롱 진입        엔진 산출: +6점 → 관망(No Trade)
```

**트레이딩 룰 준수 체크리스트** (같은 패널)

- [ ] 진입 근거 2개 이상 확보했는가
- [ ] ±10점 임계값을 지켰는가
- [ ] 손절 기준이 봉마감인가
- [ ] 기대 수익이 수수료 감안 1% 이상인가
- [ ] 시드의 −5% 고정손실 기준으로 수량을 계산했는가
- [ ] 시나리오를 2개 이상 세웠는가

### 7.4 탑다운 (멀티 타임프레임) 채점

문제에 상위 TF 차트를 함께 제공한다. 상위 추세와 반대 방향으로 진입하면 감점한다.
노트의 원칙을 그대로 구현한 것이다 —
*"작은 시간봉의 신호가 큰 시간봉의 흐름을 이기기는 어렵다"*
*"1시간봉으로 지도를 그리고, 5분봉으로 길을 찾으며, 1분봉으로 발을 내딛는다"*

### 7.5 재생(replay) 체결 규칙

- 봉 단위로 진행, 고가·저가로 SL/TP 터치 판정
- **같은 봉에서 SL과 TP를 모두 터치하면 SL 우선** (보수적 가정)
- 지정가 진입 미체결 시 "진입 실패"로 기록
- 은닉 60봉 내 미청산이면 마지막 종가로 강제 청산

## 8. 오답노트 자동생성

채점 결과를 기존 노트와 같은 형식의 markdown으로 출력한다.

```markdown
## 오답노트 2026-08-02 — BTCUSDT 4H (2024-03-15 08:00)
**내 판단:** 롱 / 진입 68,200 / 손절 66,800 / 익절 72,000 (R:R 2.7)
**결과:** 손절 −1.0R  |  프로세스 62점 / 결과 0점

### 내가 본 근거
- ✅ 오더블록 지지 · ✅ 하방웻지 돌파
- ❌ 거래량 동반 돌파 → 실제 돌파봉 거래량은 20봉 평균의 0.7배

### 놓친 것
- ⚠️ 상위 4H 추세선 하단 이탈 (3봉 전)
- ⚠️ 진입가 +2.1% 지점 미체결 저항 오더블록

### 교훈
추세선 이탈을 확인하지 않고 오더블록만 보고 진입.
→ **동일 유형 반복 3회차**
```

**반복 실수 카운트**가 핵심 기능이다.
실수를 `{놓친 태그, 헛다리 태그, 룰 위반 항목}` 조합으로 유형화해 누적 집계한다.
노트를 보면 2026-03-09와 03-10의 오답이 사실상 같은 원인(추세선 이탈 무시)이었는데,
사람이 이를 알아채려면 과거 노트를 다시 읽어야 한다. 툴이 자동으로 세어준다.

## 9. 테스트 (Vitest)

**(1) look-ahead 회귀 테스트 — 최우선**
모든 감지 함수에 대해 임의의 `i`에서
`detect(전체).filter(s => s.barIndex <= i)` === `detect(candles.slice(0, i+1))`
가 성립하는지 검증한다. 하나라도 깨지면 그 문제의 채점 결과 전체가 거짓이 된다.

**(2) 지표 정확성** — TradingView 실측값 몇 개를 하드코딩해 대조

**(3) 패턴 감지** — 손으로 만든 픽스처 캔들 배열로 참·거짓 케이스 모두 검증

**(4) 재생 체결 엣지케이스** — SL·TP 동시 터치 시 SL 우선, 미체결, 강제청산

**(5) 채점 로직** — 태그 대조, 신뢰도 등급별 감점 차등, 34점 산출

## 10. 저장 및 내보내기

IndexedDB 스토어 3개.

| 스토어 | 내용 |
|---|---|
| `questions` | `{symbol, timeframe, startTime, decisionIndex, type, difficulty}` — 재현 가능 |
| `attempts` | 답안(방향·가격·태그·메모) + 채점 결과 |
| `notes` | 생성된 오답노트 markdown |

전체를 JSON + markdown 번들로 export한다. **Phase 2 스킬이 이 번들을 읽어**
심층 해설과 누적 약점 리포트를 생성한다.

## 11. 기술 스택

Vite · React · TypeScript · lightweight-charts v5 · zustand · idb · Tailwind · Vitest

## 12. 검증된 전제

- Binance `/api/v3/klines` 응답 200, `Access-Control-Allow-Origin: *` — 브라우저에서 프록시 없이 직접 호출 가능 (2026-08-02 실측)
- 1회 요청 상한 1000봉, `startTime`/`endTime` 으로 과거 페이지네이션 가능

## 13. 구현 순서 (마일스톤)

범위가 크므로 각 단계가 **끝날 때마다 동작하는 상태**가 되도록 나눈다.

| # | 마일스톤 | 완료 기준 |
|---|---|---|
| M1 | 데이터 + 차트 | Binance에서 400봉 받아 캐시하고 차트에 그린다. 마스킹 적용 |
| M2 | 지표 + 구조 | `indicators.ts`, `structure.ts` 완성. look-ahead 테스트 통과 |
| M3 | A등급 감지 (1차) | `smc.ts`, `candlePatterns.ts`, `divergence.ts`, `indicatorSignals.ts` — 아래 40종 |
| M4 | 출제 + 재생 + 기본 채점 | 문제를 풀고 채점받는 전체 루프가 처음으로 완성됨 |
| M5 | B·C등급 감지 | `chartPatterns.ts`, `wyckoff.ts`. 감점 차등 적용 |
| M6 | 34점 패널 + 룰 체크 | `ruleCheck.ts` + `RulePanel.tsx` |
| M7 | 오답노트 + 대시보드 | `review.ts`, 반복 실수 카운트, 누적 성적, export |

M4 시점에 이미 쓸 수 있는 툴이 된다. M5~M7은 그 위에 얹는다.

### M3 범위 정정 (2026-08-02, Part 1 구현 후)

원래 M3를 "A등급 태그 전량"으로 적었으나, Part 1 구현 결과 **40종**만 완성되었다.
최종 리뷰가 이 불일치를 잡았다 — 계획의 파일표는 `choch`·`sr_flip`·`retest_*` 를
`smc.ts` 에 배정해두었는데 실제로는 구현되지 않았다.

**M3에서 완성된 것 (40종):**
오더블록 2 · FVG 2 · 유동성 스윕 2 · MSB 2 · 추세 구조 3 ·
캔들패턴 16 · 다이버전스 5(RSI 3 + MACD·OBV 각 강세·약세) ·
RSI 3 · MACD 3 · 이동평균 6 · 볼린저 3 · 거래량 3

**M4로 이관 (약 20종):**
`choch` · `sr_flip` · `retest_success` · `retest_fail` · `liq_pool_untapped` ·
`volume_node_high` · `volume_node_low` · `ob_double_engulfing` · `fvg_rebalance` ·
`vol_divergence` · `vol_absorption` · `fib_retrace_382/5/618` · `fib_extension` ·
`fib_confluence` · `bb_walking` · `rsi_failure_swing` · `macd_hist_turn` ·
`ma_support` · `ma_resistance` · `obv_trend_confirm`

**왜 M4로 미루는가:** 이 중 `sr_flip`·`retest_*` 는 `srLevels` 에 의존하는데,
`srLevels` 는 현재 export만 되고 아무 감지기도 쓰지 않는다. 그리고 이 태그들은
"이 레벨이 지금도 유효한가"라는 **신호 수명(lifetime)** 개념을 요구하는데,
현재 `Signal` 에는 유효기간 필드가 없다. 최종 리뷰가 지적했듯
`detectSignals(cs, 340)` 이 719개 신호를 내는데 최근 5봉에 속한 건 17개뿐이다.
M4에서 태그 체계·스캐너·채점기를 함께 설계하면서 수명 규약을 정한 뒤 구현해야
두 번 쓰지 않는다.

**중요:** M4의 태그 체계(`taxonomy.ts`)에는 **감지기가 존재하는 태그만** 올린다.
감지기 없는 태그를 사용자에게 체크 가능하게 노출하면 체크하는 족족 확정 ❌ 가 된다.

## 14. 미결 사항

없음. 구현 계획 수립으로 진행 가능.
