// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V7
// READ ONLY
//
// V7:
// - fetch Betsafe live HTML
// - search exact sportsbook bootstrap inputs
// - locate sbApiBaseUrl source
// - inspect attribute mapping around observedAttributes
//
// NO BETTING
// NO LOGIN
// NO D1 WRITES
// ============================================================

const BETSAFE_URL =
  "https://www.betsafe.com/en/sportsbook/live";

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started = Date.now();

  try {
    const response = await fetch(
      BETSAFE_URL,
      {
        method: "GET",
        headers: {
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
        },

        redirect: "follow"
      }
    );

    const html =
      await response.text();

    const decoded =
      decode(html);


    // ========================================================
    // FIND EXACT VALUES
    // ========================================================

    const direct = {
      sbApiBaseUrl:
        findFirstValue(
          decoded,
          [
            "sbApiBaseUrl",
            "sb-api-base-url"
          ]
        ),

      staticContextId:
        findFirstValue(
          decoded,
          [
            "staticContextId",
            "static-context-id"
          ]
        ),

      userContextId:
        findFirstValue(
          decoded,
          [
            "userContextId",
            "user-context-id"
          ]
        )
    };


    // ========================================================
    // CONTEXTS
    // ========================================================

    const contexts = {

      sb_api_base_url:
        findContexts(
          decoded,
          [
            "sbApiBaseUrl",
            "sb-api-base-url"
          ],
          30,
          1200
        ),

      sportsbook_element:
        findContexts(
          decoded,
          [
            "<sb-xp-sportsbook",
            "sb-xp-sportsbook"
          ],
          20,
          1200
        ),

      static_context:
        findContexts(
          decoded,
          [
            "staticContextId",
            "static-context-id"
          ],
          15,
          900
        ),

      user_context:
        findContexts(
          decoded,
          [
            "userContextId",
            "user-context-id"
          ],
          15,
          900
        ),

      api:
        findContexts(
          decoded,
          [
            "/api/sb",
            "/sb/",
            "sportsbookApi",
            "apiBaseUrl"
          ],
          20,
          900
        )
    };


    // ========================================================
    // ALL HTML ATTRIBUTES ON SPORTBOOK TAG
    // ========================================================

    const sportsbookTags =
      extractSportsbookTags(
        decoded
      );


    return {
      success: true,

      source: "BETSAFE",

      diagnostic_version: "V7",

      mode: "READ_ONLY_DIAGNOSTIC",

      page: {
        status:
          response.status,

        ok:
          response.ok,

        final_url:
          response.url,

        content_length:
          html.length
      },

      direct,

      sportsbook_tags:
        sportsbookTags,

      contexts,

      timing_ms:
        Date.now() - started
    };

  } catch (error: any) {
    return {
      success: false,

      source: "BETSAFE",

      diagnostic_version: "V7",

      error:
        error?.message ??
        String(error),

      timing_ms:
        Date.now() - started
    };
  }
}


// ============================================================
// FIND FIRST VALUE
// ============================================================

function findFirstValue(
  text: string,
  keys: string[]
): string | null {

  for (const key of keys) {
    const escaped =
      escapeRegex(key);

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
      ),

      new RegExp(
        `${escaped}=["']([^"']+)["']`,
        "i"
      )
    ];

    for (const pattern of patterns) {
      const match =
        text.match(pattern);

      if (
        match &&
        match[1]
      ) {
        return clean(
          match[1]
        );
      }
    }
  }

  return null;
}


// ============================================================
// SPORTBOOK TAG EXTRACTION
// ============================================================

function extractSportsbookTags(
  html: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /<sb-xp-sportsbook\b[^>]*>/gi;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(html)
    )
  ) {

    out.add(
      match[0]
        .replace(
          /\s+/g,
          " "
        )
        .trim()
    );
  }

  return Array.from(out);
}


// ============================================================
// CONTEXT FINDER
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 10,
  radius = 600
): string[] {

  const out:
    string[] = [];

  const lower =
    text.toLowerCase();

  for (const rawNeedle of needles) {
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
        !out.includes(context)
      ) {
        out.push(context);
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
// CLEAN
// ============================================================

function clean(
  value: any
): string {

  return decode(
    value
  )
    .trim();
}


// ============================================================
// ESCAPE REGEX
// ============================================================

function escapeRegex(
  value: string
): string {

  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}
