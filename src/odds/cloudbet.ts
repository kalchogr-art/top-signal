// ============================================================
// TOP SIGNAL — CLOUDBET ODDS READER
// READ ONLY
// FIRST HALF TOTAL GOALS — OVER 0.5
// ============================================================

const CLOUDBET_BASE =
  "https://www.cloudbet.com";

const MARKET =
  "soccer.total_goals_period_first_half";

const SUBMARKET =
  "period=1h";

const OUTCOME =
  "over";

const PARAMS =
  "total=0.5";


// ============================================================
// REAL ODDS READER
// ============================================================

export async function getCloudbetFirstHalfOver05(
  eventId: string
) {

  const url =
    new URL(
      `/sports-api/c/v6/sports/events/${encodeURIComponent(eventId)}`,
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


  const response =
    await fetch(
      url.toString(),
      {
        method: "GET",
        headers: {
          Accept:
            "application/json"
        }
      }
    );


  if (!response.ok) {

    return {
      success: false,
      event_id: eventId,
      error:
        `CLOUDBET_HTTP_${response.status}`
    };

  }


  const event: any =
    await response.json();


  const market =
    event?.markets?.[MARKET];


  const submarket =
    market?.submarkets?.[SUBMARKET];


  const selections =
    Array.isArray(
      submarket?.selections
    )
      ? submarket.selections
      : [];


  const selection =
    selections.find(
      (item: any) =>
        item?.outcome ===
          OUTCOME &&
        item?.params ===
          PARAMS
    );


  if (!selection) {

    return {
      success: true,
      event_id: eventId,
      market: MARKET,
      submarket: SUBMARKET,
      outcome: OUTCOME,
      params: PARAMS,
      available: false,
      price: null,
      status: null
    };

  }


  return {

    success: true,

    event_id:
      eventId,

    event_name:
      event?.name ??
      null,

    market:
      MARKET,

    submarket:
      SUBMARKET,

    outcome:
      selection.outcome,

    params:
      selection.params,

    price:
      typeof selection.price ===
        "number"
        ? selection.price
        : null,

    status:
      selection.status ??
      null,

    max_stake:
      typeof selection.maxStake ===
        "number"
        ? selection.maxStake
        : null,

    available:
      selection.status ===
        "SELECTION_ENABLED" &&
      typeof selection.price ===
        "number" &&
      selection.price > 1

  };

}


// ============================================================
// KEEP EXISTING WORKER IMPORT WORKING
// ============================================================

export async function debugCloudbet() {

  return {
    success: true,
    source: "CLOUDBET",
    mode: "READ_ONLY",
    reader:
      "FIRST_HALF_OVER_0.5",
    endpoint:
      "/sports-api/c/v6/sports/events/{EVENT_ID}",
    market:
      MARKET,
    submarket:
      SUBMARKET,
    outcome:
      OUTCOME,
    params:
      PARAMS
  };

}
