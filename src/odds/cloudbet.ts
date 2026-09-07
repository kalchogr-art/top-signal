// ============================================================
// TOP SIGNAL — CLOUDBET ODDS READER V5
// FILE: src/odds/cloudbet.ts
//
// READ ONLY
//
// PURPOSE:
// 1. debugCloudbet()
//    -> чете реалните LIVE soccer мачове
//    -> намира 1H Over 0.5
//    -> връща цена / статус / maxStake
//
// 2. getCloudbetFirstHalfOver05(eventId)
//    -> чете конкретен Cloudbet event
//    -> връща точния 1H Over 0.5
//
// NO:
// - login
// - auth
// - cookies
// - POST
// - betting
// - orders
// ============================================================


const VERSION =
  "V5";

const MODE =
  "READ_ONLY";

const CLOUDBET_BASE =
  "https://www.cloudbet.com";

const SPORTS_BASE =
  "/sports-api/c/v6/sports";

const MARKET =
  "soccer.total_goals_period_first_half";

const SUBMARKET =
  "period=1h";

const OUTCOME =
  "over";

const PARAMS =
  "total=0.5";

const LIVE_LIMIT =
  100;

const TIMEOUT_MS =
  8000;


// ============================================================
// TYPES
// ============================================================

type AnyObj =
  Record<string, any>;


// ============================================================
// PUBLIC
// DEBUG LIVE ODDS
// ============================================================

export async function debugCloudbet():
  Promise<any> {

  const started =
    Date.now();

  try {

    const live =
      await getLiveSoccerEvents();


    if (!live.success) {

      return {

        success: false,

        source:
          "CLOUDBET",

        version:
          VERSION,

        mode:
          MODE,

        stage:
          "LIVE_EVENTS",

        error:
          live.error,

        status:
          live.status,

        timing_ms:
          Date.now() -
          started

      };

    }


    const matches: any[] =
      [];


    for (
      const event
      of live.events
    ) {

      const selection =
        extractOver05(
          event
        );


      if (!selection) {
        continue;
      }


      matches.push({

        event_id:
          String(
            event?.id ??
            ""
          ),

        match:
          event?.name ??
          buildEventName(
            event
          ),

        status:
          event?.status ??
          null,

        event_status:
          event?.metadata
            ?.eventStatus ??
          null,

        minute:
          event?.metadata
            ?.eventTime ??
          null,

        minute_extended:
          event?.metadata
            ?.eventTimeExtended ??
          null,

        score:
          normalizeScore(
            event?.metadata
              ?.score
          ),

        price:
          selection.price,

        selection_status:
          selection.status,

        max_stake:
          selection.maxStake,

        min_stake:
          selection.minStake,

        probability:
          selection.probability,

        market_url:
          selection.marketUrl

      });

    }


    return {

      success: true,

      source:
        "CLOUDBET",

      version:
        VERSION,

      mode:
        MODE,

      reader:
        "FIRST_HALF_OVER_0.5",

      target: {

        sport:
          "soccer",

        market:
          MARKET,

        submarket:
          SUBMARKET,

        outcome:
          OUTCOME,

        params:
          PARAMS

      },

      summary: {

        live_events:
          live.events.length,

        over_05_found:
          matches.length,

        enabled:
          matches.filter(
            x =>
              x.selection_status ===
              "SELECTION_ENABLED"
          ).length

      },

      matches,

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

      version:
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
// PUBLIC
// GET ODDS FOR EXACT EVENT
// ============================================================

export async function getCloudbetFirstHalfOver05(
  eventId: string | number
): Promise<any> {

  const started =
    Date.now();

  const id =
    String(
      eventId
    ).trim();


  if (!id) {

    return {

      success: false,

      source:
        "CLOUDBET",

      version:
        VERSION,

      mode:
        MODE,

      error:
        "EVENT_ID_REQUIRED"

    };

  }


  const url =
    buildEventUrl(
      id
    );


  const result =
    await fetchJson(
      url
    );


  if (!result.ok) {

    return {

      success: false,

      source:
        "CLOUDBET",

      version:
        VERSION,

      mode:
        MODE,

      event_id:
        id,

      status:
        result.status,

      error:
        result.error ||
        `CLOUDBET_HTTP_${result.status}`,

      timing_ms:
        Date.now() -
        started

    };

  }


  const event =
    result.data;


  const selection =
    extractOver05(
      event
    );


  if (!selection) {

    return {

      success: true,

      source:
        "CLOUDBET",

      version:
        VERSION,

      mode:
        MODE,

      event_id:
        id,

      event_name:
        event?.name ??
        buildEventName(
          event
        ),

      event_status:
        event?.status ??
        null,

      minute:
        event?.metadata
          ?.eventTime ??
        null,

      score:
        normalizeScore(
          event?.metadata
            ?.score
        ),

      market:
        MARKET,

      submarket:
        SUBMARKET,

      outcome:
        OUTCOME,

      params:
        PARAMS,

      available:
        false,

      price:
        null,

      status:
        null,

      max_stake:
        null,

      reason:
        "TARGET_SELECTION_NOT_FOUND",

      timing_ms:
        Date.now() -
        started

    };

  }


  const available =
    selection.status ===
      "SELECTION_ENABLED" &&
    typeof selection.price ===
      "number" &&
    selection.price > 1;


  return {

    success: true,

    source:
      "CLOUDBET",

    version:
      VERSION,

    mode:
      MODE,

    event_id:
      id,

    event_name:
      event?.name ??
      buildEventName(
        event
      ),

    event_status:
      event?.status ??
      null,

    minute:
      event?.metadata
        ?.eventTime ??
      null,

    minute_extended:
      event?.metadata
        ?.eventTimeExtended ??
      null,

    score:
      normalizeScore(
        event?.metadata
          ?.score
      ),

    market:
      MARKET,

    submarket:
      SUBMARKET,

    outcome:
      selection.outcome,

    params:
      selection.params,

    price:
      selection.price,

    status:
      selection.status,

    min_stake:
      selection.minStake,

    max_stake:
      selection.maxStake,

    probability:
      selection.probability,

    market_url:
      selection.marketUrl,

    available,

    timing_ms:
      Date.now() -
      started

  };

}


// ============================================================
// LIVE SOCCER EVENTS
// ============================================================

async function getLiveSoccerEvents():
  Promise<any> {

  const url =
    new URL(
      SPORTS_BASE +
      "/events",
      CLOUDBET_BASE
    );


  url.searchParams.set(
    "sports",
    "soccer"
  );

  url.searchParams.set(
    "markets",
    MARKET
  );

  url.searchParams.set(
    "live",
    "true"
  );

  url.searchParams.set(
    "limit",
    String(
      LIVE_LIMIT
    )
  );

  url.searchParams.set(
    "locale",
    "en"
  );


  const result =
    await fetchJson(
      url.toString()
    );


  if (!result.ok) {

    return {

      success: false,

      status:
        result.status,

      error:
        result.error

    };

  }


  const events =
    extractEvents(
      result.data
    );


  return {

    success: true,

    events

  };

}


// ============================================================
// EXACT EVENT URL
// ============================================================

function buildEventUrl(
  eventId: string
) {

  const url =
    new URL(
      SPORTS_BASE +
      "/events/" +
      encodeURIComponent(
        eventId
      ),
      CLOUDBET_BASE
    );


  url.searchParams.set(
    "entities",
    "all"
  );

  url.searchParams.set(
    "locale",
    "en"
  );

  url.searchParams.set(
    "markets",
    MARKET
  );


  return url.toString();

}


// ============================================================
// EXTRACT EVENTS FROM:
// sports[].competitions[].events[]
// ============================================================

function extractEvents(
  data: AnyObj
): AnyObj[] {

  const events: AnyObj[] =
    [];


  const sports =
    Array.isArray(
      data?.sports
    )
      ? data.sports
      : [];


  for (
    const sport
    of sports
  ) {

    const competitions =
      Array.isArray(
        sport?.competitions
      )
        ? sport.competitions
        : [];


    for (
      const competition
      of competitions
    ) {

      const competitionEvents =
        Array.isArray(
          competition?.events
        )
          ? competition.events
          : [];


      for (
        const event
        of competitionEvents
      ) {

        events.push({

          ...event,

          sport:
            event?.sport ??
            {
              name:
                sport?.name ??
                null,

              key:
                sport?.key ??
                null
            },

          competition:
            event?.competition ??
            {

              name:
                competition
                  ?.name ??
                null,

              key:
                competition
                  ?.key ??
                null

            }

        });

      }

    }

  }


  return events;

}


// ============================================================
// EXACT:
// markets[MARKET]
// -> submarkets["period=1h"]
// -> selections[]
// -> over + total=0.5
// ============================================================

function extractOver05(
  event: AnyObj
): AnyObj | null {

  const market =
    event?.markets?.[MARKET];


  if (!market) {
    return null;
  }


  const submarket =
    market?.submarkets?.[
      SUBMARKET
    ];


  if (!submarket) {
    return null;
  }


  const selections =
    Array.isArray(
      submarket?.selections
    )
      ? submarket.selections
      : [];


  const selection =
    selections.find(
      (
        item: AnyObj
      ) =>
        item?.outcome ===
          OUTCOME &&
        item?.params ===
          PARAMS
    );


  if (!selection) {
    return null;
  }


  return {

    outcome:
      selection?.outcome ??
      null,

    params:
      selection?.params ??
      null,

    price:
      numericOrNull(
        selection?.price
      ),

    status:
      selection?.status ??
      null,

    minStake:
      numericOrNull(
        selection?.minStake
      ),

    maxStake:
      numericOrNull(
        selection?.maxStake
      ),

    probability:
      numericOrNull(
        selection?.probability
      ),

    marketUrl:
      selection?.marketUrl ??
      null

  };

}


// ============================================================
// HTTP GET
// ============================================================

async function fetchJson(
  url: string
): Promise<any> {

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

          signal:
            controller.signal,

          headers: {

            Accept:
              "application/json"

          }

        }
      );


    if (!response.ok) {

      return {

        ok: false,

        status:
          response.status,

        error:
          `HTTP_${response.status}`,

        data:
          null

      };

    }


    const data =
      await response.json();


    return {

      ok: true,

      status:
        response.status,

      error:
        null,

      data

    };


  } catch (
    error: any
  ) {

    return {

      ok: false,

      status:
        0,

      error:
        error?.name ===
          "AbortError"
          ? "TIMEOUT"
          : error?.message ||
            String(error),

      data:
        null

    };


  } finally {

    clearTimeout(
      timeout
    );

  }

}


// ============================================================
// EVENT NAME FALLBACK
// ============================================================

function buildEventName(
  event: AnyObj
) {

  const home =
    event?.home?.name;

  const away =
    event?.away?.name;


  if (
    typeof home ===
      "string" &&
    typeof away ===
      "string"
  ) {

    return (
      home +
      " v " +
      away
    );

  }


  return null;

}


// ============================================================
// SCORE
// ============================================================

function normalizeScore(
  score: any
) {

  if (
    !Array.isArray(
      score
    ) ||
    score.length < 2
  ) {

    return null;

  }


  return {

    home:
      numericOrNull(
        score[0]
      ),

    away:
      numericOrNull(
        score[1]
      )

  };

}


// ============================================================
// NUMBER
// ============================================================

function numericOrNull(
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
      "string" &&
    value.trim() !==
      ""
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
