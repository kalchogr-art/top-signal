// ============================================================
// TOP SIGNAL — CLOUDBET DIAGNOSTIC V3
// FILE: src/odds/cloudbet.ts
//
// READ ONLY — TARGETED SPORTS API DISCOVERY
//
// V3:
// - targets Cloudbet sportsbook chunks only
// - searches concrete sports-api request construction
// - searches api.cloudbet.com
// - searches event / market request builders
// - searches exact 1H total goals market type
// - DOES NOT call betting/place/order endpoints
//
// NO:
// - login
// - auth token
// - cookies
// - POST
// - bet placement
// ============================================================

const VERSION = "V3";
const MODE = "READ_ONLY_DIAGNOSTIC";

const CLOUDBET =
  "https://www.cloudbet.com";

const PAGES = [
  "https://www.cloudbet.com/en/sports/live",
  "https://www.cloudbet.com/en/sports/soccer"
];

const MAX_SCRIPTS = 65;
const TIMEOUT_MS = 8000;

const TARGET_MARKET =
  "soccer_total_goals_period_first_half";


// ============================================================
// PUBLIC EXPORT
// ============================================================

export async function debugCloudbet(): Promise<any> {

  const started = Date.now();

  try {

    // ========================================================
    // 1. LOAD CLOUDBET SPORTS PAGES
    // ========================================================

    const pages: any[] = [];

    const allScripts =
      new Set<string>();

    let bestHtml = "";
    let bestPage = "";


    for (const page of PAGES) {

      const result =
        await fetchText(page);

      pages.push({
        url: page,
        final_url: result.finalUrl,
        status: result.status,
        ok: result.ok,
        content_type: result.contentType,
        content_length: result.text.length,
        error: result.error || null
      });


      if (
        result.ok &&
        result.text.length >
          bestHtml.length
      ) {

        bestHtml =
          result.text;

        bestPage =
          result.finalUrl;

      }


      if (result.ok) {

        const scripts =
          extractScripts(
            result.text,
            result.finalUrl
          );

        for (
          const script
          of scripts
        ) {
          allScripts.add(
            script
          );
        }

      }

    }


    if (!bestHtml) {

      return {
        success: false,
        source: "CLOUDBET",
        diagnostic_version: VERSION,
        mode: MODE,
        error: "NO_CLOUDBET_HTML",
        pages,
        timing_ms:
          Date.now() - started
      };

    }


    // ========================================================
    // 2. PRIORITIZE CHUNKS
    // ========================================================

    const scripts =
      [...allScripts]
        .sort(
          (a, b) =>
            scriptScore(b) -
            scriptScore(a)
        )
        .slice(
          0,
          MAX_SCRIPTS
        );


    // ========================================================
    // 3. TARGET COLLECTION
    // ========================================================

    const usefulScripts: any[] = [];

    const apiPaths =
      new Map<string, any>();

    const absoluteUrls =
      new Map<string, any>();

    const requestBuilders: any[] = [];

    const apiContexts: any[] = [];

    const marketContexts: any[] = [];

    const eventContexts: any[] = [];


    // ========================================================
    // 4. ANALYZE HTML
    // ========================================================

    analyzeTargetSource(
      bestHtml,
      bestPage,
      apiPaths,
      absoluteUrls,
      requestBuilders,
      apiContexts,
      marketContexts,
      eventContexts
    );


    // ========================================================
    // 5. ANALYZE JS
    // ========================================================

    for (
      const scriptUrl
      of scripts
    ) {

      const response =
        await fetchText(
          scriptUrl
        );


      if (
        !response.ok ||
        !response.text
      ) {
        continue;
      }


      const text =
        response.text;

      const lower =
        text.toLowerCase();


      const relevant =
        lower.includes(
          "/sports-api/"
        ) ||

        lower.includes(
          "api.cloudbet.com"
        ) ||

        lower.includes(
          TARGET_MARKET
        ) ||

        lower.includes(
          "soccer_total_goals"
        ) ||

        (
          lower.includes(
            "eventid"
          ) &&
          lower.includes(
            "market"
          )
        );


      if (!relevant) {
        continue;
      }


      const before = {

        paths:
          apiPaths.size,

        urls:
          absoluteUrls.size,

        requests:
          requestBuilders.length,

        apiContexts:
          apiContexts.length,

        marketContexts:
          marketContexts.length,

        eventContexts:
          eventContexts.length

      };


      analyzeTargetSource(
        text,
        scriptUrl,
        apiPaths,
        absoluteUrls,
        requestBuilders,
        apiContexts,
        marketContexts,
        eventContexts
      );


      usefulScripts.push({

        url:
          scriptUrl,

        content_length:
          text.length,

        hints: {

          sports_api:
            lower.includes(
              "/sports-api/"
            ),

          api_cloudbet:
            lower.includes(
              "api.cloudbet.com"
            ),

          event_id:
            lower.includes(
              "eventid"
            ) ||
            lower.includes(
              "event_id"
            ),

          market:
            lower.includes(
              "market"
            ),

          selections:
            lower.includes(
              "selection"
            ),

          exact_target_market:
            lower.includes(
              TARGET_MARKET
            ),

          soccer_total_goals:
            lower.includes(
              "soccer_total_goals"
            )

        },

        new_findings: {

          api_paths:
            apiPaths.size -
            before.paths,

          absolute_urls:
            absoluteUrls.size -
            before.urls,

          request_builders:
            requestBuilders.length -
            before.requests,

          api_contexts:
            apiContexts.length -
            before.apiContexts,

          market_contexts:
            marketContexts.length -
            before.marketContexts,

          event_contexts:
            eventContexts.length -
            before.eventContexts

        }

      });

    }


    // ========================================================
    // 6. PREPARE PATHS
    // ========================================================

    const discoveredPaths =
      [...apiPaths.values()]
        .map(
          (x: any) => ({
            ...x,

            score:
              scoreApiPath(
                x.path
              )
          })
        )
        .sort(
          (a: any, b: any) =>
            b.score - a.score
        );


    const discoveredUrls =
      [...absoluteUrls.values()]
        .map(
          (x: any) => ({
            ...x,

            score:
              scoreAbsoluteUrl(
                x.url
              )
          })
        )
        .sort(
          (a: any, b: any) =>
            b.score - a.score
        );


    // ========================================================
    // 7. REQUEST BUILDERS
    // ========================================================

    const requests =
      dedupeObjects(
        requestBuilders,
        item =>
          [
            item.type,
            item.method,
            item.context
          ].join("|")
      )
        .map(
          (x: any) => ({
            ...x,

            score:
              scoreRequest(
                x
              )
          })
        )
        .sort(
          (a: any, b: any) =>
            b.score - a.score
        );


    // ========================================================
    // RESULT
    // ========================================================

    return {

      success: true,

      source:
        "CLOUDBET",

      diagnostic_version:
        VERSION,

      mode:
        MODE,


      safety: {

        http_methods_used_by_diagnostic: [
          "GET"
        ],

        login:
          false,

        auth:
          false,

        cookies:
          false,

        betting:
          false,

        place_endpoint_called:
          false,

        orders_endpoint_called:
          false,

        lines_endpoint_called:
          false

      },


      target: {

        sport:
          "SOCCER",

        period:
          "FIRST_HALF",

        market_type:
          TARGET_MARKET,

        outcome:
          "over",

        params:
          "total=0.5"

      },


      summary: {

        best_page:
          bestPage,

        scripts_discovered:
          allScripts.size,

        scripts_checked:
          scripts.length,

        useful_scripts:
          usefulScripts.length,

        api_paths_found:
          discoveredPaths.length,

        absolute_api_urls_found:
          discoveredUrls.length,

        request_builders_found:
          requests.length,

        exact_market_found:
          marketContexts.some(
            x =>
              x.context
                .toLowerCase()
                .includes(
                  TARGET_MARKET
                )
          ),

        api_cloudbet_found:
          discoveredUrls.some(
            x =>
              x.url.includes(
                "api.cloudbet.com"
              )
          ) ||

          apiContexts.some(
            x =>
              x.context.includes(
                "api.cloudbet.com"
              )
          )

      },


      pages,


      // ======================================================
      // MOST IMPORTANT OUTPUT
      // ======================================================

      discovered_api_paths:
        discoveredPaths.slice(
          0,
          100
        ),


      discovered_absolute_urls:
        discoveredUrls.slice(
          0,
          50
        ),


      request_builders:
        requests.slice(
          0,
          80
        ),


      // ======================================================
      // RAW CONTEXTS
      // ======================================================

      api_contexts:
        dedupeContexts(
          apiContexts
        ).slice(
          0,
          50
        ),


      market_contexts:
        dedupeContexts(
          marketContexts
        ).slice(
          0,
          40
        ),


      event_contexts:
        dedupeContexts(
          eventContexts
        ).slice(
          0,
          40
        ),


      useful_scripts: usefulScripts,


      timing_ms:
        Date.now() -
        started

    };


  } catch (
    error: any
  ) {

    return {

      success: false,

      source:
        "CLOUDBET",

      diagnostic_version:
        VERSION,

      mode:
        MODE,

      error:
        error?.message ||
        String(error),

      timing_ms:
        Date.now() -
        started

    };

  }

}


// ============================================================
// TARGET SOURCE ANALYZER
// ============================================================

function analyzeTargetSource(

  source: string,

  sourceUrl: string,

  apiPaths:
    Map<string, any>,

  absoluteUrls:
    Map<string, any>,

  requestBuilders:
    any[],

  apiContexts:
    any[],

  marketContexts:
    any[],

  eventContexts:
    any[]

) {

  // ==========================================================
  // API PATHS
  // ==========================================================

  discoverApiPaths(
    source,
    sourceUrl,
    apiPaths
  );


  // ==========================================================
  // ABSOLUTE URLS
  // ==========================================================

  discoverAbsoluteUrls(
    source,
    sourceUrl,
    absoluteUrls
  );


  // ==========================================================
  // REQUEST CONSTRUCTION
  // ==========================================================

  discoverRequestBuilders(
    source,
    sourceUrl,
    requestBuilders
  );


  // ==========================================================
  // API CONTEXT
  // ==========================================================

  pushContexts(
    source,
    sourceUrl,
    [
      "/sports-api/",
      "api.cloudbet.com",
      "api-staging.cloudbet.com",
      "api-sandbox.cloudbet.com"
    ],
    apiContexts
  );


  // ==========================================================
  // MARKET CONTEXT
  // ==========================================================

  pushContexts(
    source,
    sourceUrl,
    [
      TARGET_MARKET,
      "soccer_total_goals",
      "soccer.total_goals",
      "marketType",
      "submarketKey",
      "selection.params",
      ".outcome",
      "total=0.5"
    ],
    marketContexts
  );


  // ==========================================================
  // EVENT CONTEXT
  // ==========================================================

  pushContexts(
    source,
    sourceUrl,
    [
      "eventId",
      "event_id",
      "events",
      "eventData",
      "marketDefinitions"
    ],
    eventContexts
  );

}


// ============================================================
// API PATH DISCOVERY
// ============================================================

function discoverApiPaths(

  source: string,

  sourceUrl: string,

  output:
    Map<string, any>

) {

  const patterns = [

    /["'`](\/sports-api\/[^"'`\s\\]{0,300})["'`]/gi,

    /["'`](\/sports-data\/[^"'`\s\\]{0,300})["'`]/gi,

    /["'`](\/sports-betting\/[^"'`\s\\]{0,300})["'`]/gi,

    /["'`](\/api\/prod-proxy\/sports-api\/[^"'`\s\\]{0,300})["'`]/gi,

    /["'`](\/api\/prod-proxy\/sports-data\/[^"'`\s\\]{0,300})["'`]/gi

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
          regex.exec(
            source
          )
      ) !== null
    ) {

      const path =
        cleanString(
          match[1]
        );


      addUnique(
        output,
        path,
        {
          path,
          source:
            sourceUrl
        }
      );

    }

  }


  // ==========================================================
  // LOOSE SPORTS API PATHS
  // ==========================================================

  const loose =
    source.match(
      /\/sports-api\/[A-Za-z0-9_?=&%${}./:[\]-]{1,250}/g
    ) || [];


  for (
    const raw
    of loose
  ) {

    const path =
      cleanString(
        raw
      );


    addUnique(
      output,
      path,
      {
        path,
        source:
          sourceUrl
      }
    );

  }

}


// ============================================================
// ABSOLUTE URL DISCOVERY
// ============================================================

function discoverAbsoluteUrls(

  source: string,

  sourceUrl: string,

  output:
    Map<string, any>

) {

  const regex =
    /https?:\/\/(?:api\.cloudbet\.com|api-staging\.cloudbet\.com|api-sandbox\.cloudbet\.com|www\.cloudbet\.com)[^"'`\s\\]{0,400}/gi;


  const matches =
    source.match(
      regex
    ) || [];


  for (
    const raw
    of matches
  ) {

    const url =
      cleanString(
        raw
      );


    addUnique(
      output,
      url,
      {
        url,
        source:
          sourceUrl
      }
    );

  }

}


// ============================================================
// REQUEST BUILDERS
// ============================================================

function discoverRequestBuilders(

  source: string,

  sourceUrl: string,

  output: any[]

) {

  const patterns = [

    {
      type:
        "FETCH",

      regex:
        /\bfetch\s*\(/gi
    },

    {
      type:
        "CLIENT_GET",

      regex:
        /\.get\s*\(/gi
    },

    {
      type:
        "REQUEST_FUNCTION",

      regex:
        /\bQ\s*\(/g
    }

  ];


  for (
    const item
    of patterns
  ) {

    let match:
      RegExpExecArray |
      null;


    while (
      (
        match =
          item.regex.exec(
            source
          )
      ) !== null
    ) {

      const index =
        match.index;


      const raw =
        source.substring(

          Math.max(
            0,
            index - 600
          ),

          Math.min(
            source.length,
            index + 1800
          )

        );


      const lower =
        raw.toLowerCase();


      if (
        !lower.includes(
          "sports"
        ) &&

        !lower.includes(
          "event"
        ) &&

        !lower.includes(
          "market"
        ) &&

        !lower.includes(
          "api.cloudbet.com"
        )
      ) {
        continue;
      }


      // Diagnostic only records likely GET/read code.
      // Explicit POST/PUT/PATCH/DELETE builders are ignored.

      if (
        containsWriteMethod(
          raw
        )
      ) {
        continue;
      }


      output.push({

        type:
          item.type,

        method:
          detectMethod(
            raw
          ),

        source:
          sourceUrl,

        context:
          sanitize(
            raw
          )

      });

    }

  }

}


// ============================================================
// CONTEXT COLLECTION
// ============================================================

function pushContexts(

  source: string,

  sourceUrl: string,

  needles: string[],

  output: any[]

) {

  const lower =
    source.toLowerCase();


  for (
    const needle
    of needles
  ) {

    const target =
      needle.toLowerCase();

    let start = 0;
    let hits = 0;


    while (
      hits < 10
    ) {

      const index =
        lower.indexOf(
          target,
          start
        );


      if (
        index === -1
      ) {
        break;
      }


      const context =
        source.substring(

          Math.max(
            0,
            index - 700
          ),

          Math.min(
            source.length,
            index + 1400
          )

        );


      output.push({

        needle,

        source:
          sourceUrl,

        context:
          sanitize(
            context
          )

      });


      hits++;

      start =
        index +
        target.length;

    }

  }

}


// ============================================================
// SCRIPT EXTRACTION
// ============================================================

function extractScripts(
  html: string,
  pageUrl: string
) {

  const output =
    new Set<string>();


  const regex =
    /<script[^>]+src=["']([^"']+)["']/gi;


  let match:
    RegExpExecArray |
    null;


  while (
    (
      match =
        regex.exec(
          html
        )
    ) !== null
  ) {

    try {

      output.add(
        new URL(
          match[1],
          pageUrl
        ).href
      );

    } catch {}

  }


  return [
    ...output
  ];

}


// ============================================================
// SCRIPT SCORE
// ============================================================

function scriptScore(
  url: string
) {

  const lower =
    url.toLowerCase();

  let score = 0;


  if (
    lower.includes(
      "/pages/_app"
    )
  ) {
    score += 100;
  }


  if (
    lower.includes(
      "/pages/sports/"
    )
  ) {
    score += 100;
  }


  if (
    lower.includes(
      "sports"
    )
  ) {
    score += 50;
  }


  if (
    lower.includes(
      "/chunks/"
    )
  ) {
    score += 20;
  }


  return score;

}


// ============================================================
// PATH SCORE
// ============================================================

function scoreApiPath(
  path: string
) {

  const lower =
    path.toLowerCase();

  let score = 0;


  if (
    lower.includes(
      "/sports-api/"
    )
  ) {
    score += 100;
  }


  if (
    lower.includes(
      "event"
    )
  ) {
    score += 60;
  }


  if (
    lower.includes(
      "market"
    )
  ) {
    score += 60;
  }


  if (
    lower.includes(
      "odds"
    )
  ) {
    score += 50;
  }


  if (
    lower.includes(
      "live"
    )
  ) {
    score += 40;
  }


  if (
    lower.includes(
      "soccer"
    )
  ) {
    score += 30;
  }


  // Betting write paths should rank last.

  if (
    lower.includes(
      "/place"
    ) ||
    lower.includes(
      "/orders"
    )
  ) {
    score -= 200;
  }


  return score;

}


// ============================================================
// URL SCORE
// ============================================================

function scoreAbsoluteUrl(
  url: string
) {

  const lower =
    url.toLowerCase();

  let score = 0;


  if (
    lower.includes(
      "api.cloudbet.com"
    )
  ) {
    score += 100;
  }


  if (
    lower.includes(
      "sports-api"
    )
  ) {
    score += 100;
  }


  if (
    lower.includes(
      "event"
    )
  ) {
    score += 40;
  }


  if (
    lower.includes(
      "market"
    )
  ) {
    score += 40;
  }


  return score;

}


// ============================================================
// REQUEST SCORE
// ============================================================

function scoreRequest(
  request: any
) {

  const lower =
    String(
      request.context || ""
    ).toLowerCase();


  let score = 0;


  if (
    lower.includes(
      "/sports-api/"
    )
  ) {
    score += 100;
  }


  if (
    lower.includes(
      "api.cloudbet.com"
    )
  ) {
    score += 80;
  }


  if (
    lower.includes(
      "eventid"
    ) ||
    lower.includes(
      "event_id"
    )
  ) {
    score += 60;
  }


  if (
    lower.includes(
      "market"
    )
  ) {
    score += 50;
  }


  if (
    lower.includes(
      TARGET_MARKET
    )
  ) {
    score += 100;
  }


  return score;

}


// ============================================================
// METHOD DETECTION
// ============================================================

function detectMethod(
  text: string
) {

  const match =
    text.match(
      /method\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i
    );


  if (
    match
  ) {

    return match[1]
      .toUpperCase();

  }


  if (
    /\.get\s*\(/i.test(
      text
    )
  ) {

    return "GET";

  }


  return "UNKNOWN";

}


// ============================================================
// WRITE FILTER
// ============================================================

function containsWriteMethod(
  text: string
) {

  return (
    /method\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i
      .test(
        text
      )
  );

}


// ============================================================
// UNIQUE MAP
// ============================================================

function addUnique(

  map:
    Map<string, any>,

  key:
    string,

  value:
    any

) {

  if (
    !key ||
    key.length > 500
  ) {
    return;
  }


  if (
    !map.has(
      key
    )
  ) {

    map.set(
      key,
      value
    );

  }

}


// ============================================================
// DEDUPE
// ============================================================

function dedupeObjects(

  items: any[],

  keyFn:
    (item: any) =>
      string

) {

  const map =
    new Map<string, any>();


  for (
    const item
    of items
  ) {

    const key =
      keyFn(
        item
      );


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        item
      );

    }

  }


  return [
    ...map.values()
  ];

}


function dedupeContexts(
  items: any[]
) {

  return dedupeObjects(
    items,
    item =>
      [
        item.needle,
        item.source,
        String(
          item.context
        ).slice(
          0,
          600
        )
      ].join("|")
  );

}


// ============================================================
// CLEAN STRING
// ============================================================

function cleanString(
  text: string
) {

  return text

    .replace(
      /\\u002F/gi,
      "/"
    )

    .replace(
      /\\\//g,
      "/"
    )

    .replace(
      /\\x2f/gi,
      "/"
    )

    .replace(
      /[),;\]}]+$/g,
      ""
    )

    .trim();

}


// ============================================================
// SANITIZE CONTEXT
// ============================================================

function sanitize(
  text: string
) {

  return text

    .replace(
      /\s+/g,
      " "
    )

    .slice(
      0,
      2600
    );

}


// ============================================================
// HTTP GET
// ============================================================

async function fetchText(
  url: string
): Promise<{
  ok: boolean;
  status: number;
  finalUrl: string;
  contentType: string;
  text: string;
  error?: string;
}> {

  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS
    );


  try {

    const response =
      await fetch(
        url,
        {

          method:
            "GET",

          redirect:
            "follow",

          signal:
            controller.signal,

          headers: {

            "User-Agent":
              "Mozilla/5.0 (compatible; TopSignalCloudbetDiagnostic/3.0)",

            "Accept":
              "text/html,application/javascript,text/javascript,*/*"

          }

        }
      );


    const text =
      await response.text();


    return {

      ok:
        response.ok,

      status:
        response.status,

      finalUrl:
        response.url ||
        url,

      contentType:
        response.headers.get(
          "content-type"
        ) || "",

      text

    };


  } catch (
    error: any
  ) {

    return {

      ok: false,

      status: 0,

      finalUrl:
        url,

      contentType:
        "",

      text: "",

      error:
        error?.message ||
        String(error)

    };


  } finally {

    clearTimeout(
      timeout
    );

  }

      }
