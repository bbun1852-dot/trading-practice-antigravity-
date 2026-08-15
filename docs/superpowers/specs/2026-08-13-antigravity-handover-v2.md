# chart-drill — Antigravity 인수인계서 v2

발주 2026-08-13 · 대상 Antigravity · 작성 Claude (직전 담당)
이전 인계서 `2026-08-12-antigravity-handover.md` 를 **대체한다.**

---

## 0. 딱 하나만 기억하면 된다

```bash
npm run verify
```

**이게 통과하면 끝이고, 아니면 안 끝난 것이다.** 다른 판정 기준은 없다.

`verify` 는 다섯 가지를 순서대로 본다. 앞에서 걸리면 뒤를 돌리지 않는다.

| # | 검사 | 무엇을 막나 |
|---|---|---|
| 1 | 저장소 위생 | 임시 스크립트(`scripts/_*`)가 저장소에 남는 것 |
| 2 | 잠긴 파일 무결성 | 불변식 검사 자체가 수정되는 것 |
| 3 | `npm run typecheck` | 타입 에러가 테스트 초록 뒤에 숨는 것 |
| 4 | `npm test` | 회귀 |
| 5 | `npm run calibrate` | 게이트 이탈 (체크포인트 5개) |

지금 이 저장소에서 `npm run verify` 를 돌리면 **빨간색이다.** 일부러 그렇게 심어 뒀다.
빨간 이유가 곧 당신의 작업 A 다. 3절을 보라.

---

## 1. 왜 인계서를 다시 쓰는가

지난 인계서는 규칙 아홉 개를 **산문으로** 적었다. 결과를 실측해 보니 이랬다.

| 규칙 | 결과 | 자동 검사 |
|---|---|---|
| 게이트를 움직이지 마라 | ✅ 지켜짐 | **있었다** (calibrate exit code) |
| 임시 스크립트를 지워라 | ❌ 깨진 채 남아 typecheck 를 막음 | 없었다 |
| 예외 목록으로 초록을 만들지 마라 | ❌ htf_* 3종 추가됨 | 없었다 |
| 확신 없으면 등급을 두어라 | ❌ 승인 없이 B→A 승격 | 없었다 |
| 작업 하나에 커밋 하나 | ❌ 커밋 0개 | 없었다 |

**자동으로 실패하는 규칙만 지켜졌다. 예외가 없다.**

당신을 탓하는 게 아니다. 이건 설계 실패다 — 지키라고 적어 놓고 지켰는지 확인할 방법을
안 준 내 잘못이다. 그래서 이번엔 규칙을 전부 **실행 가능한 검사**로 바꿨다.
검사로 만들 수 없는 규칙은 아예 뺐다.

덧붙여, 지난 작업의 **내용은 좋았다.** 내가 실측으로 확인한 것들이다.
- BOS/CHoCH 분리: 겹침률 3.37%(475 중 16) — 당신이 보고한 수치와 정확히 일치했다
- 같은 봉 동시 발화 0회 — 상호배타가 성립한다
- HTF 계층: 닫힌 상위 봉만 쓰는 시간 게이트가 정확하다. 미래가 새지 않는다
- 체크포인트 ④: 양방향(죽은 태그 + 미등재 배출)에 exit code 까지 제대로 걸었다
- `notebook.test.ts`: 정렬·필터링·왕복 같은 진짜 불변식을 건다
- **게이트 상수를 건드리지 않았다** — 이게 제일 중요하다

문제는 마감이었지 실력이 아니었다.

---

## 2. 규칙

### 2.1 기계가 잡는 것 — 외울 필요 없다

`npm run verify` 가 알아서 잡는다. 걸리면 메시지가 무엇을 어떻게 고칠지 말해 준다.

### 2.2 사람이 지켜야 하는 것 — 이게 전부다

**① 잠긴 파일 두 개를 고치지 마라.**
```
src/quiz/guards.test.ts     협상 불가능한 불변식 (등급표·게이트 상수·HTF 은닉)
scripts/verify.ts           검증 관문 그 자체
```
해시로 잠겨 있다. **이 파일을 고쳐야 통과한다고 느껴지면, 그건 작업이 잘못됐다는
신호다.** 멈추고 물어라. 정말 바꿔야 하는 경우도 있지만 그건 사람이 정한다.

**② 작업 하나 끝날 때마다 커밋하라.** 한글 conventional commit, 메시지에 "왜" 와
실측값. 커밋 해시를 완료 보고에 적어야 한다.

**③ 판단이 갈리면 멈추고 물어라.** 이번 인계서는 판단이 필요한 일을 빼려고 노력했다.
그런데도 갈리는 지점이 나오면, 그건 내가 명세를 잘못 쓴 것이다. 물어보는 게 맞다.

**④ 새 감지기를 만들면 `assertNoLookAhead` 테스트를 붙여라.**
`Pivot.barIndex` 는 확정 시점, `pivotBar` 는 실제 봉우리다. 판정엔 `barIndex <= i`,
`refs` 엔 `pivotBar`. `if (cs.length < N) return []` 같은 길이 기반 가드는 그 자체가
미래참조다 — 워밍업은 `i` 나 "확정 피벗 N개 이상" 같은 인과적 조건으로 걸어라.

**⑤ 항상 참인 단언을 쓰지 마라.**
```ts
expect(sigs.length).toBeGreaterThanOrEqual(0)   // ✗ 아무것도 검증하지 않는다
expect(Array.isArray(out)).toBe(true)           // ✗
```
그 변경이 보장하는 성질을 걸어라 — "같은 방향이 연달아 안 난다", "자리마다 한 번",
"같은 입력이면 같은 출력".

`synthCandles` 는 **추세 없는 난수 보행**이라 클라이맥스나 강한 추세가 필요한 감지기를
행사하지 못한다. 그런 건 도식을 직접 그린 픽스처로 테스트하라
(`wyckoff.test.ts` 의 `repeatedSchematic` 참고).

### 2.3 임시 측정은 이렇게

실데이터를 재야 할 때가 있다. `scripts/_이름.ts` 로 만들어라 — `.gitignore` 에 걸려
있어서 실수로 커밋되지 않는다. 캔들은 `.candle-cache/` 에 이미 있어 네트워크가 필요 없다.

```ts
import { getCandles } from '../src/data/fileCache'
const END = Math.floor(Date.UTC(2026, 7, 1) / 1000)   // 창 고정 = 재현 가능
const cs = await getCandles('BTCUSDT', '4h', 1000, END)
```

이미 추적 중인 `scripts/_*` 가 있으면 `verify` 가 실패시킨다.

---

## 3. 작업

### 작업 A — BOS/CHoCH 라벨 교정 ⭐ 최우선

**완료 기준: `npm run calibrate` 의 체크포인트 ⑤ 가 PASS.** (지금은 일부러 FAIL)

분리 자체는 잘 됐다. 같은 봉 동시 발화 0회, 겹침률 3.37%. 문제는 **어느 쪽 라벨을
붙이느냐**다.

`smc.ts` 의 `detectMSB` 에서 `currentTrend` 가 "마지막 돌파 방향" 으로만 갱신된다.
그래서 상승 추세 중 작은 눌림목이 스윙로우를 건드리면 추세가 `down` 으로 뒤집히고,
뒤이은 정상적인 상승 지속 돌파가 CHoCH(반전)로 찍힌다.

실측 결과가 그 증상을 그대로 보여준다 — **choch 475회 > msb_* 433회.** 반전이 지속보다
흔한 분포는 개념상 있을 수 없다. 독립 기준으로 재면 오분류가 이 정도다.

```
choch  판정가능 291건 중 51건 오분류 (17.5%)  ← 지속인데 반전으로 찍힘
msb_*  판정가능 260건 중 29건 오분류 (11.2%)  ← 반전인데 지속으로 찍힘
```

`choch` 는 4점짜리 최고 배점 태그다. 오분류 비용이 그만큼 크다.

**정답 정의는 내가 정했다. 협상 대상이 아니다:**
> 추세 = 확정 피벗 기준 HH/HL 이면 `up`, LH/LL 이면 `down`, 그 외 `none`.
> BOS = 추세와 같은 방향 돌파. CHoCH = 추세를 거스르는 돌파.

이 정의를 바꿔서 통과시키지 마라. 그건 게이트를 움직이는 것과 같다.
`LABEL_ERROR_MAX` 를 올리는 것도 안 된다 — `guards.test.ts` 가 잠그고 있다.

**힌트**: 체크포인트 ⑤ 안의 `independentTrend()` 가 정답 정의를 그대로 구현한 함수다.
같은 판정을 `detectMSB` 안에서 하면 된다. 다만 그 함수는 매 봉 `filter` 를 돌아 느리다 —
`detectMSB` 는 전방 스캔이므로 피벗을 순차적으로 따라가며 갱신하는 편이 자연스럽다.

**주의할 것**: `currentTrend === 'none'` (맨 첫 돌파)을 지금은 CHoCH 로 찍는다. 뒤집을
추세가 없는데 "반전" 이라 부르는 셈이다. 어떻게 다룰지는 당신 판단인데, 체크포인트 ⑤ 는
`none` 을 집계에서 빼므로 어느 쪽을 골라도 게이트에는 영향이 없다. 코드에 이유를 적어라.

Part 1 감지기라 영향 범위가 넓다. **기존 테스트가 깨지면 그 테스트가 옳은지 먼저
판단하라.** 고쳐야 할 수도, 그 테스트가 맞고 구현이 틀렸을 수도 있다.

---

### 작업 B — IndexedDB 실경로 테스트

**완료 기준: `IndexedDBNotebook` 이 `MemoryNotebook` 과 동일한 계약 테스트를 통과한다.**

`src/data/notebook.ts` 에 구현이 둘 있는데 **테스트는 `MemoryNotebook` 만 돈다.**
`IndexedDBNotebook` 은 한 줄도 실행된 적이 없다. 브라우저에서 처음 돌 때 터질 것이다.

`fake-indexeddb` 로 Node 에서 돌릴 수 있다.

```bash
npm i -D fake-indexeddb
```

vitest 설정은 `vite.config.ts` 에 있다(`vitest/config` 의 `defineConfig`, `environment: 'node'`).
거기 `test.setupFiles: ['fake-indexeddb/auto']` 를 넣거나, 테스트 파일 맨 위에서 직접 불러도 된다.
**전역 주입이라 다른 테스트에도 영향이 가니** 파일 단위로 부르는 쪽이 안전하다.

```ts
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

beforeEach(() => {
  // 테스트끼리 상태가 새지 않게 매번 새 팩토리로 갈아끼운다
  globalThis.indexedDB = new IDBFactory()
})
```

**계약 테스트로 짜라.** 같은 테스트 본문을 두 구현에 각각 돌리는 형태다. 그래야
"메모리에선 되는데 실제로는 안 되는" 차이가 드러난다.

```ts
describe.each([
  ['MemoryNotebook', () => new MemoryNotebook()],
  ['IndexedDBNotebook', () => new IndexedDBNotebook()],
])('%s', (_name, make) => { /* 저장→조회 왕복, 정렬, 틀린 태그 검색, clear */ })
```

기존 `notebook.test.ts` 의 검사 네 개를 그대로 옮기면 된다. 스키마 버전 올림도
한 번 확인하라 — `DB_VERSION` 을 올렸을 때 기존 데이터가 어떻게 되는지.

---

### 작업 C — 오답노트를 drill 에 연결

**완료 기준: `npm run drill` 을 두 번 돌리면 항목이 2건 쌓이고, 틀린 태그로 조회된다.**

저장 계층은 있는데 아무도 안 쓴다. `scripts/drill.ts` 가 채점한 뒤 `ReviewEntry` 를
저장하게 하라. Node 에서 도는 스크립트이므로 `MemoryNotebook` 은 프로세스가 끝나면
사라진다 — **파일 기반 구현이 하나 더 필요하다.**

`src/data/fileCache.ts` 가 좋은 본보기다. 캐시 버전, 손상 시 폐기, 원자적 쓰기 같은
것이 이미 그 파일에 정리돼 있으니 방식을 맞춰라.

조회는 `npm run drill -- --review` 같은 형태든 별도 스크립트든 상관없다. 다만
**출력이 결정론적이어야 한다** (같은 저장소 상태면 같은 출력).

---

### 작업 D — 자주 놓치는 근거 통계

**완료 기준: 저장된 오답노트에서 "가장 자주 놓친 태그 상위 N" 을 낸다. 결정론적이고 테스트가 있다.**

오답노트의 존재 이유가 이거다 — "내가 자꾸 놓치는 근거가 뭔가".

- `coreMisses` 와 `falseClaims` 를 **따로** 집계하라. 놓친 것과 헛다리는 성격이 다르다
- 동점이면 태그 id 사전순으로 갈라라 (결정론)
- 표본이 적을 때(예: 3건 미만) 뭐라고 할지 정하고 코드에 이유를 적어라

---

### ⛔ 하지 말 것

**UI (차트 렌더링, 문제 화면, 리포트 화면).** 스택 선택과 차트 라이브러리는 되돌리기
비싸고, 무엇보다 **"태그 105종을 사용자에게 어떻게 고르게 할 것인가"** 가 이 제품의
핵심 UX 문제인데 답이 정해져 있지 않다. 체크박스 105개는 쓸 수 없다. 사장이 정할 일이다.

**PR 스택 머지.** 지금 PR 4개(#2~#5)가 쌓여 있고 하나도 머지 안 됐다. 로컬 `master` 는
part5 끝점으로 fast-forward 돼 있지만 `origin/master` 는 Part 1 그대로다. 어떻게 정리할지는
사장이 정한다. **당신은 작업 브랜치를 push 만 하라.**

**등급·배점·게이트 상수 변경.** `guards.test.ts` 가 잠근다. 바꿔야 한다고 판단되면 물어라.

---

## 4. 완료 보고

작업 브랜치를 push 하고, PR 본문(또는 보고 문서)에 **아래 넷을 그대로 붙여라.**
셋은 실제로 하지 않으면 만들 수 없는 것들이다.

**① `npm run verify` 전체 출력** — 마지막 요약 블록과 판정 줄까지. 잘라내지 마라.

**② `git log --oneline` 출력** — 이번 작업 구간 전체.

**③ 작업별 커밋 해시**
```
작업 A  <hash>  체크포인트 ⑤ 오분류율 14.5% → ?%
작업 B  <hash>  계약 테스트 N개
작업 C  <hash>
작업 D  <hash>
```

**④ 판단이 갈렸던 지점과 못 한 것.** 숨기지 마라 — 그게 다음 인계의 출발점이다.
"작업 B 에서 막혔고 A 까지만 했다" 는 완전히 괜찮은 보고다.
**작업 A 만 제대로 된 게 D 까지 억지로 초록인 것보다 낫다.**

### 부분 완료 처리

`verify` 가 통과하지 못한 채 끝나야 한다면, **그 상태 그대로 커밋하고 push 하라.**
지난번처럼 작업트리에 남겨 두지 마라 — 커밋 안 된 26개 파일은 `git checkout` 한 번이면
사라진다. 미완성 커밋은 되돌릴 수 있지만 없어진 작업은 되돌릴 수 없다.

---

## 5. 저장소 지도

```
src/analysis/    감지기. 순수 함수. src/quiz/ 를 절대 모른다
  signals.ts       DETECTORS 배열 — 새 감지기는 여기 등록
  structure.ts     findPivots (barIndex = 확정 시점, pivotBar = 실제 봉우리)
  smc.ts           detectMSB ← 작업 A 의 대상
  htf.ts           진짜 상위 봉 참조 (닫힌 봉만)
  wyckoff.ts       국면 상태기계
  testing.ts       assertNoLookAhead — 신호가 0개면 스스로 실패한다(공허한 통과 없음)
  fixtures.ts      synthCandles (난수 보행 — 추세가 없다)
src/quiz/
  taxonomy.ts      TAGS 105종. 배점·수명·등급의 단일 출처
  grader.ts        채점. falseClaimPenalty 는 taxonomy 의 confidence 를 읽는다
  generator.ts     makeQuestion / solverView (은닉 담당)
  guards.test.ts   🔒 잠김 — 협상 불가능한 불변식
  ruleCheck.ts     34점 패널
  lifetime.ts      신호가 언제까지 "유효 근거" 인가
src/data/
  notebook.ts      오답노트 ← 작업 B·C 의 대상
  fileCache.ts     캔들 캐시. 파일 기반 저장의 본보기
scripts/
  verify.ts        🔒 잠김 — 단일 검증 관문
  locked.json      잠긴 파일의 해시
  calibrate.ts     위험 체크포인트 5개. exit code 로 판정
  drill.ts         문제 하나 출제 → 채점 리포트 → 34점 패널
docs/superpowers/specs/   파트별 설계 문서
```

### 이 제품의 급소

`grader.ts` 는 활성 신호에 없는 체크를 **전부 헛다리로 처리한다.**

- 등재만 하고 감지기가 안 내면 → 사용자가 체크하는 족족 감점, 영원히 못 맞힘
- 등재 없이 감지기가 내면 → 영원히 못 맞히는 유령 ⚠️놓침

**taxonomy · 감지기 · `ruleCheck.ts` 세 곳이 항상 같이 움직여야 한다.**
체크포인트 ④ 가 양방향으로 검사한다.

그리고 **은닉 구간이 새면 제품이 통째로 거짓말이 된다.** 하위 봉과 상위 봉 둘 다
`guards.test.ts` 가 잠갔다. `solverView` 를 건드릴 일이 있으면 특히 조심하라.

---

## 6. 막히면

- 설계 문서는 `docs/superpowers/specs/` 에 파트별로 있다
- 커밋 로그가 설계 기록이다. `git log` 를 읽으면 왜 그 값인지 나온다
- **판단이 갈리면 멈추고 물어라.** 조용히 정하고 진행하는 것보다 훨씬 싸다
