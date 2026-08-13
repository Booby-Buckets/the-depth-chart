// Dynamic 1200×630 Open Graph image for a Transfer Fit Report — rendered with @vercel/og.
// .mjs (ESM) so it coexists with the CommonJS Node functions in /api. Builds the image tree as
// PLAIN OBJECTS (no JSX → no tsconfig/--jsx flag needed). The card is themed to the DESTINATION
// team's real color (c1): accent bar, eyebrow pill, arrow, faint logo watermark and new-home name.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
const KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const GOLD = '#E6D5A8', BG = '#131318', W = '#F4F2ED', MUT = '#8F8B80', BLUE = '#7da2f0';

// element helpers — Satori accepts React-element-shaped plain objects {type, props:{style, children}}
const div = (style, children) => ({ type: 'div', props: children === undefined ? { style } : { style, children } });
const img = (src, w, h, style) => ({ type: 'img', props: { src, width: w, height: h, style: Object.assign({ objectFit: 'contain' }, style || {}) } });

// --- color helpers (theme the card to the destination team) ---
function hexToRgb(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h || '0', 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
function mixWhite(c, f) { return [Math.round(c[0] + (255 - c[0]) * f), Math.round(c[1] + (255 - c[1]) * f), Math.round(c[2] + (255 - c[2]) * f)]; }
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }
function readableOnDark(c) { let x = c.slice(), i = 0; while (lum(x) < 0.36 && i < 6) { x = mixWhite(x, 0.2); i++; } return x; }

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const espn = (searchParams.get('espn') || '').trim();
  const nameParam = (searchParams.get('name') || '').trim();

  let pname = nameParam, team = '', origin = '', pos = '', cls = '';
  try {
    const q = espn ? 'espn_id=eq.' + encodeURIComponent(espn) : 'name=eq.' + encodeURIComponent(nameParam);
    const rows = await (await fetch(SB + '/rest/v1/players?' + q + '&select=name,team,hometown,position,class_year&limit=1',
      { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json();
    if (rows && rows[0]) { pname = rows[0].name || pname; team = rows[0].team || ''; origin = (rows[0].hometown || '').trim(); pos = rows[0].position || ''; cls = rows[0].class_year || ''; }
  } catch (e) { /* fallback card */ }

  let origLogo = '', destLogo = '', destName = team, origName = origin, c1 = '';
  try {
    const tc = await (await fetch(new URL('/scripts/data/team_colors.json', req.url).toString())).json();
    const find = (nm) => tc.find((x) => (x.location || '').toLowerCase() === (nm || '').toLowerCase());
    const d = find(team), o = find(origin);
    if (d) { destLogo = d.logo || ''; destName = d.display || team; c1 = d.c1 || ''; }
    if (o) { origLogo = o.logo || ''; origName = o.display || origin; }
  } catch (e) { /* no logos */ }

  // Destination team color drives the whole card; fall back to brand gold if unknown.
  const teamed = !!c1;
  const acc = teamed ? hexToRgb(c1) : hexToRgb(GOLD);
  const accent = rgb(acc);
  const accentText = rgb(readableOnDark(acc));
  const pillText = lum(acc) > 0.62 ? '#131318' : '#FFFFFF';

  const meta = [pos, cls].filter(Boolean).join('   ·   ');

  const kids = [];

  // faint destination-logo watermark bleeding off the right edge
  if (destLogo) kids.push(img(destLogo, 660, 660, { position: 'absolute', top: '5px', right: '-150px', opacity: 0.14 }));
  // colored wash from the right so the team color reads even behind the watermark
  kids.push(div({ position: 'absolute', top: '0px', right: '0px', width: '620px', height: '630px', backgroundImage: 'linear-gradient(90deg, rgba(0,0,0,0) 0%, ' + rgba(acc, 0.14) + ' 100%)' }));
  // top accent bar
  kids.push(div({ position: 'absolute', top: '0px', left: '0px', width: '1200px', height: '12px', backgroundColor: accent }));

  // eyebrow pill in the team color
  const eyebrow = div({ display: 'flex', marginTop: '52px' }, [
    div({ display: 'flex', backgroundColor: accent, color: pillText, fontSize: '23px', fontWeight: 700, letterSpacing: '4px', padding: '11px 22px', borderRadius: '8px' }, 'TRANSFER FIT REPORT')
  ]);

  // bottom origin → destination row
  const logos = [];
  logos.push(origLogo ? img(origLogo, 104, 104) : div({ display: 'flex', fontSize: '34px', fontWeight: 700, color: W }, origName || '—'));
  logos.push(div({ display: 'flex', fontSize: '58px', fontWeight: 700, color: accentText, marginLeft: '34px', marginRight: '34px' }, '→'));
  if (destLogo) logos.push(img(destLogo, 150, 150));
  logos.push(div({ display: 'flex', flexDirection: 'column', marginLeft: '28px' }, [
    div({ display: 'flex', fontSize: '21px', fontWeight: 700, letterSpacing: '3px', color: MUT }, 'NEW HOME'),
    div({ display: 'flex', fontSize: '46px', fontWeight: 800, color: accentText, marginTop: '4px' }, destName || '—')
  ]));

  const content = div({ display: 'flex', flexDirection: 'column', padding: '60px 72px', position: 'relative' }, [
    div({ display: 'flex', fontSize: '31px', fontWeight: 700 }, [
      div({ display: 'flex', color: W }, 'The Depth'),
      div({ display: 'flex', color: BLUE, marginLeft: '10px' }, 'Chart')
    ]),
    eyebrow,
    div({ display: 'flex', fontSize: '80px', fontWeight: 800, color: W, marginTop: '20px', maxWidth: '840px', lineHeight: 1.02 }, pname || 'Transfer Fit'),
    div({ display: 'flex', fontSize: '27px', fontWeight: 600, color: MUT, marginTop: '10px' }, meta),
    div({ display: 'flex', alignItems: 'center', marginTop: '52px' }, logos)
  ]);

  const tree = div(
    { width: '1200px', height: '630px', display: 'flex', flexDirection: 'column', backgroundColor: BG, position: 'relative', overflow: 'hidden', fontFamily: 'sans-serif' },
    [...kids, content]
  );

  return new ImageResponse(tree, { width: 1200, height: 630 });
}
