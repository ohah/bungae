/**
 * Source Map Post-Processing for ZTS Bundler
 *
 * Adds RN DevTools compatibility fields to ZTS-generated source maps.
 */

/**
 * Post-process source map for Metro/DevTools compatibility:
 * - x_google_ignoreList: marks node_modules sources so DevTools skips them
 * - x_facebook_sources: Metro-compatible function map metadata
 */
export function postProcessSourceMap(mapStr: string): string {
  try {
    const map = JSON.parse(mapStr);
    if (!map.sources) return mapStr;

    // Build ignore list for node_modules sources
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

    // Add x_facebook_sources (Metro-compatible function map metadata).
    // ZTS doesn't generate function maps, so all entries are null.
    map.x_facebook_sources = Array.from({ length: map.sources.length }, () => null);

    return JSON.stringify(map);
  } catch {
    return mapStr;
  }
}
