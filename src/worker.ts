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

        const VERSION = "V2.1.4 BET NOW V7.9 HANDOFF";
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
            // DAILY ARCHIVE
            // --------------------------------------------------------
            if (url.pathname === "/api/daily" && request.method === "GET") {
              try {
                const matches = await getDailyMatches(env);
                return json({
                  success: true,
                  version: VERSION,
                  date: sofiaDate(),
                  timezone: TIME_ZONE,
                  summary: buildDailySummary(matches),
                  matches
                });
              } catch (error: any) {
                return json({ success: false, matches: [], error: error?.message ?? String(error) }, 500);
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

                await env.DB.prepare(`
                  UPDATE daily_matches
                  SET
                    bet_status = 'PLACED',
                    bet_odds = COALESCE(?2, bet_odds, found_odds),
                    bet_stake = COALESCE(?3, bet_stake),
                    placed_at = ?4,
                    updated_at = ?5
                  WHERE event_id = ?1
                `).bind(eventId, odds, stake, placedAt, now).run();

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

          await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS daily_matches (
              event_id TEXT PRIMARY KEY,
              signal_id TEXT,
              match_id TEXT,
              match_name TEXT NOT NULL,
              entry_minute REAL,
              hunter_score REAL,
              found_odds REAL,
              bet_status TEXT NOT NULL DEFAULT 'NOT_PLACED',
              bet_odds REAL,
              bet_stake REAL,
              tracker_status TEXT DEFAULT 'PENDING',
              tracker_result TEXT DEFAULT 'PENDING',
              result_status TEXT DEFAULT 'PENDING',
              day_key TEXT NOT NULL,
              entry_time TEXT,
              placed_at TEXT,
              first_seen_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              finished_at TEXT
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

          // Archive is independent from BET READY. Every Tracker entry is stored.
          for (const entry of entries) {
            await upsertDailyFromTrackerEntry(env, entry);
          }

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
        // DAILY ARCHIVE
        // ============================================================

        async function upsertDailyFromTrackerEntry(env: Env, entry: Obj) {
          const cloudbetId = safe(entry?.cloudbet_event_id);
          const signalId = safe(entry?.id);
          const matchId = safe(entry?.match_id);
          const matchName = safe(entry?.match_name ?? entry?.match);
          if (!matchName) return;

          const eventId =
            cloudbetId ||
            ("TRACKER:" + (signalId || matchId || normalizeName(matchName)));

          const now = new Date().toISOString();
          const entryTime = safe(entry?.entry_time ?? entry?.created_at);
          const dayKey = sofiaDate(entryTime || now);
          const odds = numberOrNull(entry?.entry_odds);
          const state = normalizeTrackerResult(entry);
          const bet = cloudbetId ? await getBetStatus(env, cloudbetId) : null;
          const placed = safe(bet?.status).toUpperCase() === "PLACED";

          await env.DB.prepare(`
            INSERT INTO daily_matches (
              event_id, signal_id, match_id, match_name,
              entry_minute, hunter_score, found_odds,
              bet_status, bet_odds, bet_stake,
              tracker_status, tracker_result, result_status,
              day_key, entry_time, placed_at,
              first_seen_at, updated_at, finished_at
            ) VALUES (
              ?1, ?2, ?3, ?4,
              ?5, ?6, ?7,
              ?8, ?9, ?10,
              ?11, ?12, ?13,
              ?14, ?15, ?16,
              ?17, ?17, ?18
            )
            ON CONFLICT(event_id) DO UPDATE SET
              signal_id = COALESCE(excluded.signal_id, daily_matches.signal_id),
              match_id = COALESCE(excluded.match_id, daily_matches.match_id),
              match_name = excluded.match_name,
              entry_minute = COALESCE(excluded.entry_minute, daily_matches.entry_minute),
              hunter_score = COALESCE(excluded.hunter_score, daily_matches.hunter_score),
              found_odds = COALESCE(excluded.found_odds, daily_matches.found_odds),
              bet_status = CASE
                WHEN daily_matches.bet_status = 'PLACED' THEN 'PLACED'
                ELSE excluded.bet_status
              END,
              bet_odds = COALESCE(daily_matches.bet_odds, excluded.bet_odds),
              bet_stake = COALESCE(daily_matches.bet_stake, excluded.bet_stake),
              tracker_status = excluded.tracker_status,
              tracker_result = excluded.tracker_result,
              result_status = CASE
                WHEN excluded.result_status IN ('WIN','LOSS') THEN excluded.result_status
                ELSE daily_matches.result_status
              END,
              placed_at = COALESCE(daily_matches.placed_at, excluded.placed_at),
              updated_at = excluded.updated_at,
              finished_at = COALESCE(daily_matches.finished_at, excluded.finished_at)
          `).bind(
            eventId, signalId || null, matchId || null, matchName,
            numberOrNull(entry?.entry_minute), numberOrNull(entry?.hunter_score), odds,
            placed ? "PLACED" : "NOT_PLACED",
            numberOrNull(bet?.odds), numberOrNull(bet?.stake),
            state.trackerStatus, state.trackerResult, state.resultStatus,
            dayKey, entryTime || null, bet?.placed_at ?? null, now,
            state.resultStatus === "PENDING" ? null : now
          ).run();
        }

        function normalizeTrackerResult(record: Obj) {
          const status = safe(record?.status).toUpperCase();
          const result = safe(record?.result).toUpperCase();
          const action = safe(record?.action).toUpperCase();
          const type = safe(record?.type).toUpperCase();
          const text = [status, result, action, type].join(" ").replace(/_/g, " ");

          if (text.includes("NO GOAL") || text.includes("NO-GOAL")) {
            return { trackerStatus: status || "FINISHED", trackerResult: result || "NO GOAL", resultStatus: "LOSS" };
          }
          if (text.includes("GOAL HIT") || /\bGOAL\b/.test(text)) {
            return { trackerStatus: status || "FINISHED", trackerResult: result || "GOAL HIT", resultStatus: "WIN" };
          }
          return { trackerStatus: status || "TRACKING", trackerResult: result || "PENDING", resultStatus: "PENDING" };
        }

        async function getDailyMatches(env: Env): Promise<Obj[]> {
          const result = await env.DB.prepare(`
            SELECT * FROM daily_matches
            WHERE day_key = ?1
            ORDER BY COALESCE(entry_time, first_seen_at) DESC, first_seen_at DESC
          `).bind(sofiaDate()).all();
          return Array.isArray(result?.results) ? result.results as Obj[] : [];
        }

        function buildDailySummary(matches: Obj[]) {
          const placed = matches.filter(x => safe(x?.bet_status).toUpperCase() === "PLACED");
          const wins = placed.filter(x => safe(x?.result_status).toUpperCase() === "WIN").length;
          const losses = placed.filter(x => safe(x?.result_status).toUpperCase() === "LOSS").length;
          const pending = placed.filter(x => safe(x?.result_status).toUpperCase() === "PENDING").length;
          const settled = wins + losses;
          return {
            today: matches.length, placed: placed.length, wins, losses, pending,
            notPlaced: matches.length - placed.length,
            successRate: settled ? (wins / settled) * 100 : null
          };
        }

        function sofiaDate(value?: string): string {
          const date = value ? new Date(value) : new Date();
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
          }).formatToParts(date);
          const map: Obj = {};
          for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
          return `${map.year}-${map.month}-${map.day}`;
        }

        function normalizeName(value: any): string {
          return safe(value).toLowerCase().normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
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
    *{box-sizing:border-box}body{margin:0;background:#0b0f14;color:#eef3f8;font-family:Arial,Helvetica,sans-serif}
    .wrap{max-width:760px;margin:0 auto;padding:14px}.head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}
    h1{font-size:22px;margin:0}.sub{font-size:12px;color:#91a0b2;margin-top:4px}.count{background:#18212c;border:1px solid #2b3949;border-radius:999px;padding:7px 11px;font-weight:700}
    #error{display:none;background:#3b1717;border:1px solid #713030;padding:10px;border-radius:10px;margin-bottom:12px;font-size:12px}
    .empty{padding:24px 14px;text-align:center;color:#8291a4;border:1px dashed #2b3949;border-radius:14px}.card{background:#121923;border:1px solid #263343;border-radius:14px;padding:14px;margin-bottom:10px}
    .card.placed{border-color:#166534;background:#101d16}.match{font-size:17px;font-weight:800;margin-bottom:12px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
    .box{background:#0d131b;border:1px solid #202c3a;border-radius:10px;padding:10px}.label{font-size:10px;color:#8291a4;text-transform:uppercase;margin-bottom:4px}.value{font-size:20px;font-weight:800}.odds{font-size:24px}
    button{width:100%;border:0;border-radius:11px;padding:14px 12px;font-size:16px;font-weight:900;cursor:pointer}.betnow{background:#16a34a;color:#fff}.placedBtn{background:#14532d;color:#bbf7d0}
    .daily{margin-top:16px;background:#121923;border:1px solid #263343;border-radius:14px;overflow:hidden}.dailyHead{background:#121923;color:#fff;display:flex;justify-content:space-between;padding:13px 14px}
    .dailyBody{display:none;border-top:1px solid #263343;padding:10px}.daily.open .dailyBody{display:block}.dailySummary{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:8px}
    .ds{background:#0d131b;border-radius:8px;padding:7px;font-size:10px;display:flex;justify-content:space-between}.dailyRow{padding:9px 2px;border-top:1px solid #202c3a}.dailyMatch{font-size:11px;font-weight:800}
    .dailyStatus{margin-top:4px;font-size:9px;color:#91a0b2;display:flex;gap:7px;flex-wrap:wrap}.win{color:#4ade80;font-weight:900}.loss{color:#f87171;font-weight:900}.pending{color:#fbbf24;font-weight:900}
    .foot{font-size:10px;color:#697789;text-align:center;margin-top:16px}
    </style></head><body><div class="wrap">
    <div class="head"><div><h1>BET SIGNAL</h1><div class="sub">BET READY + ODDS от Bet Tracker</div></div><div class="count" id="count">0</div></div>
    <div id="error"></div><div id="list"><div class="empty">Зареждане…</div></div>
    <div id="daily" class="daily"><button id="dailyHead" class="dailyHead" type="button"><span>📊 ДНЕШНИ МАЧОВЕ · <span id="dailyCount">0</span></span><span id="dailyArrow">▸</span></button>
    <div class="dailyBody"><div id="dailySummary" class="dailySummary"></div><div id="dailyList"></div></div></div>
    <div class="foot">${VERSION}</div></div>
    <script>
    (function(){
    var loading=false,dailyLoading=false,lastTargets=[],dailyOpen=false;
    function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function num(v){var x=Number(v);return isFinite(x)?x:null;}
    function renderTargets(a){lastTargets=a;document.getElementById('count').textContent=String(a.length);var el=document.getElementById('list');if(!a.length){el.innerHTML='<div class="empty">Няма BET READY сигнали с odds.</div>';return;}var h='';for(var i=0;i<a.length;i++){var t=a[i],p=t.betPlaced===true,o=num(t.overOdds),m=t.liveMinuteDisplay||(t.liveMinute!=null?Math.floor(Number(t.liveMinute))+"'":(t.minute!=null?t.minute+"'":'—'));h+='<div class="card '+(p?'placed':'')+'"><div class="match">⚽ '+esc(t.matchName)+'</div><div class="row"><div class="box"><div class="label">Минута</div><div class="value">'+esc(m)+'</div></div><div class="box"><div class="label">Odds · 1H O0.5</div><div class="value odds">'+(o!==null?o.toFixed(2):'—')+'</div></div></div>'+(p?'<button class="placedBtn" disabled>✅ BET PLACED</button>':'<button class="betnow" data-bet-id="'+esc(t.eventId)+'">BET NOW</button>')+'</div>';}el.innerHTML=h;}
    async function loadTargets(){if(loading)return;loading=true;try{var r=await fetch('/api/targets?ts='+Date.now(),{cache:'no-store'}),j=await r.json();if(!r.ok||j.success===false)throw new Error(j.error||('HTTP '+r.status));document.getElementById('error').style.display='none';renderTargets(Array.isArray(j.targets)?j.targets:[]);}catch(e){var er=document.getElementById('error');er.textContent='Target refresh error: '+(e&&e.message?e.message:String(e));er.style.display='block';if(!lastTargets.length)document.getElementById('list').innerHTML='<div class="empty">Няма BET READY сигнали с odds.</div>';}finally{loading=false;}}
    function summary(s){var rate=s.successRate==null?'—':Number(s.successRate).toFixed(1)+'%',r=[['ДНЕС',s.today||0],['ЗАЛОЖЕНИ',s.placed||0],['ПЕЧЕЛИ',s.wins||0],['НЕ ПЕЧЕЛИ',s.losses||0],['PENDING',s.pending||0],['УСПЕХ',rate]],h='';for(var i=0;i<r.length;i++)h+='<div class="ds"><span>'+esc(r[i][0])+'</span><strong>'+esc(r[i][1])+'</strong></div>';return h;}
    function renderDaily(a){document.getElementById('dailyCount').textContent=String(a.length);var el=document.getElementById('dailyList');if(!a.length){el.innerHTML='<div class="empty">Още няма мачове за днес.</div>';return;}var h='';for(var i=0;i<a.length;i++){var m=a[i],p=String(m.bet_status||'').toUpperCase()==='PLACED',res=String(m.result_status||'PENDING').toUpperCase(),o=num(p?(m.bet_odds!=null?m.bet_odds:m.found_odds):m.found_odds),cls='',txt='—';if(p){if(res==='WIN'){cls='win';txt='✅ ПЕЧЕЛИ';}else if(res==='LOSS'){cls='loss';txt='❌ НЕ ПЕЧЕЛИ';}else{cls='pending';txt='⏳ PENDING';}}h+='<div class="dailyRow"><div class="dailyMatch">'+esc(m.match_name)+'</div><div class="dailyStatus"><span>'+(o!==null?'@'+o.toFixed(2):'@—')+'</span><span>'+(p?'ЗАЛОЖЕН':'НЕЗАЛОЖЕН')+'</span><span class="'+cls+'">'+txt+'</span></div></div>';}el.innerHTML=h;}
    async function loadDaily(){if(dailyLoading)return;dailyLoading=true;try{var r=await fetch('/api/daily?ts='+Date.now(),{cache:'no-store'}),j=await r.json();if(!r.ok||j.success===false)throw new Error(j.error||('HTTP '+r.status));document.getElementById('dailySummary').innerHTML=summary(j.summary||{});renderDaily(Array.isArray(j.matches)?j.matches:[]);}catch(e){document.getElementById('dailyList').innerHTML='<div class="empty">Грешка при зареждане на архива.</div>';}finally{dailyLoading=false;}}
    document.getElementById('dailyHead').addEventListener('click',function(){dailyOpen=!dailyOpen;document.getElementById('daily').classList.toggle('open',dailyOpen);document.getElementById('dailyArrow').textContent=dailyOpen?'▾':'▸';});
    document.addEventListener('click',function(e){var b=e.target.closest?e.target.closest('[data-bet-id]'):null;if(!b)return;var id=b.getAttribute('data-bet-id'),t=null;for(var i=0;i<lastTargets.length;i++)if(String(lastTargets[i].eventId)===String(id)){t=lastTargets[i];break;}if(!t||t.betPlaced||t.canAct!==true)return;
    var eventId=String(t.eventId||'').trim();
    if(!eventId)return;
    var launch=Date.now();
    var q='markets-tab=goals&ts-action=bet&ts-event='+encodeURIComponent(eventId)+'&ts-launch='+launch;
    var cloudbet='https://www.cloud0007.com/en/sports/soccer/live/'+encodeURIComponent(eventId)+'?'+q+'#ts-action=bet&ts-event='+encodeURIComponent(eventId);
    try{
      window.name='TOP_SIGNAL::bet::'+eventId;
      sessionStorage.setItem('topSignalActionV79','bet');
      sessionStorage.setItem('topSignalEventV79',eventId);
      localStorage.setItem('top_signal_bet_now',JSON.stringify({eventId:eventId,matchName:t.matchName,odds:t.overOdds,minute:t.liveMinuteDisplay||t.liveMinute||t.minute,requestedAt:new Date().toISOString()}));
    }catch(err){}
    window.location.href=cloudbet;});
    window.topSignalBetPlaced=async function(p){p=p||{};var body={eventId:String(p.eventId||''),status:'PLACED',odds:p.odds==null?null:p.odds,stake:p.stake==null?null:p.stake,placedAt:p.placedAt||new Date().toISOString(),source:p.source||'CLOUDBET_FRONTEND'};var r=await fetch('/api/bet-status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!r.ok||j.success===false)throw new Error(j.error||('HTTP '+r.status));await loadTargets();await loadDaily();return j;};
    loadTargets();loadDaily();setInterval(loadTargets,5000);setInterval(loadDaily,30000);
    })();
    </script></body></html>`;
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
