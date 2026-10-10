// Pick-an-amount buttons instead of typed number boxes (Oct 2026, owner: "typing in is way too hard"): an offer is a
// share of what the other side asks for. Used by recruiting NIL, the portal and the staff market.
export const STEPS = [[0.75, 'Low'], [0.9, 'Fair'], [1, 'His ask'], [1.15, 'Above']];
const round5 = x => Math.max(5, Math.round(x / 5) * 5);
export const m$ = k => '$' + (k >= 1000 ? (k / 1000).toFixed(2) + 'M' : Math.round(k) + 'k');
/** buttons with data-{attr}="{id}|{amount}"; the current amount is highlighted */
export function moneyButtons(attr, id, ask, cur, esc) {
  return `<span class="mb-row">${STEPS.map(([k, l]) => { const a = round5(ask * k); return `<button type="button" class="mb ${cur && Math.abs(cur - a) < 3 ? 'on' : ''}" data-${attr}="${esc(id)}|${a}" title="${Math.round(k * 100)}% of the ask">${l}<b>${m$(a)}</b></button>`; }).join('')}</span>`;
}
/** a <select> of amounts (for forms that read a value on submit) */
export function moneySelect(attr, id, ask, esc) {
  return `<select class="dy-min" data-${attr}="${esc(id)}">${STEPS.map(([k, l]) => { const a = round5(ask * k); return `<option value="${a}" ${k === 1 ? 'selected' : ''}>${l} · ${m$(a)}</option>`; }).join('')}</select>`;
}
export const MONEY_CSS = `.mb-row{display:inline-flex;gap:4px;flex-wrap:wrap;vertical-align:middle}
.mb{border:1px solid var(--border2,#ccc);background:none;color:inherit;font:600 11px Inter,system-ui,sans-serif;border-radius:6px;padding:3px 7px;cursor:pointer;line-height:1.15;text-align:center}
.mb b{display:block;font-size:12px}.mb.on{border-color:var(--accent,#c9a227);background:color-mix(in srgb,var(--accent,#c9a227) 14%,transparent)}
.dy-step{border:1px solid var(--border2,#ccc);background:none;color:inherit;width:22px;height:22px;border-radius:5px;cursor:pointer;font-weight:800;line-height:1;padding:0}
input.dy-min[readonly]{width:40px;text-align:center;background:none;border:0;font-weight:700}`;
export function ensureMoneyCss() { if (!document.getElementById('mbCss')) { const s = document.createElement('style'); s.id = 'mbCss'; s.textContent = MONEY_CSS; document.head.appendChild(s); } }
