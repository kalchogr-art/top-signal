// ============================================================
// TOP SIGNAL V1.8.1 — MANUAL TARGET CONTROL
//
// TRACKER -> MATCHER -> DASHBOARD
// -> CHECK ODDS / BET NOW
//
// CHECK ODDS:
// - exact Cloudbet event
// - frontend reads 1H O0.5 odds
// - POST /api/odds
// - returns to dashboard
//
// BET NOW:
// - exact Cloudbet event
// - selects 1H O0.5
// - fills 1 USDT
// - NEVER clicks final Place bet
//
// FIX V1.8.1:
// - action/event passed through QUERY + HASH
// - more robust against Cloudbet redirects
//
// Keeps V1.7.1 matcher fix:
// - signal: "HUNTER_ENTRY" is NOT forwarded
// ============================================================

const VERSION = "V1.8.1 MANUAL TARGET";
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
      url.pathname ===
      "/api/status"
    ) {

      return json({
        success: true,

        worker:
          APP_NAME,

        version:
          VERSION,

        mode:
          "MANUAL_TARGET_CONTROL",

        betting:
          "FINAL_SUBMIT_DISABLED",

        storage:
          "D1",

        bindings: {

          DB:
            !!env.DB,

          TRACKER:
            !!env.TRACKER,

          MATCHER:
            !!env.MATCHER
        },

        flow:
          "TRACKER -> MATCHER -> DASHBOARD -> CLOUDBET FRONTEND -> D1"
      });
    }


    // ========================================================
    // DEBUG TRACKER
    // ========================================================

    if (
      url.pathname ===
      "/api/debug/tracker"
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

      } catch (
        error: any
      ) {

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

    if (
      url.pathname ===
      "/api/debug/matcher"
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

      } catch (
        error: any
      ) {

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
      url.pathname ===
        "/api/target" &&
      request.method ===
        "GET"
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

      } catch (
        error: any
      ) {

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
      url.pathname ===
        "/api/targets" &&
      request.method ===
        "GET"
    ) {

      try {

        const result =
          await buildTargets(
            env
          );


        return json({
          success: true,

          version:
            VERSION,

          count:
            result.targets.length,

          tracker_signals:
            result.trackerSignals,

          matcher_hunter_results:
            result.matcherHunterResults,

          targets:
            result.targets
        });

      } catch (
        error: any
      ) {

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
    // SAVE FRONTEND ODDS
    // ========================================================

    if (
      url.pathname ===
        "/api/odds" &&
      request.method ===
        "POST"
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
          overOdds <= 1 ||
          overOdds > 50
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

              source =
                'CLOUDBET_FRONTEND',

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

      } catch (
        error: any
      ) {

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
    // GET ODDS
    // ========================================================

    if (
      url.pathname ===
        "/api/odds" &&
      request.method ===
        "GET"
    ) {

      try {

        const eventId =
          safe(
            url.searchParams
              .get("eventId")
          );


        if (
          eventId
        ) {

          const row =
            await getStoredEvent(
              env,
              eventId
            );


          return json({
            success: true,

            data:
              row ??
              null
          });
        }


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

      } catch (
        error: any
      ) {

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
    // DASHBOARD
    // ========================================================

    return new Response(
      renderHtml(),
      {
        headers: {

          "content-type":
            "text/html; charset=UTF-8",

          "cache-control":
            "no-store, no-cache, must-revalidate"
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
      matcherData
        ?.hunter_results
    )
      ? matcherData
          .hunter_results
      : [];


  const secureResults =
    hunterResults.filter(
      (
        item: Obj
      ) => {

        const eventId =
          safe(
            item
              ?.cloudbet
              ?.id ??
            item
              ?.cloudbet
              ?.event_id
          );


        const secure =
          item
            ?.security
            ?.secure_match ===
          true;


        const classification =
          safe(
            item
              ?.classification
          );


        return (
          !!eventId &&
          secure &&
          classification ===
            "CONFIDENT_MATCH"
        );
      }
    );


  const targets:
    Obj[] = [];


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


    const storedOdds =
      numberOrNull(
        stored?.over_odds
      );


    targets.push({

      ...target,

      overOdds:
        storedOdds,

      underOdds:
        numberOrNull(
          stored?.under_odds
        ),

      oddsUpdatedAt:
        stored
          ?.updated_at ??
        null,

      oddsSource:
        stored
          ?.source ??
        null,

      ready:
        storedOdds !== null
    });
  }


  targets.sort(
    (
      a,
      b
    ) => {

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


      return (
        bi -
        ai
      );
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
// HUNTER SIGNALS
// ============================================================

function extractHunterSignals(
  data: any
): Obj[] {

  let raw:
    any[] = [];


  if (
    Array.isArray(
      data
    )
  ) {

    raw =
      data;

  } else if (
    Array.isArray(
      data
        ?.hunter_entries
    )
  ) {

    raw =
      data
        .hunter_entries;

  } else if (
    Array.isArray(
      data
        ?.entries
    )
  ) {

    raw =
      data
        .entries;

  } else if (
    Array.isArray(
      data
        ?.signals
    )
  ) {

    raw =
      data
        .signals;

  } else if (
    Array.isArray(
      data
        ?.data
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


function isHunterEntry(
  item: Obj
): boolean {

  const type =
    safe(

      item?.type ??

      (
        typeof item
          ?.signal ===
          "string"

          ? item.signal
          : ""
      ) ??

      item
        ?.event_type
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
    action ===
      "ENTRY" &&
    status ===
      "TRACKING"
  ) {
    return true;
  }


  return false;
}


// ============================================================
// NORMALIZE SIGNAL
//
// IMPORTANT:
// No:
// signal: "HUNTER_ENTRY"
// ============================================================

function normalizeSignal(
  item: Obj
): Obj | null {

  const matchName =
    safe(

      item
        ?.match_name ??

      item
        ?.match ??

      item
        ?.name
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

        item
          ?.entry_minute ??

        item
          ?.minute
      ),

    hunter_score:
      numberOrNull(

        item
          ?.hunter_score ??

        item
          ?.goal_signal
          ?.score
      ),

    goal_pressure:
      numberOrNull(
        item
          ?.goal_pressure
      ),

    danger_index:
      numberOrNull(
        item
          ?.danger_index
      ),

    attack_score:
      numberOrNull(
        item
          ?.attack_score
      ),

    score:
      item?.score ??
      {
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
// TARGET
// ============================================================

function buildTarget(
  result: Obj
): Obj {

  const signal =
    result
      ?.signal ??
    {};


  const cloudbet =
    result
      ?.cloudbet ??
    {};


  const eventId =
    safe(

      cloudbet
        ?.id ??

      cloudbet
        ?.event_id
    );


  const matchName =
    safe(

      signal
        ?.match_name ??

      signal
        ?.match ??

      cloudbet
        ?.match
    );


  const minute =
    numberOrNull(

      signal
        ?.entry_minute ??

      signal
        ?.minute
    );


  const hunterScore =
    numberOrNull(
      signal
        ?.hunter_score
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
      signal
        ?.match_id ??
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
        cloudbet
          ?.match
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
      result
        ?.classification ??
      null,

    secureMatch:
      result
        ?.security
        ?.secure_match ===
      true,

    matcherScore:
      numberOrNull(

        result
          ?.scoring
          ?.total ??

        result
          ?.matcher_scoring
          ?.total ??

        result
          ?.score
      )
  };
}


// ============================================================
// D1
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
// SERVICE JSON
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
            accept:
              "application/json"
          }
        }
      )
    );


  const responseText =
    await response.text();


  if (
    !response.ok
  ) {

    throw new Error(

      "SERVICE_HTTP_" +

      response.status +

      ": " +

      responseText
        .slice(
          0,
          300
        )
    );
  }


  try {

    return JSON.parse(
      responseText
    );

  } catch {

    throw new Error(

      "INVALID_SERVICE_JSON: " +

      responseText
        .slice(
          0,
          300
        )
    );
  }
}


// ============================================================
// HELPERS
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


function splitMatch(
  value: any
): {
  home: string;
  away: string;
} {

  const valueText =
    safe(
      value
    );


  if (
    !valueText
  ) {

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
      valueText
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
          valueText
            .slice(
              0,
              index
            )
            .trim(),

        away:
          valueText
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
// DASHBOARD
// ============================================================

function renderHtml():
  string {

  return `<!DOCTYPE html>

<html lang="bg">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
Top Signal Control
</title>

<style>

* {
  box-sizing:
    border-box;
}

body {

  margin:
    0;

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
    760px;

  margin:
    0 auto;

  padding:
    16px;
}

.title {

  font-size:
    25px;

  font-weight:
    900;
}

.subtitle {

  margin-top:
    6px;

  color:
    #8d96a5;

  font-size:
    11px;

  line-height:
    1.5;
}

.summary {

  margin-top:
    16px;

  display:
    grid;

  grid-template-columns:
    repeat(
      3,
      1fr
    );

  gap:
    8px;
}

.sum {

  background:
    #151a22;

  border:
    1px solid
    #252c38;

  border-radius:
    13px;

  padding:
    12px;

  text-align:
    center;
}

.sum .v {

  font-size:
    22px;

  font-weight:
    900;
}

.sum .l {

  margin-top:
    3px;

  font-size:
    9px;

  color:
    #8d96a5;
}

.stats {

  margin-top:
    10px;

  color:
    #7d8797;

  font-size:
    11px;

  line-height:
    1.5;
}

.card {

  margin-top:
    14px;

  padding:
    16px;

  background:
    #151a22;

  border:
    1px solid
    #252c38;

  border-radius:
    16px;
}

.match {

  font-size:
    18px;

  font-weight:
    900;

  line-height:
    1.3;
}

.event {

  margin-top:
    6px;

  color:
    #7d8797;

  font-size:
    10px;

  word-break:
    break-all;
}

.meta {

  display:
    flex;

  flex-wrap:
    wrap;

  gap:
    6px;

  margin-top:
    10px;
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
    11px;
}

.market {

  margin-top:
    16px;

  color:
    #8d96a5;

  font-size:
    10px;
}

.oddsline {

  display:
    flex;

  align-items:
    center;

  justify-content:
    space-between;

  gap:
    10px;

  margin-top:
    4px;
}

.odds {

  font-size:
    38px;

  font-weight:
    900;
}

.state {

  font-size:
    10px;

  text-align:
    right;

  line-height:
    1.4;
}

.ready {

  color:
    #86efac;
}

.waiting {

  color:
    #fbbf24;
}

.actions {

  display:
    grid;

  grid-template-columns:
    1fr 1fr;

  gap:
    8px;

  margin-top:
    14px;
}

.btn {

  border:
    0;

  border-radius:
    11px;

  padding:
    13px 10px;

  font-size:
    12px;

  font-weight:
    900;

  cursor:
    pointer;
}

.check {

  background:
    #2563eb;

  color:
    white;
}

.bet {

  background:
    #16a34a;

  color:
    white;
}

.bet[disabled] {

  background:
    #26303c;

  color:
    #788393;

  cursor:
    not-allowed;
}

.copy {

  margin-top:
    8px;

  width:
    100%;

  background:
    #202632;

  color:
    #cbd5e1;

  border:
    1px solid
    #303947;
}

.empty {

  margin-top:
    18px;

  padding:
    28px 20px;

  background:
    #151a22;

  border:
    1px solid
    #252c38;

  border-radius:
    16px;

  text-align:
    center;

  color:
    #9aa4b3;

  font-size:
    13px;

  line-height:
    1.8;
}

.footer {

  margin-top:
    20px;

  text-align:
    center;

  color:
    #596273;

  font-size:
    9px;

  line-height:
    1.5;
}

.err {

  color:
    #fca5a5;
}

.small {

  font-size:
    9px;

  color:
    #697281;

  margin-top:
    8px;

  line-height:
    1.5;
}


@media (
  max-width:
  430px
) {

  .app {
    padding:
      12px;
  }

  .title {
    font-size:
      22px;
  }

  .odds {
    font-size:
      34px;
  }

  .summary {
    gap:
      6px;
  }

  .sum {
    padding:
      10px 6px;
  }

  .actions {
    grid-template-columns:
      1fr;
  }
}

</style>

</head>

<body>

<div class="app">


  <div class="title">
    ⚡ TOP SIGNAL MANUAL
  </div>


  <div class="subtitle">

    V1.8.1 MANUAL TARGET

    · TRACKER → MATCHER → SELECT MATCH

    → CHECK ODDS / BET NOW

  </div>


  <div class="summary">


    <div class="sum">

      <div
        id="sumTargets"
        class="v"
      >
        0
      </div>

      <div class="l">
        TARGETS
      </div>

    </div>


    <div class="sum">

      <div
        id="sumReady"
        class="v"
      >
        0
      </div>

      <div class="l">
        ODDS READY
      </div>

    </div>


    <div class="sum">

      <div
        id="sumBest"
        class="v"
      >
        —
      </div>

      <div class="l">
        BEST O0.5
      </div>

    </div>


  </div>


  <div
    id="stats"
    class="stats"
  >
    Loading...
  </div>


  <div id="list">
  </div>


  <div class="footer">

    CLOUDBET OPENS ONLY FOR THE TARGET YOU CHOOSE

    · SAFE STAKE 1 USDT

    · PLACE BET IS NEVER AUTO-CLICKED

  </div>


</div>


<script>

const CLOUDBET_ORIGIN =
  'https://www.cloud0007.com';


const REFRESH_MS =
  3000;


// ==========================================================
// ESCAPE
// ==========================================================

function esc(v) {

  return String(
    v ?? ''
  ).replace(

    /[&<>"']/g,

    c => ({

      '&':
        '&amp;',

      '<':
        '&lt;',

      '>':
        '&gt;',

      '"':
        '&quot;',

      "'":
        '&#39;'

    }[c])
  );
}


// ==========================================================
// NUMBER
// ==========================================================

function num(v) {

  const x =
    Number(v);

  return Number
    .isFinite(x)
      ? x
      : null;
}


// ==========================================================
// CLOUDBET EVENT URL
// ==========================================================

function eventUrl(
  target,
  action
) {

  const id =
    String(
      target?.eventId ??
      ''
    )
      .trim();


  const u =
    new URL(

      CLOUDBET_ORIGIN +

      '/en/sports/soccer/live/' +

      encodeURIComponent(
        id
      )
    );


  // Goals tab
  u.searchParams.set(
    'markets-tab',
    'goals'
  );


  // Query hand-off
  u.searchParams.set(
    'ts-action',
    action
  );


  u.searchParams.set(
    'ts-event',
    id
  );


  // Hash hand-off.
  // More resistant to frontend redirects.
  u.hash =
    'ts-action=' +
    encodeURIComponent(
      action
    ) +
    '&ts-event=' +
    encodeURIComponent(
      id
    );


  return u.href;
}


// ==========================================================
// OPEN
// ==========================================================

function go(
  target,
  action
) {

  if (
    !target?.eventId
  ) {
    return;
  }


  location.href =
    eventUrl(
      target,
      action
    );
}


// ==========================================================
// COPY
// ==========================================================

async function copyId(
  id
) {

  try {

    await navigator
      .clipboard
      .writeText(
        String(id)
      );

  } catch {

    const ta =
      document
        .createElement(
          'textarea'
        );


    ta.value =
      String(id);


    document.body
      .appendChild(
        ta
      );


    ta.select();


    document
      .execCommand(
        'copy'
      );


    ta.remove();
  }
}


// ==========================================================
// CARD
// ==========================================================

function card(t) {

  const odds =
    num(
      t?.overOdds
    );


  const ready =
    odds !== null;


  const match =
    esc(

      t?.matchName ||

      t?.cloudbetMatch ||

      'Hunter target'
    );


  const eventId =
    esc(
      t?.eventId ||
      ''
    );


  const minute =

    t?.minute !== null &&
    t?.minute !== undefined

      ? esc(
          t.minute
        ) + "'"

      : '—';


  const hunter =

    t?.hunterScore !== null &&
    t?.hunterScore !== undefined

      ? esc(
          t.hunterScore
        )

      : '—';


  const matcher =

    t?.matcherScore !== null &&
    t?.matcherScore !== undefined

      ? esc(
          t.matcherScore
        )

      : '—';


  const score =
    esc(
      t?.score ||
      '—'
    );


  return (

    '<div class="card">' +


      '<div class="match">' +
        match +
      '</div>' +


      '<div class="event">' +
        'Cloudbet Event ID: ' +
        eventId +
      '</div>' +


      '<div class="meta">' +


        '<div class="badge">' +
          '⏱ ' +
          minute +
        '</div>' +


        '<div class="badge">' +
          '🎯 Hunter ' +
          hunter +
        '</div>' +


        '<div class="badge">' +
          '🔗 Matcher ' +
          matcher +
        '</div>' +


        '<div class="badge">' +
          '⚽ ' +
          score +
        '</div>' +


      '</div>' +


      '<div class="market">' +

        '1H TOTAL GOALS · OVER 0.5 · SAFE STAKE 1 USDT' +

      '</div>' +


      '<div class="oddsline">' +


        '<div class="odds">' +

          (
            ready

              ? '@ ' +
                odds.toFixed(
                  2
                )

              : '@ —'
          ) +

        '</div>' +


        '<div class="state ' +

          (
            ready
              ? 'ready'
              : 'waiting'
          ) +

        '">' +

          (
            ready

              ? 'ODDS READY ✅'

              : 'WAITING FOR CHECK'
          ) +

        '</div>' +


      '</div>' +


      '<div class="actions">' +


        '<button ' +

          'class="btn check" ' +

          'data-action="check" ' +

          'data-id="' +
            eventId +
          '">' +

          'CHECK ODDS' +

        '</button>' +


        '<button ' +

          'class="btn bet" ' +

          'data-action="bet" ' +

          'data-id="' +
            eventId +
          '" ' +

          (
            ready
              ? ''
              : 'disabled'
          ) +

        '>' +

          'BET NOW' +

        '</button>' +


      '</div>' +


      '<button ' +

        'class="btn copy" ' +

        'data-action="copy" ' +

        'data-id="' +
          eventId +
        '">' +

        'COPY EVENT ID' +

      '</button>' +


      '<div class="small">' +

        'CHECK ODDS → отваря само този мач, ' +

        'чете реалния 1H O0.5 коефициент и се връща тук.<br>' +

        'BET NOW → подготвя O0.5 + stake 1 USDT, ' +

        'без да натиска Place bet.' +

      '</div>' +


    '</div>'
  );
}


// ==========================================================
// TARGET STATE
// ==========================================================

let latestTargets =
  [];


// ==========================================================
// REFRESH
// ==========================================================

async function refresh() {

  try {

    const r =
      await fetch(

        '/api/targets?ts=' +
          Date.now(),

        {
          cache:
            'no-store'
        }
      );


    const d =
      await r.json();


    if (
      !r.ok ||
      !d?.success
    ) {

      throw new Error(

        d?.error ||

        (
          'HTTP ' +
          r.status
        )
      );
    }


    latestTargets =

      Array.isArray(
        d.targets
      )

        ? d.targets

        : [];


    const ready =
      latestTargets
        .filter(
          x =>
            num(
              x?.overOdds
            ) !== null
        );


    const best =

      ready

        .map(
          x =>
            num(
              x.overOdds
            )
        )

        .filter(
          x =>
            x !== null
        )

        .sort(
          (
            a,
            b
          ) =>
            b - a
        )[0] ??

      null;


    document
      .getElementById(
        'sumTargets'
      )
      .textContent =
        String(
          latestTargets
            .length
        );


    document
      .getElementById(
        'sumReady'
      )
      .textContent =
        String(
          ready.length
        );


    document
      .getElementById(
        'sumBest'
      )
      .textContent =

        best === null

          ? '—'

          : best
              .toFixed(
                2
              );


    document
      .getElementById(
        'stats'
      )
      .textContent =

        'Tracker ' +

        (
          d.tracker_signals ??
          0
        ) +

        ' · Matcher Hunter ' +

        (
          d.matcher_hunter_results ??
          0
        ) +

        ' · Secure ' +

        latestTargets.length +

        ' · refresh 3s';


    document
      .getElementById(
        'list'
      )
      .innerHTML =

        latestTargets.length

          ? latestTargets
              .map(
                card
              )
              .join('')

          : (

            '<div class="empty">' +

              'Няма активен secure Hunter target.<br>' +

              'Чакаме нов сигнал.' +

            '</div>'
          );


  } catch (
    e
  ) {

    document
      .getElementById(
        'stats'
      )
      .innerHTML =

        '<span class="err">' +

        'CONNECTION ERROR: ' +

        esc(
          e?.message ||
          e
        ) +

        '</span>';
  }
}


// ==========================================================
// BUTTONS
// ==========================================================

document
  .addEventListener(

    'click',

    e => {

      const b =
        e.target
          .closest(
            '[data-action]'
          );


      if (
        !b
      ) {
        return;
      }


      const id =
        b.getAttribute(
          'data-id'
        );


      const action =
        b.getAttribute(
          'data-action'
        );


      const target =
        latestTargets
          .find(
            x =>
              String(
                x?.eventId
              ) ===
              String(
                id
              )
          );


      if (
        action ===
        'copy'
      ) {

        copyId(
          id
        );

        return;
      }


      if (
        !target
      ) {
        return;
      }


      if (
        action ===
        'check'
      ) {

        go(
          target,
          'check'
        );

        return;
      }


      if (
        action ===
          'bet' &&
        !b.disabled
      ) {

        go(
          target,
          'bet'
        );
      }
    }
  );


// ==========================================================
// START
// ==========================================================

refresh();


setInterval(
  refresh,
  REFRESH_MS
);

</script>


</body>

</html>`;
}
