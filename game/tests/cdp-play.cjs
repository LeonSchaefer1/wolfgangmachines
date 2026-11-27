// Plays level 1 inside the Android emulator's WebView through DevTools (debug APK):
// real touch events are injected into the WebView, frames are grabbed from the WebGL canvas.
//   node tests/cdp-play.cjs <outDir>
const fs = require('node:fs');
const out = process.argv[2] || '.';
(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json')).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', JSON.stringify(m.params.exceptionDetails).slice(0, 400));
    else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) console.log('[console.' + m.params.type + ']', m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => rej(new Error(method + ' timeout')), 280000); });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const touch = (type, x, y) => send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await sleep(150); await touch('touchEnd', x, y); };
  // optional: also photograph the real emulator display (EMU_SHOT=1)
  const { execSync } = require('node:child_process');
  const display = async (name) => {
    if (!process.env.EMU_SHOT) return;
    await sleep(+(process.env.EMU_SHOT_WAIT || 15000));
    try { execSync(`../scripts/emulator-test.sh shot ${out}/${name}.png`, { stdio: 'ignore', timeout: 90000 }); } catch (e) { console.log('display shot failed', name); }
  };
  const grab = async (name) => {
    await display(name.replace('emu-', 'display-'));
    const url = await ev(`(() => { const g = window.__game; g.tick(performance.now() + 100); g.stage.render(); return document.getElementById('stage').toDataURL('image/jpeg', 0.9); })()`);
    fs.writeFileSync(`${out}/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  };
  const state = () => ev(`(() => { const g = window.__game; const d = document.querySelector('.card h2'); return { mode: g.mode, level: g.level.id, dialog: d ? d.textContent : null, placed: g.placed.map((p) => [p.x, p.y, p.a]), success: g.sim ? g.sim.success : null, stars: document.querySelectorAll('.card .stars svg.on').length, running: document.getElementById('game').classList.contains('running'), saved: localStorage.getItem('wolfgangs-werkstatt-v1') }; })()`);
  const center = (sel, text) => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => !${JSON.stringify(text || '')} || e.textContent.includes(${JSON.stringify(text || '')})); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const waitFor = async (what, pred, tries = 40) => { for (let i = 0; i < tries; i++) { const s = await state(); if (pred(s)) return s; await sleep(3000); } throw new Error('timeout waiting for ' + what + ': ' + JSON.stringify(await state())); };
  await send('Runtime.enable');

  await ev(`(() => { window.__game.paused = false; return 1; })()`);
  console.log('start', JSON.stringify(await state()));
  let p = await center('#menu .btn.main');
  await tap(p.x, p.y);
  await waitFor('intro dialog', (s) => s.mode === 'build' && s.dialog);
  console.log('after "Spielen"', JSON.stringify(await state()));
  await grab('emu-1-intro');
  p = await center('.card .btn', "Los geht");
  await tap(p.x, p.y);
  await waitFor('dialog closed', (s) => !s.dialog);
  await grab('emu-2-build');
  // drag the plank out of the toolbox onto the wall with a finger
  const from = await center('.slot');
  const to = await ev(`window.__game.stage.toScreen(4.5, 2.75)`);
  await touch('touchStart', from.x, from.y);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8); await sleep(120); }
  await grab('emu-3-drag');
  await touch('touchEnd', to.x, to.y);
  await sleep(1500);
  const placed = await state();
  console.log('after drag', JSON.stringify(placed));
  await grab('emu-4-placed');
  p = await center('#btn-start');
  await tap(p.x, p.y);
  await waitFor('run mode', (s) => s.mode === 'run');
  await ev(`(() => { window.__game.debugAdvance(2.0); return 1; })()`);
  await grab('emu-5-running');
  await ev(`(() => { window.__game.debugAdvance(3.0); return 1; })()`);
  console.log('after run', JSON.stringify(await state()));
  await grab('emu-6-solved');
  const won = await waitFor('win dialog', (s) => s.dialog && s.stars > 0, 60);
  console.log('win', JSON.stringify(won));
  await display('display-7-win');
  await ev(`(() => { window.__game.paused = true; return 1; })()`);
  ws.close();
})().catch((e) => { console.log('ERROR', String(e)); process.exit(1); });
