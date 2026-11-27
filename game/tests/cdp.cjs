// Talks to the game inside the Android emulator's WebView through the DevTools port (debug APK).
//   node tests/cdp.cjs "<js expression>" [screenshot.png]
const fs = require('node:fs');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') console.log('[console.' + m.params.type + ']', m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
    else if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', JSON.stringify(m.params.exceptionDetails).slice(0, 500));
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error(method + ' timeout')), 170000); });
  await send('Runtime.enable');
  const expr = process.argv[2] || '1';
  try {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    console.log(JSON.stringify(r.result.exceptionDetails ? r.result.exceptionDetails : r.result.result.value));
  } catch (e) { console.log('EVAL ERROR', String(e)); }
  if (process.argv[3]) {
    try { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(process.argv[3], Buffer.from(s.result.data, 'base64')); console.log('shot ok'); } catch (e) { console.log('SHOT ERROR', String(e)); }
  }
  ws.close();
})().catch((e) => { console.log('ERROR', String(e)); process.exit(1); });
