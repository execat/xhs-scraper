#!/usr/bin/env node
/*
 * Minimal Chrome DevTools Protocol driver.
 *
 *   node cdp.js list
 *   node cdp.js eval <url-substring> <file-with-js-expression>
 *
 * Picks the first page target whose URL contains the substring, evaluates the
 * file's contents as a JS expression in that tab, and prints the JSON result.
 * Uses Node's built-in WebSocket — no npm dependencies.
 */
'use strict';

const fs = require('fs');

const PORT = process.env.CDP_PORT || 9222;

async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function pick(list, needle) {
  const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  return pages.find((t) => t.url.includes(needle)) || null;
}

function evaluate(wsUrl, expression, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('timeout')); }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      }));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)));
      const r = msg.result || {};
      if (r.exceptionDetails) {
        const ex = r.exceptionDetails;
        return reject(new Error('page exception: ' + (ex.exception && ex.exception.description || ex.text)));
      }
      resolve(r.result ? r.result.value : undefined);
    });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error('ws error: ' + (e.message || 'unknown'))); });
  });
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const list = await targets();

  if (cmd === 'list') {
    for (const t of list.filter((x) => x.type === 'page')) {
      console.log(`${t.id}  ${(t.title || '').slice(0, 45).padEnd(45)}  ${t.url.slice(0, 90)}`);
    }
    return;
  }

  if (cmd === 'eval') {
    const [needle, file] = rest;
    const t = pick(list, needle);
    if (!t) {
      console.error('no tab matching ' + JSON.stringify(needle));
      for (const x of list.filter((y) => y.type === 'page')) console.error('  have: ' + x.url.slice(0, 100));
      process.exit(1);
    }
    const expr = fs.readFileSync(file, 'utf8');
    const value = await evaluate(t.webSocketDebuggerUrl, expr);
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    return;
  }

  console.error('usage: cdp.js list | cdp.js eval <url-substring> <file.js>');
  process.exit(2);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
