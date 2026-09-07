// ============================================================
// TOP SIGNAL — CLOUDBET DIAGNOSTIC V2
// FILE: src/odds/cloudbet.ts
//
// READ ONLY
//
// PURPOSE:
// - inspect public Cloudbet frontend
// - discover sportsbook API paths
// - discover request construction
// - inspect market-related frontend code
//
// NO:
// - login
// - authorization
// - cookies
// - bet placement
// ============================================================

const VERSION = "V2";
const MODE = "READ_ONLY_DIAGNOSTIC";

const TARGET_PAGES = [
  "https://www.cloudbet.com/en/sports/live",
  "https://www.cloudbet.com/en/sports/soccer"
];

const MAX_SCRIPTS = 40;
const FETCH_TIMEOUT_MS = 8000;


// ============================================================
// PUBLIC EXPORT
// ============================================================

export async function debugCloudbet(): Promise<any> {

  const started = Date.now();

  try {

    // ========================================================
    // 1. FETCH PUBLIC CLOUDBET PAGES
    // ========================================================

    const pages: any[] = [];

    let bestHtml = "";
    let bestPage = "";

    for (const pageUrl of TARGET_PAGES) {

      const result =
        await fetchText(pageUrl);

      pages.push({
        url: pageUrl,
        final_url: result.finalUrl,
        status: result.status,
        ok: result.ok,
        content_type: result.contentType,
        content_length: result.text.length,
        error: result.error || null
      });

      if (
        result.ok &&
        result.text.length > bestHtml.length
      ) {
        bestHtml = result.text;
        bestPage = result.finalUrl;
      }
    }


    if (!bestHtml) {

      return {
        success: false,
        source: "CLOUDBET",
        diagnostic_version: VERSION,
        mode: MODE,
        error: "NO_PUBLIC_PAGE_AVAILABLE",
        pages,
        timing_ms: Date.now() - started
      };
    }


    // ========================================================
    // 2. DISCOVER NEXT.JS SCRIPTS
    // ========================================================

    const discoveredScripts =
      extractScriptUrls(
        bestHtml,
        bestPage
      );

    const scriptsToCheck =
      prioritizeScripts(
        discoveredScripts
      ).slice(0, MAX_SCRIPTS);


    // ========================================================
    // 3. ANALYZE HTML
    // ========================================================

    const htmlAnalysis =
      analyzeSource(
        bestHtml,
        bestPage
      );


    // ========================================================
    // 4. ANALYZE JS CHUNKS
    // ========================================================

    const usefulScripts: any[] = [];

    const endpointMap =
      new Map<string, any>();

    const requests: any[] = [];

    const marketFindings: any[] = [];


    // Add endpoints found in HTML

    for (
      const endpoint
      of htmlAnalysis.endpoints
    ) {

      addEndpoint(
        endpointMap,
        endpoint,
        bestPage
      );
    }


    // ========================================================
    // SCRIPT LOOP
    // ========================================================

    for (
      const scriptUrl
      of scriptsToCheck
    ) {

      const result =
        await fetchText(
          scriptUrl
        );

      if (
        !result.ok ||
        !result.text
      ) {
        continue;
      }


      const analysis =
        analyzeSource(
          result.text,
          scriptUrl
        );


      const useful =
        analysis.endpoints.length > 0 ||
        analysis.requests.length > 0 ||
        analysis.hints.sports_api ||
        analysis.hints.sports_betting ||
        analysis.hints.sports_data ||
        analysis.hints.market ||
        analysis.hints.odds ||
        analysis.hints.total_goals ||
        analysis.hints.first_half;


      if (!useful) {
        continue;
      }


      // ======================================================
      // STORE SCRIPT
      // ======================================================

      usefulScripts.push({

        url: scriptUrl,

        status:
          result.status,

        content_length:
          result.text.length,

        hints:
          analysis.hints,

        endpoints:
          analysis.endpoints.slice(
            0,
            50
          ),

        requests:
          analysis.requests.slice(
            0,
            30
          ),

        contexts:
          analysis.contexts.slice(
            0,
            20
          )

      });


      // ======================================================
      // ENDPOINTS
      // ======================================================

      for (
        const endpoint
        of analysis.endpoints
      ) {

        addEndpoint(
          endpointMap,
          endpoint,
          scriptUrl
        );
      }


      // ======================================================
      // REQUEST CANDIDATES
      // ======================================================

      for (
        const request
        of analysis.requests
      ) {

        requests.push({
          ...request,
          source: scriptUrl
        });
      }


      // ======================================================
      // MARKET FINDINGS
      // ======================================================

      if (
        analysis.hints.total_goals ||
        analysis.hints.first_half ||
        analysis.hints.over_05 ||
        analysis.hints.soccer_total_goals
      ) {

        marketFindings.push({

          source:
            scriptUrl,

          soccer_total_goals:
            analysis.hints
              .soccer_total_goals,

          total_goals:
            analysis.hints
              .total_goals,

          first_half:
            analysis.hints
              .first_half,

          over_05:
            analysis.hints
              .over_05,

          contexts:
            analysis.contexts
              .filter((x: any) =>
                [
                  "soccer.total_goals",
                  "first_half",
                  "first half",
                  "total=0.5",
                  "\"total\":0.5",
                  "marketType",
                  "marketUrl"
                ].includes(
                  x.needle
                )
              )
              .slice(0, 15)

        });

      }

    }


    // ========================================================
    // 5. RANK ENDPOINTS
    // ========================================================

    const endpoints =
      Array.from(
        endpointMap.values()
      )
        .map((endpoint: any) => ({
          ...endpoint,

          score:
            endpointScore(
              endpoint.path
            )
        }))
        .sort(
          (a: any, b: any) =>
            b.score - a.score
        );


    // ========================================================
    // 6. RANK REQUESTS
    // ========================================================

    const requestCandidates =
      dedupeRequests(
        requests
      )
        .map((request: any) => ({
          ...request,

          score:
            requestScore(
              request
            )
        }))
        .sort(
          (a: any, b: any) =>
            b.score - a.score
        );


    // ========================================================
    // 7. RESULT
    // ========================================================

    return {

      success: true,

      source:
        "CLOUDBET",

      diagnostic_version:
        VERSION,

      mode:
        MODE,


      summary: {

        public_page_reachable:
          true,

        best_page:
          bestPage,

        scripts_discovered:
          discoveredScripts.length,

        scripts_checked:
          scriptsToCheck.length,

        useful_scripts:
          usefulScripts.length,

        endpoints_found:
          endpoints.length,

        request_candidates:
          requestCandidates.length,

        sports_api_found:
          endpoints.some(
            (x: any) =>
              x.path.includes(
                "/sports-api/"
              )
          ),

        sports_betting_found:
          endpoints.some(
            (x: any) =>
              x.path.includes(
                "/sports-betting/"
              )
          ),

        sports_data_found:
          endpoints.some(
            (x: any) =>
              x.path.includes(
                "/sports-data/"
              )
          )

      },


      target: {

        sport:
          "SOCCER",

        period:
          "FIRST_HALF",

        market:
          "TOTAL_GOALS",

        selection:
          "OVER",

        line:
          0.5,

        structures: [

          "soccer.total_goals + period=1h + over + total=0.5",

          "soccer.total_goals_period_first_half + over + total=0.5"

        ]

      },


      pages,


      top_endpoints:
        endpoints.slice(
          0,
          100
        ),


      top_request_candidates:
        requestCandidates.slice(
          0,
          60
        ),


      market_findings:
        marketFindings.slice(
          0,
          30
        ),


      html: {

        content_length:
          bestHtml.length,

        hints:
          htmlAnalysis.hints,

        endpoints:
          htmlAnalysis.endpoints
            .slice(
              0,
              30
            ),

        contexts:
          htmlAnalysis.contexts
            .slice(
              0,
              20
            )

      },


      useful_scripts:
        usefulScripts,


      timing_ms:
        Date.now() -
        started

    };


  } catch (error: any) {

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
// SOURCE ANALYZER
// ============================================================

function analyzeSource(
  source: string,
  sourceUrl: string
) {

  const lower =
    source.toLowerCase();


  const hints = {

    cloudbet:
      lower.includes(
        "cloudbet"
      ),

    sportsbook:
      lower.includes(
        "sportsbook"
      ),

    sports_api:
      lower.includes(
        "/sports-api/"
      ),

    sports_betting:
      lower.includes(
        "/sports-betting/"
      ),

    sports_data:
      lower.includes(
        "/sports-data/"
      ),

    soccer:
      lower.includes(
        "soccer"
      ),

    live:
      lower.includes(
        "live"
      ),

    odds:
      lower.includes(
        "odds"
      ),

    market:
      lower.includes(
        "market"
      ),

    selection:
      lower.includes(
        "selection"
      ),

    event:
      lower.includes(
        "event"
      ),

    event_id:
      lower.includes(
        "eventid"
      ) ||
      lower.includes(
        "event_id"
      ),

    first_half:
      lower.includes(
        "first_half"
      ) ||
      lower.includes(
        "first half"
      ),

    total_goals:
      lower.includes(
        "total_goals"
      ) ||
      lower.includes(
        "total goals"
      ),

    soccer_total_goals:
      lower.includes(
        "soccer.total_goals"
      ),

    over_05:
      lower.includes(
        "total=0.5"
      ) ||
      lower.includes(
        "total%3d0.5"
      ) ||
      lower.includes(
        "\"total\":0.5"
      ) ||
      lower.includes(
        "total:0.5"
      )

  };


  return {

    source:
      sourceUrl,

    hints,

    endpoints:
      discoverEndpoints(
        source
      ),

    requests:
      discoverRequests(
        source
      ),

    contexts:
      extractContexts(
        source,
        [
          "/sports-api/",
          "/sports-betting/",
          "/sports-data/",
          "soccer.total_goals",
          "marketType",
          "marketUrl",
          "eventId",
          "event_id",
          "first_half",
          "first half",
          "total=0.5",
          "\"total\":0.5",
          "selection",
          "outcome"
        ]
      )

  };

}


// ============================================================
// ENDPOINT DISCOVERY
// ============================================================

function discoverEndpoints(
  source: string
) {

  const found =
    new Map<string, any>();


  const patterns = [

    /["'`](\/sports-api\/[^"'`\s\\]*)["'`]/gi,

    /["'`](\/sports-betting\/[^"'`\s\\]*)["'`]/gi,

    /["'`](\/sports-data\/[^"'`\s\\]*)["'`]/gi,

    /["'`](\/sports-data-research\/[^"'`\s\\]*)["'`]/gi,

    /["'`](\/sports-sharing\/[^"'`\s\\]*)["'`]/gi,

    /["'`](\/sports-players\/[^"'`\s\\]*)["'`]/gi,

    /["'`](\/api\/prod-proxy\/sports-api\/[^"'`\s\\]*)["'`]/gi,

    /["'`](\/api\/prod-proxy\/sports-betting\/[^"'`\s\\]*)["'`]/gi

  ];


  for (
    const pattern
    of patterns
  ) {

    let match:
      RegExpExecArray |
      null;


    while (
      (
        match =
          pattern.exec(
            source
          )
      ) !== null
    ) {

      const path =
        cleanEndpoint(
          match[1]
        );


      if (
        !path ||
        path.length > 300
      ) {
        continue;
      }


      if (
        !found.has(
          path
        )
      ) {

        found.set(
          path,
          {

            path,

            category:
              categorizeEndpoint(
                path
              )

          }
        );

      }

    }

  }


  // ==========================================================
  // LOOSE PATH DISCOVERY
  // ==========================================================

  const loosePattern =
    /\/(?:sports-api|sports-betting|sports-data|sports-data-research|sports-sharing|sports-players)\/[A-Za-z0-9_?=&%${}./:[\]-]{1,200}/g;


  const matches =
    source.match(
      loosePattern
    ) || [];


  for (
    const raw
    of matches
  ) {

    const path =
      cleanEndpoint(
        raw
      );


    if (
      !path ||
      path.length > 300
    ) {
      continue;
    }


    if (
      !found.has(
        path
      )
    ) {

      found.set(
        path,
        {

          path,

          category:
            categorizeEndpoint(
              path
            )

        }
      );

    }

  }


  return Array.from(
    found.values()
  );

}


// ============================================================
// REQUEST DISCOVERY
// ============================================================

function discoverRequests(
  source: string
) {

  const results: any[] = [];


  const methods = [
    "get",
    "post",
    "put",
    "patch",
    "delete"
  ];


  // ==========================================================
  // CLIENT.GET / CLIENT.POST ETC
  // ==========================================================

  for (
    const method
    of methods
  ) {

    const regex =
      new RegExp(
        `(?:client|axios|this\\.client|api|http|request)\\.${method}\\s*\\(`,
        "gi"
      );


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

      const position =
        match.index;


      const context =
        source.substring(

          Math.max(
            0,
            position - 300
          ),

          Math.min(
            source.length,
            position + 1200
          )

        );


      if (
        !isSportsRelated(
          context
        )
      ) {
        continue;
      }


      results.push({

        type:
          "HTTP_CLIENT",

        method:
          method.toUpperCase(),

        context:
          sanitizeContext(
            context
          )

      });

    }

  }


  // ==========================================================
  // FETCH()
  // ==========================================================

  const fetchRegex =
    /\bfetch\s*\(/gi;


  let fetchMatch:
    RegExpExecArray |
    null;


  while (
    (
      fetchMatch =
        fetchRegex.exec(
          source
        )
    ) !== null
  ) {

    const position =
      fetchMatch.index;


    const context =
      source.substring(

        Math.max(
          0,
          position - 300
        ),

        Math.min(
          source.length,
          position + 1400
        )

      );


    if (
      !isSportsRelated(
        context
      )
    ) {
      continue;
    }


    const methodMatch =
      context.match(
        /method\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i
      );


    results.push({

      type:
        "FETCH",

      method:
        methodMatch
          ? methodMatch[1]
              .toUpperCase()
          : "UNKNOWN",

      context:
        sanitizeContext(
          context
        )

    });

  }


  return results;

}


// ============================================================
// CONTEXT EXTRACTION
// ============================================================

function extractContexts(
  source: string,
  needles: string[]
) {

  const lower =
    source.toLowerCase();

  const results: any[] = [];


  for (
    const needle
    of needles
  ) {

    const search =
      needle.toLowerCase();

    let position = 0;
    let count = 0;


    while (
      count < 5
    ) {

      const index =
        lower.indexOf(
          search,
          position
        );


      if (
        index === -1
      ) {
        break;
      }


      results.push({

        needle,

        context:
          sanitizeContext(
            source.substring(

              Math.max(
                0,
                index - 400
              ),

              Math.min(
                source.length,
                index + 800
              )

            )
          )

      });


      position =
        index +
        search.length;

      count++;

    }

  }


  return results;

}


// ============================================================
// SCRIPT DISCOVERY
// ============================================================

function extractScriptUrls(
  html: string,
  pageUrl: string
) {

  const scripts =
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

      scripts.add(
        new URL(
          match[1],
          pageUrl
        ).href
      );

    } catch {}

  }


  return Array.from(
    scripts
  );

}


// ============================================================
// SCRIPT PRIORITY
// ============================================================

function prioritizeScripts(
  scripts: string[]
) {

  return [...scripts]
    .sort(
      (a, b) =>
        scriptPriority(b) -
        scriptPriority(a)
    );

}


function scriptPriority(
  url: string
) {

  const lower =
    url.toLowerCase();

  let score = 0;


  if (
    lower.includes(
      "/chunks/"
    )
  ) {
    score += 5;
  }


  if (
    lower.includes(
      "/pages/"
    )
  ) {
    score += 5;
  }


  if (
    lower.includes(
      "_app"
    )
  ) {
    score += 20;
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
      "main-"
    )
  ) {
    score += 10;
  }


  return score;

}


// ============================================================
// ENDPOINT MAP
// ============================================================

function addEndpoint(
  map: Map<string, any>,
  endpoint: any,
  source: string
) {

  const key =
    endpoint.path;


  if (
    !map.has(
      key
    )
  ) {

    map.set(
      key,
      {
        ...endpoint,
        sources: [
          source
        ]
      }
    );

    return;
  }


  const existing =
    map.get(
      key
    );


  if (
    !existing.sources.includes(
      source
    )
  ) {

    existing.sources.push(
      source
    );

  }

}


// ============================================================
// ENDPOINT SCORE
// ============================================================

function endpointScore(
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
      "/sports-betting/"
    )
  ) {
    score += 90;
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


  if (
    lower.includes(
      "odds"
    )
  ) {
    score += 35;
  }


  if (
    lower.includes(
      "live"
    )
  ) {
    score += 25;
  }


  if (
    lower.includes(
      "soccer"
    )
  ) {
    score += 20;
  }


  return score;

}


// ============================================================
// REQUEST SCORE
// ============================================================

function requestScore(
  candidate: any
) {

  const text =
    String(
      candidate.context ||
      ""
    ).toLowerCase();


  let score = 0;


  if (
    text.includes(
      "/sports-api/"
    )
  ) {
    score += 100;
  }


  if (
    text.includes(
      "/sports-betting/"
    )
  ) {
    score += 90;
  }


  if (
    text.includes(
      "market"
    )
  ) {
    score += 35;
  }


  if (
    text.includes(
      "event"
    )
  ) {
    score += 30;
  }


  if (
    text.includes(
      "odds"
    )
  ) {
    score += 30;
  }


  if (
    text.includes(
      "selection"
    )
  ) {
    score += 20;
  }


  if (
    text.includes(
      "soccer"
    )
  ) {
    score += 15;
  }


  return score;

}


// ============================================================
// REQUEST DEDUPE
// ============================================================

function dedupeRequests(
  requests: any[]
) {

  const map =
    new Map<string, any>();


  for (
    const request
    of requests
  ) {

    const key =
      [
        request.type,
        request.method,
        String(
          request.context ||
          ""
        ).slice(
          0,
          400
        )
      ].join("|");


    if (
      !map.has(
        key
      )
    ) {

      map.set(
        key,
        request
      );

    }

  }


  return Array.from(
    map.values()
  );

}


// ============================================================
// CATEGORY
// ============================================================

function categorizeEndpoint(
  path: string
) {

  if (
    path.includes(
      "/sports-api/"
    )
  ) {
    return "SPORTS_API";
  }


  if (
    path.includes(
      "/sports-betting/"
    )
  ) {
    return "SPORTS_BETTING";
  }


  if (
    path.includes(
      "/sports-data-research/"
    )
  ) {
    return "SPORTS_DATA_RESEARCH";
  }


  if (
    path.includes(
      "/sports-data/"
    )
  ) {
    return "SPORTS_DATA";
  }


  if (
    path.includes(
      "/sports-sharing/"
    )
  ) {
    return "SPORTS_SHARING";
  }


  if (
    path.includes(
      "/sports-players/"
    )
  ) {
    return "SPORTS_PLAYERS";
  }


  return "UNKNOWN";

}


// ============================================================
// SPORTS RELATED
// ============================================================

function isSportsRelated(
  text: string
) {

  const lower =
    text.toLowerCase();


  return (
    lower.includes(
      "/sports-api/"
    ) ||
    lower.includes(
      "/sports-betting/"
    ) ||
    lower.includes(
      "/sports-data/"
    ) ||
    lower.includes(
      "sportsbook"
    ) ||
    lower.includes(
      "market"
    ) ||
    lower.includes(
      "odds"
    )
  );

}


// ============================================================
// CLEAN ENDPOINT
// ============================================================

function cleanEndpoint(
  value: string
) {

  return value
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
// CONTEXT CLEANUP
// ============================================================

function sanitizeContext(
  text: string
) {

  return text
    .replace(
      /\s+/g,
      " "
    )
    .slice(
      0,
      1800
    );

}


// ============================================================
// FETCH
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


  const timer =
    setTimeout(
      () =>
        controller.abort(),
      FETCH_TIMEOUT_MS
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
              "Mozilla/5.0 (compatible; TopSignalCloudbetDiagnostic/2.0)",

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


  } catch (error: any) {

    return {

      ok: false,

      status: 0,

      finalUrl:
        url,

      contentType:
        "",

      text:
        "",

      error:
        error?.message ||
        String(error)

    };


  } finally {

    clearTimeout(
      timer
    );

  }

          }
