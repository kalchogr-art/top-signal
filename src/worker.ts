// ============================================================
// TOP SIGNAL V1.7
// TRACKER -> MATCHER -> EVENT ID -> FRONTEND ODDS -> D1
//
// READ ONLY
// REAL BETTING DISABLED
// ============================================================

const VERSION = "V1.7";
const APP_NAME = "top-signal";

type Obj = Record<string, any>;

interface Env {
  DB: D1Database;
  TRACKER: Fetcher;
  MATCHER: Fetcher;
}


// ============================================================
// MAIN
// ============================================================

export default {

  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const url =
      new URL(request.url);


    // ========================================================
    // CORS
    // ========================================================

    if (
      request.method === "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,
          headers: corsHeaders()
        }
      );
    }


    // ========================================================
    // STATUS
    // ========================================================

    if (
      url.pathname === "/api/status"
    ) {

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

    if (
      url.pathname === "/api/debug/tracker"
    ) {

      try {

        const data =
          await fetchServiceJSON(
            env.TRACKER,
            "/entries"
          );

        const signals =
          extractHunterSignals(
            data
          );

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

        return json({
          success: false,
          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // DEBUG MATCHER
    // ========================================================

    if (
      url.pathname === "/api/debug/matcher"
    ) {

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

        return json({
          success: false,
          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // TARGET
    //
    // This is the endpoint that the browser reader will poll.
    // ========================================================

    if (
      url.pathname === "/api/target" &&
      request.method === "GET"
    ) {

      try {

        const result =
          await buildTargets(
            env
          );

        const target =
          result.targets[0] ??
          null;

        return json({
          success: true,

          found:
            !!target,

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

        return json({
          success: false,
          found: false,
          target: null,

          error:
            error?.message ??
            String(error)
        }, 500);
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
          await buildTargets(
            env
          );

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

        return json({
          success: false,
          targets: [],

          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // FRONTEND ODDS POST
    //
    // Existing Violentmonkey reader sends here.
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

          return json({
            success: false,
            error:
              "INVALID_ODDS_PAYLOAD"
          }, 400);
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
          action: "ODDS_SAVED",
          data: stored
        });

      } catch (error: any) {

        return json({
          success: false,

          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // LATEST STORED RECORD
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

              ORDER BY
                updated_at DESC

              LIMIT 1
            `)
            .first();

        return json({
          success: true,
          data: row ?? null
        });

      } catch (error: any) {

        return json({
          success: false,

          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // MAIN PAGE
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

  // ==========================================================
  // 1. TRACKER
  // ==========================================================

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


  // ==========================================================
  // 2. MATCHER WITH REAL SIGNALS
  // ==========================================================

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


  // ==========================================================
  // 3. SECURE MATCHES ONLY
  // ==========================================================

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


  const targets: Obj[] =
    [];


  // ==========================================================
  // 4. BUILD + STORE
  // ==========================================================

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
        stored?.over_odds !==
          null &&
        stored?.over_odds !==
          undefined
    });
  }


  // ==========================================================
  // NEWEST / LATEST ENTRY FIRST
  // ==========================================================

  targets.sort(
    (a, b) => {

      const ai =
        Number(
          a.signalId ?? 0
        );

      const bi =
        Number(
          b.signalId ?? 0
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
// CALL MATCHER WITH ?signals=
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


  const path =
    "/match?signals=" +
    encoded;


  return await fetchServiceJSON(
    env.MATCHER,
    path
  );
}


// ============================================================
// TRACKER SIGNAL EXTRACTION
// ============================================================

function extractHunterSignals(
  data: any
): Obj[] {

  let raw: any[] =
    [];


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
// HUNTER FILTER
// ============================================================

function isHunterEntry(
  item: Obj
): boolean {

  const type =
    safe(
      item?.type ??
      item?.signal ??
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
    type === "HUNTER_ENTRY"
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
// NORMALIZE TRACKER SIGNAL
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


  return {

    type:
      "HUNTER_ENTRY",

    signal:
      "HUNTER_ENTRY",

    action:
      "ENTRY",

    status:
      safe(
        item?.status
      ) || "TRACKING",

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
      item?.score ??
      {
        home: 0,
        away: 0
      },

    home:
      home || null,

    away:
      away || null
  };
}


// ============================================================
// BUILD TARGET FROM MATCHER
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
// SAVE TARGET TO D1
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
// READ STORED EVENT
// ============================================================

async function getStoredEvent(
  env: Env,
  eventId: string
): Promise<Obj | null> {

  return await env.DB
    .prepare(`
      SELECT
        *

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
          method: "GET",

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
// TEAM
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
    typeof value === "string" ||
    typeof value === "number"
  ) {

    return safe(value);
  }


  if (
    typeof value === "object"
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
// MATCH SPLIT
// ============================================================

function splitMatch(
  value: any
): {
  home: string;
  away: string;
} {

  const text =
    safe(value);


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
    typeof value === "string"
  ) {

    return (
      value.trim() ||
      null
    );
  }


  if (
    Array.isArray(value) &&
    value.length >= 2
  ) {

    return (
      String(value[0]) +
      ":" +
      String(value[1])
    );
  }


  if (
    typeof value === "object"
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
// BASIC HELPERS
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
    Number(value);


  return Number.isFinite(
    number
  )
    ? number
    : null;
}


// ============================================================
// CORS
// ============================================================

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


// ============================================================
// JSON
// ============================================================

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
// HTML
// ============================================================

function renderHtml(): string {

  return `<!DOCTYPE html>
<html lang="bg">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>Top Signal</title>

<style>

* {
  box-sizing: border-box;
}

body {
  margin: 0;

  background:
    #0b0e13;

  color:
    #ffffff;

  font-family:
    Arial,
    Helvetica,
    sans-serif;
}

.app {
  max-width:
    650px;

  margin:
    0 auto;

  padding:
    18px;
}

.title {
  font-size:
    26px;

  font-weight:
    900;
}

.subtitle {
  margin-top:
    5px;

  color:
    #8d96a5;

  font-size:
    12px;
}

.card {
  margin-top:
    22px;

  padding:
    18px;

  background:
    #151a22;

  border:
    1px solid #252c38;

  border-radius:
    16px;
}

.match {
  font-size:
    19px;

  font-weight:
    800;
}

.meta {
  display:
    flex;

  flex-wrap:
    wrap;

  gap:
    7px;

  margin-top:
    9px;
}

.badge {
  padding:
    6px 8px;

  background:
    #202632;

  border-radius:
    8px;

  color:
    #c5ccd8;

  font-size:
    12px;
}

.market {
  margin-top:
    20px;

  color:
    #8d96a5;

  font-size:
    11px;
}

.odds {
  margin-top:
    3px;

  font-size:
    50px;

  font-weight:
    900;
}

.status {
  margin-top:
    18px;

  color:
    #fbbf24;

  font-size:
    12px;
}

.small {
  margin-top:
    6px;

  color:
    #697281;

  font-size:
    10px;
}

</style>

</head>


<body>

<div class="app">

  <div class="title">
    ⚡ TOP SIGNAL
  </div>

  <div class="subtitle">
    V1.7 · TRACKER → MATCHER → FRONTEND ODDS
  </div>


  <div class="card">

    <div
      id="match"
      class="match"
    >
      Waiting for Hunter...
    </div>


    <div class="meta">

      <div
        id="event"
        class="badge"
      >
        Event —
      </div>

      <div
        id="minute"
        class="badge"
      >
        ⏱ —
      </div>

      <div
        id="hunter"
        class="badge"
      >
        🎯 Hunter —
      </div>

      <div
        id="score"
        class="badge"
      >
        ⚽ —
      </div>

    </div>


    <div class="market">
      1H TOTAL GOALS · OVER 0.5
    </div>


    <div
      id="odds"
      class="odds"
    >
      @ —
    </div>


    <div
      id="status"
      class="status"
    >
      Waiting...
    </div>


    <div
      id="debug"
      class="small"
    ></div>

  </div>

</div>


<script>

async function refresh() {

  try {

    const response =
      await fetch(
        '/api/target?ts=' +
        Date.now(),
        {
          cache:
            'no-store'
        }
      );


    const result =
      await response.json();


    const target =
      result?.target;


    const status =
      document.getElementById(
        'status'
      );


    if (!target) {

      status.textContent =
        'NO SECURE HUNTER TARGET';

      status.style.color =
        '#fbbf24';


      document.getElementById(
        'debug'
      ).textContent =
        'Tracker: ' +
        (
          result?.stats
            ?.tracker_signals ??
          0
        ) +
        ' · Matcher Hunter: ' +
        (
          result?.stats
            ?.matcher_hunter_results ??
          0
        );

      return;
    }


    document.getElementById(
      'match'
    ).textContent =
      target.matchName ||
      target.cloudbetMatch ||
      'Hunter target';


    document.getElementById(
      'event'
    ).textContent =
      'Event ' +
      target.eventId;


    document.getElementById(
      'minute'
    ).textContent =
      target.minute !== null
        ? '⏱ ' +
          target.minute +
          "'"
        : '⏱ —';


    document.getElementById(
      'hunter'
    ).textContent =
      target.hunterScore !== null
        ? '🎯 Hunter ' +
          target.hunterScore
        : '🎯 Hunter —';


    document.getElementById(
      'score'
    ).textContent =
      target.score
        ? '⚽ ' +
          target.score
        : '⚽ —';


    document.getElementById(
      'odds'
    ).textContent =
      target.overOdds !== null
        ? '@ ' +
          Number(
            target.overOdds
          ).toFixed(2)
        : '@ —';


    if (
      target.ready
    ) {

      status.textContent =
        'READY ✅ · REAL FRONTEND ODDS';

      status.style.color =
        '#86efac';

    } else {

      status.textContent =
        'MATCHED ✅ · WAITING FOR FRONTEND ODDS';

      status.style.color =
        '#fbbf24';
    }


    document.getElementById(
      'debug'
    ).textContent =
      'Matcher ' +
      (
        target.matcherScore ??
        '—'
      ) +
      ' · secure=' +
      target.secureMatch;
  }

  catch (error) {

    document.getElementById(
      'status'
    ).textContent =
      'CONNECTION ERROR';
  }
}


refresh();


setInterval(
  refresh,
  3000
);

</script>

</body>
</html>`;
}
