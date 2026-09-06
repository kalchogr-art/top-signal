// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V4
// READ ONLY
//
// V4:
// - fetch Betsafe live HTML
// - extract sportsbook init data
// - extract:
//     sbApiBaseUrl
//     staticContextId
//     userContextId
// - inspect context around SBB2B_SPORTSBOOK
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
    const response =
      await fetch(
        BETSAFE_LIVE_URL,
        {
          method: "GET",
          headers: browserHeaders(),
          redirect: "follow"
        }
      );

    const html =
      await response.text();


    // ========================================================
    // DIRECT EXTRACTION
    // ========================================================

    const sbApiBaseUrl =
      extractStringValue(
        html,
        "sbApiBaseUrl"
      );

    const staticContextId =
      extractStringValue(
        html,
        "staticContextId"
      );

    const userContextId =
      extractStringValue(
        html,
        "userContextId"
      );


    // ========================================================
    // SEARCH RELEVANT CONTEXT
    // ========================================================

    const contexts = {
      sbb2b:
        findContexts(
          html,
          [
            "SBB2B_SPORTSBOOK",
            "sbApiBaseUrl"
          ],
          15,
          800
        ),

      static_context:
        findContexts(
          html,
          [
            "staticContextId"
          ],
          10,
          600
        ),

      user_context:
        findContexts(
          html,
          [
            "userContextId"
          ],
          10,
          600
        ),

      api_sb:
        findContexts(
          html,
          [
            "/api/sb",
            "api/sb"
          ],
          10,
          600
        )
    };


    // ========================================================
    // SCRIPT LIST
    // ========================================================

    const scripts =
      extractScriptSources(
        html
      );


    // ========================================================
    // RESULT
    // ========================================================

    return {
      success: true,

      source: "BETSAFE",

      diagnostic_version: "V4",

      mode: "READ_ONLY_DIAGNOSTIC",

      page: {
        url: BETSAFE_LIVE_URL,
        status: response.status,
        ok: response.ok,
        final_url: response.url,
        content_type:
          response.headers.get(
            "content-type"
          ),
        content_length:
          html.length
      },

      sportsbook_context: {
        sbApiBaseUrl:
          sbApiBaseUrl || null,

        staticContextId:
          staticContextId || null,

        userContextId:
          userContextId || null,

        complete:
          !!(
            sbApiBaseUrl &&
            staticContextId &&
            userContextId
          )
      },

      scripts,

      contexts,

      timing_ms:
        Date.now() - started
    };

  } catch (error: any) {
    return {
      success: false,

      source: "BETSAFE",

      diagnostic_version: "V4",

      mode: "READ_ONLY_DIAGNOSTIC",

      error:
        error?.message ??
        String(error),

      timing_ms:
        Date.now() - started
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
// EXTRACT STRING VALUE
// Supports:
// "key":"value"
// "key": "value"
// key:"value"
// key = "value"
// escaped JSON forms
// ============================================================

function extractStringValue(
  text: string,
  key: string
): string {

  const patterns = [

    new RegExp(
      `["']${escapeRegex(key)}["']\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${escapeRegex(key)}\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${escapeRegex(key)}\\s*=\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `\\\\["']${escapeRegex(key)}\\\\["']\\s*:\\s*\\\\["']([^\\\\]+)\\\\["']`,
      "i"
    )
  ];

  for (const pattern of patterns) {
    const match =
      text.match(
        pattern
      );

    if (
      match &&
      match[1]
    ) {
      return decodeValue(
        match[1]
      );
    }
  }

  return "";
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
      decodeValue(
        match[1]
      );

    if (value) {
      out.add(value);
    }
  }

  return Array.from(out);
}


// ============================================================
// CONTEXT SEARCH
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 10,
  radius = 500
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
// DECODE
// ============================================================

function decodeValue(
  value: any
): string {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .trim()
    .replace(
      /\\u002F/gi,
      "/"
    )
    .replace(
      /\\\//g,
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
