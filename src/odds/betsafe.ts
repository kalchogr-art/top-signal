// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V9
// READ ONLY
//
// V9:
// - fetch Betsafe live HTML
// - discover:
//     main-*.js
//     shell.*.js
//     entry-client-routing*.js
// - inspect ONLY client bootstrap/injection logic
// - search exact assignments of:
//     sbApiBaseUrl
//     sb-api-base-url
//     SBB2B_SPORTSBOOK
//     window.SBB2B_SPORTSBOOK
//     setAttribute(...)
//     observedAttributes
//     static-context-id
//     user-context-id
//
// NO BETTING
// NO LOGIN
// NO D1 WRITES
// ============================================================

const ORIGIN =
  "https://www.betsafe.com";

const LIVE_URL =
  ORIGIN +
  "/en/sportsbook/live";

const MAX_BYTES =
  3_000_000;


// ============================================================
// MAIN
// ============================================================

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started =
    Date.now();

  try {

    // ========================================================
    // PAGE
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


    // ========================================================
    // TARGET SCRIPTS
    // ========================================================

    const scripts =
      discoverTargetScripts(
        decodedHtml
      );


    // ========================================================
    // PAGE SUMMARY
    // ========================================================

    const pageSummary = {
      staticContextId:
        extractValue(
          decodedHtml,
          "staticContextId"
        ),

      userContextId:
        extractValue(
          decodedHtml,
          "userContextId"
        ),

      sbApiBaseUrl:
        extractValue(
          decodedHtml,
          "sbApiBaseUrl"
        ),

      sportsbookTag:
        extractSportsbookTag(
          decodedHtml
        )
    };


    // ========================================================
    // FETCH TARGET FILES
    // ========================================================

    const files: Record<string, any>[] =
      [];

    for (
      const path
      of scripts
    ) {

      const url =
        absoluteUrl(
          path
        );

      try {

        const response =
          await fetch(
            url,
            {
              method: "GET",

              headers: {
                ...assetHeaders(),
                "Referer": LIVE_URL
              },

              redirect: "follow"
            }
          );

        const raw =
          await response.text();

        const source =
          raw.length >
          MAX_BYTES
            ? raw.slice(
                0,
                MAX_BYTES
              )
            : raw;

        files.push({
          file:
            path,

          url,

          http: {
            status:
              response.status,

            ok:
              response.ok,

            content_type:
              response.headers.get(
                "content-type"
              ),

            content_length:
              raw.length,

            inspected_length:
              source.length,

            truncated:
              raw.length >
              MAX_BYTES
          },

          exact_matches:
            buildExactMatches(
              source
            )
        });

      } catch (error: any) {

        files.push({
          file:
            path,

          url,

          error:
            error?.message ??
            String(error)
        });
      }
    }


    // ========================================================
    // KEEP ONLY USEFUL FILES
    // ========================================================

    const usefulFiles =
      files.filter(
        item =>
          item?.exact_matches?.has_any ===
          true
      );


    return {
      success:
        true,

      source:
        "BETSAFE",

      diagnostic_version:
        "V9",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      page: {
        status:
          pageResponse.status,

        ok:
          pageResponse.ok,

        content_length:
          html.length
      },

      page_summary:
        pageSummary,

      target_scripts:
        scripts,

      useful_files:
        usefulFiles,

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
        "V9",

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
// EXACT MATCHES
// ============================================================

function buildExactMatches(
  source: string
): Record<string, any> {

  const sbApiBaseUrl =
    findContexts(
      source,
      [
        "sbApiBaseUrl",
        "sb-api-base-url"
      ],
      20,
      1800
    );

  const sbb2b =
    findContexts(
      source,
      [
        "window.SBB2B_SPORTSBOOK",
        "SBB2B_SPORTSBOOK"
      ],
      20,
      1800
    );

  const setAttribute =
    findContexts(
      source,
      [
        'setAttribute("sb-api-base-url"',
        "setAttribute('sb-api-base-url'",
        "setAttribute(\"static-context-id\"",
        "setAttribute(\"user-context-id\"",
        "setAttribute("
      ],
      25,
      1800
    );

  const observedAttributes =
    findContexts(
      source,
      [
        "observedAttributes",
        "attributeChangedCallback",
        "notifyChanges",
        "trackInputs$"
      ],
      20,
      1800
    );

  const bootstrapInputs =
    findContexts(
      source,
      [
        "indexHtmlUrl",
        "ssrContentType",
        "initialRoute",
        "theme",
        "exposeObgState"
      ],
      20,
      1800
    );

  const assignment =
    findContexts(
      source,
      [
        "SBB2B_SPORTSBOOK=",
        "SBB2B_SPORTSBOOK =",
        ".SBB2B_SPORTSBOOK=",
        ".SBB2B_SPORTSBOOK ="
      ],
      20,
      2200
    );

  const apiPaths =
    findContexts(
      source,
      [
        "/api/sb",
        "/sb/",
        "fetchUserContext",
        "fetchStartupContextAndClientConfig"
      ],
      20,
      1800
    );


  return {
    has_any:
      sbApiBaseUrl.length > 0 ||
      sbb2b.length > 0 ||
      setAttribute.length > 0 ||
      assignment.length > 0 ||
      observedAttributes.length > 0,

    sb_api_base_url:
      sbApiBaseUrl,

    sbb2b:
      sbb2b,

    assignment:
      assignment,

    set_attribute:
      setAttribute,

    observed_attributes:
      observedAttributes,

    bootstrap_inputs:
      bootstrapInputs,

    api_paths:
      apiPaths
  };
}


// ============================================================
// DISCOVER TARGET SCRIPTS
// ============================================================

function discoverTargetScripts(
  html: string
): string[] {

  const out =
    new Set<string>();

  const patterns = [

    /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi,

    /["']([^"']*entry-client-routing[^"']*\.js)["']/gi,

    /["']([^"']*shell\.[^"']*\.js)["']/gi,

    /["']([^"']*main-[^"']*\.js)["']/gi
  ];

  for (
    const regex
    of patterns
  ) {

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

      if (!value) {
        continue;
      }

      if (
        value.includes(
          "challenge."
        ) ||
        value.includes(
          "awst"
        )
      ) {
        continue;
      }

      if (
        value.includes(
          "/widgets/sportsbook/"
        ) ||
        value.includes(
          "entry-client-routing"
        ) ||
        value.includes(
          "shell."
        ) ||
        value.includes(
          "main-"
        )
      ) {
        out.add(
          value
        );
      }
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// EXTRACT VALUE
// ============================================================

function extractValue(
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
    ),

    new RegExp(
      `${escaped}=["']([^"']+)["']`,
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
// SPORTBOOK TAG
// ============================================================

function extractSportsbookTag(
  html: string
): string | null {

  const match =
    html.match(
      /<sb-xp-sportsbook\b[^>]*>/i
    );

  if (!match) {
    return null;
  }

  return match[0]
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// ============================================================
// CONTEXT FINDER
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 10,
  radius = 1000
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
// URL
// ============================================================

function absoluteUrl(
  value: string
): string {

  const v =
    clean(
      value
    );

  if (
    v.startsWith(
      "http://"
    ) ||
    v.startsWith(
      "https://"
    )
  ) {
    return v;
  }

  if (
    v.startsWith(
      "/"
    )
  ) {
    return (
      ORIGIN +
      v
    );
  }

  return (
    ORIGIN +
    "/" +
    v
  );
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
