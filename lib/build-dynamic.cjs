/**
 * build-dynamic.js — generate lib/dynamic-body.js (the `code.client` body for
 * cordis_define) from lib/client.js.
 *
 * The dynamic runner wraps the body in `async () => { ... }` and evaluates it
 * in a scope where `React` is a closure parameter, so the body must:
 *   - NOT redeclare `var React` (var hoisting would shadow the closure
 *     parameter and the settings card would silently never render);
 *   - end with `return plugin;` (a bare function body has no exports).
 *
 * Usage: node lib/build-dynamic.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'client.js');
const outPath = path.join(__dirname, 'dynamic-body.js');

let src = fs.readFileSync(srcPath, 'utf8');

// 1. Extract the factory function body: everything between
//    "factory: function (require) {" and the final "\n});".
const factoryMarker = 'factory: function (require) {';
const start = src.indexOf(factoryMarker);
if (start === -1) throw new Error('factory marker not found in client.js');
const bodyStart = start + factoryMarker.length;

const endMarker = '\n});';
const end = src.lastIndexOf(endMarker);
if (end === -1) throw new Error('module end marker not found in client.js');

let body = src.slice(bodyStart, end);
// Drop the factory's own closing brace (the trailing "  }").
body = body.replace(/\n[ \t]*\}\s*$/, '');

// 2. Remove the CommonJS export boilerplate.
const boilerplate =
  '    var module = { exports: {} };\n' +
  '    var exports = module.exports;\n' +
  '    Object.defineProperty(exports, Symbol.toStringTag, { value: \'Module\' });\n';
if (body.indexOf(boilerplate) === -1) throw new Error('module boilerplate not found');
body = body.replace(boilerplate, '');

// 3. Replace the React require block with an explanatory comment (see header).
const reactBlock =
  '    // React is a platform seed word in the web shell; the settings card\n' +
  '    // needs it, the folding engine does not.\n' +
  '    var React = null;\n' +
  '    try {\n' +
  '      React = require(\'react\');\n' +
  '    } catch (err) {\n' +
  '      React = null;\n' +
  '    }\n';
if (body.indexOf(reactBlock) === -1) throw new Error('React block not found');
body = body.replace(reactBlock,
  '    // React is the runner\'s closure parameter; the folding engine does not\n' +
  '    // need it directly, and redeclaring it here would shadow the parameter.\n');

// 4. Replace the module.exports tail with a bare `return plugin;`.
const tail =
  '    module.exports = plugin;\n' +
  '    return module.exports;';
if (body.indexOf(tail) === -1) throw new Error('export tail not found');
body = body.replace(tail, 'return plugin;\n');

fs.writeFileSync(outPath, body, 'utf8');
console.log('wrote', outPath, body.length, 'bytes');
