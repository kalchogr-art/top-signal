// ============================================================
// TOP SIGNAL — BETSAFE READ-ONLY DIAGNOSTIC
// NO BETTING / NO D1 WRITES
// ============================================================

const BETSAFE_LIVE_URL =
  "https://www.betsafe.com/en/sportsbook/live";

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started = Date.now();

  try {
    const response = await fetch(BETSAFE_LIVE_URL, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":
          "en-US,en;q=0.9",
        "Cache-Control":
          "no-cache"
      },
      redirect: "follow"
    });

    const text = await response.text();
    const lower = text.toLowerCase();

    const blockedPatterns = [
      "access denied",
      "forbidden",
      "not available in your country",
      "not available in your region",
      "restricted",
      "geo-block",
      "geoblock"
    ];

    const blockedMatches =
      blockedPatterns.filter(x => lower.includes(x));

    const firstHalf =
      lower.includes("1st half") ||
      lower.includes("first half") ||
      lower.includes("1h");

    const totalGoals =
      lower.includes("total goals") ||
      lower.includes("total_goals") ||
      lower.includes("totals");

    const over05 =
      lower.includes("over 0.5") ||
      lower.includes("over&nbsp;0.5") ||
      (
        lower.includes('"over"') &&
        lower.includes("0.5")
      );

    const football =
      lower.includes("football") ||
      lower.includes("soccer");

    return {
      success: true,

      source: "BETSAFE",
      mode: "READ_ONLY_DIAGNOSTIC",

      target: BETSAFE_LIVE_URL,

      http: {
        status: response.status,
        ok: response.ok,
        status_text: response.statusText,
        final_url: response.url,
        content_type:
          response.headers.get("content-type"),
        content_length: text.length
      },

      checks: {
        blocked:
          blockedMatches.length > 0,

        blocked_matches:
          blockedMatches,

        football,

        first_half:
          firstHalf,

        total_goals:
          totalGoals,

        first_half_total_goals:
          firstHalf && totalGoals,

        over_05:
          over05
      },

      timing_ms:
        Date.now() - started,

      preview:
        text.slice(0, 3000)
    };

  } catch (error: any) {

    return {
      success: false,

      source: "BETSAFE",
      mode: "READ_ONLY_DIAGNOSTIC",

      target:
        BETSAFE_LIVE_URL,

      error:
        error?.message ??
        String(error),

      timing_ms:
        Date.now() - started
    };
  }
}
