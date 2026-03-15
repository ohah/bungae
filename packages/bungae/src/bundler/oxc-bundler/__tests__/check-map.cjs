const m = require("/tmp/map.json");
const { TraceMap, originalPositionFor } = require("@jridgewell/trace-mapping");

// Find App.tsx source
const appIdx = m.sources.findIndex(function(s) { return s.indexOf("App.tsx") >= 0; });
console.log("App.tsx index:", appIdx);
console.log("App.tsx source:", m.sources[appIdx]);
console.log("has sourcesContent:", !!(m.sourcesContent && m.sourcesContent[appIdx]));

// Find where App.tsx mappings are in the bundle
const t = new TraceMap(m);
const lines = m.mappings.split(";");
console.log("total bundle lines:", lines.length);

// Search for App.tsx mappings by scanning bundle lines
var found = 0;
for (var l = 1; l <= lines.length && found < 3; l++) {
  var p = originalPositionFor(t, { line: l, column: 0 });
  if (p.source && p.source.indexOf("App.tsx") >= 0) {
    console.log("  bundle line " + l + " -> " + p.source + ":" + p.line);
    found++;
  }
}
if (found === 0) {
  console.log("  WARNING: No App.tsx mappings found");
}
