# React Native 버전별 의존성 가이드

Bungae가 사용하는 React Native 관련 패키지들은 React Native 버전과 호환성을 맞춰야 합니다.

## 현재 설정 (React Native 0.83.x 기준)

### Bungae 패키지 의존성

```json
{
  "dependencies": {
    "@react-native-community/cli-server-api": "^15.0.0",
    "@react-native/dev-middleware": "^0.83.1",
    "metro-runtime": "^0.83.3",
    "metro-source-map": "^0.83.3",
    "hermes-parser": "^0.33.3",
    "babel-plugin-syntax-hermes-parser": "^0.33.3",
    "babel-plugin-transform-flow-enums": "^0.0.2"
  },
  "devDependencies": {
    "@react-native/babel-preset": "^0.83.1",
    "@react-native/babel-plugin-codegen": "^0.83.1"
  }
}
```

### React Native 앱 의존성 (예시: ExampleApp)

```json
{
  "dependencies": {
    "react-native": "0.83.1",
    "react": "19.2.0"
  },
  "devDependencies": {
    "@react-native-community/cli": "20.0.0",
    "@react-native/babel-preset": "0.83.1",
    "@react-native/codegen": "0.83.1"
  }
}
```

> **참고**: React Native 0.83은 `@react-native-community/cli` 20.0.0을 사용하지만, Bungae는 `cli-server-api` 15.0.0을 사용합니다. 이는 호환 가능한 버전입니다.

## 패키지별 역할

### 런타임 의존성 (Bungae)

| 패키지                                   | 역할                                              | 버전 규칙                             |
| ---------------------------------------- | ------------------------------------------------- | ------------------------------------- |
| `@react-native/dev-middleware`           | DevTools 지원 (Chrome Inspector, Hermes Debugger) | RN 버전과 동일                        |
| `@react-native-community/cli-server-api` | 메시지 소켓 (`/message`), reload/devMenu 명령     | RN CLI 버전에 맞춤 (15.x for RN 0.83) |
| `metro-runtime`                          | Metro 런타임 폴리필 (`__d`, `__r`)                | Metro 버전과 동일                     |
| `metro-source-map`                       | 소스맵 파싱/심볼리케이션                          | Metro 버전과 동일                     |
| `hermes-parser`                          | Hermes/Flow 구문 파싱                             | 최신 버전 사용 가능                   |
| `babel-plugin-syntax-hermes-parser`      | Babel에서 Hermes 파서 사용                        | hermes-parser 버전과 호환             |
| `babel-plugin-transform-flow-enums`      | Flow enum 변환                                    | 최신 버전 사용 가능                   |

### 개발 의존성 (Bungae)

| 패키지                               | 역할                 | 버전 규칙      |
| ------------------------------------ | -------------------- | -------------- |
| `@react-native/babel-preset`         | RN Babel 변환 프리셋 | RN 버전과 동일 |
| `@react-native/babel-plugin-codegen` | Native 모듈 코드젠   | RN 버전과 동일 |

## 버전 매핑 표

| React Native    | @react-native/\* | cli-server-api | CLI  | Metro           |
| --------------- | ---------------- | -------------- | ---- | --------------- |
| 0.83.x          | 0.83.x           | 15.x           | 20.x | 0.83.x          |
| 0.82.x          | 0.82.x           | 15.x           | 19.x | 0.82.x          |
| 0.81.x          | 0.81.x           | 14.x           | 18.x | 0.81.x          |
| 0.80.x          | 0.80.x           | 14.x           | 17.x | 0.80.x          |
| 0.76.x ~ 0.79.x | 0.76.x ~ 0.79.x  | 13.x           | 16.x | 0.76.x ~ 0.79.x |
| 0.73.x ~ 0.75.x | 0.73.x ~ 0.75.x  | 12.x           | 15.x | 0.73.x ~ 0.75.x |
| 0.72.x          | 0.72.x           | 11.x           | 14.x | 0.76.x          |
| 0.71.x          | 0.71.x           | 10.x           | 13.x | 0.73.x          |
| 0.70.x          | -                | 9.x            | 12.x | 0.72.x          |

> **참고**:
>
> - React Native 0.73 이전에는 `@react-native/*` 패키지 대신 `metro-*` 패키지만 사용했습니다.
> - `@react-native-community/cli` 버전은 React Native 앱에서 사용되며, Bungae는 `cli-server-api`만 사용합니다.

## 버전 업그레이드 시 체크리스트

### React Native 버전 업그레이드 시:

1. **`@react-native/*` 패키지 업데이트**

   ```bash
   bun add @react-native/dev-middleware@^0.XX.0
   bun add -d @react-native/babel-preset@^0.XX.0
   bun add -d @react-native/babel-plugin-codegen@^0.XX.0
   ```

2. **Metro 관련 패키지 업데이트**

   ```bash
   bun add metro-runtime@^0.XX.0
   bun add metro-source-map@^0.XX.0
   ```

3. **CLI 패키지 업데이트 (필요시)**

   ```bash
   bun add @react-native-community/cli-server-api@^XX.0.0
   ```

   > **주의**: `cli-server-api` 버전은 React Native CLI 버전과 다를 수 있습니다. 호환성 테이블을 참고하세요.

4. **Babel 플러그인 호환성 확인**
   - `babel-plugin-syntax-hermes-parser` 버전 확인
   - `babel-plugin-transform-flow-enums` 버전 확인
   - `hermes-parser` 버전 확인

## 주요 API 변경사항

### @react-native/dev-middleware

- **0.76+**: `createDevMiddleware` API
- **0.75-**: 다른 API 구조, 마이그레이션 필요

### @react-native-community/cli-server-api

- **15.x** (RN 0.82+): `createDevServerMiddleware` 반환값에 `messageSocketEndpoint.broadcast` 포함
- **14.x** (RN 0.80-0.81): 동일한 API
- **13.x 이전**: `messageSocket` 대신 `securityHeadersMiddleware` 등 다른 구조

### metro-runtime

- **0.76+**: ESM 지원 개선
- **0.73+**: `__d`, `__r` 런타임 안정화

### @react-native/babel-preset

- **0.83+**: React 19 지원
- **0.76+**: Codegen 플러그인 통합
- **0.73+**: Flow enum 지원

## 트러블슈팅

### "No apps connected" 에러

1. `@react-native-community/cli-server-api` 버전 확인
2. WebSocket 엔드포인트 등록 확인 (`/message`, `/events`)
3. React Native 앱의 DevSettings 설정 확인
4. `cli-server-api`와 React Native CLI 버전 호환성 확인

### DevTools 연결 실패

1. `@react-native/dev-middleware` 버전이 RN과 맞는지 확인
2. `/json/list` 엔드포인트 응답 확인
3. Hermes 엔진 활성화 여부 확인

### Source Map 심볼리케이션 실패

1. `metro-source-map` 버전 확인
2. 소스맵 생성 옵션 확인 (`dev: true`)
3. `/symbolicate` 엔드포인트 테스트

### Codegen 경고

1. `@react-native/babel-preset` 버전이 RN과 맞는지 확인
2. `@react-native/babel-plugin-codegen` 버전 확인
3. `process.env.BABEL_ENV` 설정 확인 (개발 모드: `development`)
4. Babel caller 옵션 확인 (`bundler: 'metro'`, `name: 'metro'`, `platform`)

## 실제 사용 중인 버전 (ExampleApp 기준)

- **React Native**: 0.83.1
- **React**: 19.2.0
- **@react-native-community/cli**: 20.0.0
- **@react-native/babel-preset**: 0.83.1
- **@react-native/codegen**: 0.83.1

## 참고 자료

- [React Native Releases](https://github.com/facebook/react-native/releases)
- [Metro Releases](https://github.com/facebook/metro/releases)
- [React Native CLI](https://github.com/react-native-community/cli)
- [React Native 0.83 Release Notes](https://reactnative.dev/blog/2025/12/10/react-native-0.83)
