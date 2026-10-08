// Headless phone audit: every page at 375x812 (mobile emulation) -> page overflow + tables wider than their box.
// Needs the local server (preview "tdc-static", :8991) and Google Chrome. Uses a throwaway profile: DELETE it
// before each run (rm -rf /tmp/claude-501/mobaudit-profile) or the site's service worker serves stale scripts.
//   node scripts/mobile_audit.mjs out.json            # all pages
//   ONLY=team,player WAIT=12000 node scripts/mobile_audit.mjs out.json
//   EXPR=probe.js ONLY=onoff node scripts/mobile_audit.mjs out.json   # run your own expression instead
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:8991';
const OUT = process.argv[2] || 'audit.json';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const Q = { team: '?team=Duke', player: '?espn=5103630', game: '?id=401720000', preview: '?home=Duke&away=Kansas', conference: '?conf=ACC',
  'program-hq': '?team=Duke', fan: '?team=Duke', coach: '?team=Duke', roster: '?team=Duke', dossier: '?espn=5103630', 'player-splits': '?espn=5103630' };
const pages = ONLY.length ? ONLY : fs.readdirSync('/Users/aidanlee/the-depth-chart').filter(f => f.endsWith('.html') && !/^(offline|404|_)/.test(f)).map(f => f.replace('.html', ''));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9333', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=/tmp/claude-501/mobaudit-profile', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws; for (let i = 0; i < 40; i++) { try { const v = await (await fetch('http://127.0.0.1:9333/json/version')).json(); ws = v.webSocketDebuggerUrl; break; } catch (e) { await sleep(250); } }
const sock = new WebSocket(ws); await new Promise(r => sock.onopen = r);
let id = 0; const wait = new Map(), events = [];
sock.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } else events.push(d); };
const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; wait.set(i, r); sock.send(JSON.stringify({ id: i, method, params, sessionId })); });
const AUDIT = `(() => { const W = innerWidth, d = document; const sw = d.documentElement.scrollWidth;
  const clipped = e => { for (let a = e.parentElement; a && a !== d.body && a !== d.documentElement; a = a.parentElement) { const s = getComputedStyle(a); if (/auto|scroll|hidden|clip/.test(s.overflowX) || s.position === 'fixed') return true; } return false; };
  const offs = []; d.querySelectorAll('body *').forEach(e => { const s = getComputedStyle(e); if (s.position === 'fixed' || s.display === 'none' || s.visibility === 'hidden') return; const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > W + 2 && !clipped(e)) offs.push({ el: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/).slice(0, 3).join('.') : ''), r: Math.round(r.right), w: Math.round(r.width) }); });
  // outermost offenders only
  const top = offs.sort((a, b) => b.w - a.w).slice(0, 5);
  const tables = []; d.querySelectorAll('table').forEach(t => { if (t.offsetParent === null) return; const p = t.parentElement, tw = t.getBoundingClientRect().width; if (tw - p.clientWidth > 3) tables.push({ t: (typeof t.className === 'string' && t.className) || (t.id) || (p.id || (typeof p.className === 'string' ? p.className : '')).slice(0, 30), w: Math.round(tw), box: p.clientWidth, cols: (t.rows[0] || { cells: [] }).cells.length }); });
  return JSON.stringify({ sw, W, pageOver: sw > W + 1, offs: top, tables }); })()`;
async function auditPage(p) {
  const { result } = await send('Target.createTarget', { url: 'about:blank' });
  const tid = result.targetId;
  const att = await send('Target.attachToTarget', { targetId: tid, flatten: true }); const s = att.result.sessionId;
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true }, s);
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }, s);
  await send('Page.enable', {}, s);
  // AUDIT_UNLOCK=1: local test harness only — wrap the paywall so every tab renders (no sign-in, no network)
  if (process.env.AUDIT_UNLOCK) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let G; Object.defineProperty(window, 'TDCGate', { configurable: true,
    get() { return G; }, set(v) { G = v; if (v && typeof v === 'object') { v.has = () => true; v.plan = () => 'coach'; v.resolved = () => true; v.ready = Promise.resolve('coach'); v.lock = () => {}; } } }); })();` }, s);
  await send('Page.navigate', { url: BASE + '/' + p + '.html' + (Q[p] || '') }, s);
  await sleep(+(process.env.WAIT || 7000));
  const r = await send('Runtime.evaluate', { expression: process.env.EXPR ? fs.readFileSync(process.env.EXPR, 'utf8') : AUDIT, returnByValue: true, awaitPromise: true }, s);
  await send('Target.closeTarget', { targetId: tid });
  try { if (process.env.EXPR) return { raw: r.result.result.value }; return JSON.parse(r.result.result.value); } catch (e) { return { err: JSON.stringify(r.result).slice(0, 200) }; }
}
const res = {}; const queue = pages.slice(); const N = +(process.env.PAR || 4);
await Promise.all(Array.from({ length: N }, async () => { while (queue.length) { const p = queue.shift(); try { res[p] = await auditPage(p); } catch (e) { res[p] = { err: String(e) }; } process.stderr.write('.'); } }));
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
sock.close(); chrome.kill();
if (process.env.EXPR) { for (const [p, v] of Object.entries(res)) console.log(p, v.raw || v.err); process.exit(0); }
const bad = Object.entries(res).filter(([, v]) => v.err || v.pageOver || (v.tables && v.tables.length));
console.log(`\n${pages.length} pages · page overflow on ${Object.values(res).filter(v => v.pageOver).length} · overflowing tables on ${Object.values(res).filter(v => v.tables && v.tables.length).length}`);
for (const [p, v] of bad) console.log(p.padEnd(20), v.err ? 'ERR ' + v.err : (v.pageOver ? `PAGE ${v.sw}px  ` + v.offs.slice(0, 2).map(o => o.el + '@' + o.r).join(' ; ') : '') + (v.tables.length ? '  | tables: ' + v.tables.map(t => `${t.t.slice(0, 26)} ${t.w}/${t.box}`).join(' ; ') : ''));
