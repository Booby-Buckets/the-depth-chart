// Dynamic 1200×630 Open Graph image for a Transfer Fit Report — rendered with @vercel/og
// (Satori). og-transfer.js points og:image here; X/Twitter fetches it as the card image.
// Shows the player, origin → destination team logos, and brand. No build step needed beyond
// package.json's @vercel/og dependency. Any data-fetch error → a clean branded fallback card.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SB = 'https://izlqhnxowdhtdofkwrho.supabase.co';
const KEY = 'sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye';
const GOLD = '#E6D5A8', BG = '#141416', W = '#F1EFEA', MUT = '#8A867A', BLUE = '#7da2f0';

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const espn = (searchParams.get('espn') || '').trim();
  const nameParam = (searchParams.get('name') || '').trim();

  let pname = nameParam, team = '', origin = '', pos = '', cls = '';
  try {
    const q = espn ? 'espn_id=eq.' + encodeURIComponent(espn) : 'name=eq.' + encodeURIComponent(nameParam);
    const rows: any = await (await fetch(SB + '/rest/v1/players?' + q + '&select=name,team,hometown,position,class_year&limit=1',
      { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } })).json();
    if (rows && rows[0]) { pname = rows[0].name || pname; team = rows[0].team || ''; origin = (rows[0].hometown || '').trim(); pos = rows[0].position || ''; cls = rows[0].class_year || ''; }
  } catch (e) { /* fallback */ }

  let origLogo = '', destLogo = '', destName = team, origName = origin;
  try {
    const tc: any = await (await fetch(new URL('/scripts/data/team_colors.json', req.url).toString())).json();
    const find = (nm: string) => tc.find((x: any) => (x.location || '').toLowerCase() === (nm || '').toLowerCase());
    const d = find(team), o = find(origin);
    if (d) { destLogo = d.logo || ''; destName = d.display || team; }
    if (o) { origLogo = o.logo || ''; origName = o.display || origin; }
  } catch (e) { /* no logos */ }

  const meta = [pos, cls].filter(Boolean).join('  ·  ');

  return new ImageResponse(
    (
      <div style={{ width: '1200px', height: '630px', display: 'flex', flexDirection: 'column', backgroundColor: BG, padding: '66px 72px', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', position: 'absolute', top: '0px', left: '0px', width: '1200px', height: '10px', backgroundColor: GOLD }} />
        <div style={{ display: 'flex', fontSize: '31px', fontWeight: 700 }}>
          <div style={{ display: 'flex', color: W }}>The Depth</div>
          <div style={{ display: 'flex', color: BLUE, marginLeft: '10px' }}>Chart</div>
        </div>
        <div style={{ display: 'flex', fontSize: '25px', fontWeight: 700, letterSpacing: '4px', color: GOLD, marginTop: '58px' }}>TRANSFER FIT REPORT</div>
        <div style={{ display: 'flex', fontSize: '78px', fontWeight: 800, color: W, marginTop: '12px' }}>{pname || 'Transfer Fit'}</div>
        <div style={{ display: 'flex', fontSize: '27px', color: MUT, marginTop: '8px' }}>{meta}</div>
        <div style={{ display: 'flex', alignItems: 'center', marginTop: '60px' }}>
          {origLogo
            ? <img src={origLogo} width={120} height={120} style={{ objectFit: 'contain' }} />
            : <div style={{ display: 'flex', fontSize: '38px', fontWeight: 700, color: W }}>{origName || '—'}</div>}
          <div style={{ display: 'flex', fontSize: '64px', color: GOLD, marginLeft: '38px', marginRight: '38px' }}>→</div>
          {destLogo ? <img src={destLogo} width={152} height={152} style={{ objectFit: 'contain' }} /> : null}
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: '30px' }}>
            <div style={{ display: 'flex', fontSize: '22px', letterSpacing: '3px', color: MUT }}>NEW HOME</div>
            <div style={{ display: 'flex', fontSize: '48px', fontWeight: 700, color: W, marginTop: '4px' }}>{destName || '—'}</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
