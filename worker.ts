// ============================================================
// TOP SIGNAL V1.9.0 — BET STATUS
//
// TRACKER
//   ↓
// MATCHER
//   ↓
// SECURE CLOUDBET EVENT ID
//   ↓
// DASHBOARD
//   ↓
// USER CHOOSES:
//   CHECK ODDS
//   or
//   BET NOW
//
// CHECK ODDS:
// Dashboard -> exact Cloudbet event
// -> Violentmonkey reads 1H O0.5
// -> POST /api/odds
// -> returns Dashboard
//
// BET NOW:
// Dashboard -> exact Cloudbet event
// -> Violentmonkey selects 1H O0.5
// -> user confirms final Place Bet manually
// -> Violentmonkey detects successful confirmation
// -> POST /api/bet-status
// -> Dashboard shows ЗАЛОЖЕН ✅
//
// IMPORTANT:
// - Keeps V1.7.1 Matcher fix.
// - signal: "HUNTER_ENTRY" is NOT forwarded as nested Matcher signal.
// - Worker DOES NOT submit a real bet.
// - BET_PLACED is stored per Cloudbet event_id.
// - Invalid odds <= 1 or > 50 are NEVER treated as READY.
// ============================================================

const VERSION =
  "V1.9.0 BET STATUS";

const APP_NAME =
  "top-signal";


type Obj =
  Record<string, any>;


interface Env {

  DB:
    D1Database;

  TRACKER:
    Fetcher;

  MATCHER:
    Fetcher;
}


// ============================================================
// MAIN
// ============================================================

export default {

  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const url =
      new URL(
        request.url
      );


    // ========================================================
    // CORS
    // ========================================================

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,

          headers:
            corsHeaders()
        }
      );
    }


    // ========================================================
    // STATUS
    // ========================================================

    if (
      url.pathname ===
      "/api/status"
    ) {

      return json({

        success:
          true,

        worker:
          APP_NAME,

        version:
          VERSION,

        mode:
          "MANUAL_TARGET_CONTROL",

        betting:
          "MANUAL_FINAL_CONFIRMATION",

        storage:
          "D1",

        bindings: {

          DB:
            !!env.DB,

          TRACKER:
            !!env.TRACKER,

          MATCHER:
            !!env.MATCHER
        },

        flow:
          "TRACKER -> MATCHER -> DASHBOARD -> CLOUDBET FRONTEND -> D1",

        bet_status:
          "SUPPORTED",

        final_submit:
          "NOT_PERFORMED_BY_WORKER"
      });
    }


    // ========================================================
    // DEBUG TRACKER
    // ========================================================

    if (
      url.pathname ===
      "/api/debug/tracker"
    ) {

      try {

        const data =
          await fetchServiceJSON(
            env.TRACKER,
            "/entries"
          );


        const signals =
          extractHunterSignals(
            data
          );


        return json({

          success:
            true,

          raw_type:
            Array.isArray(
              data
            )
              ? "ARRAY"
              : typeof data,

          signals_found:
            signals.length,

          signals
        });

      } catch (
        error: any
      ) {

        return json(
          {

            success:
              false,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // DEBUG MATCHER
    // ========================================================

    if (
      url.pathname ===
      "/api/debug/matcher"
    ) {

      try {

        const tracker =
          await fetchServiceJSON(
            env.TRACKER,
            "/entries"
          );


        const signals =
          extractHunterSignals(
            tracker
          );


        const matcher =
          await callMatcher(
            env,
            signals
          );


        return json({

          success:
            true,

          tracker_signals:
            signals.length,

          matcher_version:
            matcher?.version ??
            null,

          matcher_stats:
            matcher?.stats ??
            null,

          hunter_results:
            matcher
              ?.hunter_results ??
            []
        });

      } catch (
        error: any
      ) {

        return json(
          {

            success:
              false,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // PRIMARY TARGET
    // ========================================================

    if (
      url.pathname ===
        "/api/target" &&

      request.method ===
        "GET"
    ) {

      try {

        const result =
          await buildTargets(
            env
          );


        const target =
          result.targets[0] ??
          null;


        return json({

          success:
            true,

          found:
            !!target,

          target,

          stats: {

            tracker_signals:
              result
                .trackerSignals,

            matcher_hunter_results:
              result
                .matcherHunterResults,

            secure_targets:
              result
                .targets
                .length,

            odds_ready:
              result
                .targets
                .filter(
                  item =>
                    item.ready ===
                      true &&
                    item.betPlaced !==
                      true
                )
                .length,

            bet_placed:
              result
                .targets
                .filter(
                  item =>
                    item.betPlaced ===
                    true
                )
                .length
          },

          timestamp:
            new Date()
              .toISOString()
        });

      } catch (
        error: any
      ) {

        console.error(
          "TARGET ERROR",
          error
        );


        return json(
          {

            success:
              false,

            found:
              false,

            target:
              null,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // ALL TARGETS
    // ========================================================

    if (
      url.pathname ===
        "/api/targets" &&

      request.method ===
        "GET"
    ) {

      try {

        const result =
          await buildTargets(
            env
          );


        return json({

          success:
            true,

          version:
            VERSION,

          count:
            result
              .targets
              .length,

          tracker_signals:
            result
              .trackerSignals,

          matcher_hunter_results:
            result
              .matcherHunterResults,

          odds_ready:
            result
              .targets
              .filter(
                item =>
                  item.ready ===
                    true &&
                  item.betPlaced !==
                    true
              )
              .length,

          bet_placed:
            result
              .targets
              .filter(
                item =>
                  item.betPlaced ===
                  true
              )
              .length,

          targets:
            result.targets
        });

      } catch (
        error: any
      ) {

        return json(
          {

            success:
              false,

            targets:
              [],

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // SAVE FRONTEND ODDS
    // ========================================================

    if (
      url.pathname ===
        "/api/odds" &&

      request.method ===
        "POST"
    ) {

      try {

        const body =
          await request
            .json<Obj>();


        const eventId =
          safe(
            body?.eventId
          );


        const overOdds =
          validOdds(
            body?.overOdds
          );


        const underOdds =
          validOdds(
            body?.underOdds
          );


        // ----------------------------------------------------
        // VALIDATION
        // ----------------------------------------------------

        if (
          !eventId ||
          overOdds === null
        ) {

          return json(
            {

              success:
                false,

              error:
                "INVALID_ODDS_PAYLOAD"
            },
            400
          );
        }


        const now =
          new Date()
            .toISOString();


        await env.DB
          .prepare(`
            INSERT INTO live_odds (
              event_id,
              match_name,
              minute,
              score,
              hunter_score,
              market,
              selection,
              over_odds,
              under_odds,
              source,
              created_at,
              updated_at
            )

            VALUES (
              ?1,
              NULL,
              NULL,
              NULL,
              NULL,
              '1H Total Goals',
              'Over 0.5',
              ?2,
              ?3,
              'CLOUDBET_FRONTEND',
              ?4,
              ?4
            )

            ON CONFLICT(event_id)

            DO UPDATE SET

              over_odds =
                excluded.over_odds,

              under_odds =
                excluded.under_odds,

              source =
                'CLOUDBET_FRONTEND',

              updated_at =
                excluded.updated_at
          `)

          .bind(
            eventId,
            overOdds,
            underOdds,
            now
          )

          .run();


        const stored =
          await getStoredEvent(
            env,
            eventId
          );


        return json({

          success:
            true,

          action:
            "ODDS_SAVED",

          eventId,

          overOdds,

          underOdds,

          data:
            stored
        });

      } catch (
        error: any
      ) {

        return json(
          {

            success:
              false,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // GET LAST ODDS
    // ========================================================

    if (
      url.pathname ===
        "/api/odds" &&

      request.method ===
        "GET"
    ) {

      try {

        const eventId =
          safe(
            url.searchParams
              .get(
                "eventId"
              )
          );


        if (
          eventId
        ) {

          const row =
            await getStoredEvent(
              env,
              eventId
            );


          return json({

            success:
              true,

            data:
              sanitizeStoredOdds(
                row
              )
          });
        }


        const row =
          await env.DB
            .prepare(`
              SELECT *
              FROM live_odds
              ORDER BY updated_at DESC
              LIMIT 1
            `)
            .first();


        return json({

          success:
            true,

          data:
            sanitizeStoredOdds(
              row as Obj | null
            )
        });

      } catch (
        error: any
      ) {

        return json(
          {

            success:
              false,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // SAVE BET STATUS
    // ========================================================

    if (
      url.pathname ===
        "/api/bet-status" &&

      request.method ===
        "POST"
    ) {

      try {

        await ensureBetStatusTable(
          env
        );


        const body =
          await request
            .json<Obj>();


        const eventId =
          safe(
            body?.eventId
          );


        const status =
          safe(
            body?.status
          )
            .toUpperCase();


        if (
          !eventId ||
          status !==
            "BET_PLACED"
        ) {

          return json(
            {

              success:
                false,

              error:
                "INVALID_BET_STATUS_PAYLOAD"
            },
            400
          );
        }


        // ----------------------------------------------------
        // REQUIRE EVENT TO EXIST
        // ----------------------------------------------------

        const storedEvent =
          await getStoredEvent(
            env,
            eventId
          );


        if (
          !storedEvent
        ) {

          return json(
            {

              success:
                false,

              error:
                "EVENT_NOT_FOUND"
            },
            404
          );
        }


        const now =
          new Date()
            .toISOString();


        await env.DB
          .prepare(`
            INSERT INTO bet_status (
              event_id,
              status,
              placed,
              placed_at,
              updated_at
            )

            VALUES (
              ?1,
              'BET_PLACED',
              1,
              ?2,
              ?2
            )

            ON CONFLICT(event_id)

            DO UPDATE SET

              status =
                'BET_PLACED',

              placed =
                1,

              placed_at =
                COALESCE(
                  bet_status.placed_at,
                  excluded.placed_at
                ),

              updated_at =
                excluded.updated_at
          `)

          .bind(
            eventId,
            now
          )

          .run();


        const stored =
          await getBetStatus(
            env,
            eventId
          );


        return json({

          success:
            true,

          action:
            "BET_PLACED_SAVED",

          eventId,

          placed:
            true,

          data:
            stored
        });

      } catch (
        error: any
      ) {

        return json(
          {

            success:
              false,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // GET BET STATUS
    // ========================================================

    if (
      url.pathname ===
        "/api/bet-status" &&

      request.method ===
        "GET"
    ) {

      try {

        await ensureBetStatusTable(
          env
        );


        const eventId =
          safe(
            url.searchParams
              .get(
                "eventId"
              )
          );


        if (
          !eventId
        ) {

          return json(
            {

              success:
                false,

              error:
                "EVENT_ID_REQUIRED"
            },
            400
          );
        }


        const row =
          await getBetStatus(
            env,
            eventId
          );


        return json({

          success:
            true,

          eventId,

          placed:
            Number(
              row?.placed ??
              0
            ) === 1,

          status:
            row?.status ??
            null,

          placedAt:
            row?.placed_at ??
            null,

          data:
            row ?? null
        });

      } catch (
        error: any
      ) {

        return json(
          {

            success:
              false,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // DASHBOARD
    // ========================================================

    return new Response(
      renderHtml(),
      {

        headers: {

          "content-type":
            "text/html; charset=UTF-8",

          "cache-control":
            "no-store, no-cache, must-revalidate"
        }
      }
    );
  }
};


// ============================================================
// BUILD TARGETS
// ============================================================

async function buildTargets(
  env: Env
): Promise<{

  trackerSignals:
    number;

  matcherHunterResults:
    number;

  targets:
    Obj[];

}> {

  await ensureBetStatusTable(
    env
  );


  const trackerData =
    await fetchServiceJSON(
      env.TRACKER,
      "/entries"
    );


  const signals =
    extractHunterSignals(
      trackerData
    );


  if (
    signals.length ===
    0
  ) {

    return {

      trackerSignals:
        0,

      matcherHunterResults:
        0,

      targets:
        []
    };
  }


  const matcherData =
    await callMatcher(
      env,
      signals
    );


  const hunterResults =
    Array.isArray(
      matcherData
        ?.hunter_results
    )

      ? matcherData
          .hunter_results

      : [];


  // ========================================================
  // SECURE ONLY
  // ========================================================

  const secureResults =
    hunterResults.filter(
      (
        item: Obj
      ) => {

        const eventId =
          safe(
            item
              ?.cloudbet
              ?.id ??

            item
              ?.cloudbet
              ?.event_id
          );


        const secure =
          item
            ?.security
            ?.secure_match ===
          true;


        const classification =
          safe(
            item
              ?.classification
          );


        return (
          !!eventId &&

          secure &&

          classification ===
            "CONFIDENT_MATCH"
        );
      }
    );


  const targets:
    Obj[] = [];


  for (
    const result
    of secureResults
  ) {

    const target =
      buildTarget(
        result
      );


    if (
      !target.eventId
    ) {

      continue;
    }


    // --------------------------------------------------------
    // SAVE BASIC TARGET DATA
    // --------------------------------------------------------

    await saveTarget(
      env,
      target
    );


    // --------------------------------------------------------
    // LOAD STORED FRONTEND ODDS
    // --------------------------------------------------------

    const stored =
      await getStoredEvent(
        env,
        target.eventId
      );


    const storedOdds =
      validOdds(
        stored
          ?.over_odds
      );


    const storedUnderOdds =
      validOdds(
        stored
          ?.under_odds
      );


    // --------------------------------------------------------
    // LOAD BET STATUS
    // --------------------------------------------------------

    const betStatus =
      await getBetStatus(
        env,
        target.eventId
      );


    const betPlaced =
      Number(
        betStatus
          ?.placed ??
        0
      ) === 1;


    targets.push({

      ...target,

      overOdds:
        storedOdds,

      underOdds:
        storedUnderOdds,

      oddsUpdatedAt:
        stored
          ?.updated_at ??
        null,

      oddsSource:
        stored
          ?.source ??
        null,

      ready:
        storedOdds !==
          null,

      betPlaced,

      betStatus:
        betStatus
          ?.status ??
        null,

      betPlacedAt:
        betStatus
          ?.placed_at ??
        null
    });
  }


  // ========================================================
  // NEWEST SIGNAL FIRST
  // ========================================================

  targets.sort(
    (
      a,
      b
    ) => {

      const ai =
        Number(
          a.signalId ??
          0
        );


      const bi =
        Number(
          b.signalId ??
          0
        );


      return (
        bi -
        ai
      );
    }
  );


  return {

    trackerSignals:
      signals.length,

    matcherHunterResults:
      hunterResults.length,

    targets
  };
}


// ============================================================
// MATCHER CALL
// ============================================================

async function callMatcher(
  env: Env,
  signals: Obj[]
): Promise<Obj> {

  const encoded =
    encodeURIComponent(
      JSON.stringify(
        signals
      )
    );


  return await fetchServiceJSON(
    env.MATCHER,

    "/match?signals=" +
      encoded
  );
}


// ============================================================
// EXTRACT HUNTER SIGNALS
// ============================================================

function extractHunterSignals(
  data: any
): Obj[] {

  let raw:
    any[] = [];


  if (
    Array.isArray(
      data
    )
  ) {

    raw =
      data;

  } else if (
    Array.isArray(
      data
        ?.hunter_entries
    )
  ) {

    raw =
      data
        .hunter_entries;

  } else if (
    Array.isArray(
      data
        ?.entries
    )
  ) {

    raw =
      data
        .entries;

  } else if (
    Array.isArray(
      data
        ?.signals
    )
  ) {

    raw =
      data
        .signals;

  } else if (
    Array.isArray(
      data
        ?.data
    )
  ) {

    raw =
      data.data;
  }


  return raw

    .filter(
      isHunterEntry
    )

    .map(
      normalizeSignal
    )

    .filter(
      Boolean
    ) as Obj[];
}


// ============================================================
// HUNTER ENTRY FILTER
// ============================================================

function isHunterEntry(
  item: Obj
): boolean {

  const type =
    safe(

      item?.type ??

      (
        typeof item
          ?.signal ===
          "string"

          ? item.signal

          : ""
      ) ??

      item
        ?.event_type
    )
      .toUpperCase();


  const action =
    safe(
      item?.action
    )
      .toUpperCase();


  const status =
    safe(
      item?.status
    )
      .toUpperCase();


  if (
    type ===
    "HUNTER_ENTRY"
  ) {

    return true;
  }


  if (
    action ===
      "ENTRY" &&

    status ===
      "TRACKING"
  ) {

    return true;
  }


  return false;
}


// ============================================================
// NORMALIZE SIGNAL
//
// IMPORTANT V1.7.1 FIX:
//
// We deliberately DO NOT return:
//
// signal: "HUNTER_ENTRY"
//
// because Matcher V7.1 interprets item.signal
// as a nested signal object.
// ============================================================

function normalizeSignal(
  item: Obj
): Obj | null {

  const matchName =
    safe(

      item
        ?.match_name ??

      item
        ?.match ??

      item
        ?.name
    );


  const split =
    splitMatch(
      matchName
    );


  const home =

    extractTeamName(
      item?.home
    ) ||

    split.home;


  const away =

    extractTeamName(
      item?.away
    ) ||

    split.away;


  if (
    !matchName &&
    !home &&
    !away
  ) {

    return null;
  }


  return {

    type:
      "HUNTER_ENTRY",

    action:
      "ENTRY",

    status:
      safe(
        item?.status
      ) ||
      "TRACKING",

    id:
      item?.id ??
      null,

    match_id:
      item?.match_id ??
      null,

    match_name:
      matchName,

    match:
      matchName,

    league:
      item?.league ??
      null,

    entry_time:
      item?.entry_time ??
      null,

    entry_minute:
      numberOrNull(

        item
          ?.entry_minute ??

        item
          ?.minute
      ),

    hunter_score:
      numberOrNull(

        item
          ?.hunter_score ??

        item
          ?.goal_signal
          ?.score
      ),

    goal_pressure:
      numberOrNull(
        item
          ?.goal_pressure
      ),

    danger_index:
      numberOrNull(
        item
          ?.danger_index
      ),

    attack_score:
      numberOrNull(
        item
          ?.attack_score
      ),

    score:
      item?.score ??
      {
        home:
          0,

        away:
          0
      },

    home:
      home ||
      null,

    away:
      away ||
      null
  };
}


// ============================================================
// BUILD TARGET
// ============================================================

function buildTarget(
  result: Obj
): Obj {

  const signal =
    result
      ?.signal ??
    {};


  const cloudbet =
    result
      ?.cloudbet ??
    {};


  const eventId =
    safe(

      cloudbet
        ?.id ??

      cloudbet
        ?.event_id
    );


  const matchName =
    safe(

      signal
        ?.match_name ??

      signal
        ?.match ??

      cloudbet
        ?.match
    );


  const minute =
    numberOrNull(

      signal
        ?.entry_minute ??

      signal
        ?.minute
    );


  const hunterScore =
    numberOrNull(
      signal
        ?.hunter_score
    );


  const score =

    scoreToString(
      signal?.score
    ) ||

    scoreToString(
      cloudbet?.score
    ) ||

    "0:0";


  return {

    eventId,

    signalId:
      signal?.id ??
      null,

    matchId:
      signal
        ?.match_id ??
      null,

    matchName,

    home:

      extractTeamName(
        signal?.home
      ) ||

      extractTeamName(
        cloudbet?.home
      ),

    away:

      extractTeamName(
        signal?.away
      ) ||

      extractTeamName(
        cloudbet?.away
      ),

    minute,

    score,

    hunterScore,

    cloudbetMatch:
      safe(
        cloudbet
          ?.match
      ),

    cloudbetHome:
      extractTeamName(
        cloudbet?.home
      ),

    cloudbetAway:
      extractTeamName(
        cloudbet?.away
      ),

    classification:
      result
        ?.classification ??
      null,

    secureMatch:
      result
        ?.security
        ?.secure_match ===
      true,

    matcherScore:
      numberOrNull(

        result
          ?.scoring
          ?.total ??

        result
          ?.matcher_scoring
          ?.total ??

        result
          ?.score
      )
  };
}


// ============================================================
// SAVE TARGET
// ============================================================

async function saveTarget(
  env: Env,
  target: Obj
): Promise<void> {

  const now =
    new Date()
      .toISOString();


  await env.DB
    .prepare(`
      INSERT INTO live_odds (
        event_id,
        match_name,
        minute,
        score,
        hunter_score,
        market,
        selection,
        over_odds,
        under_odds,
        source,
        created_at,
        updated_at
      )

      VALUES (
        ?1,
        ?2,
        ?3,
        ?4,
        ?5,
        '1H Total Goals',
        'Over 0.5',
        NULL,
        NULL,
        'TRACKER_MATCHER',
        ?6,
        ?6
      )

      ON CONFLICT(event_id)

      DO UPDATE SET

        match_name =
          excluded.match_name,

        minute =
          excluded.minute,

        score =
          excluded.score,

        hunter_score =
          excluded.hunter_score
    `)

    .bind(

      target.eventId,

      target.matchName ||
        null,

      target.minute,

      target.score ||
        null,

      target.hunterScore,

      now
    )

    .run();
}


// ============================================================
// GET STORED EVENT
// ============================================================

async function getStoredEvent(
  env: Env,
  eventId: string
): Promise<Obj | null> {

  return await env.DB
    .prepare(`
      SELECT *
      FROM live_odds
      WHERE event_id = ?1
      LIMIT 1
    `)

    .bind(
      eventId
    )

    .first();
}


// ============================================================
// BET STATUS TABLE
// ============================================================

async function ensureBetStatusTable(
  env: Env
): Promise<void> {

  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS bet_status (

        event_id TEXT PRIMARY KEY,

        status TEXT NOT NULL DEFAULT 'NONE',

        placed INTEGER NOT NULL DEFAULT 0,

        placed_at TEXT,

        updated_at TEXT
      )
    `)

    .run();
}


// ============================================================
// GET BET STATUS
// ============================================================

async function getBetStatus(
  env: Env,
  eventId: string
): Promise<Obj | null> {

  return await env.DB
    .prepare(`
      SELECT *
      FROM bet_status
      WHERE event_id = ?1
      LIMIT 1
    `)

    .bind(
      eventId
    )

    .first();
}


// ============================================================
// SANITIZE STORED ODDS
// ============================================================

function sanitizeStoredOdds(
  row: Obj | null
): Obj | null {

  if (
    !row
  ) {

    return null;
  }


  return {

    ...row,

    over_odds:
      validOdds(
        row
          ?.over_odds
      ),

    under_odds:
      validOdds(
        row
          ?.under_odds
      )
  };
}


// ============================================================
// SERVICE JSON
// ============================================================

async function fetchServiceJSON(
  service: Fetcher,
  path: string
): Promise<any> {

  const response =
    await service.fetch(

      new Request(

        "https://service" +
          path,

        {

          method:
            "GET",

          headers: {

            accept:
              "application/json"
          }
        }
      )
    );


  const responseText =
    await response
      .text();


  if (
    !response.ok
  ) {

    throw new Error(

      "SERVICE_HTTP_" +

      response.status +

      ": " +

      responseText
        .slice(
          0,
          300
        )
    );
  }


  try {

    return JSON.parse(
      responseText
    );

  } catch {

    throw new Error(

      "INVALID_SERVICE_JSON: " +

      responseText
        .slice(
          0,
          300
        )
    );
  }
}


// ============================================================
// TEAM NAME
// ============================================================

function extractTeamName(
  value: any
): string {

  if (
    value ===
      null ||

    value ===
      undefined
  ) {

    return "";
  }


  if (
    typeof value ===
      "string" ||

    typeof value ===
      "number"
  ) {

    return safe(
      value
    );
  }


  if (
    typeof value ===
      "object"
  ) {

    return safe(

      value?.name ??

      value?.team_name ??

      value?.title ??

      value?.shortName ??

      value?.short_name
    );
  }


  return "";
}


// ============================================================
// SPLIT MATCH
// ============================================================

function splitMatch(
  value: any
): {
  home: string;
  away: string;
} {

  const valueText =
    safe(
      value
    );


  if (
    !valueText
  ) {

    return {

      home:
        "",

      away:
        ""
    };
  }


  const separators = [

    " - ",

    " vs ",

    " v ",

    " @ ",

    " — ",

    " – ",

    " : "
  ];


  for (
    const separator
    of separators
  ) {

    const index =
      valueText
        .toLowerCase()
        .indexOf(
          separator
            .toLowerCase()
        );


    if (
      index >=
      0
    ) {

      return {

        home:
          valueText
            .slice(
              0,
              index
            )
            .trim(),

        away:
          valueText
            .slice(
              index +
              separator.length
            )
            .trim()
      };
    }
  }


  return {

    home:
      "",

    away:
      ""
  };
}


// ============================================================
// SCORE
// ============================================================

function scoreToString(
  value: any
): string | null {

  if (
    value ===
      null ||

    value ===
      undefined
  ) {

    return null;
  }


  if (
    typeof value ===
    "string"
  ) {

    return (
      value.trim() ||
      null
    );
  }


  if (
    Array.isArray(
      value
    ) &&

    value.length >=
      2
  ) {

    return (

      String(
        value[0]
      ) +

      ":" +

      String(
        value[1]
      )
    );
  }


  if (
    typeof value ===
    "object"
  ) {

    const home =

      value?.home ??

      value?.homeScore ??

      value?.home_score;


    const away =

      value?.away ??

      value?.awayScore ??

      value?.away_score;


    if (
      home !==
        undefined &&

      away !==
        undefined
    ) {

      return (

        String(
          home
        ) +

        ":" +

        String(
          away
        )
      );
    }
  }


  return null;
}


// ============================================================
// SAFE STRING
// ============================================================

function safe(
  value: any
): string {

  if (
    value ===
      null ||

    value ===
      undefined
  ) {

    return "";
  }


  return String(
    value
  ).trim();
}


// ============================================================
// NUMBER
// ============================================================

function numberOrNull(
  value: any
): number | null {

  if (
    value ===
      null ||

    value ===
      undefined ||

    value ===
      ""
  ) {

    return null;
  }


  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )

    ? number

    : null;
}


// ============================================================
// VALID ODDS
// ============================================================

function validOdds(
  value: any
): number | null {

  const number =
    numberOrNull(
      value
    );


  if (
    number ===
      null ||

    number <=
      1 ||

    number >
      50
  ) {

    return null;
  }


  return number;
}


// ============================================================
// CORS
// ============================================================

function corsHeaders() {

  return {

    "access-control-allow-origin":
      "*",

    "access-control-allow-methods":
      "GET,POST,OPTIONS",

    "access-control-allow-headers":
      "content-type"
  };
}


// ============================================================
// JSON
// ============================================================

function json(
  data: any,
  status = 200
): Response {

  return new Response(

    JSON.stringify(
      data,
      null,
      2
    ),

    {

      status,

      headers: {

        "content-type":
          "application/json; charset=UTF-8",

        "cache-control":
          "no-store",

        ...corsHeaders()
      }
    }
  );
}


// ============================================================
// DASHBOARD
// ============================================================

function renderHtml():
  string {

  return `<!DOCTYPE html>

<html lang="bg">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
Top Signal Control
</title>


<style>

* {

  box-sizing:
    border-box;
}


body {

  margin:
    0;

  background:
    #0b0e13;

  color:
    #ffffff;

  font-family:
    Arial,
    Helvetica,
    sans-serif;
}


.app {

  max-width:
    760px;

  margin:
    0 auto;

  padding:
    16px;
}


.title {

  font-size:
    25px;

  font-weight:
    900;
}


.subtitle {

  margin-top:
    6px;

  color:
    #8d96a5;

  font-size:
    11px;

  line-height:
    1.5;
}


.summary {

  margin-top:
    16px;

  display:
    grid;

  grid-template-columns:
    repeat(
      4,
      1fr
    );

  gap:
    8px;
}


.sum {

  background:
    #151a22;

  border:
    1px solid
    #252c38;

  border-radius:
    13px;

  padding:
    12px 8px;

  text-align:
    center;
}


.sum .v {

  font-size:
    22px;

  font-weight:
    900;
}


.sum .l {

  margin-top:
    3px;

  font-size:
    9px;

  color:
    #8d96a5;
}


.stats {

  margin-top:
    10px;

  color:
    #7d8797;

  font-size:
    11px;

  line-height:
    1.5;
}


.card {

  margin-top:
    14px;

  padding:
    16px;

  background:
    #151a22;

  border:
    1px solid
    #252c38;

  border-radius:
    16px;
}


.card.placed {

  border-color:
    #166534;
}


.match {

  font-size:
    18px;

  font-weight:
    900;

  line-height:
    1.3;
}


.event {

  margin-top:
    6px;

  color:
    #7d8797;

  font-size:
    10px;

  word-break:
    break-all;
}


.meta {

  display:
    flex;

  flex-wrap:
    wrap;

  gap:
    6px;

  margin-top:
    10px;
}


.badge {

  padding:
    6px 8px;

  background:
    #202632;

  border-radius:
    8px;

  color:
    #c5ccd8;

  font-size:
    11px;
}


.market {

  margin-top:
    16px;

  color:
    #8d96a5;

  font-size:
    10px;
}


.oddsline {

  display:
    flex;

  align-items:
    center;

  justify-content:
    space-between;

  gap:
    10px;

  margin-top:
    4px;
}


.odds {

  font-size:
    38px;

  font-weight:
    900;
}


.placedText {

  font-size:
    29px;

  color:
    #86efac;
}


.state {

  font-size:
    10px;

  text-align:
    right;

  line-height:
    1.4;
}


.ready {

  color:
    #86efac;
}


.waiting {

  color:
    #fbbf24;
}


.placedState {

  color:
    #86efac;
}


.actions {

  display:
    grid;

  grid-template-columns:
    1fr 1fr;

  gap:
    8px;

  margin-top:
    14px;
}


.btn {

  border:
    0;

  border-radius:
    11px;

  padding:
    13px 10px;

  font-size:
    12px;

  font-weight:
    900;

  cursor:
    pointer;
}


.check {

  background:
    #2563eb;

  color:
    white;
}


.bet {

  background:
    #16a34a;

  color:
    white;
}


.btn[disabled] {

  background:
    #26303c;

  color:
    #788393;

  cursor:
    not-allowed;
}


.copy {

  margin-top:
    8px;

  width:
    100%;

  background:
    #202632;

  color:
    #cbd5e1;

  border:
    1px solid
    #303947;
}


.empty {

  margin-top:
    18px;

  padding:
    28px 20px;

  background:
    #151a22;

  border:
    1px solid
    #252c38;

  border-radius:
    16px;

  text-align:
    center;

  color:
    #9aa4b3;

  font-size:
    13px;

  line-height:
    1.8;
}


.footer {

  margin-top:
    20px;

  text-align:
    center;

  color:
    #596273;

  font-size:
    9px;

  line-height:
    1.5;
}


.err {

  color:
    #fca5a5;
}


.small {

  font-size:
    9px;

  color:
    #697281;

  margin-top:
    8px;

  line-height:
    1.5;
}


@media (
  max-width:
  430px
) {

  .app {

    padding:
      12px;
  }


  .title {

    font-size:
      22px;
  }


  .odds {

    font-size:
      34px;
  }


  .placedText {

    font-size:
      25px;
  }


  .summary {

    grid-template-columns:
      repeat(
        2,
        1fr
      );

    gap:
      6px;
  }


  .sum {

    padding:
      10px 6px;
  }


  .actions {

    grid-template-columns:
      1fr;
  }
}

</style>

</head>


<body>

<div class="app">


  <div class="title">

    ⚡ TOP SIGNAL MANUAL

  </div>


  <div class="subtitle">

    V1.9.0 BET STATUS

    · TRACKER → MATCHER → SELECT MATCH

    → CHECK ODDS / BET NOW

  </div>


  <div class="summary">


    <div class="sum">

      <div
        id="sumTargets"
        class="v"
      >
        0
      </div>

      <div class="l">

        TARGETS

      </div>

    </div>


    <div class="sum">

      <div
        id="sumReady"
        class="v"
      >
        0
      </div>

      <div class="l">

        ODDS READY

      </div>

    </div>


    <div class="sum">

      <div
        id="sumPlaced"
        class="v"
      >
        0
      </div>

      <div class="l">

        PLACED

      </div>

    </div>


    <div class="sum">

      <div
        id="sumBest"
        class="v"
      >
        —
      </div>

      <div class="l">

        BEST O0.5

      </div>

    </div>


  </div>


  <div
    id="stats"
    class="stats"
  >

    Loading...

  </div>


  <div id="list">
  </div>


  <div class="footer">

    CHECK READS REAL 1H O0.5 ODDS

    · BET NOW OPENS ONLY THE SELECTED EVENT

    · FINAL BET CONFIRMATION IS MANUAL

  </div>


</div>


<script>

const CLOUDBET_ORIGIN =
  'https://www.cloud0007.com';


const REFRESH_MS =
  3000;


// ==========================================================
// HTML ESCAPE
// ==========================================================

function esc(v) {

  return String(
    v ?? ''
  ).replace(

    /[&<>"']/g,

    c => ({

      '&':
        '&amp;',

      '<':
        '&lt;',

      '>':
        '&gt;',

      '"':
        '&quot;',

      "'":
        '&#39;'

    }[c])
  );
}


// ==========================================================
// NUMBER
// ==========================================================

function num(v) {

  if (
    v ===
      null ||

    v ===
      undefined ||

    v ===
      ''
  ) {

    return null;
  }


  const x =
    Number(v);


  return Number
    .isFinite(x)

      ? x

      : null;
}


// ==========================================================
// VALID ODDS
// ==========================================================

function validOdds(v) {

  const x =
    num(v);


  if (
    x ===
      null ||

    x <=
      1 ||

    x >
      50
  ) {

    return null;
  }


  return x;
}


// ==========================================================
// EVENT URL
// ==========================================================

function eventUrl(
  target,
  action
) {

  const id =
    String(
      target?.eventId ??
      ''
    )
      .trim();


  const u =
    new URL(

      CLOUDBET_ORIGIN +

      '/en/sports/soccer/live/' +

      encodeURIComponent(
        id
      )
    );


  u.searchParams.set(
    'markets-tab',
    'goals'
  );


  u.searchParams.set(
    'ts-action',
    action
  );


  u.searchParams.set(
    'ts-event',
    id
  );


  return u.href;
}


// ==========================================================
// OPEN EVENT
// ==========================================================

function go(
  target,
  action
) {

  if (
    !target?.eventId
  ) {

    return;
  }


  if (
    target?.betPlaced ===
    true
  ) {

    return;
  }


  location.href =
    eventUrl(
      target,
      action
    );
}


// ==========================================================
// COPY EVENT ID
// ==========================================================

async function copyId(
  id
) {

  try {

    await navigator
      .clipboard
      .writeText(
        String(id)
      );

  } catch {

    const ta =
      document
        .createElement(
          'textarea'
        );


    ta.value =
      String(id);


    document.body
      .appendChild(
        ta
      );


    ta.select();


    document
      .execCommand(
        'copy'
      );


    ta.remove();
  }
}


// ==========================================================
// CARD
// ==========================================================

function card(t) {

  const odds =
    validOdds(
      t?.overOdds
    );


  const placed =
    t?.betPlaced ===
    true;


  const ready =
    !placed &&
    odds !==
      null;


  const match =
    esc(

      t?.matchName ||

      t?.cloudbetMatch ||

      'Hunter target'
    );


  const eventId =
    esc(
      t?.eventId ||
      ''
    );


  const minute =

    t?.minute !==
      null &&

    t?.minute !==
      undefined

      ? esc(
          t.minute
        ) + "'"

      : '—';


  const hunter =

    t?.hunterScore !==
      null &&

    t?.hunterScore !==
      undefined

      ? esc(
          t.hunterScore
        )

      : '—';


  const matcher =

    t?.matcherScore !==
      null &&

    t?.matcherScore !==
      undefined

      ? esc(
          t.matcherScore
        )

      : '—';


  const score =
    esc(
      t?.score ||
      '—'
    );


  const placedAt =
    t?.betPlacedAt
      ? esc(
          t.betPlacedAt
        )
      : '';


  return (

    '<div class="card ' +

      (
        placed
          ? 'placed'
          : ''
      ) +

    '">' +


      '<div class="match">' +

        match +

      '</div>' +


      '<div class="event">' +

        'Cloudbet Event ID: ' +

        eventId +

      '</div>' +


      '<div class="meta">' +


        '<div class="badge">' +

          '⏱ ' +

          minute +

        '</div>' +


        '<div class="badge">' +

          '🎯 Hunter ' +

          hunter +

        '</div>' +


        '<div class="badge">' +

          '🔗 Matcher ' +

          matcher +

        '</div>' +


        '<div class="badge">' +

          '⚽ ' +

          score +

        '</div>' +


      '</div>' +


      '<div class="market">' +

        '1H TOTAL GOALS · OVER 0.5' +

      '</div>' +


      '<div class="oddsline">' +


        '<div class="odds ' +

          (
            placed
              ? 'placedText'
              : ''
          ) +

        '">' +

          (
            placed

              ? 'ЗАЛОЖЕН ✅'

              : ready

                ? '@ ' +
                  odds.toFixed(
                    2
                  )

                : '@ —'
          ) +

        '</div>' +


        '<div class="state ' +

          (
            placed

              ? 'placedState'

              : ready

                ? 'ready'

                : 'waiting'
          ) +

        '">' +

          (
            placed

              ? 'BET PLACED ✅'

              : ready

                ? 'ODDS READY ✅'

                : 'WAITING FOR CHECK ⏳'
          ) +

        '</div>' +


      '</div>' +


      (
        placedAt

          ? '<div class="small">' +
              'Placed: ' +
              placedAt +
            '</div>'

          : ''
      ) +


      '<div class="actions">' +


        '<button ' +

          'class="btn check" ' +

          'data-action="check" ' +

          'data-id="' +
            eventId +
          '" ' +

          (
            placed
              ? 'disabled'
              : ''
          ) +

        '>' +

          (
            placed

              ? 'CHECKED ✅'

              : 'CHECK ODDS'
          ) +

        '</button>' +


        '<button ' +

          'class="btn bet" ' +

          'data-action="bet" ' +

          'data-id="' +
            eventId +
          '" ' +

          (
            placed ||
            !ready

              ? 'disabled'

              : ''
          ) +

        '>' +

          (
            placed

              ? 'ЗАЛОЖЕН ✅'

              : 'BET NOW'
          ) +

        '</button>' +


      '</div>' +


      '<button ' +

        'class="btn copy" ' +

        'data-action="copy" ' +

        'data-id="' +
          eventId +
        '">' +

        'COPY EVENT ID' +

      '</button>' +


      '<div class="small">' +

        (
          placed

            ? 'Този Event ID вече е маркиран като BET_PLACED. ' +
              'BET NOW е заключен срещу повторно действие.'

            : 'CHECK ODDS → чете реалния 1H O0.5 коефициент.<br>' +
              'BET NOW → отваря точния мач и подготвя избора. ' +
              'След успешно ръчно потвърждение статусът става ЗАЛОЖЕН ✅.'
        ) +

      '</div>' +


    '</div>'
  );
}


// ==========================================================
// STATE
// ==========================================================

let latestTargets =
  [];


// ==========================================================
// REFRESH
// ==========================================================

async function refresh() {

  try {

    const r =
      await fetch(

        '/api/targets?ts=' +
          Date.now(),

        {

          cache:
            'no-store'
        }
      );


    const d =
      await r
        .json();


    if (
      !r.ok ||
      !d?.success
    ) {

      throw new Error(

        d?.error ||

        (
          'HTTP ' +
          r.status
        )
      );
    }


    latestTargets =

      Array.isArray(
        d.targets
      )

        ? d.targets

        : [];


    const placed =
      latestTargets
        .filter(
          x =>
            x?.betPlaced ===
            true
        );


    const ready =
      latestTargets
        .filter(
          x =>
            x?.betPlaced !==
              true &&

            validOdds(
              x?.overOdds
            ) !==
              null
        );


    const best =

      ready

        .map(
          x =>
            validOdds(
              x?.overOdds
            )
        )

        .filter(
          x =>
            x !==
            null
        )

        .sort(
          (
            a,
            b
          ) =>
            b - a
        )[0] ??

      null;


    document
      .getElementById(
        'sumTargets'
      )
      .textContent =
        String(
          latestTargets
            .length
        );


    document
      .getElementById(
        'sumReady'
      )
      .textContent =
        String(
          ready.length
        );


    document
      .getElementById(
        'sumPlaced'
      )
      .textContent =
        String(
          placed.length
        );


    document
      .getElementById(
        'sumBest'
      )
      .textContent =

        best ===
          null

          ? '—'

          : best
              .toFixed(
                2
              );


    document
      .getElementById(
        'stats'
      )
      .textContent =

        'Tracker ' +

        (
          d.tracker_signals ??
          0
        ) +

        ' · Matcher Hunter ' +

        (
          d.matcher_hunter_results ??
          0
        ) +

        ' · Secure ' +

        latestTargets.length +

        ' · Ready ' +

        ready.length +

        ' · Placed ' +

        placed.length +

        ' · refresh 3s';


    document
      .getElementById(
        'list'
      )
      .innerHTML =

        latestTargets.length

          ? latestTargets
              .map(
                card
              )
              .join('')

          : (

            '<div class="empty">' +

              'Няма активен secure Hunter target.<br>' +

              'Чакаме нов сигнал.' +

            '</div>'
          );


  } catch (
    e
  ) {

    document
      .getElementById(
        'stats'
      )
      .innerHTML =

        '<span class="err">' +

        'CONNECTION ERROR: ' +

        esc(
          e?.message ||
          e
        ) +

        '</span>';
  }
}


// ==========================================================
// BUTTONS
// ==========================================================

document
  .addEventListener(

    'click',

    e => {

      const b =
        e.target
          .closest(
            '[data-action]'
          );


      if (
        !b
      ) {

        return;
      }


      if (
        b.disabled
      ) {

        return;
      }


      const id =
        b.getAttribute(
          'data-id'
        );


      const action =
        b.getAttribute(
          'data-action'
        );


      const target =
        latestTargets
          .find(
            x =>
              String(
                x?.eventId
              ) ===
              String(
                id
              )
          );


      if (
        action ===
        'copy'
      ) {

        copyId(
          id
        );

        return;
      }


      if (
        !target
      ) {

        return;
      }


      if (
        target?.betPlaced ===
        true
      ) {

        return;
      }


      if (
        action ===
        'check'
      ) {

        go(
          target,
          'check'
        );

        return;
      }


      if (
        action ===
        'bet'
      ) {

        const odds =
          validOdds(
            target
              ?.overOdds
          );


        if (
          odds ===
          null
        ) {

          return;
        }


        go(
          target,
          'bet'
        );
      }
    }
  );


// ==========================================================
// START
// ==========================================================

refresh();


setInterval(
  refresh,
  REFRESH_MS
);

</script>


</body>

</html>`;
}
