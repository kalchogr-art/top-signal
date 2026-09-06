// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V6
// READ ONLY
//
// V6:
// - fetch Betsafe live HTML
// - locate sportsbook main JS
// - fetch main JS
// - extract dynamic import() chunk files
// - fetch relevant chunks
// - search all chunks for:
//     sbApiBaseUrl
//     fetchUserContext
//     fetchStartupContext
//     /api/sb
//     startup/user/static context endpoints
//     event/market/odds/live request paths
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

const MAX_CHUNKS =
  40;

const MAX_BYTES_PER_FILE =
  2_500_000;


// ============================================================
// MAIN
// ============================================================

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started =
    Date.now();

  try {

    // ========================================================
    // 1. FETCH LIVE PAGE
    // ========================================================

    const pageResponse =
      await fetch(
        BETSAFE_LIVE_URL,
        {
          method: "GET",
          headers: pageHeaders(),
          redirect: "follow"
        }
      );

    const html =
      await pageResponse.text();


    // ========================================================
    // 2. CONTEXT IDS
    // ========================================================

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
    // 3. FIND MAIN SPORTBOOK SCRIPT
    // ========================================================

    const scripts =
      extractScriptSources(
        html
      );

    const mainPath =
      scripts.find(
        x =>
          x.includes(
            "/widgets/sportsbook/"
          ) &&
          x.includes(
            "/main-"
          ) &&
          x.includes(
            ".js"
          )
      ) || null;


    if (!mainPath) {
      return {
        success: false,
        source: "BETSAFE",
        diagnostic_version: "V6",
        stage: "MAIN_SCRIPT_NOT_FOUND",
        scripts,
        timing_ms:
          Date.now() - started
      };
    }


    const mainUrl =
      absoluteUrl(
        mainPath
      );


    // ========================================================
    // 4. FETCH MAIN SCRIPT
    // ========================================================

    const mainResponse =
      await fetch(
        mainUrl,
        {
          method: "GET",

          headers: {
            ...assetHeaders(),
            "Referer":
              BETSAFE_LIVE_URL
          },

          redirect:
            "follow"
        }
      );

    const mainTextRaw =
      await mainResponse.text();

    const mainText =
      mainTextRaw.length >
      MAX_BYTES_PER_FILE
        ? mainTextRaw.slice(
            0,
            MAX_BYTES_PER_FILE
          )
        : mainTextRaw;


    // ========================================================
    // 5. BASE DIRECTORY
    // ========================================================

    const mainDirectory =
      mainUrl.slice(
        0,
        mainUrl.lastIndexOf("/") + 1
      );


    // ========================================================
    // 6. EXTRACT CHUNKS
    // ========================================================

    const dynamicImports =
      extractDynamicImports(
        mainText
      );

    const jsReferences =
      extractJsReferences(
        mainText
      );

    const chunkNames =
      unique([
        ...dynamicImports,
        ...jsReferences
      ])
        .filter(
          x =>
            x.endsWith(".js")
        )
        .filter(
          x =>
            !x.includes(
              "main-DBPLPNWT.js"
            )
        )
        .slice(
          0,
          MAX_CHUNKS
        );


    // ========================================================
    // 7. MAIN FILE ANALYSIS
    // ========================================================

    const mainAnalysis =
      analyseSource(
        "MAIN",
        mainUrl,
        mainText
      );


    // ========================================================
    // 8. FETCH + ANALYSE CHUNKS
    // ========================================================

    const chunkResults:
      Record<string, any>[] = [];

    for (
      const chunk
      of chunkNames
    ) {

      const chunkUrl =
        resolveChunkUrl(
          chunk,
          mainDirectory
        );

      try {

        const response =
          await fetch(
            chunkUrl,
            {
              method: "GET",

              headers: {
                ...assetHeaders(),
                "Referer":
                  BETSAFE_LIVE_URL
              },

              redirect:
                "follow"
            }
          );

        const raw =
          await response.text();

        const text =
          raw.length >
          MAX_BYTES_PER_FILE
            ? raw.slice(
                0,
                MAX_BYTES_PER_FILE
              )
            : raw;

        const analysis =
          analyseSource(
            chunk,
            chunkUrl,
            text
          );

        chunkResults.push({
          ...analysis,

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
              text.length,

            truncated:
              raw.length >
              MAX_BYTES_PER_FILE
          }
        });

      } catch (error: any) {

        chunkResults.push({
          file:
            chunk,

          url:
            chunkUrl,

          error:
            error?.message ??
            String(error)
        });
      }
    }


    // ========================================================
    // 9. IMPORTANT HITS
    // ========================================================

    const allResults =
      [
        mainAnalysis,
        ...chunkResults
      ];

    const importantHits =
      allResults
        .filter(
          x =>
            x?.hints?.has_sb_api_base_url ||
            x?.hints?.has_fetch_user_context ||
            x?.hints?.has_fetch_startup_context ||
            x?.hints?.has_api_sb ||
            x?.hints?.has_context_endpoint ||
            x?.hints?.has_live_endpoint ||
            x?.hints?.has_market_endpoint ||
            x?.hints?.has_event_endpoint
        )
        .map(
          x => ({
            file:
              x.file,

            url:
              x.url,

            hints:
              x.hints,

            endpoint_candidates:
              x.endpoint_candidates,

            contexts:
              x.contexts
          })
        );


    // ========================================================
    // 10. RESULT
    // ========================================================

    return {
      success:
        true,

      source:
        "BETSAFE",

      diagnostic_version:
        "V6",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      sportsbook_context: {
        staticContextId:
          staticContextId || null,

        userContextId:
          userContextId || null
      },

      page: {
        status:
          pageResponse.status,

        ok:
          pageResponse.ok,

        content_length:
          html.length
      },

      main_script: {
        path:
          mainPath,

        url:
          mainUrl,

        status:
          mainResponse.status,

        ok:
          mainResponse.ok,

        content_length:
          mainTextRaw.length
      },

      chunks: {
        discovered:
          chunkNames.length,

        names:
          chunkNames
      },

      important_hits:
        importantHits,

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
        "V6",

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
// ANALYSE SOURCE
// ============================================================

function analyseSource(
  file: string,
  url: string,
  text: string
): Record<string, any> {

  const lower =
    text.toLowerCase();


  const endpointCandidates =
    extractEndpointCandidates(
      text
    );


  return {

    file,
    url,

    hints: {

      has_sb_api_base_url:
        text.includes(
          "sbApiBaseUrl"
        ),

      has_fetch_user_context:
        text.includes(
          "fetchUserContext"
        ),

      has_fetch_startup_context:
        text.includes(
          "fetchStartupContext"
        ),

      has_api_sb:
        lower.includes(
          "/api/sb"
        ),

      has_context_endpoint:
        lower.includes(
          "context"
        ) &&
        (
          lower.includes(
            "/api/"
          ) ||
          lower.includes(
            "/sb/"
          )
        ),

      has_live_endpoint:
        hasEndpointWord(
          endpointCandidates,
          "live"
        ),

      has_event_endpoint:
        hasEndpointWord(
          endpointCandidates,
          "event"
        ),

      has_market_endpoint:
        hasEndpointWord(
          endpointCandidates,
          "market"
        ),

      has_odds:
        lower.includes(
          "odds"
        ),

      has_price:
        lower.includes(
          "price"
        )
    },


    endpoint_candidates:
      endpointCandidates
        .slice(
          0,
          150
        ),


    contexts: {

      sb_api_base_url:
        findContexts(
          text,
          [
            "sbApiBaseUrl"
          ],
          10,
          1200
        ),

      fetch_user_context:
        findContexts(
          text,
          [
            "fetchUserContext"
          ],
          10,
          1200
        ),

      fetch_startup_context:
        findContexts(
          text,
          [
            "fetchStartupContext"
          ],
          10,
          1200
        ),

      api_sb:
        findContexts(
          text,
          [
            "/api/sb",
            "api/sb"
          ],
          15,
          1200
        ),

      context:
        findContexts(
          text,
          [
            "usercontext",
            "startupcontext",
            "staticcontext",
            "currentcontext",
            "context/"
          ],
          15,
          1200
        ),

      event:
        findContexts(
          text,
          [
            "/event",
            "events?",
            "eventId",
            "event-id"
          ],
          15,
          1200
        ),

      market:
        findContexts(
          text,
          [
            "/market",
            "markets?",
            "marketId",
            "market-id"
          ],
          15,
          1200
        ),

      live:
        findContexts(
          text,
          [
            "/live",
            "live?",
            "liveevents",
            "live-events"
          ],
          15,
          1200
        ),

      odds:
        findContexts(
          text,
          [
            "/odds",
            "odds?",
            "prices",
            "price"
          ],
          15,
          1200
        )
    }
  };
}


// ============================================================
// DYNAMIC IMPORT EXTRACTION
// ============================================================

function extractDynamicImports(
  text: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /import\(\s*["'`]([^"'`]+\.js)["'`]\s*\)/g;

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

    if (value) {
      out.add(value);
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// JS REFERENCE EXTRACTION
// ============================================================

function extractJsReferences(
  text: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /["'`]([^"'`]{1,250}\.js)["'`]/g;

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
      value &&
      (
        value.includes("chunk-") ||
        value.includes("shell.") ||
        value.includes("svc-") ||
        value.includes("app-") ||
        value.includes("./")
      )
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
// ENDPOINT CANDIDATES
// ============================================================

function extractEndpointCandidates(
  text: string
): string[] {

  const out =
    new Set<string>();


  // quoted relative paths
  const relativeRegex =
    /["'`]((?:\/|\.\.?\/)[^"'`<>\s]{2,250})["'`]/g;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        relativeRegex.exec(text)
    )
  ) {

    const value =
      clean(
        match[1]
      );

    if (
      looksLikeEndpoint(
        value
      )
    ) {
      out.add(
        value
      );
    }
  }


  // absolute URLs
  const absoluteRegex =
    /https?:\/\/[^\s"'<>\\]{5,300}/gi;

  while (
    (
      match =
        absoluteRegex.exec(text)
    )
  ) {

    const value =
      clean(
        match[0]
      );

    if (
      looksLikeEndpoint(
        value
      )
    ) {
      out.add(
        value
      );
    }
  }


  // plain quoted strings such as "startupcontext"
  const stringRegex =
    /["'`]([^"'`]{3,160})["'`]/g;

  while (
    (
      match =
        stringRegex.exec(text)
    )
  ) {

    const value =
      clean(
        match[1]
      );

    const lower =
      value.toLowerCase();

    if (
      (
        lower.includes("context") ||
        lower.includes("event") ||
        lower.includes("market") ||
        lower.includes("odds") ||
        lower.includes("live")
      ) &&
      (
        value.includes("/") ||
        value.includes("?")
      )
    ) {
      out.add(value);
    }

    if (
      out.size >
      500
    ) {
      break;
    }
  }


  return Array.from(
    out
  );
}


// ============================================================
// ENDPOINT FILTER
// ============================================================

function looksLikeEndpoint(
  value: string
): boolean {

  const s =
    value
      .toLowerCase();

  const words = [
    "/api/",
    "/sb/",
    "context",
    "startup",
    "usercontext",
    "event",
    "market",
    "odds",
    "price",
    "live",
    "fixture",
    "coupon",
    "selection",
    "sport"
  ];

  return words.some(
    x =>
      s.includes(x)
  );
}


function hasEndpointWord(
  endpoints: string[],
  word: string
): boolean {

  const target =
    word.toLowerCase();

  return endpoints.some(
    x =>
      x
        .toLowerCase()
        .includes(
          target
        )
  );
}


// ============================================================
// PAGE SCRIPT EXTRACTION
// ============================================================

function extractScriptSources(
  html: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi;

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
      out.add(value);
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// STRING EXTRACTION
// ============================================================

function extractStringValue(
  text: string,
  key: string
): string {

  const k =
    escapeRegex(
      key
    );

  const patterns = [

    new RegExp(
      `["']${k}["']\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${k}\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${k}\\s*=\\s*["']([^"']+)["']`,
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

  return "";
}


// ============================================================
// CONTEXT FINDER
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 10,
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
// URL HELPERS
// ============================================================

function resolveChunkUrl(
  value: string,
  mainDirectory: string
): string {

  const cleanValue =
    clean(
      value
    );

  if (
    cleanValue.startsWith(
      "http://"
    ) ||
    cleanValue.startsWith(
      "https://"
    )
  ) {
    return cleanValue;
  }

  if (
    cleanValue.startsWith(
      "/"
    )
  ) {
    return (
      BETSAFE_ORIGIN +
      cleanValue
    );
  }

  try {
    return new URL(
      cleanValue,
      mainDirectory
    ).href;
  } catch {
    return (
      mainDirectory +
      cleanValue.replace(
        /^\.\//,
        ""
      )
    );
  }
}


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
      BETSAFE_ORIGIN +
      v
    );
  }

  return (
    BETSAFE_ORIGIN +
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


function assetHeaders(): Record<string, string> {

  return {

    "User-Agent":
      "Mozilla/5.0 " +
      "(Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 " +
      "(KHTML, like Gecko) " +
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

  return String(value)
    .trim()

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
// UNIQUE
// ============================================================

function unique(
  values: string[]
): string[] {

  return Array.from(
    new Set(
      values.filter(
        Boolean
      )
    )
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
