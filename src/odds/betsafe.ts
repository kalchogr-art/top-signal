// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V12
// READ ONLY
//
// V12 GOAL:
// 1. Fetch the working Betsafe SSR live feed.
// 2. Extract a SMALL list of live football events.
// 3. Extract event IDs, teams, phase and visible markets/odds.
// 4. For 1H events, probe event-specific SSR paths to see whether
//    Betsafe returns expanded markets such as:
//      1st Half - Total Goals
//      Over 0.5
//
// NO BETTING
// NO LOGIN
// NO D1 WRITES
// ============================================================

const ORIGIN = "https://www.betsafe.com";
const LIVE_PATH = "/en/sportsbook/live";
const LIVE_URL = ORIGIN + LIVE_PATH;

const SSR_ENDPOINT =
  ORIGIN + "/sb/fe-api/ssr/v1/generate";

const MAX_EVENTS = 8;
const MAX_1H_PROBES = 4;


// ============================================================
// MAIN
// ============================================================

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started = Date.now();

  try {
    // --------------------------------------------------------
    // 1. Load normal live page and context IDs
    // --------------------------------------------------------

    const pageResponse = await fetch(LIVE_URL, {
      method: "GET",
      headers: pageHeaders(),
      redirect: "follow"
    });

    const pageHtml = await pageResponse.text();
    const decodedPage = decode(pageHtml);

    const staticContextId =
      extractJsonValue(decodedPage, "staticContextId");

    const userContextId =
      extractJsonValue(decodedPage, "userContextId");

    if (!staticContextId || !userContextId) {
      return {
        success: false,
        source: "BETSAFE",
        diagnostic_version: "V12",
        stage: "CONTEXT",
        error: "Missing Betsafe context IDs",
        context: {
          staticContextId,
          userContextId
        }
      };
    }


    // --------------------------------------------------------
    // 2. Working SSR live feed
    // --------------------------------------------------------

    const liveSsr =
      await fetchSsr(
        LIVE_PATH,
        staticContextId,
        userContextId
      );

    if (!liveSsr.ok) {
      return {
        success: false,
        source: "BETSAFE",
        diagnostic_version: "V12",
        stage: "LIVE_SSR",
        live_ssr: liveSsr
      };
    }


    // --------------------------------------------------------
    // 3. Extract compact live event list
    // --------------------------------------------------------

    const events =
      extractEvents(
        liveSsr.body
      )
      .slice(0, MAX_EVENTS);


    // --------------------------------------------------------
    // 4. Probe event-specific paths for 1H events
    // --------------------------------------------------------

    const firstHalfEvents =
      events
        .filter(
          event =>
            event.phase
              ?.toLowerCase()
              .includes("1st half")
        )
        .slice(0, MAX_1H_PROBES);

    const probes: Record<string, any>[] = [];

    for (const event of firstHalfEvents) {
      const eventId = event.event_id;

      if (!eventId) continue;

      const candidates = [
        // Path shape closest to the current live page.
        `${LIVE_PATH}?eventId=${eventId}`,

        // Common event route variants worth testing.
        `/en/sportsbook/event/${eventId}`,
        `/en/sportsbook/live/event/${eventId}`
      ];

      const candidateResults: Record<string, any>[] = [];

      for (const candidatePath of candidates) {
        const result =
          await fetchSsr(
            candidatePath,
            staticContextId,
            userContextId
          );

        candidateResults.push({
          path: candidatePath,
          status: result.status,
          ok: result.ok,
          content_type: result.content_type,
          content_length: result.body.length,
          signals: analyseTargetMarket(result.body),
          sample: targetMarketSample(result.body)
        });
      }

      probes.push({
        event_id: eventId,
        home: event.home,
        away: event.away,
        phase: event.phase,
        candidates: candidateResults
      });
    }


    return {
      success: true,
      source: "BETSAFE",
      diagnostic_version: "V12",
      mode: "READ_ONLY_DIAGNOSTIC",

      page: {
        status: pageResponse.status,
        ok: pageResponse.ok
      },

      context: {
        staticContextId,
        userContextId
      },

      live_ssr: {
        status: liveSsr.status,
        ok: liveSsr.ok,
        content_length: liveSsr.body.length
      },

      events,

      event_probes: probes,

      timing_ms: Date.now() - started
    };

  } catch (error: any) {
    return {
      success: false,
      source: "BETSAFE",
      diagnostic_version: "V12",
      mode: "READ_ONLY_DIAGNOSTIC",
      error: error?.message ?? String(error),
      timing_ms: Date.now() - started
    };
  }
}


// ============================================================
// SSR FETCH
// ============================================================

async function fetchSsr(
  path: string,
  staticContextId: string,
  userContextId: string
): Promise<{
  status: number;
  ok: boolean;
  content_type: string | null;
  body: string;
}> {

  // URLSearchParams is deliberate here:
  // nested ?eventId= is encoded safely inside the path parameter.
  const params = new URLSearchParams({
    path
  });

  const url =
    `${SSR_ENDPOINT}?${params.toString()}`;

  const response =
    await fetch(url, {
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
      redirect: "follow"
    });

  const text =
    decode(
      await response.text()
    );

  return {
    status: response.status,
    ok: response.ok,
    content_type:
      response.headers.get(
        "content-type"
      ),
    body: text
  };
}


// ============================================================
// EVENT EXTRACTION
// ============================================================

function extractEvents(
  html: string
): Record<string, any>[] {

  const results: Record<string, any>[] = [];

  // Split around event-info blocks while preserving enough nearby HTML.
  const eventIdRegex =
    /(?:selection-id|market-id)="[^"]*?(f-[A-Za-z0-9_-]+)[^"]*"/g;

  const seen =
    new Set<string>();

  let match:
    RegExpExecArray | null;

  while (
    (match =
      eventIdRegex.exec(html))
  ) {

    const eventId =
      match[1];

    if (
      seen.has(eventId)
    ) {
      continue;
    }

    seen.add(eventId);

    const index =
      match.index;

    const from =
      Math.max(
        0,
        index - 9000
      );

    const to =
      Math.min(
        html.length,
        index + 14000
      );

    const block =
      html.slice(
        from,
        to
      );

    const phase =
      firstMatch(
        block,
        /<span class="phase">\s*([^<]+?)\s*<\/span>/i
      );

    const participants =
      extractParticipantNames(
        block
      );

    const visibleMarkets =
      extractVisibleMarkets(
        block
      );

    results.push({
      event_id:
        eventId,

      phase:
        phase,

      home:
        participants[0] ??
        null,

      away:
        participants[1] ??
        null,

      visible_markets:
        visibleMarkets
    });

    if (
      results.length >=
      MAX_EVENTS * 3
    ) {
      break;
    }
  }

  return dedupeEvents(
    results
  );
}


// ============================================================
// PARTICIPANTS
// ============================================================

function extractParticipantNames(
  block: string
): string[] {

  const names: string[] = [];

  const patterns = [
    /test-id="event-info\.participant-name"[^>]*>\s*([^<]+?)\s*</gi,
    /class="[^"]*participant-name[^"]*"[^>]*>\s*([^<]+?)\s*</gi,
    /class="[^"]*participants-name[^"]*"[^>]*>\s*([^<]+?)\s*</gi
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;

    while (
      (match =
        regex.exec(block))
    ) {

      const value =
        htmlText(
          match[1]
        );

      if (
        value &&
        !names.includes(value)
      ) {
        names.push(value);
      }

      if (names.length >= 2) {
        return names;
      }
    }
  }

  return names;
}


// ============================================================
// VISIBLE MARKETS
// ============================================================

function extractVisibleMarkets(
  block: string
): Record<string, any>[] {

  const markets: Record<string, any>[] = [];

  const marketRegex =
    /<obg-event-row-market-container\b([^>]*)>([\s\S]*?)<\/obg-event-row-market-container>/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      marketRegex.exec(block))
  ) {

    const attrs =
      match[1];

    const body =
      match[2];

    const marketId =
      firstMatch(
        attrs,
        /market-id="([^"]+)"/i
      );

    const label =
      firstMatch(
        body,
        /event-row\.market-header\.label"[^>]*>\s*([^<]+?)\s*</i
      );

    const selections =
      extractSelections(
        body
      );

    if (
      label ||
      marketId ||
      selections.length
    ) {
      markets.push({
        market_id:
          marketId,

        label:
          label,

        selections
      });
    }

    if (markets.length >= 6) {
      break;
    }
  }

  return markets;
}


function extractSelections(
  body: string
): Record<string, any>[] {

  const out: Record<string, any>[] = [];

  const selectionRegex =
    /<obg-selection-container\b([^>]*)>([\s\S]*?)<\/obg-selection-container>/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      selectionRegex.exec(body))
  ) {

    const attrs =
      match[1];

    const inner =
      match[2];

    const selectionId =
      firstMatch(
        attrs,
        /selection-id="([^"]+)"/i
      );

    const label =
      firstMatch(
        inner,
        /class="obg-selection-label"[^>]*>\s*([^<]+?)\s*</i
      );

    const odds =
      firstMatch(
        inner,
        /test-id="odds"[^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*</i
      );

    if (
      selectionId ||
      label ||
      odds
    ) {
      out.push({
        selection_id:
          selectionId,

        label:
          label,

        odds:
          odds
            ? Number(odds)
            : null
      });
    }
  }

  return out;
}


// ============================================================
// TARGET MARKET ANALYSIS
// ============================================================

function analyseTargetMarket(
  html: string
): Record<string, any> {

  const lower =
    html.toLowerCase();

  return {
    first_half:
      lower.includes(
        "1st half"
      ) ||
      lower.includes(
        "first half"
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
      ),

    exact_text_combo:
      lower.includes(
        "1st half - total goals"
      ) ||
      lower.includes(
        "first half - total goals"
      ) ||
      lower.includes(
        "1st half total goals"
      ) ||
      lower.includes(
        "first half total goals"
      ),

    first_half_market_templates:
      findTemplateIds(
        html,
        [
          "1H",
          "FHT",
          "HT",
          "TOTAL"
        ]
      )
  };
}


// ============================================================
// TARGET SAMPLE
// ============================================================

function targetMarketSample(
  html: string
): string[] {

  return findContexts(
    html,
    [
      "Over 0.5",
      "Under 0.5",
      "1st Half - Total Goals",
      "First Half - Total Goals",
      "1st half",
      "Total Goals"
    ],
    5,
    500
  );
}


// ============================================================
// TEMPLATE IDS
// ============================================================

function findTemplateIds(
  html: string,
  tokens: string[]
): string[] {

  const out =
    new Set<string>();

  const regex =
    /market-template-ids="([^"]+)"/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(html))
  ) {

    const value =
      match[1];

    const upper =
      value.toUpperCase();

    if (
      tokens.some(
        token =>
          upper.includes(
            token
          )
      )
    ) {
      out.add(value);
    }

    if (out.size >= 20) {
      break;
    }
  }

  return Array.from(out);
}


// ============================================================
// DEDUPE
// ============================================================

function dedupeEvents(
  events: Record<string, any>[]
): Record<string, any>[] {

  const map =
    new Map<string, Record<string, any>>();

  for (const event of events) {
    const existing =
      map.get(
        event.event_id
      );

    if (!existing) {
      map.set(
        event.event_id,
        event
      );
      continue;
    }

    if (
      !existing.phase &&
      event.phase
    ) {
      existing.phase =
        event.phase;
    }

    if (
      !existing.home &&
      event.home
    ) {
      existing.home =
        event.home;
    }

    if (
      !existing.away &&
      event.away
    ) {
      existing.away =
        event.away;
    }

    if (
      (
        existing.visible_markets?.length ??
        0
      ) <
      (
        event.visible_markets?.length ??
        0
      )
    ) {
      existing.visible_markets =
        event.visible_markets;
    }
  }

  return Array.from(
    map.values()
  );
}


// ============================================================
// CONTEXT FINDER
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 5,
  radius = 500
): string[] {

  const out: string[] = [];
  const lower =
    text.toLowerCase();

  for (const rawNeedle of needles) {
    const needle =
      rawNeedle.toLowerCase();

    let start = 0;

    while (
      out.length <
      maxResults
    ) {
      const index =
        lower.indexOf(
          needle,
          start
        );

      if (index === -1) {
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
// GENERIC HELPERS
// ============================================================

function firstMatch(
  text: string,
  regex: RegExp
): string | null {

  const match =
    text.match(
      regex
    );

  if (
    !match ||
    !match[1]
  ) {
    return null;
  }

  return htmlText(
    match[1]
  );
}


function htmlText(
  value: string
): string {

  return decode(
    value
  )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&#39;/g,
      "'"
    )
    .replace(
      /&quot;/g,
      "\""
    )
    .replace(
      /&amp;/g,
      "&"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


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

  for (const pattern of patterns) {
    const match =
      text.match(
        pattern
      );

    if (
      match &&
      match[1]
    ) {
      return decode(
        match[1]
      ).trim();
    }
  }

  return null;
}


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
    .replace(/\\\\\//g, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u003F/gi, "?")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"");
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
