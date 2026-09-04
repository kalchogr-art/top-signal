// ============================================================
// TOP SIGNAL
// V1.3 — ODDS BRIDGE
// READ ONLY
// ============================================================

const APP_NAME = "top-signal";
const VERSION = "V1.3";

type OddsState = {
  eventId: string | null;
  overOdds: number | null;
  underOdds: number | null;
  source: string | null;
  updatedAt: string | null;
};

let latestOdds: OddsState = {
  eventId: null,
  overOdds: null,
  underOdds: null,
  source: null,
  updatedAt: null
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ========================================================
    // CORS
    // ========================================================

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
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
        betting: "DISABLED"
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
        const body: any =
          await request.json();

        const eventId =
          String(body?.eventId ?? "");

        const overOdds =
          Number(body?.overOdds);

        const underOdds =
          Number(body?.underOdds);

        if (
          !eventId ||
          !Number.isFinite(overOdds) ||
          overOdds <= 1
        ) {
          return json({
            success: false,
            error: "INVALID_ODDS_PAYLOAD"
          }, 400);
        }

        latestOdds = {
          eventId,
          overOdds,
          underOdds:
            Number.isFinite(underOdds)
              ? underOdds
              : null,
          source:
            String(
              body?.source ??
              "CLOUDBET_READER"
            ),
          updatedAt:
            new Date().toISOString()
        };

        return json({
          success: true,
          saved: latestOdds
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
    // READ ODDS
    // ========================================================

    if (
      url.pathname === "/api/odds" &&
      request.method === "GET"
    ) {
      return json({
        success: true,
        data: latestOdds
      });
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
    "access-control-allow-origin": "*",
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
  color: #fff;
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

.title {
  font-size: 25px;
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
  border: 1px solid #252c38;
  border-radius: 16px;
  padding: 18px;
}

.market {
  color: #9ca6b5;
  font-size: 12px;
}

.odds {
  margin-top: 6px;
  font-size: 48px;
  font-weight: 900;
}

.event {
  margin-top: 10px;
  font-size: 13px;
  color: #9ca6b5;
}

.status {
  margin-top: 14px;
  font-size: 12px;
  color: #fbbf24;
}

</style>
</head>

<body>

<div class="app">

  <div class="title">
    ⚡ TOP SIGNAL
  </div>

  <div class="subtitle">
    V1.3 · READ ONLY
  </div>

  <div class="card">

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
      id="event"
      class="event"
    >
      Event ID: —
    </div>

    <div
      id="status"
      class="status"
    >
      Waiting for Cloudbet Reader...
    </div>

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
          cache: 'no-store'
        }
      );

    const json =
      await response.json();

    const data =
      json?.data;

    const oddsEl =
      document.getElementById(
        'odds'
      );

    const eventEl =
      document.getElementById(
        'event'
      );

    const statusEl =
      document.getElementById(
        'status'
      );

    if (
      data &&
      data.overOdds
    ) {

      oddsEl.textContent =
        '@ ' +
        data.overOdds;

      eventEl.textContent =
        'Event ID: ' +
        data.eventId;

      statusEl.textContent =
        'LIVE ODDS RECEIVED ✅';

      statusEl.style.color =
        '#86efac';

    } else {

      oddsEl.textContent =
        '@ —';

      statusEl.textContent =
        'Waiting for Cloudbet Reader...';

    }

  } catch (error) {

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
