// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V3
// READ ONLY
//
// V3:
// - fetch main Betsafe live HTML
// - discover sportsbook main JS bundle
// - fetch that JS bundle
// - inspect it for API / live / event / market / odds endpoints
//
// NO BETTING
// NO LOGIN
// NO D1 WRITES
// ============================================================

const BETSAFE_ORIGIN =
  "https://www.betsafe.com";

const BETSAFE_LIVE_URL =
  BETSAFE_ORIGIN +
  "/en/sportsbook/live";


// ============================================================
// MAIN
// ============================================================

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started = Date.now();

  try {

    // ========================================================
    // 1. FETCH LIVE PAGE
    // ========================================================

    const pageResponse =
      await fetch(
        BETSAFE_LIVE_URL,
        {
          method: "GET",

          headers:
            browserHeaders(),

          redirect:
            "follow"
        }
      );

    const html =
      await pageResponse.text();


    // ========================================================
    // 2. FIND SPORTBOOK MAIN JS
    // ========================================================

    const scripts =
      extractScriptSources(
        html
      );

    const sportsbookScript =
      scripts.find(
        x =>
          x.includes(
            "/widgets/sportsbook/"
          ) &&
          x.includes(
            "/main-"
          ) &&
          x.endsWith(
            ".js"
          )
      ) || null;


    if (!sportsbookScript) {

      return {
        success:
          false,

        source:
          "BETSAFE",

        diagnostic_version:
          "V3",

        stage:
          "SPORTSBOOK_SCRIPT_NOT_FOUND",

        page: {
          status:
            pageResponse.status,

          content_length:
            html.length,

          scripts
        },

        timing_ms:
          Date.now() -
          started
      };
    }


    // ========================================================
    // 3. BUILD ABSOLUTE SCRIPT URL
    // ========================================================

    const scriptUrl =
      sportsbookScript.startsWith(
        "http"
      )
        ? sportsbookScript
        : BETSAFE_ORIGIN +
          sportsbookScript;


    // ========================================================
    // 4. FETCH SPORTBOOK SCRIPT
    // ========================================================

    const jsResponse =
      await fetch(
        scriptUrl,
        {
          method:
            "GET",

          headers: {
            ...browserHeaders(),

            "Accept":
              "*/*",

            "Referer":
              BETSAFE_LIVE_URL
          },

          redirect:
            "follow"
        }
      );

    const js =
      await jsResponse.text();


    const lower =
      js.toLowerCase();


    // ========================================================
    // 5. EXTRACT URLS
    // ========================================================

    const absoluteUrls =
      extractAbsoluteUrls(
        js
      );

    const relativeEndpoints =
      extractRelativeEndpoints(
        js
      );


    const interestingAbsolute =
      absoluteUrls
        .filter(
          isInteresting
        )
        .slice(
          0,
          150
        );


    const interestingRelative =
      relativeEndpoints
        .filter(
          isInteresting
        )
        .slice(
          0,
          200
        );


    // ========================================================
    // 6. CONTEXT SEARCH
    // ========================================================

    const contexts = {

      api:
        findContexts(
          js,
          [
            "/api/",
            "api.",
            "baseUrl",
            "baseURL",
            "endpoint"
          ],
          25
        ),

      live:
        findContexts(
          js,
          [
            "live",
            "inplay",
            "in-play",
            "inPlay"
          ],
          25
        ),

      odds:
        findContexts(
          js,
          [
            "odds",
            "price",
            "prices"
          ],
          25
        ),

      event:
        findContexts(
          js,
          [
            "eventId",
            "event_id",
            "events",
            "event/"
          ],
          25
        ),

      market:
        findContexts(
          js,
          [
            "marketId",
            "market_id",
            "markets",
            "market/"
          ],
          25
        ),

      total:
        findContexts(
          js,
          [
            "total goals",
            "totalGoals",
            "overUnder",
            "over/under",
            "handicap"
          ],
          20
        ),

      socket:
        findContexts(
          js,
          [
            "wss://",
            "websocket",
            "socket"
          ],
          20
        ),

      fetch:
        findContexts(
          js,
          [
            "fetch(",
            "axios",
            "XMLHttpRequest",
            "http.get",
            ".get("
          ],
          25
        )
    };


    // ========================================================
    // 7. FEATURE HINTS
    // ========================================================

    const hints = {

      has_api:
        lower.includes(
          "/api/"
        ) ||
        lower.includes(
          "api."
        ),

      has_live:
        lower.includes(
          "live"
        ),

      has_inplay:
        lower.includes(
          "inplay"
        ) ||
        lower.includes(
          "in-play"
        ),

      has_odds:
        lower.includes(
          "odds"
        ),

      has_markets:
        lower.includes(
          "market"
        ),

      has_event_id:
        lower.includes(
          "eventid"
        ) ||
        lower.includes(
          "event_id"
        ),

      has_websocket:
        lower.includes(
          "wss://"
        ) ||
        lower.includes(
          "websocket"
        ),

      has_graphql:
        lower.includes(
          "graphql"
        )
    };


    // ========================================================
    // RESULT
    // ========================================================

    return {

      success:
        true,

      source:
        "BETSAFE",

      diagnostic_version:
        "V3",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      page: {

        url:
          BETSAFE_LIVE_URL,

        status:
          pageResponse.status,

        ok:
          pageResponse.ok,

        content_length:
          html.length
      },

      sportsbook_script: {

        path:
          sportsbookScript,

        url:
          scriptUrl,

        status:
          jsResponse.status,

        ok:
          jsResponse.ok,

        content_type:
          jsResponse.headers.get(
            "content-type"
          ),

        content_length:
          js.length
      },

      hints,

      discovery: {

        absolute_url_count:
          absoluteUrls.length,

        interesting_absolute_urls:
          interestingAbsolute,

        relative_endpoint_count:
          relativeEndpoints.length,

        interesting_relative_endpoints:
          interestingRelative
      },

      contexts,

      timing_ms:
        Date.now() -
        started
    };

  } catch (error: any) {

    return {

      success:
        false,

      source:
        "BETSAFE",

      diagnostic_version:
        "V3",

      error:
        error?.message ??
        String(error),

      timing_ms:
        Date.now() -
        started
    };
  }
}


// ============================================================
// HEADERS
// ============================================================

function browserHeaders() {

  return {

    "User-Agent":
      "Mozilla/5.0 " +
      "(Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 " +
      "(KHTML, like Gecko) " +
      "Chrome/140.0.0.0 Safari/537.36",

    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

    "Accept-Language":
      "en-US,en;q=0.9",

    "Cache-Control":
      "no-cache",

    "Pragma":
      "no-cache"
  };
}


// ============================================================
// SCRIPT EXTRACTION
// ============================================================

function extractScriptSources(
  html: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /<script[^>]+src=["']([^"']+)["']/gi;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(html)
    )
  ) {

    const value =
      clean(
        match[1]
      );

    if (value) {
      out.add(
        value
      );
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// ABSOLUTE URL EXTRACTION
// ============================================================

function extractAbsoluteUrls(
  text: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /https?:\/\/[^\s"'<>\\]+/gi;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(text)
    )
  ) {

    let value =
      clean(
        match[0]
      );

    value =
      value
        .replace(
          /\\u0026/g,
          "&"
        )
        .replace(
          /&amp;/g,
          "&"
        );

    if (
      value.length >
      8
    ) {
      out.add(
        value
      );
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// RELATIVE ENDPOINT EXTRACTION
// ============================================================

function extractRelativeEndpoints(
  text: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /["'`](\/[^"'`<>\\\s]{3,300})["'`]/g;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(text)
    )
  ) {

    const value =
      clean(
        match[1]
      );

    if (
      value
    ) {
      out.add(
        value
      );
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// INTERESTING FILTER
// ============================================================

function isInteresting(
  value: string
): boolean {

  const s =
    value
      .toLowerCase();

  const keys = [

    "api",

    "sport",

    "sportsbook",

    "live",

    "inplay",

    "in-play",

    "event",

    "fixture",

    "market",

    "odds",

    "price",

    "coupon",

    "feed",

    "bet",

    "socket",

    "stream",

    "graphql",

    "prematch"
  ];

  return keys.some(
    key =>
      s.includes(
        key
      )
  );
}


// ============================================================
// CONTEXT
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 10
): string[] {

  const out:
    string[] = [];

  const lower =
    text
      .toLowerCase();

  for (
    const rawNeedle
    of needles
  ) {

    const needle =
      rawNeedle
        .toLowerCase();

    let start =
      0;

    while (
      out.length <
      maxResults
    ) {

      const index =
        lower.indexOf(
          needle,
          start
        );

      if (
        index ===
        -1
      ) {
        break;
      }

      const from =
        Math.max(
          0,
          index - 250
        );

      const to =
        Math.min(
          text.length,
          index +
          needle.length +
          450
        );

      const context =
        text
          .slice(
            from,
            to
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if (
        context &&
        !out.includes(
          context
        )
      ) {
        out.push(
          context
        );
      }

      start =
        index +
        needle.length;
    }

    if (
      out.length >=
      maxResults
    ) {
      break;
    }
  }

  return out;
}


// ============================================================
// CLEAN
// ============================================================

function clean(
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
  )
    .trim()
    .replace(
      /&quot;/g,
      "\""
    )
    .replace(
      /&amp;/g,
      "&"
    );
    }
