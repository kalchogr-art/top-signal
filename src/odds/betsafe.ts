// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V5
// READ ONLY
//
// V5:
// - fetch Betsafe live HTML
// - extract sportsbook JS files from HTML + embedded SSR config
// - fetch sportsbook JS files
// - search for:
//     sbApiBaseUrl
//     /api/sb
//     fetchUserContext
//     fetchStartupContext
//     startupContext
//     userContext
//     sportsbook backend hints
//
// NO BETTING
// NO LOGIN
// NO D1 WRITES
// ============================================================

const BETSAFE_ORIGIN =
  "https://www.betsafe.com";

const BETSAFE_LIVE_URL =
  BETSAFE_ORIGIN +
  "/en/sportsbook/live";

const MAX_SCRIPTS =
  15;

const MAX_SCRIPT_BYTES =
  2_000_000;


// ============================================================
// MAIN
// ============================================================

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started =
    Date.now();

  try {

    // ========================================================
    // 1. FETCH PAGE
    // ========================================================

    const pageResponse =
      await fetch(
        BETSAFE_LIVE_URL,
        {
          method: "GET",
          headers: browserHeaders(),
          redirect: "follow"
        }
      );

    const html =
      await pageResponse.text();


    // ========================================================
    // 2. CONTEXT IDS
    // ========================================================

    const staticContextId =
      extractStringValue(
        html,
        "staticContextId"
      );

    const userContextId =
      extractStringValue(
        html,
        "userContextId"
      );


    // ========================================================
    // 3. EXTRACT ALL SPORTBOOK JS PATHS
    // ========================================================

    const normalScripts =
      extractScriptSources(
        html
      );

    const embeddedScripts =
      extractEmbeddedJsPaths(
        html
      );

    const allScripts =
      unique(
        [
          ...normalScripts,
          ...embeddedScripts
        ]
      )
        .filter(
          isSportsbookScript
        )
        .slice(
          0,
          MAX_SCRIPTS
        );


    // ========================================================
    // 4. FETCH SCRIPTS
    // ========================================================

    const scriptResults: Record<string, any>[] =
      [];

    for (
      const scriptPath
      of allScripts
    ) {

      const scriptUrl =
        toAbsoluteUrl(
          scriptPath
        );

      try {

        const response =
          await fetch(
            scriptUrl,
            {
              method: "GET",

              headers: {
                ...browserHeaders(),

                "Accept":
                  "*/*",

                "Referer":
                  BETSAFE_LIVE_URL
              },

              redirect:
                "follow"
            }
          );

        const text =
          await response.text();

        const truncated =
          text.length >
          MAX_SCRIPT_BYTES;

        const source =
          truncated
            ? text.slice(
                0,
                MAX_SCRIPT_BYTES
              )
            : text;


        // ====================================================
        // SEARCH INSIDE SCRIPT
        // ====================================================

        const contexts = {

          sb_api_base_url:
            findContexts(
              source,
              [
                "sbApiBaseUrl"
              ],
              12,
              900
            ),

          api_sb:
            findContexts(
              source,
              [
                "/api/sb",
                "api/sb"
              ],
              15,
              900
            ),

          fetch_user_context:
            findContexts(
              source,
              [
                "fetchUserContext"
              ],
              12,
              900
            ),

          startup_context:
            findContexts(
              source,
              [
                "fetchStartupContext",
                "startupContext",
                "StartupContext"
              ],
              15,
              900
            ),

          user_context:
            findContexts(
              source,
              [
                "userContextId",
                "user-context-id"
              ],
              15,
              900
            ),

          static_context:
            findContexts(
              source,
              [
                "staticContextId",
                "static-context-id"
              ],
              15,
              900
            ),

          sportsbook_api:
            findContexts(
              source,
              [
                "sportsbookApi",
                "sportsbook-api",
                "sportsbook/api",
                "sportsbookApiUrl",
                "baseApiUrl",
                "apiBaseUrl"
              ],
              15,
              900
            )
        };


        // ====================================================
        // URL/PATH CANDIDATES
        // ====================================================

        const absoluteUrls =
          extractAbsoluteUrls(
            source
          )
            .filter(
              isApiCandidate
            )
            .slice(
              0,
              100
            );

        const relativePaths =
          extractRelativePaths(
            source
          )
            .filter(
              isApiCandidate
            )
            .slice(
              0,
              150
            );


        // ====================================================
        // STRING CANDIDATES
        // ====================================================

        const stringCandidates =
          extractInterestingStrings(
            source
          )
            .slice(
              0,
              150
            );


        scriptResults.push({
          path:
            scriptPath,

          url:
            scriptUrl,

          http: {
            status:
              response.status,

            ok:
              response.ok,

            content_type:
              response.headers.get(
                "content-type"
              ),

            content_length:
              text.length,

            inspected_length:
              source.length,

            truncated
          },

          hints: {
            has_sb_api_base_url:
              source.includes(
                "sbApiBaseUrl"
              ),

            has_api_sb:
              source.includes(
                "/api/sb"
              ),

            has_fetch_user_context:
              source.includes(
                "fetchUserContext"
              ),

            has_fetch_startup_context:
              source.includes(
                "fetchStartupContext"
              ),

            has_user_context:
              source.includes(
                "userContextId"
              ),

            has_static_context:
              source.includes(
                "staticContextId"
              ),

            has_odds:
              source
                .toLowerCase()
                .includes(
                  "odds"
                ),

            has_markets:
              source
                .toLowerCase()
                .includes(
                  "market"
                )
          },

          absolute_urls:
            absoluteUrls,

          relative_paths:
            relativePaths,

          string_candidates:
            stringCandidates,

          contexts
        });

      } catch (error: any) {

        scriptResults.push({
          path:
            scriptPath,

          url:
            scriptUrl,

          error:
            error?.message ??
            String(error)
        });
      }
    }


    // ========================================================
    // 5. FLATTEN MOST IMPORTANT RESULTS
    // ========================================================

    const hits =
      scriptResults
        .filter(
          x =>
            x?.hints?.has_sb_api_base_url ||
            x?.hints?.has_api_sb ||
            x?.hints?.has_fetch_user_context ||
            x?.hints?.has_fetch_startup_context
        )
        .map(
          x => ({
            path:
              x.path,

            url:
              x.url,

            hints:
              x.hints,

            relative_paths:
              x.relative_paths,

            absolute_urls:
              x.absolute_urls,

            string_candidates:
              x.string_candidates,

            contexts:
              x.contexts
          })
        );


    // ========================================================
    // 6. PAGE CONTEXT
    // ========================================================

    const pageContexts = {

      static_context:
        findContexts(
          html,
          [
            "staticContextId"
          ],
          5,
          700
        ),

      user_context:
        findContexts(
          html,
          [
            "userContextId"
          ],
          5,
          700
        ),

      sportsbook_brand:
        findContexts(
          html,
          [
            "sportsbookBrandId"
          ],
          5,
          700
        ),

      sportsbook_mfe:
        findContexts(
          html,
          [
            "sportsbook-load-mfe",
            "widgets/sportsbook"
          ],
          8,
          700
        )
    };


    // ========================================================
    // RESULT
    // ========================================================

    return {
      success:
        true,

      source:
        "BETSAFE",

      diagnostic_version:
        "V5",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      page: {
        url:
          BETSAFE_LIVE_URL,

        status:
          pageResponse.status,

        ok:
          pageResponse.ok,

        content_length:
          html.length
      },

      sportsbook_context: {
        staticContextId:
          staticContextId || null,

        userContextId:
          userContextId || null
      },

      scripts: {
        discovered:
          allScripts.length,

        paths:
          allScripts
      },

      important_hits:
        hits,

      page_contexts:
        pageContexts,

      script_results:
        scriptResults,

      timing_ms:
        Date.now() -
        started
    };

  } catch (error: any) {

    return {
      success:
        false,

      source:
        "BETSAFE",

      diagnostic_version:
        "V5",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      error:
        error?.message ??
        String(error),

      timing_ms:
        Date.now() -
        started
    };
  }
}


// ============================================================
// HEADERS
// ============================================================

function browserHeaders(): Record<string, string> {

  return {

    "User-Agent":
      "Mozilla/5.0 " +
      "(Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 " +
      "(KHTML, like Gecko) " +
      "Chrome/140.0.0.0 Safari/537.36",

    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

    "Accept-Language":
      "en-US,en;q=0.9",

    "Cache-Control":
      "no-cache",

    "Pragma":
      "no-cache"
  };
}


// ============================================================
// EXTRACT STRING VALUE
// ============================================================

function extractStringValue(
  text: string,
  key: string
): string {

  const escapedKey =
    escapeRegex(
      key
    );

  const patterns = [

    new RegExp(
      `["']${escapedKey}["']\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${escapedKey}\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${escapedKey}\\s*=\\s*["']([^"']+)["']`,
      "i"
    )
  ];

  for (
    const pattern
    of patterns
  ) {

    const match =
      text.match(
        pattern
      );

    if (
      match &&
      match[1]
    ) {
      return decodeValue(
        match[1]
      );
    }
  }

  return "";
}


// ============================================================
// NORMAL SCRIPT SRC EXTRACTION
// ============================================================

function extractScriptSources(
  html: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(html)
    )
  ) {

    const value =
      decodeValue(
        match[1]
      );

    if (value) {
      out.add(
        value
      );
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// EMBEDDED / ESCAPED JS PATH EXTRACTION
// ============================================================

function extractEmbeddedJsPaths(
  html: string
): string[] {

  const decoded =
    decodeValue(
      html
    );

  const out =
    new Set<string>();

  const regex =
    /\/dist\/prod\/xp\/widgets\/sportsbook\/[^"'<>\\\s]+?\.js/g;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(decoded)
    )
  ) {

    const value =
      cleanPath(
        match[0]
      );

    if (value) {
      out.add(
        value
      );
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// SPORTBOOK SCRIPT FILTER
// ============================================================

function isSportsbookScript(
  value: string
): boolean {

  const s =
    value
      .toLowerCase();

  if (
    !s.includes(
      ".js"
    )
  ) {
    return false;
  }

  return (
    s.includes(
      "/widgets/sportsbook/"
    ) ||
    s.includes(
      "sportsbook"
    )
  );
}


// ============================================================
// ABSOLUTE URL EXTRACTION
// ============================================================

function extractAbsoluteUrls(
  text: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /https?:\/\/[^\s"'<>\\]+/gi;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(text)
    )
  ) {

    const value =
      decodeValue(
        match[0]
      );

    if (
      value.length >
      8
    ) {
      out.add(
        value
      );
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// RELATIVE PATH EXTRACTION
// ============================================================

function extractRelativePaths(
  text: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /["'`](\/[^"'`<>\\\s]{2,300})["'`]/g;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(text)
    )
  ) {

    const value =
      cleanPath(
        match[1]
      );

    if (value) {
      out.add(
        value
      );
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// INTERESTING STRINGS
// ============================================================

function extractInterestingStrings(
  text: string
): string[] {

  const out =
    new Set<string>();

  const regex =
    /["'`]([^"'`]{3,220})["'`]/g;

  let match:
    RegExpExecArray |
    null;

  while (
    (
      match =
        regex.exec(text)
    )
  ) {

    const value =
      decodeValue(
        match[1]
      );

    if (
      isApiCandidate(
        value
      )
    ) {
      out.add(
        value
      );
    }

    if (
      out.size >=
      300
    ) {
      break;
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// API CANDIDATE
// ============================================================

function isApiCandidate(
  value: string
): boolean {

  const s =
    value
      .toLowerCase();

  const keys = [

    "/api/",

    "api.",

    "api/sb",

    "/sb/",

    "sportsbook",

    "startupcontext",

    "usercontext",

    "staticcontext",

    "event",

    "events",

    "market",

    "markets",

    "odds",

    "price",

    "fixture",

    "live",

    "coupon",

    "selection",

    "betting",

    "feed"
  ];

  return keys.some(
    key =>
      s.includes(
        key
      )
  );
}


// ============================================================
// CONTEXT FINDER
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 10,
  radius = 500
): string[] {

  const out:
    string[] = [];

  const lower =
    text
      .toLowerCase();

  for (
    const rawNeedle
    of needles
  ) {

    const needle =
      rawNeedle
        .toLowerCase();

    let start =
      0;

    while (
      out.length <
      maxResults
    ) {

      const index =
        lower.indexOf(
          needle,
          start
        );

      if (
        index ===
        -1
      ) {
        break;
      }

      const from =
        Math.max(
          0,
          index -
          radius
        );

      const to =
        Math.min(
          text.length,
          index +
          needle.length +
          radius
        );

      const context =
        text
          .slice(
            from,
            to
          )
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if (
        context &&
        !out.includes(
          context
        )
      ) {

        out.push(
          context
        );
      }

      start =
        index +
        needle.length;
    }

    if (
      out.length >=
      maxResults
    ) {
      break;
    }
  }

  return out;
}


// ============================================================
// URL HELPERS
// ============================================================

function toAbsoluteUrl(
  value: string
): string {

  const clean =
    decodeValue(
      value
    );

  if (
    clean.startsWith(
      "http://"
    ) ||
    clean.startsWith(
      "https://"
    )
  ) {
    return clean;
  }

  if (
    clean.startsWith(
      "/"
    )
  ) {
    return (
      BETSAFE_ORIGIN +
      clean
    );
  }

  return (
    BETSAFE_ORIGIN +
    "/" +
    clean
  );
}


function cleanPath(
  value: any
): string {

  return decodeValue(
    value
  )
    .replace(
      /[),;]+$/g,
      ""
    )
    .trim();
}


// ============================================================
// DECODE
// ============================================================

function decodeValue(
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
  )
    .trim()

    .replace(
      /\\\\\//g,
      "/"
    )

    .replace(
      /\\\//g,
      "/"
    )

    .replace(
      /\\u002F/gi,
      "/"
    )

    .replace(
      /\\u003A/gi,
      ":"
    )

    .replace(
      /\\u0026/gi,
      "&"
    )

    .replace(
      /\\u003D/gi,
      "="
    )

    .replace(
      /\\u003F/gi,
      "?"
    )

    .replace(
      /\\u002D/gi,
      "-"
    )

    .replace(
      /&amp;/g,
      "&"
    )

    .replace(
      /&quot;/g,
      "\""
    );
}


// ============================================================
// UNIQUE
// ============================================================

function unique(
  values: string[]
): string[] {

  return Array.from(
    new Set(
      values.filter(
        Boolean
      )
    )
  );
}


// ============================================================
// REGEX ESCAPE
// ============================================================

function escapeRegex(
  value: string
): string {

  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  }
