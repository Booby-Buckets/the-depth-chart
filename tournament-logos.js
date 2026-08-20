/* Tournament / event logos + signature colours for the Tournament Vault brackets.
   Real marks, self-hosted under assets/tourn/ (scraped from Wikimedia + official
   event sites). Each entry: { logo, accent, accent2 } — accent is the primary brand
   colour (field), accent2 the secondary (the stripe up the right side). The bracket's
   FURTHEST background = the primary colour + the logo tiled faintly behind + the
   secondary stripe; the bracket panel itself is a dark overlay on top. */
window.TDC_TOURN_LOGOS = {
  cat: {
    NCAA: { logo:'assets/tourn/march_madness.svg', accent:'#0067b1', accent2:'#f26722' },
    NIT:  { logo:'assets/tourn/nit.svg',            accent:'#4763b5', accent2:'#f68614' },
    CBI:  { logo:'assets/tourn/cbi.png',            accent:'#e0442f', accent2:'#1a3d6b' }
    // CIT / TBC: no real event logo exists -> text emblem
  },
  events: [
    { re:/\bmaui\b/,            logo:'assets/tourn/maui.png',            accent:'#e43a3f', accent2:'#f0b429' },
    { re:/atlantis|battle\s*4/, logo:'assets/tourn/battle4atlantis.png', accent:'#f4881f', accent2:'#35bde0' },
    { re:/canc[uú]n/,           logo:'assets/tourn/cancun.png',          accent:'#1479c4', accent2:'#f25c66' },
    { re:/charleston classic/,  logo:'assets/tourn/charleston.png',      accent:'#2b6cb0', accent2:'#c9a24a' },
    { re:/diamond head/,        logo:'assets/tourn/diamondhead.png',     accent:'#e86a8f', accent2:'#35a8d8' },
    { re:/hall of fame classic/,logo:'assets/tourn/hof.png',             accent:'#f0851f', accent2:'#14355f' },
    { re:/legends classic/,     logo:'assets/tourn/legends.png',         accent:'#3f63b8', accent2:'#c94d54' },
    { re:/empire classic/,      logo:'assets/tourn/empire.png',          accent:'#0a72b0', accent2:'#e0a35a' },
    { re:/baha ?mar/,           logo:'assets/tourn/bahamar.png',         accent:'#c69a46', accent2:'#2a9db0' },
    { re:/jimmy ?v\b/,          logo:'assets/tourn/jimmyv.png',          accent:'#3f9cc4', accent2:'#c0392b' },
    { re:/players era/,         logo:'assets/tourn/playersera.png',      accent:'#8a9cc0', accent2:'#c7b89b' },
    { re:/champions classic/,   logo:'assets/tourn/champions.png',       accent:'#d81f26', accent2:'#c88a2a' },
    { re:/cbs sports classic/,  logo:'',                                 accent:'#1f6fd0', accent2:'#e8384f' },
    { re:/myrtle beach/,        logo:'assets/tourn/myrtlebeach.png',     accent:'#1975bc', accent2:'#f2972f' }
  ]
};
