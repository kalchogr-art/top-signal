// ============================================================
// CLOUDBET MATCH MATCHER V7.2.0 — FAST HUNTER MODE
// V27 + CLOUDBET SERVICE BINDINGS
// READ ONLY
//
// FIX:
// - When Top Signal calls /match?signals=...
//   matcher enters FAST_HUNTER mode automatically.
// - FAST_HUNTER DOES NOT fetch/process V27.
// - FAST_HUNTER DOES NOT build:
//     matches
//     possible_matches
//     reversed_candidates
//     false_positive_risks
//     unmatched
//     cloudbet_only_first_half
//     v27_filtered_second_half
// - It only:
//     1) reads current Cloudbet /live
//     2) compares current Hunter signals
//     3) returns hunter_results
//
// SECURITY / SCORING:
// - thresholds unchanged
// - aliases retained
// - only CONFIDENT_MATCH => secure_match=true
// - no score-only acceptance
//
// READ ONLY — NO BET PLACEMENT
// ============================================================

interface Env {
  V27: Fetcher;
  CLOUDBET: Fetcher;
}

type AnyObj = Record<string, any>;

const VERSION =
  "V7.2.0-FAST-HUNTER";

const DEFAULT_THRESHOLD =
  0.45;

const STRONG_TEAM_SCORE =
  0.78;

const POSSIBLE_TEAM_SCORE =
  0.60;

const POSSIBLE_TOTAL_SCORE =
  0.72;

const CONFIDENT_TOTAL_SCORE =
  0.80;

const REVERSED_CONFIDENT_SCORE =
  0.90;

const WEAK_SIDE_LIMIT =
  0.50;

const COMPETITION_BONUS =
  0.05;

const COUNTRY_BONUS =
  0.02;


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
          "no-store"
      }
    }
  );
}


// ============================================================
// NORMALIZATION
// ============================================================

function normalizeText(
  value: any
): string {

  return String(
    value ?? ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /['’`]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// ============================================================
// ALIASES
// ============================================================

const TEAM_ALIASES:
  Record<string, string> = {

  "man city":
    "manchester city",

  "man utd":
    "manchester united",

  "man united":
    "manchester united",

  "man u":
    "manchester united",

  "manchester utd":
    "manchester united",

  "psg":
    "paris saint germain",

  "paris sg":
    "paris saint germain",

  "inter":
    "inter milan",

  "inter milano":
    "inter milan",

  "internazionale":
    "inter milan",

  "fc internazionale":
    "inter milan",

  "atletico":
    "atletico madrid",

  "atletico de madrid":
    "atletico madrid",

  "sporting cp":
    "sporting lisbon",

  "sporting lisboa":
    "sporting lisbon",

  "red star":
    "crvena zvezda",

  "red star belgrade":
    "crvena zvezda",

  "psv eindhoven":
    "psv",

  "bayern munchen":
    "bayern munich",

  "utd":
    "united",

  "ath":
    "athletic",

  "dep":
    "deportivo",

  "depor":
    "deportivo",

  // observed aliases
  "oster":
    "osters",

  "osters":
    "osters",

  "osters if":
    "osters",

  "floridsdorfer ac":
    "fac wien",

  "floridsdorfer":
    "fac wien",

  "fac wien":
    "fac wien",

  "bregenz":
    "schwarz weiss bregenz",

  "sw bregenz":
    "schwarz weiss bregenz",

  "schwarz weiss bregenz":
    "schwarz weiss bregenz"
};


const GENERIC_WORDS =
  new Set([
    "fc",
    "cf",
    "sc",
    "ac",
    "afc",
    "ca",
    "cd",
    "sd",
    "ss",
    "as",
    "us",
    "ud",
    "aa",
    "ad",
    "rc",
    "fk",
    "sk",
    "ks",
    "sv",
    "vfb",
    "vfl",
    "club",
    "calcio",
    "spa",
    "srl",
    "football",
    "soccer"
  ]);


const WEAK_TEAM_TOKENS =
  new Set([
    "city",
    "united",
    "athletic",
    "sporting",
    "racing",
    "real",
    "deportivo",
    "olympic",
    "olympique"
  ]);


// ============================================================
// TEAM NORMALIZATION
// ============================================================

function applyAlias(
  value: string
): string {

  return (
    TEAM_ALIASES[value] ??
    value
  );
}


function normalizeTeam(
  value: any
): string {

  let s =
    normalizeText(
      value
    );

  if (!s) {
    return "";
  }

  s =
    applyAlias(
      s
    );

  const tokens =
    s
      .split(" ")
      .filter(Boolean)
      .map(
        token =>
          TEAM_ALIASES[token] ??
          token
      )
      .filter(
        token =>
          !GENERIC_WORDS.has(
            token
          )
      );

  s =
    tokens.join(" ");

  s =
    applyAlias(
      s
    );

  return s;
}


function teamTokens(
  value: any
): string[] {

  return normalizeTeam(
    value
  )
    .split(" ")
    .filter(Boolean);
}


// ============================================================
// CATEGORY PROTECTION
// ============================================================

function teamCategory(
  value: any
): string {

  const s =
    normalizeText(
      value
    );

  if (
    /\bu\s*\d{2}\b/.test(
      s
    )
  ) {
    return (
      s.match(
        /\bu\s*(\d{2})\b/
      )?.[1] ??
      ""
    )
      ? "U" +
        (
          s.match(
            /\bu\s*(\d{2})\b/
          )?.[1] ??
          ""
        )
      : "";
  }

  if (
    /\bwomen\b|\bw\b/.test(
      s
    )
  ) {
    return "WOMEN";
  }

  if (
    /\breserve\b|\breserves\b|\bii\b|\b2\b/.test(
      s
    )
  ) {
    return "RESERVE";
  }

  return "SENIOR";
}


function categoryCompatible(
  a: any,
  b: any
): boolean {

  const ca =
    teamCategory(
      a
    );

  const cb =
    teamCategory(
      b
    );

  if (
    ca === "SENIOR" ||
    cb === "SENIOR"
  ) {
    return true;
  }

  return ca === cb;
}


// ============================================================
// LEVENSHTEIN
// ============================================================

function levenshtein(
  a: string,
  b: string
): number {

  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const prev =
    new Array(
      b.length + 1
    );

  const curr =
    new Array(
      b.length + 1
    );

  for (
    let j = 0;
    j <= b.length;
    j++
  ) {
    prev[j] = j;
  }

  for (
    let i = 1;
    i <= a.length;
    i++
  ) {

    curr[0] = i;

    for (
      let j = 1;
      j <= b.length;
      j++
    ) {

      const cost =
        a[i - 1] ===
        b[j - 1]
          ? 0
          : 1;

      curr[j] =
        Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
    }

    for (
      let j = 0;
      j <= b.length;
      j++
    ) {
      prev[j] =
        curr[j];
    }
  }

  return prev[b.length];
}


function tokenSimilarity(
  a: string,
  b: string
): number {

  if (
    !a ||
    !b
  ) {
    return 0;
  }

  if (
    a === b
  ) {
    return 1;
  }

  if (
    a.length >= 4 &&
    b.length >= 4 &&
    (
      a.includes(b) ||
      b.includes(a)
    )
  ) {

    return (
      Math.min(
        a.length,
        b.length
      ) /
      Math.max(
        a.length,
        b.length
      )
    );
  }

  const distance =
    levenshtein(
      a,
      b
    );

  return Math.max(
    0,
    1 -
      distance /
      Math.max(
        a.length,
        b.length
      )
  );
}


// ============================================================
// TEAM SCORE
// ============================================================

function teamScore(
  a: any,
  b: any
): number {

  const A =
    normalizeTeam(
      a
    );

  const B =
    normalizeTeam(
      b
    );

  if (
    !A ||
    !B
  ) {
    return 0;
  }

  if (
    A === B
  ) {
    return 1;
  }

  if (
    !categoryCompatible(
      a,
      b
    )
  ) {
    return 0;
  }

  const aTokens =
    A.split(" ")
      .filter(Boolean);

  const bTokens =
    B.split(" ")
      .filter(Boolean);

  if (
    !aTokens.length ||
    !bTokens.length
  ) {
    return 0;
  }

  const shorter =
    aTokens.length <=
    bTokens.length
      ? aTokens
      : bTokens;

  const longer =
    aTokens.length <=
    bTokens.length
      ? bTokens
      : aTokens;

  const shorterAllExact =
    shorter.every(
      token =>
        longer.includes(
          token
        )
    );

  if (
    shorterAllExact &&
    shorter.length >= 2
  ) {

    const extraTokens =
      longer.filter(
        token =>
          !shorter.includes(
            token
          )
      );

    const meaningfulExtra =
      extraTokens.filter(
        token =>
          !/^u\d{2}$/.test(
            token
          ) &&
          token !==
            "reserve" &&
          token !==
            "women" &&
          !/^team[234]$/.test(
            token
          )
      );

    if (
      !meaningfulExtra.length
    ) {
      return 0.97;
    }
  }

  let fuzzy = 0;
  let exact = 0;

  for (
    const aToken
    of aTokens
  ) {

    let best = 0;

    for (
      const bToken
      of bTokens
    ) {

      if (
        aToken ===
        bToken
      ) {
        best = 1;
        break;
      }

      const sim =
        tokenSimilarity(
          aToken,
          bToken
        );

      if (
        sim > best
      ) {
        best = sim;
      }
    }

    if (
      best >= 0.90
    ) {
      fuzzy += best;
    }
    else if (
      best >= 0.75
    ) {
      fuzzy +=
        best * 0.65;
    }
  }

  for (
    const token
    of aTokens
  ) {

    if (
      bTokens.includes(
        token
      )
    ) {
      exact++;
    }
  }

  const minTokens =
    Math.min(
      aTokens.length,
      bTokens.length
    );

  const precision =
    fuzzy /
    Math.max(
      1,
      aTokens.length
    );

  const recall =
    fuzzy /
    Math.max(
      1,
      bTokens.length
    );

  const overlap =
    exact /
    Math.max(
      1,
      minTokens
    );

  let score =
    precision * 0.40 +
    recall * 0.25 +
    overlap * 0.35;

  if (
    aTokens.length === 1 &&
    bTokens.length === 1
  ) {

    const sim =
      tokenSimilarity(
        aTokens[0],
        bTokens[0]
      );

    if (
      sim >= 0.90
    ) {
      score =
        Math.max(
          score,
          sim
        );
    }
  }

  if (
    minTokens === 1 &&
    bTokens.length >= 3 &&
    overlap === 0
  ) {
    score *= 0.50;
  }

  if (
    minTokens === 1 &&
    WEAK_TEAM_TOKENS.has(
      aTokens[0]
    )
  ) {
    score *= 0.35;
  }

  const exactMeaningful =
    aTokens.filter(
      token =>
        bTokens.includes(
          token
        ) &&
        !WEAK_TEAM_TOKENS.has(
          token
        )
    ).length;

  if (
    exactMeaningful === 0 &&
    overlap > 0
  ) {

    score =
      Math.min(
        score,
        0.58
      );
  }

  return Math.min(
    1,
    score
  );
}


// ============================================================
// HOME / AWAY
// ============================================================

function splitMatchName(
  value: any
): {
  home: string | null;
  away: string | null;
} {

  const text =
    String(
      value ?? ""
    ).trim();

  if (!text) {
    return {
      home: null,
      away: null
    };
  }

  const separators = [
    " - ",
    " v ",
    " vs ",
    " VS ",
    " @ "
  ];

  for (
    const separator
    of separators
  ) {

    const index =
      text.indexOf(
        separator
      );

    if (
      index >= 0
    ) {

      return {
        home:
          text
            .slice(
              0,
              index
            )
            .trim(),

        away:
          text
            .slice(
              index +
              separator.length
            )
            .trim()
      };
    }
  }

  return {
    home: null,
    away: null
  };
}


function extractHome(
  match: AnyObj
): string | null {

  if (
    typeof match?.home ===
    "string"
  ) {
    return match.home;
  }

  if (
    typeof match?.homeTeam ===
    "string"
  ) {
    return match.homeTeam;
  }

  if (
    typeof match?.home_name ===
    "string"
  ) {
    return match.home_name;
  }

  if (
    typeof match?.home?.name ===
    "string"
  ) {
    return match.home.name;
  }

  return splitMatchName(
    match?.match ??
    match?.name ??
    ""
  ).home;
}


function extractAway(
  match: AnyObj
): string | null {

  if (
    typeof match?.away ===
    "string"
  ) {
    return match.away;
  }

  if (
    typeof match?.awayTeam ===
    "string"
  ) {
    return match.awayTeam;
  }

  if (
    typeof match?.away_name ===
    "string"
  ) {
    return match.away_name;
  }

  if (
    typeof match?.away?.name ===
    "string"
  ) {
    return match.away.name;
  }

  return splitMatchName(
    match?.match ??
    match?.name ??
    ""
  ).away;
}


// ============================================================
// COMPETITION / COUNTRY
// ============================================================

function competitionText(
  match: AnyObj
): string {

  const competition =
    match?.competition;

  if (
    typeof competition ===
    "string"
  ) {
    return normalizeText(
      competition
    );
  }

  if (
    typeof competition?.name ===
    "string"
  ) {
    return normalizeText(
      competition.name
    );
  }

  if (
    typeof competition?.key ===
    "string"
  ) {
    return normalizeText(
      competition.key
    );
  }

  const league =
    match?.league;

  if (
    typeof league ===
    "string"
  ) {
    return normalizeText(
      league
    );
  }

  if (
    typeof league?.name ===
    "string"
  ) {
    return normalizeText(
      league.name
    );
  }

  return "";
}


function countryText(
  match: AnyObj
): string {

  const fields = [
    match?.country,
    match?.country_name,
    match?.competition?.country,
    match?.league?.country
  ];

  for (
    const value
    of fields
  ) {

    if (
      typeof value ===
        "string" &&
      value.trim()
    ) {

      return normalizeText(
        value
      );
    }
  }

  return "";
}


function competitionSimilarity(
  a: AnyObj,
  b: AnyObj
): number {

  const A =
    competitionText(
      a
    );

  const B =
    competitionText(
      b
    );

  if (
    !A ||
    !B
  ) {
    return 0;
  }

  if (
    A === B
  ) {
    return 1;
  }

  const aWords =
    new Set(
      A.split(" ")
        .filter(Boolean)
    );

  const bWords =
    new Set(
      B.split(" ")
        .filter(Boolean)
    );

  let overlap = 0;

  for (
    const word
    of aWords
  ) {
    if (
      bWords.has(
        word
      )
    ) {
      overlap++;
    }
  }

  return (
    overlap /
    Math.max(
      1,
      Math.min(
        aWords.size,
        bWords.size
      )
    )
  );
}


function countrySimilarity(
  a: AnyObj,
  b: AnyObj
): number {

  const A =
    countryText(
      a
    );

  const B =
    countryText(
      b
    );

  if (
    !A ||
    !B
  ) {
    return 0;
  }

  return A === B
    ? 1
    : 0;
}


// ============================================================
// SCORE
// ============================================================

function detailedMatchScore(
  v27: AnyObj,
  cb: AnyObj
): AnyObj {

  const vHome =
    extractHome(
      v27
    );

  const vAway =
    extractAway(
      v27
    );

  const cHome =
    extractHome(
      cb
    );

  const cAway =
    extractAway(
      cb
    );

  if (
    !vHome ||
    !vAway ||
    !cHome ||
    !cAway
  ) {

    return {
      total: 0,
      baseScore: 0,
      homeScore: 0,
      awayScore: 0,
      reverseHomeScore: 0,
      reverseAwayScore: 0,
      direction: "NONE",
      competitionScore: 0,
      countryScore: 0
    };
  }

  const homeScore =
    teamScore(
      vHome,
      cHome
    );

  const awayScore =
    teamScore(
      vAway,
      cAway
    );

  const reverseHomeScore =
    teamScore(
      vHome,
      cAway
    );

  const reverseAwayScore =
    teamScore(
      vAway,
      cHome
    );

  const normal =
    (
      homeScore +
      awayScore
    ) / 2;

  const reversed =
    (
      reverseHomeScore +
      reverseAwayScore
    ) / 2;

  let direction =
    "NORMAL";

  let baseScore =
    normal;

  if (
    reversed > normal &&
    reverseHomeScore >=
      REVERSED_CONFIDENT_SCORE &&
    reverseAwayScore >=
      REVERSED_CONFIDENT_SCORE
  ) {

    direction =
      "REVERSED";

    baseScore =
      reversed;
  }

  const competitionScore =
    competitionSimilarity(
      v27,
      cb
    );

  const countryScore =
    countrySimilarity(
      v27,
      cb
    );

  let total =
    baseScore;

  if (
    competitionScore >=
      0.80
  ) {
    total +=
      COMPETITION_BONUS;
  }

  if (
    countryScore === 1
  ) {
    total +=
      COUNTRY_BONUS;
  }

  return {
    total:
      Math.min(
        1,
        total
      ),

    baseScore,
    homeScore,
    awayScore,
    reverseHomeScore,
    reverseAwayScore,
    direction,
    competitionScore,
    countryScore
  };
}


// ============================================================
// CLASSIFY
// ============================================================

function classifyMatch(
  detail: AnyObj,
  threshold: number
): AnyObj {

  const home =
    detail.homeScore;

  const away =
    detail.awayScore;

  const total =
    detail.total;

  if (
    detail.direction ===
      "REVERSED"
  ) {

    if (
      detail.reverseHomeScore >=
        REVERSED_CONFIDENT_SCORE &&
      detail.reverseAwayScore >=
        REVERSED_CONFIDENT_SCORE
    ) {

      return {
        classification:
          "CONFIDENT_MATCH",

        reason:
          "STRONG_REVERSED_TWO_SIDED_MATCH"
      };
    }

    return {
      classification:
        "REVERSED_CANDIDATE",

      reason:
        "HOME_AWAY_DIRECTION_REVERSED"
    };
  }

  if (
    home >=
      STRONG_TEAM_SCORE &&
    away >=
      STRONG_TEAM_SCORE &&
    total >=
      Math.max(
        threshold,
        CONFIDENT_TOTAL_SCORE
      )
  ) {

    return {
      classification:
        "CONFIDENT_MATCH",

      reason:
        "STRONG_TWO_SIDED_MATCH"
    };
  }

  if (
    home >=
      POSSIBLE_TEAM_SCORE &&
    away >=
      POSSIBLE_TEAM_SCORE &&
    total >=
      POSSIBLE_TOTAL_SCORE
  ) {

    return {
      classification:
        "POSSIBLE_MATCH",

      reason:
        "BOTH_TEAMS_HAVE_REASONABLE_SIMILARITY"
    };
  }

  if (
    (
      home >= 0.80 &&
      away <
        WEAK_SIDE_LIMIT
    ) ||
    (
      away >= 0.80 &&
      home <
        WEAK_SIDE_LIMIT
    )
  ) {

    return {
      classification:
        "FALSE_POSITIVE_RISK",

      reason:
        "ONLY_ONE_TEAM_MATCHES"
    };
  }

  if (
    total >=
      Math.max(
        0,
        threshold - 0.10
      )
  ) {

    return {
      classification:
        "CLOSE_BELOW_THRESHOLD",

      reason:
        "BOTH_SIDES_NOT_STRONG_ENOUGH"
    };
  }

  return {
    classification:
      "TRUE_UNMATCHED",

    reason:
      "WEAK_TWO_SIDED_SIMILARITY"
  };
}


// ============================================================
// PREPARED
// ============================================================

interface PreparedMatch {
  raw: AnyObj;
  id: string;
  home: string;
  away: string;
  normalizedHome: string;
  normalizedAway: string;
  homeTokens: string[];
  awayTokens: string[];
}


function prepareMatch(
  match: AnyObj
): PreparedMatch {

  const home =
    extractHome(
      match
    ) ?? "";

  const away =
    extractAway(
      match
    ) ?? "";

  return {
    raw:
      match,

    id:
      String(
        match?.id ??
        match?.event_id ??
        match?.key ??
        ""
      ),

    home,
    away,

    normalizedHome:
      normalizeTeam(
        home
      ),

    normalizedAway:
      normalizeTeam(
        away
      ),

    homeTokens:
      teamTokens(
        home
      ),

    awayTokens:
      teamTokens(
        away
      )
  };
}


// ============================================================
// CLOUD BET EXTRACTION
// ============================================================

function extractCloudbetMatches(
  data: any
): AnyObj[] {

  if (
    Array.isArray(
      data?.events
    )
  ) {
    return data.events;
  }

  if (
    Array.isArray(
      data?.matches
    )
  ) {
    return data.matches;
  }

  if (
    Array.isArray(
      data?.live_matches
    )
  ) {
    return data.live_matches;
  }

  return [];
}


function isCloudbetLive(
  match: AnyObj
): boolean {

  const status =
    String(
      match?.status ??
      ""
    )
      .trim()
      .toUpperCase();

  if (
    status ===
      "TRADING_LIVE" ||
    status ===
      "LIVE" ||
    status.includes(
      "LIVE"
    )
  ) {
    return true;
  }

  if (
    match?.live === true
  ) {
    return true;
  }

  return false;
}


// ============================================================
// SERVICE FETCH
// ============================================================

async function fetchServiceJSON(
  service: Fetcher,
  path: string
): Promise<any> {

  const response =
    await service.fetch(
      new Request(
        `https://service${path}`,
        {
          method:
            "GET",

          headers: {
            "accept":
              "application/json"
          }
        }
      )
    );

  const text =
    await response.text();

  if (
    !response.ok
  ) {

    throw new Error(
      `HTTP ${response.status}: ${text.slice(
        0,
        400
      )}`
    );
  }

  try {
    return JSON.parse(
      text
    );
  }
  catch {
    throw new Error(
      `Invalid JSON from ${path}`
    );
  }
}


// ============================================================
// SIGNAL NORMALIZATION
// IMPORTANT FIX:
// tracker may contain signal: "HUNTER_ENTRY" string.
// We only use item.signal when it is actually an object.
// ============================================================

function normalizeHunterSignal(
  item: AnyObj
): AnyObj | null {

  const signal =
    item?.signal &&
    typeof item.signal ===
      "object" &&
    !Array.isArray(
      item.signal
    )
      ? item.signal
      : item;

  if (
    !signal ||
    typeof signal !==
      "object"
  ) {
    return null;
  }

  const split =
    splitMatchName(
      signal?.match ??
      signal?.match_name ??
      signal?.name ??
      ""
    );

  const home =
    String(
      signal?.home ??
      signal?.homeTeam ??
      signal?.home_name ??
      split.home ??
      ""
    ).trim();

  const away =
    String(
      signal?.away ??
      signal?.awayTeam ??
      signal?.away_name ??
      split.away ??
      ""
    ).trim();

  if (
    !home ||
    !away
  ) {
    return null;
  }

  return {
    ...signal,

    type:
      signal?.type ??
      signal?.signal ??
      "HUNTER_ENTRY",

    match:
      signal?.match ??
      signal?.match_name ??
      `${home} - ${away}`,

    match_id:
      signal?.match_id ??
      signal?.id ??
      null,

    home,
    away,

    entry_minute:
      signal?.entry_minute ??
      null,

    hunter_score:
      signal?.hunter_score ??
      null
  };
}


function parseSignalsParam(
  request: Request
): {
  rawPresent: boolean;
  signals: AnyObj[];
} {

  const url =
    new URL(
      request.url
    );

  const value =
    url.searchParams.get(
      "signals"
    );

  if (
    value === null
  ) {
    return {
      rawPresent:
        false,
      signals:
        []
    };
  }

  try {

    const parsed =
      JSON.parse(
        value
      );

    if (
      !Array.isArray(
        parsed
      )
    ) {

      return {
        rawPresent:
          true,
        signals:
          []
      };
    }

    return {
      rawPresent:
        true,

      signals:
        parsed
          .map(
            normalizeHunterSignal
          )
          .filter(
            Boolean
          ) as AnyObj[]
    };
  }
  catch {

    return {
      rawPresent:
        true,
      signals:
        []
    };
  }
}


// ============================================================
// FAST CANDIDATE INDEX
// ============================================================

function buildTokenIndex(
  cloudbet: PreparedMatch[]
): Map<string, number[]> {

  const index =
    new Map<
      string,
      number[]
    >();

  for (
    let i = 0;
    i <
      cloudbet.length;
    i++
  ) {

    const tokens =
      new Set([
        ...cloudbet[i]
          .homeTokens,
        ...cloudbet[i]
          .awayTokens
      ]);

    for (
      const token
      of tokens
    ) {

      if (
        !token ||
        token.length < 3
      ) {
        continue;
      }

      const list =
        index.get(
          token
        );

      if (list) {
        list.push(i);
      }
      else {
        index.set(
          token,
          [i]
        );
      }
    }
  }

  return index;
}


function candidateIndexesForSignal(
  signal: PreparedMatch,
  tokenIndex:
    Map<string, number[]>,
  cloudbetCount: number
): number[] {

  const set =
    new Set<number>();

  const tokens =
    new Set([
      ...signal.homeTokens,
      ...signal.awayTokens
    ]);

  for (
    const token
    of tokens
  ) {

    if (
      !token ||
      token.length < 3
    ) {
      continue;
    }

    const rows =
      tokenIndex.get(
        token
      );

    if (!rows) {
      continue;
    }

    for (
      const index
      of rows
    ) {
      set.add(index);
    }
  }

  // Safety fallback:
  // if aliases/spelling produce no shared token,
  // compare against all live events.
  if (
    set.size === 0
  ) {

    for (
      let i = 0;
      i <
        cloudbetCount;
      i++
    ) {
      set.add(i);
    }
  }

  return [
    ...set
  ];
}


// ============================================================
// HUNTER MATCH
// ============================================================

function scoringRecord(
  detail: AnyObj
): AnyObj {

  return {
    total:
      Number(
        detail.total
          .toFixed(3)
      ),

    base_score:
      Number(
        detail.baseScore
          .toFixed(3)
      ),

    home_score:
      Number(
        detail.homeScore
          .toFixed(3)
      ),

    away_score:
      Number(
        detail.awayScore
          .toFixed(3)
      ),

    reverse_home_score:
      Number(
        detail.reverseHomeScore
          .toFixed(3)
      ),

    reverse_away_score:
      Number(
        detail.reverseAwayScore
          .toFixed(3)
      ),

    direction:
      detail.direction,

    competition_score:
      Number(
        detail.competitionScore
          .toFixed(3)
      ),

    country_score:
      Number(
        detail.countryScore
          .toFixed(3)
      )
  };
}


function matchDisplayName(
  match: AnyObj
): string {

  const home =
    extractHome(
      match
    );

  const away =
    extractAway(
      match
    );

  return (
    match?.match ??
    match?.name ??
    `${home ?? ""} - ${away ?? ""}`
  );
}


function findHunterTargetMatch(
  signal: AnyObj,
  cloudbet:
    PreparedMatch[],
  tokenIndex:
    Map<string, number[]>,
  threshold: number
): AnyObj {

  const target =
    prepareMatch({
      id:
        signal?.match_id ??
        "",

      home:
        signal?.home ??
        "",

      away:
        signal?.away ??
        "",

      match:
        signal?.match ??
        `${signal?.home ?? ""} - ${signal?.away ?? ""}`,

      competition:
        signal?.competition ??
        signal?.league ??
        null,

      country:
        signal?.country ??
        null
    });

  if (
    !target.home ||
    !target.away
  ) {

    return {
      found:
        false,

      best:
        null,

      detail:
        null,

      classification:
        "TRUE_UNMATCHED",

      reason:
        "HUNTER_SIGNAL_MISSING_HOME_OR_AWAY",

      candidateEvaluations:
        0,

      candidates:
        0
    };
  }

  const candidates =
    candidateIndexesForSignal(
      target,
      tokenIndex,
      cloudbet.length
    );

  let best:
    PreparedMatch | null =
    null;

  let bestDetail:
    AnyObj | null =
    null;

  let bestScore =
    -1;

  let candidateEvaluations =
    0;

  for (
    const index
    of candidates
  ) {

    const cb =
      cloudbet[index];

    if (!cb) {
      continue;
    }

    candidateEvaluations++;

    const detail =
      detailedMatchScore(
        target.raw,
        cb.raw
      );

    if (
      detail.total >
      bestScore
    ) {

      best =
        cb;

      bestDetail =
        detail;

      bestScore =
        detail.total;
    }
  }

  if (
    !best ||
    !bestDetail
  ) {

    return {
      found:
        false,

      best:
        null,

      detail:
        null,

      classification:
        "TRUE_UNMATCHED",

      reason:
        "NO_VALID_CLOUDBET_CANDIDATE",

      candidateEvaluations,

      candidates:
        candidates.length
    };
  }

  const classification =
    classifyMatch(
      bestDetail,
      threshold
    );

  return {
    found:
      classification
        .classification ===
      "CONFIDENT_MATCH",

    best,

    detail:
      bestDetail,

    classification:
      classification
        .classification,

    reason:
      classification.reason,

    candidateEvaluations,

    candidates:
      candidates.length
  };
}


// ============================================================
// FAST HUNTER MODE
// ============================================================

async function runFastHunter(
  env: Env,
  request: Request,
  signals: AnyObj[],
  threshold: number
): Promise<Response> {

  const started =
    Date.now();

  const cloudbetStarted =
    Date.now();

  const cloudbetData =
    await fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    );

  const cloudbetFetchMs =
    Date.now() -
    cloudbetStarted;

  const rawCloudbet =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetLive =
    rawCloudbet.filter(
      isCloudbetLive
    );

  const prepareStarted =
    Date.now();

  const preparedCloudbet =
    cloudbetLive.map(
      prepareMatch
    );

  const tokenIndex =
    buildTokenIndex(
      preparedCloudbet
    );

  const prepareMs =
    Date.now() -
    prepareStarted;

  const hunterResults:
    AnyObj[] = [];

  let totalCandidateEvaluations =
    0;

  const matchStarted =
    Date.now();

  for (
    const signal
    of signals
  ) {

    const result =
      findHunterTargetMatch(
        signal,
        preparedCloudbet,
        tokenIndex,
        threshold
      );

    totalCandidateEvaluations +=
      result.candidateEvaluations;

    const detail =
      result.detail;

    const cb =
      result.best;

    hunterResults.push({

      status:
        result.found
          ? "MATCH"
          : "NO_MATCH",

      signal: {
        type:
          signal?.type ??
          "HUNTER_ENTRY",

        match:
          signal?.match ??
          null,

        match_id:
          signal?.match_id ??
          null,

        home:
          signal?.home ??
          null,

        away:
          signal?.away ??
          null,

        entry_minute:
          signal?.entry_minute ??
          null,

        hunter_score:
          signal?.hunter_score ??
          null
      },

      cloudbet:
        cb
          ? {
              id:
                cb.raw?.id ??
                cb.raw?.event_id ??
                null,

              event_id:
                cb.raw?.event_id ??
                cb.raw?.id ??
                null,

              key:
                cb.raw?.key ??
                null,

              match:
                matchDisplayName(
                  cb.raw
                ),

              home:
                extractHome(
                  cb.raw
                ),

              away:
                extractAway(
                  cb.raw
                ),

              normalized_home:
                cb.normalizedHome,

              normalized_away:
                cb.normalizedAway,

              status:
                cb.raw?.status ??
                null,

              competition:
                cb.raw?.competition ??
                null
            }
          : null,

      matcher_scoring:
        detail
          ? scoringRecord(
              detail
            )
          : {
              total: 0,
              base_score: 0,
              home_score: 0,
              away_score: 0,
              reverse_home_score: 0,
              reverse_away_score: 0,
              direction:
                "NONE",
              competition_score: 0,
              country_score: 0
            },

      classification:
        result.classification,

      reason:
        result.reason,

      security: {
        secure_match:
          result.found === true,

        match_method:
          result.found
            ? "FAST_HUNTER_TWO_SIDED"
            : null,

        score_only_match:
          false,

        exact_id_alone:
          false,

        required_classification:
          "CONFIDENT_MATCH",

        candidate_discovery:
          "TOKEN_INDEX_WITH_FULL_FALLBACK"
      },

      diagnostics: {
        candidate_evaluations:
          result.candidateEvaluations,

        candidates:
          result.candidates,

        target_normalized_home:
          normalizeTeam(
            signal?.home
          ),

        target_normalized_away:
          normalizeTeam(
            signal?.away
          )
      }
    });
  }

  const matchingMs =
    Date.now() -
    matchStarted;

  return json({
    success:
      true,

    worker:
      "cloudbet-match-matcher",

    version:
      VERSION,

    mode:
      "READ ONLY",

    execution_mode:
      "FAST_HUNTER",

    source: {
      v27:
        "SKIPPED_IN_FAST_HUNTER",

      cloudbet:
        "CLOUDBET SERVICE BINDING /live"
    },

    settings: {
      match_threshold:
        threshold,

      strong_team_score:
        STRONG_TEAM_SCORE,

      possible_team_score:
        POSSIBLE_TEAM_SCORE,

      possible_total_score:
        POSSIBLE_TOTAL_SCORE,

      confident_total_score:
        CONFIDENT_TOTAL_SCORE,

      reversed_confident_score:
        REVERSED_CONFIDENT_SCORE,

      matcher:
        "STRICT TWO-SIDED TEAM NORMALIZATION + ALIAS + TOKEN FUZZY + CATEGORY PROTECTION",

      hunter_security:
        "ONLY CONFIDENT_MATCH IS ACCEPTED",

      fast_hunter:
        true
    },

    stats: {
      hunter_signals:
        signals.length,

      cloudbet_raw_matches:
        rawCloudbet.length,

      cloudbet_live_matches:
        cloudbetLive.length,

      hunter_secure_matches:
        hunterResults.filter(
          x =>
            x?.security
              ?.secure_match ===
            true
        ).length,

      hunter_no_matches:
        hunterResults.filter(
          x =>
            x?.security
              ?.secure_match !==
            true
        ).length,

      hunter_candidate_evaluations:
        totalCandidateEvaluations,

      cloudbet_fetch_ms:
        cloudbetFetchMs,

      prepare_ms:
        prepareMs,

      matching_ms:
        matchingMs,

      processing_ms:
        Date.now() -
        started
    },

    hunter_results:
      hunterResults,

    timestamp:
      new Date()
        .toISOString()
  });
}


// ============================================================
// LIGHT DIAGNOSTIC MODE
// No full cross-product matching.
// ============================================================

async function runLightDiagnostic(
  env: Env
): Promise<Response> {

  const started =
    Date.now();

  const [
    v27Data,
    cloudbetData
  ] =
    await Promise.all([
      fetchServiceJSON(
        env.V27,
        "/"
      ),

      fetchServiceJSON(
        env.CLOUDBET,
        "/live"
      )
    ]);

  const v27Matches =
    Array.isArray(
      v27Data?.matches
    )
      ? v27Data.matches
      : Array.isArray(
          v27Data?.live_matches
        )
      ? v27Data.live_matches
      : Array.isArray(
          v27Data?.events
        )
      ? v27Data.events
      : [];

  const cb =
    extractCloudbetMatches(
      cloudbetData
    );

  const live =
    cb.filter(
      isCloudbetLive
    );

  return json({
    success:
      true,

    worker:
      "cloudbet-match-matcher",

    version:
      VERSION,

    mode:
      "READ ONLY",

    execution_mode:
      "LIGHT_DIAGNOSTIC",

    note:
      "Full all-vs-all diagnostic matching is intentionally disabled in V7.2.0 to avoid CPU limit.",

    stats: {
      v27_matches:
        v27Matches.length,

      cloudbet_raw_matches:
        cb.length,

      cloudbet_live_matches:
        live.length,

      processing_ms:
        Date.now() -
        started
    },

    hunter_results:
      [],

    timestamp:
      new Date()
        .toISOString()
  });
}


// ============================================================
// THRESHOLD
// ============================================================

function getThreshold(
  request: Request
): number {

  const url =
    new URL(
      request.url
    );

  let threshold =
    Number(
      url.searchParams.get(
        "threshold"
      ) ??
      String(
        DEFAULT_THRESHOLD
      )
    );

  if (
    !Number.isFinite(
      threshold
    )
  ) {
    threshold =
      DEFAULT_THRESHOLD;
  }

  return Math.max(
    0.30,
    Math.min(
      1,
      threshold
    )
  );
}


// ============================================================
// MAIN
// ============================================================

export default {

  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const started =
      Date.now();

    const url =
      new URL(
        request.url
      );

    const pathname =
      url.pathname;

    if (
      pathname ===
      "/"
    ) {

      return json({
        success:
          true,

        worker:
          "cloudbet-match-matcher",

        version:
          VERSION,

        mode:
          "READ ONLY",

        fast_hunter:
          true,

        routes: [
          "/match?signals=[...]",
          "/diagnostic"
        ]
      });
    }


    if (
      pathname ===
      "/match"
    ) {

      try {

        const threshold =
          getThreshold(
            request
          );

        const parsed =
          parseSignalsParam(
            request
          );

        // ----------------------------------------------------
        // Top Signal path:
        // signals query is present => ALWAYS FAST_HUNTER
        // ----------------------------------------------------

        if (
          parsed.rawPresent
        ) {

          if (
            parsed.signals.length ===
            0
          ) {

            return json({
              success:
                true,

              worker:
                "cloudbet-match-matcher",

              version:
                VERSION,

              mode:
                "READ ONLY",

              execution_mode:
                "FAST_HUNTER",

              stats: {
                hunter_signals: 0,
                hunter_secure_matches: 0,
                hunter_no_matches: 0,
                hunter_candidate_evaluations: 0,
                processing_ms:
                  Date.now() -
                  started
              },

              hunter_results:
                [],

              warning:
                "signals parameter was present but contained no valid Hunter signals"
            });
          }

          return await runFastHunter(
            env,
            request,
            parsed.signals,
            threshold
          );
        }

        // No signals => light diagnostic only.
        return await runLightDiagnostic(
          env
        );

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-match-matcher",

            version:
              VERSION,

            action:
              "MATCH",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error
                  ),

            processing_ms:
              Date.now() -
              started
          },
          500
        );
      }
    }


    if (
      pathname ===
      "/diagnostic"
    ) {

      try {

        return await runLightDiagnostic(
          env
        );

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-match-matcher",

            version:
              VERSION,

            action:
              "DIAGNOSTIC",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error
                  )
          },
          500
        );
      }
    }


    return json(
      {
        success:
          false,

        worker:
          "cloudbet-match-matcher",

        version:
          VERSION,

        error:
          "NOT_FOUND"
      },
      404
    );
  }
};
