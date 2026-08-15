/**
 * 단일 검증 관문. `npm run verify` 하나가 통과하면 끝, 아니면 안 끝난 것이다.
 *
 * **왜 만들었나.** 2026-08-12 인계에서 `npm test` 는 초록인데 `npm run typecheck` 는
 * 깨진 채로 넘어왔다. 검증이 여러 명령으로 흩어져 있으면 하나를 빼먹고도 "다 돌렸다"
 * 고 믿게 된다. 명령이 하나면 빼먹을 수가 없다.
 *
 * 검사 순서는 싼 것부터다 — 위생·잠금은 1초 안에 끝나고 calibrate 는 몇 분 걸린다.
 * 앞에서 걸리면 뒤를 돌리지 않는다.
 *
 * 이 파일과 src/quiz/guards.test.ts 를 고쳐야 한다고 판단되면, 그건 작업이 잘못됐다는
 * 신호다. 멈추고 사장에게 물어라.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

type Result = { name: string; ok: boolean; detail: string }
const results: Result[] = []

const sh = (cmd: string) => execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim()

function step(name: string, fn: () => string): boolean {
  process.stdout.write(`\n▶ ${name}\n`)
  try {
    const detail = fn()
    results.push({ name, ok: true, detail })
    console.log(`  PASS — ${detail}`)
    return true
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    results.push({ name, ok: false, detail })
    console.log(`  FAIL — ${detail}`)
    return false
  }
}

/** 하위 명령은 출력을 그대로 흘려보낸다 — 실패 이유를 사람이 읽어야 하므로 */
function run(name: string, cmd: string, okMsg: string): boolean {
  process.stdout.write(`\n▶ ${name}\n`)
  try {
    execSync(cmd, { stdio: 'inherit' })
    results.push({ name, ok: true, detail: okMsg })
    console.log(`  PASS — ${okMsg}`)
    return true
  } catch {
    const detail = `${cmd} 가 0 이 아닌 코드로 끝났다`
    results.push({ name, ok: false, detail })
    console.log(`  FAIL — ${detail}`)
    return false
  }
}

// ── 1. 저장소 위생 ───────────────────────────────────────────────────────────
//
// 임시 측정 스크립트(scripts/_*)는 실데이터를 잠깐 재려고 만드는 것이라 저장소에
// 남으면 안 된다. 실제로 깨진 채 커밋돼 typecheck 를 막은 적이 있다(_overlap.ts).
// .gitignore 로도 막지만, 이미 추적 중인 파일은 .gitignore 가 못 막는다.

const hygiene = step('저장소 위생 — 추적 중인 임시 스크립트', () => {
  const tracked = sh('git ls-files scripts/_*').split('\n').filter(Boolean)
  if (tracked.length > 0) {
    throw new Error(
      `임시 스크립트가 저장소에 남아 있다: ${tracked.join(', ')}\n` +
      `    → 측정이 끝났으면 지워라. 계속 쓸 도구라면 _ 없는 이름으로 바꾸고 테스트를 붙여라.`,
    )
  }
  return '추적 중인 scripts/_* 없음'
})

// ── 2. 잠긴 파일 무결성 ──────────────────────────────────────────────────────
//
// 코드가 불변식을 어기면 코드를 고쳐야 하는데, 2026-08-12 에는 불변식이 고쳐졌다.
// 검사가 스스로를 지킬 수 없으면 검사가 아니다. 해시로 잠근다.
//
// 암호학적 보안이 아니다 — 목적은 "몰래 못 하게" 하는 것이다. 해시를 맞추려면
// locked.json 도 같이 고쳐야 하고, 그건 diff 에 대문짝만하게 드러난다.

/**
 * 줄바꿈을 LF 로 정규화하고 해시한다.
 *
 * 바이트를 그대로 해시했더니 **checkout 만 해도 잠금이 깨졌다.** 이 저장소는
 * core.autocrlf=true 라 git 은 LF 로 저장하고 Windows 작업트리엔 CRLF 로 꺼낸다.
 * 매니페스트를 만든 시점과 다른 브랜치에서 해시를 재면 내용이 같아도 값이 달라진다.
 * 실제로 스택을 머지한 뒤 master 에서 verify 를 돌리다 잡았다.
 *
 * 거짓 경보를 내는 경비는 결국 꺼진다 — 그러면 잠금 자체가 무의미해진다.
 * 정규화해도 내용 변경은 그대로 잡히므로 잃는 것이 없다.
 */
const sha256 = (p: string) =>
  createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex')

const locked = step('잠긴 파일 무결성', () => {
  const manifestPath = 'scripts/locked.json'
  if (!existsSync(manifestPath)) throw new Error(`${manifestPath} 가 없다`)
  const manifest: Record<string, string> = JSON.parse(readFileSync(manifestPath, 'utf8'))

  const changed: string[] = []
  for (const [file, want] of Object.entries(manifest)) {
    if (!existsSync(file)) { changed.push(`${file} (파일이 없다)`); continue }
    const got = sha256(file)
    if (got !== want) changed.push(`${file}\n      기대 ${want.slice(0, 16)}…\n      실제 ${got.slice(0, 16)}…`)
  }
  if (changed.length > 0) {
    throw new Error(
      `잠긴 파일이 바뀌었다:\n    ${changed.join('\n    ')}\n` +
      `    → 이 파일들은 협상 불가능한 불변식이다. 바꿔야 한다고 판단되면 작업이\n` +
      `      잘못됐다는 신호다. 멈추고 사장에게 실측 근거와 함께 물어라.`,
    )
  }
  return `${Object.keys(manifest).length}개 파일 해시 일치`
})

// ── 3~5. 타입·테스트·게이트 ──────────────────────────────────────────────────

const gates = hygiene && locked
  ? run('타입 검사', 'npm run typecheck', 'tsc --noEmit 통과')
    && run('테스트', 'npm test', '전부 통과')
    && run('게이트 (calibrate)', 'npm run calibrate', '체크포인트 전부 PASS')
  : false

// ── 참고: 작업트리 상태 (판정에는 쓰지 않는다) ───────────────────────────────
//
// 실패시키지 않는 이유는 개발 중에는 당연히 더러워서다. 대신 **출력에 남긴다** —
// 완료 보고에 이 출력을 붙이게 돼 있으므로, 커밋 없이 끝났다면 보고에 그대로 드러난다.

let dirty = 0
let head = '(불명)'
try {
  dirty = sh('git status --porcelain').split('\n').filter(Boolean).length
  head = sh('git log --oneline -1')
} catch { /* git 이 없는 환경이면 그냥 넘긴다 */ }

// ── 요약 ─────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(70)}`)
console.log('검증 요약')
console.log('═'.repeat(70))
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`)
if (!hygiene || !locked) console.log('  SKIP  타입·테스트·게이트 (앞 단계가 실패해서 돌리지 않았다)')

console.log(`\n  HEAD          ${head}`)
console.log(`  미커밋 파일   ${dirty}개${dirty > 0 ? '  ← 작업이 커밋되지 않았다' : ''}`)

const allOk = results.every((r) => r.ok) && gates
console.log(`\n판정: ${allOk ? 'PASS — 전부 통과했다.' : 'FAIL — 위 FAIL 항목을 고쳐야 끝난 것이다.'}`)
console.log('═'.repeat(70))

process.exitCode = allOk ? 0 : 1
