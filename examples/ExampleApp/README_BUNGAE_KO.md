# Bungae 테스트 가이드

ExampleApp에서 Bungae 번들러를 테스트하는 방법입니다.

## 설정 완료

- ✅ `bungae.config.ts` - TypeScript 설정 파일 생성
- ✅ `package.json` - bungae를 workspace 의존성으로 추가 (`workspace:*`)

## Phase별 번들링 가능 시점

### Phase 1-3 완료 시 (Transformation + Serialization)

- ✅ **실제 번들링 가능**: `bungae build` 명령어로 번들 파일 생성 가능
- Transformation: 코드 변환 (TypeScript → JavaScript, JSX 변환)
- Serialization: Metro 호환 번들 형식으로 직렬화

### Phase 2 완료 시 (개발 환경)

- ✅ **개발 서버**: `bungae serve` 명령어로 개발 서버 실행
- ✅ **HMR**: 파일 변경 시 자동으로 업데이트
- ✅ **증분 빌드**: 변경된 파일만 재빌드

## 현재 상태

- **Phase 1-1**: ✅ Config 시스템 완료
- **Phase 1-2**: ✅ Platform Resolver Plugin 완료
- **Phase 1-3**: 🔄 Transformation + Serialization (진행 중)
- **Phase 2**: ⏳ 개발 환경 (대기 중)

**현재 `build`와 `serve`는 TODO 상태**이므로, Phase 1-3이 완료되면 실제 번들링이 가능하고, Phase 2가 완료되면 개발 서버와 HMR이 동작합니다.

## 사용 방법

workspace로 설정되어 있으므로 `npx` 또는 `bunx`를 통해 사용할 수 있습니다:

```bash
# 개발 서버 시작 (Phase 2 완료 후 동작)
npx bungae serve
# 또는
bunx bungae serve

# 빌드 (Phase 1-3 완료 후 실제 번들 생성)
npx bungae build
# 또는
bunx bungae build

# 플랫폼별 빌드
npx bungae build --platform ios
npx bungae build --platform android

# 옵션 확인
npx bungae --help
```

**참고**: 현재 빌드된 파일에 ESM 중복 export 문제가 있어서 ESM 버전이 작동하지 않을 수 있습니다.
이 경우 CJS 버전을 직접 사용할 수 있습니다:

```bash
bun ../../packages/bungae/dist/cli.cjs serve
bun ../../packages/bungae/dist/cli.cjs build
```

## Config 파일

`bungae.config.ts` 파일이 자동으로 로드됩니다. TypeScript로 작성되어 타입 안전성을 제공하며, 빌드된 패키지(`bungae`)에서 import합니다.

## Workspace 의존성

모노레포 환경에서 `workspace:*`를 사용하여 로컬 패키지를 참조합니다:

- `file:../../packages/bungae` 대신 `workspace:*` 사용
- Bun의 workspace 지원 활용
- 소스 파일이 아닌 빌드된 패키지 이름(`bungae`)으로 import
