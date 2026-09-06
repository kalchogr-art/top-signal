// ============================================================
// TOP SIGNAL — BETSAFE DIAGNOSTIC V10
// READ ONLY
//
// PURPOSE:
// Return a SMALL diagnostic response.
// Inspect only:
//   - entry-client-routing*.js
//   - shell.*.js
//   - main-*.js
//
// Extract compact evidence for:
//   - window.SBB2B_SPORTSBOOK assignment
//   - sbApiBaseUrl assignment/value
//   - sb-api-base-url attribute writes
//   - URL-like candidates near those tokens
//
// NO BETTING
// NO LOGIN
// NO D1 WRITES
// ============================================================

const ORIGIN = "https://www.betsafe.com";
const LIVE_URL = `${ORIGIN}/en/sportsbook/live`;

const MAX_BYTES = 3_000_000;
const CONTEXT_RADIUS = 500;
const MAX_CONTEXTS = 4;
const MAX_URLS = 20;


// ============================================================
// MAIN
// ============================================================

export async function debugBetsafe(): Promise<Record<string, any>> {
  const started = Date.now();

  try {
    const pageResponse = await fetch(LIVE_URL, {
      method: "GET",
      headers: pageHeaders(),
      redirect: "follow"
    });

    const html = await pageResponse.text();
    const decodedHtml = decode(html);

    const scripts = discoverTargetScripts(decodedHtml);

    const fileResults: Record<string, any>[] = [];

    for (const path of scripts) {
      const url = absoluteUrl(path);

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            ...assetHeaders(),
            Referer: LIVE_URL
          },
          redirect: "follow"
        });

        const raw = await response.text();
        const source =
          raw.length > MAX_BYTES
            ? raw.slice(0, MAX_BYTES)
            : raw;

        fileResults.push(
          compactAnalyse(
            path,
            url,
            response.status,
            response.ok,
            source
          )
        );
      } catch (error: any) {
        fileResults.push({
          file: path,
          url,
          error: error?.message ?? String(error)
        });
      }
    }

    return {
      success: true,
      source: "BETSAFE",
      diagnostic_version: "V10",
      mode: "READ_ONLY_DIAGNOSTIC",

      page: {
        status: pageResponse.status,
        ok: pageResponse.ok,
        content_length: html.length
      },

      context: {
        staticContextId:
          extractJsonValue(decodedHtml, "staticContextId"),

        userContextId:
          extractJsonValue(decodedHtml, "userContextId"),

        sbApiBaseUrl:
          extractJsonValue(decodedHtml, "sbApiBaseUrl")
      },

      files: fileResults,

      timing_ms: Date.now() - started
    };
  } catch (error: any) {
    return {
      success: false,
      source: "BETSAFE",
      diagnostic_version: "V10",
      mode: "READ_ONLY_DIAGNOSTIC",
      error: error?.message ?? String(error),
      timing_ms: Date.now() - started
    };
  }
}


// ============================================================
// COMPACT ANALYSIS
// ============================================================

function compactAnalyse(
  file: string,
  url: string,
  status: number,
  ok: boolean,
  source: string
): Record<string, any> {

  const lower = source.toLowerCase();

  const hasSbb2b =
    source.includes("SBB2B_SPORTSBOOK");

  const hasSbApiBaseUrl =
    source.includes("sbApiBaseUrl");

  const hasSbApiAttr =
    lower.includes("sb-api-base-url");

  const hasWindowAssignment =
    /window\.SBB2B_SPORTSBOOK\s*=/.test(source);

  const hasGlobalAssignment =
    /SBB2B_SPORTSBOOK\s*=/.test(source);

  const contexts = {
    sbb2b_assignment:
      findRegexContexts(
        source,
        [
          /window\.SBB2B_SPORTSBOOK\s*=/g,
          /SBB2B_SPORTSBOOK\s*=/g
        ]
      ),

    sb_api_base_url:
      findTokenContexts(
        source,
        [
          "sbApiBaseUrl",
          "sb-api-base-url"
        ]
      ),

    set_attribute:
      findRegexContexts(
        source,
        [
          /setAttribute\(\s*["']sb-api-base-url["']/g,
          /setAttribute\(\s*["']static-context-id["']/g,
          /setAttribute\(\s*["']user-context-id["']/g
        ]
      )
  };

  const urlsNearImportant =
    extractImportantUrlCandidates(
      source,
      [
        "SBB2B_SPORTSBOOK",
        "sbApiBaseUrl",
        "sb-api-base-url"
      ]
    );

  return {
    file,
    url,

    http: {
      status,
      ok,
      content_length: source.length
    },

    flags: {
      has_sbb2b: hasSbb2b,
      has_sb_api_base_url: hasSbApiBaseUrl,
      has_sb_api_attribute: hasSbApiAttr,
      has_window_sbb2b_assignment: hasWindowAssignment,
      has_global_sbb2b_assignment: hasGlobalAssignment
    },

    contexts,

    urls_near_important_tokens:
      urlsNearImportant
  };
}


// ============================================================
// DISCOVER ONLY TARGET SCRIPTS
// ============================================================

function discoverTargetScripts(
  html: string
): string[] {

  const out = new Set<string>();

  const patterns = [
    /<script[^>]+src=["']([^"']+\.js[^"']*)["']/gi,
    /["']([^"']*entry-client-routing[^"']*\.js)["']/gi,
    /["']([^"']*shell\.[^"']*\.js)["']/gi,
    /["']([^"']*main-[^"']*\.js)["']/gi
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html))) {
      const value = clean(match[1]);

      if (!value) continue;

      if (
        value.includes("challenge.") ||
        value.includes("awst")
      ) {
        continue;
      }

      if (
        value.includes("/widgets/sportsbook/") ||
        value.includes("entry-client-routing") ||
        value.includes("shell.") ||
        value.includes("main-")
      ) {
        out.add(value);
      }
    }
  }

  return Array.from(out);
}


// ============================================================
// CONTEXT HELPERS
// ============================================================

function findTokenContexts(
  text: string,
  needles: string[]
): string[] {

  const out: string[] = [];
  const lower = text.toLowerCase();

  for (const rawNeedle of needles) {
    const needle = rawNeedle.toLowerCase();
    let start = 0;

    while (out.length < MAX_CONTEXTS) {
      const index = lower.indexOf(needle, start);

      if (index === -1) break;

      const from = Math.max(0, index - CONTEXT_RADIUS);
      const to = Math.min(
        text.length,
        index + needle.length + CONTEXT_RADIUS
      );

      const context = normalizeContext(
        text.slice(from, to)
      );

      if (
        context &&
        !out.includes(context)
      ) {
        out.push(context);
      }

      start = index + needle.length;
    }

    if (out.length >= MAX_CONTEXTS) break;
  }

  return out;
}


function findRegexContexts(
  text: string,
  regexes: RegExp[]
): string[] {

  const out: string[] = [];

  for (const regex of regexes) {
    regex.lastIndex = 0;

    let match: RegExpExecArray | null;

    while (
      out.length < MAX_CONTEXTS &&
      (match = regex.exec(text))
    ) {
      const index = match.index;

      const from = Math.max(
        0,
        index - CONTEXT_RADIUS
      );

      const to = Math.min(
        text.length,
        index + match[0].length + CONTEXT_RADIUS
      );

      const context = normalizeContext(
        text.slice(from, to)
      );

      if (
        context &&
        !out.includes(context)
      ) {
        out.push(context);
      }

      if (match[0].length === 0) {
        regex.lastIndex++;
      }
    }

    if (out.length >= MAX_CONTEXTS) break;
  }

  return out;
}


// ============================================================
// URL CANDIDATES NEAR IMPORTANT TOKENS
// ============================================================

function extractImportantUrlCandidates(
  text: string,
  tokens: string[]
): string[] {

  const windows: string[] = [];
  const lower = text.toLowerCase();

  for (const rawToken of tokens) {
    const token = rawToken.toLowerCase();

    let start = 0;
    let count = 0;

    while (count < 8) {
      const index = lower.indexOf(
        token,
        start
      );

      if (index === -1) break;

      const from = Math.max(
        0,
        index - 2500
      );

      const to = Math.min(
        text.length,
        index + token.length + 2500
      );

      windows.push(
        text.slice(from, to)
      );

      start = index + token.length;
      count++;
    }
  }

  const joined = windows.join("\n");

  const out = new Set<string>();

  // absolute URLs
  for (
    const match of joined.matchAll(
      /https?:\/\/[^\s"'`\\)]+/gi
    )
  ) {
    out.add(cleanUrl(match[0]));
    if (out.size >= MAX_URLS) break;
  }

  // API-looking relative paths
  if (out.size < MAX_URLS) {
    for (
      const match of joined.matchAll(
        /["'`]((?:\/api\/|\/sb\/|\/sportsbook\/)[^"'`\s\\]*)["'`]/gi
      )
    ) {
      out.add(cleanUrl(match[1]));
      if (out.size >= MAX_URLS) break;
    }
  }

  return Array.from(out)
    .filter(Boolean)
    .slice(0, MAX_URLS);
}


// ============================================================
// JSON VALUE
// ============================================================

function extractJsonValue(
  text: string,
  key: string
): string | null {

  const escaped =
    escapeRegex(key);

  const patterns = [
    new RegExp(
      `["']${escaped}["']\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${escaped}\\s*:\\s*["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `${escaped}\\s*=\\s*["']([^"']+)["']`,
      "i"
    )
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (
      match &&
      match[1]
    ) {
      return clean(match[1]);
    }
  }

  return null;
}


// ============================================================
// NORMALIZE
// ============================================================

function normalizeContext(
  value: string
): string {

  return value
    .replace(/\s+/g, " ")
    .trim();
}


function cleanUrl(
  value: string
): string {

  return decode(value)
    .replace(/[),.;]+$/g, "")
    .trim();
}


// ============================================================
// URL
// ============================================================

function absoluteUrl(
  value: string
): string {

  const v = clean(value);

  if (
    v.startsWith("http://") ||
    v.startsWith("https://")
  ) {
    return v;
  }

  if (v.startsWith("/")) {
    return ORIGIN + v;
  }

  return `${ORIGIN}/${v}`;
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

    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

    "Accept-Language":
      "en-US,en;q=0.9",

    "Cache-Control":
      "no-cache",

    Pragma:
      "no-cache"
  };
}


function assetHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/140.0.0.0 Safari/537.36",

    Accept:
      "*/*",

    "Accept-Language":
      "en-US,en;q=0.9",

    "Cache-Control":
      "no-cache",

    Pragma:
      "no-cache"
  };
}


// ============================================================
// CLEAN / DECODE
// ============================================================

function clean(
  value: any
): string {

  return decode(value)
    .trim();
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
    .replace(/\\\\\//g, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u003F/gi, "?")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"");
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
