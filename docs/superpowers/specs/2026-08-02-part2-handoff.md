# Part 1 → Part 2 인계 문서

작성일: 2026-08-02
Part 1 최종 커밋: `c1187f4` (브랜치 `feat/part1-engine`, master `68d3682` 에서 27 커밋)
테스트: 124/124 통과, `tsc --noEmit` exit 0

Part 1 실행 중 발견되었으나 Part 2로 미룬 항목들이다.
SDD 워크스페이스(원장·리포트)는 병합 시 삭제되므로 여기에 옮겨 적는다.

## 1. Part 2가 먼저 결정해야 할 것 — 신호 수명(lifetime)

이게 가장 중요하다. 지금 `Signal` 에는 **유효기간 개념이 없다.**

`detectSignals(cs, 340)` 은 719개 신호를 반환하는데 그중 최근 5봉에 속한 건 17개뿐이다.
나머지는 300봉 전에 확정된 캔들패턴 같은 것들이다. 이대로 "정답 근거 목록"으로 쓰면
사용자에게 *"340봉 시점에 40봉 전 도지를 놓쳤다"* 는 무의미한 ⚠️놓침이 쏟아진다.

성격이 다른 세 부류가 평평하게 섞여 있다:

| 부류 | 예 | 성격 |
|---|---|---|
| 점 사건 | 캔들패턴 16종, MACD 크로스 | 그 봉에서만 유효 |
| 상태 조건부 구간 | FVG, 오더블록 | 메워지거나 깨질 때까지 유효 |
| 최신 상태 | 추세, MA 정배열 | 갱신되기 전까지 유효 |

**Part 2 첫 태스크에서 `Signal` 에 유효기간 필드를 추가하거나, 채점기가 부류별
windowing 규칙을 적용하도록 설계할 것.** 이걸 정하지 않고 스캐너·채점기를 만들면
전부 다시 써야 한다.

관련해서 현재 발화 관례가 셋으로 갈려 있다 (최종 리뷰 F6):
`ma_aligned_bull` 은 매 봉(400봉 중 159회), `trend_*` 는 피벗 확정마다,
`bb_squeeze` 는 조건 충족 봉마다.

## 2. 미구현 A등급 태그 약 20종

스펙 13절 "M3 범위 정정" 참조. `choch`·`sr_flip`·`retest_*`·`liq_pool_untapped`·
`volume_node_*`·`ob_double_engulfing`·`fvg_rebalance`·`vol_divergence`·`vol_absorption`·
`fib_*`(5)·`bb_walking`·`rsi_failure_swing`·`macd_hist_turn`·`ma_support/resistance`·
`obv_trend_confirm`

**`taxonomy.ts` 에는 감지기가 존재하는 태그만 올릴 것.** 감지기 없는 태그를
사용자에게 체크 가능하게 노출하면 체크하는 족족 확정 ❌ 가 된다.

`sr_flip` / `retest_*` 는 `srLevels` 에 의존한다. `srLevels` 는 구현·테스트되어 있으나
**현재 아무 감지기도 쓰지 않는다** (export만 됨).

## 3. 미해결 결함 (병합 시점에 defer 판정)

| # | 위치 | 내용 |
|---|---|---|
| D1 | `src/data/cache.ts` `db()` | `openDB` 프로미스를 거부 시에도 캐시. 한 번 실패하면 모듈 수명 내내 오염. Part 2가 IndexedDB를 실제로 연결할 때 왕복 테스트와 함께 수정 |
| D2 | `src/analysis/smc.ts` | `pivot.pivotBar < i` 가드 4곳이 중복. `barIndex <= i` 가 이미 함의. 무해하나 후속 독자 오도 |
| D3 | `src/analysis/candlePatterns.ts` | `candle_tweezer` 가 한 봉에서 양방향 동시 발화(400봉 중 3회). id 하나에 상반된 `side` → id가 키가 아니게 됨. **Part 2 택소노미에서 `tweezer_top`/`tweezer_bottom` 으로 분리할 것** |
| D4 | `src/analysis/divergence.ts` | `macd_divergence` 가 스펙 6.4 택소노미에 없다. 12회/400봉 발화하는데 사용자가 청구할 수 없어 영구 유령 ⚠️놓침이 된다. 택소노미에 추가하거나 emit을 막을 것 |
| D5 | `src/analysis/signals.ts` | `detectAll` 정렬 동률(같은 `barIndex`+`id`) 10건. V8 stable sort + 고정 감지기 순서로 실질 결정론적이나 명시 테스트 없음 |
| D6 | `src/analysis/structure.ts` | `msb_bull` 전용 양성 테스트 없음(통합 픽스처에서 18회 발화, `msb_bear` 는 직접 테스트됨) |
| D7 | `src/analysis/candlePatterns.ts` | `inv_hammer`/`shooting_star` 의 `body > 0` 가드가 규칙표에 없다. **코드가 옳다** — 평봉에서 `isDoji` 는 `range > 0` 때문에 발화하지 않으므로 이 가드가 하중을 받는다. **규칙표를 고칠 것** |

## 4. 스캐너 임계값 재조정 필요

스펙 5.3의 `setupScore >= 25` 를 실제 출력에 적용하면 **1000봉당 178개** 후보가 나온다.
목표는 15~40개였다. 임계값을 올리거나 점수식을 조정해야 한다.
(스펙이 "실제 데이터로 후보 밀도를 보고 조정한다"고 이미 예고한 부분)

## 5. 성능 실측

- `detectSignals(cs, i)` 400봉 문제 1개: **189ms** — 문제 출제에는 충분
- 1000봉 전체 스캔: **1215ms** — 대량 스캔에는 부담. 캐싱 전략 필요할 수 있음

**주의:** 성능을 이유로 `detectAll(cs)` 를 한 번 돌리고 `filter(s => s.barIndex <= i)` 로
잘라 쓰고 싶어질 것이다. **그렇게 하지 말 것.** 상태 의존 신호(미충족 FVG 등)는
관측 시점에 따라 정당하게 달라지므로 filter는 `detectSignals` 와 동치가 아니다.
Part 1 최종 리뷰가 `detectTrend` 에서 정확히 이 문제를 잡았다(F2).
`detectSignals` 가 유일한 진입점이다.

## 6. 타입 확장 예정

`SignalKind` 에 `'wyckoff'` 와 `'htf'` 가 없다. 스펙 4.2는 포함하고 있으며
M5(와이코프)·탑다운 채점에서 필요하다.

## 7. Part 1이 보증하는 것

- `src/analysis/` 전 모듈 순수 함수 (DOM·네트워크·전역 상태·`Date.now()` 없음) —
  Phase 2 스킬이 Node에서 그대로 재실행 가능
- **미래참조 없음**: 모든 신호는 `barIndex` 까지의 데이터만으로 도출 가능.
  `assertNoLookAhead` 가 9개 필드 전부를 키로 비교하고, 중복 배출을 세고,
  신호 0개면 공허 통과 대신 throw 한다. 적대적 리뷰가 치팅 감지기 16종으로
  공격해 보강한 버전이다.
- `detectSignals(cs, 180)` 이후 봉을 전부 다른 캔들로 바꿔도 출력이 동일함을
  테스트로 고정(탬퍼 테스트)
