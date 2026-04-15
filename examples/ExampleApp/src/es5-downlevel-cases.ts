/**
 * ES5 다운레벨 스트레스 테스트 케이스.
 *
 * ZTS `--target=es5` 로 번들링했을 때 Hermes 가 파싱/실행 못 하는 패턴들을
 * 한 파일에 모아서 번들 출력을 검증. #1379 후속.
 *
 * 사용법: App.tsx 상단에 `import './src/es5-downlevel-cases';` 추가 후
 * `bun run build:bungae --platform ios` → `.bungae/bundle.js` grep.
 *
 * 각 케이스는 **호출되어야** tree-shake 되지 않으므로 export 하고 하단에서 한 번씩 참조.
 */

// ---------------------------------------------------------------------------
// #1 for-await + const/let/var (#1379 후속: 키워드 자체가 ES5 에서 불가)
// ---------------------------------------------------------------------------

async function* asyncIter<T>(items: T[]): AsyncGenerator<T> {
  for (const v of items) yield v;
}

export async function forAwaitConst(values: number[]): Promise<number> {
  let total = 0;
  for await (const v of asyncIter(values)) total += v;
  return total;
}

export async function forAwaitLet(values: number[]): Promise<number> {
  let total = 0;
  for await (let v of asyncIter(values)) total += v;
  return total;
}

export async function forAwaitVar(values: number[]): Promise<number> {
  let total = 0;
  for await (var v of asyncIter(values)) total += v;
  return total;
}

// ---------------------------------------------------------------------------
// #2 for-await + destructuring
// ---------------------------------------------------------------------------

export async function forAwaitDestructure(pairs: AsyncIterable<[string, number]>): Promise<number> {
  let total = 0;
  for await (const [k, v] of pairs) {
    total += v + k.length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// #3 for-of + array destructuring in body (var [a,b] = _e.value 변환 버그)
// ---------------------------------------------------------------------------

export function forOfDestructure(entries: [string, number][]): number {
  let total = 0;
  for (const [k, v] of entries) {
    total += v + k.length;
  }
  return total;
}

export function forOfNestedDestructure(rows: [number, { x: number; y: number }][]): number {
  let sum = 0;
  for (const [i, { x, y }] of rows) {
    sum += i + x + y;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// #4 Top-level await — 모듈 스코프에서 `await` (bare yield 로 leak 되는 버그)
// ---------------------------------------------------------------------------
// 실제 RN 번들에선 TLA 가 거의 없지만 dynamic import chain 에서 생길 수 있음.
// TLA 는 subpath 모듈로 분리 — RN 엔트리에 바로 넣으면 index.js 부트 깨짐.
// 주석 처리해두고 별도 점검이 필요하면 풀 것.
// await Promise.resolve(1);

// ---------------------------------------------------------------------------
// #5 Object method shorthand + computed method
// ---------------------------------------------------------------------------

export function objectMethodShorthand() {
  const o = {
    plain() {
      return 1;
    },
    async asyncMethod() {
      return 2;
    },
    *gen() {
      yield 3;
    },
    ['computed' + 'Key']() {
      return 4;
    },
  };
  return o;
}

// ---------------------------------------------------------------------------
// #6 for (let k in o) — TDZ 흉내 순서 버그
// ---------------------------------------------------------------------------

export function forInLet(obj: Record<string, number>): number {
  let total = 0;
  for (let k in obj) total += obj[k];
  return total;
}

// ---------------------------------------------------------------------------
// #7 Regex — y/u/s 플래그 + named capture
// ---------------------------------------------------------------------------

export function regexStickyUnicode(s: string) {
  const sticky = /foo/y;
  const unicode = /[\u{1F600}-\u{1F64F}]/u;
  const dotAll = /a.b/s;
  const named = /(?<year>\d{4})-(?<month>\d{2})/;
  return {
    sticky: sticky.test(s),
    unicode: unicode.test(s),
    dotAll: dotAll.test(s),
    named: s.match(named)?.groups,
  };
}

// ---------------------------------------------------------------------------
// #8 Unicode brace escape (문자열 리터럴 내부)
// ---------------------------------------------------------------------------

export const unicodeEscape = '\u{1F600} \u{1F64F}';

// ---------------------------------------------------------------------------
// #9 Dynamic import (번들러가 대부분 처리하지만 --target=es5 단독일 때)
// ---------------------------------------------------------------------------

export async function dynamicImport(): Promise<unknown> {
  const mod = await import('./es5-downlevel-cases-helper');
  return mod.default;
}

// ---------------------------------------------------------------------------
// #10 Decorator (Stage 3) + accessor 필드
// ---------------------------------------------------------------------------

function logged(target: any, context: ClassMemberDecoratorContext) {
  return function (this: any, ...args: any[]) {
    return target.apply(this, args);
  };
}

export class DecoratorCase {
  accessor counter = 0;

  @logged
  tick() {
    this.counter += 1;
    return this.counter;
  }
}

// ---------------------------------------------------------------------------
// #11 중복 var _a (destructuring lowering style bug — 파싱은 OK, linter 경고)
// ---------------------------------------------------------------------------

export function nestedDestructureBurst() {
  const [a, b] = [1, 2];
  const { c = 3, d = 4 } = { c: 5 } as { c?: number; d?: number };
  const { a: a2, ...rest } = { a: 10, x: 1, y: 2 };
  return a + b + c + d + a2 + Object.keys(rest).length;
}

// ---------------------------------------------------------------------------
// Registry — tree-shake 방지용 참조
// ---------------------------------------------------------------------------

export const es5DownlevelCases = {
  forAwaitConst,
  forAwaitLet,
  forAwaitVar,
  forAwaitDestructure,
  forOfDestructure,
  forOfNestedDestructure,
  objectMethodShorthand,
  forInLet,
  regexStickyUnicode,
  unicodeEscape,
  dynamicImport,
  DecoratorCase,
  nestedDestructureBurst,
};
