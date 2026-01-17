# Bungae - Metro 호환 React Native 번들러

Bun 기반 React Native 번들러로, Metro와 호환되면서 더 나은 성능을 제공합니다.

## 핵심 원칙

1. **Metro 호환성 우선**: 기존 Metro 프로젝트가 최소한의 변경으로 마이그레이션 가능
2. **성능 최우선**: Bun의 성능 이점을 최대한 활용하여 빌드 속도 개선
3. **점진적 개선**: 핵심 기능부터 구현하고 점진적으로 확장
4. **Bun 네이티브 우선**: 가능한 한 Bun 내장 API 활용

## 번들링 프로세스

3단계 파이프라인: `Entry → [Resolution] → [Transformation] → [Serialization] → Bundle`

### Resolution (모듈 해석)
- Node.js 모듈 해석 알고리즘
- 플랫폼별 확장자 (`.ios.js`, `.android.js`, `.native.js`)
- Package Exports 지원
- `node_modules` 계층적 탐색

### Transformation (코드 변환)
- **기본**: Bun 내장 트랜스파일러 사용 (가장 빠름)
- **선택적**: Babel 통합 (react-native-reanimated 등 필요한 경우만)
- TypeScript/TSX, JSX 변환
- ES Modules → CommonJS

### Serialization (번들 직렬화)
- Plain Bundle (기본)
- RAM Bundle (Indexed/File) - iOS/Android 최적화

## Bun API 활용

```typescript
// ✅ Good: Bun 네이티브 API 사용
Bun.file()          // 파일 I/O
Bun.serve()         // HTTP 서버
Bun.Transpiler      // 코드 변환
Bun.worker()        // 병렬 처리
Bun.hash()          // 캐시 키 생성

// ❌ Avoid: 불필요한 Babel 사용
// Bun 내장 트랜스파일러로 충분한 경우 Babel 사용 지양
```

## 코드 작성 가이드

- TypeScript 엄격 모드 사용
- 에러 메시지는 명확하고 도움이 되도록 작성
- 각 모듈별 독립 테스트 작성
- JSDoc 주석으로 API 문서화
- Metro와 유사한 에러 형식 유지

## 성능 목표

- 초기 빌드: Metro 대비 2-3배 빠름
- 증분 빌드: 캐시 효율로 재빌드 시간 단축
- 번들 크기: Tree-shaking으로 10-20% 감소
- 메모리: 대규모 프로젝트에서도 안정적

## 참고 자료

- Metro 문서: `reference/metro/docs/`
- Metro 소스: `reference/metro/packages/`
- 상세 가이드: `.claude/skills/bungae-bundler/`
