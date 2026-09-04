// ============================================================
// TOP SIGNAL
// V1.4 — D1 PERSISTENT ODDS
// READ ONLY
// ============================================================

const APP_NAME = "top-signal";
const VERSION = "V1.4";

interface Env {
  DB: D1Database;
}

type OddsPayload = {
  eventId?: string;
  overOdds?: number;
  underOdds?: number;
  source?: string;

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
          headers: corsHeaders()
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
        worker: APP_NAME,
        version: VERSION,
        mode: "READ_ONLY",
        status: "ONLINE",
        betting: "DISABLED",
        storage: "D1",
        database:
          "top-signal-db"
      });
    }


    // ========================================================
    // RECEIVE ODDS
    // ========================================================

    if (
      url.pathname === "/api/odds" &&
      request.method === "POST"
    ) {

      try {

        const body =
          await request.json<OddsPayload>();


        const eventId =
          String(
            body?.eventId ?? ""
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
          !Number.isFinite(overOdds) ||
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
          new Date().toISOString();


        // ====================================================
        // UPSERT
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

              source =
                excluded.source,

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


        // ====================================================
        // READ SAVED ROW
        // ====================================================

        const saved =
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

              WHERE event_id = ?1

              LIMIT 1
            `)

            .bind(
              eventId
            )

            .first();


        return json({
          success: true,
          saved
        });


      } catch (
        error: any
      ) {

        console.error(
          "POST /api/odds error",
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
    // READ LATEST ODDS
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
            latest ?? null
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
            url.pathname
              .replace(
                "/api/odds/",
                ""
              )
          );


        const row =
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

              WHERE event_id = ?1

              LIMIT 1
            `)

            .bind(
              eventId
            )

            .first();


        return json({
          success: true,
          data:
            row ?? null
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
  max-width: 600px;
  margin: 0 auto;
  padding: 18px;
}

.header {
  margin-bottom: 22px;
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
  background: #151a22;
  border: 1px solid #252c38;
  border-radius: 16px;
  padding: 18px;
}

.match {
  font-size: 19px;
  font-weight: 800;
}

.meta {
  margin-top: 8px;
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

  <div class="header">

    <div class="title">
      ⚡ TOP SIGNAL
    </div>

    <div class="subtitle">
      V1.4 · D1 PERSISTENT · READ ONLY
    </div>

  </div>


  <div class="card">

    <div
      id="match"
      class="match"
    >
      Waiting for signal...
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
      Waiting for Cloudbet Reader...
    </div>


    <div
      id="updated"
      class="updated"
    ></div>

  </div>

</div>


<script>

async function refreshOdds() {

  try {

    const response =
      await fetch(
        '/api/odds?ts=' +
        Date.now(),
        {
          cache:
            'no-store'
        }
      );


    const result =
      await response.json();


    const data =
      result?.data;


    if (
      !data ||
      !data.over_odds
    ) {

      document.getElementById(
        'status'
      ).textContent =
        'Waiting for Cloudbet Reader...';

      return;
    }


    document.getElementById(
      'odds'
    ).textContent =
      '@ ' +
      Number(
        data.over_odds
      ).toFixed(2);


    document.getElementById(
      'under'
    ).textContent =
      data.under_odds
        ? 'Under: @ ' +
          Number(
            data.under_odds
          ).toFixed(2)
        : 'Under: —';


    document.getElementById(
      'event'
    ).textContent =
      'Event ' +
      data.event_id;


    document.getElementById(
      'match'
    ).textContent =
      data.match_name ||
      'Cloudbet Event ' +
      data.event_id;


    document.getElementById(
      'minute'
    ).textContent =
      data.minute !== null
        ? '⏱ ' +
          data.minute +
          "'"
        : '⏱ —';


    document.getElementById(
      'hunter'
    ).textContent =
      data.hunter_score !== null
        ? '🎯 Hunter ' +
          data.hunter_score
        : '🎯 Hunter —';


    document.getElementById(
      'score'
    ).textContent =
      data.score ||
      '⚽ —';


    document.getElementById(
      'status'
    ).textContent =
      'LIVE ODDS RECEIVED ✅';


    document.getElementById(
      'status'
    ).style.color =
      '#86efac';


    document.getElementById(
      'updated'
    ).textContent =
      'Updated: ' +
      (
        data.updated_at ||
        '—'
      );


  } catch (
    error
  ) {

    document.getElementById(
      'status'
    ).textContent =
      'Reader connection error';

  }
}


refreshOdds();


setInterval(
  refreshOdds,
  1500
);

</script>

</body>
</html>`;
}
