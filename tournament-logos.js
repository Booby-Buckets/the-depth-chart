/* Tournament / event logos + signature colors for the Tournament Vault brackets.
   Real marks, self-hosted under assets/tourn/ (scraped from Wikimedia + official
   event sites). Each entry: { logo, accent } — accent is the tournament's signature
   colour, used to theme its bracket (field tint, connector lines, winner highlight).
   Top-level events resolve by category; MTE events resolve by a distinctive keyword.
   Anything without an entry falls back to the clean text emblem / default bracket. */
window.TDC_TOURN_LOGOS = {
  cat: {
    NCAA: { logo:'assets/tourn/march_madness.svg', accent:'#005eb8' },
    NIT:  { logo:'assets/tourn/nit.svg',            accent:'#4763b5' },
    CBI:  { logo:'assets/tourn/cbi.png',            accent:'#e0442f' }
    // CIT / TBC: no real event logo exists -> text emblem
  },
  events: [
    { re:/\bmaui\b/,            logo:'assets/tourn/maui.png',            accent:'#e43a3f' },
    { re:/atlantis|battle\s*4/, logo:'assets/tourn/battle4atlantis.png', accent:'#f4881f' },
    { re:/canc[uú]n/,           logo:'assets/tourn/cancun.png',          accent:'#1479c4' },
    { re:/charleston classic/,  logo:'assets/tourn/charleston.png',      accent:'#2b6cb0' },
    { re:/diamond head/,        logo:'assets/tourn/diamondhead.png',     accent:'#e86a8f' },
    { re:/hall of fame classic/,logo:'assets/tourn/hof.png',             accent:'#f0851f' },
    { re:/legends classic/,     logo:'assets/tourn/legends.png',         accent:'#3f63b8' },
    { re:/empire classic/,      logo:'assets/tourn/empire.png',          accent:'#0a72b0' },
    { re:/baha ?mar/,           logo:'assets/tourn/bahamar.png',         accent:'#c69a46' },
    { re:/jimmy ?v\b/,          logo:'assets/tourn/jimmyv.png',          accent:'#3f9cc4' },
    { re:/players era/,         logo:'assets/tourn/playersera.png',      accent:'#8a9cc0' },
    { re:/champions classic/,   logo:'assets/tourn/champions.png',       accent:'#d81f26' },
    { re:/cbs sports classic/,  logo:'',                                 accent:'#1f6fd0' },
    { re:/myrtle beach/,        logo:'assets/tourn/myrtlebeach.png',     accent:'#1975bc' }
  ]
};
