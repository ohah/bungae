const m = require("/tmp/map.json");
const { TraceMap, originalPositionFor, eachMapping } = require("@jridgewell/trace-mapping");
const t = new TraceMap(m);

// Find the first and last mapped lines
let first = null;
let last = null;
let userFirst = null;
eachMapping(t, (mapping) => {
  if (!first) first = mapping;
  last = mapping;
  if (!userFirst && mapping.source && mapping.source.indexOf("node_modules") < 0) {
    userFirst = mapping;
  }
});

console.log("first mapping: gen line", first?.generatedLine, "-> source", first?.source, "line", first?.originalLine);
console.log("last mapping: gen line", last?.generatedLine, "-> source", last?.source, "line", last?.originalLine);
console.log("first USER mapping: gen line", userFirst?.generatedLine, "-> source", userFirst?.source, "line", userFirst?.originalLine);
console.log("total bundle lines:", m.mappings.split(";").length);

// Check line 1059 with different columns
for (let c = 0; c < 100; c += 10) {
  const p = originalPositionFor(t, { line: 1059, column: c });
  if (p.source) {
    console.log("line 1059 col", c, "->", p.source + ":" + p.line);
    break;
  }
}
