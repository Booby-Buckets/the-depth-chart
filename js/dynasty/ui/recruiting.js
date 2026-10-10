// In-season Recruiting tab, EA College Football 25 style (Oct 2026): offers, a weekly hours budget spent on actions,
// recruits narrowing their lists (Top 8 / 5 / 3), commitments that can flip, signings. Rules: engine/commits.js
// (the race), engine/visits.js (official visits at home games), engine/recruit.js (what each recruit values, NIL).
import { scoutView, scoutSD } from '../engine/offseason.js?v=73';
import { moneyButtons, ensureMoneyCss } from './money.js?v=73';
import { acadGrade, admitP, admitLabel } from '../engine/people.js?v=73';
import { priorities, negotiate, acceptCounter, FACTORS, committedNIL, profile } from '../engine/recruit.js?v=73';
import { officialMax, visitsLeft, visitsFor, upcomingHomeGames, scheduleOfficial, cancelVisit, VISIT_FOCUS, BIG_MAX, isBig, toggleBig, setFocus } from '../engine/visits.js?v=73';
import { power, lineFor } from '../engine/season.js?v=73';
import { factors as facOf, relationship as relOf } from '../engine/recruit.js?v=73';
import { STAGE_LABEL, ACTIONS, HOURS_CAP, USER_OFFERS_MAX, SUMMER, cutWeeks, classNeed, commitsOf, hoursBudget, hoursUsed, planHours,
  offerRecruit, withdrawOffer, toggleAction, userChance, gradesFor, rankOf, passesDB, dbLabel, grade, scoutedPct, revealed, needs, groupOf, classRanks, pipeOf, pipeTier, pipelinesOf, battleOf } from '../engine/commits.js?v=73';

let sel = null, q = '', pos = '', minStars = 3, onlyOpen = true, pickVisit = false, msg = '', rv = 'board', needOnly = false;
const CSS = `
.rc-stages{display:grid;grid-template-columns:repeat(6,1fr);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin:6px 0 12px}
.rc-stages div{padding:8px 10px;border-left:1px solid var(--border);font-size:11.5px;color:var(--text3)}
.rc-stages div:first-child{border-left:0}.rc-stages b{display:block;font-size:12.5px;color:var(--text)}
.rc-stages div.now{background:color-mix(in srgb,var(--accent,#c9a227) 12%,transparent)}
.rc-bud{display:flex;gap:22px;flex-wrap:wrap;align-items:center;border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:12px}
.rc-bud span{display:block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}
.rc-bud b{font-size:17px}.rc-bar{flex:1;min-width:200px;height:10px;border-radius:5px;background:var(--bg3,#ddd);overflow:hidden}
.rc-bar i{display:block;height:100%;background:var(--accent,#c9a227)}
.rc-cols{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px;align-items:start}
@media(max-width:1000px){.rc-cols{grid-template-columns:1fr}.rc-stages{grid-template-columns:repeat(3,1fr)}}
/* phones: the board keeps recruit / OVR / stage / your rank / chance; find-recruits keeps offer / recruit / pos / OVR / status */
@media(max-width:640px){.rc-board th:nth-child(2),.rc-board td:nth-child(2),.rc-board th:nth-child(6),.rc-board td:nth-child(6),.rc-board th:nth-child(8),.rc-board td:nth-child(8){display:none}
.rc-find th:nth-child(3),.rc-find td:nth-child(3),.rc-find th:nth-child(5),.rc-find td:nth-child(5),.rc-find th:nth-child(n+7):nth-child(-n+11),.rc-find td:nth-child(n+7):nth-child(-n+11),.rc-find th:nth-child(13),.rc-find td:nth-child(13){display:none}
.rc-board,.rc-find{width:100%!important}.rc-board td,.rc-find td{white-space:normal!important}.rc-cols{grid-template-columns:minmax(0,1fr)!important}.rc-board div.rc-dl{display:none}.rc-board .rc-st,.rc-find .rc-st{white-space:normal!important;display:inline-block;line-height:1.25}
.rc-find td:first-child .rc-q{display:block;margin-top:4px}.rc-stages{grid-template-columns:repeat(2,1fr)}.rc-stages div{padding:6px 8px;font-size:10.5px}
.rc-bud{gap:10px 16px;padding:10px 12px}.rc-bud b{font-size:15px}.rc-bar{min-width:100%;order:9}}
.rc-st{font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:2px 6px;border-radius:4px;white-space:nowrap;background:var(--bg3,#eee)}
.rc-st.t8{background:hsla(30,70%,48%,.2)}.rc-st.t5{background:hsla(60,70%,48%,.22)}.rc-st.t3{background:hsla(100,60%,45%,.28)}
.rc-st.me{background:var(--green,#1a8c3a);color:#fff}.rc-st.them{background:var(--red,#cc2200);color:#fff}.rc-st.sg{background:var(--text);color:var(--bg)}.rc-st.cut{background:hsla(0,70%,48%,.22);color:var(--red,#cc2200)}
tr.rc-sel td{background:color-mix(in srgb,var(--accent,#c9a227) 10%,transparent)!important}
.rc-row{cursor:pointer}.rc-flag{font-size:10.5px;font-weight:700;color:var(--red,#cc2200)}
.rc-box{border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.rc-box h3{margin:0;font-family:'Playfair Display',serif;font-size:20px}
.rc-sch{display:grid;grid-template-columns:18px 120px 1fr 52px;gap:6px;align-items:center;font-size:12.5px;padding:2px 0}
.rc-sch i{display:block;height:9px;border-radius:5px;background:var(--bg3,#eee);overflow:hidden}.rc-sch i em{display:block;height:100%;background:#8a8f99}
.rc-sch.me{font-weight:800}.rc-sch.me i em{background:var(--accent,#c9a227)}
.rc-cut{border-top:2px dashed var(--red,#cc2200);margin:3px 0;font-size:10px;color:var(--red,#cc2200);text-align:right}
.rc-gr{display:grid;grid-template-columns:1fr 38px 38px 46px;gap:3px 8px;font-size:12.5px;align-items:center;margin-top:8px}
.rc-gr .h{font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)}
.rc-g{font-weight:800;text-align:center;border-radius:4px}
.rc-gA{background:hsla(125,70%,45%,.38)}.rc-gB{background:hsla(100,60%,45%,.26)}.rc-gC{background:hsla(60,70%,48%,.22)}.rc-gD{background:hsla(30,70%,48%,.2)}.rc-gF{background:hsla(0,70%,48%,.26)}
.rc-db{margin-top:8px;padding:6px 9px;border:1px solid var(--red,#cc2200);border-radius:7px;font-size:12px}
.rc-acts{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
.rc-act{border:1px solid var(--border2,#ccc);border-radius:7px;padding:6px 8px;cursor:pointer;background:none;text-align:left;font:inherit;color:inherit}
.rc-act b{display:block;font-size:12.5px}.rc-act span{font-size:11px;color:var(--text3)}
.rc-act.on{border-color:var(--accent,#c9a227);background:color-mix(in srgb,var(--accent,#c9a227) 12%,transparent)}
.rc-act:disabled{opacity:.45;cursor:not-allowed}
.rc-feed{margin-top:10px;border-top:1px solid var(--border);padding-top:6px;font-size:12px;color:var(--text2)}
.rc-msg{margin:6px 0;font-size:12.5px;font-weight:700}
.rc-q{display:inline-flex;gap:3px}.rc-q button{border:1px solid var(--border2,#ccc);background:none;color:var(--text3);font:700 10.5px Inter,system-ui,sans-serif;border-radius:5px;padding:2px 5px;cursor:pointer}
.rc-q button.on{border-color:var(--accent,#c9a227);color:var(--text);background:color-mix(in srgb,var(--accent,#c9a227) 14%,transparent)}
.rc-gem{font-size:10px;font-weight:800;padding:1px 5px;border-radius:4px;background:hsla(200,80%,50%,.18);color:#1b6fb0}.rc-bust{font-size:10px;font-weight:800;padding:1px 5px;border-radius:4px;background:hsla(0,70%,48%,.18);color:var(--red,#cc2200)}
.rc-sc{display:inline-block;width:46px;height:6px;border-radius:3px;background:var(--bg3,#eee);vertical-align:middle;overflow:hidden}.rc-sc i{display:block;height:100%;background:#1b6fb0}
.rc-need{display:inline-flex;gap:4px}.rc-need span{font-size:11px;font-weight:800;padding:2px 6px;border-radius:4px;background:hsla(0,70%,48%,.14)}.rc-need span.ok{background:var(--bg3,#eee);color:var(--text3)}
.rc-dl{font-size:11px;font-weight:700}
.rc-pipe{font-size:10px;font-weight:800;padding:1px 6px;border-radius:4px;background:hsla(140,55%,40%,.18);color:var(--green,#1a8c3a);white-space:nowrap}
.vs-focus{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:5px;margin-top:6px}.vs-focus button{border:1px solid var(--border2,#ccc);background:none;color:inherit;border-radius:7px;padding:5px 7px;text-align:left;cursor:pointer;font:inherit}
.vs-focus button b{display:block;font-size:12px}.vs-focus button span{font-size:10.5px;color:var(--text3)}.vs-focus button.on{border-color:var(--accent,#c9a227);background:color-mix(in srgb,var(--accent,#c9a227) 12%,transparent)}
.vs-parts{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:6px;font-size:11.5px;font-weight:700}
.vs-g{border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px}.vs-g.big{border-color:var(--accent,#c9a227)}.vs-gh{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
.vs-tags span{font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:4px;background:var(--bg3,#eee);margin-right:4px}
.h2h{margin-top:10px;border:1px solid var(--accent,#c9a227);border-radius:10px;padding:10px 12px;background:color-mix(in srgb,var(--accent,#c9a227) 6%,transparent)}
.h2h-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-weight:800}.h2h-race{display:grid;grid-template-columns:70px 1fr 64px 70px;gap:6px;align-items:center;font-size:12.5px;margin-top:6px}
.h2h-race i{display:block;height:10px;border-radius:5px;background:var(--bg3,#eee);overflow:hidden}.h2h-race i em{display:block;height:100%}
.h2h-e{display:grid;grid-template-columns:110px 1fr 34px 34px;gap:6px;align-items:center;font-size:12px;margin-top:3px}
.h2h-bar{position:relative;height:9px;background:var(--bg3,#eee);border-radius:4px}.h2h-bar em{position:absolute;top:0;bottom:0;border-radius:4px}.h2h-bar:after{content:'';position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--text3)}
.h2h-m{margin:6px 0 0;padding-left:16px;font-size:12.5px}.h2h-m li{margin:2px 0}
.rc-pipes{display:flex;gap:5px;flex-wrap:wrap;margin:-4px 0 10px;font-size:12px;align-items:center}
`;

export function recruitingView(ctx) {
  const S = ctx.get(), { esc, $, short } = ctx, U = S.user;
  ensureMoneyCss();
  if (!document.getElementById('rcCss')) { const st = document.createElement('style'); st.id = 'rcCss'; st.textContent = CSS; document.head.appendChild(st); }
  const R = S.rclass || [];
  if (!R.length || !R[0].list) { $('#dyBody').innerHTML = '<div class="dy-empty">The recruiting class appears at the start of the season.</div>'; return; }
  const P = S.teams[U].prog, w = S.rweek || 0, wk = Math.max(0, w - SUMMER), plan = S.rplan || {};
  const sub = `<div class="tn-tabs">${[['board', 'Your board'], ['visits', 'Visits'], ['ranks', 'Class rankings'], ['top', 'Top 100']].map(([k, l]) => `<button class="${rv === k ? 'on' : ''}" data-rv="${k}">${l}</button>`).join('')}</div>`;
  if (rv !== 'board') { $('#dyBody').innerHTML = sub + (rv === 'ranks' ? ranksHtml(ctx) : rv === 'visits' ? visitsHtml(ctx) : topHtml(ctx)); bind(ctx); return; }
  const fmt = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const stars = n => '★'.repeat(n) + '<span class="dim">' + '★'.repeat(5 - n) + '</span>';
  const m$ = k => '$' + (k >= 1000 ? (k / 1000).toFixed(2) + 'M' : Math.round(k) + 'k');
  const team = t => (t === U ? 'You' : esc(short(t)));
  const leader = r => r.list.slice().sort((a, b) => (r.int[b] || 0) - (r.int[a] || 0))[0];
  const stage = r => r.signed ? `<span class="rc-st ${r.signed === U ? 'me' : 'sg'}">Signed · ${team(r.signed)}</span>`
    : r.commit ? `<span class="rc-st ${r.commit === U ? 'me' : 'them'}">Committed · ${team(r.commit)}</span>`
    : r.cutUser ? '<span class="rc-st cut">Cut you</span>' : `<span class="rc-st ${r.stage}">${STAGE_LABEL[r.stage]}</span>`;
  const scoutTag = r => { const x = revealed(r); return x === 'gem' ? ' <span class="rc-gem">💎 Gem</span>' : x === 'bust' ? ' <span class="rc-bust">⚠ Bust risk</span>' : x === 'solid' ? ' <span class="dim" style="font-size:10px">✓ scouted</span>' : ''; };
  const scBar = r => revealed(r) ? '' : `<span class="rc-sc" title="Scouted ${scoutedPct(r)}% — at 100% your staff knows if he's a gem or a bust"><i style="width:${scoutedPct(r)}%"></i></span>`;
  const NEED = needs(S, U), GL = { G: 'Guard', W: 'Wing', B: 'Big' };
  const pipe = r => { const v = pipeOf(S, U, r), t = pipeTier(v); return t ? ` <span class="rc-pipe" title="Your ${t.toLowerCase()} pipeline in ${r.home === 'INTL' ? 'international recruiting' : r.home}: +${Math.round(30 * v / 100)}% interest every week">${t} pipeline</span>` : ''; };
  const PL = pipelinesOf(S, U);
  const quick = r => { const p = plan[r.id] || {}; return `<span class="rc-q">${[['dm', 'DM'], ['call', 'Call'], ['scout', 'Scout']].map(([k, l]) => `<button class="${p[k] ? 'on' : ''}" data-act="${esc(r.id)}|${k}" ${k === 'scout' && revealed(r) ? 'disabled' : ''}>${l}</button>`).join('')}</span>`; };
  const mine = R.filter(r => r.list.includes(U) || r.cutUser || r.signed === U).sort((a, b) => (b.signed === U || b.commit === U) - (a.signed === U || a.commit === U) || userChance(S, b) - userChance(S, a));
  if (!sel && mine.length) sel = mine[0].id;
  const nextCut = Object.entries(cutWeeks).find(([, v]) => v > w);
  const need = classNeed(S, U), have = commitsOf(S, U).length, used = hoursUsed(S), bud = hoursBudget(S);
  const now = !nextCut ? 'commit' : nextCut[0] === 't8' ? 'open' : nextCut[0] === 't5' ? 't8' : 't5';

  // ── your board ──
  const boardRow = r => {
    const v = scoutView(S, r, r.vs || 0), ld = leader(r), rk = rankOf(r, U), ch = Math.round(100 * userChance(S, r));
    const ph = Math.min(HOURS_CAP, planHours(plan[r.id])), db = r.db && r.list.includes(U) && !passesDB(S, U, r);
    const dI = r.prevU != null && r.list.includes(U) ? (r.int[U] || 0) - r.prevU : null, dR = r.prevRk && r.list.includes(U) ? r.prevRk - rk : 0;
    return `<tr class="rc-row ${sel === r.id ? 'rc-sel' : ''}" data-sel="${esc(r.id)}"><td class="l"><b>${esc(r.name)}</b> ${stars(r.stars)}${scoutTag(r)}${battleOf(S, r) ? ' <span class="rc-flag" title="Neck and neck with one school — open him for the head-to-head">⚔ battle</span>' : ''}<div class="dim" style="font-size:11px">#${r.rank} · ${esc(v.tags.join(' · '))}</div>${r.list.includes(U) && !r.signed ? `<div style="margin-top:3px">${quick(r)} ${scBar(r)}</div>` : ''}</td>
      <td>${esc(r.pos || '')}</td><td><b>${v.ovr}</b></td><td class="l">${stage(r)}${db ? `<div class="rc-flag">dealbreaker: ${esc(dbLabel(r.db.k).toLowerCase())}</div>` : r.commit && r.commit !== U && r.list.includes(U) ? '<div class="rc-flag">flip him?</div>' : ''}</td>
      <td>${r.list.includes(U) ? `<b class="${rk === 1 ? 'up' : rk <= 3 ? '' : 'dn'}">${rk}${['th', 'st', 'nd', 'rd'][rk < 4 ? rk : 0]}</b> of ${r.list.length}${dR ? ` <span class="rc-dl ${dR > 0 ? 'up' : 'dn'}">${dR > 0 ? '▲' : '▼'}${Math.abs(dR)}</span>` : ''}${dI != null && dI > 0 ? `<div class="rc-dl dim">+${dI} this wk</div>` : ''}` : '—'}</td>
      <td class="l">${ld && ld !== U ? esc(short(ld)) : ld === U ? '<b class="up">You</b>' : '—'}</td><td><b>${r.list.includes(U) || r.signed === U ? ch + '%' : '—'}</b></td>
      <td>${r.list.includes(U) && !r.signed ? (ph ? `<b>${ph}</b>` : '<span class="dim">staff</span>') : ''}</td></tr>`;
  };

  // ── the selected recruit ──
  const detail = r => {
    if (!r) return `<div class="rc-box"><div class="dim">Offer recruits below — they appear on your board. Click one to work him.</div></div>`;
    profile(S, r);
    const v = scoutView(S, r, r.vs || 0), ord = r.list.slice().sort((a, b) => (r.int[b] || 0) - (r.int[a] || 0)), top = Math.max(1, ...ord.map(t => r.int[t] || 0));
    const nxt = nextCut && !r.commit && !r.signed ? { t8: 8, t5: 5, t3: 3 }[nextCut[0]] : null;
    const ld = ord.find(t => t !== U);
    const gu = r.list.includes(U) ? gradesFor(S, r, U) : null, gl = ld ? gradesFor(S, r, ld) : null;
    const wants = FACTORS.slice().sort((a, b) => r.w[b[0]] - r.w[a[0]]).slice(0, 5);
    const g = x => `<span class="rc-g rc-g${x.g[0]}">${x.g}</span>`;
    const p = plan[r.id] || {}, can = r.list.includes(U) && !r.signed;
    const V = visitsFor(S, r.id), off = V.find(x => x.type === 'official'), home = upcomingHomeGames(S);
    const inOpen = !r.list.includes(U) && !r.cutUser && !r.signed && r.stage === 'open';
    return `<div class="rc-box"><h3>${esc(r.name)}</h3>
      <div class="dim" style="font-size:12px;margin:2px 0 8px">${pipe(r)} ${stars(r.stars)} #${r.rank} · ${esc(r.pos || '')} · ${r.ht ? `${Math.floor(r.ht / 12)}-${r.ht % 12}` : ''} · ${esc(r.home === 'INTL' ? (r.country || 'International') : r.home || '')}
        · OVR <b>${v.ovr}</b> (±${v.sd}) · ceiling <b>${v.grade}</b>${scoutTag(r)} ${revealed(r) ? '' : `· scouted ${scoutedPct(r)}% ${scBar(r)}`} · academics ${acadGrade(r.acad ?? 60)} (${admitLabel(admitP(S, U, r, false))}) · asks ${m$(r.ask)}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${stage(r)}${nxt ? `<span class="dim" style="font-size:11.5px">cuts to a Top ${nxt} in ${Math.max(1, cutWeeks[nextCut[0]] - w)} week${cutWeeks[nextCut[0]] - w === 1 ? '' : 's'}</span>` : ''}
        ${inOpen ? `<button class="btn pg-sm" data-offer="${esc(r.id)}">Offer a scholarship</button>` : r.list.includes(U) && !r.signed ? `<button class="btn ghost pg-sm" data-pull="${esc(r.id)}">Pull offer</button>` : ''}</div>
      ${msg ? `<div class="rc-msg">${esc(msg)}</div>` : ''}
      <div style="margin-top:8px">${ord.map((t, i) => `${nxt && i === nxt ? '<div class="rc-cut">next cut</div>' : ''}<div class="rc-sch ${t === U ? 'me' : ''}"><span>${i + 1}</span><span>${team(t)}${r.commit === t ? ' ✓' : ''}</span><i><em style="width:${Math.round(100 * (r.int[t] || 0) / top)}%"></em></i><span style="text-align:right">${(r.int[t] || 0).toLocaleString()}</span></div>`).join('') || '<div class="dim">No offers yet.</div>'}</div>
      ${h2h(S, r, esc, short)}
      <div class="rc-gr"><span class="h">What he wants</span><span class="h">You</span><span class="h">${ld ? esc(short(ld)).slice(0, 6) : ''}</span><span class="h">Weight</span>
        ${wants.map(([k, l]) => `<span>${l}</span>${gu ? g(gu[k]) : '<span class="dim">—</span>'}${gl ? g(gl[k]) : '<span></span>'}<span class="dim">${'●'.repeat(Math.max(1, Math.round(r.w[k] * 12)))}</span>`).join('')}</div>
      ${r.db ? `<div class="rc-db"><b>Dealbreaker:</b> ${esc(dbLabel(r.db.k))} must be <b>${grade(r.db.min)} or better</b>${gu ? ` — you're <b class="${gu[r.db.k].x >= r.db.min ? 'up' : 'dn'}">${gu[r.db.k].g}</b>` : ''}. A school below it is cut no matter what.</div>` : ''}
      ${!can && !r.signed && !revealed(r) ? `<div style="margin-top:8px"><button class="rc-act ${(plan[r.id] || {}).scout ? 'on' : ''}" data-act="${esc(r.id)}|scout"><b>Scout him</b><span>10 h a week · no offer needed · reveals a gem or a bust</span></button></div>` : ''}
      ${can ? `<div class="dim" style="margin-top:10px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">This week · ${Math.min(HOURS_CAP, planHours(p))} / ${HOURS_CAP} h on him · repeats every week until you change it</div>
      <div class="rc-acts">${ACTIONS.map(([k, l, h, d]) => `<button class="rc-act ${p[k] ? 'on' : ''}" data-act="${esc(r.id)}|${k}" ${(k === 'home' && r.hv) || (k === 'scout' && revealed(r)) || ((k === 'soft' || k === 'hard') && !['t5', 't3', 'commit'].includes(r.stage)) ? 'disabled' : ''}><b>${l}</b><span>${h} h · ${d}</span></button>`).join('')}
        <div class="rc-act" style="cursor:default"><b>Official visit</b><span>${off ? (off.done ? `done · ${off.res}` : `${fmt(off.d)}${isBig(S, off.gid) ? ' · big weekend' : ''} <a href="#" data-cancel="${esc(r.id)}|${esc(off.gid)}">cancel</a>`) : `${visitsLeft(S)} left · <a href="#" data-pickv="${esc(r.id)}">pick a home game</a>`}</span></div></div>
      ${pickVisit && !off ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${home.slice(0, 10).map(gm => `<button class="btn ghost pg-sm" data-visit="${esc(r.id)}|${esc(gm.id)}">${fmt(gm.d)} vs ${esc(short(gm.a))}${isBig(S, gm.id) ? ' ★' : ''}</button>`).join('') || '<span class="dim">No home games left.</span>'}</div>` : ''}
      ${off && !off.done ? focusPicker(S, r, off, esc) : ''}
      ${off && off.done && off.parts ? `<div class="vs-parts">${off.parts.map(([l, x]) => `<span class="${x >= 0 ? 'up' : 'dn'}">${esc(l)} ${x >= 0 ? '+' : ''}${x.toFixed(2)}</span>`).join('')}</div>` : ''}
      <div style="margin-top:10px;font-size:12.5px"><b>NIL offer</b> <span class="dim">asks ${m$(r.ask)}/yr</span><div style="margin-top:4px">${moneyButtons('nil', r.id, r.ask, r.offer, esc)}</div>
        ${r.nilState === 'counter' ? `<button class="btn ghost pg-sm" data-takec="${esc(r.id)}">Take ${m$(r.counter)}</button>` : ''} <span class="rv-st ${r.nilState || ''}">${{ accepted: '✓ deal', counter: 'counter', low: 'lukewarm', insulted: 'insulted' }[r.nilState] || ''}</span>
        <span class="dim" style="font-size:11px">· money matters most once he's down to a Top 3</span></div>` : ''}
      <div class="rc-feed"><div class="dim" style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">His recruitment</div>${(r.feed || []).slice().reverse().slice(0, 8).map(f => `<div>${f.d ? `<b>${fmt(f.d)}</b> — ` : '<b>Summer</b> — '}${esc(f.text.replace(/\[\[(.+?)\]\]/g, (m, t) => short(t)))}</div>`).join('') || '<div class="dim">Nothing yet.</div>'}</div></div>`;
  };

  // ── find recruits ──
  const finds = R.filter(r => !r.list.includes(U) && !r.signed && !r.cutUser && (!onlyOpen || (r.stage === 'open' && !r.commit)) && r.stars >= minStars && (!pos || r.pos === pos) && (!needOnly || NEED[groupOf(r.pos)] > 0) && (!q || r.name.toLowerCase().includes(q))).slice(0, 120);
  const findRow = r => { const v = scoutView(S, r, r.vs || 0), ld = leader(r);
    return `<tr><td style="white-space:nowrap"><button class="btn ghost pg-sm" data-offer="${esc(r.id)}" ${r.stage !== 'open' ? 'disabled' : ''}>Offer</button> <span class="rc-q"><button class="${(plan[r.id] || {}).scout ? 'on' : ''}" data-act="${esc(r.id)}|scout" ${revealed(r) ? 'disabled' : ''}>Scout</button></span></td><td class="l"><a href="#" data-sel="${esc(r.id)}"><b>${esc(r.name)}</b></a> ${stars(r.stars)}${scoutTag(r)} ${scBar(r)}</td><td>${r.rank}</td><td>${esc(r.pos || '')}</td>
      <td>${r.ht ? `${Math.floor(r.ht / 12)}-${r.ht % 12}` : ''}</td><td><b>${v.ovr}</b></td><td>${v.grade}</td><td class="l dim">${esc(v.tags.join(' · '))}</td><td style="white-space:nowrap">${esc(r.home === 'INTL' ? (r.country || 'Intl') : r.home || '')}${pipe(r)}</td>
      <td class="${admitP(S, U, r, false) < 0.5 ? 'dn' : ''}">${admitLabel(admitP(S, U, r, false))}</td><td>${r.list.length}</td><td class="l">${stage(r)} ${ld ? esc(short(ld)) : ''}</td><td>${m$(r.ask)}</td></tr>`; };

  $('#dyBody').innerHTML = sub + `<div class="sec"><h2>Recruiting — class of ${S.year + 1}</h2><span class="n">Recruits only consider schools that offer them, narrow their lists on a schedule, commit to the school that pulls clear — and can flip until they sign.</span></div>
    <div class="rc-stages">${[['open', 'Open', 'Offers out · build interest'], ['t8', 'Top 8', 'Week 2 (mid-Nov)'], ['t5', 'Top 5', 'Week 6 · pitches unlock'], ['t3', 'Top 3', 'Week 10 · NIL matters most'], ['commit', 'Committed', 'Soft — can still flip'], ['signed', 'Signed', 'Nov 18 or signing day · final']].map(([k, l, d]) => `<div class="${k === now ? 'now' : ''}"><b>${l}</b>${d}</div>`).join('')}</div>
    <div class="rc-bud"><div><span>Hours this week</span><b>${used} / ${bud}</b></div><div class="rc-bar"><i style="width:${Math.min(100, Math.round(100 * used / Math.max(1, bud)))}%"></i></div>
      <div><span>Class</span><b>${have} / ${need}</b></div><div><span>Offers out</span><b>${R.filter(r => r.list.includes(U) && !r.signed).length} / ${USER_OFFERS_MAX}</b></div>
      <div><span>Official visits</span><b>${visitsLeft(S)} / ${officialMax(S)}</b></div><div><span>NIL promised</span><b>${m$(committedNIL(S))}</b></div>
      <div><span>Needs next year</span><span class="rc-need">${Object.entries(NEED).map(([k, n]) => `<span class="${n ? '' : 'ok'}">${n} ${GL[k]}${n === 1 ? '' : 's'}</span>`).join('')}</span></div>
      <div><span>Week</span><b>${wk ? wk : 'Summer'}</b></div></div>
    <div class="rc-pipes"><b>Your pipelines</b>${PL.length ? PL.map(([k, v, t]) => `<span class="rc-pipe" title="+${Math.round(30 * v / 100)}% interest with recruits from here">${k === 'INTL' ? 'International' : k} · ${t}</span>`).join('') : '<span class="dim">none yet — every signing builds one in his home state</span>'}</div>
    <div class="pg-d" style="margin:-4px 0 10px">Hours you don't assign, your staff spends for you (${{ rookie: 'all of them', pro: 'half', aa: 'a quarter', hof: 'none' }[S.diff || 'pro']} on this difficulty). Scouting accuracy ±${scoutSD(S, 0).toFixed(1)}.</div>
    <div class="rc-cols"><div><div class="sheet-wrap"><table class="sheet dense rc-board" data-fit-keep><thead><tr><th class="l">Your board</th><th>Pos</th><th>OVR</th><th class="l">Stage</th><th>You</th><th class="l">Leader</th><th title="Your chance he signs with you if signing day were today">Chance</th><th title="Your hours on him this week (staff = your staff covers him)">Hrs</th></tr></thead>
      <tbody>${mine.map(boardRow).join('') || '<tr><td colspan="8" class="dim l">No offers out — find recruits below.</td></tr>'}</tbody></table></div></div>
      <div id="rcDetail">${detail(R.find(r => r.id === sel))}</div></div>
    <div class="sec" style="margin-top:18px"><h2>Find recruits</h2><span class="n">Offer while he's still open — once he cuts to a Top 8 it's too late.</span></div>
    <div class="dy-row"><input id="rvQ" class="dy-input" placeholder="Search recruits…" value="${esc(q)}">
      <select id="rvPos" class="dy-input"><option value="">All positions</option>${['PG', 'SG', 'SF', 'PF', 'C'].map(p => `<option ${p === pos ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <select id="rvStars" class="dy-input">${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${n === minStars ? 'selected' : ''}>${n}★ +</option>`).join('')}</select>
      <label class="cal-chk"><input type="checkbox" id="rvOpen" ${onlyOpen ? 'checked' : ''}> Still open only</label>
      <label class="cal-chk"><input type="checkbox" id="rvNeed" ${needOnly ? 'checked' : ''}> Fits a need</label></div>
    <div class="sheet-wrap"><table class="sheet dense rc-find" data-fit-keep><thead><tr><th></th><th class="l">Recruit</th><th>#</th><th>Pos</th><th>Ht</th><th>OVR</th><th>Ceil.</th><th class="l">Skills</th><th>From</th><th>Admits?</th><th title="Schools that have offered him">Offers</th><th class="l">Status</th><th>Ask</th></tr></thead>
      <tbody>${finds.map(findRow).join('')}</tbody></table></div>`;
  bind(ctx);
}

function bind(ctx) {
  const S = ctx.get(), $ = ctx.$;
  const again = m => { msg = m || ''; ctx.autosave(); recruitingView(ctx); };
  document.querySelectorAll('[data-sel]').forEach(el => el.onclick = e => { e.preventDefault(); sel = el.dataset.sel; msg = ''; pickVisit = false; rv = 'board'; recruitingView(ctx);
    // on a phone the detail sits under the whole board: take him there
    const d = document.getElementById('rcDetail'); if (d && window.innerWidth <= 1000) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  document.querySelectorAll('[data-offer]').forEach(b => b.onclick = e => { e.stopPropagation(); const err = offerRecruit(S, b.dataset.offer); if (!err) sel = b.dataset.offer; again(err); });
  document.querySelectorAll('[data-pull]').forEach(b => b.onclick = () => { if (confirm('Pull your offer? He drops you from his list.')) { withdrawOffer(S, b.dataset.pull); again('Offer pulled.'); } });
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = e => { e.stopPropagation(); const [rid, k] = b.dataset.act.split('|'); again(toggleAction(S, rid, k)); });
  document.querySelectorAll('[data-rv]').forEach(b => b.onclick = () => { rv = b.dataset.rv; recruitingView(ctx); });
  document.querySelectorAll('[data-pickv]').forEach(a => a.onclick = e => { e.preventDefault(); pickVisit = !pickVisit; recruitingView(ctx); });
  document.querySelectorAll('[data-visit]').forEach(b => b.onclick = () => { const [rid, gid] = b.dataset.visit.split('|'); pickVisit = false; again(scheduleOfficial(S, rid, gid) || 'Official visit scheduled.'); });
  document.querySelectorAll('[data-vfocus]').forEach(b => b.onclick = () => { const [rid, gid, k] = b.dataset.vfocus.split('|'); setFocus(S, rid, gid, k); again('Visit focus set.'); });
  document.querySelectorAll('[data-big]').forEach(b => b.onclick = () => { again(toggleBig(S, b.dataset.big) || ''); });
  document.querySelectorAll('[data-cancel]').forEach(a => a.onclick = e => { e.preventDefault(); const [rid, gid] = a.dataset.cancel.split('|'); cancelVisit(S, rid, gid); again('Visit cancelled.'); });
  document.querySelectorAll('[data-nil]').forEach(b => b.onclick = () => {
    const [rid, amt] = b.dataset.nil.split('|'), r = (S.rclass || []).find(x => x.id === rid); if (!r) return;
    const P = S.teams[S.user].prog, others = committedNIL(S) - (r.nilState === 'accepted' ? r.offer : 0);
    if (P && others + (+amt || 0) > P.nil.fund) return again(`Your collective has $${P.nil.fund}k; $${others}k is already promised.`);
    again(negotiate(S, r, +amt).msg);
  });
  document.querySelectorAll('[data-takec]').forEach(b => b.onclick = () => { const r = (S.rclass || []).find(x => x.id === b.dataset.takec); if (r) acceptCounter(S, r); again(r ? `${r.name} accepts.` : ''); });
  if (!$('#rvQ')) return;
  $('#rvQ').oninput = e => { q = e.target.value.toLowerCase().trim(); clearTimeout(bind.t); bind.t = setTimeout(() => { recruitingView(ctx); const i = $('#rvQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
  $('#rvPos').onchange = e => { pos = e.target.value; recruitingView(ctx); };
  $('#rvStars').onchange = e => { minStars = +e.target.value; recruitingView(ctx); };
  $('#rvOpen').onchange = e => { onlyOpen = e.target.checked; recruitingView(ctx); };
  $('#rvNeed').onchange = e => { needOnly = e.target.checked; recruitingView(ctx); };
}

// ── national class rankings (stars squared over commits + signees) ──
function ranksHtml(ctx) {
  const S = ctx.get(), { esc, tm } = ctx, CR = classRanks(S), me = CR.find(x => x.team === S.user);
  const rows = CR.slice(0, 40).concat(me && me.rank > 40 ? [me] : []);
  return `<div class="sec"><h2>Class rankings — ${S.year + 1}</h2><span class="n">Commits + signees, scored by stars (a 5★ is worth 25, a 4★ 16…)${me ? ` · you're <b>#${me.rank}</b>` : ' · no commits yet'}</span></div>
    <div class="sheet-wrap"><table class="sheet dense"><thead><tr><th>#</th><th class="l">Program</th><th>Commits</th><th>5★</th><th>4★</th><th>Points</th></tr></thead><tbody>
    ${rows.map(x => `<tr class="${x.team === S.user ? 'me' : ''}"><td>${x.rank}</td><td class="l">${tm(x.team)}</td><td>${x.n}</td><td>${x.five || ''}</td><td>${x.four || ''}</td><td><b>${x.pts}</b></td></tr>`).join('')}</tbody></table></div>`;
}
// ── the top 100 tracker: where every elite recruit stands ──
function topHtml(ctx) {
  const S = ctx.get(), { esc, short } = ctx, U = S.user;
  const R = (S.rclass || []).slice().sort((a, b) => a.rank - b.rank).slice(0, 100);
  const st = r => { const ord = r.list.slice().sort((a, b) => (r.int[b] || 0) - (r.int[a] || 0)), nm = t => (t === U ? '<b class="up">You</b>' : esc(short(t)));
    return r.signed ? `<b>Signed</b> · ${nm(r.signed)}` : r.commit ? `<b>Committed</b> · ${nm(r.commit)}` : r.list.length ? `${STAGE_LABEL[r.stage]}: ${ord.slice(0, 3).map(nm).join(', ')}${ord.length > 3 ? '…' : ''}` : '<span class="dim">No offers</span>'; };
  return `<div class="sec"><h2>Top 100 tracker</h2><span class="n">The nation's best recruits — commitments, flips and who's still in it</span></div>
    <div class="sheet-wrap"><table class="sheet dense"><thead><tr><th>#</th><th class="l">Recruit</th><th>Pos</th><th>From</th><th>Offers</th><th class="l">Status</th></tr></thead><tbody>
    ${R.map(r => `<tr class="${(r.signed || r.commit) === U ? 'me' : ''}"><td>${r.rank}</td><td class="l"><a href="#" data-sel="${esc(r.id)}"><b>${esc(r.name)}</b></a> ${'★'.repeat(r.stars)}${r.list.includes(U) && !(r.signed || r.commit) ? ' <span class="chip">you offered</span>' : ''}</td><td>${esc(r.pos || '')}</td>
      <td>${esc(r.home === 'INTL' ? (r.country || 'Intl') : r.home || '')}</td><td>${r.list.length}</td><td class="l">${st(r)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ── visit focus: what you show him on his official visit (the ★ = the best match for what he values) ──
function focusPicker(S, r, v, esc) {
  const f = facOf(S, S.user, r, r.offer || 0, relOf(S, r, 0));
  const score = k => (r.w[k] || 0) * (f[k] - 0.5);
  const best = VISIT_FOCUS.slice().sort((a, b) => score(b[0]) - score(a[0]))[0][0];
  return `<div class="dim" style="margin-top:8px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">Visit focus — what you show him${v.focus ? '' : ' · <span class="dn">not set</span>'}</div>
    <div class="vs-focus">${VISIT_FOCUS.map(([k, l, d]) => `<button class="${v.focus === k ? 'on' : ''}" data-vfocus="${esc(r.id)}|${esc(v.gid)}|${k}"><b>${l}${k === best ? ' ★' : ''}</b><span>${d}</span></button>`).join('')}</div>`;
}
// ── visits: your upcoming home games as visit weekends + what past visits earned ──
function visitsHtml(ctx) {
  const S = ctx.get(), { esc, tm, short } = ctx, U = S.user, R = S.rclass || [];
  const fmt = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const pw = power(S), order = Object.keys(pw).sort((a, b) => pw[b] - pw[a]);
  const home = upcomingHomeGames(S).slice(0, 14), V = S.visits || [];
  const rec = id => R.find(r => r.id === id);
  const bigN = (S.bigW || []).length;
  const game = g => {
    const opp = g.a, rk = order.indexOf(opp) + 1, sp = lineFor(S, g, pw), win = Math.round(100 / (1 + Math.exp(-sp / 6.5)));
    const rival = (S.rivals || []).some(([a, b]) => (a === g.h && b === g.a) || (a === g.a && b === g.h)), big = isBig(S, g.id);
    const guests = V.filter(v => v.gid === g.id), cap = big ? 6 : 3;
    const tags = [rk && rk <= 25 ? `#${rk} opponent` : null, rival ? 'Rivalry' : null, g.c ? 'League game' : null].filter(Boolean);
    return `<div class="vs-g ${big ? 'big' : ''}"><div class="vs-gh"><div><b>${fmt(g.d)}</b> · vs ${tm(opp)} <span class="vs-tags">${tags.map(t => `<span>${t}</span>`).join('')}</span></div>
      <div><span class="dim">win ${win}% · ${guests.length}/${cap} recruits</span> <button class="btn ${big ? '' : 'ghost'} pg-sm" data-big="${esc(g.id)}" ${!big && bigN >= BIG_MAX ? 'disabled' : ''}>${big ? '★ Big weekend' : 'Make it a big weekend'}</button></div></div>
      ${guests.length ? `<div style="margin-top:6px;font-size:12.5px">${guests.map(v => { const r = rec(v.rid); return r ? `<a href="#" data-sel="${esc(r.id)}"><b>${esc(r.name)}</b></a> ${'★'.repeat(r.stars)} · ${v.focus ? esc((VISIT_FOCUS.find(x => x[0] === v.focus) || [0, ''])[1]) : '<span class="dn">no focus set</span>'}` : ''; }).join(' &nbsp;·&nbsp; ')}</div>` : '<div class="dim" style="font-size:12px;margin-top:4px">No visitors yet — schedule one from a recruit on your board.</div>'}</div>`;
  };
  const past = V.filter(v => v.done && v.type === 'official').slice().reverse();
  return `<div class="sec"><h2>Visit weekends</h2><span class="n">${visitsLeft(S)} official visits left · ${BIG_MAX - bigN} big weekend${BIG_MAX - bigN === 1 ? '' : 's'} left (6 recruits instead of 3 — they bond, but a loss hits all of them)</span></div>
    <div class="pg-d" style="margin-bottom:8px">A win sells; a ranked opponent, a rivalry and a league game sell more; your arena and crowd count. Pick each visit's focus to match what that recruit values — and where you're strong.</div>
    ${home.map(game).join('') || '<div class="dim">No home games left this season.</div>'}
    ${past.length ? `<div class="sec"><h2>How visits went</h2></div>${past.map(v => { const r = rec(v.rid), g = S.schedule.find(x => x.id === v.gid); return r ? `<div class="vs-g"><div class="vs-gh"><div><b>${esc(r.name)}</b> ${'★'.repeat(r.stars)} · ${g ? `${fmt(g.d)} vs ${esc(short(g.a))}` : ''}</div><b class="${v.gain >= 0.3 ? 'up' : v.gain > 0 ? '' : 'dn'}">${{ great: 'Loved it', good: 'Enjoyed it', meh: 'Lukewarm', bad: 'Unimpressed' }[v.res] || ''}</b></div>
      ${v.parts ? `<div class="vs-parts">${v.parts.map(([l, x]) => `<span class="${x >= 0 ? 'up' : 'dn'}">${esc(l)} ${x >= 0 ? '+' : ''}${x.toFixed(2)}</span>`).join('')}</div>` : ''}</div>` : ''; }).join('')}` : ''}`;
}

// ── the head-to-head panel ──
function h2h(S, r, esc, short) {
  const B = battleOf(S, r); if (!B) return '';
  const U = S.user, them = esc(short(B.rival)), top = Math.max(B.you, B.them, 1);
  const LBL = { prox: 'Close to home', pt: 'Playing time', rel: 'Relationships', draft: 'Draft path', team: 'Winning now', brand: 'Brand', nil: 'NIL money', acad: 'Academics' };
  const g = x => (x >= 0.9 ? 'A+' : x >= 0.82 ? 'A' : x >= 0.75 ? 'A-' : x >= 0.68 ? 'B+' : x >= 0.6 ? 'B' : x >= 0.53 ? 'B-' : x >= 0.46 ? 'C+' : x >= 0.38 ? 'C' : x >= 0.3 ? 'C-' : x >= 0.2 ? 'D' : 'F');
  const mx = Math.max(0.05, ...B.edges.map(e => Math.abs(e.d)));
  const pace = B.weeks == null ? '' : B.weeks === Infinity ? (B.lead ? 'You are pulling away at this pace.' : `${them} is pulling away — you need more.`) : B.lead ? `At this week's pace ${them} catches you in about ${B.weeks} week${B.weeks === 1 ? '' : 's'}.` : `At this week's pace you pass ${them} in about ${B.weeks} week${B.weeks === 1 ? '' : 's'}.`;
  const d = x => (x == null ? '' : `<span class="dim">${x >= 0 ? '+' : ''}${x}</span>`);
  return `<div class="h2h"><div class="h2h-h"><span>⚔ Head to head vs ${them}</span><span class="${B.lead ? 'up' : 'dn'}">${B.lead ? 'You lead' : 'You trail'} by ${Math.abs(B.you - B.them).toLocaleString()}</span></div>
    <div class="h2h-race"><b>You</b><i><em style="width:${Math.round(100 * B.you / top)}%;background:var(--accent,#c9a227)"></em></i><span>${B.you.toLocaleString()}</span>${d(B.dYou)}
      <b>${them}</b><i><em style="width:${Math.round(100 * B.them / top)}%;background:#8a8f99"></em></i><span>${B.them.toLocaleString()}</span>${d(B.dThem)}</div>
    ${pace ? `<div class="dim" style="font-size:12px;margin-top:4px">${pace}</div>` : ''}
    <div class="dim" style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-top:8px">Where it's won — weighted by what he cares about</div>
    ${B.edges.filter(e => e.w >= 0.05).slice(0, 6).map(e => `<div class="h2h-e"><span>${LBL[e.k] || e.k}</span><span class="h2h-bar"><em style="${e.d >= 0 ? 'left:50%' : `right:50%`};width:${Math.round(50 * Math.abs(e.d) / mx)}%;background:${e.d >= 0 ? 'var(--green,#1a8c3a)' : 'var(--red,#cc2200)'}"></em></span><b>${g(e.you)}</b><span class="dim">${g(e.them)}</span></div>`).join('')}
    <div class="dim" style="font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-top:8px">Moves that swing it</div>
    <ol class="h2h-m">${B.moves.map(m => `<li>${esc(m.txt)}${m.v != null ? ` <span class="up">+${m.v.toFixed(2)}</span>` : ''}</li>`).join('')}</ol></div>`;
}
