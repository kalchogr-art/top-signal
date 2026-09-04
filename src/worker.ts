// ============================================================
// TOP SIGNAL V1.7.1 CONTROL
// TRACKER -> MATCHER -> EVENT ID -> FRONTEND ODDS -> D1
//
// CONTROL DASHBOARD:
// - ALL CURRENT SECURE HUNTER TARGETS
// - EVENT ID
// - HUNTER SCORE
// - MATCHER SCORE
// - FRONTEND ODDS
// - OPEN EXACT CLOUDBET EVENT
//
// READ ONLY
// REAL BETTING DISABLED
// ============================================================

const VERSION = "V1.7.1 CONTROL";
const APP_NAME = "top-signal";

type Obj = Record<string, any>;

interface Env {
  DB: D1Database;
  TRACKER: Fetcher;
  MATCHER: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    // ========================================================
    // STATUS
    // ========================================================

    if (url.pathname === "/api/status") {
      return json({
        success: true,
        worker: APP_NAME,
        version: VERSION,
        mode: "READ_ONLY",
        betting: "DISABLED",
        storage: "D1",

        bindings: {
          DB: !!env.DB,
          TRACKER: !!env.TRACKER,
          MATCHER: !!env.MATCHER
        },

        flow:
          "TRACKER /entries -> MATCHER /match?signals= -> CLOUDBET FRONTEND READER -> D1"
      });
    }

    // ========================================================
    // DEBUG TRACKER
    // ========================================================

    if (url.pathname === "/api/debug/tracker") {
      try {
        const data =
          await fetchServiceJSON(
            env.TRACKER,
            "/entries"
          );

        const signals =
          extractHunterSignals(data);

        return json({
          success: true,
          raw_type:
            Array.isArray(data)
              ? "ARRAY"
              : typeof data,

          signals_found:
            signals.length,

          signals
        });

      } catch (error: any) {
        return json(
          {
            success: false,
            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }

    // ========================================================
    // DEBUG MATCHER
    // ========================================================

    if (url.pathname === "/api/debug/matcher") {
      try {
        const tracker =
          await fetchServiceJSON(
            env.TRACKER,
            "/entries"
          );

        const signals =
          extractHunterSignals(
            tracker
          );

        const matcher =
          await callMatcher(
            env,
            signals
          );

        return json({
          success: true,

          tracker_signals:
            signals.length,

          matcher_version:
            matcher?.version ??
            null,

          matcher_stats:
            matcher?.stats ??
            null,

          hunter_results:
            matcher?.hunter_results ??
            []
        });

      } catch (error: any) {
        return json(
          {
            success: false,
            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }

    // ========================================================
    // PRIMARY TARGET
    // ========================================================

    if (
      url.pathname === "/api/target" &&
      request.method === "GET"
    ) {
      try {
        const result =
          await buildTargets(env);

        const target =
          result.targets[0] ??
          null;

        return json({
          success: true,
          found: !!target,

          target,

          stats: {
            tracker_signals:
              result.trackerSignals,

            matcher_hunter_results:
              result.matcherHunterResults,

            secure_targets:
              result.targets.length
          },

          timestamp:
            new Date()
              .toISOString()
        });

      } catch (error: any) {
        console.error(
          "TARGET ERROR",
          error
        );

        return json(
          {
            success: false,
            found: false,
            target: null,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }

    // ========================================================
    // ALL TARGETS
    // ========================================================

    if (
      url.pathname === "/api/targets" &&
      request.method === "GET"
    ) {
      try {
        const result =
          await buildTargets(env);

        return json({
          success: true,

          count:
            result.targets.length,

          tracker_signals:
            result.trackerSignals,

          matcher_hunter_results:
            result.matcherHunterResults,

          targets:
            result.targets
        });

      } catch (error: any) {
        return json(
          {
            success: false,
            targets: [],

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }

    // ========================================================
    // FRONTEND ODDS POST
    // ========================================================

    if (
      url.pathname === "/api/odds" &&
      request.method === "POST"
    ) {
      try {
        const body =
          await request.json<Obj>();

        const eventId =
          safe(
            body?.eventId
          );

        const overOdds =
          numberOrNull(
            body?.overOdds
          );

        const underOdds =
          numberOrNull(
            body?.underOdds
          );

        if (
          !eventId ||
          overOdds === null ||
          overOdds <= 1
        ) {
          return json(
            {
              success: false,
              error:
                "INVALID_ODDS_PAYLOAD"
            },
            400
          );
        }

        const now =
          new Date()
            .toISOString();

        await env.DB
          .prepare(`
            INSERT INTO live_odds (
              event_id,
              match_name,
              minute,
              score,
              hunter_score,
              market,
              selection,
              over_odds,
              under_odds,
              source,
              created_at,
              updated_at
            )
            VALUES (
              ?1,
              NULL,
              NULL,
              NULL,
              NULL,
              '1H Total Goals',
              'Over 0.5',
              ?2,
              ?3,
              'CLOUDBET_FRONTEND',
              ?4,
              ?4
            )

            ON CONFLICT(event_id)

            DO UPDATE SET
              over_odds =
                excluded.over_odds,

              under_odds =
                excluded.under_odds,

              updated_at =
                excluded.updated_at
          `)

          .bind(
            eventId,
            overOdds,
            underOdds,
            now
          )

          .run();

        const stored =
          await getStoredEvent(
            env,
            eventId
          );

        return json({
          success: true,
          action:
            "ODDS_SAVED",

          data:
            stored
        });

      } catch (error: any) {
        return json(
          {
            success: false,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }

    // ========================================================
    // LAST ODDS
    // ========================================================

    if (
      url.pathname === "/api/odds" &&
      request.method === "GET"
    ) {
      try {
        const row =
          await env.DB
            .prepare(`
              SELECT *
              FROM live_odds
              ORDER BY updated_at DESC
              LIMIT 1
            `)
            .first();

        return json({
          success: true,
          data:
            row ??
            null
        });

      } catch (error: any) {
        return json(
          {
            success: false,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }

    // ========================================================
    // CONTROL DASHBOARD
    // ========================================================

    return new Response(
      renderHtml(),
      {
        headers: {
          "content-type":
            "text/html; charset=UTF-8",

          "cache-control":
            "no-store"
        }
      }
    );
  }
};


// ============================================================
// BUILD TARGETS
// ============================================================

async function buildTargets(
  env: Env
): Promise<{
  trackerSignals: number;
  matcherHunterResults: number;
  targets: Obj[];
}> {

  const trackerData =
    await fetchServiceJSON(
      env.TRACKER,
      "/entries"
    );

  const signals =
    extractHunterSignals(
      trackerData
    );

  if (
    signals.length === 0
  ) {
    return {
      trackerSignals: 0,
      matcherHunterResults: 0,
      targets: []
    };
  }

  const matcherData =
    await callMatcher(
      env,
      signals
    );

  const hunterResults =
    Array.isArray(
      matcherData?.hunter_results
    )
      ? matcherData.hunter_results
      : [];

  const secureResults =
    hunterResults.filter(
      (item: Obj) => {

        const eventId =
          safe(
            item?.cloudbet?.id ??
            item?.cloudbet?.event_id
          );

        const secure =
          item?.security
            ?.secure_match === true;

        const classification =
          safe(
            item?.classification
          );

        return (
          eventId &&
          secure &&
          classification ===
            "CONFIDENT_MATCH"
        );
      }
    );

  const targets: Obj[] = [];

  for (
    const result
    of secureResults
  ) {

    const target =
      buildTarget(
        result
      );

    if (
      !target.eventId
    ) {
      continue;
    }

    await saveTarget(
      env,
      target
    );

    const stored =
      await getStoredEvent(
        env,
        target.eventId
      );

    targets.push({
      ...target,

      overOdds:
        stored?.over_odds ??
        null,

      underOdds:
        stored?.under_odds ??
        null,

      oddsUpdatedAt:
        stored?.updated_at ??
        null,

      ready:
        stored?.over_odds !== null &&
        stored?.over_odds !== undefined
    });
  }

  targets.sort(
    (a, b) => {

      const ai =
        Number(
          a.signalId ??
          0
        );

      const bi =
        Number(
          b.signalId ??
          0
        );

      return bi - ai;
    }
  );

  return {
    trackerSignals:
      signals.length,

    matcherHunterResults:
      hunterResults.length,

    targets
  };
}


// ============================================================
// MATCHER
// ============================================================

async function callMatcher(
  env: Env,
  signals: Obj[]
): Promise<Obj> {

  const encoded =
    encodeURIComponent(
      JSON.stringify(
        signals
      )
    );

  return await fetchServiceJSON(
    env.MATCHER,
    "/match?signals=" +
      encoded
  );
}


// ============================================================
// EXTRACT HUNTER SIGNALS
// ============================================================

function extractHunterSignals(
  data: any
): Obj[] {

  let raw: any[] = [];

  if (
    Array.isArray(data)
  ) {
    raw = data;

  } else if (
    Array.isArray(
      data?.hunter_entries
    )
  ) {
    raw =
      data.hunter_entries;

  } else if (
    Array.isArray(
      data?.entries
    )
  ) {
    raw =
      data.entries;

  } else if (
    Array.isArray(
      data?.signals
    )
  ) {
    raw =
      data.signals;

  } else if (
    Array.isArray(
      data?.data
    )
  ) {
    raw =
      data.data;
  }

  return raw
    .filter(
      isHunterEntry
    )
    .map(
      normalizeSignal
    )
    .filter(
      Boolean
    ) as Obj[];
}


// ============================================================
// IS HUNTER ENTRY
// ============================================================

function isHunterEntry(
  item: Obj
): boolean {

  const type =
    safe(
      item?.type ??
      (
        typeof item?.signal ===
        "string"
          ? item.signal
          : ""
      ) ??
      item?.event_type
    )
      .toUpperCase();

  const action =
    safe(
      item?.action
    )
      .toUpperCase();

  const status =
    safe(
      item?.status
    )
      .toUpperCase();

  if (
    type ===
    "HUNTER_ENTRY"
  ) {
    return true;
  }

  if (
    action === "ENTRY" &&
    status === "TRACKING"
  ) {
    return true;
  }

  return false;
}


// ============================================================
// NORMALIZE SIGNAL
// ============================================================

function normalizeSignal(
  item: Obj
): Obj | null {

  const matchName =
    safe(
      item?.match_name ??
      item?.match ??
      item?.name
    );

  const split =
    splitMatch(
      matchName
    );

  const home =
    extractTeamName(
      item?.home
    ) ||
    split.home;

  const away =
    extractTeamName(
      item?.away
    ) ||
    split.away;

  if (
    !matchName &&
    !home &&
    !away
  ) {
    return null;
  }

  // IMPORTANT:
  // DO NOT SEND
  // signal: "HUNTER_ENTRY"
  // TO MATCHER V7.1

  return {
    type:
      "HUNTER_ENTRY",

    action:
      "ENTRY",

    status:
      safe(
        item?.status
      ) ||
      "TRACKING",

    id:
      item?.id ??
      null,

    match_id:
      item?.match_id ??
      null,

    match_name:
      matchName,

    match:
      matchName,

    league:
      item?.league ??
      null,

    entry_time:
      item?.entry_time ??
      null,

    entry_minute:
      numberOrNull(
        item?.entry_minute ??
        item?.minute
      ),

    hunter_score:
      numberOrNull(
        item?.hunter_score ??
        item?.goal_signal?.score
      ),

    goal_pressure:
      numberOrNull(
        item?.goal_pressure
      ),

    danger_index:
      numberOrNull(
        item?.danger_index
      ),

    attack_score:
      numberOrNull(
        item?.attack_score
      ),

    score:
      item?.score ?? {
        home: 0,
        away: 0
      },

    home:
      home ||
      null,

    away:
      away ||
      null
  };
}


// ============================================================
// BUILD TARGET
// ============================================================

function buildTarget(
  result: Obj
): Obj {

  const signal =
    result?.signal ??
    {};

  const cloudbet =
    result?.cloudbet ??
    {};

  const eventId =
    safe(
      cloudbet?.id ??
      cloudbet?.event_id
    );

  const matchName =
    safe(
      signal?.match_name ??
      signal?.match ??
      cloudbet?.match
    );

  const minute =
    numberOrNull(
      signal?.entry_minute ??
      signal?.minute
    );

  const hunterScore =
    numberOrNull(
      signal?.hunter_score
    );

  const score =
    scoreToString(
      signal?.score
    ) ||
    scoreToString(
      cloudbet?.score
    ) ||
    "0:0";

  return {
    eventId,

    signalId:
      signal?.id ??
      null,

    matchId:
      signal?.match_id ??
      null,

    matchName,

    home:
      extractTeamName(
        signal?.home
      ) ||
      extractTeamName(
        cloudbet?.home
      ),

    away:
      extractTeamName(
        signal?.away
      ) ||
      extractTeamName(
        cloudbet?.away
      ),

    minute,

    score,

    hunterScore,

    cloudbetMatch:
      safe(
        cloudbet?.match
      ),

    cloudbetHome:
      extractTeamName(
        cloudbet?.home
      ),

    cloudbetAway:
      extractTeamName(
        cloudbet?.away
      ),

    classification:
      result?.classification ??
      null,

    secureMatch:
      result?.security
        ?.secure_match === true,

    matcherScore:
      numberOrNull(
        result?.scoring?.total ??
        result?.matcher_scoring?.total ??
        result?.score
      )
  };
}


// ============================================================
// SAVE TARGET
// ============================================================

async function saveTarget(
  env: Env,
  target: Obj
): Promise<void> {

  const now =
    new Date()
      .toISOString();

  await env.DB
    .prepare(`
      INSERT INTO live_odds (
        event_id,
        match_name,
        minute,
        score,
        hunter_score,
        market,
        selection,
        over_odds,
        under_odds,
        source,
        created_at,
        updated_at
      )

      VALUES (
        ?1,
        ?2,
        ?3,
        ?4,
        ?5,
        '1H Total Goals',
        'Over 0.5',
        NULL,
        NULL,
        'TRACKER_MATCHER',
        ?6,
        ?6
      )

      ON CONFLICT(event_id)

      DO UPDATE SET
        match_name =
          excluded.match_name,

        minute =
          excluded.minute,

        score =
          excluded.score,

        hunter_score =
          excluded.hunter_score
    `)

    .bind(
      target.eventId,
      target.matchName ||
        null,
      target.minute,
      target.score ||
        null,
      target.hunterScore,
      now
    )

    .run();
}


// ============================================================
// GET STORED EVENT
// ============================================================

async function getStoredEvent(
  env: Env,
  eventId: string
): Promise<Obj | null> {

  return await env.DB
    .prepare(`
      SELECT *
      FROM live_odds
      WHERE event_id = ?1
      LIMIT 1
    `)

    .bind(
      eventId
    )

    .first();
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
        "https://service" +
          path,
        {
          method:
            "GET",

          headers: {
            "accept":
              "application/json"
          }
        }
      )
    );

  const text =
    await response.text();

  if (
    !response.ok
  ) {
    throw new Error(
      "SERVICE_HTTP_" +
      response.status +
      ": " +
      text.slice(
        0,
        300
      )
    );
  }

  try {
    return JSON.parse(
      text
    );

  } catch {
    throw new Error(
      "INVALID_SERVICE_JSON: " +
      text.slice(
        0,
        300
      )
    );
  }
}


// ============================================================
// TEAM NAME
// ============================================================

function extractTeamName(
  value: any
): string {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (
    typeof value ===
      "string" ||
    typeof value ===
      "number"
  ) {
    return safe(
      value
    );
  }

  if (
    typeof value ===
    "object"
  ) {
    return safe(
      value?.name ??
      value?.team_name ??
      value?.title ??
      value?.shortName ??
      value?.short_name
    );
  }

  return "";
}


// ============================================================
// SPLIT MATCH
// ============================================================

function splitMatch(
  value: any
): {
  home: string;
  away: string;
} {

  const text =
    safe(
      value
    );

  if (!text) {
    return {
      home: "",
      away: ""
    };
  }

  const separators = [
    " - ",
    " vs ",
    " v ",
    " @ ",
    " — ",
    " – ",
    " : "
  ];

  for (
    const separator
    of separators
  ) {

    const index =
      text
        .toLowerCase()
        .indexOf(
          separator
            .toLowerCase()
        );

    if (
      index >= 0
    ) {
      return {
        home:
          text
            .slice(
              0,
              index
            )
            .trim(),

        away:
          text
            .slice(
              index +
              separator.length
            )
            .trim()
      };
    }
  }

  return {
    home: "",
    away: ""
  };
}


// ============================================================
// SCORE
// ============================================================

function scoreToString(
  value: any
): string | null {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value ===
    "string"
  ) {
    return (
      value.trim() ||
      null
    );
  }

  if (
    Array.isArray(
      value
    ) &&
    value.length >= 2
  ) {
    return (
      String(
        value[0]
      ) +
      ":" +
      String(
        value[1]
      )
    );
  }

  if (
    typeof value ===
    "object"
  ) {

    const home =
      value?.home ??
      value?.homeScore ??
      value?.home_score;

    const away =
      value?.away ??
      value?.awayScore ??
      value?.away_score;

    if (
      home !== undefined &&
      away !== undefined
    ) {
      return (
        String(home) +
        ":" +
        String(away)
      );
    }
  }

  return null;
}


// ============================================================
// HELPERS
// ============================================================

function safe(
  value: any
): string {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(
    value
  ).trim();
}


function numberOrNull(
  value: any
): number | null {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(
      value
    );

  return Number.isFinite(
    number
  )
    ? number
    : null;
}


function corsHeaders() {
  return {
    "access-control-allow-origin":
      "*",

    "access-control-allow-methods":
      "GET,POST,OPTIONS",

    "access-control-allow-headers":
      "content-type"
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
// CONTROL DASHBOARD
// ============================================================

function renderHtml(): string {

  return `<!DOCTYPE html>

<html lang="bg">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover"
>

<title>
Top Signal Control
</title>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;

  background:
    #090d12;

  color:
    #ffffff;

  font-family:
    Arial,
    Helvetica,
    sans-serif;
}

body {
  min-height:
    100vh;
}

.app {
  width:
    100%;

  max-width:
    760px;

  margin:
    0 auto;

  padding:
    14px;
}

.title {
  margin-top:
    4px;

  font-size:
    24px;

  font-weight:
    900;
}

.subtitle {
  margin-top:
    4px;

  color:
    #788393;

  font-size:
    10px;
}

.summary {
  display:
    grid;

  grid-template-columns:
    repeat(
      3,
      1fr
    );

  gap:
    7px;

  margin-top:
    15px;
}

.box {
  padding:
    10px 4px;

  background:
    #151a22;

  border:
    1px solid
    #252d39;

  border-radius:
    12px;

  text-align:
    center;
}

.number {
  font-size:
    21px;

  font-weight:
    900;
}

.label {
  margin-top:
    2px;

  color:
    #7d8796;

  font-size:
    8px;
}

.status-line {
  margin:
    9px 2px 13px;

  color:
    #8d96a5;

  font-size:
    10px;
}

.list {
  display:
    flex;

  flex-direction:
    column;

  gap:
    10px;
}

.card {
  padding:
    14px;

  background:
    #151a22;

  border:
    1px solid
    #252d39;

  border-radius:
    14px;
}

.card.ready {
  border-color:
    #166534;
}

.match {
  font-size:
    17px;

  font-weight:
    900;

  line-height:
    1.3;
}

.event {
  margin-top:
    4px;

  color:
    #697281;

  font-size:
    9px;
}

.meta {
  display:
    grid;

  grid-template-columns:
    repeat(
      4,
      1fr
    );

  gap:
    6px;

  margin-top:
    10px;
}

.badge {
  padding:
    7px 3px;

  background:
    #202632;

  border-radius:
    7px;

  color:
    #c5ccd8;

  font-size:
    10px;

  text-align:
    center;
}

.market {
  margin-top:
    10px;

  padding:
    8px;

  background:
    #0b1710;

  border:
    1px solid
    #14532d;

  border-radius:
    8px;

  color:
    #86efac;

  font-size:
    10px;
}

.odds {
  margin-top:
    8px;

  font-size:
    35px;

  font-weight:
    900;
}

.state {
  margin-top:
    2px;

  color:
    #fbbf24;

  font-size:
    10px;
}

.actions {
  display:
    grid;

  grid-template-columns:
    1fr auto;

  gap:
    7px;

  margin-top:
    11px;
}

.open {
  padding:
    12px;

  border:
    0;

  border-radius:
    9px;

  background:
    #22c55e;

  color:
    #041009;

  font-size:
    12px;

  font-weight:
    900;

  cursor:
    pointer;
}

.open:disabled {
  opacity:
    0.35;
}

.copy {
  padding:
    0 13px;

  border:
    1px solid
    #334155;

  border-radius:
    9px;

  background:
    #111827;

  color:
    #cbd5e1;

  cursor:
    pointer;
}

.empty {
  padding:
    28px 14px;

  background:
    #151a22;

  border:
    1px solid
    #252d39;

  border-radius:
    14px;

  color:
    #697281;

  font-size:
    12px;

  text-align:
    center;
}

.footer {
  margin-top:
    17px;

  color:
    #475569;

  font-size:
    8px;

  text-align:
    center;
}

@media (
  max-width: 500px
) {

  .app {
    padding:
      10px;
  }

  .meta {
    grid-template-columns:
      repeat(
        2,
        1fr
      );
  }
}

</style>

</head>


<body>

<div class="app">

  <div class="title">
    ⚡ TOP SIGNAL CONTROL
  </div>

  <div class="subtitle">
    V1.7.1 CONTROL · TRACKER → MATCHER → FRONTEND ODDS → CLOUDBET
  </div>


  <div class="summary">

    <div class="box">

      <div
        id="targetsCount"
        class="number"
      >
        0
      </div>

      <div class="label">
        TARGETS
      </div>

    </div>


    <div class="box">

      <div
        id="readyCount"
        class="number"
      >
        0
      </div>

      <div class="label">
        READY
      </div>

    </div>


    <div class="box">

      <div
        id="bestOdds"
        class="number"
      >
        —
      </div>

      <div class="label">
        BEST ODDS
      </div>

    </div>

  </div>


  <div
    id="statusLine"
    class="status-line"
  >
    Loading...
  </div>


  <div
    id="list"
    class="list"
  >
  </div>


  <div class="footer">
    CLOUDBET ISOLATED · EXACT EVENT HAND-OFF ONLY
  </div>

</div>


<script>

const CLOUDBET_ORIGIN =
  "https://www.cloud0007.com";

const POLL_MS =
  3000;

let targets =
  [];


// ==========================================================
// HELPERS
// ==========================================================

function safe(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(
    value
  );
}


function escapeHtml(
  value
) {

  return safe(
    value
  )

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    );
}


function number(
  value,
  decimals = 2
) {

  const n =
    Number(
      value
    );

  if (
    !Number.isFinite(
      n
    )
  ) {
    return "—";
  }

  return n
    .toFixed(
      decimals
    )
    .replace(
      /\\.00$/,
      ""
    );
}


// ==========================================================
// TARGET FIELDS
// ==========================================================

function getEventId(
  target
) {

  return safe(
    target?.eventId ??
    target?.event_id ??
    target?.cloudbetEventId ??
    target?.cloudbet_event_id ??
    target?.id
  );
}


function getMatchName(
  target
) {

  return safe(
    target?.matchName ??
    target?.cloudbetMatch ??
    target?.match_name ??
    target?.match ??
    "Hunter target"
  );
}


// ==========================================================
// CLOUDBET URL
// ==========================================================

function cloudbetUrl(
  target
) {

  const id =
    getEventId(
      target
    );

  if (!id) {
    return "";
  }

  return (
    CLOUDBET_ORIGIN +
    "/en/sports/soccer/live/" +
    encodeURIComponent(
      id
    )
  );
}


// ==========================================================
// CARD
// ==========================================================

function renderCard(
  target,
  index
) {

  const id =
    getEventId(
      target
    );

  const match =
    getMatchName(
      target
    );

  const minute =
    target?.minute ??
    target?.entry_minute ??
    null;

  const hunter =
    target?.hunterScore ??
    target?.hunter_score ??
    null;

  const matcher =
    target?.matcherScore ??
    target?.matcher_score ??
    null;

  const odds =
    target?.overOdds ??
    target?.over_odds ??
    null;

  const score =
    target?.score ??
    "—";

  const ready =
    target?.ready ===
    true;


  return \`

  <div
    class="card \${ready ? "ready" : ""}"
  >

    <div class="match">
      \${escapeHtml(match)}
    </div>


    <div class="event">
      Cloudbet Event
      \${escapeHtml(id || "—")}
    </div>


    <div class="meta">

      <div class="badge">
        ⏱
        \${minute !== null
          ? escapeHtml(minute) + "'"
          : "—"}
      </div>


      <div class="badge">
        🎯
        \${hunter !== null
          ? escapeHtml(hunter)
          : "—"}
      </div>


      <div class="badge">
        Matcher
        \${matcher !== null
          ? number(matcher, 2)
          : "—"}
      </div>


      <div class="badge">
        ⚽
        \${escapeHtml(score)}
      </div>

    </div>


    <div class="market">
      1H TOTAL GOALS
      · OVER 0.5
      · STAKE 1 USDT
    </div>


    <div class="odds">

      \${odds !== null
        ? "@ " +
          number(
            odds,
            2
          )
        : "@ —"}

    </div>


    <div
      class="state"
      style="
        color:
        \${ready
          ? "#86efac"
          : "#fbbf24"}
      "
    >

      \${ready
        ? "READY ✅ · REAL FRONTEND ODDS"
        : "MATCHED ✅ · WAITING FOR FRONTEND ODDS"}

    </div>


    <div class="actions">

      <button
        class="open"
        onclick="openCloudbet(\${index})"
        \${id ? "" : "disabled"}
      >
        OPEN CLOUDBET
      </button>


      <button
        class="copy"
        onclick="copyEventId(\${index})"
      >
        ID
      </button>

    </div>

  </div>

  \`;
}


// ==========================================================
// RENDER
// ==========================================================

function render(
  result
) {

  targets =
    Array.isArray(
      result?.targets
    )
      ? result.targets
      : [];


  const ready =
    targets.filter(
      item =>
        item?.ready ===
        true
    );


  document
    .getElementById(
      "targetsCount"
    )
    .textContent =
      String(
        targets.length
      );


  document
    .getElementById(
      "readyCount"
    )
    .textContent =
      String(
        ready.length
      );


  const prices =
    ready

      .map(
        item =>
          Number(
            item?.overOdds
          )
      )

      .filter(
        Number.isFinite
      );


  document
    .getElementById(
      "bestOdds"
    )
    .textContent =
      prices.length
        ? "@" +
          number(
            Math.max(
              ...prices
            ),
            2
          )
        : "—";


  document
    .getElementById(
      "statusLine"
    )
    .textContent =
      "Tracker " +
      (
        result
          ?.tracker_signals ??
        0
      ) +

      " · Matcher Hunter " +
      (
        result
          ?.matcher_hunter_results ??
        0
      ) +

      " · Secure " +
      targets.length +

      " · refresh 3s";


  const list =
    document
      .getElementById(
        "list"
      );


  if (
    targets.length === 0
  ) {

    list.innerHTML =
      \`
      <div class="empty">

        Няма активен secure Hunter target.

        <br><br>

        Чакаме нов сигнал.

      </div>
      \`;

    return;
  }


  list.innerHTML =
    targets
      .map(
        renderCard
      )
      .join("");
}


// ==========================================================
// REFRESH
// ==========================================================

async function refresh() {

  try {

    const response =
      await fetch(
        "/api/targets?ts=" +
        Date.now(),
        {
          cache:
            "no-store"
        }
      );


    if (
      !response.ok
    ) {
      throw new Error(
        "HTTP " +
        response.status
      );
    }


    const result =
      await response.json();


    render(
      result
    );


  } catch (error) {

    console.error(
      error
    );


    document
      .getElementById(
        "statusLine"
      )
      .textContent =
        "CONNECTION ERROR";

  }
}


// ==========================================================
// OPEN EXACT CLOUDBET EVENT
// ==========================================================

function openCloudbet(
  index
) {

  const target =
    targets[
      index
    ];

  if (!target) {
    return;
  }


  const url =
    cloudbetUrl(
      target
    );

  if (!url) {
    return;
  }


  window.open(
    url,
    "_blank"
  );
}


// ==========================================================
// COPY EVENT ID
// ==========================================================

async function copyEventId(
  index
) {

  const target =
    targets[
      index
    ];

  if (!target) {
    return;
  }


  const id =
    getEventId(
      target
    );

  if (!id) {
    return;
  }


  try {

    await navigator
      .clipboard
      .writeText(
        id
      );

  } catch {}
}


// ==========================================================
// START
// ==========================================================

refresh();

setInterval(
  refresh,
  POLL_MS
);

</script>

</body>

</html>`;
      }
