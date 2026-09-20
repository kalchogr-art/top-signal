TOP SIGNAL V1.9.13 — TRACKER TODAY STATS FIX

1) CHANGE VERSION

OLD:
const VERSION =
  "V1.9.12 DAILY POSSIBLE + PLACED COUNTERS";

NEW:
const VERSION =
  "V1.9.13 TRACKER TODAY STATS";


2) IN /api/archive REPLACE THIS BLOCK:

        await backfillDailySignalsFromLiveOdds(env);

        const todaySignals =
          await getTodaySignalCount(env);

WITH:

        // V1.9.13 — authoritative daily BET READY count.
        // Same source/filter as Tracker /today and /betstats:
        // 10–25′ + Hunter Score >=60 + BET READY.
        // D1 remains only as a fallback if Tracker is temporarily unavailable.
        let todaySignals = 0;

        try {
          const todayStats =
            await fetchServiceJSON(
              env.TRACKER,
              "/today-stats"
            );

          if (
            todayStats?.success === true &&
            Number.isFinite(
              Number(todayStats?.entry)
            )
          ) {
            todaySignals =
              Math.max(
                0,
                Math.trunc(
                  Number(todayStats.entry)
                )
              );
          } else {
            throw new Error(
              "INVALID_TODAY_STATS"
            );
          }

        } catch (error) {

          console.error(
            "TRACKER /today-stats ERROR — D1 FALLBACK",
            error
          );

          await backfillDailySignalsFromLiveOdds(
            env
          );

          todaySignals =
            await getTodaySignalCount(
              env
            );
        }

NO OTHER CODE CHANGES.
BET NOW, ODDS, BET_PLACED, TODAY BET ARCHIVE AND OLD ARCHIVE REMAIN UNCHANGED.
