// ============================================================
// TOP SIGNAL V2.0.0 — DAILY LOG
//
// TRACKER -> MATCHER -> DASHBOARD
// -> CHECK ODDS / BET NOW
//
// NEW V2.0.0:
// 1. COMPACT ACTIVE TARGET CARDS
// 2. DAILY MATCH LOG IN D1
// 3. COLLAPSED "ДНЕШНИ МАЧОВЕ" TAB
// 4. PLACED / NOT PLACED
// 5. GOAL HIT -> WIN
// 6. NO GOAL -> LOSS
// 7. DAILY SUMMARY:
//    ДНЕС
//    ЗАЛОЖЕНИ
//    ПЕЧЕЛИ
//    НЕ ПЕЧЕЛИ
//    НЕЗАЛОЖЕНИ
//    УСПЕХ
//
// SUCCESS RATE:
// WIN / (WIN + LOSS) * 100
//
// PENDING DOES NOT ENTER SUCCESS RATE.
//
// Keeps:
// - D1 live_odds
// - D1 bet_status
// - CHECK ODDS
// - BET NOW handoff
// - QUERY + HASH handoff
// - secure CONFIDENT_MATCH only
// - signal:"HUNTER_ENTRY" matcher fix
//
// IMPORTANT:
// - NO INVALID_SCORE LOGIC IN THIS VERSION
// - MONKEY LOGIC IS NOT CHANGED
// ============================================================

const VERSION =
  "V2.0.0 DAILY LOG";

const APP_NAME =
  "top-signal";

const TIME_ZONE =
  "Europe/Sofia";

type Obj =
  Record<string, any>;

interface Env {
  DB: D1Database;
  TRACKER: Fetcher;
  MATCHER: Fetcher;
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


    await ensureTables(
      env
    );


    // ========================================================
    // STATUS
    // ========================================================

    if (
      url.pathname ===
      "/api/status"
    ) {

      return json({
        success: true,

        worker:
          APP_NAME,

        version:
          VERSION,

        mode:
          "MANUAL_TARGET_CONTROL",

        betting:
          "FINAL_SUBMIT_DISABLED",

        storage:
          "D1",

        daily_log:
          true,

        timezone:
          TIME_ZONE,

        bindings: {

          DB:
            !!env.DB,

          TRACKER:
            !!env.TRACKER,

          MATCHER:
            !!env.MATCHER
        },

        flow:
          "TRACKER -> MATCHER -> TOP SIGNAL -> DAILY LOG"
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


        const allRecords =
          extractTrackerRecords(
            data
          );


        return json({
          success: true,

          raw_type:
            Array.isArray(data)
              ? "ARRAY"
              : typeof data,

          signals_found:
            signals.length,

          tracker_records:
            allRecords.length,

          signals,

          records:
            allRecords
        });

      } catch (
        error: any
      ) {

        return json(
          {
            success: false,

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
          success: true,

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
            success: false,

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
          success: true,

          found:
            !!target,

          target,

          stats: {

            tracker_signals:
              result.trackerSignals,

            matcher_hunter_results:
              result.matcherHunterResults,

            secure_targets:
              result.targets.length,

            placed:
              result.targets.filter(
                x =>
                  x.betPlaced
              ).length
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
            success: false,

            found: false,

            target: null,

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
          success: true,

          version:
            VERSION,

          count:
            result.targets.length,

          tracker_signals:
            result.trackerSignals,

          matcher_hunter_results:
            result.matcherHunterResults,

          placed:
            result.targets.filter(
              x =>
                x.betPlaced
            ).length,

          targets:
            result.targets
        });

      } catch (
        error: any
      ) {

        return json(
          {
            success: false,

            targets: [],

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // DAILY MATCHES
    // ========================================================

    if (
      url.pathname ===
        "/api/daily" &&
      request.method ===
        "GET"
    ) {

      try {

        // Try to sync latest Tracker result state
        // before returning daily list.
        await syncDailyFromTracker(
          env
        );


        const daily =
          await getDailyMatches(
            env
          );


        return json({
          success: true,

          version:
            VERSION,

          date:
            sofiaDate(),

          timezone:
            TIME_ZONE,

          summary:
            buildDailySummary(
              daily
            ),

          matches:
            daily
        });

      } catch (
        error: any
      ) {

        return json(
          {
            success: false,

            matches: [],

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
          await request.json<Obj>();


        const eventId =
          safe(
            body?.eventId
          );


        const overOdds =
          numberOrNull(
            body?.overOdds
          );


        const underOdds =
          numberOrNull(
            body?.underOdds
          );


        if (
          !eventId ||
          overOdds === null ||
          overOdds <= 1 ||
          overOdds > 50
        ) {

          return json(
            {
              success: false,

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


        // Also update today's permanent row.
        await env.DB
          .prepare(`
            UPDATE daily_matches

            SET
              found_odds =
                ?2,

              updated_at =
                ?3

            WHERE
              event_id =
                ?1
          `)

          .bind(
            eventId,
            overOdds,
            now
          )

          .run();


        const stored =
          await getStoredEvent(
            env,
            eventId
          );


        return json({
          success: true,

          action:
            "ODDS_SAVED",

          data:
            stored
        });

      } catch (
        error: any
      ) {

        return json(
          {
            success: false,

            error:
              error?.message ??
              String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // GET ODDS
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
            success: true,

            data:
              row ??
              null
          });
        }


        const row =
          await env.DB
            .prepare(`
              SELECT *
              FROM live_odds
              ORDER BY
                updated_at DESC
              LIMIT 1
            `)
            .first();


        return json({
          success: true,

          data:
            row ??
            null
        });

      } catch (
        error: any
      ) {

        return json(
          {
            success: false,

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

        const body =
          await request.json<Obj>();


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
            "PLACED"
        ) {

          return json(
            {
              success: false,

              error:
                "INVALID_BET_STATUS_PAYLOAD"
            },
            400
          );
        }


        const market =
          safe(
            body?.market
          ) ||
          "1st Half Total Goals";


        const selection =
          safe(
            body?.selection
          ) ||
          "O 0.5";


        const stake =
          numberOrNull(
            body?.stake
          );


        const odds =
          numberOrNull(
            body?.odds
          );


        const source =
          safe(
            body?.source
          ) ||
          "CLOUDBET_FRONTEND";


        const placedAt =
          safe(
            body?.placedAt
          ) ||
          new Date()
            .toISOString();


        const now =
          new Date()
            .toISOString();


        const storedTarget =
          await getStoredEvent(
            env,
            eventId
          );


        await env.DB
          .prepare(`
            INSERT INTO bet_status (
              event_id,
              match_name,
              status,
              market,
              selection,
              stake,
              odds,
              source,
              placed_at,
              created_at,
              updated_at
            )

            VALUES (
              ?1,
              ?2,
              'PLACED',
              ?3,
              ?4,
              ?5,
              ?6,
              ?7,
              ?8,
              ?9,
              ?9
            )

            ON CONFLICT(event_id)

            DO UPDATE SET

              match_name =
                COALESCE(
                  excluded.match_name,
                  bet_status.match_name
                ),

              status =
                'PLACED',

              market =
                excluded.market,

              selection =
                excluded.selection,

              stake =
                excluded.stake,

              odds =
                COALESCE(
                  excluded.odds,
                  bet_status.odds
                ),

              source =
                excluded.source,

              placed_at =
                excluded.placed_at,

              updated_at =
                excluded.updated_at
          `)

          .bind(
            eventId,

            storedTarget
              ?.match_name ??
            null,

            market,
            selection,
            stake,
            odds,
            source,
            placedAt,
            now
          )

          .run();


        // Daily row gets PLACED as well.
        await env.DB
          .prepare(`
            UPDATE daily_matches

            SET

              bet_status =
                'PLACED',

              bet_odds =
                COALESCE(
                  ?2,
                  bet_odds,
                  found_odds
                ),

              bet_stake =
                ?3,

              placed_at =
                ?4,

              updated_at =
                ?5

            WHERE
              event_id =
                ?1
          `)

          .bind(
            eventId,
            odds,
            stake,
            placedAt,
            now
          )

          .run();


        const saved =
          await getBetStatus(
            env,
            eventId
          );


        return json({
          success: true,

          action:
            "BET_PLACED_SAVED",

          eventId,

          betPlaced:
            true,

          data:
            saved
        });

      } catch (
        error: any
      ) {

        console.error(
          "BET STATUS ERROR",
          error
        );


        return json(
          {
            success: false,

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
            await getBetStatus(
              env,
              eventId
            );


          return json({
            success: true,

            found:
              !!row,

            betPlaced:
              safe(
                row?.status
              )
                .toUpperCase() ===
              "PLACED",

            data:
              row ??
              null
          });
        }


        const result =
          await env.DB
            .prepare(`
              SELECT *
              FROM bet_status
              WHERE
                status = 'PLACED'
              ORDER BY
                placed_at DESC
              LIMIT 100
            `)
            .all();


        return json({
          success: true,

          count:
            result.results
              ?.length ??
            0,

          data:
            result.results ??
            []
        });

      } catch (
        error: any
      ) {

        return json(
          {
            success: false,

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
// TABLES
// ============================================================

async function ensureTables(
  env: Env
): Promise<void> {

  await ensureBetStatusTable(
    env
  );

  await ensureDailyMatchesTable(
    env
  );
}


async function ensureBetStatusTable(
  env: Env
): Promise<void> {

  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS bet_status (

        event_id TEXT PRIMARY KEY,

        match_name TEXT,

        status TEXT NOT NULL,

        market TEXT,

        selection TEXT,

        stake REAL,

        odds REAL,

        source TEXT,

        placed_at TEXT,

        created_at TEXT NOT NULL,

        updated_at TEXT NOT NULL
      )
    `)
    .run();
}


async function ensureDailyMatchesTable(
  env: Env
): Promise<void> {

  await env.DB
    .prepare(`
      CREATE TABLE IF NOT EXISTS daily_matches (

        event_id TEXT PRIMARY KEY,

        signal_id TEXT,

        match_id TEXT,

        match_name TEXT NOT NULL,

        entry_minute REAL,

        hunter_score REAL,

        found_odds REAL,

        bet_status TEXT NOT NULL
          DEFAULT 'NOT_PLACED',

        bet_odds REAL,

        bet_stake REAL,

        tracker_status TEXT
          DEFAULT 'PENDING',

        tracker_result TEXT
          DEFAULT 'PENDING',

        result_status TEXT
          DEFAULT 'PENDING',

        day_key TEXT NOT NULL,

        entry_time TEXT,

        placed_at TEXT,

        first_seen_at TEXT NOT NULL,

        updated_at TEXT NOT NULL,

        finished_at TEXT
      )
    `)
    .run();


  await env.DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_daily_matches_day
      ON daily_matches(day_key)
    `)
    .run();


  await env.DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_daily_matches_match_id
      ON daily_matches(match_id)
    `)
    .run();


  await env.DB
    .prepare(`
      CREATE INDEX IF NOT EXISTS
        idx_daily_matches_signal_id
      ON daily_matches(signal_id)
    `)
    .run();
}


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

  const trackerData =
    await fetchServiceJSON(
      env.TRACKER,
      "/entries"
    );


  // Update previously stored matches if Tracker
  // already exposes GOAL HIT / NO GOAL.
  await syncDailyFromTrackerData(
    env,
    trackerData
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


  const secureResults =
    hunterResults
      .filter(
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
    Obj[] =
    [];


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


    await saveTarget(
      env,
      target
    );


    await saveDailyTarget(
      env,
      target
    );


    const stored =
      await getStoredEvent(
        env,
        target.eventId
      );


    const betStatus =
      await getBetStatus(
        env,
        target.eventId
      );


    const storedOdds =
      numberOrNull(
        stored?.over_odds
      );


    const betPlaced =
      safe(
        betStatus?.status
      )
        .toUpperCase() ===
      "PLACED";


    // Keep daily row synchronized with bet_status.
    if (
      betPlaced
    ) {

      await updateDailyPlaced(
        env,
        target.eventId,
        betStatus
      );
    }


    targets.push({

      ...target,

      overOdds:
        storedOdds,

      underOdds:
        numberOrNull(
          stored
            ?.under_odds
        ),

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
        null,

      betStake:
        numberOrNull(
          betStatus
            ?.stake
        ),

      betOdds:
        numberOrNull(
          betStatus
            ?.odds
        )
    });
  }


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
// DAILY TARGET SAVE
// ============================================================

async function saveDailyTarget(
  env: Env,
  target: Obj
): Promise<void> {

  const now =
    new Date()
      .toISOString();


  const dayKey =
    target?.entryTime

      ? sofiaDate(
          target.entryTime
        )

      : sofiaDate();


  await env.DB
    .prepare(`
      INSERT INTO daily_matches (

        event_id,
        signal_id,
        match_id,
        match_name,
        entry_minute,
        hunter_score,
        found_odds,
        bet_status,
        tracker_status,
        tracker_result,
        result_status,
        day_key,
        entry_time,
        first_seen_at,
        updated_at
      )

      VALUES (

        ?1,
        ?2,
        ?3,
        ?4,
        ?5,
        ?6,
        NULL,
        'NOT_PLACED',
        'TRACKING',
        'PENDING',
        'PENDING',
        ?7,
        ?8,
        ?9,
        ?9
      )

      ON CONFLICT(event_id)

      DO UPDATE SET

        signal_id =
          COALESCE(
            excluded.signal_id,
            daily_matches.signal_id
          ),

        match_id =
          COALESCE(
            excluded.match_id,
            daily_matches.match_id
          ),

        match_name =
          COALESCE(
            excluded.match_name,
            daily_matches.match_name
          ),

        entry_minute =
          COALESCE(
            excluded.entry_minute,
            daily_matches.entry_minute
          ),

        hunter_score =
          COALESCE(
            excluded.hunter_score,
            daily_matches.hunter_score
          ),

        entry_time =
          COALESCE(
            daily_matches.entry_time,
            excluded.entry_time
          ),

        tracker_status =
          CASE

            WHEN
              daily_matches.result_status
              IN ('WIN','LOSS')

            THEN
              daily_matches.tracker_status

            ELSE
              'TRACKING'

          END,

        updated_at =
          excluded.updated_at
    `)

    .bind(
      target.eventId,

      target.signalId !==
        null &&
      target.signalId !==
        undefined

        ? String(
            target.signalId
          )

        : null,

      target.matchId !==
        null &&
      target.matchId !==
        undefined

        ? String(
            target.matchId
          )

        : null,

      target.matchName ||
        target.cloudbetMatch ||
        "Hunter target",

      target.minute,

      target.hunterScore,

      dayKey,

      target.entryTime ??
        null,

      now
    )

    .run();
}


// ============================================================
// DAILY BET UPDATE
// ============================================================

async function updateDailyPlaced(
  env: Env,
  eventId: string,
  betStatus: Obj
): Promise<void> {

  const now =
    new Date()
      .toISOString();


  await env.DB
    .prepare(`
      UPDATE daily_matches

      SET

        bet_status =
          'PLACED',

        bet_odds =
          COALESCE(
            ?2,
            bet_odds,
            found_odds
          ),

        bet_stake =
          COALESCE(
            ?3,
            bet_stake
          ),

        placed_at =
          COALESCE(
            ?4,
            placed_at
          ),

        updated_at =
          ?5

      WHERE
        event_id =
          ?1
    `)

    .bind(
      eventId,

      numberOrNull(
        betStatus?.odds
      ),

      numberOrNull(
        betStatus?.stake
      ),

      betStatus
        ?.placed_at ??
      null,

      now
    )

    .run();
}


// ============================================================
// DAILY TRACKER SYNC
// ============================================================

async function syncDailyFromTracker(
  env: Env
): Promise<void> {

  try {

    const trackerData =
      await fetchServiceJSON(
        env.TRACKER,
        "/entries"
      );


    await syncDailyFromTrackerData(
      env,
      trackerData
    );

  } catch (
    error
  ) {

    console.log(
      "DAILY TRACKER SYNC SKIPPED",
      error
    );
  }
}


async function syncDailyFromTrackerData(
  env: Env,
  trackerData: any
): Promise<void> {

  const records =
    extractTrackerRecords(
      trackerData
    );


  if (
    !records.length
  ) {
    return;
  }


  for (
    const item
    of records
  ) {

    const normalized =
      normalizeTrackerResult(
        item
      );


    if (
      !normalized
    ) {
      continue;
    }


    const {
      signalId,
      matchId,
      matchName,
      trackerStatus,
      trackerResult,
      resultStatus
    } =
      normalized;


    // We only finalize when Tracker provides
    // a clear GOAL / NO GOAL result.
    if (
      resultStatus !==
        "WIN" &&
      resultStatus !==
        "LOSS"
    ) {
      continue;
    }


    const now =
      new Date()
        .toISOString();


    // Try strongest key first: signal ID.
    if (
      signalId
    ) {

      const r =
        await env.DB
          .prepare(`
            UPDATE daily_matches

            SET

              tracker_status =
                ?2,

              tracker_result =
                ?3,

              result_status =
                ?4,

              finished_at =
                COALESCE(
                  finished_at,
                  ?5
                ),

              updated_at =
                ?5

            WHERE
              signal_id =
                ?1
          `)

          .bind(
            signalId,
            trackerStatus,
            trackerResult,
            resultStatus,
            now
          )

          .run();


      if (
        Number(
          r.meta
            ?.changes ??
          0
        ) > 0
      ) {
        continue;
      }
    }


    // Then match_id.
    if (
      matchId
    ) {

      const r =
        await env.DB
          .prepare(`
            UPDATE daily_matches

            SET

              tracker_status =
                ?2,

              tracker_result =
                ?3,

              result_status =
                ?4,

              finished_at =
                COALESCE(
                  finished_at,
                  ?5
                ),

              updated_at =
                ?5

            WHERE
              match_id =
                ?1
          `)

          .bind(
            matchId,
            trackerStatus,
            trackerResult,
            resultStatus,
            now
          )

          .run();


      if (
        Number(
          r.meta
            ?.changes ??
          0
        ) > 0
      ) {
        continue;
      }
    }


    // Last fallback: exact match name.
    if (
      matchName
    ) {

      await env.DB
        .prepare(`
          UPDATE daily_matches

          SET

            tracker_status =
              ?2,

            tracker_result =
              ?3,

            result_status =
              ?4,

            finished_at =
              COALESCE(
                finished_at,
                ?5
              ),

            updated_at =
              ?5

          WHERE
            match_name =
              ?1
        `)

        .bind(
          matchName,
          trackerStatus,
          trackerResult,
          resultStatus,
          now
        )

        .run();
    }
  }
}


// ============================================================
// EXTRACT ALL TRACKER RECORDS
// ============================================================

function extractTrackerRecords(
  data: any
): Obj[] {

  const output:
    Obj[] =
    [];


  const seen =
    new Set<any>();


  function walk(
    value: any,
    depth = 0
  ) {

    if (
      value === null ||
      value === undefined ||
      depth > 5
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


    if (
      Array.isArray(
        value
      )
    ) {

      for (
        const item
        of value
      ) {

        walk(
          item,
          depth + 1
        );
      }

      return;
    }


    const looksLikeRecord =
      value?.id !==
        undefined ||
      value?.match_id !==
        undefined ||
      value?.match_name !==
        undefined ||
      value?.result !==
        undefined ||
      value?.status !==
        undefined;


    if (
      looksLikeRecord
    ) {

      const matchName =
        safe(
          value
            ?.match_name ??
          value
            ?.match
        );


      if (
        matchName ||
        value?.match_id ||
        value?.id
      ) {

        output.push(
          value
        );
      }
    }


    for (
      const v
      of Object.values(
        value
      )
    ) {

      if (
        v &&
        typeof v ===
          "object"
      ) {

        walk(
          v,
          depth + 1
        );
      }
    }
  }


  walk(
    data
  );


  return output;
}


// ============================================================
// TRACKER RESULT NORMALIZATION
// ============================================================

function normalizeTrackerResult(
  item: Obj
): Obj | null {

  const signalId =
    item?.id !==
      null &&
    item?.id !==
      undefined

      ? String(
          item.id
        )

      : "";


  const matchId =
    item?.match_id !==
      null &&
    item?.match_id !==
      undefined

      ? String(
          item.match_id
        )

      : "";


  const matchName =
    safe(
      item
        ?.match_name ??
      item
        ?.match
    );


  if (
    !signalId &&
    !matchId &&
    !matchName
  ) {
    return null;
  }


  const status =
    safe(
      item?.status
    )
      .toUpperCase();


  const result =
    safe(
      item
        ?.result ??
      item
        ?.result_status ??
      item
        ?.outcome
    )
      .toUpperCase();


  const type =
    safe(
      item
        ?.type ??
      (
        typeof item
          ?.signal ===
          "string"

          ? item.signal
          : ""
      )
    )
      .toUpperCase();


  const combined =
    (
      status +
      " " +
      result +
      " " +
      type
    )
      .trim();


  let resultStatus =
    "PENDING";


  if (
    combined.includes(
      "NO_GOAL"
    ) ||
    combined.includes(
      "NO GOAL"
    )
  ) {

    resultStatus =
      "LOSS";

  } else if (
    combined.includes(
      "GOAL HIT"
    ) ||
    combined.includes(
      "GOAL_HIT"
    ) ||
    (
      combined.includes(
        "GOAL"
      ) &&
      !combined.includes(
        "NO GOAL"
      )
    )
  ) {

    resultStatus =
      "WIN";
  }


  return {

    signalId,

    matchId,

    matchName,

    trackerStatus:
      status ||
      "UNKNOWN",

    trackerResult:
      result ||
      type ||
      "UNKNOWN",

    resultStatus
  };
}


// ============================================================
// DAILY QUERY
// ============================================================

async function getDailyMatches(
  env: Env
): Promise<Obj[]> {

  const day =
    sofiaDate();


  const result =
    await env.DB
      .prepare(`
        SELECT

          event_id,
          signal_id,
          match_id,
          match_name,
          entry_minute,
          hunter_score,
          found_odds,
          bet_status,
          bet_odds,
          bet_stake,
          tracker_status,
          tracker_result,
          result_status,
          day_key,
          entry_time,
          placed_at,
          first_seen_at,
          updated_at,
          finished_at

        FROM daily_matches

        WHERE
          day_key =
            ?1

        ORDER BY

          COALESCE(
            entry_time,
            first_seen_at
          ) DESC
      `)

      .bind(
        day
      )

      .all();


  return (
    result.results ??
    []
  ) as Obj[];
}


// ============================================================
// DAILY SUMMARY
// ============================================================

function buildDailySummary(
  matches: Obj[]
): Obj {

  const total =
    matches.length;


  const placedMatches =
    matches.filter(
      x =>
        safe(
          x?.bet_status
        )
          .toUpperCase() ===
        "PLACED"
    );


  const placed =
    placedMatches.length;


  const notPlaced =
    total -
    placed;


  // Result counts are intentionally based only
  // on actually placed bets.
  const wins =
    placedMatches.filter(
      x =>
        safe(
          x?.result_status
        )
          .toUpperCase() ===
        "WIN"
    ).length;


  const losses =
    placedMatches.filter(
      x =>
        safe(
          x?.result_status
        )
          .toUpperCase() ===
        "LOSS"
    ).length;


  const pending =
    placed -
    wins -
    losses;


  const settled =
    wins +
    losses;


  const successRate =
    settled > 0

      ? Number(
          (
            wins /
            settled *
            100
          )
            .toFixed(
              1
            )
        )

      : null;


  return {

    today:
      total,

    placed,

    wins,

    losses,

    notPlaced,

    pending,

    settled,

    successRate
  };
}


// ============================================================
// MATCHER
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
// HUNTER SIGNALS
// ============================================================

function extractHunterSignals(
  data: any
): Obj[] {

  let raw:
    any[] =
    [];


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
        home: 0,
        away: 0
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
// TARGET
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

    entryTime:
      signal
        ?.entry_time ??
      null,

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
// LIVE_ODDS
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


async function getStoredEvent(
  env: Env,
  eventId: string
): Promise<Obj | null> {

  return await env.DB
    .prepare(`
      SELECT *
      FROM live_odds
      WHERE
        event_id =
          ?1
      LIMIT 1
    `)

    .bind(
      eventId
    )

    .first();
}


async function getBetStatus(
  env: Env,
  eventId: string
): Promise<Obj | null> {

  return await env.DB
    .prepare(`
      SELECT *
      FROM bet_status
      WHERE
        event_id =
          ?1
      LIMIT 1
    `)

    .bind(
      eventId
    )

    .first();
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
    await response.text();


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
// TIME
// ============================================================

function sofiaDate(
  value?: any
): string {

  let date:
    Date;


  if (
    value
  ) {

    const parsed =
      new Date(
        value
      );


    date =
      Number.isNaN(
        parsed.getTime()
      )

        ? new Date()

        : parsed;

  } else {

    date =
      new Date();
  }


  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          TIME_ZONE,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit"
      }
    )
      .formatToParts(
        date
      );


  const map:
    Record<string, string> =
    {};


  for (
    const part
    of parts
  ) {

    if (
      part.type !==
      "literal"
    ) {

      map[
        part.type
      ] =
        part.value;
    }
  }


  return (
    map.year +
    "-" +
    map.month +
    "-" +
    map.day
  );
}


// ============================================================
// HELPERS
// ============================================================

function extractTeamName(
  value: any
): string {

  if (
    value === null ||
    value === undefined
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
      home: "",
      away: ""
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
    home: "",
    away: ""
  };
}


function scoreToString(
  value: any
): string | null {

  if (
    value === null ||
    value === undefined
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
    value.length >= 2
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
        String(home) +
        ":" +
        String(away)
      );
    }
  }


  return null;
}


function safe(
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
  ).trim();
}


function numberOrNull(
  value: any
): number | null {

  if (
    value === null ||
    value === undefined ||
    value === ""
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
  box-sizing: border-box;
}

body {

  margin: 0;

  background: #0b0e13;

  color: #ffffff;

  font-family:
    Arial,
    Helvetica,
    sans-serif;
}

.app {

  max-width: 760px;

  margin: 0 auto;

  padding: 12px;
}

.title {

  font-size: 22px;

  font-weight: 900;
}

.subtitle {

  margin-top: 4px;

  color: #8d96a5;

  font-size: 10px;

  line-height: 1.4;
}


/* ==========================================================
   TOP SUMMARY
   ========================================================== */

.summary {

  margin-top: 11px;

  display: grid;

  grid-template-columns:
    repeat(4, 1fr);

  gap: 6px;
}

.sum {

  background: #151a22;

  border:
    1px solid #252c38;

  border-radius: 10px;

  padding: 8px 4px;

  text-align: center;
}

.sum .v {

  font-size: 18px;

  font-weight: 900;
}

.sum .l {

  margin-top: 2px;

  font-size: 8px;

  color: #8d96a5;
}

.stats {

  margin-top: 7px;

  color: #7d8797;

  font-size: 9px;

  line-height: 1.4;
}


/* ==========================================================
   COMPACT ACTIVE CARDS
   ========================================================== */

.card {

  margin-top: 9px;

  padding: 10px;

  background: #151a22;

  border:
    1px solid #252c38;

  border-radius: 12px;
}

.card.placed {

  border:
    1px solid #16a34a;

  background: #101d16;
}

.placedBanner {

  margin-bottom: 7px;

  padding: 5px 7px;

  border-radius: 7px;

  background: #14532d;

  color: #bbf7d0;

  font-size: 10px;

  font-weight: 900;

  text-align: center;
}

.match {

  font-size: 15px;

  font-weight: 900;

  line-height: 1.25;
}

.event {

  margin-top: 3px;

  color: #646f80;

  font-size: 8px;

  word-break: break-all;
}

.compactMeta {

  margin-top: 5px;

  display: flex;

  flex-wrap: wrap;

  gap: 5px;

  color: #adb5c2;

  font-size: 10px;
}

.compactMeta span {

  padding-right: 5px;
}

.marketLine {

  margin-top: 8px;

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 8px;
}

.marketName {

  color: #a7b0bd;

  font-size: 11px;

  font-weight: 800;
}

.odds {

  font-size: 22px;

  font-weight: 900;
}

.state {

  margin-top: 2px;

  font-size: 8px;

  text-align: right;
}

.ready {
  color: #86efac;
}

.waiting {
  color: #fbbf24;
}

.placedState {

  color: #4ade80;

  font-weight: 900;
}

.actions {

  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 6px;

  margin-top: 8px;
}

.btn {

  border: 0;

  border-radius: 8px;

  padding: 9px 7px;

  font-size: 10px;

  font-weight: 900;

  cursor: pointer;
}

.check {

  background: #2563eb;

  color: white;
}

.bet {

  background: #16a34a;

  color: white;
}

.bet[disabled] {

  background: #26303c;

  color: #788393;

  cursor: not-allowed;
}

.placedBtn {

  background:
    #14532d !important;

  color:
    #86efac !important;
}

.empty {

  margin-top: 10px;

  padding: 18px 12px;

  background: #151a22;

  border:
    1px solid #252c38;

  border-radius: 12px;

  text-align: center;

  color: #9aa4b3;

  font-size: 11px;

  line-height: 1.6;
}


/* ==========================================================
   DAILY LOG
   ========================================================== */

.daily {

  margin-top: 16px;

  background: #151a22;

  border:
    1px solid #252c38;

  border-radius: 12px;

  overflow: hidden;
}

.dailyHead {

  width: 100%;

  padding: 12px;

  border: 0;

  background: #151a22;

  color: #fff;

  display: flex;

  justify-content: space-between;

  align-items: center;

  font-size: 12px;

  font-weight: 900;

  cursor: pointer;

  text-align: left;
}

.dailyArrow {

  color: #8d96a5;

  font-size: 14px;
}

.dailyBody {

  display: none;

  padding:
    0 10px 10px 10px;

  border-top:
    1px solid #252c38;
}

.daily.open
.dailyBody {

  display: block;
}

.dailySummary {

  margin-top: 9px;

  display: grid;

  grid-template-columns:
    repeat(2, 1fr);

  gap: 5px;
}

.ds {

  background: #0f1319;

  border-radius: 8px;

  padding: 7px 8px;

  font-size: 10px;

  display: flex;

  justify-content: space-between;

  gap: 8px;
}

.ds strong {

  font-size: 11px;
}

.dailyList {

  margin-top: 9px;
}

.dailyRow {

  padding: 9px 3px;

  border-top:
    1px solid #242a34;
}

.dailyRow:first-child {

  border-top: 0;
}

.dailyMatch {

  font-size: 11px;

  font-weight: 900;

  line-height: 1.3;
}

.dailyStatus {

  margin-top: 4px;

  display: flex;

  flex-wrap: wrap;

  align-items: center;

  gap: 5px;

  font-size: 9px;

  color: #929baa;
}

.pill {

  padding: 3px 6px;

  border-radius: 6px;

  background: #202632;
}

.pillPlaced {

  background: #123b22;

  color: #86efac;
}

.pillNotPlaced {

  background: #292f38;

  color: #a6afbc;
}

.win {

  color: #4ade80;

  font-weight: 900;
}

.loss {

  color: #f87171;

  font-weight: 900;
}

.pending {

  color: #fbbf24;

  font-weight: 900;
}

.footer {

  margin-top: 16px;

  text-align: center;

  color: #596273;

  font-size: 8px;

  line-height: 1.5;
}

.err {

  color: #fca5a5;
}


/* ==========================================================
   MOBILE
   ========================================================== */

@media (
  max-width: 430px
) {

  .app {
    padding: 9px;
  }

  .title {
    font-size: 19px;
  }

  .summary {

    grid-template-columns:
      repeat(4, 1fr);

    gap: 4px;
  }

  .sum {

    padding:
      7px 2px;
  }

  .sum .v {

    font-size: 16px;
  }

  .sum .l {

    font-size: 7px;
  }

  .card {

    padding: 9px;
  }

  .match {

    font-size: 14px;
  }

  .actions {

    /* KEEP CHECK + BET SIDE BY SIDE */
    grid-template-columns:
      1fr 1fr;
  }

  .btn {

    padding:
      8px 5px;

    font-size: 9px;
  }

  .odds {

    font-size: 20px;
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

    V2.0.0 DAILY LOG

    · TRACKER → MATCHER → CHECK / BET

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


  <!-- ======================================================
       DAILY MATCHES
       ====================================================== -->

  <div
    id="daily"
    class="daily"
  >

    <button
      id="dailyHead"
      class="dailyHead"
      type="button"
    >

      <span>

        📊 ДНЕШНИ МАЧОВЕ ·

        <span id="dailyCount">
          0
        </span>

      </span>

      <span
        id="dailyArrow"
        class="dailyArrow"
      >
        ▸
      </span>

    </button>


    <div
      id="dailyBody"
      class="dailyBody"
    >

      <div
        id="dailySummary"
        class="dailySummary"
      >
      </div>


      <div
        id="dailyList"
        class="dailyList"
      >
      </div>

    </div>

  </div>


  <div class="footer">

    DAILY MATCH LOG · EUROPE/SOFIA

    · SUCCESS = WIN / (WIN + LOSS)

  </div>


</div>


<script>

const CLOUDBET_ORIGIN =
  'https://www.cloud0007.com';


const REFRESH_MS =
  3000;


let latestTargets =
  [];


let latestDaily =
  [];


let dailyOpen =
  false;


// ==========================================================
// ESCAPE
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

  const x =
    Number(v);

  return Number
    .isFinite(x)

      ? x

      : null;
}


// ==========================================================
// TIME
// ==========================================================

function formatTime(v) {

  if (!v) {
    return '';
  }


  try {

    return new Date(v)
      .toLocaleTimeString(
        'bg-BG',
        {
          hour:
            '2-digit',

          minute:
            '2-digit'
        }
      );

  } catch {

    return '';
  }
}


// ==========================================================
// CLOUDBET URL
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


  u.hash =
    'ts-action=' +

    encodeURIComponent(
      action
    ) +

    '&ts-event=' +

    encodeURIComponent(
      id
    );


  return u.href;
}


// ==========================================================
// OPEN
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
    action ===
      'bet' &&
    target?.betPlaced
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
// ACTIVE CARD
// ==========================================================

function card(t) {

  const odds =
    num(
      t?.overOdds
    );


  const ready =
    odds !==
    null;


  const placed =
    t?.betPlaced ===
    true;


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


  const placedOdds =
    num(
      t?.betOdds
    );


  return (

    '<div class="card ' +

      (
        placed
          ? 'placed'
          : ''
      ) +

    '">' +


      (
        placed

          ? (

            '<div class="placedBanner">' +

              '✅ ЗАЛОЖЕНО' +

            '</div>'
          )

          : ''
      ) +


      '<div class="match">' +

        '⚽ ' +
        match +

      '</div>' +


      '<div class="event">' +

        'Event ' +
        eventId +

      '</div>' +


      '<div class="compactMeta">' +

        '<span>⏱ ' +
          minute +
        '</span>' +

        '<span>🎯 Hunter ' +
          hunter +
        '</span>' +

      '</div>' +


      '<div class="marketLine">' +

        '<div class="marketName">' +

          '1H O0.5' +

        '</div>' +


        '<div>' +

          '<div class="odds">' +

            (
              ready

                ? '@' +
                  odds.toFixed(
                    2
                  )

                : '@—'
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

                ? (
                  placedOdds !==
                    null

                    ? 'PLACED @' +
                      placedOdds
                        .toFixed(
                          2
                        )

                    : 'PLACED ✅'
                )

                : ready

                  ? 'READY ✅'

                  : 'WAIT'
            ) +

          '</div>' +

        '</div>' +

      '</div>' +


      '<div class="actions">' +


        '<button ' +

          'class="btn check" ' +

          'data-action="check" ' +

          'data-id="' +
            eventId +
          '">' +

          'CHECK' +

        '</button>' +


        '<button ' +

          'class="btn bet ' +

          (
            placed
              ? 'placedBtn'
              : ''
          ) +

          '" ' +

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

              ? '✅ ЗАЛОЖЕНО'

              : 'BET NOW'
          ) +

        '</button>' +


      '</div>' +


    '</div>'
  );
}


// ==========================================================
// DAILY ROW
// ==========================================================

function dailyRow(m) {

  const placed =
    String(
      m?.bet_status ??
      ''
    )
      .toUpperCase() ===
    'PLACED';


  const result =
    String(
      m?.result_status ??
      'PENDING'
    )
      .toUpperCase();


  const odds =
    num(
      placed

        ? (
            m?.bet_odds ??
            m?.found_odds
          )

        : m?.found_odds
    );


  const match =
    esc(
      m?.match_name ||
      'Unknown match'
    );


  let resultHtml =
    '—';


  // For NOT PLACED rows we deliberately show —
  // even if Tracker already knows the result.
  if (
    placed
  ) {

    if (
      result ===
      'WIN'
    ) {

      resultHtml =
        '<span class="win">' +
          '✅ ПЕЧЕЛИ' +
        '</span>';

    } else if (
      result ===
      'LOSS'
    ) {

      resultHtml =
        '<span class="loss">' +
          '❌ НЕ ПЕЧЕЛИ' +
        '</span>';

    } else {

      resultHtml =
        '<span class="pending">' +
          '⏳ PENDING' +
        '</span>';
    }
  }


  return (

    '<div class="dailyRow">' +

      '<div class="dailyMatch">' +

        match +

      '</div>' +


      '<div class="dailyStatus">' +


        '<span>' +

          (
            odds !==
              null

              ? '@' +
                odds.toFixed(
                  2
                )

              : '@—'
          ) +

        '</span>' +


        '<span class="pill ' +

          (
            placed

              ? 'pillPlaced'

              : 'pillNotPlaced'
          ) +

        '">' +

          (
            placed

              ? 'ЗАЛОЖЕН'

              : 'НЕЗАЛОЖЕН'
          ) +

        '</span>' +


        '<span>' +

          resultHtml +

        '</span>' +


      '</div>' +

    '</div>'
  );
}


// ==========================================================
// DAILY SUMMARY
// ==========================================================

function renderDailySummary(s) {

  const rate =

    s?.successRate ===
      null ||
    s?.successRate ===
      undefined

      ? '—'

      : Number(
          s.successRate
        )
          .toFixed(
            1
          ) + '%';


  return (

    '<div class="ds">' +
      '<span>ДНЕС</span>' +
      '<strong>' +
        esc(
          s?.today ?? 0
        ) +
      '</strong>' +
    '</div>' +


    '<div class="ds">' +
      '<span>ЗАЛОЖЕНИ</span>' +
      '<strong>' +
        esc(
          s?.placed ?? 0
        ) +
      '</strong>' +
    '</div>' +


    '<div class="ds">' +
      '<span>ПЕЧЕЛИ</span>' +
      '<strong class="win">' +
        esc(
          s?.wins ?? 0
        ) +
      '</strong>' +
    '</div>' +


    '<div class="ds">' +
      '<span>НЕ ПЕЧЕЛИ</span>' +
      '<strong class="loss">' +
        esc(
          s?.losses ?? 0
        ) +
      '</strong>' +
    '</div>' +


    '<div class="ds">' +
      '<span>НЕЗАЛОЖЕНИ</span>' +
      '<strong>' +
        esc(
          s?.notPlaced ?? 0
        ) +
      '</strong>' +
    '</div>' +


    '<div class="ds">' +
      '<span>УСПЕХ</span>' +
      '<strong>' +
        esc(
          rate
        ) +
      '</strong>' +
    '</div>'
  );
}


// ==========================================================
// REFRESH ACTIVE TARGETS
// ==========================================================

async function refreshTargets() {

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
    await r.json();


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


  const ready =
    latestTargets
      .filter(
        x =>
          num(
            x?.overOdds
          ) !==
          null
      );


  const placed =
    latestTargets
      .filter(
        x =>
          x?.betPlaced ===
          true
      );


  const best =

    ready

      .map(
        x =>
          num(
            x.overOdds
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

      ' · Matcher ' +

      (
        d.matcher_hunter_results ??
        0
      ) +

      ' · Secure ' +

      latestTargets.length +

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
}


// ==========================================================
// REFRESH DAILY
// ==========================================================

async function refreshDaily() {

  const r =
    await fetch(

      '/api/daily?ts=' +
        Date.now(),

      {
        cache:
          'no-store'
      }
    );


  const d =
    await r.json();


  if (
    !r.ok ||
    !d?.success
  ) {

    throw new Error(

      d?.error ||

      (
        'DAILY HTTP ' +
        r.status
      )
    );
  }


  latestDaily =

    Array.isArray(
      d.matches
    )

      ? d.matches

      : [];


  document
    .getElementById(
      'dailyCount'
    )
    .textContent =
      String(
        latestDaily.length
      );


  document
    .getElementById(
      'dailySummary'
    )
    .innerHTML =
      renderDailySummary(
        d.summary ||
        {}
      );


  document
    .getElementById(
      'dailyList'
    )
    .innerHTML =

      latestDaily.length

        ? latestDaily
            .map(
              dailyRow
            )
            .join('')

        : (

          '<div class="empty">' +

            'Още няма мачове за днес.' +

          '</div>'
        );
}


// ==========================================================
// MASTER REFRESH
// ==========================================================

async function refresh() {

  try {

    await Promise.all([
      refreshTargets(),
      refreshDaily()
    ]);

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
// DAILY TOGGLE
// ==========================================================

document
  .getElementById(
    'dailyHead'
  )
  .addEventListener(
    'click',
    () => {

      dailyOpen =
        !dailyOpen;


      const el =
        document
          .getElementById(
            'daily'
          );


      const arrow =
        document
          .getElementById(
            'dailyArrow'
          );


      if (
        dailyOpen
      ) {

        el.classList
          .add(
            'open'
          );

        arrow.textContent =
          '▾';

      } else {

        el.classList
          .remove(
            'open'
          );

        arrow.textContent =
          '▸';
      }
    }
  );


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
        !target
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
          'bet' &&
        !b.disabled &&
        !target?.betPlaced
      ) {

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
