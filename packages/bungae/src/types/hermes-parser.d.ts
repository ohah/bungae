declare module 'hermes-parser' {
  export interface ParseOptions {
    babel?: boolean;
    sourceType?: 'module' | 'script';
  }

  export function parse(code: string, options?: ParseOptions): any;
}
