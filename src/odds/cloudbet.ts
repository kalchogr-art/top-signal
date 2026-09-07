// ============================================================
// TOP SIGNAL — CLOUDBET V4
// FILE: src/odds/cloudbet.ts
//
// READ ONLY — REAL LIVE EVENT GET TEST
//
// TARGET:
// Soccer
// Live
// First Half Total Goals
// Over 0.5
//
// NO:
// - login
// - auth
// - cookies
// - POST
// - orders
// - place bet
// ============================================================

const VERSION = "V4";
const MODE = "READ_ONLY_REAL_GET";

const HOST =
  "https://www.cloudbet.com";

const BASES = [
  "/sports-api/c/v6/sports",
  "/sports-api/v6/sports"
];

const TARGET_MARKETS = [
  "soccer.total_goals_period_first_half",
  "soccer_total_goals_period_first_half"
];

const TARGET_OUTCOME =
  "over";

const TARGET_TOTAL =
  0.5;

const FETCH_TIMEOUT_MS =
  8000;

const MAX_EVENT_DETAILS =
  6;


// ============================================================
// PUBLIC EXPORT
// ============================================================

export async function debugCloudbet(): Promise<any> {

  const started =
    Date.now();

  try {

    // ========================================================
    // 1. GET LIVE SOCCER EVENTS
    // ========================================================

    const listAttempts: any[] = [];

    let listData: any = null;

    let listBase: string | null =
      null;

    let listMarket: string | null =
      null;


    // ========================================================
    // TRY BOTH MARKET KEY FORMATS
    // ========================================================

    outer:

    for (
      const base
      of BASES
    ) {

      for (
        const market
        of TARGET_MARKETS
      ) {

        const url =
          buildUrl(
            base + "/events",
            {
              sports:
                "soccer",

              markets:
                market,

              live:
                "true",

              limit:
                "100",

              locale:
                "en"
            }
          );


        const response =
          await getJson(
            url
          );


        listAttempts.push({

          base,

          market,

          url,

          status:
            response.status,

          ok:
            response.ok,

          content_type:
            response.contentType,

          body_type:
            typeOfBody(
              response.data
            ),

          body_preview:
            preview(
              response.data
            ),

          error:
            response.error ||
            null

        });


        if (
          response.ok &&
          response.data
        ) {

          listData =
            response.data;

          listBase =
            base;

          listMarket =
            market;

          break outer;

        }

      }

    }


    // ========================================================
    // 2. FALLBACK WITHOUT MARKET FILTER
    // ========================================================

    if (!listData) {

      for (
        const base
        of BASES
      ) {

        const url =
          buildUrl(
            base + "/events",
            {
              sports:
                "soccer",

              live:
                "true",

              limit:
                "100",

              locale:
                "en"
            }
          );


        const response =
          await getJson(
            url
          );


        listAttempts.push({

          base,

          market:
            null,

          fallback:
            "NO_MARKET_FILTER",

          url,

          status:
            response.status,

          ok:
            response.ok,

          content_type:
            response.contentType,

          body_type:
            typeOfBody(
              response.data
            ),

          body_preview:
            preview(
              response.data
            ),

          error:
            response.error ||
            null

        });


        if (
          response.ok &&
          response.data
        ) {

          listData =
            response.data;

          listBase =
            base;

          break;

        }

      }

    }


    // ========================================================
    // NO API RESPONSE
    // ========================================================

    if (!listData) {

      return {

        success: false,

        source:
          "CLOUDBET",

        diagnostic_version:
          VERSION,

        mode:
          MODE,

        stage:
          "LIVE_EVENTS_GET",

        error:
          "NO_SUCCESSFUL_LIVE_EVENTS_RESPONSE",

        list_attempts:
          listAttempts,

        timing_ms:
          Date.now() -
          started

      };

    }


    // ========================================================
    // 3. EXTRACT EVENTS RECURSIVELY
    // ========================================================

    const events =
      collectEvents(
        listData
      );


    // ========================================================
    // 4. CHECK WHETHER LIST ALREADY CONTAINS TARGET ODDS
    // ========================================================

    const listMatches: any[] =
      [];


    for (
      const event
      of events
    ) {

      const targets =
        findTargetSelections(
          event.raw
        );


      if (
        targets.length === 0
      ) {
        continue;
      }


      listMatches.push({

        event_id:
          event.id,

        name:
          event.name,

        status:
          event.status,

        selections:
          targets.slice(
            0,
            10
          )

      });

    }


    // ========================================================
    // 5. FETCH EVENT DETAILS
    //
    // If list endpoint doesn't expose enough market depth,
    // request individual events.
    // ========================================================

    const detailAttempts: any[] =
      [];

    const detailMatches: any[] =
      [];


    const eventsToCheck =
      events.slice(
        0,
        MAX_EVENT_DETAILS
      );


    for (
      const event
      of eventsToCheck
    ) {

      if (!event.id) {
        continue;
      }


      let eventFound =
        false;


      // ======================================================
      // TRY BOTH KNOWN MARKET FORMATS
      // ======================================================

      for (
        const market
        of TARGET_MARKETS
      ) {

        const base =
          listBase ||
          BASES[0];


        const url =
          buildUrl(
            base +
              "/events/" +
              encodeURIComponent(
                event.id
              ),
            {
              entities:
                "all",

              locale:
                "en",

              markets:
                market
            }
          );


        const response =
          await getJson(
            url
          );


        const selections =
          response.ok
            ? findTargetSelections(
                response.data
              )
            : [];


        detailAttempts.push({

          event_id:
            event.id,

          event_name:
            event.name,

          market,

          url,

          status:
            response.status,

          ok:
            response.ok,

          selections_found:
            selections.length,

          body_preview:
            preview(
              response.data
            ),

          error:
            response.error ||
            null

        });


        if (
          selections.length > 0
        ) {

          detailMatches.push({

            event_id:
              event.id,

            event_name:
              event.name,

            requested_market:
              market,

            selections:
              selections.slice(
                0,
                20
              )

          });


          eventFound =
            true;

          break;

        }

      }


      if (eventFound) {
        continue;
      }

    }


    // ========================================================
    // 6. COMBINE FOUND ODDS
    // ========================================================

    const oddsCandidates =
      [
        ...listMatches.map(
          x => ({
            source:
              "LIVE_EVENTS_LIST",

            ...x
          })
        ),

        ...detailMatches.map(
          x => ({
            source:
              "EVENT_DETAIL",

            ...x
          })
        )
      ];


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

        methods: [
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

        orders:
          false,

        place_bet:
          false

      },


      target: {

        sport:
          "soccer",

        live:
          true,

        market_candidates:
          TARGET_MARKETS,

        outcome:
          TARGET_OUTCOME,

        total:
          TARGET_TOTAL

      },


      api: {

        selected_base:
          listBase,

        selected_market:
          listMarket,

        endpoint:
          listBase
            ? listBase +
              "/events"
            : null

      },


      summary: {

        live_api_success:
          true,

        live_events_found:
          events.length,

        list_target_matches:
          listMatches.length,

        event_details_checked:
          eventsToCheck.length,

        detail_target_matches:
          detailMatches.length,

        total_odds_candidates:
          oddsCandidates.length,

        target_odds_found:
          oddsCandidates.length > 0

      },


      // ======================================================
      // MOST IMPORTANT
      // ======================================================

      odds_candidates:
        oddsCandidates.slice(
          0,
          30
        ),


      // ======================================================
      // LIVE EVENTS SAMPLE
      // ======================================================

      live_events:
        events
          .slice(
            0,
            30
          )
          .map(
            event => ({

              id:
                event.id,

              name:
                event.name,

              status:
                event.status,

              sport:
                event.sport,

              competition:
                event.competition

            })
          ),


      list_attempts:
        listAttempts,


      detail_attempts:
        detailAttempts,


      raw_shape:
        describeShape(
          listData
        ),


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
// BUILD URL
// ============================================================

function buildUrl(
  path: string,
  params: Record<
    string,
    string | undefined
  >
) {

  const url =
    new URL(
      path,
      HOST
    );


  for (
    const [
      key,
      value
    ]
    of Object.entries(
      params
    )
  ) {

    if (
      value === undefined
    ) {
      continue;
    }


    url.searchParams.set(
      key,
      value
    );

  }


  return url.href;

}


// ============================================================
// GET JSON
// ============================================================

async function getJson(
  url: string
): Promise<any> {

  const controller =
    new AbortController();


  const timeout =
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

            "Accept":
              "application/json,text/plain,*/*",

            "User-Agent":
              "Mozilla/5.0 (compatible; TopSignalCloudbetV4/1.0)",

            "Referer":
              "https://www.cloudbet.com/en/sports/soccer"

          }

        }
      );


    const contentType =
      response.headers.get(
        "content-type"
      ) || "";


    const text =
      await response.text();


    let data: any =
      null;


    if (text) {

      try {

        data =
          JSON.parse(
            text
          );

      } catch {

        data =
          text;

      }

    }


    return {

      ok:
        response.ok,

      status:
        response.status,

      contentType,

      data

    };


  } catch (
    error: any
  ) {

    return {

      ok: false,

      status: 0,

      contentType:
        "",

      data:
        null,

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


// ============================================================
// EVENT EXTRACTION
// ============================================================

function collectEvents(
  root: any
) {

  const found =
    new Map<string, any>();


  walk(
    root,
    value => {

      if (
        !value ||
        typeof value !==
          "object" ||
        Array.isArray(
          value
        )
      ) {
        return;
      }


      const id =
        value.id ??
        value.eventId ??
        value.event_id;


      if (
        id === undefined ||
        id === null
      ) {
        return;
      }


      const looksLikeEvent =
        value.markets !== undefined ||
        value.competition !== undefined ||
        value.sport !== undefined ||
        value.startTime !== undefined ||
        value.start_time !== undefined ||
        value.status !== undefined;


      if (!looksLikeEvent) {
        return;
      }


      const key =
        String(
          id
        );


      if (
        found.has(
          key
        )
      ) {
        return;
      }


      found.set(
        key,
        {

          id:
            key,

          name:
            extractEventName(
              value
            ),

          status:
            value.status ??
            null,

          sport:
            value.sport?.key ??
            value.sport?.name ??
            value.sport ??
            null,

          competition:
            value.competition?.name ??
            value.competition?.key ??
            null,

          raw:
            value

        }
      );

    }
  );


  return [
    ...found.values()
  ];

}


// ============================================================
// EVENT NAME
// ============================================================

function extractEventName(
  event: any
) {

  if (
    typeof event.name ===
      "string"
  ) {

    return event.name;

  }


  const home =
    event.home?.name ??
    event.homeTeam?.name ??
    event.home_team?.name ??
    event.home;


  const away =
    event.away?.name ??
    event.awayTeam?.name ??
    event.away_team?.name ??
    event.away;


  if (
    typeof home ===
      "string" &&
    typeof away ===
      "string"
  ) {

    return (
      home +
      " - " +
      away
    );

  }


  return null;

}


// ============================================================
// TARGET SELECTION FINDER
// ============================================================

function findTargetSelections(
  root: any
) {

  const results: any[] =
    [];


  walk(
    root,
    (
      value,
      path
    ) => {

      if (
        !value ||
        typeof value !==
          "object" ||
        Array.isArray(
          value
        )
      ) {
        return;
      }


      const outcome =
        stringLower(
          value.outcome ??
          value.name ??
          value.key ??
          value.selection
        );


      if (
        outcome !==
          "over" &&
        !outcome.endsWith(
          ".over"
        )
      ) {
        return;
      }


      const total =
        readTotal(
          value
        );


      if (
        total !==
          TARGET_TOTAL
      ) {
        return;
      }


      const fullText =
        (
          path +
          " " +
          safeString(
            value.marketType
          ) +
          " " +
          safeString(
            value.market
          ) +
          " " +
          safeString(
            value.marketKey
          )
        )
          .toLowerCase();


      const looksFirstHalfTotal =
        fullText.includes(
          "total_goals_period_first_half"
        ) ||

        fullText.includes(
          "total-goals-period-first-half"
        ) ||

        fullText.includes(
          "first_half"
        ) ||

        fullText.includes(
          "first-half"
        );


      results.push({

        path,

        outcome:
          value.outcome ??
          value.name ??
          value.key ??
          null,

        params:
          value.params ??
          null,

        total,

        price:
          readPrice(
            value
          ),

        status:
          value.status ??
          null,

        market_type:
          value.marketType ??
          value.marketKey ??
          value.market ??
          null,

        first_half_hint:
          looksFirstHalfTotal,

        raw:
          compactSelection(
            value
          )

      });

    }
  );


  // ==========================================================
  // FIRST HALF RESULTS FIRST
  // ==========================================================

  return results.sort(
    (a, b) =>
      Number(
        b.first_half_hint
      ) -
      Number(
        a.first_half_hint
      )
  );

}


// ============================================================
// READ TOTAL
// ============================================================

function readTotal(
  value: any
): number | null {

  const direct =
    [
      value.total,
      value.line,
      value.handicap
    ];


  for (
    const x
    of direct
  ) {

    const number =
      toNumber(
        x
      );


    if (
      number !== null
    ) {

      return number;

    }

  }


  const params =
    value.params;


  if (
    typeof params ===
      "string"
  ) {

    const match =
      params.match(
        /(?:^|[?&])total=([0-9.]+)/i
      );


    if (match) {

      return toNumber(
        match[1]
      );

    }

  }


  if (
    params &&
    typeof params ===
      "object"
  ) {

    const number =
      toNumber(
        params.total
      );


    if (
      number !== null
    ) {

      return number;

    }

  }


  return null;

}


// ============================================================
// READ PRICE
// ============================================================

function readPrice(
  value: any
) {

  const candidates =
    [

      value.price,

      value.odds,

      value.decimalOdds,

      value.decimal_odds,

      value.decimal,

      value.value

    ];


  for (
    const candidate
    of candidates
  ) {

    const number =
      toNumber(
        candidate
      );


    if (
      number !== null &&
      number > 1
    ) {

      return number;

    }

  }


  return null;

}


// ============================================================
// COMPACT SELECTION
// ============================================================

function compactSelection(
  value: any
) {

  return {

    outcome:
      value.outcome ??
      null,

    params:
      value.params ??
      null,

    price:
      value.price ??
      null,

    odds:
      value.odds ??
      null,

    status:
      value.status ??
      null,

    marketType:
      value.marketType ??
      null,

    marketKey:
      value.marketKey ??
      null,

    key:
      value.key ??
      null

  };

}


// ============================================================
// GENERIC WALK
// ============================================================

function walk(
  root: any,
  callback:
    (
      value: any,
      path: string
    ) => void
) {

  const seen =
    new WeakSet<object>();


  function visit(
    value: any,
    path: string,
    depth: number
  ) {

    if (
      depth > 15 ||
      value === null ||
      value === undefined
    ) {
      return;
    }


    if (
      typeof value !==
        "object"
    ) {
      return;
    }


    if (
      seen.has(
        value
      )
    ) {
      return;
    }


    seen.add(
      value
    );


    callback(
      value,
      path
    );


    if (
      Array.isArray(
        value
      )
    ) {

      for (
        let i = 0;
        i <
        value.length;
        i++
      ) {

        visit(
          value[i],
          path +
            "[" +
            i +
            "]",
          depth + 1
        );

      }

      return;

    }


    for (
      const [
        key,
        child
      ]
      of Object.entries(
        value
      )
    ) {

      visit(
        child,
        path
          ? path +
            "." +
            key
          : key,
        depth + 1
      );

    }

  }


  visit(
    root,
    "$",
    0
  );

}


// ============================================================
// HELPERS
// ============================================================

function toNumber(
  value: any
): number | null {

  if (
    typeof value ===
      "number" &&
    Number.isFinite(
      value
    )
  ) {

    return value;

  }


  if (
    typeof value ===
      "string"
  ) {

    const number =
      Number(
        value
      );


    if (
      Number.isFinite(
        number
      )
    ) {

      return number;

    }

  }


  return null;

}


function stringLower(
  value: any
) {

  return typeof value ===
    "string"
    ? value
        .trim()
        .toLowerCase()
    : "";

}


function safeString(
  value: any
) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }


  if (
    typeof value ===
      "string"
  ) {

    return value;

  }


  try {

    return JSON.stringify(
      value
    );

  } catch {

    return "";

  }

}


// ============================================================
// RESPONSE PREVIEW
// ============================================================

function preview(
  value: any
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;

  }


  try {

    return JSON.stringify(
      value
    ).slice(
      0,
      1200
    );

  } catch {

    return String(
      value
    ).slice(
      0,
      1200
    );

  }

}


// ============================================================
// BODY TYPE
// ============================================================

function typeOfBody(
  value: any
) {

  if (
    Array.isArray(
      value
    )
  ) {

    return "array";

  }


  if (
    value === null
  ) {

    return "null";

  }


  return typeof value;

}


// ============================================================
// SHAPE DESCRIPTION
// ============================================================

function describeShape(
  value: any
) {

  if (
    Array.isArray(
      value
    )
  ) {

    return {

      type:
        "array",

      length:
        value.length,

      first_item_keys:
        value[0] &&
        typeof value[0] ===
          "object"
          ? Object.keys(
              value[0]
            ).slice(
              0,
              50
            )
          : []

    };

  }


  if (
    value &&
    typeof value ===
      "object"
  ) {

    return {

      type:
        "object",

      keys:
        Object.keys(
          value
        ).slice(
          0,
          100
        )

    };

  }


  return {

    type:
      typeof value

  };

}
