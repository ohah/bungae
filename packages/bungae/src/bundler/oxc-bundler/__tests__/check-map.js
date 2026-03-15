const m = require("/tmp/map.json");
const { TraceMap, originalPositionFor } = require("@jridgewell/trace-mapping");
const t = new TraceMap(m);
for (let l = 1055; l <= 1065; l++) {
  const p = originalPositionFor(t, { line: l, column: 0 });
  console.log("line " + l + " -> " + (p.source || "null") + ":" + (p.line || "null"));
}
