#!/usr/bin/env python3
"""Program SPENDING POWER for 2026-27 basketball rosters (owner, Oct 2026: "calculate NIL numbers and team salaries
and spending — the House settlement isn't being followed", so the cap can't be the budget).

Signal: the U.S. Department of Education's EADA filings (Equity in Athletics, every school, public and private) —
2024-25 men's basketball expenses + revenue and total athletics revenue. That is what a school already pours into
basketball, the best public read on what it can put toward a roster. Spread WITHIN a conference by
(basketball expenses^0.75 x department revenue^0.25)^1.5, scaled so each conference averages its reported 2026-27
level (2025-26 reported averages SEC 9.7 / Big 12 8.6 / Big Ten 8.5 / ACC 8.2 x ~1.25 growth; mid-majors ~2-4,
low-majors ~0.5-1.8) — about $1.25B across D-I. tdc-nil.js then blends this with the roster each program actually
assembled (collective money doesn't show up in 2024-25 accounts) to get the spending power the site shows.

    # download https://ope.ed.gov/athletics -> EADA_2024-2025.zip, unzip it into a folder, then:
    python3 scripts/build_nil_budgets.py <unzipped EADA folder>      # -> scripts/data/nil_budgets.json

Service academies (Air Force, Army, Navy) and schools new to D-I that don't file EADA (New Haven, Southern Indiana,
West Florida) get their conference's median.
"""
import json, re, sys, os, statistics as st, urllib.request, pathlib
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'scripts' / 'data' / 'nil_budgets.json'
A, G = 0.75, 1.5
CONF = {'SEC':12.0,'BIG-12':10.8,'B10':10.6,'ACC':10.2,'Big-East':9.5,'PAC-12':4.0,'AAC':3.2,'A10':3.0,'MWC':3.0,'WCC':2.4,'MVC':1.8,'CUSA':1.4,'MAC':1.4,'Sun Belt':1.4,'CAA':1.4,'Big West':1.3,'Horizon':1.1,'SoCon':1.1,'UAC':1.0,'Ivy':1.0,'Big Sky':0.9,'Southland':0.8,'ASUN':0.9,'Summit':0.9,'Patriot':0.9,'MAAC':0.8,'AEC':0.7,'Big South':0.8,'OVC':0.6,'NEC':0.5,'MEAC':0.5,'SWAC':0.5}
ALIAS={'App State Mountaineers':'Appalachian State University','BYU Cougars':'Brigham Young University','Cal Poly Mustangs':'California Polytechnic State University-San Luis Obispo',
 'Cal State Bakersfield Roadrunners':'California State University-Bakersfield','Cal State Fullerton Titans':'California State University-Fullerton','Cal State Northridge Matadors':'California State University-Northridge',
 'IU Indianapolis Jaguars':'Indiana University-Indianapolis','LSU Tigers':'Louisiana State University and Agricultural & Mechanical College','NC State Wolfpack':'North Carolina State University at Raleigh',
 'NJIT Highlanders':'New Jersey Institute of Technology','Ole Miss Rebels':'University of Mississippi','Presbyterian Blue Hose':'Presbyterian College','SE Louisiana Lions':'Southeastern Louisiana University',
 'SIU Edwardsville Cougars':'Southern Illinois University Edwardsville','SMU Mustangs':'Southern Methodist University','TCU Horned Frogs':'Texas Christian University','UAB Blazers':'University of Alabama at Birmingham',
 'UAlbany Great Danes':'University at Albany','UC Davis Aggies':'University of California-Davis','UC Irvine Anteaters':'University of California-Irvine','UC Riverside Highlanders':'University of California-Riverside',
 'UC San Diego Tritons':'University of California-San Diego','UC Santa Barbara Gauchos':'University of California-Santa Barbara','UCF Knights':'University of Central Florida','UCLA Bruins':'University of California-Los Angeles',
 'UConn Huskies':'University of Connecticut','UIC Flames':'University of Illinois Chicago','UL Monroe Warhawks':'University of Louisiana at Monroe','UMBC Retrievers':'University of Maryland-Baltimore County',
 'UMass Lowell River Hawks':'University of Massachusetts-Lowell','UNC Asheville Bulldogs':'University of North Carolina Asheville','UNC Greensboro Spartans':'University of North Carolina at Greensboro',
 'UNC Wilmington Seahawks':'University of North Carolina Wilmington','UNLV Rebels':'University of Nevada-Las Vegas','USC Trojans':'University of Southern California','UT Arlington Mavericks':'The University of Texas at Arlington',
 'UT Martin Skyhawks':'The University of Tennessee-Martin','UT Rio Grande Valley Vaqueros':'The University of Texas Rio Grande Valley','UTEP Miners':'The University of Texas at El Paso','UTSA Roadrunners':'The University of Texas at San Antonio',
 'VCU Rams':'Virginia Commonwealth University','VMI Keydets':'Virginia Military Institute','Miami Hurricanes':'University of Miami','Miami (OH) RedHawks':'Miami University-Oxford','Florida International Panthers':'Florida International University',
 'Purdue Fort Wayne Mastodons':'Purdue University Fort Wayne','Pittsburgh Panthers':'University of Pittsburgh-Pittsburgh Campus','Washington Huskies':'University of Washington-Seattle Campus','Indiana Hoosiers':'Indiana University-Bloomington',
 'Kansas Jayhawks':'University of Kansas','Minnesota Golden Gophers':'University of Minnesota-Twin Cities','Rutgers Scarlet Knights':'Rutgers University-New Brunswick',"Saint Mary's Gaels":"Saint Mary's College of California",
 "St. John's Red Storm":"St. John's University-New York",'UMass Minutemen':'University of Massachusetts-Amherst','Long Island University Sharks':'Long Island University','Penn State Nittany Lions':'Pennsylvania State University-Main Campus'}
ALIAS['North Carolina A&T Aggies']='North Carolina A & T State University'
ALIAS.update({'Arizona State Sun Devils': 'Arizona State University Campus Immersion', 'Arkansas-Pine Bluff Golden Lions': 'University of Arkansas at Pine Bluff', 'Austin Peay Governors': 'Austin Peay State University', 'Bowling Green Falcons': 'Bowling Green State University-Main Campus', 'Buffalo Bulls': 'University at Buffalo', 'Central Connecticut Blue Devils': 'Central Connecticut State University', 'Charlotte 49ers': 'University of North Carolina at Charlotte', 'Chattanooga Mocs': 'The University of Tennessee-Chattanooga', 'Colorado Buffaloes': 'University of Colorado Boulder', 'Colorado State Rams': 'Colorado State University-Fort Collins', 'Columbia Lions': 'Columbia University in the City of New York', 'Florida A&M Rattlers': 'Florida Agricultural and Mechanical University', 'Fresno State Bulldogs': 'California State University-Fresno', 'Georgia Tech Yellow Jackets': 'Georgia Institute of Technology-Main Campus', 'Grambling Tigers': 'Grambling State University', 'Green Bay Phoenix': 'University of Wisconsin-Green Bay', 'Illinois Fighting Illini': 'University of Illinois Urbana-Champaign', 'Kansas City Roos': 'University of Missouri-Kansas City', 'Little Rock Trojans': 'University of Arkansas at Little Rock', 'Long Beach State Beach': 'California State University-Long Beach', 'McNeese Cowboys': 'McNeese State University', 'Middle Tennessee Blue Raiders': 'Middle Tennessee State University', 'Milwaukee Panthers': 'University of Wisconsin-Milwaukee', 'Nicholls Colonels': 'Nicholls State University', 'Northwestern Wildcats': 'Northwestern University', 'Omaha Mavericks': 'University of Nebraska at Omaha', 'Queens University Royals': 'Queens University of Charlotte', 'Sacramento State Hornets': 'California State University-Sacramento', 'Sam Houston Bearkats': 'Sam Houston State University', 'San José State Spartans': 'San Jose State University', 'Southern Illinois Salukis': 'Southern Illinois University-Carbondale', 'Southern Jaguars': 'Southern University and A & M College', 'Southern Miss Golden Eagles': 'University of Southern Mississippi', 'Stephen F. Austin Lumberjacks': 'Stephen F Austin State University', 'Tennessee Tech Golden Eagles': 'Tennessee Technological University', 'Texas A&M Aggies': 'Texas A&M University-College Station', 'Texas A&M-Corpus Christi Islanders': 'Texas A & M University-Corpus Christi', 'The Citadel Bulldogs': 'Citadel Military College of South Carolina', 'Tulane Green Wave': 'Tulane University of Louisiana', 'Virginia Tech Hokies': 'Virginia Polytechnic Institute and State University', 'Texas Longhorns': 'The University of Texas at Austin', 'Michigan Wolverines': 'University of Michigan-Ann Arbor', 'Tennessee Volunteers': 'The University of Tennessee-Knoxville', 'North Carolina Tar Heels': 'University of North Carolina at Chapel Hill', 'Georgia Bulldogs': 'University of Georgia', 'Maryland Terrapins': 'University of Maryland-College Park', 'Nebraska Cornhuskers': 'University of Nebraska-Lincoln', 'Missouri Tigers': 'University of Missouri-Columbia', 'Florida Gators': 'University of Florida', 'Arizona Wildcats': 'University of Arizona', 'Virginia Cavaliers': 'University of Virginia-Main Campus', 'California Golden Bears': 'University of California-Berkeley', 'Boston College Eagles': 'Boston College', 'Boston University Terriers': 'Boston University', 'Central Arkansas Bears': 'University of Central Arkansas', 'Central Michigan Chippewas': 'Central Michigan University', "Louisiana Ragin' Cajuns": 'University of Louisiana at Lafayette', 'New Orleans Privateers': 'University of New Orleans', 'North Texas Mean Green': 'University of North Texas', 'Northwestern State Demons': 'Northwestern State University of Louisiana', 'San Diego Toreros': 'University of San Diego', 'Southeast Missouri State Redhawks': 'Southeast Missouri State University', 'Missouri State Bears': 'Missouri State University-Springfield', 'West Georgia Wolves': 'University of West Georgia', 'Eastern Illinois Panthers': 'Eastern Illinois University', 'East Texas A&M Lions': 'East Texas A&M University', 'Louisiana Tech Bulldogs': 'Louisiana Tech University', 'Loyola Maryland Greyhounds': 'Loyola University Maryland', 'California Baptist Lancers': 'California Baptist University'})

def eada(folder):
    """men's basketball (REV_MEN / EXP_MEN) per NCAA Division I school + department totals"""
    ws = openpyxl.load_workbook(os.path.join(folder, 'schools.xlsx'), read_only=True).worksheets[0]
    it = ws.iter_rows(values_only=True); H = list(next(it)); ix = {h: i for i, h in enumerate(H)}; out = {}
    for r in it:
        cls = r[ix['classification_name']] or ''; nm = r[ix['institution_name']] or ''
        if not (cls.startswith('NCAA Division I-') or cls.startswith('NCAA Division I without') or nm in ('Florida International University', 'Presbyterian College')): continue
        if (r[ix['Sports']] or '').strip() != 'Basketball': continue
        out[r[ix['unitid']]] = {'name': nm, 'cls': cls.strip(), 'rev': r[ix['REV_MEN']], 'exp': r[ix['EXP_MEN']]}
    ws2 = openpyxl.load_workbook(os.path.join(folder, 'instLevel.xlsx'), read_only=True).worksheets[0]
    it2 = ws2.iter_rows(values_only=True); H2 = list(next(it2)); ix2 = {h: i for i, h in enumerate(H2)}
    for r in it2:
        u = r[ix2['unitid']]
        if u in out and r[ix2['GRND_TOTAL_REVENUE']] is not None: out[u]['dept'] = r[ix2['GRND_TOTAL_REVENUE']]
    return out

def toks(s):
    s = s.lower().replace('&', ' and ').replace('-', ' ').replace('.', ' ').replace("'", '')
    return [w for w in re.sub(r'[^a-z ]', ' ', s).split() if w]
def norm(x):
    x = ' ' + x.lower().replace('&', ' and ').replace("'", '').replace('.', '').replace(',', ' ') + ' '
    x = re.sub(r'-\s*main campus|main campus|-\s*[a-z ]*campus\b', ' ', x)
    for w in (' the ', ' university of ', ' university ', ' college of ', ' college '): x = x.replace(w, ' ')
    x = re.sub(r'[^a-z -]', ' ', x); return ' '.join(x.replace('-', ' - ').split())
def n2(x): return re.split(r' at | - ', norm(x))[0].strip()

def match(E, members):
    byname = {r['name']: u for u, r in E.items()}
    EN = {u: (norm(r['name']).replace(' - ', ' '), n2(r['name']), r.get('dept') or 0) for u, r in E.items()}
    out, used = {}, set()
    for full in members:
        if full in ALIAS and ALIAS[full] in byname: out[full] = byname[ALIAS[full]]; used.add(out[full])
    for full in members:
        if full in out: continue
        ft = toks(full)
        for k in range(1, min(3, len(ft))):
            school = norm(' '.join(ft[:len(ft) - k]))
            ex = [u for u, (a, b, rv) in EN.items() if a == school and u not in used]
            if ex: out[full] = ex[0]; used.add(ex[0]); break
            stt = [u for u, (a, b, rv) in EN.items() if b == school and u not in used]
            if stt: out[full] = max(stt, key=lambda u: EN[u][2]); used.add(out[full]); break
    return out

def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    E = eada(sys.argv[1])
    members = json.load(open(ROOT / 'scripts' / 'data' / 'conf_members_2027.json'))['teams']
    key = re.search(r'sb_publishable_[A-Za-z0-9_-]+', (ROOT / 'player.html').read_text()).group(0)
    req = urllib.request.Request('https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/predictive_ratings?select=data&season=eq.2027', headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    short = {t['full']: t['team'] for t in json.load(urllib.request.urlopen(req, timeout=60))[0]['data']['teams']}
    M = match(E, members)
    rows = {}
    for full, conf in members.items():
        r = E.get(M.get(full)) or {}
        rows[full] = {'short': short.get(full, full), 'conf': conf, 'eada': r.get('name'), 'mbb_exp': r.get('exp'), 'mbb_rev': r.get('rev'), 'dept_rev': r.get('dept')}
    byc = {}
    for f, r in rows.items(): byc.setdefault(r['conf'], []).append(f)
    for c, L in byc.items():
        ex = [rows[f]['mbb_exp'] for f in L if rows[f]['mbb_exp']]; dp = [rows[f]['dept_rev'] for f in L if rows[f]['dept_rev']]
        mex = st.median(ex) if ex else 1e6; mdp = st.median(dp) if dp else 1e7
        w = {f: (((rows[f]['mbb_exp'] or mex) ** A) * ((rows[f]['dept_rev'] or mdp) ** (1 - A))) ** G for f in L}
        mw = st.mean(w.values())
        for f in L: rows[f]['fin'] = round(CONF.get(c, 1.0) * w[f] / mw, 2)
    teams = {r['short']: {'full': f, 'conf': r['conf'], 'fin': r['fin'],
                          'mbb_exp': round(r['mbb_exp'] / 1e6, 2) if r['mbb_exp'] else None, 'mbb_rev': round(r['mbb_rev'] / 1e6, 2) if r['mbb_rev'] else None,
                          'dept_rev': round(r['dept_rev'] / 1e6, 1) if r['dept_rev'] else None, 'eada': r['eada']} for f, r in rows.items()}
    doc = {'season': 2027, 'source': 'U.S. Dept. of Education EADA 2024-25 (men\'s basketball revenue/expenses, total athletics revenue)',
           'model': {'A': A, 'G': G, 'conf_avg': CONF, 'blend_worth': 0.5}, 'teams': teams}
    json.dump(doc, open(OUT, 'w'), indent=0, sort_keys=True)
    miss = [f for f in members if f not in M]
    print(f'{len(teams)} teams, {len(M)} matched to EADA, total financial spending power ${sum(t["fin"] for t in teams.values()):.0f}M; no EADA: {miss}')

if __name__ == '__main__':
    main()
