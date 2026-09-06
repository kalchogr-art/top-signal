import { debugBetsafe } from "./odds/betsafe";

// ============================================================
// TOP SIGNAL V2.0.1 — DAILY LOG + ANTI-OVERLAP
//
// TRACKER -> MATCHER -> DASHBOARD
// -> CHECK ODDS / BET NOW HANDOFF
//
// V2.0.1:
// - TARGET polling: 10s
// - DAILY polling: 30s
// - no overlapping browser refresh requests
// - temporary target error keeps last rendered targets
// - D1 live_odds + bet_status + daily_matches
// - secure CONFIDENT_MATCH targets only
// - Europe/Sofia daily log
//
// IMPORTANT:
// - final bet submit is NOT performed by this Worker
// - browser/Monkey logic is unchanged
// ============================================================

const VERSION = "V2.0.4 LIVE V27 STATE";
const APP_NAME = "top-signal";
const TIME_ZONE = "Europe/Sofia";

type Obj = Record<string, any>;

interface Env {
  DB: D1Database;
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  // Optional. If not bound, Worker falls back to the public V27 endpoint.
  V27?: Fetcher;
}

let tablesReady: Promise<void> | null = null;


// ============================================================
// MAIN
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    try {
      if (!tablesReady) {
        tablesReady = ensureTables(env);
      }

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

    // ========================================================
    // DEBUG BETSAFE — READ ONLY
    // ========================================================

    if (
      url.pathname === "/api/debug/betsafe" &&
      request.method === "GET"
    ) {
      try {
        const result = await debugBetsafe();

        return json(
          result,
          result?.success === false ? 502 : 200
        );

      } catch (error: any) {
        return json({
          success: false,
          source: "BETSAFE",
          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }

    // STATUS
    if (url.pathname === "/api/status") {
      return json({
        success: true,
        worker: APP_NAME,
        version: VERSION,
        mode: "MANUAL_TARGET_CONTROL",
        betting: "FINAL_SUBMIT_DISABLED",
        storage: "D1",
        daily_log: true,
        anti_overlap: true,
        timezone: TIME_ZONE,
        live_state: "V27_CURRENT_MINUTE_SCORE",
        bindings: {
          DB: !!env.DB,
          TRACKER: !!env.TRACKER,
          MATCHER: !!env.MATCHER,
          V27: !!env.V27
        },
        polling: {
          targets_ms: 10000,
          daily_ms: 30000
        },
        flow: "TRACKER -> MATCHER -> TOP SIGNAL -> DAILY LOG"
      });
    }

    // DEBUG TRACKER
    if (url.pathname === "/api/debug/tracker") {
      try {
        const data = await fetchServiceJSON(env.TRACKER, "/entries");
        const signals = extractHunterSignals(data);
        const records = extractTrackerRecords(data);

        return json({
          success: true,
          signals_found: signals.length,
          tracker_records: records.length,
          signals,
          records
        });
      } catch (error: any) {
        return json({
          success: false,
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    // DEBUG MATCHER
    if (url.pathname === "/api/debug/matcher") {
      try {
        const tracker = await fetchServiceJSON(env.TRACKER, "/entries");
        const signals = extractHunterSignals(tracker);
        const matcher = await callMatcher(env, signals);

        return json({
          success: true,
          tracker_signals: signals.length,
          matcher_version: matcher?.version ?? null,
          matcher_stats: matcher?.stats ?? null,
          hunter_results: matcher?.hunter_results ?? []
        });
      } catch (error: any) {
        return json({
          success: false,
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    // PRIMARY TARGET
    if (url.pathname === "/api/target" && request.method === "GET") {
      try {
        const result = await buildTargets(env);
        const target = result.targets[0] ?? null;

        return json({
          success: true,
          found: !!target,
          target,
          stats: {
            tracker_signals: result.trackerSignals,
            matcher_hunter_results: result.matcherHunterResults,
            secure_targets: result.targets.length,
            placed: result.targets.filter(x => x.betPlaced).length,
            live_feed_ok: result.liveFeedOk,
            live_matches: result.liveMatches
          },
          timestamp: new Date().toISOString()
        });
      } catch (error: any) {
        return json({
          success: false,
          found: false,
          target: null,
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    // ALL TARGETS
    if (url.pathname === "/api/targets" && request.method === "GET") {
      try {
        const result = await buildTargets(env);

        return json({
          success: true,
          version: VERSION,
          count: result.targets.length,
          tracker_signals: result.trackerSignals,
          matcher_hunter_results: result.matcherHunterResults,
          placed: result.targets.filter(x => x.betPlaced).length,
          live_feed_ok: result.liveFeedOk,
          live_matches: result.liveMatches,
          targets: result.targets
        });
      } catch (error: any) {
        return json({
          success: false,
          targets: [],
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    // DAILY
    if (url.pathname === "/api/daily" && request.method === "GET") {
      try {
        await syncDailyFromTracker(env);
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
        return json({
          success: false,
          matches: [],
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    // SAVE FRONTEND ODDS
    if (url.pathname === "/api/odds" && request.method === "POST") {
      try {
        const body = await request.json<Obj>();
        const eventId = safe(body?.eventId);
        const overOdds = numberOrNull(body?.overOdds);
        const underOdds = numberOrNull(body?.underOdds);

        if (!eventId || overOdds === null || overOdds <= 1 || overOdds > 50) {
          return json({
            success: false,
            error: "INVALID_ODDS_PAYLOAD"
          }, 400);
        }

        const now = new Date().toISOString();

        await env.DB.prepare(`
          INSERT INTO live_odds (
            event_id, match_name, minute, score, hunter_score,
            market, selection, over_odds, under_odds,
            source, created_at, updated_at
          )
          VALUES (
            ?1, NULL, NULL, NULL, NULL,
            '1H Total Goals', 'Over 0.5', ?2, ?3,
            'CLOUDBET_FRONTEND', ?4, ?4
          )
          ON CONFLICT(event_id) DO UPDATE SET
            over_odds = excluded.over_odds,
            under_odds = excluded.under_odds,
            source = excluded.source,
            updated_at = excluded.updated_at
        `).bind(eventId, overOdds, underOdds, now).run();

        await env.DB.prepare(`
          UPDATE daily_matches
          SET found_odds = ?2, updated_at = ?3
          WHERE event_id = ?1
        `).bind(eventId, overOdds, now).run();

        return json({
          success: true,
          action: "ODDS_SAVED",
          data: await getStoredEvent(env, eventId)
        });
      } catch (error: any) {
        return json({
          success: false,
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    // GET ODDS
    if (url.pathname === "/api/odds" && request.method === "GET") {
      try {
        const eventId = safe(url.searchParams.get("eventId"));

        if (eventId) {
          return json({
            success: true,
            data: await getStoredEvent(env, eventId)
          });
        }

        const row = await env.DB.prepare(`
          SELECT * FROM live_odds
          ORDER BY updated_at DESC
          LIMIT 1
        `).first();

        return json({
          success: true,
          data: row ?? null
        });
      } catch (error: any) {
        return json({
          success: false,
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    // SAVE BET STATUS
    if (url.pathname === "/api/bet-status" && request.method === "POST") {
      try {
        const body = await request.json<Obj>();
        const eventId = safe(body?.eventId);
        const status = safe(body?.status).toUpperCase();

        if (
          !eventId ||
          (status !== "PLACED" && status !== "BET_PLACED")
        ) {
          return json({
            success: false,
            error: "INVALID_BET_STATUS_PAYLOAD"
          }, 400);
        }

        const market = safe(body?.market) || "1st Half Total Goals";
        const selection = safe(body?.selection) || "O 0.5";
        const stake = numberOrNull(body?.stake);
        const odds = numberOrNull(body?.odds);
        const source = safe(body?.source) || "CLOUDBET_FRONTEND";
        const placedAt = safe(body?.placedAt) || new Date().toISOString();
        const now = new Date().toISOString();
        const stored = await getStoredEvent(env, eventId);

        await env.DB.prepare(`
          INSERT INTO bet_status (
            event_id, match_name, status, market, selection,
            stake, odds, source, placed_at, created_at, updated_at
          )
          VALUES (
            ?1, ?2, 'PLACED', ?3, ?4,
            ?5, ?6, ?7, ?8, ?9, ?9
          )
          ON CONFLICT(event_id) DO UPDATE SET
            match_name = COALESCE(excluded.match_name, bet_status.match_name),
            status = 'PLACED',
            market = excluded.market,
            selection = excluded.selection,
            stake = excluded.stake,
            odds = COALESCE(excluded.odds, bet_status.odds),
            source = excluded.source,
            placed_at = excluded.placed_at,
            updated_at = excluded.updated_at
        `).bind(
          eventId,
          stored?.match_name ?? null,
          market,
          selection,
          stake,
          odds,
          source,
          placedAt,
          now
        ).run();

        await updateDailyPlaced(
          env,
          eventId,
          odds,
          stake,
          placedAt
        );

        return json({
          success: true,
          action: "BET_PLACED_SAVED",
          eventId
        });
      } catch (error: any) {
        return json({
          success: false,
          error: error?.message ?? String(error)
        }, 500);
      }
    }

    // GET BET STATUS
    if (url.pathname === "/api/bet-status" && request.method === "GET") {
      try {
        const eventId = safe(url.searchParams.get("eventId"));

        if (!eventId) {
          return json({
            success: false,
            error: "EVENT_ID_REQUIRED"
          }, 400);
        }

        const row = await getBetStatus(env, eventId);

        return json({
          success: true,
          data: row
        });
      } catch (error: any) {
        return json({
          success: false,
          error: error?.message ?? String(error)
        }, 500);
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

    return json({
      success: false,
      error: "NOT_FOUND"
    }, 404);
  }
};


// ============================================================
// TABLES
// ============================================================

async function ensureTables(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS live_odds (
      event_id TEXT PRIMARY KEY,
      match_name TEXT,
      minute REAL,
      score TEXT,
      hunter_score REAL,
      market TEXT,
      selection TEXT,
      over_odds REAL,
      under_odds REAL,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

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

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_daily_matches_day
    ON daily_matches(day_key)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_daily_matches_match_id
    ON daily_matches(match_id)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_daily_matches_signal_id
    ON daily_matches(signal_id)
  `).run();
}


// ============================================================
// TARGET BUILD
// ============================================================

async function buildTargets(env: Env) {
  const tracker = await fetchServiceJSON(env.TRACKER, "/entries");
  const signals = extractHunterSignals(tracker);

  const v27 = await fetchV27Snapshot(env);

  if (!signals.length) {
    return {
      trackerSignals: 0,
      matcherHunterResults: 0,
      liveFeedOk: v27.ok,
      liveMatches: v27.matches.length,
      targets: []
    };
  }

  const matcher = await callMatcher(env, signals);
  const hunterResults = Array.isArray(matcher?.hunter_results)
    ? matcher.hunter_results
    : [];

  const targets: Obj[] = [];

  for (const item of hunterResults) {
    const classification = safe(
      item?.classification ??
      item?.match_classification ??
      item?.result?.classification
    ).toUpperCase();

    const secure =
      item?.secure_match === true ||
      item?.secure === true ||
      classification === "CONFIDENT_MATCH";

    if (!secure || classification && classification !== "CONFIDENT_MATCH") {
      continue;
    }

    const signal =
      item?.signal && typeof item.signal === "object"
        ? item.signal
        : item?.hunter ?? item?.tracker ?? {};

    const cloudbet =
      item?.cloudbet ??
      item?.match ??
      item?.matched ??
      item?.event ??
      {};

    const eventId = safe(
      cloudbet?.id ??
      cloudbet?.eventId ??
      cloudbet?.event_id ??
      item?.cloudbet_event_id ??
      item?.eventId
    );

    if (!eventId) continue;

    const matchName = safe(
      signal?.match_name ??
      signal?.match ??
      item?.signal_match ??
      cloudbet?.name ??
      cloudbet?.match
    ) || "Hunter target";

    const minute = numberOrNull(
      signal?.entry_minute ??
      signal?.minute ??
      item?.entry_minute
    );

    const hunterScore = numberOrNull(
      signal?.hunter_score ??
      signal?.score ??
      item?.hunter_score
    );

    const signalId = safe(signal?.id ?? item?.signal_id);
    const matchId = safe(signal?.match_id ?? item?.match_id);
    const entryTime = safe(signal?.entry_time ?? signal?.created_at);

    const live = findV27Match(
      v27.matches,
      matchId,
      matchName
    );

    const liveState = normalizeV27LiveState(live);

    const canAct =
      !v27.ok
        ? true
        : (
            liveState.found &&
            liveState.firstHalf &&
            liveState.zeroZero
          );

    await saveTarget(env, {
      eventId,
      matchName,
      minute,
      hunterScore
    });

    await saveDailyTarget(env, {
      eventId,
      signalId,
      matchId,
      matchName,
      minute,
      hunterScore,
      entryTime
    });

    const oddsRow = await getStoredEvent(env, eventId);
    const betRow = await getBetStatus(env, eventId);

    targets.push({
      eventId,
      matchName,
      cloudbetMatch: safe(cloudbet?.name ?? cloudbet?.match),
      minute,
      hunterScore,
      classification: classification || "CONFIDENT_MATCH",
      secureMatch: true,
      overOdds: numberOrNull(oddsRow?.over_odds),
      underOdds: numberOrNull(oddsRow?.under_odds),
      oddsUpdatedAt: oddsRow?.updated_at ?? null,
      betPlaced: safe(betRow?.status).toUpperCase() === "PLACED",
      betStatus: betRow?.status ?? null,
      betPlacedAt: betRow?.placed_at ?? null,
      betStake: numberOrNull(betRow?.stake),
      betOdds: numberOrNull(betRow?.odds),

      liveFeedOk: v27.ok,
      liveFound: liveState.found,
      liveMatchId: liveState.id,
      liveMinute: liveState.minute,
      liveMinuteDisplay: liveState.minuteDisplay,
      livePeriod: liveState.period,
      liveHomeScore: liveState.homeScore,
      liveAwayScore: liveState.awayScore,
      liveZeroZero: liveState.zeroZero,
      liveFirstHalf: liveState.firstHalf,
      canAct,

      liveReason:
        !v27.ok
          ? "LIVE_FEED_UNAVAILABLE"
          : !liveState.found
            ? "MATCH_NOT_IN_V27_LIVE"
            : !liveState.firstHalf
              ? "NOT_FIRST_HALF"
              : !liveState.zeroZero
                ? "NOT_ZERO_ZERO"
                : "LIVE_OK"
    });
  }

  targets.sort((a, b) => {
    const ao = numberOrNull(a?.overOdds);
    const bo = numberOrNull(b?.overOdds);

    if (ao !== null && bo !== null) return bo - ao;
    if (ao !== null) return -1;
    if (bo !== null) return 1;

    return (numberOrNull(b?.hunterScore) ?? 0) -
           (numberOrNull(a?.hunterScore) ?? 0);
  });

  return {
    trackerSignals: signals.length,
    matcherHunterResults: hunterResults.length,
    liveFeedOk: v27.ok,
    liveMatches: v27.matches.length,
    targets
  };
}


async function saveTarget(env: Env, target: Obj) {
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO live_odds (
      event_id, match_name, minute, score, hunter_score,
      market, selection, over_odds, under_odds,
      source, created_at, updated_at
    )
    VALUES (
      ?1, ?2, ?3, NULL, ?4,
      '1H Total Goals', 'Over 0.5', NULL, NULL,
      'TOP_SIGNAL', ?5, ?5
    )
    ON CONFLICT(event_id) DO UPDATE SET
      match_name = COALESCE(excluded.match_name, live_odds.match_name),
      minute = COALESCE(excluded.minute, live_odds.minute),
      hunter_score = COALESCE(excluded.hunter_score, live_odds.hunter_score)
  `).bind(
    target.eventId,
    target.matchName,
    target.minute,
    target.hunterScore,
    now
  ).run();
}


async function getStoredEvent(env: Env, eventId: string): Promise<any> {
  return await env.DB.prepare(`
    SELECT * FROM live_odds
    WHERE event_id = ?1
    LIMIT 1
  `).bind(eventId).first();
}


async function getBetStatus(env: Env, eventId: string): Promise<any> {
  return await env.DB.prepare(`
    SELECT * FROM bet_status
    WHERE event_id = ?1
    LIMIT 1
  `).bind(eventId).first();
}


// ============================================================
// CURRENT V27 LIVE STATE
// ============================================================

const V27_PUBLIC_URL =
  "https://goal-watch-proxy.kalchogr.workers.dev/";

async function fetchV27Snapshot(
  env: Env
): Promise<{ ok: boolean; matches: Obj[]; error?: string }> {
  try {
    let data: any;

    if (env.V27) {
      const response = await env.V27.fetch(
        new Request(
          "https://v27.internal/",
          {
            method: "GET",
            headers: {
              "accept": "application/json",
              "cache-control": "no-store"
            }
          }
        )
      );

      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          "V27 BINDING HTTP " +
          response.status +
          ": " +
          text.slice(0, 300)
        );
      }

      data = JSON.parse(text);
    } else {
      const response = await fetch(
        V27_PUBLIC_URL +
        "?top_signal_live=" +
        Date.now(),
        {
          method: "GET",
          headers: {
            "accept": "application/json",
            "cache-control": "no-store"
          }
        }
      );

      const text = await response.text();

      if (!response.ok) {
        throw new Error(
          "V27 PUBLIC HTTP " +
          response.status +
          ": " +
          text.slice(0, 300)
        );
      }

      data = JSON.parse(text);
    }

    const matches =
      Array.isArray(data?.matches)
        ? data.matches
        : Array.isArray(data?.feed?.matches)
          ? data.feed.matches
          : Array.isArray(data?.data?.matches)
            ? data.data.matches
            : [];

    return {
      ok: true,
      matches: matches.filter(
        (x: any) =>
          x &&
          typeof x === "object"
      )
    };
  } catch (error: any) {
    console.warn(
      "V27 LIVE STATE ERROR",
      error
    );

    return {
      ok: false,
      matches: [],
      error:
        error?.message ??
        String(error)
    };
  }
}


function findV27Match(
  matches: Obj[],
  matchId: string,
  matchName: string
): Obj | null {
  if (!matches.length) {
    return null;
  }

  const id = safe(matchId);

  if (id) {
    const exact = matches.find(
      m =>
        safe(
          m?.id ??
          m?.match_id
        ) === id
    );

    if (exact) {
      return exact;
    }
  }

  const wanted =
    normalizeName(matchName);

  if (!wanted) {
    return null;
  }

  const exactName =
    matches.find(
      m =>
        normalizeName(
          m?.match ??
          m?.match_name ??
          (
            safe(m?.home?.name ?? m?.home) +
            " - " +
            safe(m?.away?.name ?? m?.away)
          )
        ) === wanted
    );

  return exactName ?? null;
}


function normalizeV27LiveState(
  m: Obj | null
) {
  if (!m) {
    return {
      found: false,
      id: null,
      minute: null,
      minuteDisplay: null,
      period: null,
      homeScore: null,
      awayScore: null,
      zeroZero: false,
      firstHalf: false
    };
  }

  const score =
    m?.score &&
    typeof m.score === "object"
      ? m.score
      : {};

  const minute =
    numberOrNull(
      m?.minute
    );

  const minuteDisplay =
    safe(
      m?.minute_display ??
      m?.minuteDisplay
    ) || (
      minute !== null
        ? String(minute) + "'"
        : null
    );

  const period =
    safe(
      m?.period ??
      m?.statusShort ??
      m?.phase
    );

  const homeScore =
    numberOrNull(
      score?.home ??
      m?.home_score ??
      m?.score_home
    );

  const awayScore =
    numberOrNull(
      score?.away ??
      m?.away_score ??
      m?.score_away
    );

  const zeroZero =
    homeScore === 0 &&
    awayScore === 0;

  const p =
    period
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();

  const firstHalf =
    p === "1H" ||
    p === "FIRST" ||
    p === "FIRST HALF" ||
    p === "1ST HALF" ||
    p.includes("1H");

  return {
    found: true,
    id:
      safe(
        m?.id ??
        m?.match_id
      ) || null,
    minute,
    minuteDisplay,
    period:
      period || null,
    homeScore,
    awayScore,
    zeroZero,
    firstHalf
  };
}


// ============================================================
// MATCHER
// ============================================================

async function callMatcher(env: Env, signals: Obj[]) {
  if (!signals.length) {
    return {
      success: true,
      hunter_results: [],
      stats: {
        hunter_signals: 0,
        hunter_secure_matches: 0
      }
    };
  }

  const cleanSignals = signals.map(s => {
    const copy: Obj = { ...s };

    if (typeof copy.signal === "string") {
      delete copy.signal;
    }

    copy.type = "HUNTER_ENTRY";
    copy.action = copy.action ?? "ENTRY";
    copy.status = copy.status ?? "TRACKING";

    return copy;
  });

  const query = encodeURIComponent(JSON.stringify(cleanSignals));

  return await fetchServiceJSON(
    env.MATCHER,
    "/match?signals=" + query
  );
}


// ============================================================
// TRACKER SIGNAL EXTRACTION
// ============================================================

function extractHunterSignals(data: any): Obj[] {
  let raw: any[] = [];

  if (Array.isArray(data)) {
    raw = data;
  } else if (Array.isArray(data?.signals)) {
    raw = data.signals;
  } else if (Array.isArray(data?.entries)) {
    raw = data.entries;
  } else if (Array.isArray(data?.hunter_entries)) {
    raw = data.hunter_entries;
  } else if (Array.isArray(data?.data)) {
    raw = data.data;
  }

  const out: Obj[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const marker = [
      item?.type,
      typeof item?.signal === "string" ? item.signal : "",
      item?.action
    ]
      .map(safe)
      .join(" ")
      .toUpperCase();

    const status =
      safe(item?.status)
        .toUpperCase();

    const isHunter =
      marker.includes("HUNTER_ENTRY") ||
      marker.includes("HUNTER") ||
      (
        safe(item?.action).toUpperCase() === "ENTRY" &&
        status === "TRACKING"
      );

    if (!isHunter) {
      continue;
    }

    const normalized =
      normalizeHunterSignal(item);

    if (!normalized) {
      continue;
    }

    const key =
      safe(normalized.id) ||
      (
        safe(normalized.match_id) +
        "|" +
        safe(normalized.entry_time) +
        "|" +
        safe(normalized.match_name)
      );

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(normalized);
  }

  return out;
}


function normalizeHunterSignal(x: Obj): Obj | null {
  const matchName =
    safe(
      x?.match_name ??
      x?.match
    );

  let home =
    safe(
      typeof x?.home === "object"
        ? x?.home?.name
        : x?.home
    );

  let away =
    safe(
      typeof x?.away === "object"
        ? x?.away?.name
        : x?.away
    );

  if (
    (!home || !away) &&
    matchName
  ) {
    const parts =
      matchName.split(
        /\s+-\s+|\s+v\s+|\s+vs\.?\s+/i
      );

    if (parts.length >= 2) {
      home =
        home ||
        safe(parts[0]);

      away =
        away ||
        safe(
          parts
            .slice(1)
            .join(" - ")
        );
    }
  }

  if (
    !matchName &&
    (!home || !away)
  ) {
    return null;
  }

  return {
    id:
      x?.id ??
      null,

    type:
      "HUNTER_ENTRY",

    action:
      safe(x?.action) ||
      "ENTRY",

    status:
      safe(x?.status) ||
      "TRACKING",

    match_id:
      safe(x?.match_id),

    match_name:
      matchName ||
      (home + " - " + away),

    match:
      matchName ||
      (home + " - " + away),

    league:
      safe(x?.league),

    entry_time:
      safe(
        x?.entry_time ??
        x?.created_at
      ),

    entry_minute:
      numberOrNull(
        x?.entry_minute ??
        x?.minute
      ),

    hunter_score:
      numberOrNull(
        x?.hunter_score ??
        x?.goal_signal?.score
      ),

    goal_pressure:
      numberOrNull(
        x?.goal_pressure
      ),

    danger_index:
      numberOrNull(
        x?.danger_index
      ),

    attack_score:
      numberOrNull(
        x?.attack_score
      ),

    home,
    away,

    score:
      x?.score ?? {
        home:
          numberOrNull(
            x?.entry_home_score
          ) ?? 0,

        away:
          numberOrNull(
            x?.entry_away_score
          ) ?? 0
      }
  };
}


// ============================================================
// DAILY LOG
// ============================================================

async function saveDailyTarget(env: Env, target: Obj) {
  const now = new Date().toISOString();
  const dayKey = sofiaDate(target.entryTime || now);

  const bet = await getBetStatus(env, target.eventId);

  await env.DB.prepare(`
    INSERT INTO daily_matches (
      event_id, signal_id, match_id, match_name,
      entry_minute, hunter_score, found_odds,
      bet_status, bet_odds, bet_stake,
      tracker_status, tracker_result, result_status,
      day_key, entry_time, placed_at,
      first_seen_at, updated_at, finished_at
    )
    VALUES (
      ?1, ?2, ?3, ?4,
      ?5, ?6, NULL,
      ?7, ?8, ?9,
      'TRACKING', 'PENDING', 'PENDING',
      ?10, ?11, ?12,
      ?13, ?13, NULL
    )
    ON CONFLICT(event_id) DO UPDATE SET
      signal_id = COALESCE(excluded.signal_id, daily_matches.signal_id),
      match_id = COALESCE(excluded.match_id, daily_matches.match_id),
      match_name = COALESCE(excluded.match_name, daily_matches.match_name),
      entry_minute = COALESCE(excluded.entry_minute, daily_matches.entry_minute),
      hunter_score = COALESCE(excluded.hunter_score, daily_matches.hunter_score),
      updated_at = excluded.updated_at
  `).bind(
    target.eventId,
    target.signalId || null,
    target.matchId || null,
    target.matchName,
    target.minute,
    target.hunterScore,
    safe(bet?.status).toUpperCase() === "PLACED" ? "PLACED" : "NOT_PLACED",
    numberOrNull(bet?.odds),
    numberOrNull(bet?.stake),
    dayKey,
    target.entryTime || null,
    bet?.placed_at ?? null,
    now
  ).run();
}


async function updateDailyPlaced(
  env: Env,
  eventId: string,
  odds: number | null,
  stake: number | null,
  placedAt: string
) {
  const now = new Date().toISOString();

  await env.DB.prepare(`
    UPDATE daily_matches
    SET
      bet_status = 'PLACED',
      bet_odds = COALESCE(?2, bet_odds, found_odds),
      bet_stake = COALESCE(?3, bet_stake),
      placed_at = ?4,
      updated_at = ?5
    WHERE event_id = ?1
  `).bind(
    eventId,
    odds,
    stake,
    placedAt,
    now
  ).run();
}


async function syncDailyFromTracker(env: Env) {
  const tracker = await fetchServiceJSON(env.TRACKER, "/entries");
  await syncDailyFromTrackerData(env, tracker);
}


async function syncDailyFromTrackerData(env: Env, tracker: any) {
  const records = extractTrackerRecords(tracker);

  if (!records.length) return;

  const today = sofiaDate();

  const rows = await env.DB.prepare(`
    SELECT event_id, signal_id, match_id, match_name
    FROM daily_matches
    WHERE day_key = ?1
  `).bind(today).all();

  const daily =
    Array.isArray(rows?.results)
      ? rows.results
      : [];

  for (const row of daily) {
    const record =
      findTrackerRecordForDaily(
        row,
        records
      );

    if (!record) continue;

    const normalized =
      normalizeTrackerResult(record);

    if (!normalized) continue;

    const now =
      new Date().toISOString();

    await env.DB.prepare(`
      UPDATE daily_matches
      SET
        tracker_status = ?2,
        tracker_result = ?3,
        result_status = ?4,
        updated_at = ?5,
        finished_at = CASE
          WHEN ?4 IN ('WIN','LOSS')
          THEN COALESCE(finished_at, ?5)
          ELSE finished_at
        END
      WHERE event_id = ?1
    `).bind(
      row.event_id,
      normalized.trackerStatus,
      normalized.trackerResult,
      normalized.resultStatus,
      now
    ).run();
  }
}


function extractTrackerRecords(data: any): Obj[] {
  const candidates: any[][] = [];

  if (Array.isArray(data)) {
    candidates.push(data);
  }

  if (Array.isArray(data?.signals)) {
    candidates.push(data.signals);
  }

  if (Array.isArray(data?.entries)) {
    candidates.push(data.entries);
  }

  if (Array.isArray(data?.hunter_entries)) {
    candidates.push(data.hunter_entries);
  }

  if (Array.isArray(data?.data)) {
    candidates.push(data.data);
  }

  const out: Obj[] = [];
  const seen = new Set<string>();

  for (const arr of candidates) {
    for (const value of arr) {
      if (!value || typeof value !== "object") {
        continue;
      }

      const key =
        safe(value?.id) ||
        (
          safe(value?.match_id) +
          "|" +
          safe(value?.match_name ?? value?.match) +
          "|" +
          safe(value?.status) +
          "|" +
          safe(value?.result)
        );

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      out.push(value);
    }
  }

  return out;
}


function findTrackerRecordForDaily(
  row: any,
  records: Obj[]
): Obj | null {
  const signalId =
    safe(row?.signal_id);

  const matchId =
    safe(row?.match_id);

  const matchName =
    normalizeName(row?.match_name);

  let best: Obj | null = null;

  for (const r of records) {
    if (
      signalId &&
      safe(r?.id) === signalId
    ) {
      return r;
    }

    if (
      matchId &&
      safe(r?.match_id) === matchId
    ) {
      best = r;
      continue;
    }

    const rName =
      normalizeName(
        r?.match_name ??
        r?.match
      );

    if (
      !best &&
      matchName &&
      rName &&
      matchName === rName
    ) {
      best = r;
    }
  }

  return best;
}


function normalizeTrackerResult(record: Obj) {
  const status =
    safe(record?.status).toUpperCase();

  const result =
    safe(record?.result).toUpperCase();

  const action =
    safe(record?.action).toUpperCase();

  const type =
    safe(record?.type).toUpperCase();

  const text = [
    status,
    result,
    action,
    type
  ]
    .join(" ")
    .replace(/_/g, " ");

  if (
    text.includes("NO GOAL") ||
    text.includes("NO-GOAL")
  ) {
    return {
      trackerStatus:
        status || "FINISHED",
      trackerResult:
        result || "NO GOAL",
      resultStatus:
        "LOSS"
    };
  }

  if (
    text.includes("GOAL HIT") ||
    /\bGOAL\b/.test(text)
  ) {
    return {
      trackerStatus:
        status || "FINISHED",
      trackerResult:
        result || "GOAL HIT",
      resultStatus:
        "WIN"
    };
  }

  if (
    status === "TRACKING" ||
    text.includes("ENTRY") ||
    text.includes("PENDING")
  ) {
    return {
      trackerStatus:
        status || "TRACKING",
      trackerResult:
        result || "PENDING",
      resultStatus:
        "PENDING"
    };
  }

  return null;
}


async function getDailyMatches(env: Env): Promise<Obj[]> {
  const result =
    await env.DB.prepare(`
      SELECT *
      FROM daily_matches
      WHERE day_key = ?1
      ORDER BY
        COALESCE(entry_time, first_seen_at) DESC,
        first_seen_at DESC
    `)
    .bind(sofiaDate())
    .all();

  return Array.isArray(result?.results)
    ? result.results as Obj[]
    : [];
}


function buildDailySummary(matches: Obj[]) {
  const today =
    matches.length;

  const placedRows =
    matches.filter(
      x =>
        safe(x?.bet_status)
          .toUpperCase() === "PLACED"
    );

  const wins =
    placedRows.filter(
      x =>
        safe(x?.result_status)
          .toUpperCase() === "WIN"
    ).length;

  const losses =
    placedRows.filter(
      x =>
        safe(x?.result_status)
          .toUpperCase() === "LOSS"
    ).length;

  const settled =
    wins + losses;

  return {
    today,
    placed: placedRows.length,
    wins,
    losses,
    notPlaced:
      today - placedRows.length,

    pending:
      placedRows.filter(
        x =>
          safe(x?.result_status)
            .toUpperCase() === "PENDING"
      ).length,

    successRate:
      settled > 0
        ? (wins / settled) * 100
        : null
  };
}


// ============================================================
// SERVICE FETCH
// ============================================================

async function fetchServiceJSON(
  service: Fetcher,
  path: string
): Promise<any> {
  const response =
    await service.fetch(
      new Request(
        "https://internal" + path,
        {
          method: "GET",
          headers: {
            "accept": "application/json",
            "cache-control": "no-store"
          }
        }
      )
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      "HTTP " +
      response.status +
      ": " +
      text.slice(0, 500)
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "INVALID_JSON: " +
      text.slice(0, 500)
    );
  }
}


// ============================================================
// HELPERS
// ============================================================

function sofiaDate(value?: string): string {
  const date =
    value
      ? new Date(value)
      : new Date();

  try {
    const parts =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: TIME_ZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }
      ).formatToParts(date);

    const map: Obj = {};

    for (const p of parts) {
      if (p.type !== "literal") {
        map[p.type] = p.value;
      }
    }

    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return date
      .toISOString()
      .slice(0, 10);
  }
}


function normalizeName(value: any): string {
  return safe(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}


function safe(value: any): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}


function numberOrNull(value: any): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}


function json(
  data: any,
  status = 200
): Response {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8",

        "cache-control":
          "no-store",

        ...corsHeaders()
      }
    }
  );
}


// ============================================================
// DASHBOARD
// ============================================================

function renderHtml(): string {
  return `<!DOCTYPE html>
<html lang="bg">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Top Signal Control</title>

<style>
*{box-sizing:border-box}
body{
  margin:0;
  background:#0b0e13;
  color:#fff;
  font-family:Arial,Helvetica,sans-serif
}
.app{
  max-width:760px;
  margin:0 auto;
  padding:10px
}
.title{
  font-size:20px;
  font-weight:900
}
.subtitle{
  margin-top:3px;
  color:#8d96a5;
  font-size:9px
}
.summary{
  margin-top:10px;
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:5px
}
.sum{
  background:#151a22;
  border:1px solid #252c38;
  border-radius:9px;
  padding:7px 3px;
  text-align:center
}
.sum .v{
  font-size:17px;
  font-weight:900
}
.sum .l{
  margin-top:2px;
  font-size:7px;
  color:#8d96a5
}
.stats{
  margin-top:7px;
  color:#7d8797;
  font-size:9px;
  line-height:1.4
}
.err{color:#fca5a5}
.card{
  margin-top:8px;
  padding:9px;
  background:#151a22;
  border:1px solid #252c38;
  border-radius:11px
}
.card.placed{
  border-color:#16a34a;
  background:#101d16
}
.placedBanner{
  margin-bottom:6px;
  padding:4px 6px;
  border-radius:6px;
  background:#14532d;
  color:#bbf7d0;
  font-size:9px;
  font-weight:900;
  text-align:center
}
.match{
  font-size:14px;
  font-weight:900;
  line-height:1.25
}
.event{
  margin-top:2px;
  color:#646f80;
  font-size:7px
}
.meta{
  margin-top:4px;
  display:flex;
  gap:8px;
  color:#adb5c2;
  font-size:9px
}
.liveLine{
  margin-top:7px;
  display:grid;
  grid-template-columns:auto auto 1fr;
  gap:6px;
  align-items:center;
  padding:7px 8px;
  background:#0f141c;
  border:1px solid #283241;
  border-radius:8px;
  font-size:10px;
  font-weight:900
}
.liveLine.ok{
  border-color:#166534;
  background:#0c1711
}
.liveLine.bad{
  border-color:#7f1d1d;
  background:#1d1010
}
.liveLine.unknown{
  border-color:#854d0e;
  background:#1c160b
}
.liveMinute{color:#67e8f9}
.liveScore{
  font-size:16px;
  color:#fff
}
.livePeriod{
  color:#9ca3af;
  text-align:right
}
.invalidBanner{
  margin-top:6px;
  padding:5px 7px;
  border-radius:6px;
  background:#450a0a;
  color:#fecaca;
  font-size:8px;
  font-weight:900;
  text-align:center
}
.unknownBanner{
  margin-top:6px;
  padding:5px 7px;
  border-radius:6px;
  background:#422006;
  color:#fde68a;
  font-size:8px;
  font-weight:900;
  text-align:center
}
.btn[disabled]{
  cursor:not-allowed;
  opacity:.48
}
.marketLine{
  margin-top:7px;
  display:flex;
  align-items:center;
  justify-content:space-between
}
.marketName{
  color:#a7b0bd;
  font-size:10px;
  font-weight:800
}
.odds{
  font-size:20px;
  font-weight:900;
  text-align:right
}
.state{
  font-size:8px;
  text-align:right
}
.ready{color:#86efac}
.waiting{color:#fbbf24}
.actions{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:6px;
  margin-top:7px
}
.btn{
  border:0;
  border-radius:8px;
  padding:8px 6px;
  font-size:9px;
  font-weight:900;
  cursor:pointer
}
.check{background:#2563eb;color:#fff}
.bet{background:#16a34a;color:#fff}
.bet[disabled]{
  background:#26303c;
  color:#788393
}
.empty{
  margin-top:9px;
  padding:16px 10px;
  background:#151a22;
  border:1px solid #252c38;
  border-radius:11px;
  text-align:center;
  color:#9aa4b3;
  font-size:10px;
  line-height:1.5
}
.daily{
  margin-top:14px;
  background:#151a22;
  border:1px solid #252c38;
  border-radius:11px;
  overflow:hidden
}
.dailyHead{
  width:100%;
  padding:11px;
  border:0;
  background:#151a22;
  color:#fff;
  display:flex;
  justify-content:space-between;
  font-size:11px;
  font-weight:900
}
.dailyBody{
  display:none;
  padding:0 9px 9px;
  border-top:1px solid #252c38
}
.daily.open .dailyBody{display:block}
.dailySummary{
  margin-top:8px;
  display:grid;
  grid-template-columns:repeat(2,1fr);
  gap:4px
}
.ds{
  background:#0f1319;
  border-radius:7px;
  padding:6px 7px;
  font-size:9px;
  display:flex;
  justify-content:space-between
}
.dailyRow{
  padding:8px 2px;
  border-top:1px solid #242a34
}
.dailyMatch{
  font-size:10px;
  font-weight:900
}
.dailyStatus{
  margin-top:3px;
  display:flex;
  flex-wrap:wrap;
  gap:5px;
  font-size:8px;
  color:#929baa
}
.pill{
  padding:2px 5px;
  border-radius:5px;
  background:#202632
}
.win{color:#4ade80;font-weight:900}
.loss{color:#f87171;font-weight:900}
.pending{color:#fbbf24;font-weight:900}
.footer{
  margin-top:14px;
  text-align:center;
  color:#596273;
  font-size:7px
}
</style>
</head>

<body>
<div class="app">

<div class="title">⚡ TOP SIGNAL MANUAL</div>
<div class="subtitle">
V2.0.4 LIVE V27 STATE · TRACKER → MATCHER → V27 LIVE
</div>

<div class="summary">
  <div class="sum"><div id="sumTargets" class="v">0</div><div class="l">TARGETS</div></div>
  <div class="sum"><div id="sumReady" class="v">0</div><div class="l">ODDS READY</div></div>
  <div class="sum"><div id="sumPlaced" class="v">0</div><div class="l">PLACED</div></div>
  <div class="sum"><div id="sumBest" class="v">—</div><div class="l">BEST O0.5</div></div>
</div>

<div id="stats" class="stats">Loading...</div>
<div id="list"></div>

<div id="daily" class="daily">
  <button id="dailyHead" class="dailyHead" type="button">
    <span>📊 ДНЕШНИ МАЧОВЕ · <span id="dailyCount">0</span></span>
    <span id="dailyArrow">▸</span>
  </button>

  <div class="dailyBody">
    <div id="dailySummary" class="dailySummary"></div>
    <div id="dailyList"></div>
  </div>
</div>

<div class="footer">
DAILY MATCH LOG · EUROPE/SOFIA · SUCCESS = WIN / (WIN + LOSS)
</div>

</div>

<script>
const CLOUDBET_ORIGIN = 'https://www.cloud0007.com';

const TARGET_REFRESH_MS = 10000;
const DAILY_REFRESH_MS = 30000;

let targetRefreshRunning = false;
let dailyRefreshRunning = false;

let latestTargets = [];
let latestDaily = [];
let dailyOpen = false;


function esc(v){
  return String(v ?? '').replace(/[&<>"']/g,c=>({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}

function num(v){
  const x=Number(v);
  return Number.isFinite(x)?x:null;
}

function eventUrl(target,action){
  const id=String(target?.eventId??'').trim();

  const u=new URL(
    CLOUDBET_ORIGIN+
    '/en/sports/soccer/live/'+
    encodeURIComponent(id)
  );

  u.searchParams.set('markets-tab','goals');
  u.searchParams.set('ts-action',action);
  u.searchParams.set('ts-event',id);
  u.searchParams.set('ts-launch',Date.now().toString());

  u.hash=
    'ts-action='+encodeURIComponent(action)+
    '&ts-event='+encodeURIComponent(id);

  return u.href;
}

function go(target,action){
  if(!target?.eventId)return;
  if(action==='bet'&&target?.betPlaced)return;

  const id=String(target.eventId).trim();

  try{
    window.name=
      'TOP_SIGNAL::'+
      JSON.stringify({
        action,
        eventId:id,
        createdAt:Date.now()
      });
  }catch(e){
    console.warn(
      'TOP SIGNAL window.name save failed',
      e
    );
  }

  location.href=eventUrl(target,action);
}

function card(t){
  const odds=num(t?.overOdds);
  const ready=odds!==null;
  const placed=t?.betPlaced===true;

  const liveFeedOk=t?.liveFeedOk===true;
  const liveFound=t?.liveFound===true;
  const liveValid=t?.canAct===true;

  const liveMinute=
    t?.liveMinuteDisplay||
    (
      num(t?.liveMinute)!==null
        ? String(num(t?.liveMinute))+"'"
        : '—'
    );

  const liveScore=
    num(t?.liveHomeScore)!==null&&
    num(t?.liveAwayScore)!==null
      ? String(num(t?.liveHomeScore))+':'+String(num(t?.liveAwayScore))
      : '—';

  const livePeriod=
    String(t?.livePeriod??'—');

  let liveClass='unknown';
  let liveBanner='';

  if(liveFeedOk&&liveFound){
    if(liveValid){
      liveClass='ok';
    }else{
      liveClass='bad';
      liveBanner=
        '<div class="invalidBanner">'+
        '❌ ВЕЧЕ НЕ Е 1H 0:0 · CHECK/BET LOCKED'+
        '</div>';
    }
  }else if(liveFeedOk&&!liveFound){
    liveClass='bad';
    liveBanner=
      '<div class="invalidBanner">'+
      '❌ МАЧЪТ НЕ Е В ТЕКУЩИЯ V27 LIVE FEED · LOCKED'+
      '</div>';
  }else{
    liveBanner=
      '<div class="unknownBanner">'+
      '⚠ LIVE DATA TEMPORARILY UNAVAILABLE · ENTRY DATA ONLY'+
      '</div>';
  }

  const actionLocked=
    liveFeedOk&&!liveValid;

  return (
    '<div class="card '+(placed?'placed':'')+'">'+
    (placed?'<div class="placedBanner">✅ ЗАЛОЖЕНО</div>':'')+
    '<div class="match">⚽ '+esc(t?.matchName||'Hunter target')+'</div>'+
    '<div class="event">Event '+esc(t?.eventId||'')+'</div>'+

    '<div class="liveLine '+liveClass+'">'+
      '<span class="liveMinute">⏱ '+esc(liveMinute)+'</span>'+
      '<span class="liveScore">⚽ '+esc(liveScore)+'</span>'+
      '<span class="livePeriod">'+esc(livePeriod)+'</span>'+
    '</div>'+

    liveBanner+

    '<div class="meta">'+
      '<span>ENTRY '+esc(t?.minute??'—')+"'</span>"+
      '<span>🎯 Hunter '+esc(t?.hunterScore??'—')+'</span>'+
    '</div>'+
    '<div class="marketLine">'+
      '<div class="marketName">1H O0.5</div>'+
      '<div>'+
        '<div class="odds">'+(ready?'@'+odds.toFixed(2):'@—')+'</div>'+
        '<div class="state '+(ready?'ready':'waiting')+'">'+
          (placed?'PLACED ✅':ready?'READY ✅':'WAIT')+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="actions">'+
      '<button class="btn check" data-action="check" data-id="'+esc(t?.eventId)+'" '+
        (actionLocked?'disabled':'')+'>'+
        (actionLocked?'CHECK LOCKED':'CHECK')+
      '</button>'+
      '<button class="btn bet" data-action="bet" data-id="'+esc(t?.eventId)+'" '+
        ((placed||!ready||actionLocked)?'disabled':'')+'>'+
        (placed?'✅ ЗАЛОЖЕНО':actionLocked?'BET LOCKED':'BET NOW')+
      '</button>'+
    '</div>'+
    '</div>'
  );
}

function dailyRow(m){
  const placed=String(m?.bet_status??'').toUpperCase()==='PLACED';
  const result=String(m?.result_status??'PENDING').toUpperCase();

  const odds=num(
    placed
      ? (m?.bet_odds??m?.found_odds)
      : m?.found_odds
  );

  let resultHtml='—';

  if(placed){
    if(result==='WIN'){
      resultHtml='<span class="win">✅ ПЕЧЕЛИ</span>';
    }else if(result==='LOSS'){
      resultHtml='<span class="loss">❌ НЕ ПЕЧЕЛИ</span>';
    }else{
      resultHtml='<span class="pending">⏳ PENDING</span>';
    }
  }

  return (
    '<div class="dailyRow">'+
      '<div class="dailyMatch">'+esc(m?.match_name||'Unknown match')+'</div>'+
      '<div class="dailyStatus">'+
        '<span>'+(odds!==null?'@'+odds.toFixed(2):'@—')+'</span>'+
        '<span class="pill">'+(placed?'ЗАЛОЖЕН':'НЕЗАЛОЖЕН')+'</span>'+
        '<span>'+resultHtml+'</span>'+
      '</div>'+
    '</div>'
  );
}

function renderDailySummary(s){
  const rate=
    s?.successRate===null||s?.successRate===undefined
      ? '—'
      : Number(s.successRate).toFixed(1)+'%';

  return (
    '<div class="ds"><span>ДНЕС</span><strong>'+esc(s?.today??0)+'</strong></div>'+
    '<div class="ds"><span>ЗАЛОЖЕНИ</span><strong>'+esc(s?.placed??0)+'</strong></div>'+
    '<div class="ds"><span>ПЕЧЕЛИ</span><strong class="win">'+esc(s?.wins??0)+'</strong></div>'+
    '<div class="ds"><span>НЕ ПЕЧЕЛИ</span><strong class="loss">'+esc(s?.losses??0)+'</strong></div>'+
    '<div class="ds"><span>НЕЗАЛОЖЕНИ</span><strong>'+esc(s?.notPlaced??0)+'</strong></div>'+
    '<div class="ds"><span>УСПЕХ</span><strong>'+esc(rate)+'</strong></div>'
  );
}


// ==========================================================
// ACTIVE TARGET REFRESH
// ==========================================================

async function refreshTargets(){
  const r=await fetch(
    '/api/targets?ts='+Date.now(),
    {cache:'no-store'}
  );

  const d=await r.json();

  if(!r.ok||!d?.success){
    throw new Error(
      d?.error||('HTTP '+r.status)
    );
  }

  latestTargets=Array.isArray(d.targets)?d.targets:[];

  const ready=latestTargets.filter(
    x=>num(x?.overOdds)!==null
  );

  const placed=latestTargets.filter(
    x=>x?.betPlaced===true
  );

  const best=
    ready
      .map(x=>num(x?.overOdds))
      .filter(x=>x!==null)
      .sort((a,b)=>b-a)[0]??null;

  document.getElementById('sumTargets').textContent=
    String(latestTargets.length);

  document.getElementById('sumReady').textContent=
    String(ready.length);

  document.getElementById('sumPlaced').textContent=
    String(placed.length);

  document.getElementById('sumBest').textContent=
    best===null?'—':best.toFixed(2);

  document.getElementById('stats').textContent=
    'Tracker '+(d.tracker_signals??0)+
    ' · Matcher '+(d.matcher_hunter_results??0)+
    ' · Secure '+latestTargets.length+
    ' · V27 '+(d.live_feed_ok?'LIVE ✅':'ERROR ⚠')+
    ' · live matches '+(d.live_matches??'—')+
    ' · targets 10s · daily 30s';

  document.getElementById('list').innerHTML=
    latestTargets.length
      ? latestTargets.map(card).join('')
      : '<div class="empty">Няма активен secure Hunter target.<br>Чакаме нов сигнал.</div>';
}


// ==========================================================
// DAILY REFRESH
// ==========================================================

async function refreshDaily(){
  const r=await fetch(
    '/api/daily?ts='+Date.now(),
    {cache:'no-store'}
  );

  const d=await r.json();

  if(!r.ok||!d?.success){
    throw new Error(
      d?.error||('DAILY HTTP '+r.status)
    );
  }

  latestDaily=Array.isArray(d.matches)?d.matches:[];

  document.getElementById('dailyCount').textContent=
    String(latestDaily.length);

  document.getElementById('dailySummary').innerHTML=
    renderDailySummary(d.summary||{});

  document.getElementById('dailyList').innerHTML=
    latestDaily.length
      ? latestDaily.map(dailyRow).join('')
      : '<div class="empty">Още няма мачове за днес.</div>';
}


// ==========================================================
// SAFE REFRESH — V2.0.1 ANTI-OVERLAP
// ==========================================================

async function safeRefreshTargets(){
  if(targetRefreshRunning){
    console.log(
      'TARGET refresh skipped — previous request still running'
    );
    return;
  }

  targetRefreshRunning=true;

  try{
    await refreshTargets();
  }catch(e){
    console.warn('TARGET REFRESH ERROR',e);

    const stats=document.getElementById('stats');

    if(stats){
      stats.innerHTML=
        '<span class="err">'+
        'TEMP CONNECTION ERROR · keeping last targets · '+
        esc(e?.message||e)+
        '</span>';
    }
  }finally{
    targetRefreshRunning=false;
  }
}

async function safeRefreshDaily(){
  if(dailyRefreshRunning){
    console.log(
      'DAILY refresh skipped — previous request still running'
    );
    return;
  }

  dailyRefreshRunning=true;

  try{
    await refreshDaily();
  }catch(e){
    console.warn('DAILY REFRESH ERROR',e);
  }finally{
    dailyRefreshRunning=false;
  }
}


// DAILY TOGGLE
document
  .getElementById('dailyHead')
  .addEventListener('click',()=>{
    dailyOpen=!dailyOpen;

    const el=document.getElementById('daily');
    const arrow=document.getElementById('dailyArrow');

    if(dailyOpen){
      el.classList.add('open');
      arrow.textContent='▾';
    }else{
      el.classList.remove('open');
      arrow.textContent='▸';
    }
  });


// BUTTONS
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');
  if(!b)return;

  const id=b.getAttribute('data-id');
  const action=b.getAttribute('data-action');

  const target=latestTargets.find(
    x=>String(x?.eventId)===String(id)
  );

  if(!target)return;

  if(action==='check'){
    if(!b.disabled&&target?.canAct!==false){
      go(target,'check');
    }
    return;
  }

  if(
    action==='bet'&&
    !b.disabled&&
    !target?.betPlaced&&
    target?.canAct!==false
  ){
    go(target,'bet');
  }
});


// ==========================================================
// START
// ==========================================================

safeRefreshTargets();
safeRefreshDaily();

setInterval(
  safeRefreshTargets,
  TARGET_REFRESH_MS
);

setInterval(
  safeRefreshDaily,
  DAILY_REFRESH_MS
);

</script>
</body>
</html>`;
      }
