# Optimization

캐싱 및 성능 최적화 구현 가이드.

---

## 캐싱 시스템

### 캐시 대상

| 대상       | 키                         | 값              |
| ---------- | -------------------------- | --------------- |
| Transform  | 파일경로 + 내용해시 + 옵션 | 변환된 코드     |
| Resolution | 모듈경로 + 컨텍스트        | 해석된 파일경로 |
| Bundle     | 엔트리 + 의존성해시        | 번들 결과       |

### 캐시 키 생성

```typescript
function createCacheKey(filePath: string, content: string): string {
  return Bun.hash(
    JSON.stringify({
      path: filePath,
      content: Bun.hash(content),
      version: config.cache.version,
      platform: config.platform,
      dev: config.mode === 'development',
    }),
  ).toString(16);
}
```

### 파일 기반 캐시

```typescript
class FileCache {
  private cacheDir: string;

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  async get(key: string): Promise<string | null> {
    const file = Bun.file(`${this.cacheDir}/${key}`);
    if (await file.exists()) {
      return file.text();
    }
    return null;
  }

  async set(key: string, value: string): Promise<void> {
    await Bun.write(`${this.cacheDir}/${key}`, value);
  }
}
```

---

## 증분 빌드

변경된 파일만 재빌드.

### 의존성 그래프

```typescript
interface DependencyGraph {
  dependencies: Map<string, Set<string>>; // 파일 → 의존 모듈
  dependents: Map<string, Set<string>>; // 파일 → 역의존 모듈
}
```

### 변경 전파

```typescript
function getAffectedModules(changedFile: string): Set<string> {
  const affected = new Set<string>();
  const queue = [changedFile];

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (affected.has(file)) continue;
    affected.add(file);

    const dependents = graph.dependents.get(file);
    if (dependents) {
      queue.push(...dependents);
    }
  }
  return affected;
}
```

---

## Minification

### Metro 호환 Minification

Bungae는 Metro와 유사한 Terser 설정을 사용하지만, **완전히 동일할 필요는 없습니다**.

#### ⚠️ 중요한 점: 완전히 동일할 필요는 없음

Minification은 코드를 압축하는 것이므로, **기능적으로 동일한 결과**를 만들면 됩니다:

1. **필수로 보존해야 하는 것들** (Metro 런타임 호환):
   - `__d`, `__r` - Metro 모듈 시스템 함수
   - `__DEV__` - React Native 개발 플래그
   - `__METRO__` - Metro identifier
   - Source map 호환성

2. **다르게 해도 되는 것들**:
   - 압축 정도 (`passes` 수)
   - 변수명 mangling 방식 (Metro 런타임만 보존하면 됨)
   - 코드 포맷팅
   - 번들 크기 (더 작게 만들 수 있음)

3. **잠재적 차이점**:
   - 번들 크기가 다를 수 있음 (더 작거나 클 수 있음)
   - Source map 내용이 다를 수 있음 (하지만 호환되어야 함)
   - Minification 시간이 다를 수 있음

#### ✅ 현재 설정 (Metro 호환)

```typescript
// Metro-compatible Terser configuration
{
  compress: {
    drop_console: false,      // Metro와 동일 (React Native 디버깅 유용)
    drop_debugger: true,       // Metro와 동일
    passes: 1,                 // Metro와 동일 (기본값)
    unsafe: false,             // Metro와 동일 (안전성 보장)
  },
  mangle: {
    reserved: [
      '__d',                   // ✅ 필수: Metro 런타임
      '__r',                   // ✅ 필수: Metro 런타임
      '__DEV__',               // ✅ 필수: React Native
      '__METRO__',             // ✅ 필수: Metro identifier
    ],
    toplevel: false,           // Metro와 동일
  },
  format: {
    comments: false,           // Metro와 동일
    ascii_only: false,         // Metro와 동일
  },
}
```

#### 🔄 Metro가 공식 지원하는 Minifier

Metro는 다음 minifier를 공식 지원합니다:

1. **`terser`** (Metro 기본값, Metro 0.73.0+)
   - `metro-minify-terser` 패키지 사용
   - Metro의 기본 minifier
   - Bungae도 기본값으로 사용

2. **`esbuild`** (커뮤니티 패키지)
   - `metro-minify-esbuild` 패키지 필요
   - Metro보다 훨씬 빠름 (~46x)
   - 번들 크기가 약간 클 수 있음 (7-840kb 차이)
   - Bungae도 지원

#### 🔄 Bungae가 추가 지원하는 Minifier

Metro는 지원하지 않지만, Bungae는 다음도 지원합니다:

3. **`swc`** (Bungae 전용)
   - 매우 빠른 minification (Rust 기반)
   - Metro 런타임 함수 보존
   - Source map 호환

4. **`bun`** (Bungae 전용)
   - Bun 내장 minifier
   - Metro 런타임 함수 보존
   - Source map 호환

#### ⚠️ 다른 Minifier 사용 시 주의사항

`esbuild`, `swc`, `bun`을 사용해도 **기능적으로는 문제없습니다**, 단:

- ✅ Metro 런타임 함수는 여전히 보존됨 (코드에서 직접 보존)
- ⚠️ 번들 크기나 압축률이 다를 수 있음
- ⚠️ Source map 형식이 다를 수 있음 (하지만 호환되어야 함)

#### 사용 방법

```typescript
// bungae.config.ts
export default {
  minify: true, // Production 빌드에서 minification 활성화
  transformer: {
    minifier: 'terser', // Metro 기본값 (권장)
    // Metro 공식 지원: 'terser', 'esbuild'
    // Bungae 추가 지원: 'bun', 'swc'
  },
};
```

#### Metro vs Bungae Minifier 지원 비교

| Minifier  | Metro 지원  | Bungae 지원 | 비고                        |
| --------- | ----------- | ----------- | --------------------------- |
| `terser`  | ✅ 기본값   | ✅ 기본값   | Metro와 동일                |
| `esbuild` | ✅ (패키지) | ✅          | `metro-minify-esbuild` 필요 |
| `swc`     | ❌          | ✅          | Bungae 전용                 |
| `bun`     | ❌          | ✅          | Bungae 전용                 |

---

## Tree-shaking

`package.json`의 `sideEffects` 필드 존중:

```json
{ "sideEffects": false }
```

---

## Inline Requires

```typescript
// 변환 전
import { heavy } from './heavy';
onClick={() => heavy()}

// 변환 후
onClick={() => require('./heavy').heavy()}
```
