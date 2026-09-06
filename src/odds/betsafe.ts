// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V13
// READ ONLY
//
// FIX FROM V12:
// - V12 was accidentally treating market/selection IDs as event IDs.
// - V13 derives the REAL base event ID from market-id + market-template-ids.
// - Teams are taken from the Match Result market.
// - Phase is taken from the nearest preceding event status.
// - Only real 1H events are probed.
//
// GOAL:
// Test event-specific SSR pages for:
//   1st Half / First Half
//   Total Goals
//   Over 0.5 / Under 0.5
//
// NO BETTING
// NO LOGIN
// NO D1 WRITES
// ============================================================

const ORIGIN = "https://www.betsafe.com";

const LIVE_PATH =
  "/en/sportsbook/live";

const LIVE_URL =
  ORIGIN + LIVE_PATH;

const SSR_ENDPOINT =
  ORIGIN + "/sb/fe-api/ssr/v1/generate";

const MAX_EVENTS = 12;
const MAX_1H_PROBES = 6;


// ============================================================
// MAIN
// ============================================================

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started = Date.now();

  try {

    // --------------------------------------------------------
    // 1. Normal live page -> context IDs
    // --------------------------------------------------------

    const pageResponse =
      await fetch(
        LIVE_URL,
        {
          method: "GET",
          headers: pageHeaders(),
          redirect: "follow"
        }
      );

    const pageHtml =
      decode(
        await pageResponse.text()
      );

    const staticContextId =
      extractJsonValue(
        pageHtml,
        "staticContextId"
      );

    const userContextId =
      extractJsonValue(
        pageHtml,
        "userContextId"
      );

    if (
      !staticContextId ||
      !userContextId
    ) {
      return {
        success: false,
        source: "BETSAFE",
        diagnostic_version: "V13",
        stage: "CONTEXT",
        error: "Missing context IDs",
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
        diagnostic_version: "V13",
        stage: "LIVE_SSR",
        live_ssr: {
          status: liveSsr.status,
          ok: liveSsr.ok,
          content_type: liveSsr.content_type,
          content_length: liveSsr.body.length
        }
      };
    }


    // --------------------------------------------------------
    // 3. REAL base event IDs
    // --------------------------------------------------------

    const events =
      extractRealEvents(
        liveSsr.body
      )
      .slice(
        0,
        MAX_EVENTS
      );

    const firstHalfEvents =
      events
        .filter(
          event =>
            isFirstHalf(
              event.phase
            )
        )
        .slice(
          0,
          MAX_1H_PROBES
        );


    // --------------------------------------------------------
    // 4. Event-specific probes
    // --------------------------------------------------------

    const probes: Record<string, any>[] = [];

    for (
      const event
      of firstHalfEvents
    ) {

      const eventId =
        event.event_id;

      const candidatePaths = [
        `${LIVE_PATH}?eventId=${eventId}`,
        `${LIVE_PATH}/live?eventId=${eventId}`,
        `/en/sportsbook/event/${eventId}`,
        `/en/sportsbook/live/event/${eventId}`
      ];

      const candidateResults:
        Record<string, any>[] = [];

      for (
        const path
        of candidatePaths
      ) {

        const result =
          await fetchSsr(
            path,
            staticContextId,
            userContextId
          );

        candidateResults.push({
          path,

          status:
            result.status,

          ok:
            result.ok,

          content_type:
            result.content_type,

          content_length:
            result.body.length,

          signals:
            analyseTargetMarket(
              result.body
            ),

          exact_matches:
            extractExactTargetMarkets(
              result.body
            ),

          sample:
            targetMarketSample(
              result.body
            )
        });
      }

      probes.push({
        event_id:
          eventId,

        home:
          event.home,

        away:
          event.away,

        phase:
          event.phase,

        visible_markets:
          event.visible_markets,

        candidates:
          candidateResults
      });
    }


    return {
      success: true,

      source:
        "BETSAFE",

      diagnostic_version:
        "V13",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      page: {
        status:
          pageResponse.status,

        ok:
          pageResponse.ok
      },

      live_ssr: {
        status:
          liveSsr.status,

        ok:
          liveSsr.ok,

        content_length:
          liveSsr.body.length
      },

      summary: {
        real_events_found:
          events.length,

        first_half_events:
          firstHalfEvents.length,

        probes_run:
          probes.length
      },

      events,

      event_probes:
        probes,

      timing_ms:
        Date.now() -
        started
    };

  } catch (error: any) {

    return {
      success: false,

      source:
        "BETSAFE",

      diagnostic_version:
        "V13",

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

  const params =
    new URLSearchParams({
      path
    });

  const url =
    `${SSR_ENDPOINT}?${params.toString()}`;

  const response =
    await fetch(
      url,
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

  const body =
    decode(
      await response.text()
    );

  return {
    status:
      response.status,

    ok:
      response.ok,

    content_type:
      response.headers.get(
        "content-type"
      ),

    body
  };
}


// ============================================================
// REAL EVENT EXTRACTION
// ============================================================

function extractRealEvents(
  html: string
): Record<string, any>[] {

  const eventIds =
    new Set<string>();

  const marketRegex =
    /<obg-event-row-market-container\b([^>]*)>/gi;

  let marketMatch:
    RegExpExecArray | null;

  while (
    (
      marketMatch =
        marketRegex.exec(html)
    )
  ) {

    const attrs =
      marketMatch[1];

    const marketId =
      attr(
        attrs,
        "market-id"
      );

    const templateIds =
      attr(
        attrs,
        "market-template-ids"
      );

    if (
      !marketId ||
      !templateIds
    ) {
      continue;
    }

    const eventId =
      deriveBaseEventId(
        marketId,
        templateIds
      );

    if (eventId) {
      eventIds.add(
        eventId
      );
    }
  }


  const events:
    Record<string, any>[] = [];

  for (
    const eventId
    of eventIds
  ) {

    const event =
      buildEvent(
        html,
        eventId
      );

    if (event) {
      events.push(
        event
      );
    }
  }


  // Sort 1H first, then halftime, then others.
  events.sort(
    (a, b) =>
      phaseRank(a.phase) -
      phaseRank(b.phase)
  );

  return events;
}


// ============================================================
// DERIVE BASE EVENT ID
// ============================================================

function deriveBaseEventId(
  marketId: string,
  templateIds: string
): string | null {

  // Example:
  // market-id:
  //   m-f-C7UQaaiDJUyO6m6AUjNKQA-MTG2W-1.5
  //
  // market-template-ids:
  //   MTG2W25,MTG2W,ESFMTOTAL,ESFMATOTAL
  //
  // => event:
  //   f-C7UQaaiDJUyO6m6AUjNKQA

  let value =
    marketId;

  if (
    value.startsWith("m-")
  ) {
    value =
      value.slice(2);
  }

  const templates =
    templateIds
      .split(",")
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.length -
          a.length
      );

  for (
    const template
    of templates
  ) {

    const marker =
      `-${template}`;

    const index =
      value.indexOf(
        marker
      );

    if (
      index > 0
    ) {

      const candidate =
        value.slice(
          0,
          index
        );

      if (
        candidate.startsWith(
          "f-"
        )
      ) {
        return candidate;
      }
    }
  }

  // Fallback for known sportsbook template-like suffixes.
  const fallback =
    value.match(
      /^(f-[A-Za-z0-9_-]+?)-(?:MW3W|MTG2W25|MTG2W|BTTS|M3WHCP|DC)(?:-|$)/
    );

  return fallback?.[1] ??
    null;
}


// ============================================================
// BUILD ONE EVENT
// ============================================================

function buildEvent(
  html: string,
  eventId: string
): Record<string, any> | null {

  const needle =
    `m-${eventId}-`;

  const index =
    html.indexOf(
      needle
    );

  if (
    index === -1
  ) {
    return null;
  }


  // The market occurs after scorecard/status.
  // A 16k backward window is enough for the event header.
  const headerFrom =
    Math.max(
      0,
      index - 16000
    );

  const headerBlock =
    html.slice(
      headerFrom,
      index
    );

  const phase =
    lastMatch(
      headerBlock,
      /<span class="phase">\s*([^<]+?)\s*<\/span>/gi
    );


  // Find all markets that belong to this exact base event ID.
  const visibleMarkets =
    extractEventMarkets(
      html,
      eventId
    );


  // Strongest team source:
  // Match Result selection IDs explicitly tell home/draw/away.
  let home:
    string | null = null;

  let away:
    string | null = null;

  const matchResult =
    visibleMarkets.find(
      market =>
        market.label ===
          "Match Result" ||
        market.market_id
          ?.includes(
            "-MW3W"
          )
    );

  if (matchResult) {

    for (
      const selection
      of matchResult.selections ??
      []
    ) {

      const id =
        String(
          selection.selection_id ??
          ""
        );

      if (
        id.endsWith(
          "-home"
        )
      ) {
        home =
          selection.label ??
          null;
      }

      if (
        id.endsWith(
          "-away"
        )
      ) {
        away =
          selection.label ??
          null;
      }
    }
  }


  return {
    event_id:
      eventId,

    phase,

    home,

    away,

    visible_markets:
      visibleMarkets
  };
}


// ============================================================
// EXTRACT MARKETS FOR EXACT EVENT
// ============================================================

function extractEventMarkets(
  html: string,
  eventId: string
): Record<string, any>[] {

  const out:
    Record<string, any>[] = [];

  const regex =
    /<obg-event-row-market-container\b([^>]*)>([\s\S]*?)<\/obg-event-row-market-container>/gi;

  let match:
    RegExpExecArray | null;

  while (
    (
      match =
        regex.exec(html)
    )
  ) {

    const attrs =
      match[1];

    const body =
      match[2];

    const marketId =
      attr(
        attrs,
        "market-id"
      );

    if (
      !marketId ||
      !marketId.startsWith(
        `m-${eventId}-`
      )
    ) {
      continue;
    }

    const label =
      firstMatch(
        body,
        /event-row\.market-header\.label"[^>]*>\s*([^<]+?)\s*</i
      );

    const selections =
      extractSelections(
        body
      );

    out.push({
      market_id:
        marketId,

      label,

      selections
    });

    if (
      out.length >= 8
    ) {
      break;
    }
  }

  return out;
}


// ============================================================
// SELECTIONS
// ============================================================

function extractSelections(
  body: string
): Record<string, any>[] {

  const out:
    Record<string, any>[] = [];

  const regex =
    /<obg-selection-container\b([^>]*)>([\s\S]*?)<\/obg-selection-container>/gi;

  let match:
    RegExpExecArray | null;

  while (
    (
      match =
        regex.exec(body)
    )
  ) {

    const attrs =
      match[1];

    const inner =
      match[2];

    const selectionId =
      attr(
        attrs,
        "selection-id"
      );

    const label =
      firstMatch(
        inner,
        /class="obg-selection-label"[^>]*>\s*([^<]+?)\s*</i
      );

    const oddsText =
      firstMatch(
        inner,
        /test-id="odds"[^>]*>\s*([0-9]+(?:\.[0-9]+)?)\s*</i
      );

    out.push({
      selection_id:
        selectionId,

      label,

      odds:
        oddsText
          ? Number(
              oddsText
            )
          : null
    });
  }

  return out;
}


// ============================================================
// TARGET ANALYSIS
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
      )
  };
}


// ============================================================
// EXTRACT EXACT TARGET-LIKE MARKETS
// ============================================================

function extractExactTargetMarkets(
  html: string
): Record<string, any>[] {

  const out:
    Record<string, any>[] = [];

  const regex =
    /<obg-event-row-market-container\b([^>]*)>([\s\S]*?)<\/obg-event-row-market-container>/gi;

  let match:
    RegExpExecArray | null;

  while (
    (
      match =
        regex.exec(html)
    )
  ) {

    const attrs =
      match[1];

    const body =
      match[2];

    const label =
      firstMatch(
        body,
        /event-row\.market-header\.label"[^>]*>\s*([^<]+?)\s*</i
      );

    const selections =
      extractSelections(
        body
      );

    const combined =
      (
        `${label ?? ""} ` +
        selections
          .map(
            s =>
              s.label ??
              ""
          )
          .join(" ")
      )
        .toLowerCase();

    const interesting =
      combined.includes(
        "0.5"
      ) ||
      combined.includes(
        "1st half"
      ) ||
      combined.includes(
        "first half"
      );

    if (!interesting) {
      continue;
    }

    out.push({
      market_id:
        attr(
          attrs,
          "market-id"
        ),

      market_template_ids:
        attr(
          attrs,
          "market-template-ids"
        ),

      label,

      selections
    });

    if (
      out.length >= 12
    ) {
      break;
    }
  }

  return out;
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
    450
  );
}


// ============================================================
// PHASE
// ============================================================

function isFirstHalf(
  phase: any
): boolean {

  const value =
    String(
      phase ??
      ""
    )
      .toLowerCase();

  return value.includes(
    "1st half"
  ) ||
  value.includes(
    "first half"
  );
}


function phaseRank(
  phase: any
): number {

  const value =
    String(
      phase ??
      ""
    )
      .toLowerCase();

  if (
    isFirstHalf(value)
  ) {
    return 0;
  }

  if (
    value.includes(
      "halftime"
    )
  ) {
    return 1;
  }

  if (
    value.includes(
      "2nd half"
    ) ||
    value.includes(
      "second half"
    )
  ) {
    return 2;
  }

  return 3;
}


// ============================================================
// ATTRIBUTE
// ============================================================

function attr(
  attrs: string,
  name: string
): string | null {

  const escaped =
    escapeRegex(
      name
    );

  const match =
    attrs.match(
      new RegExp(
        `${escaped}="([^"]*)"`,
        "i"
      )
    );

  return match?.[1] ??
    null;
}


// ============================================================
// MATCH HELPERS
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


function lastMatch(
  text: string,
  regex: RegExp
): string | null {

  regex.lastIndex =
    0;

  let match:
    RegExpExecArray | null;

  let value:
    string | null = null;

  while (
    (
      match =
        regex.exec(text)
    )
  ) {

    if (
      match[1]
    ) {
      value =
        htmlText(
          match[1]
        );
    }

    if (
      match[0].length === 0
    ) {
      regex.lastIndex++;
    }
  }

  return value;
}


// ============================================================
// CONTEXT FINDER
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 5,
  radius = 450
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
// CONTEXT VALUE
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
      return decode(
        match[1]
      ).trim();
    }
  }

  return null;
}


// ============================================================
// TEXT
// ============================================================

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

  return String(
    value
  )
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
