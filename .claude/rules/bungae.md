# Bungae 번들러 개발 규칙

## 프로젝트 개요
Bun 기반 React Native 번들러. Metro 호환성을 유지하면서 성능을 개선합니다.

## 핵심 원칙

1. **Bun 네이티브 우선**: 가능한 한 Bun 내장 API 사용
2. **Metro 호환성**: 기존 프로젝트 마이그레이션 용이
3. **성능 최우선**: 빌드 속도 및 번들 크기 최적화
4. **점진적 구현**: Phase별로 독립적으로 동작 가능

## 번들링 파이프라인

```
Entry → [Resolution] → [Transformation] → [Serialization] → Bundle
```

### Resolution
- Node.js 모듈 해석 알고리즘
- 플랫폼별 확장자 지원
- Package Exports 지원

### Transformation
- 기본: Bun.Transpiler 사용
- 선택적: Babel (필요한 경우만)

### Serialization
- Plain Bundle
- RAM Bundle (Indexed/File)

## 코드 작성 규칙

### Bun API 활용
```typescript
// ✅ Good
const transpiler = new Bun.Transpiler({ loader: 'tsx' });
const file = Bun.file('path/to/file');
const server = Bun.serve({ port: 8081 });

// ❌ Avoid: 불필요한 외부 라이브러리
```

### Metro 호환성
- 설정 파일 구조 유사하게 유지
- 번들 출력 형식 호환
- 에러 메시지 형식 유사

### 성능 최적화
- 적극적인 캐싱
- 증분 빌드
- 병렬 처리
- 메모리 효율

## 참고
- 상세 가이드: `.claude/skills/bungae-bundler/`
- Metro 참고: `reference/metro/`
