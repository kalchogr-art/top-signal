// ============================================================
// CLOUDBET — SPORTS API ENDPOINT DISCOVERY V2
// READ ONLY DIAGNOSTIC
//
// ЦЕЛ:
// 1. Отваря публичния Cloudbet soccer frontend
// 2. Извлича Next.js script chunks
// 3. Сканира bundle-ите за:
//      /sports-api/
//      /sports-betting/
//      /sports-data/
//      event / markets / odds / selections
// 4. Търси fetch / axios / client.get / client.post конструкции
// 5. Връща възможните реални API endpoint-и
//
// НЯМА:
// - login
// - cookies
// - authorization
// - betting
// - bet placement
// ============================================================

const VERSION = "V2";
const MODE = "READ_ONLY_DIAGNOSTIC";

const CLOUDBET = "https://www.cloudbet.com";

const TARGET_PAGES = [
  "https://www.cloudbet.com/en/sports/live",
  "https://www.cloudbet.com/en/sports/soccer"
];

const MAX_SCRIPTS_TO_CHECK = 40;

const FETCH_TIMEOUT_MS = 8000;


// ============================================================
// MAIN
// ============================================================

export default {

  async fetch(request: Request): Promise<Response> {

    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (url.pathname === "/") {

      try {

        const result =
          await runDiagnostic();

        return json(result);

      } catch (error: any) {

        return json({
          success: false,
          worker: "cloudbet-sports-api-discovery",
          diagnostic_version: VERSION,
          mode: MODE,
          error:
            error?.message ||
            String(error)
        }, 500);

      }

    }


    return json({
      success: true,
      worker: "cloudbet-sports-api-discovery",
      diagnostic_version: VERSION,
      mode: MODE,

      endpoints: {
        "/":
          "RUN SPORTS API DISCOVERY"
      }

    });

  }

};


// ============================================================
// DIAGNOSTIC
// ============================================================

async function runDiagnostic() {

  const started =
    Date.now();


  // ==========================================================
  // 1. FETCH PUBLIC PAGES
  // ==========================================================

  const pages: any[] = [];

  let bestHtml = "";
  let bestPage = "";

  for (const pageUrl of TARGET_PAGES) {

    const result =
      await fetchText(pageUrl);

    const entry = {

      url: pageUrl,

      final_url:
        result.finalUrl,

      status:
        result.status,

      ok:
        result.ok,

      content_type:
        result.contentType,

      content_length:
        result.text.length

    };

    pages.push(entry);

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

  }


  if (!bestHtml) {

    return {

      success: false,

      source:
        "CLOUDBET",

      diagnostic_version:
        VERSION,

      mode:
        MODE,

      error:
        "NO_PUBLIC_CLOUDBET_PAGE_AVAILABLE",

      pages

    };

  }


  // ==========================================================
  // 2. DISCOVER SCRIPT URLS
  // ==========================================================

  const scripts =
    extractScriptUrls(
      bestHtml,
      bestPage
    );


  const scriptsToCheck =
    prioritizeScripts(
      scripts
    ).slice(
      0,
      MAX_SCRIPTS_TO_CHECK
    );


  // ==========================================================
  // 3. SCAN HTML ITSELF
  // ==========================================================

  const htmlAnalysis =
    analyzeSource(
      bestHtml,
      bestPage
    );


  // ==========================================================
  // 4. SCAN JAVASCRIPT CHUNKS
  // ==========================================================

  const usefulScripts: any[] = [];

  const allEndpoints =
    new Map<string, any>();

  const allRequests: any[] = [];

  const marketFindings: any[] = [];


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
      analysis.hints.market ||
      analysis.hints.odds ||
      analysis.hints.total_goals ||
      analysis.hints.first_half;


    if (!useful) {
      continue;
    }


    usefulScripts.push({

      url:
        scriptUrl,

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
          15
        )

    });


    for (
      const endpoint
      of analysis.endpoints
    ) {

      const key =
        endpoint.path;

      if (
        !allEndpoints.has(key)
      ) {

        allEndpoints.set(
          key,
          {
            ...endpoint,
            sources: [
              scriptUrl
            ]
          }
        );

      } else {

        const existing =
          allEndpoints.get(key);

        if (
          !existing.sources.includes(
            scriptUrl
          )
        ) {
          existing.sources.push(
            scriptUrl
          );
        }

      }

    }


    for (
      const requestCandidate
      of analysis.requests
    ) {

      allRequests.push({
        ...requestCandidate,
        source:
          scriptUrl
      });

    }


    if (
      analysis.hints.total_goals ||
      analysis.hints.first_half ||
      analysis.hints.over_05
    ) {

      marketFindings.push({

        source:
          scriptUrl,

        total_goals:
          analysis.hints.total_goals,

        first_half:
          analysis.hints.first_half,

        over_05:
          analysis.hints.over_05,

        contexts:
          analysis.contexts
            .filter((x: any) =>
              x.needle ===
                "soccer.total_goals" ||
              x.needle ===
                "first_half" ||
              x.needle ===
                "first half" ||
              x.needle ===
                "total=0.5" ||
              x.needle ===
                "0.5"
            )
            .slice(0, 10)

      });

    }

  }


  // ==========================================================
  // 5. ADD HTML ENDPOINTS
  // ==========================================================

  for (
    const endpoint
    of htmlAnalysis.endpoints
  ) {

    const key =
      endpoint.path;

    if (
      !allEndpoints.has(key)
    ) {

      allEndpoints.set(
        key,
        {
          ...endpoint,
          sources: [
            bestPage
          ]
        }
      );

    }

  }


  // ==========================================================
  // 6. RANK API ENDPOINTS
  // ==========================================================

  const endpoints =
    Array.from(
      allEndpoints.values()
    )
      .map(endpoint => ({
        ...endpoint,
        score:
          endpointScore(
            endpoint.path
          )
      }))
      .sort(
        (a, b) =>
          b.score - a.score
      );


  // ==========================================================
  // 7. RANK REQUEST CONSTRUCTIONS
  // ==========================================================

  const requestCandidates =
    dedupeRequests(
      allRequests
    )
      .map(x => ({
        ...x,

        score:
          requestScore(x)
      }))
      .sort(
        (a, b) =>
          b.score - a.score
      );


  // ==========================================================
  // OUTPUT
  // ==========================================================

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
        scripts.length,

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
          x =>
            x.path.includes(
              "/sports-api/"
            )
        ),

      sports_betting_found:
        endpoints.some(
          x =>
            x.path.includes(
              "/sports-betting/"
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

      expected_structure: [
        "soccer.total_goals",
        "period=1h",
        "outcome=over",
        "total=0.5"
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
        80
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

}


// ============================================================
// ANALYZE SOURCE
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

    sportsbook:
      lower.includes(
        "sportsbook"
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


  const endpoints =
    discoverEndpoints(
      source
    );


  const requests =
    discoverRequests(
      source
    );


  const contexts =
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
    );


  return {

    source:
      sourceUrl,

    hints,

    endpoints,

    requests,

    contexts

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

    let match;

    while (
      (
        match =
          pattern.exec(source)
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
        !found.has(path)
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
  // ALSO FIND EMBEDDED PATHS WITHOUT QUOTES
  // ==========================================================

  const loosePattern =
    /\/(?:sports-api|sports-betting|sports-data|sports-data-research|sports-sharing|sports-players)\/[A-Za-z0-9_?=&%${}./:[\]-]{1,200}/g;


  const looseMatches =
    source.match(
      loosePattern
    ) || [];


  for (
    const raw
    of looseMatches
  ) {

    const path =
      cleanEndpoint(raw);

    if (
      !path ||
      path.length > 300
    ) {
      continue;
    }


    if (
      !found.has(path)
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
  // client.get("/sports-api/...")
  // axios.get(...)
  // this.client.get(...)
  // ==========================================================

  for (
    const method
    of methods
  ) {

    const regex =
      new RegExp(
        `(?:client|axios|this\\.client|api|http|request)\\.${method}\\s*\\((.{0,500})`,
        "gi"
      );


    let match;

    while (
      (
        match =
          regex.exec(source)
      ) !== null
    ) {

      const position =
        match.index;

      const context =
        source.substring(
          Math.max(
            0,
            position - 250
          ),
          Math.min(
            source.length,
            position + 900
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
  // fetch(...)
  // ==========================================================

  const fetchRegex =
    /\bfetch\s*\(/gi;

  let fetchMatch;

  while (
    (
      fetchMatch =
        fetchRegex.exec(source)
    ) !== null
  ) {

    const position =
      fetchMatch.index;

    const context =
      source.substring(
        Math.max(
          0,
          position - 250
        ),
        Math.min(
          source.length,
          position + 1000
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
// CONTEXTS
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
                index - 350
              ),
              Math.min(
                source.length,
                index + 650
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


  let match;

  while (
    (
      match =
        regex.exec(html)
    ) !== null
  ) {

    try {

      const absolute =
        new URL(
          match[1],
          pageUrl
        ).href;

      scripts.add(
        absolute
      );

    } catch {}

  }


  return Array.from(
    scripts
  );

}


// ============================================================
// PRIORITIZE SCRIPTS
// ============================================================

function prioritizeScripts(
  scripts: string[]
) {

  return [...scripts]
    .sort((a, b) => {

      const scoreA =
        scriptPriority(a);

      const scoreB =
        scriptPriority(b);

      return (
        scoreB -
        scoreA
      );

    });

}


function scriptPriority(
  url: string
) {

  let score = 0;

  const lower =
    url.toLowerCase();


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
    score += 15;
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
// SCORING
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
    score += 35;
  }


  if (
    lower.includes(
      "market"
    )
  ) {
    score += 35;
  }


  if (
    lower.includes(
      "odds"
    )
  ) {
    score += 30;
  }


  if (
    lower.includes(
      "live"
    )
  ) {
    score += 20;
  }


  if (
    lower.includes(
      "soccer"
    )
  ) {
    score += 20;
  }


  if (
    lower.includes(
      "bet"
    )
  ) {
    score += 10;
  }


  return score;

}


function requestScore(
  candidate: any
) {

  const text =
    (
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
    score += 30;
  }


  if (
    text.includes(
      "event"
    )
  ) {
    score += 25;
  }


  if (
    text.includes(
      "odds"
    )
  ) {
    score += 25;
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
    score += 10;
  }


  return score;

}


// ============================================================
// HELPERS
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
      1600
    );

}


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
        request.context
          ?.slice(
            0,
            300
          )
      ].join("|");


    if (
      !map.has(key)
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
// FETCH
// ============================================================

async function fetchText(
  url: string
) {

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
              "Mozilla/5.0 (compatible; CloudbetDiagnostic/2.0)",

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


// ============================================================
// JSON
// ============================================================

function json(
  data: any,
  status = 200
) {

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {

      status,

      headers: {

        ...corsHeaders(),

        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"

      }

    }
  );

}


function corsHeaders() {

  return {

    "access-control-allow-origin":
      "*",

    "access-control-allow-methods":
      "GET,OPTIONS",

    "access-control-allow-headers":
      "Content-Type"

  };

}
