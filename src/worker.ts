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
  "V1.9.14 LIVE SELECTION BUTTON";

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
    // V1.9.11 — BET HISTORY
    // Only confirmed BET_PLACED events from Top Signal D1.
    // Final football result comes from Tracker's persistent /history.
    // Matching priority: exact Cloudbet event_id, then exact normalized name.
    // ========================================================

    if (
      url.pathname === "/api/archive" &&
      request.method === "GET"
    ) {
      try {
        await ensureBetStatusTable(env);
        await ensureDailySignalsTable(env);

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
            LIMIT 1000
          `).all();

        const rows =
          Array.isArray(rowsResult?.results)
            ? rowsResult.results
            : [];

        let trackerHistory: any[] = [];

        try {
          const historyData =
            await fetchServiceJSON(
              env.TRACKER,
              "/history?days=120"
            );

          trackerHistory =
            Array.isArray(historyData)
              ? historyData
              : Array.isArray(historyData?.entries)
                ? historyData.entries
                : Array.isArray(historyData?.signals)
                  ? historyData.signals
                  : Array.isArray(historyData?.results)
                    ? historyData.results
                    : [];

        } catch (error) {
          console.error(
            "ARCHIVE /history ERROR",
            error
          );

          // Compatibility fallback while Tracker V6.7.10.16 is deploying.
          try {
            const entriesData =
              await fetchServiceJSON(
                env.TRACKER,
                "/entries"
              );

            trackerHistory =
              extractHunterSignals(
                entriesData
              );
          } catch {}
        }

        const norm = (v: any) =>
          safe(v)
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();

        const byEvent =
          new Map<string, Obj>();

        const byName =
          new Map<string, Obj>();

        for (const tr of trackerHistory) {
          const cloudbet =
            tr?.cloudbet ??
            tr?.tracker_cloudbet ??
            {};

          const eventId =
            safe(
              tr?.cloudbet_event_id ??
              tr?.event_id ??
              cloudbet?.event_id ??
              cloudbet?.id
            ).replace(/\.0+$/, "");

          if (eventId) {
            byEvent.set(
              eventId,
              tr
            );
          }

          const name =
            norm(
              tr?.match_name ??
              tr?.match ??
              cloudbet?.match
            );

          if (name) {
            byName.set(
              name,
              tr
            );
          }
        }

        const history =
          rows.map((row: Obj) => {
            const eventId =
              safe(row?.event_id)
                .replace(/\.0+$/, "");

            const rowName =
              norm(row?.match_name);

            const tr =
              byEvent.get(eventId) ??
              byName.get(rowName) ??
              null;

            const trackerStatus =
              safe(
                tr?.result ??
                tr?.status ??
                tr?.bet_result ??
                tr?.result_status ??
                tr?.final_result
              )
                .toUpperCase()
                .replace(/\s+/g, "_");

            let resultStatus =
              "WAITING";

            if (
              trackerStatus === "GOAL" ||
              trackerStatus === "GOAL_HIT" ||
              trackerStatus === "WIN" ||
              trackerStatus === "WON"
            ) {
              resultStatus = "GOAL";
            } else if (
              trackerStatus === "NO_GOAL" ||
              trackerStatus === "NOGOAL" ||
              trackerStatus === "LOSS" ||
              trackerStatus === "LOST"
            ) {
              resultStatus = "NO_GOAL";
            }

            const trackerOdds =
              validOdds(
                tr?.entry_odds ??
                tr?.cloudbet?.entry_odds
              );

            const storedOdds =
              validOdds(
                row?.over_odds
              );

            return {
              eventId:
                row?.event_id ?? null,

              matchName:
                tr?.match_name ??
                tr?.match ??
                row?.match_name ??
                "—",

              entryMinute:
                tr?.entry_minute ??
                tr?.entryMinute ??
                null,

              goalMinute:
                tr?.goal_minute ??
                tr?.goalMinute ??
                null,

              odds:
                trackerOdds ??
                storedOdds,

              placedAt:
                row?.placed_at ??
                null,

              resultStatus,

              trackerStatus:
                trackerStatus ||
                null,

              trackerFound:
                !!tr
            };
          });

        const sofiaDay = (iso: any) => {
          const d =
            iso
              ? new Date(iso)
              : null;

          if (
            !d ||
            Number.isNaN(d.getTime())
          ) {
            return "UNKNOWN";
          }

          const parts =
            new Intl.DateTimeFormat(
              "en-CA",
              {
                timeZone:
                  "Europe/Sofia",
                year:
                  "numeric",
                month:
                  "2-digit",
                day:
                  "2-digit"
              }
            ).formatToParts(d);

          const get =
            (type: string) =>
              parts.find(
                p => p.type === type
              )?.value ?? "";

          return (
            get("year") +
            "-" +
            get("month") +
            "-" +
            get("day")
          );
        };

        const todayKey =
          sofiaDay(
            new Date().toISOString()
          );

        const today =
          history.filter(
            item =>
              sofiaDay(
                item?.placedAt
              ) === todayKey
          );

        const older =
          history.filter(
            item =>
              sofiaDay(
                item?.placedAt
              ) !== todayKey
          );

        const groupsMap =
          new Map<string, Obj[]>();

        for (const item of older) {
          const day =
            sofiaDay(
              item?.placedAt
            );

          if (!groupsMap.has(day)) {
            groupsMap.set(
              day,
              []
            );
          }

          groupsMap
            .get(day)!
            .push(item);
        }

        const archiveDays =
          [...groupsMap.entries()]
            .map(
              ([date, items]) => ({
                date,
                count:
                  items.length,
                items
              })
            )
            .sort(
              (a, b) =>
                b.date.localeCompare(
                  a.date
                )
            );

        // V1.9.13 — authoritative daily BET READY count comes from
        // Tracker /today-stats, which uses the exact same population as /today.
        // If Tracker is temporarily unavailable, fall back to the existing D1 counter.
        const todaySignals =
          await getTrackerTodaySignalCount(env);

        return json({
          success: true,
          version:
            VERSION,
          today_signals:
            todaySignals,
          placed_today:
            today.length,
          today,
          archive:
            history,
          archive_days:
            archiveDays
        });

      } catch (error: any) {
        return json({
          success: false,
          today_signals: 0,
          placed_today: 0,
          today: [],
          archive: [],
          archive_days: [],
          error:
            error?.message ??
            String(error)
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
    // SERVER-SIDE BET PLACED HANDOFF
    // Done -> /?bet-placed=EVENT_ID
    // Worker writes D1 BEFORE returning the dashboard.
    // No browser POST / no CORS dependency.
    // ========================================================

    if (
      request.method === "GET" &&
      url.pathname === "/" &&
      url.searchParams.has("bet-placed")
    ) {

      const eventId =
        safe(
          url.searchParams.get(
            "bet-placed"
          )
        );

      if (!eventId) {
        return json(
          {
            success: false,
            version: VERSION,
            diagnostic: "BET_PLACED_HANDOFF",
            error: "MISSING_EVENT_ID"
          },
          400
        );
      }

      try {
        const saved =
          await saveBetPlacedServerSide(
            env,
            eventId
          );

        if (!saved?.success) {
          return json(
            {
              success: false,
              version: VERSION,
              action: "BET_PLACED_HANDOFF",
              eventId,
              error:
                saved?.error ??
                "BET_PLACED_SAVE_FAILED"
            },
            400
          );
        }

        // Successful D1 write -> remove one-shot handoff parameter
        // and return to the normal dashboard.
        const cleanUrl =
          new URL(
            request.url
          );

        cleanUrl.searchParams.delete(
          "bet-placed"
        );

        return Response.redirect(
          cleanUrl.toString(),
          302
        );

      } catch (error: any) {
        return json(
          {
            success: false,
            version: VERSION,
            action: "BET_PLACED_HANDOFF",
            eventId,
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

  await ensureDailySignalsTable(
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


  const trackerSignals =
    rawEntries.filter(
      (item: Obj) => {

        const type =
          safe(
            item?.type ??
            (
              typeof item?.signal === "string"
                ? item.signal
                : ""
            ) ??
            item?.event_type
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


        return (
          type === "HUNTER_ENTRY" ||
          (
            action === "ENTRY" &&
            status === "TRACKING"
          )
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
      safe(
        item?.bet_status
      )
        .toUpperCase() ===
        "READY_TO_BET" ||
      safe(
        item?.bet_ready
      )
        .toLowerCase() ===
        "true";


    // Keep only Tracker targets that are actually ready for betting.
    if (
      !betReady
    ) {
      continue;
    }


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


    const target: Obj = {

      eventId,

      signalId:
        item?.id ??
        null,

      matchId:
        item?.match_id ??
        null,

      matchName,

      home:
        extractTeamName(
          item?.home
        ) ||
        extractTeamName(
          cloudbet?.home
        ) ||
        split.home,

      away:
        extractTeamName(
          item?.away
        ) ||
        extractTeamName(
          cloudbet?.away
        ) ||
        split.away,

      minute:
        numberOrNull(
          item?.entry_minute ??
          item?.minute
        ),

      score:
        scoreToString(
          item?.score
        ) ||
        scoreToString(
          cloudbet?.score
        ) ||
        "0:0",

      hunterScore:
        numberOrNull(
          item?.hunter_score ??
          item?.goal_signal?.score
        ),

      cloudbetMatch:
        safe(
          cloudbet?.match ??
          item?.cloudbet_match
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
        item?.classification ??
        item?.matcher_classification ??
        "TRACKER_READY",

      secureMatch:
        item?.secure_match === true ||
        item?.security?.secure_match === true ||
        betReady,

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

    // V1.9.4: permanent daily counter source.
    // INSERT OR IGNORE means refreshes/retries never increase the count twice.
    await saveDailySignal(
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
        item?.entry_odds ??
        item?.odds ??
        item?.cloudbet_odds ??
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


    // --------------------------------------------------------
    // V1.9.14 — CURRENT LIVE SELECTION STATE
    // The dashboard button must never rely on stale stored entry odds.
    // --------------------------------------------------------

    const liveSelection =
      betPlaced
        ? {
            checked: true,
            enabled: false,
            status: "BET_PLACED",
            price: null,
            eventId: target.eventId
          }
        : await getLiveSelectionState(env, target);


    targets.push({

      ...target,

      overOdds:
        liveSelection?.enabled === true
          ? liveSelection?.price
          : trackerOdds ?? storedOdds,

      selectionStatus:
        liveSelection?.status ?? null,

      selectionEnabled:
        liveSelection?.enabled === true,

      selectionChecked:
        liveSelection?.checked === true,

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

      ready:
        betReady &&
        liveSelection?.enabled === true,

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
// V1.9.14 — LIVE CLOUDBET SELECTION CHECK FOR BET NOW BUTTON
// Reuses the existing MATCHER binding. A button is enabled ONLY when
// the exact current 1H Over 0.5 selection is confirmed ENABLED.
// ============================================================

async function getLiveSelectionState(
  env: Env,
  target: Obj
): Promise<Obj> {

  const signal = {
    type: "HUNTER_ENTRY",
    signal: "HUNTER_ENTRY",
    match: target?.matchName ?? "",
    match_id: target?.matchId ?? target?.signalId ?? null,
    home: target?.home ?? "",
    away: target?.away ?? "",
    entry_minute: numberOrNull(target?.entryMinute ?? target?.minute),
    current_minute: numberOrNull(target?.minute),
    hunter_score: numberOrNull(target?.hunterScore)
  };

  try {
    const data = await callMatcher(env, [signal]);
    const results = Array.isArray(data?.hunter_results)
      ? data.hunter_results
      : [];

    const result = results.find((x: Obj) =>
      safe(x?.signal?.match_id) === safe(signal.match_id)
    ) ?? results[0] ?? null;

    const foundEventId = safe(
      result?.cloudbet?.event_id ?? result?.cloudbet?.id
    ).replace(/\.0+$/, "");

    const expectedEventId = safe(target?.eventId).replace(/\.0+$/, "");
    const odds = result?.odds ?? null;
    const status = safe(
      odds?.selection_status ?? odds?.status
    ).toUpperCase();
    const price = validOdds(
      odds?.price ?? odds?.raw_price
    );

    const sameEvent =
      !!foundEventId &&
      !!expectedEventId &&
      foundEventId === expectedEventId;

    const enabled =
      sameEvent &&
      odds?.available === true &&
      price !== null &&
      status === "SELECTION_ENABLED";

    return {
      checked: true,
      enabled,
      status: status || "SELECTION_UNAVAILABLE",
      price: enabled ? price : null,
      eventId: foundEventId || null
    };

  } catch (error) {
    console.error("LIVE SELECTION CHECK ERROR", target?.eventId, error);
    return {
      checked: false,
      enabled: false,
      status: "SELECTION_CHECK_FAILED",
      price: null,
      eventId: null
    };
  }
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
// DAILY SIGNALS — PERSISTENT COUNTER
// ============================================================

async function ensureDailySignalsTable(
  env: Env
): Promise<void> {

  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS daily_signals (
        signal_key TEXT PRIMARY KEY,
        event_id TEXT,
        signal_id TEXT,
        match_id TEXT,
        match_name TEXT,
        entry_minute REAL,
        hunter_score REAL,
        first_seen_at TEXT NOT NULL
      )
    `)
    .run();

  await env.DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_daily_signals_first_seen
      ON daily_signals(first_seen_at)
    `)
    .run();
}


function dailySignalKey(
  target: Obj
): string {

  const signalId =
    safe(target?.signalId);

  if (signalId) {
    return "signal:" + signalId;
  }

  const matchId =
    safe(target?.matchId);

  if (matchId) {
    return "match:" + matchId;
  }

  const eventId =
    safe(target?.eventId);

  if (eventId) {
    return "event:" + eventId;
  }

  return "";
}


async function saveDailySignal(
  env: Env,
  target: Obj
): Promise<void> {

  const key =
    dailySignalKey(target);

  if (!key) {
    return;
  }

  const now =
    new Date().toISOString();

  await env.DB
    .prepare(`
      INSERT OR IGNORE INTO daily_signals (
        signal_key,
        event_id,
        signal_id,
        match_id,
        match_name,
        entry_minute,
        hunter_score,
        first_seen_at
      )
      VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
      )
    `)
    .bind(
      key,
      safe(target?.eventId) || null,
      safe(target?.signalId) || null,
      safe(target?.matchId) || null,
      safe(target?.matchName) || null,
      numberOrNull(target?.minute),
      numberOrNull(target?.hunterScore),
      now
    )
    .run();
}


// Backfill old V1.9.x rows so a signal seen earlier today
// does not disappear from the counter after deployment.
async function backfillDailySignalsFromLiveOdds(
  env: Env
): Promise<void> {

  try {
    await env.DB
      .prepare(`
        INSERT OR IGNORE INTO daily_signals (
          signal_key,
          event_id,
          signal_id,
          match_id,
          match_name,
          entry_minute,
          hunter_score,
          first_seen_at
        )
        SELECT
          'event:' || event_id,
          event_id,
          NULL,
          NULL,
          match_name,
          minute,
          hunter_score,
          created_at
        FROM live_odds
        WHERE event_id IS NOT NULL
          AND event_id <> ''
          AND created_at IS NOT NULL
          AND date(datetime(created_at, '+3 hours')) =
              date(datetime('now', '+3 hours'))
      `)
      .run();
  } catch {
    // Counter must not break the dashboard if an old DB schema is unusual.
  }
}


// ============================================================
// V1.9.13 — TRACKER TODAY COUNTER
// Uses Tracker /today-stats so dashboard "ОБЩО ВЪЗМОЖНИ ЗА ДНЕС"
// is identical to the ENTRY count used by Tracker /today.
// Falls back to the existing Top Signal D1 counter if needed.
// ============================================================

async function getTrackerTodaySignalCount(
  env: Env
): Promise<number> {

  try {
    const data =
      await fetchServiceJSON(
        env.TRACKER,
        "/today-stats"
      );

    const entry =
      Number(data?.entry);

    if (
      data?.success === true &&
      Number.isFinite(entry) &&
      entry >= 0
    ) {
      return entry;
    }
  } catch (error) {
    console.error(
      "TRACKER /today-stats ERROR — using D1 fallback",
      error
    );
  }

  await backfillDailySignalsFromLiveOdds(env);

  return await getTodaySignalCount(env);
}


async function getTodaySignalCount(
  env: Env
): Promise<number> {

  const row =
    await env.DB
      .prepare(`
        SELECT COUNT(*) AS n
        FROM daily_signals
        WHERE date(datetime(first_seen_at, '+3 hours')) =
              date(datetime('now', '+3 hours'))
      `)
      .first();

  return Number(row?.n ?? 0);
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


  // V1.9.7 — migrate older bet_status tables safely.
  // CREATE TABLE IF NOT EXISTS does not add columns to an existing table.
  const schema =
    await env.DB
      .prepare(
        "PRAGMA table_info(bet_status)"
      )
      .all();

  const columns =
    new Set(
      (schema?.results ?? [])
        .map(
          (row: any) =>
            String(
              row?.name ?? ""
            )
        )
    );

  if (!columns.has("placed")) {
    await env.DB
      .prepare(
        "ALTER TABLE bet_status ADD COLUMN placed INTEGER NOT NULL DEFAULT 0"
      )
      .run();
  }

  if (!columns.has("placed_at")) {
    await env.DB
      .prepare(
        "ALTER TABLE bet_status ADD COLUMN placed_at TEXT"
      )
      .run();
  }

  if (!columns.has("updated_at")) {
    await env.DB
      .prepare(
        "ALTER TABLE bet_status ADD COLUMN updated_at TEXT"
      )
      .run();
  }

}


// ============================================================
// SAVE BET PLACED — SERVER SIDE
// ============================================================

async function saveBetPlacedServerSide(
  env: Env,
  eventId: string
): Promise<Obj> {

  await ensureBetStatusTable(env);

  const storedEvent =
    await getStoredEvent(
      env,
      eventId
    );

  if (!storedEvent) {
    return {
      success: false,
      error: "EVENT_NOT_FOUND",
      eventId
    };
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
        created_at,
        updated_at
      )

      VALUES (
        ?1,
        'BET_PLACED',
        1,
        ?2,
        ?2,
        ?2
      )

      ON CONFLICT(event_id)

      DO UPDATE SET
        status = 'BET_PLACED',
        placed = 1,
        placed_at = COALESCE(
          bet_status.placed_at,
          excluded.placed_at
        ),
        updated_at = excluded.updated_at
    `)

    .bind(
      eventId,
      now
    )

    .run();

  return {
    success: true,
    eventId,
    data: await getBetStatus(
      env,
      eventId
    )
  };
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
.top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.title{font-size:18px;font-weight:900}
.count{font-size:14px;font-weight:900;color:#c4b5fd;white-space:nowrap}
.section{margin-top:14px;border:1px solid #252c38;border-radius:12px;overflow:hidden;background:#11161e}
.sectionHead{background:#171d27;padding:12px;font-size:13px;font-weight:900}
.list,.sectionBody{display:flex;flex-direction:column;gap:0}
.row{display:grid;grid-template-columns:minmax(0,1fr) 48px 48px 62px 112px;align-items:center;gap:7px;background:#151a22;border-bottom:1px solid #252c38;padding:9px;min-height:46px}
.row:last-child{border-bottom:0}
.row.placed{border-left:3px solid #16a34a}
.hrow{display:grid;grid-template-columns:minmax(0,1fr) 48px 48px 62px 86px;align-items:center;gap:7px;padding:9px;border-bottom:1px solid #222936}
.hrow:last-child{border-bottom:0}
.match{font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.minute,.odds{font-size:11px;text-align:center;color:#c5ccd8;white-space:nowrap}
.betbtn{border:0;border-radius:8px;padding:9px 6px;font-size:11px;font-weight:900;background:#16a34a;color:#fff;cursor:pointer;white-space:nowrap}
.betbtn[disabled]{background:#14532d;color:#86efac;cursor:default}
.empty{padding:18px 8px;text-align:center;color:#7d8797;font-size:12px}
.result{font-size:10px;font-weight:900;text-align:right;white-space:nowrap}
.goal{color:#4ade80}.nogoal{color:#f87171}.waiting{color:#facc15}
.day{border-top:1px solid #252c38}
.day:first-child{border-top:0}
.dayHead{width:100%;border:0;background:#141a23;color:#fff;padding:11px 12px;text-align:left;font-size:12px;font-weight:900;cursor:pointer}
.dayBody{display:none}
.day.open .dayBody{display:block}
.note{margin-top:8px;color:#697386;font-size:9px;text-align:center}
@media(max-width:520px){
 .app{padding:8px}
 .row{grid-template-columns:minmax(0,1fr) 34px 34px 46px 86px;gap:4px}
 .hrow{grid-template-columns:minmax(0,1fr) 34px 34px 46px 70px;gap:4px}
 .match{font-size:11px}
 .minute,.odds{font-size:9px}
 .betbtn,.result{font-size:9px}
}
</style>
</head>
<body>
<div class="app">
  <div class="top">
    <div class="title">⚡ TOP SIGNAL</div>
    <div class="count" style="text-align:right;line-height:1.45">
      <div>ОБЩО ВЪЗМОЖНИ ЗА ДНЕС: <span id="todayCount">0</span></div>
      <div>ЗАЛОЖЕНИ: <span id="topPlacedCount">0</span></div>
    </div>
  </div>

  <div class="section">
    <div class="sectionHead">⚡ АКТИВНИ СИГНАЛИ · <span id="activeCount">0</span></div>
    <div id="list" class="list"><div class="empty">Зареждане...</div></div>
  </div>

  <div class="section">
    <div class="sectionHead">📅 ДНЕС · <span id="placedTodayCount">0</span></div>
    <div id="todayBody" class="sectionBody"><div class="empty">Няма залози днес.</div></div>
  </div>

  <div class="section">
    <div class="sectionHead">🗂 АРХИВ · ПО ДНИ</div>
    <div id="archiveDays"><div class="empty">Няма архив.</div></div>
  </div>

  <div class="note">ДНЕС и АРХИВ съдържат само потвърдени BET PLACED залози.</div>
  <div class="note">TOP SIGNAL · ${VERSION}</div>
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
function eventUrl(t){
  const id=String(t?.eventId??'').trim();
  const u=new URL(CLOUDBET_ORIGIN+'/en/sports/soccer/live/'+encodeURIComponent(id));
  u.searchParams.set('markets-tab','goals');
  u.searchParams.set('ts-action','bet');
  u.searchParams.set('ts-event',id);
  return u.href;
}
function go(t){
  if(!t?.eventId||t?.betPlaced===true)return;
  location.href=eventUrl(t);
}
function activeRow(t){
  const placed=t?.betPlaced===true;
  const selectionEnabled=t?.selectionEnabled===true;
  const odds=validOdds(t?.overOdds);
  const match=esc(t?.matchName||t?.cloudbetMatch||'Hunter target');
  const entryMinute=t?.entryMinute!=null?esc(t.entryMinute)+"'":'—';
  const liveMinute=t?.minute!=null?esc(t.minute)+"'":'—';
  const oddsText=odds!==null?'@'+odds.toFixed(2):'@—';
  const id=esc(t?.eventId||'');
  return '<div class="row '+(placed?'placed':'')+'">'+
    '<div class="match">'+match+'</div>'+
    '<div class="minute" title="ENTRY minute">📥 '+entryMinute+'</div>'+
    '<div class="minute" title="Live minute">⏱ '+liveMinute+'</div>'+
    '<div class="odds">'+oddsText+'</div>'+
    '<button class="betbtn" data-bet="'+id+'" '+((placed||!selectionEnabled||odds===null)?'disabled':'')+'>'+
      (placed?'BET PLACED':(selectionEnabled&&odds!==null?'BET NOW':'DISABLED'))+
    '</button>'+
  '</div>';
}
function historyRow(x){
  const match=esc(x?.matchName||'—');
  const entry=x?.entryMinute!=null?esc(x.entryMinute)+"'":'—';
  const goal=x?.goalMinute!=null?esc(x.goalMinute)+"'":'—';
  const odds=validOdds(x?.odds);
  const oddsText=odds!==null?'@'+odds.toFixed(2):'@—';
  const st=String(x?.resultStatus||'WAITING').toUpperCase();
  let cls='waiting',label='ЧАКА';
  if(st==='GOAL'){cls='goal';label='GOAL';}
  if(st==='NO_GOAL'){cls='nogoal';label='NO GOAL';}
  return '<div class="hrow">'+
    '<div class="match">'+match+'</div>'+
    '<div class="minute" title="ENTRY">📥 '+entry+'</div>'+
    '<div class="minute" title="Goal minute">⚽ '+goal+'</div>'+
    '<div class="odds">'+oddsText+'</div>'+
    '<div class="result '+cls+'">'+label+'</div>'+
  '</div>';
}
function dayBlock(g,index){
  const date=esc(g?.date||'—');
  const items=Array.isArray(g?.items)?g.items:[];
  return '<div class="day" data-day="'+index+'">'+
    '<button class="dayHead" data-day-toggle="'+index+'">▸ '+date+' · '+items.length+' залога</button>'+
    '<div class="dayBody">'+(items.length?items.map(historyRow).join(''):'<div class="empty">Няма записи.</div>')+'</div>'+
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
    document.getElementById('activeCount').textContent=String(latestTargets.length);
    document.getElementById('list').innerHTML=
      latestTargets.length
        ? latestTargets.map(activeRow).join('')
        : '<div class="empty">Няма активни сигнали.</div>';

    const today=Array.isArray(ad?.today)?ad.today:[];
    document.getElementById('todayCount').textContent=String(ad?.today_signals??0);
    document.getElementById('topPlacedCount').textContent=String(today.length);
    document.getElementById('placedTodayCount').textContent=String(today.length);
    document.getElementById('todayBody').innerHTML=
      today.length
        ? today.map(historyRow).join('')
        : '<div class="empty">Няма потвърдени залози днес.</div>';

    const groups=Array.isArray(ad?.archive_days)?ad.archive_days:[];
    document.getElementById('archiveDays').innerHTML=
      groups.length
        ? groups.map(dayBlock).join('')
        : '<div class="empty">Няма по-стар архив.</div>';
  }catch(e){}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-bet]');
  if(b&&!b.disabled){
    const id=b.getAttribute('data-bet');
    const t=latestTargets.find(x=>String(x?.eventId)===String(id));
    if(t)go(t);
    return;
  }

  const d=e.target.closest('[data-day-toggle]');
  if(d){
    const idx=d.getAttribute('data-day-toggle');
    const box=document.querySelector('.day[data-day="'+idx+'"]');
    if(!box)return;
    box.classList.toggle('open');
    d.textContent=(box.classList.contains('open')?'▾ ':'▸ ')+d.textContent.slice(2);
  }
});
refresh();
setInterval(refresh,REFRESH_MS);
</script>
</body>
</html>`;
}
