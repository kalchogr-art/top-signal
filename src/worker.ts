    import { debugBetsafe } from "./odds/betsafe";
    import { debugCloudbet } from "./odds/cloudbet";

    // ============================================================
    // TOP SIGNAL V2.1.0 — BET READY TRACKER DASHBOARD
    //
    // AUTHORITATIVE SOURCE: BET TRACKER /entries
    //
    // Dashboard rule:
    //   1) show only Tracker rows with BET READY + real odds
    //   2) after confirmed bet -> BET PLACED
    //   3) BET PLACED stays visible while the same row exists in Tracker
    //   4) when Tracker removes the row, it disappears from dashboard
    //
    // NO MATCHER GATE IN DASHBOARD FLOW.
    // NO LOCAL PERSISTENCE IS USED TO KEEP A CARD AFTER TRACKER REMOVES IT.
    // ============================================================

    const VERSION = "V2.1.1 BET READY + DAILY ARCHIVE";
    const APP_NAME = "top-signal";
    const TIME_ZONE = "Europe/Sofia";

    type Obj = Record<string, any>;

    interface Env {
      DB: D1Database;
      TRACKER: Fetcher;
      MATCHER?: Fetcher; // kept optional so old wrangler binding does not need removal
      V27?: Fetcher;     // kept optional for compatibility; not required for cards
    }

    let tablesReady: Promise<void> | null = null;

    export default {
      async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: corsHeaders() });
        }

        try {
          if (!tablesReady) tablesReady = ensureTables(env);
          await tablesReady;
        } catch (error: any) {
          tablesReady = null;
          return json({
            success: false,
            worker: APP_NAME,
            version: VERSION,
            error: "DB_INIT_FAILED: " + (error?.message ?? String(error))
          }, 500);
        }

        // --------------------------------------------------------
        // STATUS
        // --------------------------------------------------------
        if (url.pathname === "/api/status") {
          return json({
            success: true,
            worker: APP_NAME,
            version: VERSION,
            source: "BET_TRACKER_ENTRIES",
            matcher_gate: false,
            rule: "BET_READY_WITH_ODDS_ONLY",
            placed_rule: "KEEP_ONLY_WHILE_PRESENT_IN_TRACKER",
            timezone: TIME_ZONE,
            bindings: {
              DB: !!env.DB,
              TRACKER: !!env.TRACKER,
              MATCHER: !!env.MATCHER,
              V27: !!env.V27
            }
          });
        }

        // --------------------------------------------------------
        // DEBUG BETSAFE / CLOUDBET — preserve existing helpers
        // --------------------------------------------------------
        if (url.pathname === "/api/debug/betsafe" && request.method === "GET") {
          try {
            const result = await debugBetsafe();
            return json(result, result?.success === false ? 502 : 200);
          } catch (error: any) {
            return json({ success: false, source: "BETSAFE", error: error?.message ?? String(error) }, 500);
          }
        }

        if (url.pathname === "/api/debug/cloudbet" && request.method === "GET") {
          try {
            const result = await debugCloudbet();
            return json(result, result?.success === false ? 502 : 200);
          } catch (error: any) {
            return json({ success: false, source: "CLOUDBET", error: error?.message ?? String(error) }, 500);
          }
        }

        // --------------------------------------------------------
        // DEBUG TRACKER
        // --------------------------------------------------------
        if (url.pathname === "/api/debug/tracker" && request.method === "GET") {
          try {
            const tracker = await fetchServiceJSON(env.TRACKER, "/entries");
            const records = extractTrackerRecords(tracker);
            const normalized = records.map(normalizeTrackerEntry).filter(Boolean);
            const ready = normalized.filter((x: any) => isBetReady(x));

            return json({
              success: true,
              version: VERSION,
              tracker_records: records.length,
              normalized_records: normalized.length,
              bet_ready_with_odds: ready.length,
              ready
            });
          } catch (error: any) {
            return json({ success: false, error: error?.message ?? String(error) }, 500);
          }
        }

        // Old route retained, but dashboard intentionally does NOT use Matcher.
        if (url.pathname === "/api/debug/matcher") {
          return json({
            success: true,
            disabled_for_dashboard: true,
            message: "V2.1.0 dashboard reads BET READY directly from Tracker /entries."
          });
        }

        // --------------------------------------------------------
        // TARGETS
        // --------------------------------------------------------
        if (url.pathname === "/api/targets" && request.method === "GET") {
          try {
            const result = await buildTargets(env);
            return json({
              success: true,
              version: VERSION,
              count: result.targets.length,
              tracker_records: result.trackerRecords,
              tracker_ready: result.trackerReady,
              placed: result.targets.filter((x: Obj) => x.betPlaced).length,
              targets: result.targets,
              timestamp: new Date().toISOString()
            });
          } catch (error: any) {
            return json({ success: false, targets: [], error: error?.message ?? String(error) }, 500);
          }
        }

        if (url.pathname === "/api/target" && request.method === "GET") {
          try {
            const result = await buildTargets(env);
            const target = result.targets[0] ?? null;
            return json({
              success: true,
              found: !!target,
              target,
              stats: {
                tracker_records: result.trackerRecords,
                tracker_ready: result.trackerReady,
                active_targets: result.targets.length,
                placed: result.targets.filter((x: Obj) => x.betPlaced).length
              },
              timestamp: new Date().toISOString()
            });
          } catch (error: any) {
            return json({ success: false, found: false, target: null, error: error?.message ?? String(error) }, 500);
          }
        }

        // --------------------------------------------------------
        // BET STATUS — called after browser/Monkey confirms the bet
        // --------------------------------------------------------
        if (url.pathname === "/api/bet-status" && request.method === "POST") {
          try {
            const body = await request.json<Obj>();
            const eventId = safe(body?.eventId);
            const status = safe(body?.status).toUpperCase();

            if (!eventId || (status !== "PLACED" && status !== "BET_PLACED")) {
              return json({ success: false, error: "INVALID_BET_STATUS_PAYLOAD" }, 400);
            }

            // Important safety check: only accept PLACED for an event that is
            // still present in Tracker. This prevents stale/manual event IDs.
            const tracker = await fetchServiceJSON(env.TRACKER, "/entries");
            const entries = extractTrackerRecords(tracker)
              .map(normalizeTrackerEntry)
              .filter(Boolean) as Obj[];

            const trackerEntry = entries.find(x => safe(x.cloudbet_event_id) === eventId);
            if (!trackerEntry) {
              return json({ success: false, error: "EVENT_NOT_PRESENT_IN_TRACKER" }, 409);
            }

            const odds = numberOrNull(body?.odds) ?? numberOrNull(trackerEntry.entry_odds);
            const stake = numberOrNull(body?.stake);
            const placedAt = safe(body?.placedAt) || new Date().toISOString();
            const source = safe(body?.source) || "CLOUDBET_FRONTEND";
            const now = new Date().toISOString();

            await env.DB.prepare(`
              INSERT INTO bet_status (
                event_id, match_name, status, market, selection,
                stake, odds, source, placed_at, created_at, updated_at
              ) VALUES (
                ?1, ?2, 'PLACED', '1st Half Total Goals', 'O 0.5',
                ?3, ?4, ?5, ?6, ?7, ?7
              )
              ON CONFLICT(event_id) DO UPDATE SET
                match_name = excluded.match_name,
                status = 'PLACED',
                stake = COALESCE(excluded.stake, bet_status.stake),
                odds = COALESCE(excluded.odds, bet_status.odds),
                source = excluded.source,
                placed_at = excluded.placed_at,
                updated_at = excluded.updated_at
            `).bind(
              eventId,
              trackerEntry.match_name,
              stake,
              odds,
              source,
              placedAt,
              now
            ).run();

            return json({
              success: true,
              action: "BET_PLACED_SAVED",
              eventId,
              matchName: trackerEntry.match_name,
              odds,
              status: "PLACED"
            });
          } catch (error: any) {
            return json({ success: false, error: error?.message ?? String(error) }, 500);
          }
        }

        if (url.pathname === "/api/bet-status" && request.method === "GET") {
          try {
            const eventId = safe(url.searchParams.get("eventId"));
            if (!eventId) return json({ success: false, error: "EVENT_ID_REQUIRED" }, 400);
            return json({ success: true, data: await getBetStatus(env, eventId) });
          } catch (error: any) {
            return json({ success: false, error: error?.message ?? String(error) }, 500);
          }
        }

        // Compatibility endpoint. Tracker odds are authoritative in V2.1.0.
        if (url.pathname === "/api/odds" && request.method === "GET") {
          try {
            const eventId = safe(url.searchParams.get("eventId"));
            if (!eventId) return json({ success: false, error: "EVENT_ID_REQUIRED" }, 400);
            const tracker = await fetchServiceJSON(env.TRACKER, "/entries");
            const entry = (extractTrackerRecords(tracker)
              .map(normalizeTrackerEntry)
              .filter(Boolean) as Obj[])
              .find(x => safe(x.cloudbet_event_id) === eventId);

            return json({
              success: true,
              data: entry ? {
                event_id: eventId,
                match_name: entry.match_name,
                over_odds: entry.entry_odds,
                source: "BET_TRACKER"
              } : null
            });
          } catch (error: any) {
            return json({ success: false, error: error?.message ?? String(error) }, 500);
          }
        }

        if (url.pathname === "/" || url.pathname === "/dashboard") {
          return new Response(renderHtml(), {
            headers: {
              "content-type": "text/html; charset=UTF-8",
              "cache-control": "no-store"
            }
          });
        }

        return json({ success: false, error: "NOT_FOUND" }, 404);
      }
    };

    // ============================================================
    // D1
    // ============================================================

    async function ensureTables(env: Env) {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS bet_status (
          event_id TEXT PRIMARY KEY,
          match_name TEXT,
          status TEXT NOT NULL,
          market TEXT,
          selection TEXT,
          stake REAL,
          odds REAL,
          source TEXT,
          placed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `).run();
    }

    async function getBetStatus(env: Env, eventId: string): Promise<any> {
      return await env.DB.prepare(`
        SELECT * FROM bet_status WHERE event_id = ?1 LIMIT 1
      `).bind(eventId).first();
    }

    // ============================================================
    // TARGET BUILD — TRACKER IS THE ONLY TARGET SOURCE
    // ============================================================

    async function buildTargets(env: Env) {
      const tracker = await fetchServiceJSON(env.TRACKER, "/entries");
      const rawRecords = extractTrackerRecords(tracker);
      const entries = rawRecords
        .map(normalizeTrackerEntry)
        .filter(Boolean) as Obj[];

      const targets: Obj[] = [];
      let trackerReady = 0;

      for (const entry of entries) {
        const eventId = safe(entry.cloudbet_event_id);
        const odds = numberOrNull(entry.entry_odds);

        if (!eventId) continue;

        const betRow = await getBetStatus(env, eventId);
        const betPlaced = safe(betRow?.status).toUpperCase() === "PLACED";
        const ready = isBetReady(entry);

        if (ready) trackerReady++;

        // Before placement: ONLY real BET READY + odds.
        // After placement: keep the card while this Tracker row exists.
        if (!ready && !betPlaced) continue;

        // A ready card must always have real odds.
        // A placed card can use the saved bet odds as fallback.
        const displayOdds = betPlaced
          ? (numberOrNull(betRow?.odds) ?? odds)
          : odds;

        if (displayOdds === null || displayOdds <= 1) continue;

        const currentMinute =
          numberOrNull(entry.current_minute) ??
          numberOrNull(entry.minute) ??
          numberOrNull(entry.entry_minute);

        const minuteDisplay =
          safe(entry.current_minute_display) ||
          safe(entry.minute_display) ||
          (currentMinute !== null ? String(Math.floor(currentMinute)) + "'" : "—");

        targets.push({
          eventId,
          matchId: safe(entry.match_id),
          signalId: safe(entry.id),
          matchName: safe(entry.match_name) || "Hunter target",

          // Fields kept compatible with existing Monkey/browser flow.
          minute: numberOrNull(entry.entry_minute),
          liveMinute: currentMinute,
          liveMinuteDisplay: minuteDisplay,
          hunterScore: numberOrNull(entry.hunter_score),

          overOdds: displayOdds,
          entryOdds: odds,
          oddsSource: "BET_TRACKER",

          betReady: ready && !betPlaced,
          betPlaced,
          betStatus: betPlaced ? "PLACED" : "READY_TO_BET",
          betPlacedAt: betRow?.placed_at ?? null,
          betStake: numberOrNull(betRow?.stake),
          betOdds: numberOrNull(betRow?.odds) ?? displayOdds,

          // BET NOW is allowed only until confirmation is received.
          canAct: ready && !betPlaced,
          button: betPlaced ? "BET PLACED" : "BET NOW",

          trackerPresent: true,
          trackerStatus: safe(entry.status),
          trackerBetStatus: safe(entry.bet_status),

          // Compatibility fields expected by older frontend/userscript versions.
          secureMatch: true,
          classification: "TRACKER_BET_READY",
          liveFeedOk: true,
          liveFound: true,
          liveReason: betPlaced ? "BET_PLACED" : "BET_READY"
        });
      }

      // Nothing is appended from D1 here.
      // Therefore a PLACED card disappears automatically as soon as Tracker
      // stops returning that match in /entries.

      targets.sort((a, b) => {
        if (a.betPlaced && !b.betPlaced) return -1;
        if (b.betPlaced && !a.betPlaced) return 1;
        return (numberOrNull(b.liveMinute) ?? 0) - (numberOrNull(a.liveMinute) ?? 0);
      });

      return {
        trackerRecords: entries.length,
        trackerReady,
        targets
      };
    }

    function isBetReady(entry: Obj): boolean {
      const odds = numberOrNull(entry.entry_odds);
      const eventId = safe(entry.cloudbet_event_id);
      const betStatus = safe(entry.bet_status).toUpperCase();

      return (
        entry.bet_ready === true &&
        betStatus === "READY_TO_BET" &&
        !!eventId &&
        odds !== null &&
        odds > 1
      );
    }

    // ============================================================
    // TRACKER PARSING
    // ============================================================

    function extractTrackerRecords(data: any): Obj[] {
      const arrays: any[][] = [];

      // Merge all known shapes instead of old else-if behavior.
      if (Array.isArray(data)) arrays.push(data);
      if (Array.isArray(data?.signals)) arrays.push(data.signals);
      if (Array.isArray(data?.entries)) arrays.push(data.entries);
      if (Array.isArray(data?.hunter_entries)) arrays.push(data.hunter_entries);
      if (Array.isArray(data?.data)) arrays.push(data.data);

      const out: Obj[] = [];
      const seen = new Set<string>();

      for (const arr of arrays) {
        for (const value of arr) {
          if (!value || typeof value !== "object") continue;

          const key =
            safe(value?.id) ||
            safe(value?.match_id) ||
            safe(value?.cloudbet_event_id) ||
            [safe(value?.match_name ?? value?.match), safe(value?.entry_time)].join("|");

          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(value);
        }
      }

      return out;
    }

    function normalizeTrackerEntry(x: Obj): Obj | null {
      if (!x || typeof x !== "object") return null;

      const matchName = safe(x?.match_name ?? x?.match);
      if (!matchName) return null;

      const entryOdds = numberOrNull(
        x?.entry_odds ??
        x?.entryOdds ??
        x?.odds ??
        x?.cloudbet?.entry_odds ??
        x?.cloudbet?.entryOdds
      );

      const eventId = safe(
        x?.cloudbet_event_id ??
        x?.cloudbet?.event_id ??
        x?.cloudbet?.eventId ??
        x?.cloudbet?.id
      );

      return {
        ...x,
        id: x?.id ?? null,
        match_id: safe(x?.match_id),
        match_name: matchName,
        status: safe(x?.status) || "TRACKING",

        entry_minute: numberOrNull(x?.entry_minute ?? x?.minute),
        current_minute: numberOrNull(
          x?.current_minute ??
          x?.live_minute ??
          x?.minute
        ),
        current_minute_display: safe(
          x?.current_minute_display ??
          x?.live_minute_display ??
          x?.minute_display
        ),

        hunter_score: numberOrNull(x?.hunter_score ?? x?.goal_signal?.score),
        cloudbet_event_id: eventId,
        entry_odds: entryOdds,

        odds_available:
          x?.odds_available === true ||
          Number(x?.odds_available || 0) === 1 ||
          (entryOdds !== null && entryOdds > 1),

        bet_ready: x?.bet_ready === true,
        bet_status: safe(x?.bet_status).toUpperCase()
      };
    }

    // ============================================================
    // SERVICE FETCH
    // ============================================================

    async function fetchServiceJSON(service: Fetcher, path: string): Promise<any> {
      const response = await service.fetch(
        new Request("https://internal" + path, {
          method: "GET",
          headers: {
            accept: "application/json",
            "cache-control": "no-store"
          }
        })
      );

      const text = await response.text();

      if (!response.ok) {
        throw new Error("HTTP " + response.status + ": " + text.slice(0, 500));
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new Error("INVALID_JSON: " + text.slice(0, 500));
      }
    }

    // ============================================================
    // DASHBOARD
    // ============================================================

    function renderHtml(): string {
      return `<!doctype html>
    <html lang="bg">
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <title>BET SIGNAL</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;background:#0b0f14;color:#eef3f8;font-family:Arial,Helvetica,sans-serif}
      .wrap{max-width:760px;margin:0 auto;padding:14px}
      .head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}
      h1{font-size:22px;margin:0}.sub{font-size:12px;color:#91a0b2;margin-top:4px}
      .count{background:#18212c;border:1px solid #2b3949;border-radius:999px;padding:7px 11px;font-weight:700}
      #error{display:none;background:#3b1717;border:1px solid #713030;padding:10px;border-radius:10px;margin-bottom:12px}
      .empty{padding:30px 14px;text-align:center;color:#8291a4;border:1px dashed #2b3949;border-radius:14px}
      .card{background:#121923;border:1px solid #263343;border-radius:14px;padding:14px;margin-bottom:10px}
      .match{font-size:18px;font-weight:800;line-height:1.25;margin-bottom:12px}
      .row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
      .box{background:#0d131b;border:1px solid #202c3a;border-radius:10px;padding:10px}
      .label{font-size:11px;color:#8291a4;text-transform:uppercase;margin-bottom:4px}
      .value{font-size:20px;font-weight:800}
      .odds{font-size:24px}
      button{width:100%;border:0;border-radius:11px;padding:14px 12px;font-size:17px;font-weight:900;cursor:pointer}
      .betnow{background:#e9f2ff;color:#07111e}
      .placed{background:#183523;color:#7ef0a4;cursor:default}
      .disabled{opacity:.55;cursor:not-allowed}
      .foot{font-size:11px;color:#697789;text-align:center;margin-top:16px}
    </style>
    </head>
    <body>
    <div class="wrap">
      <div class="head">
        <div><h1>BET SIGNAL</h1><div class="sub">BET READY + ODDS от Bet Tracker</div></div>
        <div class="count" id="count">0</div>
      </div>
      <div id="error"></div>
      <div id="list"><div class="empty">Зареждане…</div></div>
      <div class="foot">${VERSION}</div>
    </div>
    <script>
    const POLL_MS = 5000;
    let loading = false;
    let lastTargets = [];

    function esc(v){return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    function odds(v){const n=Number(v);return Number.isFinite(n)?n.toFixed(2):'—';}

    function render(targets){
      lastTargets = targets;
      document.getElementById('count').textContent = String(targets.length);
      const list=document.getElementById('list');
      if(!targets.length){list.innerHTML='<div class="empty">Няма BET READY мачове с наличен odds.</div>';return;}

      list.innerHTML=targets.map(t=>{
        const placed=t.betPlaced===true;
        const minute=esc(t.liveMinuteDisplay || (t.liveMinute!=null?Math.floor(Number(t.liveMinute))+"'":'—'));
        return '<div class="card" data-event="'+esc(t.eventId)+'">'+
          '<div class="match">'+esc(t.matchName)+'</div>'+
          '<div class="row">'+
            '<div class="box"><div class="label">Минута</div><div class="value">'+minute+'</div></div>'+
            '<div class="box"><div class="label">Odds · 1H O0.5</div><div class="value odds">'+odds(t.overOdds)+'</div></div>'+
          '</div>'+
          (placed
            ? '<button class="placed" disabled>✓ BET PLACED</button>'
            : '<button class="betnow" onclick="betNow(\''+esc(t.eventId)+'\')">BET NOW</button>')+
          '</div>';
      }).join('');
    }

    async function load(){
      if(loading)return;
      loading=true;
      try{
        const r=await fetch('/api/targets?ts='+Date.now(),{cache:'no-store'});
        const j=await r.json();
        if(!r.ok||j.success===false)throw new Error(j.error||('HTTP '+r.status));
        document.getElementById('error').style.display='none';
        render(Array.isArray(j.targets)?j.targets:[]);
      }catch(e){
        const el=document.getElementById('error');
        el.textContent='Target refresh error: '+(e?.message||String(e));
        el.style.display='block';
        if(!lastTargets.length)document.getElementById('list').innerHTML='<div class="empty">Няма заредени данни.</div>';
      }finally{loading=false;}
    }

    function betNow(eventId){
      const t=lastTargets.find(x=>String(x.eventId)===String(eventId));
      if(!t||t.betPlaced||!t.canAct)return;

      // The existing browser/userscript can listen for this event.
      // Worker itself DOES NOT submit a wager.
      window.dispatchEvent(new CustomEvent('TOP_SIGNAL_BET_NOW',{detail:t}));

      // Compatibility handoff for scripts reading localStorage.
      try{
        localStorage.setItem('top_signal_bet_now',JSON.stringify({...t,requestedAt:new Date().toISOString()}));
      }catch{}

      const btn=document.querySelector('[data-event="'+CSS.escape(String(eventId))+'"] .betnow');
      if(btn){btn.textContent='OPENING…';btn.classList.add('disabled');setTimeout(()=>{btn.textContent='BET NOW';btn.classList.remove('disabled');},4000);}
    }

    // Userscript/browser can call this after Cloudbet confirms placement.
    window.topSignalBetPlaced = async function(payload){
      const body={
        eventId:String(payload?.eventId||''),
        status:'PLACED',
        odds:payload?.odds ?? null,
        stake:payload?.stake ?? null,
        placedAt:payload?.placedAt ?? new Date().toISOString(),
        source:payload?.source ?? 'CLOUDBET_FRONTEND'
      };
      const r=await fetch('/api/bet-status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const j=await r.json();
      if(!r.ok||j.success===false)throw new Error(j.error||('HTTP '+r.status));
      await load();
      return j;
    };

    load();
    setInterval(load,POLL_MS);
    </script>
    </body>
    </html>`;
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function safe(value: any): string {
      if (value === null || value === undefined) return "";
      return String(value).trim();
    }

    function numberOrNull(value: any): number | null {
      if (value === null || value === undefined || value === "") return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }

    function corsHeaders(): Record<string, string> {
      return {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
        "cache-control": "no-store"
      };
    }

    function json(data: any, status = 200): Response {
      return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          ...corsHeaders()
        }
      });
    }
