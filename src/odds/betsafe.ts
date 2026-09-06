// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V8
// READ ONLY
//
// PURPOSE:
// Find where sbApiBaseUrl is injected client-side.
//
// NO BETTING
// NO LOGIN
// NO D1 WRITES
// ============================================================

const ORIGIN =
  "https://www.betsafe.com";

const LIVE_URL =
  ORIGIN +
  "/en/sportsbook/live";

const MAX_BYTES =
  2_500_000;


// ============================================================
// MAIN
// ============================================================

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started =
    Date.now();

  try {

    // ========================================================
    // PAGE
    // ========================================================

    const pageResponse =
      await fetch(
        LIVE_URL,
        {
          headers:
            pageHeaders(),

          redirect:
            "follow"
        }
      );

    const html =
      await pageResponse.text();


    // ========================================================
    // DISCOVER TARGET FILES
    // ========================================================

    const htmlDecoded =
      decode(html);

    const scriptPaths =
      discoverTargetScripts(
        htmlDecoded
      );

    const results:
      Record<string, any>[] =
      [];


    // ========================================================
    // INLINE HTML ANALYSIS
    // ========================================================

    results.push(
      analyse(
        "HTML",
        LIVE_URL,
        htmlDecoded
      )
    );


    // ========================================================
    // FETCH TARGET JS FILES
    // ========================================================

    for (
      const path
      of scriptPaths
    ) {

      const url =
        absoluteUrl(
          path
        );

      try {

        const response =
          await fetch(
            url,
            {
              headers: {
                ...assetHeaders(),

                "Referer":
                  LIVE_URL
              },

              redirect:
                "follow"
            }
          );

        const raw =
          await response.text();

        const source =
          raw.length >
          MAX_BYTES
            ? raw.slice(
                0,
                MAX_BYTES
              )
            : raw;

        results.push({
          ...analyse(
            path,
            url,
            source
          ),

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
              raw.length,

            inspected_length:
              source.length,

            truncated:
              raw.length >
              MAX_BYTES
          }
        });

      } catch (error: any) {

        results.push({
          file:
            path,

          url,

          error:
            error?.message ??
            String(error)
        });
      }
    }


    // ========================================================
    // IMPORTANT ONLY
    // ========================================================

    const important =
      results.filter(
        x =>
          x?.hints?.sb_api_base_url ||
          x?.hints?.sb_api_attribute ||
          x?.hints?.sbb2b ||
          x?.hints?.set_attribute
      );


    return {
      success:
        true,

      source:
        "BETSAFE",

      diagnostic_version:
        "V8",

      mode:
        "READ_ONLY_DIAGNOSTIC",

      page: {
        status:
          pageResponse.status,

        ok:
          pageResponse.ok,

        content_length:
          html.length
      },

      target_scripts:
        scriptPaths,

      important_hits:
        important,

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
        "V8",

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
// ANALYSE
// ============================================================

function analyse(
  file: string,
  url: string,
  text: string
): Record<string, any> {

  const lower =
    text.toLowerCase();

  return {
    file,
    url,

    hints: {
      sb_api_base_url:
        text.includes(
          "sbApiBaseUrl"
        ),

      sb_api_attribute:
        lower.includes(
          "sb-api-base-url"
        ),

      sbb2b:
        text.includes(
          "SBB2B_SPORTSBOOK"
        ),

      set_attribute:
        lower.includes(
          "setattribute"
        ),

      static_context:
        lower.includes(
          "static-context-id"
        ) ||
        text.includes(
          "staticContextId"
        ),

      user_context:
        lower.includes(
          "user-context-id"
        ) ||
        text.includes(
          "userContextId"
        )
    },

    contexts: {

      sb_api_base_url:
        findContexts(
          text,
          [
            "sbApiBaseUrl",
            "sb-api-base-url"
          ],
          20,
          1600
        ),

      sbb2b:
        findContexts(
          text,
          [
            "SBB2B_SPORTSBOOK"
          ],
          20,
          1600
        ),

      set_attribute:
        findContexts(
          text,
          [
            "setAttribute",
            "setattribute"
          ],
          25,
          1400
        ),

      static_context:
        findContexts(
          text,
          [
            "staticContextId",
            "static-context-id"
          ],
          20,
          1300
        ),

      user_context:
        findContexts(
          text,
          [
            "userContextId",
            "user-context-id"
          ],
          20,
          1300
        ),

      api_sb:
        findContexts(
          text,
          [
            "/api/sb",
            "/sb/"
          ],
          20,
          1300
        )
    }
  };
}


// ============================================================
// DISCOVER TARGET SCRIPTS
// ============================================================

function discoverTargetScripts(
  html: string
): string[] {

  const out =
    new Set<string>();

  const patterns = [

    /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi,

    /["']([^"']*entry-client-routing[^"']*\.js)["']/gi,

    /["']([^"']*shell\.[^"']*\.js)["']/gi,

    /["']([^"']*main-[^"']*\.js)["']/gi
  ];

  for (
    const regex
    of patterns
  ) {

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
        clean(
          match[1]
        );

      if (
        !value ||
        value.includes(
          "awst"
        ) ||
        value.includes(
          "challenge."
        )
      ) {
        continue;
      }

      if (
        value.includes(
          "sportsbook"
        ) ||
        value.includes(
          "entry-client-routing"
        ) ||
        value.includes(
          "shell."
        ) ||
        value.includes(
          "main-"
        )
      ) {
        out.add(
          value
        );
      }
    }
  }

  return Array.from(
    out
  );
}


// ============================================================
// CONTEXT
// ============================================================

function findContexts(
  text: string,
  needles: string[],
  maxResults = 10,
  radius = 800
): string[] {

  const out:
    string[] = [];

  const lower =
    text.toLowerCase();

  for (
    const raw
    of needles
  ) {

    const needle =
      raw.toLowerCase();

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
          index - radius
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
// URL
// ============================================================

function absoluteUrl(
  value: string
): string {

  const v =
    clean(
      value
    );

  if (
    v.startsWith(
      "http://"
    ) ||
    v.startsWith(
      "https://"
    )
  ) {
    return v;
  }

  if (
    v.startsWith(
      "/"
    )
  ) {
    return (
      ORIGIN +
      v
    );
  }

  return (
    ORIGIN +
    "/" +
    v
  );
}


// ============================================================
// HEADERS
// ============================================================

function pageHeaders(): Record<string, string> {

  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
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


function assetHeaders(): Record<string, string> {

  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/140.0.0.0 Safari/537.36",

    "Accept":
      "*/*",

    "Accept-Language":
      "en-US,en;q=0.9",

    "Cache-Control":
      "no-cache",

    "Pragma":
      "no-cache"
  };
}


// ============================================================
// CLEAN / DECODE
// ============================================================

function clean(
  value: any
): string {

  return decode(
    value
  ).trim();
}


function decode(
  value: any
): string {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)

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
      /&amp;/g,
      "&"
    )

    .replace(
      /&quot;/g,
      "\""
    );
          }
