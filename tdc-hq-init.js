/* tdc-hq-init.js — sets --sec (team secondary) for the HQ skin, with the same
   white/black/too-similar fallback Program HQ uses (→ darker shade of primary). */
(function(){
  function rgb(h){h=(''+h).replace('#','');if(h.length===3)h=h.split('').map(function(x){return x+x;}).join('');var n=parseInt(h,16);return [(n>>16)&255,(n>>8)&255,n&255];}
  function lum(h){var p=rgb(h);return 0.299*p[0]+0.587*p[1]+0.114*p[2];}
  function dist(a,b){var p=rgb(a),q=rgb(b);return Math.sqrt((p[0]-q[0])*(p[0]-q[0])+(p[1]-q[1])*(p[1]-q[1])+(p[2]-q[2])*(p[2]-q[2]));}
  function mixHex(h,t,f){var a=rgb(h),b=rgb(t),o=a.map(function(v,i){return Math.round(v+(b[i]-v)*f);});return '#'+o.map(function(v){return ('0'+v.toString(16)).slice(-2);}).join('');}
  function apply(){
    try{
      var sp=new URLSearchParams(location.search), team=sp.get('team')||'';
      var c=window.tdcTeamColor&&tdcTeamColor(team); if(!c||!c.c1) return;
      var c1=c.c1, c2=c.c2||c1, lc2=lum(c2);
      var sec=(lc2>210||lc2<26||dist(c1,c2)<58)?mixHex(c1,'#05060d',0.5):c2;
      document.documentElement.style.setProperty('--sec', sec);
    }catch(e){}
  }
  if(document.readyState!=='loading') apply(); else document.addEventListener('DOMContentLoaded',apply);
})();
