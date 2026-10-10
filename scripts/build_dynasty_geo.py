"""Dynasty geography: each D-I program's city coordinates + population (OpenStreetMap Nominatim, 1 request a second)
and its international access — how close it is to a major international airport and how big its city is.
International recruits weigh that instead of distance from home. -> data/dynasty-geo.json
{team: {"lat", "lon", "pop", "hub": "ORD", "hubMi", "air" 0-1, "city" 0-1, "intl" 0-1}}. Resumable.

Usage: python3 scripts/build_dynasty_geo.py
"""
import json, math, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "scripts" / "data"
OUT = ROOT / "data" / "dynasty-geo.json"
STATES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
          "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
          "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
          "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
          "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
          "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
          "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}
# US gateways with real international service, weighted by how much of it they have
HUBS = {"JFK": (40.64, -73.78, 1.0), "LAX": (33.94, -118.41, 1.0), "MIA": (25.79, -80.29, 0.95), "ORD": (41.98, -87.90, 0.95), "SFO": (37.62, -122.38, 0.9),
        "IAH": (29.98, -95.34, 0.85), "ATL": (33.64, -84.43, 0.85), "DFW": (32.90, -97.04, 0.85), "EWR": (40.69, -74.17, 0.85), "IAD": (38.95, -77.46, 0.8),
        "BOS": (42.36, -71.01, 0.8), "SEA": (47.45, -122.31, 0.7), "MCO": (28.43, -81.31, 0.6), "FLL": (26.07, -80.15, 0.6), "DTW": (42.21, -83.35, 0.6),
        "PHL": (39.87, -75.24, 0.6), "DEN": (39.86, -104.67, 0.55), "MSP": (44.88, -93.22, 0.55), "CLT": (35.21, -80.94, 0.55), "HNL": (21.32, -157.92, 0.5),
        "PHX": (33.43, -112.01, 0.45), "LAS": (36.08, -115.15, 0.45), "SAN": (32.73, -117.19, 0.35), "SLC": (40.79, -111.98, 0.35), "TPA": (27.98, -82.53, 0.35),
        "BWI": (39.18, -76.67, 0.35), "AUS": (30.19, -97.67, 0.35), "PDX": (45.59, -122.60, 0.3), "BNA": (36.12, -86.68, 0.3), "SJC": (37.36, -121.93, 0.25),
        "SAT": (29.53, -98.47, 0.25), "RDU": (35.88, -78.79, 0.25), "MSY": (29.99, -90.26, 0.25), "STL": (38.75, -90.37, 0.2), "CLE": (41.41, -81.85, 0.2),
        "PIT": (40.49, -80.23, 0.2), "CVG": (39.05, -84.66, 0.2), "IND": (39.72, -86.29, 0.15), "CMH": (40.00, -82.89, 0.15), "MCI": (39.30, -94.71, 0.15),
        "BDL": (41.94, -72.68, 0.15), "SMF": (38.70, -121.59, 0.15), "RSW": (26.54, -81.76, 0.15), "MKE": (42.95, -87.90, 0.1), "OMA": (41.30, -95.89, 0.1),
        "ABQ": (35.04, -106.61, 0.1), "ANC": (61.17, -149.99, 0.1), "BUF": (42.94, -78.73, 0.1)}


def miles(a, b):
    r = math.pi / 180
    dl, dn = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(dl / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dn / 2) ** 2
    return 3959 * 2 * math.asin(math.sqrt(h))


def geocode(city, st):
    q = urllib.parse.urlencode({"city": city, "state": STATES.get(st, st), "country": "USA", "format": "json", "limit": 1, "extratags": 1})
    for k in range(3):
        try:
            r = json.load(urllib.request.urlopen(urllib.request.Request("https://nominatim.openstreetmap.org/search?" + q,
                                                                        headers={"User-Agent": "TheDepthChart-dynasty-build/1.0"}), timeout=30))
            return r[0] if r else None
        except Exception:
            time.sleep(3 * (k + 1))
    return None


def access(lat, lon, pop):
    scored = [(w * max(0.0, min(1.0, 1 - (miles((lat, lon), (a, b)) - 25) / 275)), code, round(miles((lat, lon), (a, b)))) for code, (a, b, w) in HUBS.items()]
    best, hub, hm = max(scored)
    if best == 0: _, hub, hm = min((d, c, d) for _, c, d in scored)   # nothing in range: the nearest gateway
    city = max(0.0, min(1.0, (math.log10(max(pop or 2000, 2000)) - 3.7) / 3.2))
    return {"hub": hub, "hubMi": hm, "air": round(best, 3), "city": round(city, 3), "intl": round(0.6 * best + 0.4 * city, 3)}


def main():
    st = json.load(open(D / "team_states.json"))
    out = json.load(open(OUT)) if OUT.exists() else {}
    todo = [t for t in st if t not in out or "lat" not in out[t]]
    print(len(todo), "to geocode")
    for i, t in enumerate(todo):
        g = geocode(st[t].get("city", ""), st[t].get("state", ""))
        time.sleep(1.1)
        if not g: continue
        lat, lon = float(g["lat"]), float(g["lon"])
        pop = None
        try: pop = int(str((g.get("extratags") or {}).get("population", "")).replace(",", "").split(";")[0])
        except ValueError: pass
        out[t] = dict({"lat": round(lat, 4), "lon": round(lon, 4), "pop": pop}, **access(lat, lon, pop))
        if (i + 1) % 25 == 0:
            print(i + 1, t, out[t]); json.dump(out, open(OUT, "w"), separators=(",", ":"))
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print("have", len(out), "of", len(st))


if __name__ == "__main__":
    main()
