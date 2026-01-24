# 소스맵 DevTools 이슈

## 문제 요약

React Native DevTools에서 콘솔 로그의 소스 위치가 올바르게 표시되지 않습니다.

### 증상
- **콘솔 로그**: `index.bundle?platform=ios&dev=true&...:7` 형식으로 표시됨 (번들 파일 경로)
- **에러 스택**: 올바르게 소스맵이 적용되어 원본 파일 경로 표시됨
- **기대 동작**: 콘솔 로그도 `App.tsx:XX` 형식으로 원본 파일 경로가 표시되어야 함

## 현재 구현 상태

### ✅ 확인된 사항

1. **verboseName이 번들에 포함됨**
   - 번들 코드에서 `"App.tsx"` 형식의 verboseName 확인됨
   - 예: `__d(function(...), 0, [], "App.tsx");`
   - 확인 방법: `curl ... | grep -o ',"[^"]*"' | grep 'App.tsx'`

2. **소스맵에 App.tsx 포함됨**
   - 소스맵의 `sources` 배열에 `[metro-project]/App.tsx` 포함
   - 확인 방법: `curl .../index.bundle.map | jq '.sources[]' | grep 'App.tsx'`
   - 결과: `[metro-project]/App.tsx`

3. **소스맵 구조 정상**
   - `version: 3`
   - `file: null` (Metro와 동일)
   - `sourceRoot: null` (Metro와 동일)
   - `sourcesContent: false` (소스 코드 미포함)

4. **Metro 호환 형식 사용**
   - `sourcePaths=url-server`일 때: 소스맵 sources에 `[metro-project]/App.tsx` 형식 사용
   - `verboseName`은 항상 상대 경로 (`App.tsx`) 사용
   - Metro와 동일한 형식

### ❌ 문제

- 콘솔 로그가 여전히 `index.bundle?...:7` 형식으로 표시됨
- React Native DevTools가 `verboseName`과 소스맵 `sources`를 매칭하지 못함

## 구현 상세

### verboseName 생성

**위치**: `packages/bungae/src/serializer/helpers/js.ts` (198-203줄)

```typescript
if (options.dev) {
  // Always use relative path for verboseName (Metro-compatible)
  const pathModule = await import('path');
  const relativePath = pathModule.relative(options.projectRoot, module.path);
  params.push(relativePath.replace(/\\/g, '/'));
}
```

**특징**:
- 항상 상대 경로 사용: `App.tsx`
- Metro와 동일한 방식
- `sourcePaths` 모드와 무관하게 상대 경로 유지

### 소스맵 Sources 경로 생성

**위치**: `packages/bungae/src/bundler/graph-bundler/build.ts` (309-321줄)

```typescript
// Metro-compatible: verboseName is ALWAYS a relative path (e.g., "App.tsx")
// For sourcePaths=url-server, Metro uses getSourceUrl for source map sources (e.g., "[metro-project]/App.tsx")
// React Native matches verboseName (relative) to source map sources by normalizing paths
const relativeModulePath = relative(config.root, modulePath).replace(/\\/g, '/');
const sourceMapPath =
  sourcePaths === 'url-server'
    ? getSourceUrl(modulePath) // Use [metro-project]/App.tsx format (Metro-compatible)
    : relativeModulePath; // Use relative path for absolute mode
```

**특징**:
- `sourcePaths=url-server`: `[metro-project]/App.tsx` 형식 사용
- `sourcePaths=absolute`: 상대 경로 (`App.tsx`) 사용
- Metro와 동일한 형식

### getSourceUrl 구현

**위치**: `packages/bungae/src/bundler/graph-bundler/build.ts` (196-213줄)

```typescript
const getSourceUrl = (modulePath: string): string => {
  for (const [pathnamePrefix, normalizedRootDir] of sourceRequestRoutingMap) {
    const normalizedRootDirWithSep =
      normalizedRootDir +
      (normalizedRootDir.endsWith('/') || normalizedRootDir.endsWith('\\') ? '' : '/');
    if (modulePath.startsWith(normalizedRootDirWithSep) || modulePath === normalizedRootDir) {
      const relativePath =
        modulePath === normalizedRootDir ? '' : modulePath.slice(normalizedRootDir.length + 1);
      const relativePathPosix = relativePath
        .split(/[/\\]/)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      return pathnamePrefix + relativePathPosix;
    }
  }
  // Fallback: if no match, use relative path from project root
  const relativeModulePath = relative(config.root, modulePath).replace(/\\/g, '/');
  return `[metro-project]/${relativeModulePath}`;
};
```

**sourceRequestRoutingMap 구성**:
```typescript
const sourceRequestRoutingMap: Array<[string, string]> = [
  ['[metro-project]/', resolve(config.root)],
];
for (let i = 0; i < config.resolver.nodeModulesPaths.length; i++) {
  const nodeModulesPath = config.resolver.nodeModulesPaths[i];
  if (nodeModulesPath) {
    const absolutePath = resolve(config.root, nodeModulesPath);
    sourceRequestRoutingMap.push([`[metro-watchFolders]/${i}/`, absolutePath]);
  }
}
```

## Metro의 동작

### sourcePaths=url-server일 때
- **verboseName**: `App.tsx` (상대 경로)
- **소스맵 sources**: `[metro-project]/App.tsx` (getSourceUrl 형식)
- **React Native 매칭**: React Native가 경로를 정규화하여 `[metro-project]/App.tsx`를 `App.tsx`로 매칭하는 것으로 추정

### sourcePaths=absolute일 때
- **verboseName**: `App.tsx` (상대 경로)
- **소스맵 sources**: `/Users/.../App.tsx` (절대 경로)

## 가능한 원인

### 1. React Native DevTools의 소스맵 매칭 방식

React Native DevTools가 `verboseName`을 사용하여 소스맵 `sources` 배열에서 파일을 찾는 방식이 예상과 다를 수 있습니다.

**가능한 매칭 방식**:
1. **정확 일치**: `verboseName`과 소스맵 `sources` 배열의 항목을 정확히 비교
2. **경로 정규화**: 경로를 정규화하여 매칭 (예: `App.tsx` ↔ `[metro-project]/App.tsx`)
3. **파일명 기반 매칭**: 파일명만 추출하여 매칭

**현재 상태**:
- `verboseName`: `App.tsx`
- 소스맵 `sources`: `[metro-project]/App.tsx`
- Metro와 동일한 형식이지만 여전히 작동하지 않음

### 2. 소스맵 로딩 문제

- React Native DevTools가 소스맵을 올바르게 로드하지 못할 수 있음
- 소스맵 URL이 올바른지 확인 필요
- 소스맵이 올바른 형식인지 확인 필요

### 3. 소스맵 구조 문제

- 소스맵의 `sources` 배열 순서가 올바른지 확인 필요
- 소스맵의 `mappings`가 올바른지 확인 필요
- 소스맵의 `sourcesContent`가 필요한지 확인 필요

### 4. Codegen 경고

- "Codegen didn't run for RNCSafeAreaProvider" 경고 발생
- Babel 설정 문제일 수 있음
- `process.env.BABEL_ENV` 설정 완료
- Babel caller 옵션 Metro와 동일하게 설정 완료

## 해결 시도 내역

### 시도 1: verboseName과 소스맵 sources를 모두 상대 경로로 통일

**결과**: 실패
- `verboseName`: `App.tsx`
- 소스맵 `sources`: `App.tsx`
- 여전히 콘솔 로그가 작동하지 않음

### 시도 2: Metro와 동일한 형식 사용 (현재)

**결과**: 진행 중
- `verboseName`: `App.tsx` (상대 경로)
- 소스맵 `sources`: `[metro-project]/App.tsx` (getSourceUrl 형식)
- Metro와 동일한 형식이지만 여전히 작동하지 않음

## 확인 방법

### 1. verboseName 확인

```bash
curl 'http://localhost:8081/index.bundle?platform=ios&dev=true' | \
  grep -o ',"[^"]*"' | \
  grep -E '^,"App\.tsx"$'
```

**예상 결과**: `,"App.tsx"`

### 2. 소스맵 sources 확인

```bash
curl 'http://localhost:8081/index.bundle.map?platform=ios&dev=true' | \
  jq -r '.sources[]' | \
  grep -E '^App\.tsx$|^\[metro-project\]/App\.tsx$'
```

**예상 결과**: `[metro-project]/App.tsx`

### 3. 소스맵 구조 확인

```bash
curl 'http://localhost:8081/index.bundle.map?platform=ios&dev=true' | \
  jq '{version: .version, sources: .sources | length, sourcesContent: (.sourcesContent != null), file: .file, sourceRoot: .sourceRoot}'
```

**예상 결과**:
```json
{
  "version": 3,
  "sources": 633,
  "sourcesContent": false,
  "file": null,
  "sourceRoot": null
}
```

## 다음 단계

### 1. Metro의 실제 소스맵 확인

Metro 서버에서 실제로 생성된 소스맵을 확인하여 Bungae와 비교:
- 소스맵의 `sources` 배열 형식
- 소스맵의 `mappings` 구조
- 소스맵의 기타 필드들

### 2. React Native DevTools의 소스맵 매칭 로직 분석

React Native의 소스 코드를 확인하여:
- `verboseName`을 어떻게 사용하는지
- 소스맵 `sources` 배열과 어떻게 매칭하는지
- 경로 정규화 로직이 있는지

### 3. 실제 생성된 번들과 소스맵 비교

생성된 번들과 소스맵을 직접 확인하여:
- `verboseName`이 올바르게 포함되어 있는지
- 소스맵의 `sources` 배열이 올바른지
- 소스맵의 `mappings`가 올바른지

### 4. Metro와 Bungae의 소스맵 비교

Metro와 Bungae로 생성한 소스맵을 직접 비교하여:
- 구조적 차이점 찾기
- 형식적 차이점 찾기

## 참고 자료

- Metro 소스맵 생성: `reference/metro/packages/metro/src/DeltaBundler/Serializers/sourceMapGenerator.js`
- Metro verboseName 생성: `reference/metro/packages/metro/src/DeltaBundler/Serializers/helpers/js.js`
- Metro getSourceUrl: `reference/metro/packages/metro/src/Server.js` (1672줄)
- Bungae 구현: `packages/bungae/src/bundler/graph-bundler/build.ts` (309줄)
- Bungae verboseName: `packages/bungae/src/serializer/helpers/js.ts` (198줄)

## 관련 문서

- `docs/metro-sourcemap-verboseName-analysis.md`: Metro와 Re.Pack의 처리 방식 분석
- `docs/console-log-sourcemap-issue-summary.md`: 콘솔 로그 소스맵 문제 요약
- `docs/sourcemap-devtools-issue.md`: 소스맵 DevTools 이슈 상세
