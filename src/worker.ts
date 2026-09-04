// ============================================================
// TOP SIGNAL
// V1.6 — MATCHER TARGET BRIDGE
//
// D1 PERSISTENT
// HUNTER + MATCHER + CLOUDBET FRONTEND ODDS
// READ ONLY
//
// FLOW:
//
// MATCHER /match
//   -> hunter_results
//   -> secure_match only
//   -> Cloudbet eventId
//   -> D1
//
// Violentmonkey
//   -> Cloudbet frontend
//   -> REAL 1H O0.5 odds
//   -> POST /api/odds
//
// NO BETTING
// ============================================================

const APP_NAME = "top-signal";
const VERSION = "V1.6";

interface Env {
  DB: D1Database;
  MATCHER: Fetcher;
}

type AnyObj =
  Record<string, any>;

type OddsPayload = {
  eventId?: string;
  overOdds?: number;
  underOdds?: number;
  source?: string;
};

type SignalPayload = {
  eventId?: string;
  matchName?: string;
  minute?: number;
  score?: string;
  hunterScore?: number;
};


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
          headers:
            corsHeaders()
        }
      );
    }


    // ========================================================
    // STATUS
    // ========================================================

    if (
      url.pathname === "/api/status" &&
      request.method === "GET"
    ) {

      return json({
        success: true,

        worker:
          APP_NAME,

        version:
          VERSION,

        mode:
          "READ_ONLY",

        status:
          "ONLINE",

        betting:
          "DISABLED",

        storage:
          "D1",

        database:
          "top-signal-db",

        bindings: {
          DB:
            !!env.DB,

          MATCHER:
            !!env.MATCHER
        },

        endpoints: {
          status:
            "GET /api/status",

          target:
            "GET /api/target",

          targets:
            "GET /api/targets",

          sync:
            "GET /api/sync",

          odds_post:
            "POST /api/odds",

          odds_get:
            "GET /api/odds",

          signal_post:
            "POST /api/signal"
        }
      });
    }


    // ========================================================
    // SYNC MATCHER -> D1
    //
    // Reads ALL secure Hunter targets.
    // Saves every secure target.
    // ========================================================

    if (
      url.pathname === "/api/sync" &&
      request.method === "GET"
    ) {

      try {

        const result =
          await syncMatcherTargets(
            env
          );


        return json({
          success: true,
          action:
            "MATCHER_SYNC",

          ...result
        });


      } catch (
        error: any
      ) {

        console.error(
          "GET /api/sync",
          error
        );


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
    // Synchronizes Matcher first,
    // then returns ONE primary secure target.
    // ========================================================

    if (
      url.pathname === "/api/target" &&
      request.method === "GET"
    ) {

      try {

        const synced =
          await syncMatcherTargets(
            env
          );


        const targets =
          synced.targets;


        const primary =
          targets.length
            ? targets[0]
            : null;


        return json({
          success: true,

          found:
            !!primary,

          target:
            primary,

          total_targets:
            targets.length,

          matcher: {
            version:
              synced.matcherVersion,

            hunter_results:
              synced.hunterResults,

            secure_targets:
              targets.length
          },

          timestamp:
            new Date()
              .toISOString()
        });


      } catch (
        error: any
      ) {

        console.error(
          "GET /api/target",
          error
        );


        return json({
          success: false,

          found:
            false,

          target:
            null,

          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // TARGETS
    //
    // Returns ALL secure current Hunter targets.
    // ========================================================

    if (
      url.pathname === "/api/targets" &&
      request.method === "GET"
    ) {

      try {

        const synced =
          await syncMatcherTargets(
            env
          );


        return json({
          success: true,

          count:
            synced.targets.length,

          targets:
            synced.targets,

          matcher_version:
            synced.matcherVersion,

          timestamp:
            new Date()
              .toISOString()
        });


      } catch (
        error: any
      ) {

        return json({
          success: false,

          count: 0,

          targets: [],

          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // RECEIVE REAL CLOUDBET FRONTEND ODDS
    // ========================================================

    if (
      url.pathname === "/api/odds" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request
            .json<OddsPayload>();


        const eventId =
          String(
            body?.eventId ??
            ""
          ).trim();


        const overOdds =
          Number(
            body?.overOdds
          );


        const underOdds =
          Number(
            body?.underOdds
          );


        if (
          !eventId ||
          !Number.isFinite(
            overOdds
          ) ||
          overOdds <= 1
        ) {

          return json({
            success: false,

            error:
              "INVALID_ODDS_PAYLOAD"
          }, 400);
        }


        const source =
          String(
            body?.source ??
            "CLOUDBET_FRONTEND"
          );


        const now =
          new Date()
            .toISOString();


        // ====================================================
        // ODDS UPSERT
        //
        // IMPORTANT:
        // Existing Hunter metadata is preserved.
        // ====================================================

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

              ?4,

              ?5,
              ?5
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

            Number.isFinite(
              underOdds
            )
              ? underOdds
              : null,

            source,

            now
          )

          .run();


        const saved =
          await getEventRow(
            env,
            eventId
          );


        return json({
          success: true,

          action:
            "ODDS_SAVED",

          data:
            saved
        });


      } catch (
        error: any
      ) {

        console.error(
          "POST /api/odds",
          error
        );


        return json({
          success: false,

          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // MANUAL SIGNAL INGEST
    //
    // Kept for diagnostics / fallback.
    // ========================================================

    if (
      url.pathname === "/api/signal" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request
            .json<SignalPayload>();


        const eventId =
          String(
            body?.eventId ??
            ""
          ).trim();


        if (!eventId) {

          return json({
            success: false,
            error:
              "MISSING_EVENT_ID"
          }, 400);
        }


        const matchName =
          String(
            body?.matchName ??
            ""
          ).trim();


        const minute =
          numberOrNull(
            body?.minute
          );


        const score =
          String(
            body?.score ??
            "0:0"
          ).trim();


        const hunterScore =
          numberOrNull(
            body?.hunterScore
          );


        await saveHunterTarget(
          env,
          {
            eventId,
            matchName,
            minute,
            score,
            hunterScore,
            cloudbetMatch:
              null,
            cloudbetMinute:
              null,
            cloudbetScore:
              null
          }
        );


        const saved =
          await getEventRow(
            env,
            eventId
          );


        return json({
          success: true,

          action:
            "SIGNAL_SAVED",

          data:
            saved
        });


      } catch (
        error: any
      ) {

        return json({
          success: false,

          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // READ LATEST RECORD
    // ========================================================

    if (
      url.pathname === "/api/odds" &&
      request.method === "GET"
    ) {

      try {

        const latest =
          await env.DB
            .prepare(`
              SELECT
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

              FROM live_odds

              ORDER BY
                updated_at DESC

              LIMIT 1
            `)

            .first();


        return json({
          success: true,

          data:
            latest ??
            null
        });


      } catch (
        error: any
      ) {

        return json({
          success: false,

          error:
            error?.message ??
            String(error)
        }, 500);
      }
    }


    // ========================================================
    // READ SPECIFIC EVENT
    // ========================================================

    if (
      url.pathname.startsWith(
        "/api/odds/"
      ) &&
      request.method === "GET"
    ) {

      try {

        const eventId =
          decodeURIComponent(
            url.pathname.replace(
              "/api/odds/",
              ""
            )
          );


        const row =
          await getEventRow(
            env,
            eventId
          );


        return json({
          success: true,

          data:
            row ??
            null
        });


      } catch (
        error: any
      ) {

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
        status: 200,

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
// MATCHER SYNC
// ============================================================

async function syncMatcherTargets(
  env: Env
): Promise<{
  matcherVersion: string | null;
  hunterResults: number;
  targets: AnyObj[];
}> {

  // ==========================================================
  // CALL CURRENT MATCHER
  //
  // V7.1 exposes:
  // /match
  // /live
  //
  // We use /match.
  // ==========================================================

  const response =
    await env.MATCHER.fetch(
      new Request(
        "https://matcher.internal/match",
        {
          method:
            "GET"
        }
      )
    );


  if (
    !response.ok
  ) {

    throw new Error(
      "MATCHER_HTTP_" +
      response.status
    );
  }


  const data: AnyObj =
    await response.json();


  if (
    data?.success !== true
  ) {

    throw new Error(
      "MATCHER_NOT_SUCCESS"
    );
  }


  const hunterResults =
    Array.isArray(
      data?.hunter_results
    )
      ? data.hunter_results
      : [];


  // ==========================================================
  // SECURE TARGETS ONLY
  // ==========================================================

  const secure =
    hunterResults.filter(
      (item: AnyObj) => {

        return (
          item?.status ===
            "MATCH" &&

          item?.security
            ?.secure_match ===
            true &&

          item?.classification ===
            "CONFIDENT_MATCH" &&

          item?.cloudbet?.id
        );
      }
    );


  const targets:
    AnyObj[] = [];


  for (
    const item of secure
  ) {

    const target =
      buildTarget(
        item
      );


    if (
      !target.eventId
    ) {
      continue;
    }


    await saveHunterTarget(
      env,
      target
    );


    const stored =
      await getEventRow(
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

      ready:
        stored?.over_odds !==
          null &&
        stored?.over_odds !==
          undefined
    });
  }


  return {
    matcherVersion:
      data?.version ??
      null,

    hunterResults:
      hunterResults.length,

    targets
  };
}


// ============================================================
// BUILD TARGET FROM MATCHER V7.1
// ============================================================

function buildTarget(
  item: AnyObj
): AnyObj {

  const signal =
    item?.signal ??
    {};

  const cloudbet =
    item?.cloudbet ??
    {};


  const eventId =
    String(
      cloudbet?.id ??
      ""
    ).trim();


  const matchName =
    String(
      signal?.match ??
      cloudbet?.match ??
      ""
    ).trim();


  const minute =
    numberOrNull(
      signal?.entry_minute ??
      cloudbet?.minute
    );


  const hunterScore =
    numberOrNull(
      signal?.hunter_score
    );


  const score =
    scoreToString(
      cloudbet?.score
    ) ??
    "0:0";


  return {

    eventId,

    matchName,

    matchId:
      signal?.match_id ??
      null,

    minute,

    score,

    hunterScore,

    home:
      signal?.home ??
      null,

    away:
      signal?.away ??
      null,

    cloudbetMatch:
      cloudbet?.match ??
      null,

    cloudbetHome:
      cloudbet?.home ??
      null,

    cloudbetAway:
      cloudbet?.away ??
      null,

    cloudbetMinute:
      numberOrNull(
        cloudbet?.minute
      ),

    cloudbetScore:
      scoreToString(
        cloudbet?.score
      ),

    competition:
      cloudbet?.competition ??
      null,

    matcherClassification:
      item?.classification ??
      null,

    matcherScore:
      numberOrNull(
        item?.matcher_scoring
          ?.total
      ),

    secureMatch:
      item?.security
        ?.secure_match ===
        true,

    matchMethod:
      item?.security
        ?.match_method ??
      null
  };
}


// ============================================================
// SAVE HUNTER TARGET
//
// IMPORTANT:
// Does NOT delete existing odds.
// ============================================================

async function saveHunterTarget(
  env: Env,
  target: AnyObj
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

        'MATCHER_HUNTER',

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
          excluded.hunter_score,

        updated_at =
          excluded.updated_at
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
// EVENT ROW
// ============================================================

async function getEventRow(
  env: Env,
  eventId: string
): Promise<AnyObj | null> {

  return await env.DB
    .prepare(`
      SELECT
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
// NUMBER
// ============================================================

function numberOrNull(
  value: any
): number | null {

  const n =
    Number(value);


  return Number.isFinite(n)
    ? n
    : null;
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

    const s =
      value.trim();

    return s ||
      null;
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
  data: unknown,
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
  background: #0b0e13;
  color: #ffffff;

  font-family:
    Arial,
    Helvetica,
    sans-serif;
}

.app {
  max-width: 650px;
  margin: 0 auto;
  padding: 18px;
}

.title {
  font-size: 26px;
  font-weight: 900;
}

.subtitle {
  margin-top: 5px;

  color: #8d96a5;

  font-size: 12px;
}

.card {
  margin-top: 22px;

  background: #151a22;

  border:
    1px solid #252c38;

  border-radius: 16px;

  padding: 18px;
}

.match {
  font-size: 19px;
  font-weight: 800;
}

.meta {
  margin-top: 9px;

  display: flex;

  flex-wrap: wrap;

  gap: 7px;
}

.badge {
  background: #202632;

  border-radius: 8px;

  padding: 6px 8px;

  font-size: 12px;

  color: #c5ccd8;
}

.market {
  margin-top: 20px;

  font-size: 11px;

  color: #8d96a5;
}

.odds {
  margin-top: 3px;

  font-size: 50px;

  font-weight: 900;
}

.under {
  margin-top: 5px;

  color: #8d96a5;

  font-size: 12px;
}

.status {
  margin-top: 18px;

  font-size: 12px;

  color: #fbbf24;
}

.updated {
  margin-top: 6px;

  font-size: 10px;

  color: #697281;
}

</style>

</head>

<body>

<div class="app">

  <div class="title">
    ⚡ TOP SIGNAL
  </div>

  <div class="subtitle">
    V1.6 · MATCHER TARGET BRIDGE · READ ONLY
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
      id="under"
      class="under"
    >
      Under: —
    </div>


    <div
      id="status"
      class="status"
    >
      Waiting...
    </div>


    <div
      id="updated"
      class="updated"
    ></div>

  </div>

</div>


<script>

async function refreshTarget() {

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


    if (!target) {

      document.getElementById(
        'status'
      ).textContent =
        'NO CURRENT HUNTER TARGET';

      return;
    }


    document.getElementById(
      'match'
    ).textContent =
      target.matchName ||
      target.cloudbetMatch ||
      'Hunter Target';


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


    document.getElementById(
      'under'
    ).textContent =
      target.underOdds !== null
        ? 'Under: @ ' +
          Number(
            target.underOdds
          ).toFixed(2)
        : 'Under: —';


    const status =
      document.getElementById(
        'status'
      );


    if (
      target.ready
    ) {

      status.textContent =
        'READY ✅ · HUNTER + MATCHER + REAL ODDS';

      status.style.color =
        '#86efac';

    } else {

      status.textContent =
        'HUNTER MATCHED ✅ · WAITING FOR REAL ODDS';

      status.style.color =
        '#fbbf24';
    }


    document.getElementById(
      'updated'
    ).textContent =
      'Cloudbet event: ' +
      target.eventId;

  } catch (
    error
  ) {

    document.getElementById(
      'status'
    ).textContent =
      'MATCHER CONNECTION ERROR';
  }
}


refreshTarget();


setInterval(
  refreshTarget,
  3000
);

</script>

</body>
</html>`;
          }
