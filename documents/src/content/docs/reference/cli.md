---
title: CLI 레퍼런스
description: bungae CLI 명령어 + 옵션 전체
---

## 기본 사용

```bash
bungae <command> [options]
```

## 명령어

### `bungae init`

스타터 `bungae.config.{ts,js}` 생성 + `package.json` scripts 추가 + `.gitignore` 패치. `package.json` 의 `expo` / `expo-router` 의존성 자동 감지.

```bash
bungae init             # bungae.config.ts 생성
bungae init --js        # JavaScript config 생성
bungae init --force     # 기존 config 파일 덮어쓰기
```

생성 결과:

```
✓ wrote bungae.config.ts
  detected expo@55.0.0 → wrapped with withExpo()
✓ added "start:bungae" to package.json scripts
✓ added "build:bungae" to package.json scripts
✓ added .bungae/ to .gitignore
```

### `bungae bundle` / `bungae build`

프로덕션 번들 빌드 (one-shot).

```bash
bungae bundle --platform ios --minify
```

### `bungae start` / `bungae serve`

개발 서버 시작 + HMR.

```bash
bungae start --platform ios
bungae start                        # 멀티 플랫폼 동시 서빙
```

### `bungae dependencies`

(예정) 모듈 의존성 그래프 출력.

## 공통 옵션

| 옵션 | 설명 |
| --- | --- |
| `-h, --help` | 도움말 |
| `-v, --version` | 버전 |
| `-p, --platform <ios\|android\|web>` | 타겟 플랫폼 |
| `-d, --dev` | 개발 모드 |
| `-m, --minify` | 미니파이 |
| `--mode <development\|production>` | Metro 호환 |
| `-e, --entry <path>` / `--entry-file <path>` | 엔트리 파일 |
| `-c, --config <path>` | 설정 파일 경로 |
| `--root <path>` | 프로젝트 루트 |
| `--bundler <zts\|graph>` | 번들러 선택 (기본: `zts`, `graph`는 레거시 fallback) |
| `-j, --max-workers <number>` | 워커 스레드 수 |
| `--reset-cache` | 캐시 무효화 |

## 서버 옵션 (start / serve)

| 옵션 | 설명 |
| --- | --- |
| `--host <string>` | 바인딩 호스트 (기본: `localhost`) |
| `--port <number>` | 포트 (기본: `8081`) |
| `--https` | HTTPS 활성 |
| `--key <path>` | SSL 키 파일 |
| `--cert <path>` | SSL 인증서 |
| `--no-interactive` | 단축키 비활성 |
| `--watchFolders <list>` | 추가 watch 디렉토리 (콤마 구분) |
| `--sourceExts <list>` | 추가 소스 확장자 (콤마 구분) |

## 빌드 옵션 (bundle / build)

| 옵션 | 설명 |
| --- | --- |
| `-o, --outDir <path>` | 출력 디렉토리 |
| `-O, --out <path>` / `--bundle-output <path>` | 출력 파일 경로 |
| `--bundle-encoding <utf8\|...>` | 출력 인코딩 |
| `--source-map` | 소스맵 생성 |
| `--source-map-url <string>` | 소스맵 URL override |
| `--sourcemap-output <path>` | 소스맵 파일 경로 |
| `--sourcemap-sources-root <path>` | 소스맵 소스 루트 |
| `--sourcemap-use-absolute-path` | 절대 경로 사용 |
| `--assets-dest <path>` | 에셋 출력 디렉토리 |
| `--asset-catalog-dest <path>` | iOS 에셋 카탈로그 |
| `--unstable-transform-profile <default\|hermes-stable\|hermes-canary>` | JS 엔진 프로필 |
| `--transform-option <key=value>` | 커스텀 transform 옵션 (반복 가능) |
| `--resolver-option <key=value>` | 커스텀 resolver 옵션 (반복 가능) |

## init 옵션

| 옵션 | 설명 |
| --- | --- |
| `--js` | JavaScript config 출력 (기본: TypeScript) |
| `--force` | 기존 config 덮어쓰기 |

## 환경변수

| 변수 | 설명 |
| --- | --- |
| `BUNGAE_HMR_PROFILE=1` | HMR 메시지 디버그 출력 |
| `BUNGAE_CODEGEN_PROFILE=1` | RN codegen plugin 시간 측정 (per-file) |
| `ZTS_PROFILE=all` / `ZTS_PROFILE_LEVEL=detailed` | ZTS 프로파일 |

## 종료 코드

| 코드 | 의미 |
| --- | --- |
| `0` | 성공 |
| `1` | 일반 에러 |
| `130` | SIGINT (사용자 중단) |
