/**
 * Test bundle entry file
 */

const Bar = require('./Bar');
const Foo = require('./Foo');

Object.keys({ ...Bar });

module.exports = { Foo, Bar };
