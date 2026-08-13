// Dynamic 1200×630 Open Graph image for a Transfer Fit Report — rendered with @vercel/og.
// .mjs (ESM) so it coexists with the CommonJS Node functions in /api. Builds the image tree as
// PLAIN OBJECTS (no JSX → no tsconfig/--jsx flag needed). og-transfer.js points og:image here.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
const KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const GOLD = '#E6D5A8', BG = '#141416', W = '#F1EFEA', MUT = '#8A867A', BLUE = '#7da2f0';

// element helpers — Satori accepts React-element-shaped plain objects {type, props:{style, children}}
const div = (style, children) => ({ type: 'div', props: children === undefined ? { style } : { style, children } });
const img = (src, w, h) => ({ type: 'img', props: { src, width: w, height: h, style: { objectFit: 'contain' } } });

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

  let origLogo = '', destLogo = '', destName = team, origName = origin;
  try {
    const tc = await (await fetch(new URL('/scripts/data/team_colors.json', req.url).toString())).json();
    const find = (nm) => tc.find((x) => (x.location || '').toLowerCase() === (nm || '').toLowerCase());
    const d = find(team), o = find(origin);
    if (d) { destLogo = d.logo || ''; destName = d.display || team; }
    if (o) { origLogo = o.logo || ''; origName = o.display || origin; }
  } catch (e) { /* no logos */ }

  const meta = [pos, cls].filter(Boolean).join('  ·  ');

  const logos = [];
  logos.push(origLogo ? img(origLogo, 120, 120) : div({ display: 'flex', fontSize: '38px', fontWeight: 700, color: W }, origName || '—'));
  logos.push(div({ display: 'flex', fontSize: '60px', color: GOLD, marginLeft: '40px', marginRight: '40px' }, '→'));
  if (destLogo) logos.push(img(destLogo, 152, 152));
  logos.push(div({ display: 'flex', flexDirection: 'column', marginLeft: '30px' }, [
    div({ display: 'flex', fontSize: '22px', letterSpacing: '3px', color: MUT }, 'NEW HOME'),
    div({ display: 'flex', fontSize: '48px', fontWeight: 700, color: W, marginTop: '4px' }, destName || '—')
  ]));

  const tree = div(
    { width: '1200px', height: '630px', display: 'flex', flexDirection: 'column', backgroundColor: BG, padding: '66px 72px', fontFamily: 'sans-serif' },
    [
      div({ display: 'flex', position: 'absolute', top: '0px', left: '0px', width: '1200px', height: '10px', backgroundColor: GOLD }),
      div({ display: 'flex', fontSize: '31px', fontWeight: 700 }, [
        div({ display: 'flex', color: W }, 'The Depth'),
        div({ display: 'flex', color: BLUE, marginLeft: '10px' }, 'Chart')
      ]),
      div({ display: 'flex', fontSize: '25px', fontWeight: 700, letterSpacing: '4px', color: GOLD, marginTop: '58px' }, 'TRANSFER FIT REPORT'),
      div({ display: 'flex', fontSize: '78px', fontWeight: 800, color: W, marginTop: '12px' }, pname || 'Transfer Fit'),
      div({ display: 'flex', fontSize: '27px', color: MUT, marginTop: '8px' }, meta),
      div({ display: 'flex', alignItems: 'center', marginTop: '58px' }, logos)
    ]
  );

  return new ImageResponse(tree, { width: 1200, height: 630 });
}
