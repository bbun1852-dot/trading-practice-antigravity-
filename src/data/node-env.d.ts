/**
 * fileCache.ts(및 그 테스트)가 쓰는 Node 내장 API의 최소 앰비언트 타입 선언.
 *
 * 이 프로젝트엔 `@types/node` 가 설치돼 있지 않다(Task 5 전역 제약: 새 의존성 금지).
 * `@types/node` 를 통째로 추가하면 tsconfig 의 lib: ["DOM"] 과 전역 타입이 충돌할
 * 위험도 있어, fileCache.ts 가 실제로 쓰는 함수만 좁게 선언해 둔다.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string
  export function writeFileSync(path: string, data: string, encoding: string): void
  export function existsSync(path: string): boolean
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
}

declare module 'node:path' {
  export function join(...paths: string[]): string
}

declare const process: { cwd(): string }
