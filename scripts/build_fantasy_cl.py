"""build_fantasy_cl.py — seed SQL for the owner's counting league (scripts/fantasy_cl.sql, fantasy-league.html).

Reads the drafted rosters (exports/fantasy-league/fantasy_cl_rosters_2027.json, private: one row per pick, already matched to players.id /
espn_id) and the league PG list (tdc-fantasy-pg.js), and writes, OUTSIDE git:
  exports/fantasy-league/team_codes.txt       one sign-in code per team (made once; re-runs keep them)
  exports/fantasy-league/fantasy_cl_seed.sql  teams (code sha256 only), draft stints, cl_pg — run after fantasy_cl.sql
The seed is idempotent for a fresh league only: it refuses to run once any pickup exists.
"""
import difflib, json, os, re, secrets, hashlib, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "exports", "fantasy-league")
SB = "https://izlqhnxowdhtdofkwrho.supabase.co/rest/v1/"
KEY = "sb_publishable_XQKr9A5ZP79pe0ac1RKYvA_-0dAx9Ye"
COMMISH = "Aidan"
ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"     # no 0/O/1/I


def get(path):
    out, off = [], 0
    while True:
        r = json.load(urllib.request.urlopen(urllib.request.Request(f"{SB}{path}&limit=1000&offset={off}", headers={"apikey": KEY})))
        out += r
        if len(r) < 1000: return out
        off += 1000


def q(s): return "'" + str(s).replace("'", "''") + "'"


def nn(s):
    s = re.sub(r"[\"'’.]", "", str(s).lower())
    s = re.sub(r"\b(jr|sr|ii|iii|iv|ll|lll)\b", "", s)
    return re.sub(r"\s+", " ", re.sub(r"[^a-z ]", " ", s)).strip()


def forms(name):
    m = re.match(r'^(.*?)["“]([^"”]+)["”](.*)$', name)
    f = [nn(name)]
    if m: f += [nn(m.group(1) + " " + m.group(3)), nn(m.group(2) + " " + m.group(3))]
    return f


def tn(s): return nn(s).replace(" st ", " state ").replace(" ", "")


def main():
    os.makedirs(OUT, exist_ok=True)
    R = json.load(open(os.path.join(OUT, "fantasy_cl_rosters_2027.json")))   # private: not served (owner, Nov 11 2026)
    teams = [(t, int(div)) for div, ts in R["divisions"].items() for t in ts]
    codes_p = os.path.join(OUT, "team_codes.txt")
    codes = {}
    if os.path.exists(codes_p):
        for ln in open(codes_p):
            if "\t" in ln: t, c = ln.rstrip("\n").split("\t"); codes[t] = c
    for t, _ in teams:
        if t not in codes:
            codes[t] = re.sub(r"[^A-Z]", "", t.upper())[:4] + "-" + "".join(secrets.choice(ALPH) for _ in range(8))
    with open(codes_p, "w") as f:
        for t, d in teams: f.write(f"{t}\t{codes[t]}\n")

    # the league PG list -> players.id (same matching as tdc-fantasy-pg.js: name at his school, else anywhere, else surname)
    js = open(os.path.join(ROOT, "tdc-fantasy-pg.js")).read()
    lst = [x.split("|") for x in re.search(r"LIST=`([^`]*)`", js).group(1).split(";")]
    tms = get("teams?select=name&conference=in.(B10,SEC,ACC,BIG-12,Big-East)&order=name.asc")
    pool = get("players?select=id,name,team,espn_id&team=in.(" + urllib.parse.quote(",".join('"%s"' % t["name"] for t in tms)) + ")&order=id.asc")
    pg, miss = [], []
    for team, name in lst:
        n = nn(name); same = [p for p in pool if tn(p["team"]) == tn(team) or tn(team) in tn(p["team"])]
        hit = next((p for p in same if n in forms(p["name"])), None) or next((p for p in pool if n in forms(p["name"])), None) \
            or next((p for p in same if any(f.split()[-1] == n.split()[-1] for f in forms(p["name"]))), None) \
            or next((p for p in same if any(f.split()[0] == n.split()[0] and difflib.SequenceMatcher(None, f.split()[-1], n.split()[-1]).ratio() >= .8
                                            for f in forms(p["name"]))), None)   # Mincey / Mincy
        (pg.append(hit) if hit else miss.append(f"{team} - {name}"))
    pg_ids = {p["id"] for p in pg}

    S = ["-- fantasy_cl_seed.sql — built by scripts/build_fantasy_cl.py. Run AFTER scripts/fantasy_cl.sql.",
         "do $$ begin if exists(select 1 from cl_stints where how='pickup') then raise exception 'league already running: not reseeding'; end if; end $$;",
         "delete from cl_moves; delete from cl_ir; delete from cl_stints; delete from cl_pg; delete from cl_teams;"]
    for t, d in teams:
        h = hashlib.sha256(codes[t].upper().encode()).hexdigest()
        S.append(f"insert into cl_teams(name,division,code_hash,is_commish) values ({q(t)},{d},{q(h)},{'true' if t == COMMISH else 'false'});")
    S.append("insert into cl_pg(player_id,espn_id,name,school) values " + ",\n  ".join(
        f"({p['id']},{p['espn_id'] if p['espn_id'] else 'null'},{q(p['name'])},{q(p['team'])})" for p in pg) + " on conflict do nothing;")
    rows = []
    for t, _ in teams:
        for r in R["rosters"][t]:
            rows.append(f"((select id from cl_teams where name={q(t)}),{r['pid']},{r['espn_id'] if r['espn_id'] else 'null'},{q(r['name'])},{q(r['school'])},{r['price']},'draft',(select draft_start from cl_settings))")
    S.append("insert into cl_stints(team_id,player_id,espn_id,name,school,price,how,start_date) values\n  " + ",\n  ".join(rows) + ";")
    open(os.path.join(OUT, "fantasy_cl_seed.sql"), "w").write("\n".join(S) + "\n")

    # checks: every team 12 / $200 / <= 3 listed PGs, and where the sheet's blue cells and the list disagree
    for t, _ in teams:
        ros = R["rosters"][t]; n = sum(r["pid"] in pg_ids for r in ros)
        flag = [r["name"] for r in ros if (r["pid"] in pg_ids) != bool(r["sheet_pg"])]
        print(f"{t:18} {len(ros)} players ${sum(r['price'] for r in ros)}  PGs on list: {n}" + (f"   sheet/list differ: {flag}" if flag else ""))
    print("PG list:", len(pg), "matched", "| unmatched:", miss)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
