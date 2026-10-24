#!/usr/bin/env node
/*
 * Dev-only helper: assemble a runnable harness page out of a fixture + scrape.js.
 * The harness installs a console.log shim, then loads scrape.js exactly the way
 * a paste into the DevTools console would (as a plain script, after the DOM is
 * parsed), and finally dumps every captured console line into <pre id="captured">.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const fixtureName = process.argv[2];
const outFile = process.argv[3];
const scriptName = process.argv[4] || 'scrape.js';
// Optional JS to run after the scraper loads. The paste-time auto-run is
// links-only, so the browser check passes an explicit
// `scrape({ linksOnly: false })` here to exercise the full table too.
const extraJs = process.argv[5] || '';
if (!fixtureName || !outFile) {
  console.error('usage: make-harness.js <fixture-name> <out-file> [script-file] [extra-js]');
  process.exit(2);
}

const root = path.join(__dirname, '..');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', fixtureName + '.html'), 'utf8');
const src = fs.readFileSync(path.join(root, scriptName), 'utf8');

const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(fixture);
if (!m) throw new Error('fixture has no <body>: ' + fixtureName);

const shim = [
  'window.__logs = [];',
  '(function () {',
  '  var orig = console.log;',
  '  console.log = function () {',
  '    var parts = [];',
  '    for (var i = 0; i < arguments.length; i++) {',
  '      var a = arguments[i];',
  '      parts.push(typeof a === \'string\' ? a : JSON.stringify(a));',
  '    }',
  '    window.__logs.push(parts.join(\' \'));',
  '    orig.apply(console, arguments);',
  '  };',
  '})();',
].join('\n');

const tail = [
  'var pre = document.createElement(\'pre\');',
  'pre.id = \'captured\';',
  'pre.textContent = window.__logs.join(\'\\u0001\');',
  'document.body.appendChild(pre);',
].join('\n');

const page = [
  '<!doctype html>',
  '<html lang="zh-CN"><head><meta charset="utf-8"><title>scraper harness</title>',
  '<script>' + shim + '</script>',
  '</head><body>',
  m[1],
  '<script>' + src + '</script>',
  extraJs ? '<script>' + extraJs + '</script>' : '',
  '<script>' + tail + '</script>',
  '</body></html>',
  '',
].filter((s) => s !== '').join('\n');

fs.writeFileSync(outFile, page);
console.log('wrote ' + outFile);
