// TOP SIGNAL — CLOUDBET PUBLIC SPORTSBOOK DIAGNOSTIC V1
// READ ONLY — NO LOGIN / NO BETTING / NO D1 WRITES

const ORIGIN = "https://www.cloudbet.com";
const PATHS = ["/en/sports/live","/en/sports/soccer/live","/en/sports/soccer"];
type Obj = Record<string, any>;

export async function debugCloudbet(): Promise<Obj> {
  const started=Date.now(), pages:Obj[]=[];
  let html="", base="";

  for(const path of PATHS){
    const url=ORIGIN+path;
    try{
      const r=await fetch(url,{redirect:"follow",headers:headers()});
      const t=await r.text();
      pages.push({url,final_url:r.url,status:r.status,ok:r.ok,content_type:r.headers.get("content-type"),content_length:t.length,hints:inspect(t)});
      if(r.ok&&t.length>html.length){html=t;base=r.url||url;}
    }catch(e:any){pages.push({url,ok:false,error:e?.message??String(e)});}
  }

  if(!html)return {success:false,source:"CLOUDBET",diagnostic_version:"V1",mode:"READ_ONLY_DIAGNOSTIC",pages,error:"NO_PUBLIC_PAGE_FETCHED"};

  const scripts=extractScripts(html,base);
  const useful:Obj[]=[];
  for(const url of rank(scripts).slice(0,20)){
    try{
      const r=await fetch(url,{redirect:"follow",headers:headers(base)});
      const t=await r.text(), h=inspect(t), c=contexts(t);
      if(usefulHints(h)||c.length) useful.push({url,status:r.status,ok:r.ok,content_length:t.length,hints:h,contexts:c});
    }catch(e:any){}
  }

  return {
    success:true,source:"CLOUDBET",diagnostic_version:"V1",mode:"READ_ONLY_DIAGNOSTIC",
    summary:{public_page_reachable:pages.some(x=>x.ok),best_page:base,scripts_discovered:scripts.length,scripts_checked:Math.min(20,scripts.length),useful_scripts:useful.length},
    pages,
    html:{content_length:html.length,hints:inspect(html),contexts:contexts(html)},
    useful_scripts:useful,
    target:{sport:"SOCCER",period:"FIRST_HALF",market:"TOTAL_GOALS",selection:"OVER",line:0.5,known_structures:["soccer.total_goals + period=1h + over + total=0.5","soccer.total_goals_period_first_half + over + total=0.5"]},
    timing_ms:Date.now()-started
  };
}

function inspect(t:string){
  const s=t.toLowerCase();
  return {
    cloudbet:s.includes("cloudbet"),sportsbook:s.includes("sportsbook"),
    soccer:s.includes("soccer")||s.includes("football"),
    live:s.includes("live")||s.includes("in-play")||s.includes("inplay"),
    odds:s.includes("odds")||s.includes("price"),market:s.includes("market"),event:s.includes("event"),
    first_half:s.includes("first half")||s.includes("first_half")||s.includes("first-half")||s.includes("period=1h"),
    total_goals:s.includes("total goals")||s.includes("total_goals")||s.includes("total-goals"),
    over_05:s.includes("over 0.5")||s.includes("over?total=0.5")||s.includes('"total":0.5')||s.includes('"total":"0.5"'),
    exact_legacy_market:s.includes("soccer.total_goals_period_first_half"),
    soccer_total_goals:s.includes("soccer.total_goals"),
    api:s.includes("/api/")||s.includes("api."),graphql:s.includes("graphql"),
    websocket:s.includes("websocket")||s.includes("wss://")
  };
}
function usefulHints(h:Obj){return h.first_half||h.total_goals||h.over_05||h.exact_legacy_market||h.soccer_total_goals||(h.api&&h.odds)||(h.event&&h.market&&h.odds);}
function extractScripts(html:string,base:string){
  const set=new Set<string>(), re=/<script[^>]+src=["']([^"']+\.js(?:\?[^"']*)?)["']/gi;
  let m:RegExpExecArray|null;
  while((m=re.exec(html)))try{set.add(new URL(m[1],base).toString())}catch{}
  return [...set];
}
function rank(urls:string[]){
  return urls.map(url=>{const s=url.toLowerCase();let n=0;if(s.includes("sport"))n+=10;if(s.includes("live"))n+=8;if(s.includes("odd"))n+=8;if(s.includes("market"))n+=7;if(s.includes("event"))n+=6;if(s.includes("main"))n+=5;if(s.includes("app"))n+=4;if(s.includes("chunk"))n+=3;return{url,n}}).sort((a,b)=>b.n-a.n).map(x=>x.url);
}
function contexts(t:string){
  const needles=["soccer.total_goals_period_first_half","soccer.total_goals","period=1h","total=0.5","over 0.5","first half","first_half","total goals","/api/","graphql","wss://","websocket"];
  const low=t.toLowerCase(), out:Obj[]=[];
  for(const needle of needles){let pos=0,n=0;while(n<3){const i=low.indexOf(needle,pos);if(i<0)break;out.push({needle,context:t.slice(Math.max(0,i-180),Math.min(t.length,i+needle.length+260)).replace(/\s+/g," ").trim()});pos=i+needle.length;n++;}}
  return out.slice(0,30);
}
function headers(referer?:string){
  const h:Record<string,string>={"accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8","accept-language":"en-US,en;q=0.9","cache-control":"no-cache","user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36"};
  if(referer)h.referer=referer; return h;
}
