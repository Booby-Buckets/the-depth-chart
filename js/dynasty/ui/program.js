// Program tab: the head coach's week (hours), the staff (coverage, budget, hiring), the practice plan (two focus
// pillars + offensive / defensive scheme with fit and familiarity) and the NIL collective. UI only — every rule
// lives in engine/program.js.
import { DIFFS, HOURS, AREAS, ROLES, OFF, DEF, PIL_LABEL, FOCUS_LABEL, cover, effort, fitOf, famOf, payroll, hire, fire, boosterEvent,
  devMult, focusBonus, recruitPoints, nilRetention, nilOffer } from '../engine/program.js?v=36';

const AREA_TXT = {
  practice: 'Scheme familiarity and your two focus areas grow with practice time.',
  recruiting: 'Builds your signing-day effort points (the recruiting board budget).',
  nil: 'Booster engagement: grows the collective that keeps players and lands recruits.',
  development: 'Individual work: how much your players improve over the summer.',
};

export function programView(ctx) {
  const S = ctx.get(), { esc, $ } = ctx, t = S.teams[S.user], P = t.prog;
  const d = DIFFS[S.diff || 'pro'];
  const used = AREAS.reduce((s, [a]) => s + (P.hours[a] || 0), 0);
  const pct = v => Math.round(v * 100);
  const bar = (v, max = 2) => `<span class="pg-bar"><i style="width:${Math.min(100, 100 * v / max)}%;background:${v >= 1.15 ? 'var(--green,#1a8c3a)' : v >= 0.85 ? '#c9a227' : 'var(--red,#cc2200)'}"></i></span>`;
  const m = v => '$' + (v >= 1000 ? (v / 1000).toFixed(2) + 'M' : Math.round(v) + 'k');
  const avgP = k => { let w = 0, s = 0; for (const id of t.players) { const p = S.players[id]; if (p && p.mpg) { s += p.pillars[k] * p.mpg; w += p.mpg; } } return w ? Math.round(s / w) : 50; };
  const offseason = S.phase === 'offseason';
  const avgSta = () => { let w = 0, v = 0; for (const id of t.players) { const p = S.players[id]; if (p && p.mpg) { v += (p.sta ?? 50) * p.mpg; w += p.mpg; } } return w ? Math.round(v / w) : 50; };

  // 1. hours
  const hours = `<div class="pg-card"><div class="pg-h"><h3>Your week</h3><span class="pg-n">${used} / ${HOURS} hours · your staff covers part of every area, so a better staff frees your time</span></div>
    <table class="pg-tbl"><thead><tr><th class="l">Area</th><th class="l">Your hours</th><th>Staff covers</th><th class="l">Effort vs an average program</th></tr></thead><tbody>
    ${AREAS.map(([a, l]) => { const e = effort(S, t, a); return `<tr><td class="l"><b>${l}</b><div class="pg-d">${AREA_TXT[a]}</div></td>
      <td class="l"><input type="range" min="0" max="40" step="1" value="${P.hours[a]}" data-hr="${a}"> <b class="pg-hv" id="hv-${a}">${P.hours[a]}</b> h</td>
      <td>+${cover(P, a).toFixed(1)} h</td><td class="l">${bar(e)} <b>${pct(e)}%</b></td></tr>`; }).join('')}
    </tbody></table><div class="pg-d">${S.diff === 'hof' ? 'Hall of Fame: every area needs 25% more effort to keep pace.' : S.diff === 'aa' ? 'All-American: every area needs 10% more effort.' : S.diff === 'rookie' ? 'Rookie: your staff fills more of the gaps (15% less effort needed).' : ''}</div></div>`;

  // 2. staff
  const pool = (S.staffPool || []);
  const canHire = role => offseason || !P.staff[role];
  const staff = `<div class="pg-card"><div class="pg-h"><h3>Staff</h3><span class="pg-n">Payroll ${m(payroll(P))} of ${m(P.budget)} budget${offseason ? ' · the offseason is hiring season' : ' · you can fill an empty seat any time'}</span></div>
    <table class="pg-tbl"><thead><tr><th class="l">Role</th><th class="l">Coach</th><th>Rating</th><th>Covers</th><th>Salary</th><th>Contract</th><th></th></tr></thead><tbody>
    ${ROLES.map(([k, l, a]) => { const s = P.staff[k];
      return `<tr><td class="l">${l}</td><td class="l">${s ? esc(s.name) : '<span class="pg-warn">Vacant</span>'}</td><td>${s ? `<b>${s.r}</b>` : '—'}</td>
        <td>${s ? '+' + (Math.max(0, (s.r - 30) / 70) * (a === 'practice' ? 7 : 12)).toFixed(1) + ' h ' + esc(AREAS.find(x => x[0] === a)[1].toLowerCase()) : '—'}</td>
        <td>${s ? m(s.pay) : '—'}</td><td>${s ? s.yrs + ' yr' + (s.yrs === 1 ? '' : 's') : ''}</td>
        <td>${s ? `<button class="btn ghost pg-sm" data-fire="${k}">Release</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table>
    ${pool.length ? `<details class="pg-pool" ${ROLES.some(([k]) => !P.staff[k]) ? 'open' : ''}><summary>Candidates (${pool.length})</summary>
      <table class="pg-tbl"><thead><tr><th class="l">Role</th><th class="l">Coach</th><th>Rating</th><th>Salary</th><th></th></tr></thead><tbody>
      ${pool.slice().sort((a, b) => a.role.localeCompare(b.role) || b.r - a.r).map(s => `<tr><td class="l">${esc(ROLES.find(r => r[0] === s.role)[1])}</td><td class="l">${esc(s.name)}</td><td><b>${s.r}</b></td><td>${m(s.pay)}</td>
        <td>${canHire(s.role) ? `<button class="btn ghost pg-sm" data-hire="${esc(s.id)}">Hire</button>` : '<span class="pg-d">in the offseason</span>'}</td></tr>`).join('')}</tbody></table></details>` : ''}</div>`;

  // 3. practice plan
  const schemeRows = (side, SET, cur) => Object.entries(SET).map(([k, x]) => {
    const f = fitOf(S, t, side, k), fm = famOf(S, t, side, k);
    return `<tr class="${k === cur ? 'on' : ''}"><td class="l"><label><input type="radio" name="sch-${side}" value="${k}" ${k === cur ? 'checked' : ''}> <b>${esc(x.label)}</b></label><div class="pg-d">${esc(x.blurb)}</div></td>
      <td class="l">${bar(Math.max(0, f + 1), 2)} ${f >= 0 ? '+' : ''}${f.toFixed(2)}</td><td class="l">${bar(fm / 50, 2)} ${Math.round(fm)}</td></tr>`; }).join('');
  const plan = `<div class="pg-card"><div class="pg-h"><h3>Practice plan</h3><span class="pg-n">Two focus areas grow faster all season (and carry into the summer). The longer your players run a scheme, the better they get at it.</span></div>
    <div class="pg-focus">${[0, 1].map(i => `<label>Focus ${i + 1} <select data-focus="${i}">${Object.entries(FOCUS_LABEL).map(([k, l]) => `<option value="${k}" ${P.focus && P.focus[i] === k ? 'selected' : ''}>${l} (team ${k === 'STA' ? avgSta() : avgP(k)})</option>`).join('')}</select></label>`).join('')}</div>
    <div class="pg-two"><div><h4>Offense</h4><table class="pg-tbl"><thead><tr><th class="l">Scheme</th><th class="l">Roster fit</th><th class="l">Familiarity</th></tr></thead><tbody>${schemeRows('o', OFF, P.off)}</tbody></table></div>
    <div><h4>Defense</h4><table class="pg-tbl"><thead><tr><th class="l">Scheme</th><th class="l">Roster fit</th><th class="l">Familiarity</th></tr></thead><tbody>${schemeRows('d', DEF, P.def)}</tbody></table></div></div>
    <div class="pg-d">Fit = how well your rotation's skills match what the scheme asks for (0 = average). Familiarity = how well your players know it (0-100, minutes-weighted): it grows with practice and games, carries over when players return, and starts low for newcomers. Switching schemes starts the new one from what each player already knows.</div></div>`;

  // 4. NIL
  const ret = nilRetention(S, t), off = nilOffer(S, t);
  const funds = Object.values(S.teams).map(x => x.prog ? x.prog.nil.fund : 0).sort((a, b) => b - a), rank = funds.indexOf(P.nil.fund) + 1;
  const nil = `<div class="pg-card"><div class="pg-h"><h3>NIL collective</h3><span class="pg-n">Rank #${rank} of ${funds.length} in collective money</span></div>
    <div class="pg-kv"><div><span>Fund</span><b>${m(P.nil.fund)}</b></div><div><span>Last week</span><b>${P.nil.wk >= 0 ? '+' : ''}${m(P.nil.wk)}</b></div>
      <div><span>Keeps players from the portal</span><b>${pct(ret)}%</b></div><div><span>Recruiting pull</span><b>${off >= 0 ? '+' : ''}${off.toFixed(2)}</b></div></div>
    <div class="pg-d"><b>Grows with:</b> your NIL hours and GM, winning, your program's prestige, booster events. <b>Shrinks with:</b> losing, the roster's deals each offseason (half the fund), and booster disputes (more common on harder levels).</div>
    <button class="btn ghost" id="pgBooster">Host a booster event</button> <span class="pg-d" id="pgBoosterMsg">Trades two weeks of recruiting momentum for money now.</span></div>`;

  // 5. season so far
  const season = `<div class="pg-card"><div class="pg-h"><h3>This season so far</h3><span class="pg-n">${P.acc.weeks} week${P.acc.weeks === 1 ? '' : 's'} of work</span></div>
    <div class="pg-kv"><div><span>Signing-day effort</span><b>${recruitPoints(S, t)} pts</b></div><div><span>Summer development</span><b>×${devMult(t).toFixed(2)}</b></div>
    <div><span>Focus carry-over</span><b>+${focusBonus(t).toFixed(1)}</b></div></div></div>`;

  $('#dyBody').innerHTML = `<div class="sec"><h2>Program</h2><span class="n">Difficulty: <b>${esc(d.label)}</b> · ${esc(d.blurb)}</span></div>` + hours + plan + staff + nil + season;
  bind(ctx);
}

function bind(ctx) {
  const S = ctx.get(), t = S.teams[S.user], P = t.prog, $ = ctx.$;
  document.querySelectorAll('[data-hr]').forEach(r => {
    r.oninput = () => {
      const a = r.dataset.hr, others = Object.entries(P.hours).filter(([k]) => k !== a).reduce((s, [, v]) => s + v, 0);
      const v = Math.min(+r.value, HOURS - others); r.value = v; P.hours[a] = v; $('#hv-' + a).textContent = v;
    };
    r.onchange = () => { ctx.touch(); ctx.autosave(); programView(ctx); };
  });
  document.querySelectorAll('[data-focus]').forEach(sel => sel.onchange = () => {
    const f = (P.focus || ['SHT', 'DEF']).slice(); f[+sel.dataset.focus] = sel.value;
    if (f[0] === f[1]) { alert('Pick two different focus areas.'); return programView(ctx); }
    P.focus = f; ctx.autosave(); programView(ctx);
  });
  document.querySelectorAll('input[name="sch-o"],input[name="sch-d"]').forEach(r => r.onchange = () => {
    const side = r.name === 'sch-o' ? 'off' : 'def', cur = P[side];
    if (S.phase !== 'offseason' && !confirm(`Switch your ${side === 'off' ? 'offense' : 'defense'} mid-season? Your players start the new scheme from what they already know of it.`)) { r.checked = false; document.querySelector(`input[name="${r.name}"][value="${cur}"]`).checked = true; return; }
    P[side] = r.value; ctx.touch(); ctx.autosave(); programView(ctx);
  });
  document.querySelectorAll('[data-hire]').forEach(b => b.onclick = () => { const e = hire(S, b.dataset.hire); if (e) return alert(e); ctx.touch(); ctx.autosave(); programView(ctx); });
  document.querySelectorAll('[data-fire]').forEach(b => b.onclick = () => { if (!confirm('Release this coach? The seat stays empty until you hire someone.')) return; fire(S, b.dataset.fire); ctx.touch(); ctx.autosave(); programView(ctx); });
  const bb = $('#pgBooster'); if (bb) bb.onclick = () => { const msg = boosterEvent(S); ctx.autosave(); programView(ctx); const el = $('#pgBoosterMsg'); if (el) el.textContent = msg; };
}

// the difficulty picker on the new-dynasty screen
export function diffPicker(cur, esc) {
  return `<div class="pg-diff">${Object.entries(DIFFS).map(([k, x]) => `<button class="${k === cur ? 'on' : ''}" data-diff="${k}"><b>${esc(x.label)}</b><span>${esc(x.blurb)}</span></button>`).join('')}</div>`;
}
