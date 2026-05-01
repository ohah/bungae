import { capitalize } from 'lodash-es';

/**
 * Test module for babel-plugin-root-import (~/utils/greeting).
 *
 * lodash-es (ESM + sideEffects: false) — ZTS tree-shaking 의 거대 barrel 모듈
 * dead code elimination 검증 fixture (ohah/zts#2398). 현재 ZTS 가 named import 의
 * unreferenced re-export source 를 drop 하지 못해 전체 lodash 가 번들에 들어옴.
 * 해당 issue 해결 시 본 fixture 가 자동 효과 측정 대상.
 */
export function getGreeting(name: string): string {
  return capitalize(`hello ${name} from bungae`);
}

export function getVersion(): string {
  return '1.0.0';
}
