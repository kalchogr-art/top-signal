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
  "V1.9.4 TRACKER 1-TO-1";

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
    // BET ARCHIVE — ONLY CONFIRMED BET_PLACED EVENTS
    // Result is resolved from Tracker when GOAL / NO_GOAL is available.
    // ========================================================

    if (
      url.pathname === "/api/archive" &&
      request.method === "GET"
    ) {
      try {
        await ensureBetStatusTable(env);

        const rowsResult =
          await env.DB.prepare(`
            SELECT
              b.event_id,
              b.status AS bet_status,
              b.placed,
              b.placed_at,
              l.match_name,
              l.minute,
              l.over_odds,
              l.score
            FROM bet_status b
            LEFT JOIN live_odds l
              ON l.event_id = b.event_id
            WHERE b.placed = 1
            ORDER BY b.placed_at DESC
            LIMIT 500
          `).all();

        const rows =
          Array.isArray(rowsResult?.results)
            ? rowsResult.results
            : [];

        let trackerRaw: any[] = [];

        try {
          const trackerData =
            await fetchServiceJSON(env.TRACKER, "/entries");

          trackerRaw =
            Array.isArray(trackerData)
              ? trackerData
              : Array.isArray(trackerData?.hunter_entries)
                ? trackerData.hunter_entries
                : Array.isArray(trackerData?.entries)
                  ? trackerData.entries
                  : Array.isArray(trackerData?.signals)
                    ? trackerData.signals
                    : Array.isArray(trackerData?.data)
                      ? trackerData.data
                      : [];
        } catch {}

        const norm = (v: any) =>
          safe(v)
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();

        const archive =
          rows.map((row: Obj) => {
            const rowName = norm(row?.match_name);

            const tr =
              trackerRaw.find((x: Obj) => {
                const cloudbet =
                  x?.cloudbet ??
                  x?.tracker_cloudbet ??
                  {};

                const eventId =
                  safe(
                    x?.cloudbet_event_id ??
                    x?.event_id ??
                    cloudbet?.event_id ??
                    cloudbet?.id
                  ).replace(/\.0+$/, "");

                if (
                  eventId &&
                  eventId === safe(row?.event_id)
                ) {
                  return true;
                }

                const trackerName =
                  norm(
                    x?.match_name ??
                    x?.match ??
                    cloudbet?.match
                  );

                return (
                  !!rowName &&
                  !!trackerName &&
                  rowName === trackerName
                );
              }) ?? null;

            const trackerStatus =
              safe(
                tr?.status ??
                tr?.result ??
                tr?.bet_result
              ).toUpperCase();

            let resultStatus = "WAITING";

            if (
              trackerStatus === "GOAL" ||
              trackerStatus === "WIN" ||
              trackerStatus === "WON"
            ) {
              resultStatus = "WIN";
            } else if (
              trackerStatus === "NO_GOAL" ||
              trackerStatus === "LOSS" ||
              trackerStatus === "LOST"
            ) {
              resultStatus = "LOSS";
            }

            return {
              eventId: row?.event_id ?? null,
              matchName: row?.match_name ?? "—",
              entryMinute:
                tr?.entry_minute ??
                tr?.entryMinute ??
                tr?.signal?.entry_minute ??
                tr?.signal?.entryMinute ??
                null,
              liveMinute: row?.minute ?? null,
              minute: row?.minute ?? null,
              odds: validOdds(row?.over_odds),
              placedAt: row?.placed_at ?? null,
              resultStatus,
              trackerStatus: trackerStatus || null
            };
          });

        return json({
          success: true,
          // Active signal count comes from /api/targets (Tracker), not D1.
          today_signals: null,
          archive
        });

      } catch (error: any) {
        return json({
          success: false,
          today_signals: 0,
          archive: [],
          error: error?.message ?? String(error)
        }, 500);
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


  // ========================================================
  // CURRENT TRACKER ENTRIES — DIRECT SOURCE
  // ========================================================

  const rawEntries =
    Array.isArray(
      trackerData
    )
      ? trackerData

      : Array.isArray(
          trackerData?.hunter_entries
        )
        ? trackerData.hunter_entries

        : Array.isArray(
            trackerData?.entries
          )
          ? trackerData.entries

          : Array.isArray(
              trackerData?.signals
            )
            ? trackerData.signals

            : Array.isArray(
                trackerData?.data
              )
              ? trackerData.data

              : [];


  // ========================================================
  // V1.9.4 — TRACKER IS THE SINGLE SOURCE OF TRUTH
  //
  // No D1 row is allowed to create an active Dashboard signal.
  // No Matcher rematch is allowed to create an active Dashboard signal.
  // Every current Tracker entry is handled 1-to-1 here.
  // ========================================================

  const trackerSignals =
    rawEntries.filter(
      (item: Obj) => {
        const status =
          safe(item?.status).toUpperCase();

        const type =
          safe(
            item?.type ??
            (typeof item?.signal === "string" ? item.signal : "") ??
            item?.event_type
          ).toUpperCase();

        const action =
          safe(item?.action).toUpperCase();

        // /entries is already the Tracker's current-entry endpoint.
        // Keep current TRACKING entries and explicit HUNTER_ENTRY/ENTRY records.
        return (
          status === "TRACKING" ||
          type === "HUNTER_ENTRY" ||
          action === "ENTRY"
        );
      }
    );


  const targets:
    Obj[] = [];


  // ========================================================
  // TRACKER -> TARGET DIRECT
  //
  // Current Tracker already carries the Cloudbet match result
  // and BET READY state. We do NOT rematch the same signal here.
  // ========================================================

  for (
    const item
    of trackerSignals
  ) {

    const cloudbet =
      item?.cloudbet ??
      item?.tracker_cloudbet ??
      {};


    const eventId =
      safe(
        item?.cloudbet_event_id ??
        item?.event_id ??
        cloudbet?.event_id ??
        cloudbet?.id
      )
        .replace(
          /\.0+$/,
          ""
        );


    if (
      !eventId
    ) {
      continue;
    }


    const betReady =
      item?.bet_ready === true ||
      item?.ready === true ||
      cloudbet?.bet_ready === true ||
      cloudbet?.ready === true ||
      safe(item?.bet_status).toUpperCase() === "READY_TO_BET" ||
      safe(item?.bet_status).toUpperCase() === "BET_READY" ||
      safe(cloudbet?.bet_status).toUpperCase() === "READY_TO_BET" ||
      safe(cloudbet?.bet_status).toUpperCase() === "BET_READY" ||
      safe(item?.bet_ready).toLowerCase() === "true" ||
      safe(cloudbet?.bet_ready).toLowerCase() === "true";


    const matchName =
      safe(
        item?.match_name ??
        item?.match ??
        cloudbet?.match
      );


    const split =
      splitMatch(
        matchName
      );


    const entryMinute =
      numberOrNull(
        item?.entry_minute ??
        item?.entryMinute ??
        item?.signal?.entry_minute ??
        item?.signal?.entryMinute
      );

    const liveMinute =
      numberOrNull(
        item?.live_minute ??
        item?.liveMinute ??
        item?.current_minute ??
        item?.currentMinute ??
        cloudbet?.minute ??
        cloudbet?.live_minute ??
        item?.minute
      );

    const target: Obj = {

      eventId,

      signalId:
        item?.id ??
        null,

      matchId:
        item?.match_id ??
        item?.matchId ??
        null,

      matchName,

      league:
        safe(
          item?.league ??
          item?.competition ??
          cloudbet?.competition?.name ??
          cloudbet?.competition
        ),

      home:
        extractTeamName(item?.home) ||
        extractTeamName(cloudbet?.home) ||
        split.home,

      away:
        extractTeamName(item?.away) ||
        extractTeamName(cloudbet?.away) ||
        split.away,

      // IMPORTANT:
      // entryMinute = minute when Hunter created the signal.
      // minute/liveMinute = current Tracker/Cloudbet live minute.
      entryMinute,

      liveMinute,

      minute:
        liveMinute,

      score:
        scoreToString(item?.score) ||
        scoreToString(cloudbet?.score) ||
        "0:0",

      hunterScore:
        numberOrNull(
          item?.hunter_score ??
          item?.goal_signal?.score ??
          item?.signal?.hunter_score
        ),

      cloudbetMatch:
        safe(
          cloudbet?.match ??
          item?.cloudbet_match
        ),

      cloudbetHome:
        extractTeamName(cloudbet?.home),

      cloudbetAway:
        extractTeamName(cloudbet?.away),

      classification:
        item?.classification ??
        item?.matcher_classification ??
        "TRACKER_DIRECT",

      secureMatch:
        item?.secure_match === true ||
        item?.security?.secure_match === true ||
        !!eventId,

      matcherScore:
        numberOrNull(
          item?.matcher_score ??
          item?.matcherScore ??
          item?.ai_match_score ??
          item?.cloudbet_match_score
        )
    };


    // --------------------------------------------------------
    // SAVE BASIC TARGET DATA — SAME OLD V1.9.0 FUNCTION
    // --------------------------------------------------------

    await saveTarget(
      env,
      target
    );


    // --------------------------------------------------------
    // LOAD STORED FRONTEND ODDS — SAME OLD V1.9.0 LOGIC
    // --------------------------------------------------------

    const stored =
      await getStoredEvent(
        env,
        target.eventId
      );


    const trackerOdds =
      validOdds(
        item?.current_odds ??
        item?.currentOdds ??
        item?.entry_odds ??
        item?.entryOdds ??
        item?.odds ??
        item?.cloudbet_odds ??
        item?.bet?.current_odds ??
        item?.bet?.entry_odds ??
        item?.bet_ready_data?.current_odds ??
        item?.bet_ready_data?.entry_odds ??
        cloudbet?.current_odds ??
        cloudbet?.currentOdds ??
        cloudbet?.entry_odds ??
        cloudbet?.entryOdds ??
        cloudbet?.over_odds ??
        cloudbet?.odds?.over ??
        cloudbet?.odds
      );


    const storedOdds =
      validOdds(
        stored?.over_odds
      );


    const storedUnderOdds =
      validOdds(
        stored?.under_odds
      );


    // --------------------------------------------------------
    // LOAD BET STATUS — SAME OLD V1.9.0 LOGIC
    // --------------------------------------------------------

    const betStatus =
      await getBetStatus(
        env,
        target.eventId
      );


    const betPlaced =
      Number(
        betStatus?.placed ??
        0
      ) === 1;


    targets.push({

      ...target,

      overOdds:
        trackerOdds ??
        storedOdds,

      underOdds:
        storedUnderOdds,

      oddsUpdatedAt:
        stored?.updated_at ??
        item?.odds_updated_at ??
        null,

      oddsSource:
        trackerOdds !== null
          ? "TRACKER"
          : stored?.source ?? null,

      // Active rows come 1-to-1 from Tracker.
      // BET NOW is enabled only when this Tracker record itself is ready
      // or already carries a valid current/entry odd.
      ready:
        (
          betReady ||
          trackerOdds !== null
        ) &&
        (
          trackerOdds !== null ||
          storedOdds !== null
        ),

      betPlaced,

      betStatus:
        betStatus?.status ??
        null,

      betPlacedAt:
        betStatus?.placed_at ??
        null
    });
  }


  // ========================================================
  // NEWEST SIGNAL FIRST — SAME OLD V1.9.0
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
      trackerSignals.length,

    // Matcher is intentionally not called in the main target path.
    // Field remains for dashboard/API compatibility.
    matcherHunterResults:
      0,

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

      target.entryMinute,

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
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Top Signal</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0b0e13;color:#fff;font-family:Arial,Helvetica,sans-serif}
.app{max-width:900px;margin:0 auto;padding:12px}
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.title{font-size:18px;font-weight:900}
.count{font-size:14px;font-weight:900;color:#c4b5fd;white-space:nowrap}
.list{display:flex;flex-direction:column;gap:7px}
.row{display:grid;grid-template-columns:minmax(0,1fr) 48px 48px 62px 112px;align-items:center;gap:7px;background:#151a22;border:1px solid #252c38;border-radius:10px;padding:8px 9px;min-height:44px}
.row.placed{border-color:#166534}
.match{font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.minute,.odds{font-size:12px;text-align:center;color:#c5ccd8;white-space:nowrap}
.betbtn{border:0;border-radius:8px;padding:9px 6px;font-size:11px;font-weight:900;background:#16a34a;color:#fff;cursor:pointer;white-space:nowrap}
.betbtn[disabled]{background:#14532d;color:#86efac;cursor:default}
.empty{padding:18px 8px;text-align:center;color:#7d8797;font-size:12px}
.archive{margin-top:14px;border:1px solid #252c38;border-radius:10px;overflow:hidden;background:#11161e}
.archiveHead{width:100%;border:0;background:#171d27;color:#fff;padding:12px;text-align:left;font-size:13px;font-weight:900;cursor:pointer}
.archiveBody{display:none;padding:7px}
.archive.open .archiveBody{display:block}
.arow{display:grid;grid-template-columns:minmax(0,1fr) 48px 48px 62px 96px;align-items:center;gap:7px;padding:8px 4px;border-bottom:1px solid #222936}
.arow:last-child{border-bottom:0}
.result{font-size:11px;font-weight:900;text-align:right;white-space:nowrap}
.win{color:#4ade80}.loss{color:#f87171}.waiting{color:#facc15}
.note{margin-top:8px;color:#697386;font-size:9px;text-align:center}
@media(max-width:520px){
 .app{padding:8px}
 .row,.arow{grid-template-columns:minmax(0,1fr) 34px 34px 48px 88px;gap:4px}
 .match{font-size:11px}
 .minute,.odds{font-size:10px}
 .betbtn,.result{font-size:9px}
}
</style>
</head>
<body>
<div class="app">
  <div class="top">
    <div class="title">⚡ TOP SIGNAL</div>
    <div class="count">ДНЕШНИ СИГНАЛИ: <span id="todayCount">0</span></div>
  </div>

  <div id="list" class="list">
    <div class="empty">Зареждане...</div>
  </div>

  <div id="archive" class="archive">
    <button id="archiveToggle" class="archiveHead">▸ АРХИВ · <span id="archiveCount">0</span></button>
    <div id="archiveBody" class="archiveBody"></div>
  </div>

  <div class="note">BET PLACED се показва само след потвърден успешен залог.</div>
</div>

<script>
const REFRESH_MS=3000;
const CLOUDBET_ORIGIN='https://www.cloud0007.com';
let latestTargets=[];

function esc(v){
  return String(v??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}
function validOdds(v){
  const x=Number(v);
  return Number.isFinite(x)&&x>1&&x<=50?x:null;
}
function slugify(v){
  return String(v??'')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
}
function eventUrl(t){
  const id=String(t?.eventId??'').trim();
  const competition=slugify(t?.league||'');
  const path=competition
    ? '/en/sports/soccer/'+encodeURIComponent(competition)+'/'+encodeURIComponent(id)
    : '/en/sports/soccer/event/'+encodeURIComponent(id);
  const u=new URL(CLOUDBET_ORIGIN+path);
  u.searchParams.set('markets-tab','goals');
  return u.href;
}
function go(t){
  if(!t?.eventId||t?.betPlaced===true)return;
  // SAME TAB
  location.href=eventUrl(t);
}
function activeRow(t){
  const placed=t?.betPlaced===true;
  const odds=validOdds(t?.overOdds);
  const match=esc(t?.matchName||t?.cloudbetMatch||'Hunter target');
  const entryMinute=t?.entryMinute!=null?esc(t.entryMinute)+"'":'—';
  const liveMinute=t?.liveMinute!=null?esc(t.liveMinute)+"'":(t?.minute!=null?esc(t.minute)+"'":'—');
  const oddsText=odds!==null?'@'+odds.toFixed(2):'@—';
  const id=esc(t?.eventId||'');
  return '<div class="row '+(placed?'placed':'')+'">'+
    '<div class="match">'+match+'</div>'+
    '<div class="minute" title="ENTRY minute">📥 '+entryMinute+'</div>'+
    '<div class="minute" title="Live minute">⏱ '+liveMinute+'</div>'+
    '<div class="odds">'+oddsText+'</div>'+
    '<button class="betbtn" data-bet="'+id+'" '+((placed||odds===null)?'disabled':'')+'>'+
      (placed?'BET PLACED':'BET NOW')+
    '</button>'+
  '</div>';
}
function archiveRow(x){
  const match=esc(x?.matchName||'—');
  const entryMinute=x?.entryMinute!=null?esc(x.entryMinute)+"'":'—';
  const liveMinute=x?.liveMinute!=null?esc(x.liveMinute)+"'":'—';
  const odds=validOdds(x?.odds);
  const oddsText=odds!==null?'@'+odds.toFixed(2):'@—';
  const st=String(x?.resultStatus||'WAITING').toUpperCase();
  let cls='waiting',label='ЧАКА';
  if(st==='WIN'){cls='win';label='ПЕЧЕЛИ';}
  if(st==='LOSS'){cls='loss';label='НЕ ПЕЧЕЛИ';}
  return '<div class="arow">'+
    '<div class="match">'+match+'</div>'+
    '<div class="minute" title="ENTRY minute">📥 '+entryMinute+'</div>'+
    '<div class="minute" title="Last live minute">⏱ '+liveMinute+'</div>'+
    '<div class="odds">'+oddsText+'</div>'+
    '<div class="result '+cls+'">'+label+'</div>'+
  '</div>';
}
async function refresh(){
  try{
    const [tr,ar]=await Promise.all([
      fetch('/api/targets?ts='+Date.now(),{cache:'no-store'}),
      fetch('/api/archive?ts='+Date.now(),{cache:'no-store'})
    ]);
    const td=await tr.json();
    const ad=await ar.json();

    latestTargets=Array.isArray(td?.targets)?td.targets:[];
    document.getElementById('list').innerHTML=
      latestTargets.length
        ? latestTargets.map(activeRow).join('')
        : '<div class="empty">Няма активни сигнали.</div>';

    const archive=Array.isArray(ad?.archive)?ad.archive:[];
    document.getElementById('todayCount').textContent=String(latestTargets.length);
    document.getElementById('archiveCount').textContent=String(archive.length);
    document.getElementById('archiveBody').innerHTML=
      archive.length
        ? archive.map(archiveRow).join('')
        : '<div class="empty">Няма заложени мачове.</div>';
  }catch(e){}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-bet]');
  if(!b||b.disabled)return;
  const id=b.getAttribute('data-bet');
  const t=latestTargets.find(x=>String(x?.eventId)===String(id));
  if(t)go(t);
});
document.getElementById('archiveToggle').addEventListener('click',()=>{
  const a=document.getElementById('archive');
  a.classList.toggle('open');
  document.getElementById('archiveToggle').innerHTML=
    (a.classList.contains('open')?'▾':'▸')+
    ' АРХИВ · <span id="archiveCount">'+
    document.querySelectorAll('#archiveBody .arow').length+
    '</span>';
});
refresh();
setInterval(refresh,REFRESH_MS);
</script>
</body>
</html>`;
}
