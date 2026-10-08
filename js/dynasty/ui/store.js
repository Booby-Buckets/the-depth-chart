// Dynasty saves in the browser (IndexedDB — a league is ~3 MB, past localStorage's limit).
// UI-side only; the engine never touches storage.
const DB = 'tdc-dynasty', ST = 'saves';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function tx(mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(ST, mode), s = t.objectStore(ST), out = fn(s);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  }));
}
export const saveSlot = (slot, json, meta) => tx('readwrite', s => s.put({ json, meta, at: Date.now() }, slot));
export const loadSlot = slot => tx('readonly', s => s.get(slot));
export const removeSlot = slot => tx('readwrite', s => s.delete(slot));
export function listSlots() {
  return db().then(d => new Promise((res, rej) => {
    const out = [], t = d.transaction(ST, 'readonly'), c = t.objectStore(ST).openCursor();
    c.onsuccess = () => { const cur = c.result; if (!cur) return; out.push({ slot: cur.key, meta: cur.value.meta, at: cur.value.at }); cur.continue(); };
    t.oncomplete = () => res(out.sort((a, b) => b.at - a.at)); t.onerror = () => rej(t.error);
  }));
}
