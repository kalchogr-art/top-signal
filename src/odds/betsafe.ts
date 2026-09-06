// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V11
// READ ONLY
//
// IMPORTANT DISCOVERY FROM V10:
// shell.js calls:
//
//   `${sbApiBaseUrl ?? ""}/sb/fe-api/ssr/v1/generate?path=...`
//
// If sbApiBaseUrl is null/empty, the request is SAME-ORIGIN.
// Therefore V11 directly tests:
//
//   https://www.betsafe.com/sb/fe-api/ssr/v1/generate
//
// with the exact context headers discovered in shell.js.
//
// NO BETTING
// NO LOGIN
// NO D1 WRITES
// ============================================================

const ORIGIN =
  "https://www.betsafe.com";

const LIVE_PATH =
  "/en/sportsbook/live";

const LIVE_URL =
  ORIGIN + LIVE_PATH;

const SSR_ENDPOINT =
  ORIGIN +
  "/sb/fe-api/ssr/v1/generate";


// ============================================================
// MAIN
// ============================================================

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started =
    Date.now();

  try {

    // ========================================================
    // 1. FETCH LIVE PAGE FOR CONTEXT IDS
    // ========================================================

    const pageResponse =
      await fetch(
        LIVE_URL,
        {
          method: "GET",
          headers: pageHeaders(),
          redirect: "follow"
        }
      );

    const html =
      await pageResponse.text();

    const decodedHtml =
      decode(html);

    const staticContextId =
      extractJsonValue(
        decodedHtml,
        "staticContextId"
      );

    const userContextId =
      extractJsonValue(
        decodedHtml,
        "userContextId"
      );


    if (
      !staticContextId ||
      !userContextId
    ) {

      return {
        success: false,

        source: "BETSAFE",

        diagnostic_version:
          "V11",

        mode:
          "READ_ONLY_DIAGNOSTIC",

        stage:
          "CONTEXT_EXTRACTION",

        error:
          "Missing staticContextId or userContextId",

        page: {
          status:
            pageResponse.status,

          ok:
            pageResponse.ok,

          content_length:
            html.length
        },

        context: {
          staticContextId,
          userContextId
        },

        timing_ms:
          Date.now() -
          started
      };
    }


    // ========================================================
    // 2. DIRECT SAME-ORIGIN SSR REQUEST
    // ========================================================

    const ssrUrl =
      SSR_ENDPOINT +
      "?path=" +
      encodeURI(
        LIVE_PATH
      );

    const ssrResponse =
      await fetch(
        ssrUrl,
        {
          method: "GET",

          headers: {
            ...assetHeaders(),

            "x-sb-static-context-id":
              staticContextId,

            "x-sb-user-context-id":
              userContextId,

            "x-sb-content-type":
              "full",

            "Referer":
              LIVE_URL
          },

          redirect:
            "follow"
        }
      );

    const ssrText =
      await ssrResponse.text();

    const decoded =
      decode(
        ssrText
      );


    // ========================================================
    // 3. COMPACT CONTENT ANALYSIS
    // ========================================================

    const lower =
      decoded.toLowerCase();

    const hints = {
      football:
        lower.includes(
          "football"
        ),

      soccer:
        lower.includes(
          "soccer"
        ),

      live:
        lower.includes(
          "live"
        ),

      event:
        lower.includes(
          "event"
        ),

      market:
        lower.includes(
          "market"
        ),

      odds:
        lower.includes(
          "odds"
        ),

      price:
        lower.includes(
          "price"
        ),

      first_half:
        lower.includes(
          "first half"
        ) ||
        lower.includes(
          "1st half"
        ),

      total_goals:
        lower.includes(
          "total goals"
        ),

      over_05:
        lower.includes(
          "over 0.5"
        ) ||
        lower.includes(
          "over 0,5"
        ),

      under_05:
        lower.includes(
          "under 0.5"
        ) ||
        lower.includes(
          "under 0,5"
        )
    };


    // ========================================================
    // 4. USEFUL SMALL CONTEXTS ONLY
    // ========================================================

    const contexts = {
      first_half:
        findContexts(
          decoded,
          [
            "1st Half",
            "First Half"
          ],
          5,
          700
        ),

      total_goals:
        findContexts(
          decoded,
          [
            "Total Goals",
            "total goals"
          ],
          5,
          700
        ),

      over_05:
        findContexts(
          decoded,
          [
            "Over 0.5",
            "over 0.5",
            "Over 0,5",
            "over 0,5"
          ],
          5,
          700
        ),

      market:
        findContexts(
          decoded,
          [
            "\"markets\"",
            "\"market\"",
            "marketName",
            "market-name"
          ],
          5,
          700
        ),

      odds:
        findContexts(
          decoded,
          [
            "\"odds\"",
            "\"price\"",
            "decimalOdds",
            "decimal-odds"
          ],
          5,
          700
        )
    };


    // ========================================================
    // 5. DETECT RESPONSE SHAPE
    // ========================================================

    const trimmed =
      ssrText.trim();

    const looksJson =
      trimmed.startsWith(
        "{"
      ) ||
      trimmed.startsWith(
        "["
      );

    const looksHtml =
      lower.includes(
        "<html"
      ) ||
      lower.includes(
        "<div"
      ) ||
      lower.includes(
        "<sb-"
      );


    return {
      success: true,

      source: "BETSAFE",

      diagnostic_version:
        "V11",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      discovery:
        "SAME_ORIGIN_SSR_ENDPOINT",

      page: {
        status:
          pageResponse.status,

        ok:
          pageResponse.ok,

        content_length:
          html.length
      },

      context: {
        staticContextId,
        userContextId
      },

      ssr_request: {
        url:
          ssrUrl,

        headers_used: {
          "x-sb-static-context-id":
            staticContextId,

          "x-sb-user-context-id":
            userContextId,

          "x-sb-content-type":
            "full"
        }
      },

      ssr_response: {
        status:
          ssrResponse.status,

        ok:
          ssrResponse.ok,

        content_type:
          ssrResponse.headers.get(
            "content-type"
          ),

        content_length:
          ssrText.length,

        looks_json:
          looksJson,

        looks_html:
          looksHtml
      },

      hints,

      contexts,

      preview:
        normalizeContext(
          decoded.slice(
            0,
            1200
          )
        ),

      timing_ms:
        Date.now() -
        started
    };

  } catch (error: any) {

    return {
      success: false,

      source: "BETSAFE",

      diagnostic_version:
        "V11",

      mode:
        "READ_ONLY_DIAGNOSTIC",

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
// EXTRACT JSON-LIKE VALUE
// ============================================================

function extractJsonValue(
  text: string,
  key: string
): string | null {

  const escaped =
    escapeRegex(
      key
    );

  const patterns = [

    new RegExp(
      `["']${escaped}["']\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${escaped}\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${escaped}\\s*=\\s*["']([^"']+)["']`,
      "i"
    )
  ];

  for (
    const pattern
    of patterns
  ) {

    const match =
      text.match(
        pattern
      );

    if (
      match &&
      match[1]
    ) {
      return clean(
        match[1]
      );
    }
  }

  return null;
}


// ============================================================
// CONTEXT FINDER
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 5,
  radius = 700
): string[] {

  const out:
    string[] = [];

  const lower =
    text.toLowerCase();

  for (
    const rawNeedle
    of needles
  ) {

    const needle =
      rawNeedle.toLowerCase();

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
        index === -1
      ) {
        break;
      }

      const from =
        Math.max(
          0,
          index - radius
        );

      const to =
        Math.min(
          text.length,
          index +
          needle.length +
          radius
        );

      const context =
        normalizeContext(
          text.slice(
            from,
            to
          )
        );

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
// HEADERS
// ============================================================

function pageHeaders(): Record<string, string> {

  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
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


function assetHeaders(): Record<string, string> {

  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/140.0.0.0 Safari/537.36",

    "Accept":
      "*/*",

    "Accept-Language":
      "en-US,en;q=0.9",

    "Cache-Control":
      "no-cache",

    "Pragma":
      "no-cache"
  };
}


// ============================================================
// CLEAN / DECODE
// ============================================================

function normalizeContext(
  value: string
): string {

  return value
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


function clean(
  value: any
): string {

  return decode(
    value
  ).trim();
}


function decode(
  value: any
): string {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)

    .replace(
      /\\\\\//g,
      "/"
    )

    .replace(
      /\\\//g,
      "/"
    )

    .replace(
      /\\u002F/gi,
      "/"
    )

    .replace(
      /\\u003A/gi,
      ":"
    )

    .replace(
      /\\u0026/gi,
      "&"
    )

    .replace(
      /\\u003D/gi,
      "="
    )

    .replace(
      /\\u003F/gi,
      "?"
    )

    .replace(
      /&amp;/g,
      "&"
    )

    .replace(
      /&quot;/g,
      "\""
    );
}


// ============================================================
// REGEX ESCAPE
// ============================================================

function escapeRegex(
  value: string
): string {

  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}
