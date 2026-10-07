#!/usr/bin/env python3
"""Fill the 2026-27 schedule gaps ESPN leaves (build_schedule_2027.py) from the
schools' own athletics sites.

Most D-I athletics sites (Sidearm and friends) embed every scheduled game as
schema.org SportsEvent JSON-LD on /sports/mens-basketball/schedule/2026-27 —
date, opponent, venue — which is far easier to read than their HTML. NCAA.com's
school pages give us each program's athletics domain.

  python3 scripts/scrape_school_schedules.py sites     # NCAA.com index → school_sites_2027.json (cached)
  python3 scripts/scrape_school_schedules.py pull      # every site → school_schedules_2027.json
  python3 scripts/scrape_school_schedules.py merge     # add games ESPN lacks into schedule_2027.json
  python3 scripts/scrape_school_schedules.py prune     # drop ESPN games neither school's own site lists
  python3 scripts/scrape_school_schedules.py audit     # per-team completeness report → schedule_audit_2027.json
  python3 scripts/scrape_school_schedules.py show "Yale"

Merged games get negative synthetic ids (they are not in the `games` table) and
a `src:"school"` tag in school_adds_2027.json so they're easy to audit or drop.
"""
import html as _html, json, os, re, sys, time, unicodedata
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import requests

DATA = Path(__file__).parent / "data"
SITES = DATA / "school_sites_2027.json"
RAW = DATA / "school_schedules_2027.json"
ADDS = DATA / "school_adds_2027.json"
SCHED = DATA / "schedule_2027.json"
SEASON = 2027
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
SB = "https://izlqhnxowdhtdofkwrho.supabase.co"
ANON = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"   # read-only public key


def get(url, tries=2, timeout=30):
    for i in range(tries):
        try:
            r = S.get(url, timeout=timeout, allow_redirects=True)
            if r.status_code == 200:
                return r.text
            if r.status_code == 404:
                return None
        except Exception:
            pass
        time.sleep(1 + i)
    return None


# ── names ──────────────────────────────────────────────────────────────────
STOP = {"university", "univ", "college", "of", "the", "at", "and", "&"}
ABBR = {"st": "state", "st.": "state", "so": "southern", "no": "northern", "n": "north", "s": "south", "e": "east", "w": "west",
        "tenn": "tennessee", "miss": "mississippi", "ill": "illinois", "wash": "washington", "conn": "connecticut", "mich": "michigan",
        "fla": "florida", "ky": "kentucky", "ala": "alabama", "ga": "georgia", "la": "louisiana", "ark": "arkansas", "okla": "oklahoma",
        "colo": "colorado", "ariz": "arizona", "calif": "california", "car": "carolina", "int'l": "international", "intl": "international",
        "caro": "carolina", "cent": "central", "chr": "christian", "cs": "cal state", "csu": "cal state", "ut": "ut", "tx": "texas",
        "ind": "indiana", "val": "valley", "tex": "texas", "me": "maine", "md": "maryland", "balt": "baltimore", "wis": "wisconsin",
        "minn": "minnesota", "neb": "nebraska", "ore": "oregon", "penn": "penn", "va": "virginia", "vt": "vermont", "nm": "new mexico",
        "nev": "nevada", "mont": "montana", "mo": "missouri", "col": "col", "wyo": "wyoming", "del": "delaware", "mass": "massachusetts", "nh": "new hampshire", "ri": "rhode island"}
SAINTS = {"johns", "marys", "peters", "josephs", "bonaventure", "francis", "thomas", "louis", "john", "mary", "peter", "joseph"}
ALIAS = {   # NCAA / school spellings → our ESPN full names
    "fgcu": "Florida Gulf Coast Eagles", "fdu": "Fairleigh Dickinson Knights", "fiu": "Florida International Panthers",
    "uconn": "UConn Huskies", "connecticut": "UConn Huskies", "ole miss": "Ole Miss Rebels", "mississippi": "Ole Miss Rebels",
    "lsu": "LSU Tigers", "smu": "SMU Mustangs", "tcu": "TCU Horned Frogs", "byu": "BYU Cougars", "vcu": "VCU Rams", "ucf": "UCF Knights",
    "usc": "USC Trojans", "southern california": "USC Trojans", "unlv": "UNLV Rebels", "utep": "UTEP Miners", "utsa": "UTSA Roadrunners",
    "uab": "UAB Blazers", "umbc": "UMBC Retrievers", "umass": "Massachusetts Minutemen", "umass lowell": "UMass Lowell River Hawks",
    "unc": "North Carolina Tar Heels", "unc asheville": "UNC Asheville Bulldogs", "unc greensboro": "UNC Greensboro Spartans", "uncg": "UNC Greensboro Spartans",
    "unc wilmington": "UNC Wilmington Seahawks", "uncw": "UNC Wilmington Seahawks", "pitt": "Pittsburgh Panthers", "miami fl": "Miami Hurricanes",
    "miami": "Miami Hurricanes", "miami oh": "Miami (OH) RedHawks", "miami ohio": "Miami (OH) RedHawks", "st johns": "St. John's Red Storm",
    "saint johns": "St. John's Red Storm", "st johns ny": "St. John's Red Storm", "loyola chicago": "Loyola Chicago Ramblers", "loyola md": "Loyola Maryland Greyhounds",
    "loyola maryland": "Loyola Maryland Greyhounds", "lmu": "Loyola Marymount Lions", "iu indy": "IU Indianapolis Jaguars", "iupui": "IU Indianapolis Jaguars",
    "seattle u": "Seattle U Redhawks", "seattle": "Seattle U Redhawks", "app state": "Appalachian State Mountaineers", "hawaii": "Hawai'i Rainbow Warriors",
    "texas am": "Texas A&M Aggies", "texas am corpus christi": "Texas A&M-Corpus Christi Islanders", "a&m corpus christi": "Texas A&M-Corpus Christi Islanders",
    "texas am commerce": "East Texas A&M Lions", "east texas am": "East Texas A&M Lions", "florida am": "Florida A&M Rattlers", "alabama am": "Alabama A&M Bulldogs",
    "nc state": "NC State Wolfpack", "north carolina state": "NC State Wolfpack", "nc central": "North Carolina Central Eagles", "nc at": "North Carolina A&T Aggies",
    "north carolina at": "North Carolina A&T Aggies", "etsu": "East Tennessee State Buccaneers", "middle tennessee": "Middle Tennessee Blue Raiders",
    "middle tenn": "Middle Tennessee Blue Raiders", "southern miss": "Southern Miss Golden Eagles", "ul monroe": "UL Monroe Warhawks", "louisiana": "Louisiana Ragin' Cajuns",
    "louisiana lafayette": "Louisiana Ragin' Cajuns", "ut martin": "UT Martin Skyhawks", "ut arlington": "UT Arlington Mavericks", "ut rio grande valley": "UT Rio Grande Valley Vaqueros",
    "utrgv": "UT Rio Grande Valley Vaqueros", "little rock": "Little Rock Trojans", "csun": "Cal State Northridge Matadors", "long beach state": "Long Beach State Beach",
    "cal baptist": "California Baptist Lancers", "cal poly": "Cal Poly Mustangs", "gardner webb": "Gardner-Webb Runnin' Bulldogs", "presbyterian": "Presbyterian Blue Hose",
    "st thomas": "St. Thomas-Minnesota Tommies", "st thomas mn": "St. Thomas-Minnesota Tommies", "st bonaventure": "St. Bonaventure Bonnies", "saint bonaventure": "St. Bonaventure Bonnies",
    "st peters": "Saint Peter's Peacocks", "saint peters": "Saint Peter's Peacocks", "st francis pa": "Saint Francis Red Flash", "saint francis": "Saint Francis Red Flash",
    "mt st marys": "Mount St. Mary's Mountaineers", "mount st marys": "Mount St. Mary's Mountaineers", "siu edwardsville": "SIU Edwardsville Cougars", "siue": "SIU Edwardsville Cougars",
    "omaha": "Omaha Mavericks", "nebraska omaha": "Omaha Mavericks", "purdue fort wayne": "Purdue Fort Wayne Mastodons", "detroit mercy": "Detroit Mercy Titans",
    "queens": "Queens University Royals", "queens nc": "Queens University Royals", "lindenwood": "Lindenwood Lions", "le moyne": "Le Moyne Dolphins", "mercyhurst": "Mercyhurst Lakers",
    "west georgia": "West Georgia Wolves", "east texas": "East Texas A&M Lions", "grambling": "Grambling Tigers", "grambling state": "Grambling Tigers",
    "prairie view": "Prairie View A&M Panthers", "prairie view am": "Prairie View A&M Panthers", "southern": "Southern Jaguars", "southern u": "Southern Jaguars",
    "arkansas pine bluff": "Arkansas-Pine Bluff Golden Lions", "uapb": "Arkansas-Pine Bluff Golden Lions", "maryland eastern shore": "Maryland Eastern Shore Hawks", "umes": "Maryland Eastern Shore Hawks",
    "cal state bakersfield": "Cal State Bakersfield Roadrunners", "csu bakersfield": "Cal State Bakersfield Roadrunners", "cal state fullerton": "Cal State Fullerton Titans",
    "sf state": "San Francisco State", "usf": "South Florida Bulls", "south fla": "South Florida Bulls", "san jose state": "San José State Spartans", "san jose st": "San José State Spartans",
    "hawaii": "Hawai'i Rainbow Warriors", "ualbany": "UAlbany Great Danes", "albany": "UAlbany Great Danes", "stony brook": "Stony Brook Seawolves", "liu": "Long Island University Sharks",
    "long island": "Long Island University Sharks", "central conn st": "Central Connecticut Blue Devils", "central connecticut": "Central Connecticut Blue Devils", "ccsu": "Central Connecticut Blue Devils",
    "sacred heart": "Sacred Heart Pioneers", "fairfield": "Fairfield Stags", "manhattan": "Manhattan Jaspers", "mount st marys": "Mount St. Mary's Mountaineers",
    "penn": "Penn Quakers", "pennsylvania": "Penn Quakers", "kansas city": "Kansas City Roos", "umkc": "Kansas City Roos", "north dakota st": "North Dakota State Bison",
    "south dakota st": "South Dakota State Jackrabbits", "st marys": "Saint Mary's Gaels", "saint marys": "Saint Mary's Gaels", "st marys ca": "Saint Mary's Gaels",
    "saint josephs": "Saint Joseph's Hawks", "st josephs": "Saint Joseph's Hawks", "saint louis": "Saint Louis Billikens", "st louis": "Saint Louis Billikens",
    "george washington": "George Washington Revolutionaries", "gw": "George Washington Revolutionaries", "charleston": "Charleston Cougars", "college of charleston": "Charleston Cougars",
    "charleston southern": "Charleston Southern Buccaneers", "citadel": "The Citadel Bulldogs", "the citadel": "The Citadel Bulldogs", "vmi": "VMI Keydets",
    "wku": "Western Kentucky Hilltoppers", "boston u": "Boston University Terriers", "boston university": "Boston University Terriers", "uic": "UIC Flames", "illinois chicago": "UIC Flames",
    "cal": "California Golden Bears", "california": "California Golden Bears", "washington st": "Washington State Cougars", "wazzu": "Washington State Cougars",
    "utah tech": "Utah Tech Trailblazers", "tarleton": "Tarleton State Texans", "tarleton st": "Tarleton State Texans", "sam houston": "Sam Houston Bearkats",
    "stephen f austin": "Stephen F. Austin Lumberjacks", "sfa": "Stephen F. Austin Lumberjacks", "houston christian": "Houston Christian Huskies", "hcu": "Houston Christian Huskies",
    "a&m corpus christi": "Texas A&M-Corpus Christi Islanders", "southeastern louisiana": "SE Louisiana Lions", "se louisiana": "SE Louisiana Lions",
    "northwestern st": "Northwestern State Demons", "mcneese": "McNeese Cowboys", "mcneese st": "McNeese Cowboys", "nicholls": "Nicholls Colonels", "nicholls st": "Nicholls Colonels",
    "new orleans": "New Orleans Privateers", "lamar": "Lamar Cardinals", "incarnate word": "Incarnate Word Cardinals", "uiw": "Incarnate Word Cardinals",
    "texas a&m corpus christi": "Texas A&M-Corpus Christi Islanders", "ut san antonio": "UTSA Roadrunners", "north texas": "North Texas Mean Green",
    "abilene christian": "Abilene Christian Wildcats", "acu": "Abilene Christian Wildcats", "csu": "Colorado State Rams", "colorado st": "Colorado State Rams",
    "sdsu": "San Diego State Aztecs", "san diego st": "San Diego State Aztecs", "boise st": "Boise State Broncos", "fresno st": "Fresno State Bulldogs",
    "utah st": "Utah State Aggies", "oregon st": "Oregon State Beavers", "arizona st": "Arizona State Sun Devils", "ohio st": "Ohio State Buckeyes", "michigan st": "Michigan State Spartans",
    "penn st": "Penn State Nittany Lions", "iowa st": "Iowa State Cyclones", "kansas st": "Kansas State Wildcats", "oklahoma st": "Oklahoma State Cowboys",
    "mississippi st": "Mississippi State Bulldogs", "florida st": "Florida State Seminoles", "georgia st": "Georgia State Panthers", "ga southern": "Georgia Southern Eagles",
    "app st": "Appalachian State Mountaineers", "appalachian st": "Appalachian State Mountaineers", "kennesaw st": "Kennesaw State Owls", "jacksonville st": "Jacksonville State Gamecocks",
    "wichita st": "Wichita State Shockers", "murray st": "Murray State Racers", "illinois st": "Illinois State Redbirds", "indiana st": "Indiana State Sycamores",
    "missouri st": "Missouri State Bears", "ball st": "Ball State Cardinals", "kent st": "Kent State Golden Flashes", "bowling green": "Bowling Green Falcons",
    "texas": "Texas Longhorns", "utah": "Utah Utes", "ohio": "Ohio Bobcats", "colorado": "Colorado Buffaloes", "michigan": "Michigan Wolverines",
    "montana": "Montana Grizzlies", "portland": "Portland Pilots", "boston college": "Boston College Eagles", "app state": "App State Mountaineers",
    "appalachian state": "App State Mountaineers", "massachusetts": "Massachusetts Minutemen", "pennsylvania": "Pennsylvania Quakers", "penn": "Pennsylvania Quakers",
    "wright st": "Wright State Raiders",
    "missouri kansas city": "Kansas City Roos", "central florida": "UCF Knights", "saint thomas": "St. Thomas-Minnesota Tommies",
    "boston university": "Boston University Terriers", "georgia bulldogs": "Georgia Bulldogs", "georgia": "Georgia Bulldogs", "texas longhorns": "Texas Longhorns",
    "virginia cavaliers": "Virginia Cavaliers", "virginia": "Virginia Cavaliers", "washington huskies": "Washington Huskies", "washington": "Washington Huskies",
    "houston": "Houston Cougars", "memphis": "Memphis Tigers", "cincinnati": "Cincinnati Bearcats", "pittsburgh": "Pittsburgh Panthers", "louisville": "Louisville Cardinals",
    "dayton": "Dayton Flyers", "toledo": "Toledo Rockets", "akron": "Akron Zips", "buffalo": "Buffalo Bulls", "richmond": "Richmond Spiders", "indiana": "Indiana Hoosiers",
    "columbia": "Columbia Lions", "chicago state": "Chicago State Cougars", "kansas city roos": "Kansas City Roos",
    "california santa barbara": "UC Santa Barbara Gauchos", "california irvine": "UC Irvine Anteaters", "california davis": "UC Davis Aggies",
    "california riverside": "UC Riverside Highlanders", "california san diego": "UC San Diego Tritons", "california los angeles": "UCLA Bruins",
    "uni": "Northern Iowa Panthers", "northern iowa": "Northern Iowa Panthers", "usc upstate": "South Carolina Upstate Spartans", "south carolina upstate": "South Carolina Upstate Spartans",
    "jax state": "Jacksonville State Gamecocks", "semo": "Southeast Missouri State Redhawks", "niu": "Northern Illinois Huskies", "northern illinois": "Northern Illinois Huskies",
    "army west point": "Army Black Knights", "army": "Army Black Knights", "mount saint marys maryland": "Mount St. Mary's Mountaineers", "virginia military institute": "VMI Keydets",
    "southeastern louisiana": "SE Louisiana Lions", "wku": "Western Kentucky Hilltoppers", "western kentucky": "Western Kentucky Hilltoppers", "ecu": "East Carolina Pirates",
    "fau": "Florida Atlantic Owls", "ucsb": "UC Santa Barbara Gauchos", "uc santa barbara": "UC Santa Barbara Gauchos", "unf": "North Florida Ospreys", "utah valley": "Utah Valley Wolverines",
    "naval academy": "Navy Midshipmen", "navy": "Navy Midshipmen", "ulm": "UL Monroe Warhawks", "wisconsin green bay": "Green Bay Phoenix", "green bay": "Green Bay Phoenix",
    "wisconsin milwaukee": "Milwaukee Panthers", "milwaukee": "Milwaukee Panthers", "nevada las vegas": "UNLV Rebels", "hawaii manoa": "Hawai'i Rainbow Warriors",
    "queens charlotte": "Queens University Royals", "new jersey institute technology": "NJIT Highlanders", "florida gulf coast": "Florida Gulf Coast Eagles",
    "fairleigh dickinson": "Fairleigh Dickinson Knights", "austin peay state": "Austin Peay Governors", "austin peay": "Austin Peay Governors",
    "mount saint marys": "Mount St. Mary's Mountaineers", "robert morris": "Robert Morris Colonials", "florida international": "Florida International Panthers",
    "california baptist": "California Baptist Lancers", "cal state bakersfield": "Cal State Bakersfield Roadrunners", "california state bakersfield": "Cal State Bakersfield Roadrunners",
    "prairie view am": "Prairie View A&M Panthers",
    "miami florida": "Miami Hurricanes", "sam houston state": "Sam Houston Bearkats", "col charleston": "Charleston Cougars", "massachusetts amherst": "Massachusetts Minutemen",
    "southeast mo state": "Southeast Missouri State Redhawks", "southeast missouri": "Southeast Missouri State Redhawks", "southeast missouri state": "Southeast Missouri State Redhawks",
    "albany ny": "UAlbany Great Danes", "maryland east shore": "Maryland Eastern Shore Hawks",
    "saint johns ny": "St. John's Red Storm", "saint marys ca": "Saint Mary's Gaels", "north carolina": "North Carolina Tar Heels",
    "texas am corpus": "Texas A&M-Corpus Christi Islanders", "texas rio grande valley": "UT Rio Grande Valley Vaqueros", "texas arlington": "UT Arlington Mavericks",
    "loyola il": "Loyola Chicago Ramblers", "loyola chicago": "Loyola Chicago Ramblers", "umass": "Massachusetts Minutemen", "massachusetts": "Massachusetts Minutemen",
    "maryland baltimore county": "UMBC Retrievers", "tennessee martin": "UT Martin Skyhawks", "texas el paso": "UTEP Miners", "north dakota": "North Dakota Fighting Hawks",
    "east texas am": "East Texas A&M Lions", "tennessee chattanooga": "Chattanooga Mocs", "chattanooga": "Chattanooga Mocs", "texas san antonio": "UTSA Roadrunners",
    "massachusetts lowell": "UMass Lowell River Hawks", "new jersey tech": "NJIT Highlanders", "njit": "NJIT Highlanders", "maryland eastern shore": "Maryland Eastern Shore Hawks",
    "louisiana monroe": "UL Monroe Warhawks", "la monroe": "UL Monroe Warhawks", "saint francis pa": "Saint Francis Red Wolves", "saint francis": "Saint Francis Red Wolves",
    "mississippi valley": "Mississippi Valley State Delta Devils", "mississippi valley state": "Mississippi Valley State Delta Devils", "southern indiana": "Southern Indiana Screaming Eagles",
    "saint johns": "St. John's Red Storm", "saint marys": "Saint Mary's Gaels", "saint josephs": "Saint Joseph's Hawks", "saint peters": "Saint Peter's Peacocks",
    "saint bonaventure": "St. Bonaventure Bonnies", "saint thomas mn": "St. Thomas-Minnesota Tommies", "saint thomas": "St. Thomas-Minnesota Tommies", "saint louis": "Saint Louis Billikens",
    "mount saint marys": "Mount St. Mary's Mountaineers", "penn": "Pennsylvania Quakers", "pennsylvania": "Pennsylvania Quakers", "penn st": "Penn State Nittany Lions", "youngstown st": "Youngstown State Penguins", "cleveland st": "Cleveland State Vikings", "boise state": "Boise State Broncos",
}


PLACEHOLDER_RE = re.compile(r"\b(tba|tbd|to be (announced|determined)|opponents?\b.*\b(tba|tbd)|quarter-?finals?|semi-?finals?|finals?|"
                            r"championships?|first round|second round|third round|round of \d+|sweet (16|sixteen)|elite (8|eight)|"
                            r"final four|consolation|third place|winner of|loser of)\b", re.I)


def norm(s):
    s = _html.unescape(s or "")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ").replace("'", "").replace("\u2019", "")
    s = re.sub(r"\([^)]*\)", lambda m: " " + m.group(0)[1:-1] + " ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    toks = s.split(); w = []
    for i, t in enumerate(toks):
        if t == "st" and i + 1 < len(toks) and toks[i + 1] in SAINTS: w.append("saint"); continue   # St. John's, not "state johns"
        w.append(ABBR.get(t, t))
    w = [t for t in w if t not in STOP]
    return " ".join(w).replace(" and ", " ").strip()


_RAT = None
def d1_rows():
    global _RAT
    if _RAT is None:
        r = S.get(f"{SB}/rest/v1/predictive_ratings?select=data&limit=1", headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"}, timeout=30)
        _RAT = r.json()[0]["data"]["teams"]
    return _RAT
def d1_names(): return [t["full"] for t in d1_rows()]
# a bare name that is two programs: settle it by the LISTING school's league
# bare words that are a different school on somebody's site (Boston University, Eastern University, University of
# Chicago …) — these only resolve through an explicit alias, never through a mascot-stripped key
BARE_BLOCK = {"boston", "eastern", "western", "northern", "southern", "central", "chicago", "kansas city", "charleston", "loyola",
              "miami", "columbia", "washington", "georgia", "carolina", "virginia", "texas", "california", "new york", "houston",
              "memphis", "detroit", "cincinnati", "pittsburgh", "louisville", "dayton", "toledo", "akron", "buffalo", "richmond", "indiana"}
RAW_ALIAS = [(r"\bboston\s+u(niv|niversity|\.|\b)", "Boston University Terriers"), (r"\bsouthern methodist\b", "SMU Mustangs"),
             (r"\bpenn state (?!nittany)\w+", None), (r"\bpenn state\b", "Penn State Nittany Lions")]
AMBIG = {"miami": {"Mid-American Conference": "Miami (OH) RedHawks", "*": "Miami Hurricanes"},
         "southeastern": {"Southland Conference": "SE Louisiana Lions"}}


class Matcher:
    """our ESPN full names ← other spellings.
    prefixes=True  (NCAA index step): a word-prefix of a full name matches ("norfolk state" → Norfolk State
                   Spartans; a prefix shared by several programs goes to the shortest one).
    prefixes=False (opponent strings): EXACT matches only against the full name, the NCAA short name we
                   learned for it, and the alias table — so "North Carolina Wesleyan" never becomes UNC."""
    def __init__(self, names, ncaa=None, prefixes=True):
        self.names = set(names)
        self.by_norm = {}
        for n in sorted(names, key=lambda x: len(norm(x).split())):
            self.by_norm[norm(n)] = n
            w = norm(n).split()
            if prefixes:
                for k in range(1, len(w)):
                    self.by_norm.setdefault(" ".join(w[:k]), n)
            else:   # "kent state golden flashes" → "kent state golden", "kent state" (still exact, just mascot-less);
                    # two words come off only for 4+-word names, so "Eastern Washington Eagles" never keys "eastern"
                for k in ([len(w) - 1] + ([len(w) - 2] if len(w) >= 4 else [])):
                    key = " ".join(w[:k])
                    if k >= 1 and len(key) >= 4 and key not in BARE_BLOCK: self.by_norm.setdefault(key, n)
        for full, short in (ncaa or {}).items():
            if full in self.names: self.by_norm[norm(short)] = full
        for k, v in ALIAS.items():
            if v in self.names: self.by_norm[norm(k)] = v

    PLACEHOLDER = {"tba", "tbd", "first round", "second round", "semifinals", "semifinal", "quarterfinals", "quarterfinal", "final", "finals", "championship", "consolation", "third place", "opponent tba"}
    def match(self, s):
        raw = _html.unescape(s or "")
        for pat, target in RAW_ALIAS:
            if re.search(pat, raw, re.I): return target
        raw = re.sub(r"\s*\|.*$", "", raw)                                   # "Milwaukee Athletics | Official Athletics Website"
        raw = re.sub(r"\b(athletics|official site|official athletics website)\b", " ", raw, flags=re.I)
        k = norm(raw)
        k = re.sub(r"\s*(mens|men s|men)?\s*basketball\s*$", "", k).strip()
        if not k or k in self.PLACEHOLDER: return None
        if k in self.by_norm: return self.by_norm[k]
        if re.search(r"\b(tournament|challenge|championship|classic|invitational|final four|round|semifinal|quarterfinal|bracket|conference)\b", k) and k not in self.by_norm: return "__EVENT__"
        k2 = re.sub(r"^(university|univ)\s+", "", k).strip()                # STOP already drops these, kept for safety
        return self.by_norm.get(k2)


# ── 1. sites ───────────────────────────────────────────────────────────────
def sites():
    names = d1_names(); M = Matcher(names)
    print(f"{len(names)} D-I programs")
    index = {}
    for p in range(0, 40):
        h = get("https://www.ncaa.com/schools-index" + ("" if p == 0 else f"/{p}"))
        if not h: break
        rows = re.findall(r'href="/schools/([a-z0-9-]+)"[^>]*>(?:\s*<img[^>]*>)?\s*([^<]{2,80}?)\s*</a>', h)
        if not rows: break
        for slug, nm in rows: index[slug] = nm.strip()
        time.sleep(0.25)
    print(f"{len(index)} NCAA schools indexed")
    # NCAA short name → our full name
    want, short = {}, {}
    # every index name that matches a program is a candidate; keep the one that spells the most of the
    # program's own name ("Eastern Washington" over "Eastern"), and among ties the plainest string
    # ("Georgia" over "Georgia College" — a D-II whose 'College' our normaliser drops)
    cands = defaultdict(list)
    for slug, nm in index.items():
        full = M.match(nm)
        if full: cands[full].append((slug, _html.unescape(nm)))
    for full, lst in cands.items():
        lst.sort(key=lambda x: (-len(norm(x[1]).split()), bool(re.search(r"college|univ|\(", x[1], re.I)), len(x[1])))
        want[full], short[full] = lst[0][0], lst[0][1]
    missing = [n for n in names if n not in want]
    print(f"matched {len(want)} · unmatched: {', '.join(missing[:20])}{' …' if len(missing) > 20 else ''}")
    out = json.load(open(SITES)) if SITES.exists() else {}
    def fetch(item):
        full, slug = item
        if full in out and out[full].get("site") and out[full].get("slug") == slug: return full, out[full]
        h = get(f"https://www.ncaa.com/schools/{slug}")
        site = None
        if h:
            m = re.findall(r'href="(https?://[a-z0-9.-]+\.(?:com|edu|net|org))/?"', h, re.I)
            cands = [u for u in m if not re.search(r"ncaa|wbdprivacy|amazon|gstatic|google|facebook|twitter|instagram|youtube|tiktok|apple|warner|turner|cdn|bleacher|max\.com|hbo", u, re.I)]
            site = cands[0] if cands else None
        time.sleep(0.2)
        return full, {"slug": slug, "site": site}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for full, rec in ex.map(fetch, sorted(want.items())):
            rec["ncaa"] = short.get(full, rec.get("ncaa")); out[full] = rec
    json.dump(out, open(SITES, "w"), indent=0, sort_keys=True)
    print(f"{sum(1 for v in out.values() if v.get('site'))} athletics sites → {SITES}")


# ── 2. pull ────────────────────────────────────────────────────────────────
PATHS = ["/sports/mens-basketball/schedule/2026-27", "/sports/mens-basketball/schedule", "/sports/mbkb/schedule/2026-27", "/sports/mbkb/schedule"]


def parse_ld(h):
    out = []
    for blk in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        try: j = json.loads(blk)
        except Exception: continue
        items = j if isinstance(j, list) else [j]
        for it in items:
            if isinstance(it, dict) and it.get("@type") == "SportsEvent":
                out.append(it)
    return out


def parse_nuxt(h):
    """Sidearm's newer Nuxt sites: the page state is a devalue array (objects hold INDEXES into
    the array). Resolve it and pick out the game objects (they carry at_vs / opponent / date)."""
    mm = re.search(r'id="__NUXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
    if not mm: return []
    try: arr = json.loads(mm.group(1).strip())
    except Exception: return []
    if not isinstance(arr, list): return []
    def res(i, depth=0):
        v = arr[i] if isinstance(i, int) and 0 <= i < len(arr) else i
        if depth > 5: return v
        if isinstance(v, dict): return {k: res(x, depth + 1) for k, x in v.items()}
        if isinstance(v, list): return [res(x, depth + 1) for x in v]
        return v
    out = []
    for i, v in enumerate(arr):
        if isinstance(v, dict) and "at_vs" in v and "opponent" in v and "date" in v:
            g = res(i); o = g.get("opponent") if isinstance(g.get("opponent"), dict) else {}
            li = (g.get("location_indicator") or "").upper()
            where = "N" if li == "N" or g.get("neutral_hometeam") else ("A" if li == "A" or (g.get("at_vs") or "").lower() == "at" else "H")
            tour = g.get("tournament"); tour = tour.get("title") if isinstance(tour, dict) else (tour if isinstance(tour, str) else "")
            out.append({"date": str(g.get("date"))[:10], "opp": (o.get("title") or "").strip(), "where": where,
                        "venue": (g.get("facility") or {}).get("title", "") if isinstance(g.get("facility"), dict) else "", "city": g.get("location") or "", "event": tour or ""})
    return out


def pull_one(full, rec):
    site = rec.get("site")
    if not site: return full, None
    for pth in PATHS:
        h = get(site.rstrip("/") + pth)
        if not h: continue
        nx = [g for g in parse_nuxt(h) if g["date"].startswith(("2026-1", "2027-0")) and g["opp"]]
        if nx:
            return full, {"path": pth, "kind": "nuxt", "games": nx}
        ev = parse_ld(h)
        # the 2026-27 page only — anything dated before Oct 2026 is last season's page
        ev = [e for e in ev if str(e.get("startDate", "")).startswith(("2026-1", "2027-0"))]
        if ev:
            games = []
            homes = Counter((e.get("homeTeam") or {}).get("name") or "" for e in ev)
            aways = Counter((e.get("awayTeam") or {}).get("name") or "" for e in ev)
            selfs = {n for n, c in list(homes.items()) + list(aways.items()) if n and c >= max(3, len(ev) // 3)}   # the school's own name(s)
            for e in ev:
                name = e.get("name") or ""; desc = e.get("description") or ""
                away = (e.get("awayTeam") or {}).get("name") or ""; home = (e.get("homeTeam") or {}).get("name") or ""
                loc = e.get("location") or {}; addr = (loc.get("address") or {}).get("streetAddress") or ""
                vs = re.search(r"\b(vs\.?|at)\b", name + " " + desc, re.I)
                where = "A" if (vs and vs.group(1).lower() == "at") else "H"
                cands = [x for x in (away, home) if x.strip() and x not in selfs]
                opp = cands[0] if cands else ""
                if not opp.strip():   # some sites leave both teams blank in the object; fall back to the name
                    opp = re.sub(r"^.*?\b(?:vs\.?|at)\b\s*", "", name, flags=re.I).strip()
                games.append({"date": str(e.get("startDate"))[:10], "opp": opp.strip(), "where": where, "venue": loc.get("name") or "", "city": addr})
            return full, {"path": pth, "kind": "ld", "games": games}
    return full, {"path": None, "games": []}


def pull(force=False):
    sites_ = json.load(open(SITES))
    out = json.load(open(RAW)) if RAW.exists() and not force else {}
    todo = [(k, v) for k, v in sorted(sites_.items()) if force or not (out.get(k) or {}).get("games")]
    print(f"pulling {len(todo)} sites")
    with ThreadPoolExecutor(max_workers=6) as ex:
        for full, rec in ex.map(lambda kv: pull_one(*kv), todo):
            if rec is not None: out[full] = rec
    json.dump(out, open(RAW, "w"), indent=0, sort_keys=True)
    got = {k: len(v["games"]) for k, v in out.items()}
    print(f"{sum(1 for n in got.values() if n)} sites with a 2026-27 schedule · {sum(got.values())} games → {RAW}")
    print("  empty:", ", ".join(k for k, n in got.items() if not n)[:600])


# ── 3. merge ───────────────────────────────────────────────────────────────
def merge():
    raw = json.load(open(RAW)); sched = json.load(open(SCHED))
    names = d1_names(); sites_ = json.load(open(SITES))
    # match against every name ESPN uses too (non-D-I opponents like "Newman Jets"), so a school site's
    # "Newman" lands on the same row instead of a duplicate; D-I programs stay on the ratings' spelling
    espn_names = [n for n in sched["teams"] if n not in names]
    M = Matcher(names + espn_names, ncaa={k: v["ncaa"] for k, v in sites_.items() if v.get("ncaa")}, prefixes=False)
    conf_of = {t["full"]: t.get("conf") for t in d1_rows()}
    T = sched["teams"]; idx = {n: i for i, n in enumerate(T)}
    from datetime import date as _d, timedelta as _td
    have, busy = set(), set()
    for g in sched["games"]:
        busy.add((g[1], T[g[2]])); busy.add((g[1], T[g[3]]))
        d0 = _d.fromisoformat(g[1])
        for k in range(-3, 4):   # a school site's local date can sit a day off ESPN's; two sites can disagree by two
            have.add(((d0 + _td(days=k)).isoformat(), frozenset((T[g[2]], T[g[3]]))))
    # neutral heuristic: a "home" game whose city isn't the school's usual home city
    adds, unmatched = [], Counter()
    auto = {}   # undecided event games ("A/B", "A or B") -> schedule_extras_2027.json bracket / pool entries
    nid = min([g[0] for g in sched["games"] if g[0] < 0] + [0]) - 1
    for full, rec in raw.items():
        gs = rec.get("games") or []
        home_city = Counter(g["city"] for g in gs if g["where"] == "H" and g["city"]).most_common(1)
        home_city = home_city[0][0] if home_city else None
        for g in gs:
            if norm(g["opp"]) in Matcher.PLACEHOLDER or not g["opp"].strip(): continue   # "TBA", bracket placeholders
            # bracket / postseason / unnamed-opponent placeholders written into a longer label
            # ("Patriot League Quarterfinals", "Sweet 16", "vs. TBD", "TBD Sun Belt Opponent", "Players Era Semifinals")
            if PLACEHOLDER_RE.search(g["opp"]): continue
            if g["date"] < "2026-11-01" or re.search(r"exhib|scrimmage|countdown|madness|craziness|open practice", g["opp"] + " " + g.get("event", ""), re.I): continue
            bare = norm(g["opp"])
            if bare in AMBIG:
                opp = AMBIG[bare].get(conf_of.get(full)) or AMBIG[bare].get("*")
                if not opp: continue
            else:
                opp = M.match(g["opp"])
            if opp == "__EVENT__": continue                                    # "ACC Tournament" listed as the opponent
            # "Houston/Rutgers", "Oregon or St. John's", "Louisville, Texas Tech, St. John's or Oregon": an event's
            # undecided game, not a non-D-I opponent — kept raw it simulated as a near-certain win. Those days come
            # from schedule_extras_2027.json (bracket / pool) instead.
            if not opp and re.search(r"/|\bor\b", g["opp"], re.I):
                parts = [M.match(x) for x in re.split(r"\s*(?:/|,|-?\bor\b-?)\s*", g["opp"], flags=re.I) if x.strip()]
                parts = [x for x in dict.fromkeys(parts) if x and x != "__EVENT__" and x != full]
                if len(parts) >= 2: auto.setdefault(full, []).append({"date": g["date"], "where": "N" if g["where"] == "N" else g["where"],
                    "event": (g.get("event") or "Event").strip() + " · TBD", "auto": True,
                    **({"opps": parts, "bracket": True} if len(parts) == 2 else {"pool": parts})})
                continue
            if not opp:
                unmatched[g["opp"]] += 1; opp = g["opp"]           # non-D-I (or unrecognised) — keep the raw name
            if opp == full: continue
            key = (g["date"], frozenset((full, opp)))
            if key in have: continue
            if (g["date"], full) in busy or (g["date"], opp) in busy: continue   # either side already plays that day (same game, other spelling or date)
            d0 = _d.fromisoformat(g["date"])
            neutral = g["where"] == "N" or (g["where"] == "H" and home_city and g["city"] and g["city"] != home_city)
            home, away = (full, opp) if g["where"] in ("H", "N") else (opp, full)
            for n in (home, away):
                if n not in idx: idx[n] = len(T); T.append(n)
            sched["games"].append([nid, g["date"], idx[home], idx[away], 1 if neutral else 0, 0])
            adds.append({"id": nid, "date": g["date"], "home": home, "away": away, "neutral": bool(neutral), "src": "school", "from": full, "venue": g["venue"]})
            for k in range(-3, 4): have.add(((d0 + _td(days=k)).isoformat(), frozenset((full, opp))))
            busy.add((g["date"], full)); busy.add((g["date"], opp))
            nid -= 1
    sched["games"].sort(key=lambda g: (g[1], g[0]))
    sched["teams"] = T
    json.dump(sched, open(SCHED, "w"), separators=(",", ":"))
    json.dump(adds, open(ADDS, "w"), indent=0)
    print(f"+{len(adds)} games from school sites → {SCHED} (audit: {ADDS})")
    # an event's undecided day ("Houston/Rutgers", "Oregon or St. John's") becomes a bracket (two names) or pool
    # (three+) entry in schedule_extras_2027.json, the file tdc-schedule.js simulates them from. Hand-written
    # entries win on their date; earlier auto entries are replaced each run.
    _xp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "schedule_extras_2027.json")
    _ex = json.load(open(_xp))
    for _t in [k for k in _ex if k != "_doc"]:
        _ex[_t] = [e for e in _ex[_t] if not e.get("auto")]
        if not _ex[_t]: del _ex[_t]
    # a bracket day is symmetric: if X's day 2 is "A or B", X's day-1 opponent P has the same day 2, and A and B
    # each meet "X or P". Fill those in for the teams whose own site listed nothing (VCU, UCLA, Middle Tennessee…).
    import datetime as _dt
    _T = sched["teams"]; _day1 = {}
    for _g in sched["games"]:
        _a, _b = _T[_g[2]], _T[_g[3]]; _day1.setdefault((_a, _g[1]), _b); _day1.setdefault((_b, _g[1]), _a)
    def _prev(d, k): return (_dt.date.fromisoformat(d) - _dt.timedelta(days=k)).isoformat()
    for _t, _lst in list(auto.items()):
        for e in list(_lst):
            if not e.get("bracket"): continue
            _p = _day1.get((_t, _prev(e["date"], 1))) or _day1.get((_t, _prev(e["date"], 2)))
            if not _p: continue
            _a, _b = e["opps"]
            for _who, _opps in ((_p, [_a, _b]), (_a, [_t, _p]), (_b, [_t, _p])):
                if any(x["date"] == e["date"] for x in auto.get(_who, [])) or (_who, e["date"]) in _day1: continue
                auto.setdefault(_who, []).append(dict(e, opps=_opps))
    _n = 0
    for _t, _lst in auto.items():
        _have = {e["date"] for e in _ex.get(_t, [])}
        _new = [e for e in _lst if e["date"] not in _have]
        if _new: _ex[_t] = sorted(_ex.get(_t, []) + _new, key=lambda e: e["date"]); _n += len(_new)
    json.dump(_ex, open(_xp, "w"), indent=1, ensure_ascii=False)
    print(f"  undecided event games -> schedule_extras_2027.json: {_n} auto entries ({len(auto)} teams)")
    print("  opponent strings not matched to a D-I name (kept raw):", unmatched.most_common(25))


# ── 4. prune + audit ───────────────────────────────────────────────────────
DROPS = DATA / "school_drops_2027.json"
AUDIT = DATA / "schedule_audit_2027.json"
# the ratings carry a few leagues under their full name; one key per league for the audit
CONF_NORM = {"Atlantic Sun Conference": "ASUN", "Big West Conference": "Big West", "Coastal Athletic Association": "CAA",
             "Mid-American Conference": "MAC", "Mid-Eastern Athletic Conference": "MEAC", "Mountain West Conference": "MWC",
             "Northeast Conference": "NEC", "Ohio Valley Conference": "OVC", "Patriot League": "Patriot",
             "Southland Conference": "Southland", "Southwestern Athletic Conference": "SWAC"}
MIN_SITE = 20   # a school site listing fewer games than this is too partial to overrule ESPN


def _site_games(sched):
    """{D-I full name: {(date, opponent full name or raw string)}} from each school's own site."""
    raw = json.load(open(RAW)); sites_ = json.load(open(SITES)); names = d1_names()
    M = Matcher(names + [n for n in sched["teams"] if n not in names], ncaa={k: v["ncaa"] for k, v in sites_.items() if v.get("ncaa")}, prefixes=False)
    conf_of = {t["full"]: t.get("conf") for t in d1_rows()}
    out = {}
    for full, rec in raw.items():
        gs = []
        for g in rec.get("games") or []:
            if not g["opp"].strip() or g["date"] < "2026-11-01": continue
            bare = norm(g["opp"])
            opp = (AMBIG[bare].get(conf_of.get(full)) or AMBIG[bare].get("*")) if bare in AMBIG else M.match(g["opp"])
            gs.append((g["date"], opp or g["opp"]))
        out[full] = gs
    return out


def _on_site(site, date, opp):
    from datetime import date as _d
    d0 = _d.fromisoformat(date)
    # a TBA / event slot on that day ("ESPN Events Invitational") can be this game, so it counts as listed
    return any(abs((_d.fromisoformat(d) - d0).days) <= 1 and (o == opp or o == "__EVENT__" or o is None) for d, o in site)


def prune():
    """Drop ESPN games that NEITHER school's official site lists, when both sites have a real slate posted.
    ESPN's men's team endpoints occasionally carry a second, phantom slate (Boston College 2026-27: 26 extra
    games, one per opponent a day or two off the real one); both sides' sites agreeing it isn't there is the
    only signal strong enough to delete a game."""
    sched = json.load(open(SCHED)); T = sched["teams"]; site = _site_games(sched)
    full_site = {k for k, v in site.items() if len(v) >= MIN_SITE}
    from datetime import date as _d
    by_team = defaultdict(list)
    for g in sched["games"]:
        by_team[T[g[2]]].append(g); by_team[T[g[3]]].append(g)
    def confirmed_twin(team, g):
        """team's own site lists a DIFFERENT game that shadows g: the same opponent within 10 days (a phantom
        second slate), or another opponent on the same day (two games can't both be that day)"""
        opp = T[g[3]] if T[g[2]] == team else T[g[2]]
        for o in by_team[team]:
            if o is g: continue
            oo = T[o[3]] if T[o[2]] == team else T[o[2]]
            near = abs((_d.fromisoformat(o[1]) - _d.fromisoformat(g[1])).days)
            if ((oo == opp and near <= 10) or (oo != opp and near == 0)) and _on_site(site[team], o[1], oo): return True
        return False
    # a site with a full season on it (28+ games) is the school's own word on its slate — but only for a team ESPN
    # OVER-lists (35+ games, a phantom second slate). For everyone else a site that skips a game is the likelier
    # mistake (MAC/SWAC sites drop real league games), so one site alone never deletes it.
    espn_n = Counter(x for g in sched["games"] if g[0] > 0 for x in (T[g[2]], T[g[3]]))
    whole = {k for k, v in site.items() if len(v) >= 28 and espn_n[k] >= 35}
    exact = lambda team, d, opp: team in site and any(x == d and o == opp for x, o in site[team])
    keep, drops, gone = [], [], set()
    # 1) the same two teams twice within 3 days: one is a copy. Keep the one a site lists on that exact day.
    pairs = defaultdict(list)
    for g in sched["games"]: pairs[frozenset((T[g[2]], T[g[3]]))].append(g)
    for pr, gs in pairs.items():
        gs = sorted(gs, key=lambda g: g[1])
        for x, y in zip(gs, gs[1:]):
            if x[0] in gone or y[0] in gone: continue
            if abs((_d.fromisoformat(y[1]) - _d.fromisoformat(x[1])).days) > 3: continue
            score = lambda g: sum(exact(t, g[1], o) for t, o in ((T[g[2]], T[g[3]]), (T[g[3]], T[g[2]])))
            if score(x) == score(y) == 0 and not (set(pr) & full_site): continue          # nobody can say which
            lose = y if (score(x), -abs(x[0])) >= (score(y), -abs(y[0])) else x
            gone.add(lose[0]); drops.append({"id": lose[0], "date": lose[1], "home": T[lose[2]], "away": T[lose[3]], "why": "duplicate of a game days apart"})
    for g in sched["games"]:
        if g[0] in gone: continue
        h, a = T[g[2]], T[g[3]]
        off_h = h in full_site and not _on_site(site[h], g[1], a)
        off_a = a in full_site and not _on_site(site[a], g[1], h)
        why = None
        if g[0] > 0 and off_h and off_a: why = "on neither site"
        elif g[0] > 0 and off_h and h in whole and not (a in site and _on_site(site[a], g[1], h)): why = f"not on {h}'s full official schedule"
        elif g[0] > 0 and off_a and a in whole and not (h in site and _on_site(site[h], g[1], a)): why = f"not on {a}'s full official schedule"
        elif off_h and h not in (a,) and (a not in full_site or off_a) and confirmed_twin(h, g): why = f"shadow of a listed {h} game"
        elif off_a and (h not in full_site or off_h) and confirmed_twin(a, g): why = f"shadow of a listed {a} game"
        if why:
            drops.append({"id": g[0], "date": g[1], "home": h, "away": a, "why": why}); continue
        keep.append(g)
    sched["games"] = keep
    json.dump(sched, open(SCHED, "w"), separators=(",", ":"))
    json.dump(drops, open(DROPS, "w"), indent=0)
    print(f"-{len(drops)} games no official site lists → {DROPS}")
    for t, n in Counter(x for d in drops for x in (d["home"], d["away"])).most_common(12): print(f"  {n:3}  {t}")


def audit():
    """Per D-I team: games listed, D-I games, league games vs the league's full slate, same-day clashes,
    and the official site's count. Writes schedule_audit_2027.json; prints the teams that look incomplete."""
    sched = json.load(open(SCHED)); T = sched["teams"]; site = _site_games(sched)
    conf = {t["full"]: CONF_NORM.get(t.get("conf"), t.get("conf")) for t in d1_rows()}
    tot, d1g, cg, days = Counter(), Counter(), Counter(), Counter()
    for g in sched["games"]:
        h, a = T[g[2]], T[g[3]]
        for x in (h, a): tot[x] += 1; days[(x, g[1])] += 1
        if h in conf and a in conf:
            d1g[h] += 1; d1g[a] += 1
            if conf[h] == conf[a]: cg[h] += 1; cg[a] += 1
    slate = {}
    for c in set(conf.values()):
        v = [cg[t] for t in conf if conf[t] == c]; slate[c] = Counter(v).most_common(1)[0][0]
    rows = []
    for t in sorted(conf):
        clash = sorted(d for (x, d), n in days.items() if x == t and n > 1)
        r = {"team": t, "conf": conf[t], "games": tot[t], "d1": d1g[t], "league": cg[t], "league_slate": slate[conf[t]],
             "site_games": len(site.get(t) or []), "clash_days": clash}
        r["flags"] = [f for f, on in (("few games", tot[t] < 27), ("league slate short", cg[t] < slate[conf[t]]),
                                       ("same-day clash", bool(clash)), ("over-listed", tot[t] > 34)) if on]
        rows.append(r)
    json.dump(rows, open(AUDIT, "w"), indent=0)
    bad = [r for r in rows if r["flags"]]
    print(f"{len(rows)} D-I teams · {sum(1 for r in rows if r['games'] >= 28)} with 28+ games · {len(bad)} flagged → {AUDIT}")
    for r in sorted(bad, key=lambda r: r["games"]):
        print(f"  {r['games']:3} games  league {r['league']:2}/{r['league_slate']:2}  site {r['site_games']:3}  {r['team']}  [{', '.join(r['flags'])}]{'  clash ' + ','.join(r['clash_days']) if r['clash_days'] else ''}")


def show(team):
    sched = json.load(open(SCHED)); T = sched["teams"]
    for g in sched["games"]:
        h, a = T[g[2]], T[g[3]]
        if team.lower() in h.lower() or team.lower() in a.lower():
            me_home = team.lower() in h.lower()
            print(f"{g[1]}  {'N' if g[4] else ('H' if me_home else 'A')}  {a if me_home else h}{'  (school site)' if g[0] < 0 else ''}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "pull"
    {"sites": sites, "pull": lambda: pull("--force" in sys.argv), "merge": merge, "prune": prune, "audit": audit}.get(cmd, lambda: show(" ".join(sys.argv[2:])))()
