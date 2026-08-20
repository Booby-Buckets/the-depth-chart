/* Tournament / event logos for the Tournament Vault (tournaments.html).
   Real marks, self-hosted under assets/tourn/ (scraped from Wikimedia + official
   event sites). Top-level events resolve by category; early-season MTE events
   resolve by a distinctive keyword so the many messy name variants in the feed
   ("Maui Invitational At Lahaina Hi", "2019 Legends Classic") all still match.
   Anything without a logo here falls back to the clean text emblem. */
window.TDC_TOURN_LOGOS = {
  cat: {
    NCAA: 'assets/tourn/march_madness.svg',
    NIT:  'assets/tourn/nit.svg',
    CBI:  'assets/tourn/cbi.png'
    // CIT / TBC: no real event logo exists -> text emblem
  },
  events: [
    { re:/\bmaui\b/,            logo:'assets/tourn/maui.png' },
    { re:/atlantis|battle\s*4/, logo:'assets/tourn/battle4atlantis.png' },
    { re:/canc[uú]n/,           logo:'assets/tourn/cancun.png' },
    { re:/charleston classic/,  logo:'assets/tourn/charleston.png' },
    { re:/diamond head/,        logo:'assets/tourn/diamondhead.png' },
    { re:/hall of fame classic/,logo:'assets/tourn/hof.png' },
    { re:/legends classic/,     logo:'assets/tourn/legends.png' },
    { re:/empire classic/,      logo:'assets/tourn/empire.png' },
    { re:/baha ?mar/,           logo:'assets/tourn/bahamar.png' },
    { re:/jimmy ?v\b/,          logo:'assets/tourn/jimmyv.png' },
    { re:/players era/,         logo:'assets/tourn/playersera.png' },
    { re:/champions classic/,   logo:'assets/tourn/champions.png' },
    { re:/myrtle beach/,        logo:'assets/tourn/myrtlebeach.png' }
  ]
};
