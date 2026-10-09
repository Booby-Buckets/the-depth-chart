// Dynasty account saves: the signed-in user's dynasties in Supabase `dynasty_saves` (scripts/dynasty_saves.sql,
// row-level security = your own rows only). UI-side only; the engine never touches storage or Supabase.
// The league JSON (~3 MB) is gzip'd + base64'd in the browser (CompressionStream) before upload.
const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/dynasty_saves';
const KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';

function session() {
  try { if (window.tdcRefreshIfNeeded) window.tdcRefreshIfNeeded(); } catch (e) {}
  try { const s = JSON.parse(localStorage.getItem('tdc_session') || 'null'); return s && s.access_token && s.user && s.user.id ? s : null; }
  catch (e) { return null; }
}
export const signedIn = () => !!session();
const H = (s, extra) => Object.assign({ apikey: KEY, Authorization: 'Bearer ' + s.access_token }, extra || {});

async function gzip64(text) {
  const cs = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gunzip64(b64) {
  const bin = atob(b64), buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(ds).text();
}
async function check(r, what) {
  if (r.ok) return r;
  let msg = ''; try { const j = await r.json(); msg = j.message || j.hint || ''; } catch (e) {}
  if (r.status === 404 || /does not exist|schema cache/.test(msg)) msg = 'account saves are not set up yet';
  throw new Error(`${what} failed (${r.status})${msg ? ': ' + msg : ''}`);
}

/** [{slot, meta, at}] — the account's dynasties, newest first (no league data) */
export async function cloudList() {
  const s = session(); if (!s) return [];
  const r = await check(await fetch(`${SB}?select=slot,meta,updated_at,size&order=updated_at.desc`, { headers: H(s) }), 'Loading your saves');
  return (await r.json()).map(x => ({ slot: x.slot, meta: x.meta || {}, at: Date.parse(x.updated_at), size: x.size }));
}
/** upload one dynasty (json string); `at` = the local save time, so the newest copy is always identifiable */
export async function cloudPut(slot, json, meta, at) {
  const s = session(); if (!s) return false;
  const data = await gzip64(json);
  const body = { user_id: s.user.id, slot, meta, data, size: data.length, updated_at: new Date(at || Date.now()).toISOString() };
  await check(await fetch(`${SB}?on_conflict=user_id,slot`, { method: 'POST',
    headers: H(s, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(body) }), 'Saving to your account');
  return true;
}
/** {json, meta, at} or null */
export async function cloudGet(slot) {
  const s = session(); if (!s) return null;
  const r = await check(await fetch(`${SB}?slot=eq.${encodeURIComponent(slot)}&select=meta,data,updated_at&limit=1`, { headers: H(s) }), 'Loading the save');
  const row = (await r.json())[0]; if (!row) return null;
  return { json: await gunzip64(row.data), meta: row.meta || {}, at: Date.parse(row.updated_at) };
}
export async function cloudDel(slot) {
  const s = session(); if (!s) return false;
  await check(await fetch(`${SB}?slot=eq.${encodeURIComponent(slot)}`, { method: 'DELETE', headers: H(s) }), 'Deleting the save');
  return true;
}
