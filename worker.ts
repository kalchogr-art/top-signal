// ============================================================
// TOP SIGNAL
// V1 — BASE WORKER
// READ ONLY
// ============================================================

const APP_NAME = "top-signal";
const VERSION = "V1";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // --------------------------------------------------------
    // HEALTH / API
    // --------------------------------------------------------

    if (url.pathname === "/api/status") {
      return json({
        success: true,
        worker: APP_NAME,
        version: VERSION,
        mode: "READ_ONLY",
        status: "ONLINE",
        betting: "DISABLED"
      });
    }

    // --------------------------------------------------------
    // MAIN PAGE
    // --------------------------------------------------------

    return new Response(renderHtml(), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cache-control": "no-store"
      }
    });
  }
};


// ============================================================
// JSON RESPONSE
// ============================================================

function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "no-store"
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
      margin-bottom: 25px;
    }

    .title {
      font-size: 25px;
      font-weight: 800;
    }

    .status {
      margin-top: 6px;
      color: #8d96a5;
      font-size: 13px;
    }

    .card {
      background: #151a22;
      border: 1px solid #252c38;
      border-radius: 16px;
      padding: 18px;
    }

    .match {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 15px;
    }

    .info {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }

    .badge {
      background: #202632;
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 14px;
    }

    .market {
      color: #9ca6b5;
      font-size: 13px;
      margin-bottom: 5px;
    }

    .odds {
      font-size: 42px;
      font-weight: 900;
      margin-bottom: 20px;
    }

    .waiting {
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 16px;
      font-size: 17px;
      font-weight: 800;
      background: #2b3340;
      color: #8993a2;
    }

    .footer {
      margin-top: 15px;
      color: #697281;
      font-size: 12px;
      text-align: center;
    }

  </style>
</head>

<body>

<div class="app">

  <div class="header">

    <div class="title">
      ⚡ TOP SIGNAL
    </div>

    <div class="status">
      V1 · READ ONLY · BETTING DISABLED
    </div>

  </div>


  <div class="card">

    <div class="match">
      Waiting for Hunter signal...
    </div>


    <div class="info">

      <div class="badge">
        ⏱ —
      </div>

      <div class="badge">
        🎯 Hunter —
      </div>

      <div class="badge">
        ⚽ 0:0
      </div>

    </div>


    <div class="market">
      1H TOTAL GOALS · OVER 0.5
    </div>


    <div class="odds">
      @ —
    </div>


    <button
      class="waiting"
      disabled
    >
      WAITING FOR SIGNAL
    </button>

  </div>


  <div class="footer">
    Top Signal · Goal Hunter Execution Interface
  </div>

</div>

</body>
</html>`;
}
