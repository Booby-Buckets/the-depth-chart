/* tdc-fantasy-pg.js — the fantasy league's point-guard list (owner's list, Nov 1 2026).
 * One named PG per pool school; a team may roster at most MAX of them (league.html reads fl_leagues.max_pg when it
 * exists). The list, not players.position, is what the limit counts: 63 roster-listed PGs don't count and 7 players our
 * rosters call SG do. Used by league.html and fantasy-builder.html; the database trigger in
 * scripts/fantasy_league_v3_pg.sql holds the same players by id.
 *   TDCFantasyPG.mark(pool) -> sets p.lpg on the listed players, returns the list entries it couldn't find
 */
(function(){
  const MAX=3;
  const LIST=`Duke|Cayden Boozer;Virginia|Chance Mallory;Louisville|Jackson Shelstad;Clemson|Dillon Hunter;Miami|Acaden Lewis;SMU|Rowan Brumbaugh;NC State|Preston Edmead;North Carolina|Neoklis Avdalas;Virginia Tech|Ben Hammond;Stanford|Christian Bliss;Notre Dame|Braeden Smith;Wake Forest|Kevair Kennedy;Pittsburgh|Naithan George;Florida State|Anthony Robinson II;Syracuse|Garway Dual;Boston College|Armoni Zeigler;Georgia Tech|Colby Garland;Michigan State|Jeremy Fears Jr.;Michigan|Elliot Cadeau;Illinois|Stefan Vaaks;Nebraska|Trevan Leonhardt;Indiana|Markus Burton;Purdue|Omer Mayer;Ohio State|John Mobley Jr.;Wisconsin|Owen Foxwell;UCLA|Jaylen Petty;Oregon|Fred Payne;USC|Rodney Rice;Iowa|Keal Combs;Northwestern|Jake West;Maryland|DJ Wagner;Minnesota|Kyan Evans;Rutgers|Jamichael Davis;Washington|Ryan Beasley;Penn State|Dasonte Bowen;UConn|Silas Demary Jr.;Marquette|Nigel James Jr.;St. John's|Quinn Ellis;Xavier|Chance Westrey;Creighton|Austin Swartz;Providence|Malik Mack;Butler|Jalen Jackson;Seton Hall|Simeon Wilcher;Villanova|Elijah Crawford;DePaul|Layden Blocker;Georgetown|Jaland Lowe;Florida|Boogie Fland;Arkansas|Jordan Smith Jr.;Alabama|Aden Holloway;Kentucky|Zoom Diallo;Tennessee|Dai Dai Ames;Vanderbilt|Tyler Tanner;Texas|Isaiah Johnson;Auburn|George Kimble III;Oklahoma|Xzayvier Brown;LSU|Donovan Dent;Georgia|Smurf Millender;Ole Miss|Budd Clark;Texas A&M|Jordan Pope;Missouri|Jason Crowe Jr.;Mississippi State|Josh Hubbard;South Carolina|Kory Mincey;Houston|Dedan Thomas Jr.;Arizona|Derek Dixon;Iowa State|Tamin Lipsey;Texas Tech|Cruz Davis;Kansas|Melvin Council Jr.;BYU|Robert Wright Jr.;Cincinnati|Tylen Riley;UCF|Arturo Dean;TCU|Brock Harding;Baylor|Kaden Mingo;Arizona State|Joel Foxwell;Oklahoma State|Kanye Clary;West Virginia|Miles Sadler;Colorado|Barrington Hargress;Utah|Noam Yaacov;Kansas State|Brandon Rechsteiner`.split(';').map(x=>x.split('|'));

  // names: suffixes, quotes and punctuation dropped; schools: "St." = State, spaces and dashes ignored
  const nn=x=>String(x||'').toLowerCase().replace(/["'’.]/g,'').replace(/\b(jr|sr|ii|iii|iv|ll|lll)\b/g,'').replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim();
  const tn=x=>nn(x).replace(/\bst\b/g,'state').replace(/\s/g,'');
  // a pool name's forms: as stored, without its quoted nickname, and nickname + surname (Adam "Budd" Clark → Budd Clark)
  const forms=p=>{ const m=String(p.name).match(/^(.*?)["“]([^"”]+)["”](.*)$/), f=[nn(p.name)];
    if(m){ f.push(nn(m[1]+' '+m[3])); f.push(nn(m[2]+' '+m[3])); } return f; };
  const sameTeam=(p,team)=>{ const a=tn(p.team), b=tn(team); return a===b||a.includes(b)||b.includes(a); };
  // one letter apart (Mincey / Mincy)
  const near=(a,b)=>{ if(Math.abs(a.length-b.length)>1) return false; let i=0,j=0,d=0;
    while(i<a.length&&j<b.length){ if(a[i]===b[j]){ i++; j++; continue; } if(++d>1) return false; if(a.length>b.length) i++; else if(b.length>a.length) j++; else { i++; j++; } }
    return d+(a.length-i)+(b.length-j)<=1; };

  function find(pool,team,name){
    const n=nn(name), first=n.split(' ')[0], last=n.split(' ').pop();
    const lastOf=f=>f.split(' ').pop(), firstOf=f=>f.split(' ')[0];
    return pool.find(p=>sameTeam(p,team)&&forms(p).includes(n))                                            // exact, at his school
      ||pool.find(p=>forms(p).includes(n))                                                                 // exact, anywhere (transfer)
      ||pool.find(p=>sameTeam(p,team)&&forms(p).some(f=>lastOf(f)===last&&firstOf(f)===first))
      ||pool.find(p=>sameTeam(p,team)&&forms(p).some(f=>near(lastOf(f),last)&&firstOf(f)===first))        // Mincey / Mincy
      ||(c=>c.length===1?c[0]:c.find(p=>p.name[0].toLowerCase()===n[0]))(pool.filter(p=>sameTeam(p,team)&&forms(p).some(f=>lastOf(f)===last)));  // Garway / Garwey
  }
  function mark(pool){
    const miss=[];
    LIST.forEach(([team,name])=>{ const p=find(pool,team,name); if(p) p.lpg=true; else miss.push(team+' – '+name); });
    return miss;
  }
  window.TDCFantasyPG={MAX, LIST, mark};
})();
