// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V2
// READ ONLY
//
// PURPOSE:
// - test Betsafe access from Cloudflare
// - inspect HTML for sportsbook/live data
// - discover likely JSON / API / XHR endpoints
// - inspect context around useful keywords
//
// NO:
// - betting
// - login
// - D1 writes
// ============================================================

const BETSAFE_LIVE_URL =
  "https://www.betsafe.com/en/sportsbook/live";


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

          redirect:
            "follow"
        }
      );

    const text =
      await response.text();

    const lower =
      text.toLowerCase();


    // ========================================================
    // BASIC CHECKS
    // ========================================================

    const football =
      hasAny(
        lower,
        [
          "football",
          "soccer"
        ]
      );

    const firstHalf =
      hasAny(
        lower,
        [
          "1st half",
          "first half",
          "1h"
        ]
      );

    const totalGoals =
      hasAny(
        lower,
        [
          "total goals",
          "total_goals",
          "totalgoals",
          "totals"
        ]
      );

    const over05 =
      hasAny(
        lower,
        [
          "over 0.5",
          "over&nbsp;0.5",
          "over 0,5",
          "over0.5"
        ]
      );


    // ========================================================
    // BLOCK CHECK
    //
    // Strong and weak indicators are separated.
    // "forbidden" alone is NOT enough to call the page blocked.
    // ========================================================

    const strongBlockPatterns = [
      "access denied",
      "not available in your country",
      "not available in your region",
      "service unavailable in your region",
      "this website is not available",
      "your country is restricted",
      "geo blocked",
      "geoblocked"
    ];

    const weakBlockPatterns = [
      "forbidden",
      "restricted"
    ];

    const strongBlocked =
      strongBlockPatterns.filter(
        x =>
          lower.includes(x)
      );

    const weakBlocked =
      weakBlockPatterns.filter(
        x =>
          lower.includes(x)
      );


    // ========================================================
    // SCRIPT SOURCES
    // ========================================================

    const scripts =
      extractScriptSources(
        text
      );


    // ========================================================
    // URL DISCOVERY
    // ========================================================

    const absoluteUrls =
      extractAbsoluteUrls(
        text
      );

    const interestingUrls =
      absoluteUrls
        .filter(
          u =>
            isInterestingUrl(u)
        )
        .slice(
          0,
          100
        );


    // ========================================================
    // RELATIVE ENDPOINT DISCOVERY
    // ========================================================

    const relativeEndpoints =
      extractRelativeEndpoints(
        text
      )
        .filter(
          x =>
            isInterestingUrl(x)
        )
        .slice(
          0,
          100
        );


    // ========================================================
    // KEYWORD CONTEXT
    // ========================================================

    const contexts = {
      first_half:
        findContexts(
          text,
          [
            "1st Half",
            "First Half",
            "first half"
          ]
        ),

      total_goals:
        findContexts(
          text,
          [
            "Total Goals",
            "total goals",
            "totalGoals",
            "total_goals"
          ]
        ),

      over_05:
        findContexts(
          text,
          [
            "Over 0.5",
            "over 0.5",
            "Over&nbsp;0.5"
          ]
        ),

      football:
        findContexts(
          text,
          [
            "Football",
            "football",
            "Soccer",
            "soccer"
          ]
        ),

      forbidden:
        findContexts(
          text,
          [
            "forbidden",
            "Forbidden"
          ]
        ),

      api:
        findContexts(
          text,
          [
            "/api/",
            "api.",
            "sportsbook",
            "eventId",
            "event-id"
          ],
          20
        )
    };


    // ========================================================
    // EMBEDDED JSON / APP STATE HINTS
    // ========================================================

    const appStateHints = {
      next_data:
        lower.includes("__next_data__"),

      svelte:
        lower.includes("__svelte"),

      redux:
        lower.includes("redux"),

      hydration:
        lower.includes("hydrate") ||
        lower.includes("hydration"),

      graphql:
        lower.includes("graphql"),

      websocket:
        lower.includes("websocket") ||
        lower.includes("wss://"),

      event_id:
        lower.includes("eventid") ||
        lower.includes("event_id"),

      sportsbook:
        lower.includes("sportsbook"),

      odds:
        lower.includes("odds")
    };


    // ========================================================
    // RESPONSE
    // ========================================================

    return {
      success:
        true,

      source:
        "BETSAFE",

      diagnostic_version:
        "V2",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      target:
        BETSAFE_LIVE_URL,

      http: {
        status:
          response.status,

        ok:
          response.ok,

        status_text:
          response.statusText,

        final_url:
          response.url,

        content_type:
          response.headers.get(
            "content-type"
          ),

        content_length:
          text.length
      },

      block_check: {
        blocked:
          strongBlocked.length > 0,

        strong_matches:
          strongBlocked,

        weak_matches:
          weakBlocked,

        note:
          strongBlocked.length
            ? "POSSIBLE_REAL_BLOCK"
            : "NO_STRONG_BLOCK_DETECTED"
      },

      checks: {
        football,
        first_half:
          firstHalf,

        total_goals:
          totalGoals,

        first_half_total_goals:
          firstHalf &&
          totalGoals,

        over_05:
          over05
      },

      app_state_hints:
        appStateHints,

      discovery: {
        script_count:
          scripts.length,

        scripts:
          scripts.slice(
            0,
            50
          ),

        absolute_url_count:
          absoluteUrls.length,

        interesting_urls:
          interestingUrls,

        relative_endpoints:
          relativeEndpoints
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
        "V2",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      target:
        BETSAFE_LIVE_URL,

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
// CHECK STRING LIST
// ============================================================

function hasAny(
  haystack: string,
  needles: string[]
): boolean {

  for (const needle of needles) {

    if (
      haystack.includes(
        needle.toLowerCase()
      )
    ) {
      return true;
    }

  }

  return false;
}


// ============================================================
// SCRIPT SRC EXTRACTION
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
      cleanUrl(
        match[1]
      );

    if (value) {
      out.add(value);
    }
  }

  return Array.from(out);
}


// ============================================================
// ABSOLUTE URL EXTRACTION
// ============================================================

function extractAbsoluteUrls(
  html: string
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
        regex.exec(html)
    )
  ) {

    let value =
      cleanUrl(
        match[0]
      );

    value =
      value
        .replace(
          /&amp;/g,
          "&"
        )
        .replace(
          /\\u0026/g,
          "&"
        );

    if (
      value.length >
      8
    ) {
      out.add(value);
    }
  }

  return Array.from(out);
}


// ============================================================
// RELATIVE PATH / ENDPOINT EXTRACTION
// ============================================================

function extractRelativeEndpoints(
  html: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /["'](\/[^"'<>\\\s]{3,300})["']/g;

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
      cleanUrl(
        match[1]
      );

    if (value) {
      out.add(value);
    }
  }

  return Array.from(out);
}


// ============================================================
// INTERESTING URL FILTER
// ============================================================

function isInterestingUrl(
  value: string
): boolean {

  const s =
    value
      .toLowerCase();

  const words = [
    "api",
    "sport",
    "sportsbook",
    "live",
    "event",
    "odds",
    "market",
    "fixture",
    "coupon",
    "bet",
    "feed",
    "prematch",
    "inplay",
    "in-play",
    "graphql",
    "socket",
    "stream"
  ];

  return words.some(
    x =>
      s.includes(x)
  );
}


// ============================================================
// CONTEXT FINDER
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 10
): string[] {

  const out:
    string[] = [];

  const lower =
    text.toLowerCase();

  for (const needleRaw of needles) {

    const needle =
      needleRaw.toLowerCase();

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
          index - 250
        );

      const to =
        Math.min(
          text.length,
          index +
          needle.length +
          400
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
// CLEAN URL
// ============================================================

function cleanUrl(
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
      /&quot;/g,
      "\""
    )
    .replace(
      /&amp;/g,
      "&"
    );
    }
