#!/usr/bin/env python3
"""
ESPN stats-page scraper for The Depth Chart.

Scrapes the ESPN team statistics page for each D1 program — the same page
ESPN shows when you navigate to a team's stats tab. One request per team
instead of 1+N roster+athlete calls, and includes players who've already
left (transfers, NBA draft) since the stats page shows everyone who played.

URL: https://www.espn.com/mens-college-basketball/team/stats/_/id/{id}/season/{year}/seasontype/2

Tables on that page (always 4):
  [0] Name column  (basic stats section)
  [1] GP, MIN, PTS, REB, AST, STL, BLK, TO, FG%, FT%, 3P%   ← per-game
  [2] Name column  (detailed stats section)
  [3] MIN, FGM, FGA, FTM, FTA, 3PM, 3PA, PTS, OR, DR, REB, AST, TO, STL, BLK  ← season totals

Per-game shooting stats (fgm, fga, ftm, fta, tpm, tpa, oreb, dreb) are derived
by dividing season totals (table 3) by GP (table 1).

Season convention: 2026 = 2025-26, 2025 = 2024-25, etc.

Output: scripts/data/players_{year}.json  → loaded by load_supabase.py

Usage:
  python3 scraper.py --seasons 2025 2026
  python3 scraper.py --seasons 2022 2023 2024 2025 2026
  python3 scraper.py --seasons 2025 --team-id 150   # Duke only (debug)
  python3 scraper.py --resume                        # skip already-done teams
  python3 scraper.py --team-info                     # scrape team location data
"""

import argparse
import json
import re
import time
from pathlib import Path
from typing import Optional

import cloudscraper
import requests
from bs4 import BeautifulSoup

# ── Config ─────────────────────────────────────────────────────────────────────
DATA_DIR      = Path(__file__).parent / "data"
SEASONS       = [2022, 2023, 2024, 2025, 2026]
REQUEST_DELAY = 2.0   # seconds between team requests

STATS_URL = (
    "https://www.espn.com/mens-college-basketball/team/stats"
    "/_/id/{espn_id}/season/{year}/seasontype/2"
)
TEAM_API_URL = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball"
    "/mens-college-basketball/teams/{espn_id}"
)

# cloudscraper handles ESPN's AWS WAF challenge automatically
SESSION = cloudscraper.create_scraper(
    browser={"browser": "chrome", "platform": "darwin", "mobile": False}
)


# ── Full ESPN team ID list (all 362 D1 programs) ───────────────────────────────
TEAMS: list[tuple[str, int]] = [
    ("Abilene Christian Wildcats", 2000),
    ("Air Force Falcons", 2005),
    ("Akron Zips", 2006),
    ("Alabama A&M Bulldogs", 2010),
    ("Alabama Crimson Tide", 333),
    ("Alabama State Hornets", 2011),
    ("Alcorn State Braves", 2016),
    ("American University Eagles", 44),
    ("App State Mountaineers", 2026),
    ("Arizona State Sun Devils", 9),
    ("Arizona Wildcats", 12),
    ("Arkansas Razorbacks", 8),
    ("Arkansas State Red Wolves", 2032),
    ("Arkansas-Pine Bluff Golden Lions", 2029),
    ("Army Black Knights", 349),
    ("Auburn Tigers", 2),
    ("Austin Peay Governors", 2046),
    ("BYU Cougars", 252),
    ("Ball State Cardinals", 2050),
    ("Baylor Bears", 239),
    ("Bellarmine Knights", 91),
    ("Belmont Bruins", 2057),
    ("Bethune-Cookman Wildcats", 2065),
    ("Binghamton Bearcats", 2066),
    ("Boise State Broncos", 68),
    ("Boston College Eagles", 103),
    ("Boston University Terriers", 104),
    ("Bowling Green Falcons", 189),
    ("Bradley Braves", 71),
    ("Brown Bears", 225),
    ("Bryant Bulldogs", 2803),
    ("Bucknell Bison", 2083),
    ("Buffalo Bulls", 2084),
    ("Butler Bulldogs", 2086),
    ("Cal Poly Mustangs", 13),
    ("Cal State Bakersfield Roadrunners", 2934),
    ("Cal State Fullerton Titans", 2239),
    ("Cal State Northridge Matadors", 2463),
    ("California Baptist Lancers", 2856),
    ("California Golden Bears", 25),
    ("Campbell Fighting Camels", 2097),
    ("Canisius Golden Griffins", 2099),
    ("Central Arkansas Bears", 2110),
    ("Central Connecticut Blue Devils", 2115),
    ("Central Michigan Chippewas", 2117),
    ("Charleston Cougars", 232),
    ("Charleston Southern Buccaneers", 2127),
    ("Charlotte 49ers", 2429),
    ("Chattanooga Mocs", 236),
    ("Chicago State Cougars", 2130),
    ("Cincinnati Bearcats", 2132),
    ("Clemson Tigers", 228),
    ("Cleveland State Vikings", 325),
    ("Coastal Carolina Chanticleers", 324),
    ("Colgate Raiders", 2142),
    ("Colorado Buffaloes", 38),
    ("Colorado State Rams", 36),
    ("Columbia Lions", 171),
    ("Coppin State Eagles", 2154),
    ("Cornell Big Red", 172),
    ("Creighton Bluejays", 156),
    ("Dartmouth Big Green", 159),
    ("Davidson Wildcats", 2166),
    ("Dayton Flyers", 2168),
    ("DePaul Blue Demons", 305),
    ("Delaware Blue Hens", 48),
    ("Delaware State Hornets", 2169),
    ("Denver Pioneers", 2172),
    ("Detroit Mercy Titans", 2174),
    ("Drake Bulldogs", 2181),
    ("Drexel Dragons", 2182),
    ("Duke Blue Devils", 150),
    ("Duquesne Dukes", 2184),
    ("East Carolina Pirates", 151),
    ("East Tennessee State Buccaneers", 2193),
    ("East Texas A&M Lions", 2837),
    ("Eastern Illinois Panthers", 2197),
    ("Eastern Kentucky Colonels", 2198),
    ("Eastern Michigan Eagles", 2199),
    ("Eastern Washington Eagles", 331),
    ("Elon Phoenix", 2210),
    ("Evansville Purple Aces", 339),
    ("Fairfield Stags", 2217),
    ("Fairleigh Dickinson Knights", 161),
    ("Florida A&M Rattlers", 50),
    ("Florida Atlantic Owls", 2226),
    ("Florida Gators", 57),
    ("Florida Gulf Coast Eagles", 526),
    ("Florida International Panthers", 2229),
    ("Florida State Seminoles", 52),
    ("Fordham Rams", 2230),
    ("Fresno State Bulldogs", 278),
    ("Furman Paladins", 231),
    ("Gardner-Webb Runnin Bulldogs", 2241),
    ("George Mason Patriots", 2244),
    ("George Washington Revolutionaries", 45),
    ("Georgetown Hoyas", 46),
    ("Georgia Bulldogs", 61),
    ("Georgia Southern Eagles", 290),
    ("Georgia State Panthers", 2247),
    ("Georgia Tech Yellow Jackets", 59),
    ("Gonzaga Bulldogs", 2250),
    ("Grambling Tigers", 2755),
    ("Grand Canyon Lopes", 2253),
    ("Green Bay Phoenix", 2739),
    ("Hampton Pirates", 2261),
    ("Harvard Crimson", 108),
    ("Hawaii Rainbow Warriors", 62),
    ("High Point Panthers", 2272),
    ("Hofstra Pride", 2275),
    ("Holy Cross Crusaders", 107),
    ("Houston Christian Huskies", 2277),
    ("Houston Cougars", 248),
    ("Howard Bison", 47),
    ("IU Indianapolis Jaguars", 85),
    ("Idaho State Bengals", 304),
    ("Idaho Vandals", 70),
    ("Illinois Fighting Illini", 356),
    ("Illinois State Redbirds", 2287),
    ("Incarnate Word Cardinals", 2916),
    ("Indiana Hoosiers", 84),
    ("Indiana State Sycamores", 282),
    ("Iona Gaels", 314),
    ("Iowa Hawkeyes", 2294),
    ("Iowa State Cyclones", 66),
    ("Jackson State Tigers", 2296),
    ("Jacksonville Dolphins", 294),
    ("Jacksonville State Gamecocks", 55),
    ("James Madison Dukes", 256),
    ("Kansas City Roos", 140),
    ("Kansas Jayhawks", 2305),
    ("Kansas State Wildcats", 2306),
    ("Kennesaw State Owls", 338),
    ("Kent State Golden Flashes", 2309),
    ("Kentucky Wildcats", 96),
    ("LSU Tigers", 99),
    ("La Salle Explorers", 2325),
    ("Lafayette Leopards", 322),
    ("Lamar Cardinals", 2320),
    ("Le Moyne Dolphins", 2330),
    ("Lehigh Mountain Hawks", 2329),
    ("Liberty Flames", 2335),
    ("Lipscomb Bisons", 288),
    ("Little Rock Trojans", 2031),
    ("Long Beach State Beach", 299),
    ("Long Island University Sharks", 112358),
    ("Longwood Lancers", 2344),
    ("Louisiana Ragin Cajuns", 309),
    ("Louisiana Tech Bulldogs", 2348),
    ("Louisville Cardinals", 97),
    ("Loyola Chicago Ramblers", 2350),
    ("Loyola Maryland Greyhounds", 2352),
    ("Loyola Marymount Lions", 2351),
    ("Maine Black Bears", 311),
    ("Manhattan Jaspers", 2363),
    ("Marist Red Foxes", 2368),
    ("Marquette Golden Eagles", 269),
    ("Marshall Thundering Herd", 276),
    ("Maryland Eastern Shore Hawks", 2379),
    ("Maryland Terrapins", 120),
    ("Massachusetts Minutemen", 113),
    ("McNeese Cowboys", 2377),
    ("Memphis Tigers", 235),
    ("Mercer Bears", 2382),
    ("Mercyhurst Lakers", 2385),
    ("Merrimack Warriors", 2771),
    ("Miami OH RedHawks", 193),
    ("Miami Hurricanes", 2390),
    ("Michigan State Spartans", 127),
    ("Michigan Wolverines", 130),
    ("Middle Tennessee Blue Raiders", 2393),
    ("Milwaukee Panthers", 270),
    ("Minnesota Golden Gophers", 135),
    ("Mississippi State Bulldogs", 344),
    ("Mississippi Valley State Delta Devils", 2400),
    ("Missouri State Bears", 2623),
    ("Missouri Tigers", 142),
    ("Monmouth Hawks", 2405),
    ("Montana Grizzlies", 149),
    ("Montana State Bobcats", 147),
    ("Morehead State Eagles", 2413),
    ("Morgan State Bears", 2415),
    ("Mount St Marys Mountaineers", 116),
    ("Murray State Racers", 93),
    ("NC State Wolfpack", 152),
    ("NJIT Highlanders", 2885),
    ("Navy Midshipmen", 2426),
    ("Nebraska Cornhuskers", 158),
    ("Nevada Wolf Pack", 2440),
    ("New Hampshire Wildcats", 160),
    ("New Haven Chargers", 2441),
    ("New Mexico Lobos", 167),
    ("New Mexico State Aggies", 166),
    ("New Orleans Privateers", 2443),
    ("Niagara Purple Eagles", 315),
    ("Nicholls Colonels", 2447),
    ("Norfolk State Spartans", 2450),
    ("North Alabama Lions", 2453),
    ("North Carolina AT Aggies", 2448),
    ("North Carolina Central Eagles", 2428),
    ("North Carolina Tar Heels", 153),
    ("North Dakota Fighting Hawks", 155),
    ("North Dakota State Bison", 2449),
    ("North Florida Ospreys", 2454),
    ("North Texas Mean Green", 249),
    ("Northeastern Huskies", 111),
    ("Northern Arizona Lumberjacks", 2464),
    ("Northern Colorado Bears", 2458),
    ("Northern Illinois Huskies", 2459),
    ("Northern Iowa Panthers", 2460),
    ("Northern Kentucky Norse", 94),
    ("Northwestern State Demons", 2466),
    ("Northwestern Wildcats", 77),
    ("Notre Dame Fighting Irish", 87),
    ("Oakland Golden Grizzlies", 2473),
    ("Ohio Bobcats", 195),
    ("Ohio State Buckeyes", 194),
    ("Oklahoma Sooners", 201),
    ("Oklahoma State Cowboys", 197),
    ("Old Dominion Monarchs", 295),
    ("Ole Miss Rebels", 145),
    ("Omaha Mavericks", 2437),
    ("Oral Roberts Golden Eagles", 198),
    ("Oregon Ducks", 2483),
    ("Oregon State Beavers", 204),
    ("Pacific Tigers", 279),
    ("Penn State Nittany Lions", 213),
    ("Pennsylvania Quakers", 219),
    ("Pepperdine Waves", 2492),
    ("Pittsburgh Panthers", 221),
    ("Portland Pilots", 2501),
    ("Portland State Vikings", 2502),
    ("Prairie View AM Panthers", 2504),
    ("Presbyterian Blue Hose", 2506),
    ("Princeton Tigers", 163),
    ("Providence Friars", 2507),
    ("Purdue Boilermakers", 2509),
    ("Purdue Fort Wayne Mastodons", 2870),
    ("Quinnipiac Bobcats", 2514),
    ("Radford Highlanders", 2515),
    ("Rhode Island Rams", 227),
    ("Rice Owls", 242),
    ("Richmond Spiders", 257),
    ("Rider Broncs", 2520),
    ("Robert Morris Colonials", 2523),
    ("Rutgers Scarlet Knights", 164),
    ("SE Louisiana Lions", 2545),
    ("SIU Edwardsville Cougars", 2565),
    ("SMU Mustangs", 2567),
    ("Sacramento State Hornets", 16),
    ("Sacred Heart Pioneers", 2529),
    ("Saint Francis Red Flash", 2598),
    ("Saint Josephs Hawks", 2603),
    ("Saint Louis Billikens", 139),
    ("Saint Marys Gaels", 2608),
    ("Saint Peters Peacocks", 2612),
    ("Sam Houston Bearkats", 2534),
    ("Samford Bulldogs", 2535),
    ("San Diego State Aztecs", 21),
    ("San Diego Toreros", 301),
    ("San Francisco Dons", 2539),
    ("San Jose State Spartans", 23),
    ("Santa Clara Broncos", 2541),
    ("Seattle U Redhawks", 2547),
    ("Seton Hall Pirates", 2550),
    ("Siena Saints", 2561),
    ("South Alabama Jaguars", 6),
    ("South Carolina Gamecocks", 2579),
    ("South Carolina State Bulldogs", 2569),
    ("South Carolina Upstate Spartans", 2908),
    ("South Dakota Coyotes", 233),
    ("South Dakota State Jackrabbits", 2571),
    ("South Florida Bulls", 58),
    ("Southeast Missouri State Redhawks", 2546),
    ("Southern Illinois Salukis", 79),
    ("Southern Jaguars", 2582),
    ("Southern Miss Golden Eagles", 2572),
    ("Southern Utah Thunderbirds", 253),
    ("St Bonaventure Bonnies", 179),
    ("St Johns Red Storm", 2599),
    ("St Thomas-Minnesota Tommies", 2900),
    ("Stanford Cardinal", 24),
    ("Stephen F Austin Lumberjacks", 2617),
    ("Stetson Hatters", 56),
    ("Stonehill Skyhawks", 284),
    ("Stony Brook Seawolves", 2619),
    ("Syracuse Orange", 183),
    ("TCU Horned Frogs", 2628),
    ("Tarleton State Texans", 2627),
    ("Temple Owls", 218),
    ("Tennessee State Tigers", 2634),
    ("Tennessee Tech Golden Eagles", 2635),
    ("Tennessee Volunteers", 2633),
    ("Texas AM Aggies", 245),
    ("Texas AM-Corpus Christi Islanders", 357),
    ("Texas Longhorns", 251),
    ("Texas Southern Tigers", 2640),
    ("Texas State Bobcats", 326),
    ("Texas Tech Red Raiders", 2641),
    ("The Citadel Bulldogs", 2643),
    ("Toledo Rockets", 2649),
    ("Towson Tigers", 119),
    ("Troy Trojans", 2653),
    ("Tulane Green Wave", 2655),
    ("Tulsa Golden Hurricane", 202),
    ("UAB Blazers", 5),
    ("UAlbany Great Danes", 399),
    ("UC Davis Aggies", 302),
    ("UC Irvine Anteaters", 300),
    ("UC Riverside Highlanders", 27),
    ("UC San Diego Tritons", 28),
    ("UC Santa Barbara Gauchos", 2540),
    ("UCF Knights", 2116),
    ("UCLA Bruins", 26),
    ("UConn Huskies", 41),
    ("UIC Flames", 82),
    ("UL Monroe Warhawks", 2433),
    ("UMBC Retrievers", 2378),
    ("UMass Lowell River Hawks", 2349),
    ("UNC Asheville Bulldogs", 2427),
    ("UNC Greensboro Spartans", 2430),
    ("UNC Wilmington Seahawks", 350),
    ("UNLV Rebels", 2439),
    ("USC Trojans", 30),
    ("UT Arlington Mavericks", 250),
    ("UT Martin Skyhawks", 2630),
    ("UT Rio Grande Valley Vaqueros", 292),
    ("UTEP Miners", 2638),
    ("UTSA Roadrunners", 2636),
    ("Utah State Aggies", 328),
    ("Utah Tech Trailblazers", 3101),
    ("Utah Utes", 254),
    ("Utah Valley Wolverines", 3084),
    ("VCU Rams", 2670),
    ("VMI Keydets", 2678),
    ("Valparaiso Beacons", 2674),
    ("Vanderbilt Commodores", 238),
    ("Vermont Catamounts", 261),
    ("Villanova Wildcats", 222),
    ("Virginia Cavaliers", 258),
    ("Virginia Tech Hokies", 259),
    ("Wagner Seahawks", 2681),
    ("Wake Forest Demon Deacons", 154),
    ("Washington Huskies", 264),
    ("Washington State Cougars", 265),
    ("Weber State Wildcats", 2692),
    ("West Georgia Wolves", 2698),
    ("West Virginia Mountaineers", 277),
    ("Western Carolina Catamounts", 2717),
    ("Western Illinois Leathernecks", 2710),
    ("Western Kentucky Hilltoppers", 98),
    ("Western Michigan Broncos", 2711),
    ("Wichita State Shockers", 2724),
    ("William Mary Tribe", 2729),
    ("Winthrop Eagles", 2737),
    ("Wisconsin Badgers", 275),
    ("Wofford Terriers", 2747),
    ("Wright State Raiders", 2750),
    ("Wyoming Cowboys", 2751),
    ("Xavier Musketeers", 2752),
    ("Yale Bulldogs", 43),
    ("Youngstown State Penguins", 2754),
]


# ── Helpers ────────────────────────────────────────────────────────────────────
def r1(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None


def safe_int(v) -> Optional[int]:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def parse_name_cell(td) -> tuple[str, str, Optional[str]]:
    """
    Extract (name, position, espn_athlete_id) from an ESPN player cell.
    HTML: <a href=".../player/_/id/5041939/...">Cooper Flagg</a>
          <span class="font10"> F</span>
    """
    a        = td.find("a")
    pos_span = td.find("span", class_="font10")
    if not a:
        return "", "", None

    name = a.get_text(strip=True)
    pos  = pos_span.get_text(strip=True) if pos_span else ""

    href       = a.get("href", "")
    athlete_id = None
    m = re.search(r"/player/_/id/(\d+)/", href)
    if m:
        athlete_id = m.group(1)

    return name, pos, athlete_id


def parse_table_rows(table) -> list[list[str]]:
    rows = []
    for tr in table.find_all("tr")[1:]:   # skip header
        cells = [td.get_text(strip=True) for td in tr.find_all("td")]
        if cells:
            rows.append(cells)
    return rows


# ── Scraper ────────────────────────────────────────────────────────────────────
def fetch_stats_page(url: str) -> Optional[str]:
    """
    Fetch an ESPN stats page HTML, retrying with a fresh session on 202
    (ESPN's WAF challenge response).
    """
    global SESSION
    time.sleep(REQUEST_DELAY)

    for attempt in range(3):
        try:
            resp = SESSION.get(url, timeout=30)
        except Exception as exc:
            print(f"  Fetch error: {exc}")
            return None

        if resp.status_code == 200:
            return resp.text

        if resp.status_code == 202:
            wait = 4 + attempt * 3
            time.sleep(wait)
            SESSION = cloudscraper.create_scraper()
            continue

        print(f"  HTTP {resp.status_code}")
        return None

    print("  WAF blocked (all retries exhausted)")
    return None


def scrape_team(team_name: str, espn_id: int, year: int) -> list[dict]:
    """
    Scrape one team's stats page for one season.
    Returns player rows ready for player_history.
    """
    url  = STATS_URL.format(espn_id=espn_id, year=year)
    html = fetch_stats_page(url)
    if not html:
        return []

    soup   = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")

    if len(tables) < 4:
        return []

    # Table 0: name cells (basic stats section)
    name_rows: list[tuple[str, str, Optional[str]]] = []
    for tr in tables[0].find_all("tr")[1:]:
        td = tr.find("td")
        if td:
            name_rows.append(parse_name_cell(td))

    if not name_rows:
        return []

    # Table 1: per-game  GP, MIN, PTS, REB, AST, STL, BLK, TO, FG%, FT%, 3P%
    basic_rows = parse_table_rows(tables[1])

    # Table 3: season totals  MIN, FGM, FGA, FTM, FTA, 3PM, 3PA, PTS, OR, DR, REB, AST, TO, STL, BLK
    total_rows = parse_table_rows(tables[3])

    n = min(len(name_rows), len(basic_rows), len(total_rows))
    players: list[dict] = []

    for i in range(n):
        name, pos, _ = name_rows[i]
        if not name:
            continue

        b = basic_rows[i]
        t = total_rows[i]

        gp   = safe_int(b[0])  if len(b) > 0 else None
        mpg  = r1(b[1])        if len(b) > 1 else None
        ppg  = r1(b[2])        if len(b) > 2 else None
        rpg  = r1(b[3])        if len(b) > 3 else None
        apg  = r1(b[4])        if len(b) > 4 else None
        stl  = r1(b[5])        if len(b) > 5 else None
        blk  = r1(b[6])        if len(b) > 6 else None
        tovs = r1(b[7])        if len(b) > 7 else None
        fg_pct = r1(b[8])      if len(b) > 8 else None
        ft_pct = r1(b[9])      if len(b) > 9 else None
        tp_pct = r1(b[10])     if len(b) > 10 else None

        def pg(idx: int) -> Optional[float]:
            """Season total at col idx divided by gp."""
            if not gp or idx >= len(t):
                return None
            v = safe_int(t[idx])
            return r1(v / gp) if v is not None else None

        # totals: MIN(0), FGM(1), FGA(2), FTM(3), FTA(4), 3PM(5), 3PA(6), PTS(7), OR(8), DR(9)
        fgm  = pg(1)
        fga  = pg(2)
        ftm  = pg(3)
        fta  = pg(4)
        tpm  = pg(5)
        tpa  = pg(6)
        oreb = pg(8)
        dreb = pg(9)

        players.append({
            "season_year": year,
            "team"       : team_name,
            "name"       : name,
            "position"   : pos,
            "height"     : None,
            "yr"         : None,
            "ppg"        : ppg,
            "rpg"        : rpg,
            "apg"        : apg,
            "mpg"        : mpg,
            "fgm"        : fgm,
            "fga"        : fga,
            "fg_pct"     : fg_pct,
            "tpm"        : tpm,
            "tpa"        : tpa,
            "tp_pct"     : tp_pct,
            "ftm"        : ftm,
            "fta"        : fta,
            "ft_pct"     : ft_pct,
            "oreb"       : oreb,
            "dreb"       : dreb,
            "stl"        : stl,
            "blk"        : blk,
            "tovs"       : tovs,
            "gp"         : gp,
            "tdc_grade"  : None,
        })

    return players


def scrape_season(year: int, team_filter: Optional[int] = None,
                  resume: bool = False) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_file = DATA_DIR / f"players_{year}.json"

    all_players: list[dict] = []
    done_teams: set[str]    = set()

    if resume and out_file.exists():
        all_players = json.loads(out_file.read_text())
        done_teams  = {p["team"] for p in all_players}
        print(f"  Resuming — {len(done_teams)} teams already done")

    teams = TEAMS
    if team_filter is not None:
        teams = [(n, i) for n, i in TEAMS if i == team_filter]
        if not teams:
            print(f"No team found with ESPN ID {team_filter}")
            return
        print(f"Filtered to: {teams[0][0]}")

    print(f"\nScraping {year-1}-{str(year)[2:]} season: {len(teams)} teams")

    for idx, (team_name, espn_id) in enumerate(teams, 1):
        if team_name in done_teams:
            continue

        print(f"[{idx}/{len(teams)}] {team_name} (id={espn_id})")
        players = scrape_team(team_name, espn_id, year)

        if players:
            all_players.extend(players)
            print(f"  {len(players)} players")
        else:
            print(f"  No data")

        if idx % 20 == 0:
            out_file.write_text(json.dumps(all_players, indent=2))
            print(f"  [checkpoint] {len(all_players)} records saved")

    out_file.write_text(json.dumps(all_players, indent=2))
    print(f"\n{year-1}-{str(year)[2:]} done: {len(all_players)} players → {out_file.name}")


# ── Team info / locations ──────────────────────────────────────────────────────
def scrape_team_info() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = DATA_DIR / "team_info.json"

    cache: dict = {}
    if cache_file.exists():
        try:
            cache = json.loads(cache_file.read_text())
        except json.JSONDecodeError:
            pass

    api = requests.Session()
    api.headers["User-Agent"] = "Mozilla/5.0"

    print(f"Scraping team info for {len(TEAMS)} teams...")
    for name, espn_id in TEAMS:
        key = str(espn_id)
        if key in cache:
            continue
        print(f"  {name} ({espn_id})")
        time.sleep(0.5)
        try:
            resp = api.get(TEAM_API_URL.format(espn_id=espn_id), timeout=20)
            if resp.status_code != 200:
                continue
            data = resp.json()
        except Exception:
            continue

        team  = data.get("team") or {}
        venue = team.get("franchise", {}).get("venue") or team.get("venue") or {}
        addr  = venue.get("address") or {}

        cache[key] = {
            "name"     : name,
            "espn_id"  : espn_id,
            "full_name": team.get("displayName", ""),
            "color"    : team.get("color", ""),
            "alt_color": team.get("alternateColor", ""),
            "logo"     : (team.get("logos") or [{}])[0].get("href", ""),
            "arena"    : venue.get("fullName", ""),
            "city"     : addr.get("city", ""),
            "state"    : addr.get("state", ""),
            "location" : ", ".join(filter(None, [addr.get("city"), addr.get("state")])),
        }
        cache_file.write_text(json.dumps(cache, indent=2))

    print(f"\nTeam info saved → {cache_file}")


# ── CLI ────────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="ESPN stats-page scraper for The Depth Chart",
    )
    parser.add_argument(
        "--seasons", nargs="+", type=int, default=[2025, 2026],
        help="Season end-years to scrape (default: 2025 2026)",
    )
    parser.add_argument(
        "--team-id", type=int, dest="team_id",
        help="Scrape only this ESPN team ID (debugging)",
    )
    parser.add_argument("--resume",    action="store_true",
                        help="Skip already-done teams in existing output file")
    parser.add_argument("--team-info", action="store_true", dest="team_info",
                        help="Scrape team location/arena/color data")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if args.team_info:
        scrape_team_info()
        print("\nRun: python3 load_supabase.py --locations  to push to Supabase")
        return

    for year in args.seasons:
        print(f"\n{'='*60}")
        print(f"Season {year-1}-{str(year)[2:]}  (ESPN year={year})")
        print("="*60)
        scrape_season(year, team_filter=args.team_id, resume=args.resume)

    print("\nDone. Run: python3 load_supabase.py --players --seasons", *args.seasons)


if __name__ == "__main__":
    main()
