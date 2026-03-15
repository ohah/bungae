/**
 * Compare source map structures between graph-bundler and oxc-bundler.
 *
 * Usage:
 *   # Save both source maps first:
 *   # 1. OXC: curl -s http://localhost:8081/index.map > /tmp/oxc-map.json
 *   # 2. Graph: change bungae.config.ts bundler to 'graph', restart, then:
 *   #    curl -s http://localhost:8081/index.map > /tmp/graph-map.json
 *   #
 *   # Then run: node packages/bungae/src/bundler/oxc-bundler/__tests__/compare-sourcemaps.cjs
 */

const fs = require('fs');

const oxcPath = '/tmp/oxc-map.json';
const graphPath = '/tmp/graph-map.json';

if (!fs.existsSync(oxcPath)) {
  console.log('Missing /tmp/oxc-map.json');
  console.log('Run: curl -s http://localhost:8081/index.map > /tmp/oxc-map.json');
  process.exit(1);
}
if (!fs.existsSync(graphPath)) {
  console.log('Missing /tmp/graph-map.json');
  console.log('Change bungae.config.ts bundler to "graph", restart server, then:');
  console.log('  curl -s http://localhost:8081/index.map > /tmp/graph-map.json');
  process.exit(1);
}

var graphMap = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
var oxcMap = JSON.parse(fs.readFileSync(oxcPath, 'utf-8'));

console.log('');
console.log('========================================');
console.log('     SOURCE MAP COMPARISON');
console.log('========================================');
console.log('');

var fields = [
  'version', 'file', 'sourceRoot',
  'sources', 'sourcesContent', 'names', 'mappings',
  'x_google_ignoreList', 'ignoreList', 'x_facebook_sources',
];

function describe(field, val) {
  if (val === undefined || val === null) return 'MISSING';
  if (field === 'sources') return val.length + ' sources';
  if (field === 'sourcesContent') {
    var nonNull = val.filter(function(x) { return x != null; }).length;
    return val.length + ' entries (' + nonNull + ' non-null)';
  }
  if (field === 'names') return val.length + ' names';
  if (field === 'mappings') return val.length + ' chars';
  if (field === 'x_google_ignoreList' || field === 'ignoreList') return val.length + ' entries';
  if (field === 'x_facebook_sources') {
    var withData = val.filter(function(x) { return x != null; }).length;
    return val.length + ' entries (' + withData + ' with data)';
  }
  return JSON.stringify(val);
}

console.log('  ' + 'Field'.padEnd(23) + 'graph-bundler'.padEnd(35) + 'oxc-bundler');
console.log('  ' + '-'.repeat(85));

for (var i = 0; i < fields.length; i++) {
  var f = fields[i];
  var gStr = describe(f, graphMap[f]);
  var oStr = describe(f, oxcMap[f]);
  var mark = gStr === oStr ? '  ' : '≠ ';
  console.log(mark + f.padEnd(23) + gStr.padEnd(35) + oStr);
}

// Extra keys in each
var gKeys = Object.keys(graphMap).filter(function(k) { return fields.indexOf(k) < 0; });
var oKeys = Object.keys(oxcMap).filter(function(k) { return fields.indexOf(k) < 0; });
if (gKeys.length > 0) console.log('\n  Extra keys in graph-bundler:', gKeys);
if (oKeys.length > 0) console.log('\n  Extra keys in oxc-bundler:', oKeys);

// Source path format comparison
console.log('\n--- First 3 sources (graph-bundler) ---');
(graphMap.sources || []).slice(0, 3).forEach(function(s, i) { console.log('  [' + i + '] ' + s); });
console.log('\n--- First 3 sources (oxc-bundler) ---');
(oxcMap.sources || []).slice(0, 3).forEach(function(s, i) { console.log('  [' + i + '] ' + s); });

// User sources
console.log('\n--- User sources (non-node_modules) ---');
var gUser = (graphMap.sources || []).filter(function(s) { return s.indexOf('node_modules') < 0; });
var oUser = (oxcMap.sources || []).filter(function(s) { return s.indexOf('node_modules') < 0; });
console.log('  graph:', JSON.stringify(gUser));
console.log('  oxc:  ', JSON.stringify(oUser));
console.log('');
