// ============================================================
// HUNTER LIVE SIGNALS V1.0.0 — READ ONLY
//
// PURPOSE:
// - Reads Hunter signals from goal-watch-tracker via Service Binding.
// - Does NOT call Matcher / Cloudbet.
// - Does NOT send Telegram yet.
// - Does NOT write to Tracker or Top Signal.
// - Exposes only FREE STRONG candidates:
//     entry minute 19–20
//     Hunter Score >= 64
//     Sofia time 15:00–23:59
//
// ENDPOINTS:
//   GET /
//   GET /status
//   GET /candidates
//   GET /history?days=7
// ============================================================

const VERSION = "V1.7.1 CORRECT RANGES + COMPLETE ARCHIVE + SOFIA HOURS";
const APP_NAME = "hunter-free-channel";

const MIN_ENTRY_MINUTE = 10;
const MAX_ENTRY_MINUTE = 21;
const MIN_HUNTER_SCORE = 64;
const START_HOUR_SOFIA = 15;
const END_HOUR_SOFIA = 23;

type Obj = Record<string, any>;

interface Env {
  TRACKER: Fetcher;
}

export async function handleFreeChannel(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return html(renderDashboard());
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return json({
        success: true,
        worker: APP_NAME,
        version: VERSION,
        mode: "READ_ONLY",
        telegram_enabled: false,
        writes_enabled: false,
        tracker_bound: !!env.TRACKER,
        filter: {
          entry_minute: `${MIN_ENTRY_MINUTE}-${MAX_ENTRY_MINUTE}`,
          hunter_score_min: MIN_HUNTER_SCORE,
          sofia_hours: `${String(START_HOUR_SOFIA).padStart(2, "0")}:00-${String(END_HOUR_SOFIA).padStart(2, "0")}:59`,
          timezone: "Europe/Sofia"
        },
        source: "goal-watch-tracker",
        endpoints: ["/status", "/candidates", "/history?days=7"],
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/candidates" && request.method === "GET") {
      try {
        const raw = await fetchTrackerJSON(env.TRACKER, "/entries");
        const all = extractSignals(raw);

        const candidates = all
          .map(normalizeSignal)
          .filter((x): x is Obj => !!x)
          .filter(isStrongCandidate)
          .sort((a, b) =>
            String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
          );

        return json({
          success: true,
          worker: APP_NAME,
          version: VERSION,
          mode: "READ_ONLY",
          telegram_enabled: false,
          count: candidates.length,
          filter: filterDescription(),
          candidates,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        return json({
          success: false,
          worker: APP_NAME,
          version: VERSION,
          count: 0,
          candidates: [],
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    if (url.pathname === "/history" && request.method === "GET") {
      try {
        const daysRaw = Number(url.searchParams.get("days") ?? 7);
        const days = Number.isFinite(daysRaw)
          ? Math.max(1, Math.min(3650, Math.trunc(daysRaw)))
          : 7;

        const raw = await fetchTrackerJSON(env.TRACKER, `/history?days=${days}`);
        const all = extractSignals(raw);

        const candidates = all
          .map(normalizeSignal)
          .filter((x): x is Obj => !!x)
          .filter(isStrongCandidate)
          .sort((a, b) =>
            String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
          );

        const goals = candidates.filter(x => x.result === "GOAL").length;
        const noGoals = candidates.filter(x => x.result === "NO_GOAL").length;
        const completed = goals + noGoals;

        return json({
          success: true,
          worker: APP_NAME,
          version: VERSION,
          mode: "READ_ONLY",
          days,
          count: candidates.length,
          completed,
          goals,
          no_goals: noGoals,
          success_pct: completed > 0
            ? Math.round((goals / completed) * 1000) / 10
            : null,
          filter: filterDescription(),
          candidates,
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        return json({
          success: false,
          worker: APP_NAME,
          version: VERSION,
          candidates: [],
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    return json({
      success: false,
      error: "NOT_FOUND",
      endpoints: ["/status", "/candidates", "/history?days=7"]
    }, 404);
}

export default {
  fetch: handleFreeChannel
};

function filterDescription() {
  return {
    entry_minute_min: MIN_ENTRY_MINUTE,
    entry_minute_max: MAX_ENTRY_MINUTE,
    hunter_score_min: MIN_HUNTER_SCORE,
    start_hour_sofia: START_HOUR_SOFIA,
    end_hour_sofia: END_HOUR_SOFIA,
    timezone: "Europe/Sofia"
  };
}

function extractSignals(data: any): any[] {
  if (Array.isArray(data)) return data;

  const candidates = [
    data?.entries,
    data?.signals,
    data?.results,
    data?.items,
    data?.history,
    data?.data?.entries,
    data?.data?.signals,
    data?.data?.results,
    data?.data?.items
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) return value;
  }

  return [];
}

function normalizeSignal(row: any): Obj | null {
  if (!row || typeof row !== "object") return null;

  const entryMinute = numberOrNull(
    row?.entry_minute ??
    row?.entryMinute ??
    row?.minute_at_entry ??
    row?.minute
  );

  const hunterScore = numberOrNull(
    row?.hunter_score ??
    row?.hunterScore ??
    row?.score_hunter
  );

  const createdAt = firstDate(
    row?.created_at,
    row?.createdAt,
    row?.entry_at,
    row?.entryAt,
    row?.timestamp,
    row?.first_seen_at
  );

  const rawResult = safe(
    row?.result ??
    row?.status ??
    row?.final_result ??
    row?.result_status
  ).toUpperCase().replace(/\s+/g, "_");

  let result = "TRACKING";

  if (
    rawResult === "GOAL" ||
    rawResult === "GOAL_HIT" ||
    rawResult === "WIN" ||
    rawResult === "WON"
  ) {
    result = "GOAL";
  } else if (
    rawResult === "NO_GOAL" ||
    rawResult === "NOGOAL" ||
    rawResult === "LOSS" ||
    rawResult === "LOST"
  ) {
    result = "NO_GOAL";
  }

  const matchName = safe(
    row?.match_name ??
    row?.match ??
    row?.name ??
    row?.fixture
  );

  const id = safe(
    row?.id ??
    row?.signal_id ??
    row?.match_id ??
    row?.flashscore_id ??
    row?.event_id
  );

  const goalMinute = numberOrNull(
    row?.goal_minute ??
    row?.goalMinute
  );

  return {
    id: id || null,
    match_name: matchName || null,
    league: safe(row?.league ?? row?.competition ?? row?.tournament) || null,
    entry_minute: entryMinute,
    hunter_score: hunterScore,
    score: scoreToString(row?.score ?? row?.entry_score) ?? null,
    result,
    goal_minute: goalMinute,
    created_at: createdAt,
    sofia_time: createdAt ? sofiaParts(createdAt) : null
  };
}

function isStrongCandidate(x: Obj): boolean {
  // PUBLIC WEBSITE COHORT:
  // ENTRY 10'-21' + Hunter Score >=64 + 15:00-23:59 Europe/Sofia.
  // Statistics and Archive use this exact same cohort.
  // Future FREE Telegram remains the narrower 19'-20' filter.
  const minute = numberOrNull(x?.entry_minute);
  const score = numberOrNull(x?.hunter_score);
  const createdAt = safe(x?.created_at);

  if (minute === null || score === null || !createdAt) return false;
  if (minute < MIN_ENTRY_MINUTE || minute > MAX_ENTRY_MINUTE) return false;
  if (score < MIN_HUNTER_SCORE) return false;

  const parts = sofiaParts(createdAt);
  if (!parts) return false;

  // 15:00:00 through 23:59:59 Sofia.
  return parts.hour >= START_HOUR_SOFIA && parts.hour <= END_HOUR_SOFIA;
}

function sofiaParts(value: string): Obj | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(d);

  const get = (type: string) =>
    parts.find(p => p.type === type)?.value ?? "";

  const hour = Number(get("hour"));

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
    hour: Number.isFinite(hour) ? hour : -1
  };
}

async function fetchTrackerJSON(service: Fetcher, path: string): Promise<any> {
  const response = await service.fetch(
    new Request("https://tracker" + path, {
      method: "GET",
      headers: { accept: "application/json" }
    })
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `TRACKER_HTTP_${response.status}: ${text.slice(0, 400)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("TRACKER_INVALID_JSON: " + text.slice(0, 400));
  }
}

function firstDate(...values: any[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function scoreToString(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;

  if (Array.isArray(value) && value.length >= 2) {
    return `${value[0]}:${value[1]}`;
  }

  if (typeof value === "object") {
    const home = value?.home ?? value?.homeScore ?? value?.home_score;
    const away = value?.away ?? value?.awayScore ?? value?.away_score;
    if (home !== undefined && away !== undefined) {
      return `${home}:${away}`;
    }
  }

  return null;
}

function numberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safe(value: any): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}


function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Next Goal Hunter</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0A1220;--panel:#101A2E;--panel2:#0B1526;--line:#1E2C48;--green:#34C77B;--green2:#1F7A4C;--amber:#F2A93B;--red:#E85D5D;--text:#E9EDF6;--muted:#8A96AE;--muted2:#566079}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{min-height:100vh;background:radial-gradient(1200px 500px at 15% -10%,rgba(52,199,123,.08),transparent 60%),radial-gradient(900px 400px at 90% 0%,rgba(242,169,59,.06),transparent 55%),var(--bg);color:var(--text);font-family:'Archivo',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.ticker{background:#050A14;border-bottom:1px solid var(--line);padding:9px 0;overflow:hidden;white-space:nowrap;position:sticky;top:0;z-index:50}.ticker-track{display:inline-block;padding-left:100%;animation:ticker 34s linear infinite;font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted)}.ticker-track span{margin-right:45px}.ticker-track b{color:var(--green)}}
header,.wrap,footer{max-width:920px;margin:0 auto;padding-left:20px;padding-right:20px}header{padding-top:32px;padding-bottom:18px}.eyebrow{display:flex;align-items:center;gap:8px;margin-bottom:13px;color:var(--green);font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.15em;text-transform:uppercase}.live-dot{width:7px;height:7px;border-radius:50%;background:var(--red);animation:pulse 1.8s infinite}@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(232,93,93,.55)}70%{box-shadow:0 0 0 8px rgba(232,93,93,0)}100%{box-shadow:0 0 0 0 rgba(232,93,93,0)}}h1{margin:0 0 12px;font-family:'Archivo Black',sans-serif;font-size:clamp(30px,6vw,46px);line-height:1.02;letter-spacing:-.02em}h1 em{color:var(--green);font-style:normal}.subtitle{max-width:65ch;margin:0;color:var(--muted);font-size:14px;line-height:1.55}.info{margin-top:15px;padding:12px 14px;border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:6px;background:rgba(242,169,59,.05);color:var(--muted);font-size:12px;line-height:1.55}.info b{color:var(--amber)}
.wrap{padding-bottom:55px}.status{padding:11px 13px;border:1px solid var(--line);border-left:3px solid var(--green);border-radius:7px;background:var(--panel);color:var(--muted);font-family:'IBM Plex Mono',monospace;font-size:11px;margin-bottom:14px}.section-title{display:flex;justify-content:space-between;align-items:end;margin:22px 0 9px}.section-title h2{margin:0;font-size:15px}.section-title span{color:var(--muted2);font-family:'IBM Plex Mono',monospace;font-size:9px}.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.stat{padding:13px 11px;background:var(--panel);border:1px solid var(--line);border-radius:8px}.stat .label{color:var(--muted2);font-family:'IBM Plex Mono',monospace;font-size:8px;text-transform:uppercase;letter-spacing:.06em}.stat .value{margin-top:6px;font-family:'Archivo Black',sans-serif;font-size:21px}.stat.green .value{color:var(--green)}.stat.red .value{color:var(--red)}.stat.amber .value{color:var(--amber)}
.period-tabs{display:flex;gap:7px;margin:9px 0 12px;flex-wrap:wrap}.chip{border:1px solid var(--line);background:var(--panel);color:var(--muted);padding:7px 11px;border-radius:20px;cursor:pointer;font-family:'IBM Plex Mono',monospace;font-size:10.5px}.chip.active{background:var(--green);border-color:var(--green);color:#07140D;font-weight:600}.list{display:flex;flex-direction:column;gap:6px}.signal-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:9px;min-height:60px;padding:10px 12px;background:var(--panel);border:1px solid var(--line);border-radius:8px;border-left:3px solid var(--amber)}.signal-row.goal{border-left-color:var(--green)}.signal-row.no-goal{border-left-color:var(--red)}.league{color:var(--muted2);font-family:'IBM Plex Mono',monospace;font-size:8px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.match{margin-top:4px;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{margin-top:4px;color:var(--muted);font-family:'IBM Plex Mono',monospace;font-size:8.5px}.hs{color:var(--amber);font-family:'IBM Plex Mono',monospace;font-size:11px;text-align:right;white-space:nowrap}.result{font-family:'Archivo Black',sans-serif;font-size:12px;text-align:right;white-space:nowrap}.goal .result{color:var(--green)}.no-goal .result{color:var(--red)}.tracking .result{color:var(--amber)}.empty{padding:24px 15px;text-align:center;color:var(--muted2);font-family:'IBM Plex Mono',monospace;font-size:11px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
.day{border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden}.day-head{width:100%;border:0;background:transparent;color:var(--text);padding:13px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;font:700 13px 'Archivo',sans-serif;text-align:left}.day-head .right{color:var(--muted);font:9px 'IBM Plex Mono',monospace;white-space:nowrap}.day-body{display:none;padding:0 7px 7px}.day.open .day-body{display:flex;flex-direction:column;gap:6px}.day.open .arrow{transform:rotate(90deg)}.arrow{display:inline-block;color:var(--muted);transition:transform .15s ease}.archive{display:flex;flex-direction:column;gap:7px}.small-summary{color:var(--muted);font:9px 'IBM Plex Mono',monospace;margin-top:5px}.error{border-left-color:var(--red);color:var(--red)}footer{padding-bottom:50px;color:var(--muted2);font-family:'IBM Plex Mono',monospace;font-size:9.5px;line-height:1.6}
@media(max-width:600px){.stats-grid{grid-template-columns:repeat(2,1fr)}header{padding-top:27px}.signal-row{grid-template-columns:minmax(0,1fr) auto}.result{grid-column:2}.hs{grid-column:2}.match{font-size:11.5px}.stat .value{font-size:19px}}@media(prefers-reduced-motion:reduce){.ticker-track,.live-dot{animation:none}}

.cta-row{
  display:flex;
  gap:9px;
  flex-wrap:wrap;
  margin-top:20px;
}
.cta{
  appearance:none;
  border:1px solid var(--line);
  border-radius:7px;
  padding:11px 15px;
  font-family:'Archivo',system-ui,sans-serif;
  font-size:12px;
  font-weight:800;
  text-decoration:none;
  cursor:pointer;
  transition:transform .08s ease,border-color .15s ease,background .15s ease;
}
.cta:active{transform:scale(.985)}
.cta-primary{
  background:var(--green);
  border-color:var(--green);
  color:#07140D;
}
.cta-secondary{
  background:var(--panel);
  color:var(--text);
}
.cta-secondary:hover{border-color:var(--amber)}
.cta-note{
  width:100%;
  color:var(--muted2);
  font-family:'IBM Plex Mono',monospace;
  font-size:9px;
  margin-top:1px;
}


.strong-window-badge{
  display:inline-flex;
  align-items:center;
  margin-left:6px;
  padding:3px 6px;
  border:1px solid rgba(242,169,59,.42);
  border-radius:4px;
  background:rgba(242,169,59,.07);
  color:var(--amber);
  font-family:'IBM Plex Mono',monospace;
  font-size:8px;
  font-weight:700;
  letter-spacing:.06em;
  vertical-align:middle;
}

</style>
</head>
<body>
<header><div class="eyebrow"><span class="live-dot"></span>LIVE FOOTBALL SIGNALS · NEXT GOAL HUNTER</div><h1>Next Goal <em>Hunter</em></h1><p class="subtitle">Real-time football signals powered by the Next Goal Hunter system. Follow every qualifying signal, review completed results, and explore transparent performance history day by day.</p>
<div class="cta-row">
  <a class="cta cta-primary" href="#" aria-label="Join Free Telegram">Join Free Telegram</a>
  <a class="cta cta-secondary" href="#" aria-label="Get Premium">Get Premium</a>
  <div class="cta-note">Free Telegram and Premium access are coming soon.</div>
</div>
</header>
<main class="wrap">
<div class="section-title"><h2>🔥 LIVE SIGNALS</h2><span id="liveCount">0 ACTIVE</span></div><div id="liveList" class="list"><div class="empty">Checking for live signals...</div></div>
<div class="section-title"><h2>📊 STATISTICS</h2><span>10′–21′ · HS ≥ 64</span></div><div class="period-tabs"><button class="chip active" data-days="today">TODAY</button><button class="chip" data-days="7">7 DAYS</button><button class="chip" data-days="30">30 DAYS</button><button class="chip" data-days="3650">ALL TIME</button></div>
<div class="stats-grid"><div class="stat"><div class="label">Signals</div><div class="value" id="sSignals">—</div></div><div class="stat green"><div class="label">Goal</div><div class="value" id="sGoals">—</div></div><div class="stat red"><div class="label">No Goal</div><div class="value" id="sNoGoals">—</div></div><div class="stat amber"><div class="label">Success</div><div class="value" id="sSuccess">—</div></div></div>
<div class="section-title"><h2>🗂 ARCHIVE</h2><span id="archiveMeta">BY DAY</span></div><div id="archive" class="archive"><div class="empty">Loading archive...</div></div>
</main>
<footer>
  <div style="color:var(--text);font-weight:700;margin-bottom:7px">NEXT GOAL HUNTER</div>
  <div>Real-time football signal tracking with transparent historical results.</div>
  <div style="margin-top:6px">1H · Entry 10′–21′ · Hunter Score ≥ 64</div>
  <div style="margin-top:12px;color:var(--muted2)">Past performance does not guarantee future results. Information shown on this website is for informational purposes only.</div>
</footer>

<script>
function isStrongWindow(item){
  const minute = Number(item?.entry_minute ?? item?.minute ?? 0);
  return minute >= 19 && minute <= 20;
}

const BASE='/free-channel';
let selectedDays='today';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

async function get(path){
  const r=await fetch(BASE+path,{cache:'no-store'});
  const t=await r.text();
  let d;
  try{d=JSON.parse(t)}catch{throw new Error('DATA API UNAVAILABLE')}
  if(!r.ok||d.success===false)throw new Error(d.error||('HTTP '+r.status));
  return d;
}

function resultText(x){
  if(x.result==='GOAL')return '⚽ GOAL'+(x.goal_minute!=null?' '+x.goal_minute+"'":'');
  if(x.result==='NO_GOAL')return 'NO GOAL';
  return 'TRACKING';
}

function row(x){
  const cls=x.result==='GOAL'?'goal':x.result==='NO_GOAL'?'no-goal':'tracking';
  const when=x.sofia_time?(x.sofia_time.time||'').slice(0,5):'';
  return '<div class="signal-row '+cls+'"><div><div class="league">'+esc(x.league||'LIVE')+'</div><div class="match">'+esc(x.match_name||'Unknown match')+'</div><div class="meta">ENTRY '+esc(x.entry_minute)+"' · "+esc(when)+' SOFIA</div></div><div class="hs">HS <b>'+esc(x.hunter_score)+'</b></div><div class="result">'+esc(resultText(x))+'</div></div>';
}

function renderLive(d){
  const a=d.candidates||[];
  document.getElementById('liveCount').textContent=a.length+' ACTIVE';
  document.getElementById('liveList').innerHTML=a.length?a.map(row).join(''):'<div class="empty">No live signals right now.</div>';
}

function groupByDay(a){
  const m={};
  for(const x of a){
    const k=x.sofia_time?.date||'UNKNOWN';
    (m[k]??=[]).push(x);
  }
  return m;
}

function renderStats(d){
  document.getElementById('sSignals').textContent=d.count??0;
  document.getElementById('sGoals').textContent=d.goals??0;
  document.getElementById('sNoGoals').textContent=d.no_goals??0;
  document.getElementById('sSuccess').textContent=d.success_pct==null?'—':d.success_pct+'%';
}

function todaySofia(){
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Sofia',
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).format(new Date());
}

function renderArchive(d){
  const today=todaySofia();

  // Archive contains every previous-day signal only.
  // Today's signals appear in LIVE/TODAY statistics and move here after midnight Sofia.
  const archived=(d.candidates||[]).filter(x=>{
    const day=x.sofia_time?.date||'';
    return day && day<today;
  });

  const groups=groupByDay(archived);
  const dates=Object.keys(groups).sort().reverse();

  document.getElementById('archiveMeta').textContent=
    dates.length+' DAYS · '+archived.length+' SIGNALS';

  document.getElementById('archive').innerHTML=dates.length
    ? dates.map((date,i)=>{
        const a=groups[date];
        const g=a.filter(x=>x.result==='GOAL').length;
        const n=a.filter(x=>x.result==='NO_GOAL').length;
        const c=g+n;
        const p=c?Math.round(g/c*1000)/10:null;

        return '<section class="day '+(i===0?'open':'')+'">'+
          '<button class="day-head">'+
            '<span><span class="arrow">▸</span> '+esc(date)+'</span>'+
            '<span class="right">'+a.length+' SIGNALS · '+g+'G / '+n+'NG'+(p==null?'':' · '+p+'%')+'</span>'+
          '</button>'+
          '<div class="day-body">'+a.map(row).join('')+'</div>'+
        '</section>';
      }).join('')
    : '<div class="empty">No completed days in the archive yet.</div>';

  document.querySelectorAll('.day-head').forEach(
    b=>b.onclick=()=>b.parentElement.classList.toggle('open')
  );
}

async function refreshLive(){
  try{
    renderLive(await get('/candidates'));
  }catch(e){
    document.getElementById('liveList').innerHTML=
      '<div class="empty error">Unable to load live signals.</div>';
  }
}

async function refreshStats(){
  try{
    const days=selectedDays==='today'?1:selectedDays;
    renderStats(await get('/history?days='+days));
  }catch(e){
    console.error('stats',e);
  }
}

async function refreshArchive(){
  try{
    renderArchive(await get('/history?days=3650'));
  }catch(e){
    document.getElementById('archive').innerHTML=
      '<div class="empty error">Unable to load archive.</div>';
  }
}

document.querySelectorAll('.chip[data-days]').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('.chip[data-days]').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    selectedDays=b.dataset.days==='today'?'today':Number(b.dataset.days);
    refreshStats();
  };
});

refreshLive();
refreshStats();
refreshArchive();

setInterval(refreshLive,30000);
setInterval(refreshStats,120000);
setInterval(refreshArchive,300000);

</script>
</body></html>`;
}

function html(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...corsHeaders()
    }
  });
}
function sofiaDateKey(value){
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"Europe/Sofia",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).format(d);
}

function todaySofiaKey(){
  return sofiaDateKey(new Date());
}

function isTodaySofia(item){
  const value = item?.created_at || item?.entry_at || item?.timestamp || "";
  return sofiaDateKey(value) === todaySofiaKey();
}

function completedPreviousDaysOnly(items){
  const today = todaySofiaKey();
  return (Array.isArray(items) ? items : []).filter(item => {
    const value = item?.created_at || item?.entry_at || item?.timestamp || "";
    const key = sofiaDateKey(value);
    return key && key < today;
  });
}


