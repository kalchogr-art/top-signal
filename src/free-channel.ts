// ============================================================
// HUNTER FREE CHANNEL V1.0.0 — READ ONLY
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

const VERSION = "V1.0.0 READ ONLY STRONG";
const APP_NAME = "hunter-free-channel";

const MIN_ENTRY_MINUTE = 19;
const MAX_ENTRY_MINUTE = 20;
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

    if (url.pathname === "/" || url.pathname === "/status") {
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
          ? Math.max(1, Math.min(120, Math.trunc(daysRaw)))
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
  const minute = numberOrNull(x?.entry_minute);
  const score = numberOrNull(x?.hunter_score);
  const createdAt = safe(x?.created_at);

  if (minute === null || score === null || !createdAt) return false;
  if (minute < MIN_ENTRY_MINUTE || minute > MAX_ENTRY_MINUTE) return false;
  if (score < MIN_HUNTER_SCORE) return false;

  const parts = sofiaParts(createdAt);
  if (!parts) return false;

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
