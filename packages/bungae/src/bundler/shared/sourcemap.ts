/**
 * Shared Source Map Post-Processing
 *
 * Used by both oxc-bundler and zts-bundler to add RN DevTools compatibility fields.
 */

/**
 * Post-process source map for Metro/DevTools compatibility:
 * - ignoreList / x_google_ignoreList: marks node_modules sources so DevTools
 *   skips them for console.log source links
 * - x_facebook_sources: Metro-compatible function map metadata (null entries
 *   since bundlers don't generate function maps)
 */
export function postProcessSourceMap(mapStr: string): string {
  try {
    const map = JSON.parse(mapStr);
    if (!map.sources) return mapStr;

    const ignore: number[] = [];
    for (let i = 0; i < map.sources.length; i++) {
      const source = map.sources[i];
      if (source && source.indexOf('node_modules') >= 0) {
        ignore.push(i);
      }
    }

    if (ignore.length > 0) {
      map.ignoreList = ignore;
      map.x_google_ignoreList = ignore;
    }

    map.x_facebook_sources = Array.from({ length: map.sources.length }, () => null);

    return JSON.stringify(map);
  } catch {
    return mapStr;
  }
}
