declare module 'hermes-parser' {
  export interface ParseOptions {
    babel?: boolean;
    sourceType?: 'module' | 'script';
    flow?: 'all' | 'detect';
  }

  export function parse(code: string, options?: ParseOptions): any;
}
