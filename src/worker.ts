// ==UserScript==
// @name         TOP SIGNAL — BASE V7.12 BET SCORE GATE FIX
// @namespace    top-signal
// @version      1.0.28
// @description  BET skips score gate + 1H O0.5 + stake 0.10 USDT + Place Bet highlight.
// @match        https://cloud0007.com/*
// @match        https://www.cloud0007.com/*
// @match        https://*.cloud0007.com/*
// @match        https://cloudbet.com/*
// @match        https://www.cloudbet.com/*
// @match        https://*.cloudbet.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = 'BASE V7.12';

  // ============================================================
  // BET CONTROL
  // ============================================================
  //
  // false:
  // - намира 1H O0.5
  // - избира O0.5
  // - попълва stake 0.10 USDT
  // - НЕ натиска финалния Place Bet
  // - връща към dashboard след 5 секунди
  //
  // true:
  // - намира 1H O0.5
  // - избира O0.5
  // - попълва stake 0.10 USDT
  // - чака РЪЧЕН trusted click върху Place Bet / Confirm Bet
  // - след него записва BET PLACED и връща dashboard
  //
  const BET_PLACE = false;

  const BET_STAKE_USDT = 0.10;

  const DRY_RETURN_MS = 5000;

  // ============================================================

  const PANEL_ID = 'top-signal-panel-v712';

  const TOP_SIGNAL =
    'https://top-signal.kalchogr.workers.dev';

  const DASHBOARD =
    TOP_SIGNAL + '/';

  const ODDS_API =
    TOP_SIGNAL + '/api/odds';

  const BET_STATUS_API =
    TOP_SIGNAL + '/api/bet-status';

  const CLICK_INTERVAL = 3000;
  const REFRESH_AFTER = 20000;

  const SCORE_CACHE_KEY =
    'topSignalScoreV712';

  const EVENT_CACHE_KEY =
    'topSignalEventV712';

  const ACTION_CACHE_KEY =
    'topSignalActionV712';

  const BET_READY_KEY =
    'topSignalBetReadyV712';

  const WINDOW_PREFIX =
    'TOP_SIGNAL::';

  const MAX_LAUNCH_AGE_MS =
    30 * 60 * 1000;

  const POS_X =
    'topSignalPanelX712';

  const POS_Y =
    'topSignalPanelY712';

  let returning = false;
  let refreshing = false;
  let finished = false;
  let saving = false;

  let oneHStageStart = null;
  let last1HClick = 0;
  let clickCount = 0;

  let oddsSelected = false;
  let betClickSaving = false;

  let stakePrepared = false;
  let dryReturnStarted = false;


  // ============================================================
  // HELPERS
  // ============================================================

  function clean(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }


  function visible(el) {
    if (
      !el ||
      !(el instanceof Element)
    ) {
      return false;
    }

    const style =
      getComputedStyle(el);

    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number(style.opacity) === 0
    ) {
      return false;
    }

    const r =
      el.getBoundingClientRect();

    return (
      r.width > 0 &&
      r.height > 0
    );
  }


  function area(el) {
    if (!el) {
      return Infinity;
    }

    const r =
      el.getBoundingClientRect();

    return r.width * r.height;
  }


  function validOdds(value) {
    const n =
      Number(value);

    return (
      Number.isFinite(n) &&
      n >= 1.01 &&
      n <= 50
    );
  }


  // ============================================================
  // ROBUST LAUNCH HANDOFF
  // ============================================================

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }


  function readHashParams() {
    try {
      return new URLSearchParams(
        String(location.hash || '')
          .replace(/^#/, '')
      );
    } catch {
      return new URLSearchParams();
    }
  }


  function normalizeLaunch(value) {
    if (
      !value ||
      typeof value !== 'object'
    ) {
      return null;
    }

    const action =
      clean(value.action)
        .toLowerCase();

    const eventId =
      clean(
        value.eventId ??
        value.event
      );

    const createdAt =
      Number(
        value.createdAt ??
        Date.now()
      );

    if (
      action !== 'check' &&
      action !== 'bet'
    ) {
      return null;
    }

    if (!eventId) {
      return null;
    }

    if (
      !Number.isFinite(createdAt)
    ) {
      return null;
    }

    if (
      Date.now() -
      createdAt >
      MAX_LAUNCH_AGE_MS
    ) {
      return null;
    }

    return {
      action,
      eventId,
      createdAt
    };
  }


  function writeWindowLaunch(
    launch
  ) {
    const normalized =
      normalizeLaunch(
        launch
      );

    if (!normalized) {
      return;
    }

    try {
      window.name =
        WINDOW_PREFIX +
        JSON.stringify(
          normalized
        );
    } catch {}

    try {
      sessionStorage.setItem(
        ACTION_CACHE_KEY,
        normalized.action
      );

      sessionStorage.setItem(
        EVENT_CACHE_KEY,
        normalized.eventId
      );
    } catch {}
  }


  function readWindowLaunch() {
    try {
      const raw =
        String(
          window.name ||
          ''
        );

      if (
        !raw.startsWith(
          WINDOW_PREFIX
        )
      ) {
        return null;
      }

      return normalizeLaunch(
        safeJsonParse(
          raw.slice(
            WINDOW_PREFIX.length
          )
        )
      );
    } catch {
      return null;
    }
  }


  function captureLaunch() {
    try {
      const url =
        new URL(
          location.href
        );

      const hash =
        readHashParams();

      const action =
        clean(
          url.searchParams.get(
            'ts-action'
          ) ||
          hash.get(
            'ts-action'
          )
        ).toLowerCase();

      const eventId =
        clean(
          url.searchParams.get(
            'ts-event'
          ) ||
          hash.get(
            'ts-event'
          )
        );

      if (
        (
          action === 'check' ||
          action === 'bet'
        ) &&
        eventId
      ) {
        const launch = {
          action,
          eventId,
          createdAt:
            Date.now()
        };

        writeWindowLaunch(
          launch
        );

        return launch;
      }
    } catch {}

    const fromWindow =
      readWindowLaunch();

    if (fromWindow) {
      try {
        sessionStorage.setItem(
          ACTION_CACHE_KEY,
          fromWindow.action
        );

        sessionStorage.setItem(
          EVENT_CACHE_KEY,
          fromWindow.eventId
        );
      } catch {}

      return fromWindow;
    }

    try {
      const action =
        clean(
          sessionStorage.getItem(
            ACTION_CACHE_KEY
          )
        ).toLowerCase();

      const eventId =
        clean(
          sessionStorage.getItem(
            EVENT_CACHE_KEY
          )
        );

      if (
        (
          action === 'check' ||
          action === 'bet'
        ) &&
        eventId
      ) {
        const launch = {
          action,
          eventId,
          createdAt:
            Date.now()
        };

        writeWindowLaunch(
          launch
        );

        return launch;
      }
    } catch {}

    return null;
  }


  let launchState =
    captureLaunch();


  function getAction() {
    const fresh =
      captureLaunch();

    if (fresh) {
      launchState =
        fresh;
    }

    return (
      launchState?.action ||
      'passive'
    );
  }


  // ============================================================
  // EVENT ID
  // ============================================================

  function getEventId() {
    const fresh =
      captureLaunch();

    if (fresh) {
      launchState =
        fresh;

      return fresh.eventId;
    }

    if (
      launchState?.eventId
    ) {
      return clean(
        launchState.eventId
      );
    }

    const fromWindow =
      readWindowLaunch();

    if (
      fromWindow?.eventId
    ) {
      launchState =
        fromWindow;

      return clean(
        fromWindow.eventId
      );
    }

    try {
      const cached =
        sessionStorage.getItem(
          EVENT_CACHE_KEY
        );

      if (cached) {
        return clean(
          cached
        );
      }

      const match =
        location.href.match(
          /(?:event|events|sportsbook|live)[^\d]*(\d{6,})/i
        );

      if (match) {
        return clean(
          match[1]
        );
      }

    } catch {}

    return '';
  }


  // ============================================================
  // SCORE
  // ============================================================

  function parseScore(text) {
    text =
      clean(text);

    let match =
      text.match(
        /Current\s*goals\s*:?\s*(\d+)\s*\(\s*(\d+)\s*[-:–—]\s*(\d+)\s*\)/i
      );

    if (match) {
      return {
        total:
          Number(match[1]),

        home:
          Number(match[2]),

        away:
          Number(match[3]),

        cached:
          false
      };
    }

    match =
      text.match(
        /Current\s*goals\s*:?\s*\(\s*(\d+)\s*[-:–—]\s*(\d+)\s*\)/i
      );

    if (match) {
      const home =
        Number(match[1]);

      const away =
        Number(match[2]);

      return {
        total:
          home + away,

        home,
        away,
        cached:
          false
      };
    }

    return null;
  }


  function readLiveScore() {
    if (!document.body) {
      return null;
    }

    return (
      parseScore(
        document.body.innerText
      ) ||
      parseScore(
        document.body.textContent
      )
    );
  }


  function saveZeroScore(score) {
    if (
      score?.home === 0 &&
      score?.away === 0
    ) {
      sessionStorage.setItem(
        SCORE_CACHE_KEY,
        JSON.stringify({
          home: 0,
          away: 0,
          total: 0,
          savedAt: Date.now()
        })
      );
    }
  }


  function readCachedScore() {
    try {
      const raw =
        sessionStorage.getItem(
          SCORE_CACHE_KEY
        );

      if (!raw) {
        return null;
      }

      const data =
        JSON.parse(raw);

      if (
        data?.home === 0 &&
        data?.away === 0
      ) {
        return {
          home: 0,
          away: 0,
          total: 0,
          cached: true
        };
      }

    } catch {}

    return null;
  }


  // ============================================================
  // SESSION
  // ============================================================

  function clearSession() {
    sessionStorage.removeItem(
      SCORE_CACHE_KEY
    );

    sessionStorage.removeItem(
      EVENT_CACHE_KEY
    );

    sessionStorage.removeItem(
      ACTION_CACHE_KEY
    );

    sessionStorage.removeItem(
      BET_READY_KEY
    );

    try {
      if (
        String(window.name || '')
          .startsWith(
            WINDOW_PREFIX
          )
      ) {
        window.name = '';
      }
    } catch {}

    launchState = null;
  }


  function setBetReady() {
    sessionStorage.setItem(
      BET_READY_KEY,
      '1'
    );
  }


  function isBetReady() {
    return (
      sessionStorage.getItem(
        BET_READY_KEY
      ) === '1'
    );
  }


  // ============================================================
  // SMALL PANEL
  // ============================================================

  function createPanel() {
    let panel =
      document.getElementById(
        PANEL_ID
      );

    if (panel) {
      return panel;
    }

    const host =
      document.body ||
      document.documentElement;

    if (!host) {
      return null;
    }

    panel =
      document.createElement(
        'div'
      );

    panel.id =
      PANEL_ID;

    panel.innerHTML = `
      <div
        id="tsHeader"
        style="
          cursor:move;
          font-size:11px;
          font-weight:900;
          padding-bottom:5px;
          border-bottom:1px solid #334155;
        "
      >
        ⚡ TOP SIGNAL
      </div>

      <div
        id="tsMode"
        style="
          margin-top:5px;
          font-size:8px;
          color:#94a3b8;
        "
      >
        ${VERSION}
      </div>

      <div
        id="tsStatus"
        style="
          margin-top:6px;
          font-size:11px;
          font-weight:900;
          color:#4ade80;
        "
      >
        ● ACTIVE
      </div>

      <div
        id="tsScore"
        style="
          margin-top:5px;
          font-size:10px;
          font-weight:800;
        "
      >
        SCORE —
      </div>

      <div
        id="tsMarket"
        style="
          margin-top:4px;
          font-size:10px;
          font-weight:800;
        "
      >
        TOTAL —
      </div>

      <div
        id="ts1H"
        style="
          margin-top:4px;
          font-size:10px;
          font-weight:800;
        "
      >
        1H —
      </div>

      <div
        id="tsOdds"
        style="
          margin-top:5px;
          font-size:17px;
          font-weight:900;
          color:#facc15;
        "
      >
        @ —
      </div>

      <div
        id="tsInfo"
        style="
          margin-top:4px;
          font-size:8px;
          line-height:1.25;
          color:#cbd5e1;
        "
      >
        WAIT
      </div>
    `;

    Object.assign(
      panel.style,
      {
        position:
          'fixed',

        left:
          localStorage.getItem(
            POS_X
          ) || '8px',

        top:
          localStorage.getItem(
            POS_Y
          ) || '70px',

        width:
          '145px',

        padding:
          '8px',

        background:
          'rgba(15,23,42,.94)',

        color:
          '#fff',

        border:
          '1px solid #475569',

        borderRadius:
          '9px',

        boxShadow:
          '0 5px 18px rgba(0,0,0,.45)',

        fontFamily:
          'Arial,sans-serif',

        zIndex:
          '2147483647',

        pointerEvents:
          'auto',

        userSelect:
          'none',

        touchAction:
          'none'
      }
    );

    host.appendChild(
      panel
    );

    enableDrag(
      panel
    );

    return panel;
  }


  function keepPanelAlive() {
    const panel =
      document.getElementById(
        PANEL_ID
      ) ||
      createPanel();

    if (!panel) {
      return;
    }

    panel.style.setProperty(
      'display',
      'block',
      'important'
    );

    panel.style.setProperty(
      'visibility',
      'visible',
      'important'
    );

    panel.style.setProperty(
      'opacity',
      '1',
      'important'
    );

    panel.style.setProperty(
      'z-index',
      '2147483647',
      'important'
    );
  }


  function enableDrag(panel) {
    const header =
      panel.querySelector(
        '#tsHeader'
      );

    let dragging =
      false;

    let sx = 0;
    let sy = 0;

    let px = 0;
    let py = 0;

    header.addEventListener(
      'pointerdown',
      e => {
        dragging =
          true;

        sx =
          e.clientX;

        sy =
          e.clientY;

        const r =
          panel.getBoundingClientRect();

        px =
          r.left;

        py =
          r.top;

        try {
          header.setPointerCapture(
            e.pointerId
          );
        } catch {}
      }
    );

    header.addEventListener(
      'pointermove',
      e => {
        if (!dragging) {
          return;
        }

        const x =
          px +
          e.clientX -
          sx;

        const y =
          py +
          e.clientY -
          sy;

        panel.style.left =
          x + 'px';

        panel.style.top =
          y + 'px';

        localStorage.setItem(
          POS_X,
          x + 'px'
        );

        localStorage.setItem(
          POS_Y,
          y + 'px'
        );
      }
    );

    const stop =
      () => {
        dragging =
          false;
      };

    header.addEventListener(
      'pointerup',
      stop
    );

    header.addEventListener(
      'pointercancel',
      stop
    );
  }


  // ============================================================
  // EXACT ELEMENTS
  // ============================================================

  function exactElements(
    root,
    wanted
  ) {
    if (!root) {
      return [];
    }

    return [
      ...root.querySelectorAll('*')
    ]
      .filter(
        el =>
          visible(el) &&
          clean(
            el.textContent
          ) === wanted
      )
      .sort(
        (a, b) =>
          area(a) -
          area(b)
      );
  }


  // ============================================================
  // PERIOD
  // ============================================================

  function findPeriod(
    root,
    wanted
  ) {
    const hits =
      exactElements(
        root,
        wanted
      );

    if (!hits.length) {
      return null;
    }

    let best =
      hits[0];

    let node =
      hits[0];

    for (
      let i = 0;
      i < 7 &&
      node;
      i++,
      node =
        node.parentElement
    ) {
      if (
        !root.contains(
          node
        )
      ) {
        break;
      }

      if (!visible(node)) {
        continue;
      }

      const text =
        clean(
          node.textContent
        );

      const r =
        node.getBoundingClientRect();

      if (
        text === wanted &&
        r.width >= 20 &&
        r.width <= 130 &&
        r.height >= 15 &&
        r.height <= 80
      ) {
        best =
          node;
      }

      if (
        text !== wanted
      ) {
        break;
      }
    }

    return best;
  }


  // ============================================================
  // TOTAL GOALS CARD
  // ============================================================

  function findCurrentGoalsLabels() {
    if (!document.body) {
      return [];
    }

    return [
      ...document.querySelectorAll(
        'body *'
      )
    ]
      .filter(
        el => {
          if (!visible(el)) {
            return false;
          }

          const text =
            clean(
              el.textContent
            );

          return (
            /^Current\s*goals/i.test(
              text
            ) &&
            text.length <= 80
          );
        }
      )
      .sort(
        (a, b) =>
          a.getBoundingClientRect().top -
          b.getBoundingClientRect().top
      );
  }


  function cardFromCurrentGoals(
    label
  ) {
    let node =
      label;

    for (
      let depth = 0;
      depth < 12 &&
      node;
      depth++,
      node =
        node.parentElement
    ) {
      if (!visible(node)) {
        continue;
      }

      const r =
        node.getBoundingClientRect();

      if (
        r.width < 250 ||
        r.height < 100
      ) {
        continue;
      }

      const ft =
        findPeriod(
          node,
          'FT'
        );

      const h1 =
        findPeriod(
          node,
          '1H'
        );

      const h2 =
        findPeriod(
          node,
          '2H'
        );

      if (
        ft &&
        h1 &&
        h2
      ) {
        return node;
      }
    }

    return null;
  }


  function find1HTotalCard() {
    if (!document.body) {
      return null;
    }

    const titles =
      exactElements(
        document.body,
        '1st Half Total Goals'
      );

    for (
      const title
      of titles
    ) {
      let node =
        title;

      for (
        let depth = 0;
        depth < 12 &&
        node;
        depth++,
        node =
          node.parentElement
      ) {
        if (!visible(node)) {
          continue;
        }

        const text =
          clean(
            node.textContent
          );

        const r =
          node.getBoundingClientRect();

        if (
          r.width < 250 ||
          r.height < 80
        ) {
          continue;
        }

        if (
          /Alternative\s+lines/i.test(
            text
          )
        ) {
          continue;
        }

        const ft =
          findPeriod(
            node,
            'FT'
          );

        const h1 =
          findPeriod(
            node,
            '1H'
          );

        const h2 =
          findPeriod(
            node,
            '2H'
          );

        if (
          ft &&
          h1 &&
          h2
        ) {
          return node;
        }
      }
    }

    return null;
  }


  function findMainTotalCard() {
    const oneHCard =
      find1HTotalCard();

    if (oneHCard) {
      return oneHCard;
    }

    const labels =
      findCurrentGoalsLabels();

    const cards =
      [];

    for (
      const label
      of labels
    ) {
      const card =
        cardFromCurrentGoals(
          label
        );

      if (
        card &&
        !cards.includes(card)
      ) {
        cards.push(card);
      }
    }

    if (!cards.length) {
      return null;
    }

    cards.sort(
      (a, b) =>
        a.getBoundingClientRect().top -
        b.getBoundingClientRect().top
    );

    return cards[0];
  }


  // ============================================================
  // ACTIVE PERIOD
  // ============================================================

  function signature(el) {
    if (!el) {
      return '';
    }

    const s =
      getComputedStyle(el);

    return [
      s.backgroundColor,
      s.borderTopColor,
      s.borderRightColor,
      s.borderBottomColor,
      s.borderLeftColor,
      s.color,
      s.boxShadow,
      s.outlineColor
    ].join('|');
  }


  function cardIs1H(card) {
    if (!card) {
      return false;
    }

    return (
      exactElements(
        card,
        '1st Half Total Goals'
      ).length > 0
    );
  }


  function activePeriod(card) {
    if (
      cardIs1H(card)
    ) {
      return '1H';
    }

    const ft =
      findPeriod(
        card,
        'FT'
      );

    const h1 =
      findPeriod(
        card,
        '1H'
      );

    const h2 =
      findPeriod(
        card,
        '2H'
      );

    if (
      !ft ||
      !h1 ||
      !h2
    ) {
      return null;
    }

    const a =
      signature(ft);

    const b =
      signature(h1);

    const c =
      signature(h2);

    if (
      b === c &&
      a !== b
    ) {
      return 'FT';
    }

    if (
      a === c &&
      b !== a
    ) {
      return '1H';
    }

    if (
      a === b &&
      c !== a
    ) {
      return '2H';
    }

    return 'UNKNOWN';
  }


  function isDisabled(el) {
    if (!el) {
      return true;
    }

    let node =
      el;

    for (
      let i = 0;
      i < 6 &&
      node;
      i++,
      node =
        node.parentElement
    ) {
      const text =
        clean(
          node.textContent
        );

      const aria =
        clean(
          node.getAttribute?.(
            'aria-disabled'
          )
        ).toLowerCase();

      const disabledAttr =
        node.hasAttribute?.(
          'disabled'
        );

      const disabledProp =
        node.disabled === true;

      const cls =
        clean(
          node.className
        ).toLowerCase();

      if (
        aria === 'true' ||
        disabledAttr ||
        disabledProp ||
        /(^|\s)disabled(\s|$)/i.test(
          cls
        )
      ) {
        return true;
      }

      if (
        text !== '1H'
      ) {
        break;
      }
    }

    return false;
  }


  // ============================================================
  // CLICK
  // ============================================================

  function fireClick(target) {
    if (
      !target ||
      !visible(target)
    ) {
      return false;
    }

    try {
      target.scrollIntoView({
        block:
          'center',

        inline:
          'center',

        behavior:
          'auto'
      });
    } catch {}

    const r =
      target.getBoundingClientRect();

    const x =
      r.left +
      r.width / 2;

    const y =
      r.top +
      r.height / 2;

    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0
    };

    try {
      target.dispatchEvent(
        new PointerEvent(
          'pointerdown',
          {
            ...common,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            buttons: 1
          }
        )
      );
    } catch {}

    try {
      target.dispatchEvent(
        new MouseEvent(
          'mousedown',
          {
            ...common,
            buttons: 1
          }
        )
      );
    } catch {}

    try {
      target.dispatchEvent(
        new PointerEvent(
          'pointerup',
          {
            ...common,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true,
            buttons: 0
          }
        )
      );
    } catch {}

    try {
      target.dispatchEvent(
        new MouseEvent(
          'mouseup',
          {
            ...common,
            buttons: 0
          }
        )
      );
    } catch {}

    try {
      HTMLElement.prototype.click.call(
        target
      );
    } catch {
      try {
        target.click();
      } catch {}
    }

    return true;
  }


  // ============================================================
  // SPECIAL 1H CLICK
  // ============================================================

  function find1HClickTarget(
    card,
    h1
  ) {
    let best =
      h1;

    let node =
      h1;

    for (
      let i = 0;
      i < 7 &&
      node;
      i++,
      node =
        node.parentElement
    ) {
      if (
        !card.contains(node)
      ) {
        break;
      }

      if (!visible(node)) {
        continue;
      }

      const text =
        clean(
          node.textContent
        );

      if (
        text !== '1H'
      ) {
        break;
      }

      best =
        node;

      const tag =
        String(
          node.tagName ||
          ''
        ).toLowerCase();

      const role =
        clean(
          node.getAttribute?.(
            'role'
          )
        ).toLowerCase();

      const tabindex =
        node.getAttribute?.(
          'tabindex'
        );

      const style =
        getComputedStyle(
          node
        );

      if (
        tag === 'button' ||
        role === 'button' ||
        role === 'tab' ||
        tabindex !== null ||
        style.cursor === 'pointer'
      ) {
        return node;
      }
    }

    return best;
  }


  function click1H(
    card,
    h1
  ) {
    if (
      !h1 ||
      isDisabled(h1)
    ) {
      return false;
    }

    const target =
      find1HClickTarget(
        card,
        h1
      );

    fireClick(
      target
    );

    if (
      target !== h1
    ) {
      setTimeout(
        () => {
          if (
            activePeriod(
              card
            ) !== '1H'
          ) {
            fireClick(
              h1
            );
          }
        },
        300
      );
    }

    return true;
  }


  // ============================================================
  // EXACT 0.5
  // ============================================================

  function find05Market(card) {
    if (!card) {
      return null;
    }

    const lines =
      exactElements(
        card,
        '0.5'
      );

    for (
      const line
      of lines
    ) {
      let row =
        line;

      for (
        let depth = 0;
        depth < 8 &&
        row;
        depth++,
        row =
          row.parentElement
      ) {
        if (
          !card.contains(row)
        ) {
          break;
        }

        if (!visible(row)) {
          continue;
        }

        const r =
          row.getBoundingClientRect();

        if (
          r.height < 25 ||
          r.height > 140
        ) {
          continue;
        }

        const values =
          [
            ...row.querySelectorAll('*')
          ]
            .filter(
              el =>
                visible(el) &&
                el.children.length === 0
            )
            .map(
              el => {
                const text =
                  clean(
                    el.textContent
                  );

                const value =
                  Number(
                    text.replace(
                      ',',
                      '.'
                    )
                  );

                const rect =
                  el.getBoundingClientRect();

                return {
                  el,
                  value,
                  left:
                    rect.left
                };
              }
            )
            .filter(
              x =>
                validOdds(
                  x.value
                ) &&
                x.value !== 0.5
            )
            .sort(
              (a, b) =>
                a.left -
                b.left
            );

        if (
          values.length >= 2
        ) {
          return {
            line: 0.5,

            over:
              Number(
                values[0].value
              ),

            under:
              Number(
                values[1].value
              ),

            overEl:
              values[0].el,

            underEl:
              values[1].el
          };
        }
      }
    }

    return null;
  }


  // ============================================================
  // STAKE INPUT
  // ============================================================

  function findStakeInput() {
    const inputs =
      [
        ...document.querySelectorAll(
          'input'
        )
      ]
        .filter(
          el => {
            if (!visible(el)) {
              return false;
            }

            const placeholder =
              clean(
                el.getAttribute(
                  'placeholder'
                )
              ).toLowerCase();

            const aria =
              clean(
                el.getAttribute(
                  'aria-label'
                )
              ).toLowerCase();

            const name =
              clean(
                el.getAttribute(
                  'name'
                )
              ).toLowerCase();

            const inputMode =
              clean(
                el.getAttribute(
                  'inputmode'
                )
              ).toLowerCase();

            const type =
              clean(
                el.getAttribute(
                  'type'
                )
              ).toLowerCase();

            return (
              placeholder.includes(
                'stake'
              ) ||
              placeholder.includes(
                'amount'
              ) ||
              aria.includes(
                'stake'
              ) ||
              aria.includes(
                'amount'
              ) ||
              name.includes(
                'stake'
              ) ||
              name.includes(
                'amount'
              ) ||
              inputMode === 'decimal' ||
              inputMode === 'numeric' ||
              type === 'number'
            );
          }
        )
        .sort(
          (a, b) =>
            area(a) -
            area(b)
        );

    return (
      inputs[0] ||
      null
    );
  }


  function setNativeInputValue(
    input,
    value
  ) {
    const prototype =
      Object.getPrototypeOf(
        input
      );

    const descriptor =
      Object.getOwnPropertyDescriptor(
        prototype,
        'value'
      ) ||
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      );

    if (
      descriptor?.set
    ) {
      descriptor.set.call(
        input,
        value
      );
    } else {
      input.value =
        value;
    }
  }


  function setStakeAmount() {
    const input =
      findStakeInput();

    if (!input) {
      return false;
    }

    const value =
      BET_STAKE_USDT.toFixed(
        2
      );

    try {
      input.focus();

      setNativeInputValue(
        input,
        value
      );

      input.dispatchEvent(
        new InputEvent(
          'input',
          {
            bubbles:
              true,

            composed:
              true,

            inputType:
              'insertText',

            data:
              value
          }
        )
      );

      input.dispatchEvent(
        new Event(
          'change',
          {
            bubbles:
              true,

            composed:
              true
          }
        )
      );

      input.blur();

      return true;

    } catch {
      return false;
    }
  }


  // ============================================================
  // SEND ODDS
  // ============================================================

  async function sendOdds(
    market
  ) {
    const eventId =
      getEventId();

    const overOdds =
      Number(
        market?.over
      );

    const underOdds =
      Number(
        market?.under
      );

    if (
      !eventId ||
      !validOdds(
        overOdds
      )
    ) {
      throw new Error(
        'INVALID_ODDS'
      );
    }

    const response =
      await fetch(
        ODDS_API,
        {
          method:
            'POST',

          headers: {
            'content-type':
              'application/json'
          },

          body:
            JSON.stringify({
              eventId,

              market:
                '1H Total Goals',

              line:
                0.5,

              selection:
                'OVER',

              overOdds,

              underOdds:
                validOdds(
                  underOdds
                )
                  ? underOdds
                  : null,

              odds:
                overOdds,

              ready:
                true,

              source:
                'CLOUDBET_BROWSER_V7.12',

              timestamp:
                Date.now()
            })
        }
      );

    if (!response.ok) {
      throw new Error(
        'ODDS API ' +
        response.status
      );
    }

    return true;
  }


  // ============================================================
  // SAVE BET STATUS
  // ============================================================

  async function saveBetPlaced() {
    const eventId =
      getEventId();

    if (!eventId) {
      throw new Error(
        'EVENT_ID_MISSING'
      );
    }

    const response =
      await fetch(
        BET_STATUS_API,
        {
          method:
            'POST',

          headers: {
            'content-type':
              'application/json'
          },

          body:
            JSON.stringify({
              eventId,

              status:
                'PLACED',

              market:
                '1st Half Total Goals',

              selection:
                'O 0.5',

              stake:
                BET_STAKE_USDT,

              source:
                'CLOUDBET_FRONTEND_V7.12',

              placedAt:
                new Date().toISOString(),

              timestamp:
                Date.now()
            })
        }
      );

    if (!response.ok) {
      throw new Error(
        'BET STATUS API ' +
        response.status
      );
    }

    return true;
  }


  // ============================================================
  // MANUAL PLACE BET DETECTOR
  //
  // IMPORTANT:
  // - BET_PLACE=false -> no final click is accepted/saved.
  // - BET_PLACE=true  -> waits for a real user trusted click.
  // - This script does NOT auto-click the final Place Bet button.
  // ============================================================

  function findClickableFromEventTarget(
    target
  ) {
    if (
      !target ||
      !(target instanceof Element)
    ) {
      return null;
    }

    return (
      target.closest(
        'button,[role="button"],[type="submit"],a'
      ) ||
      target
    );
  }


  function isPlaceBetButton(el) {
    if (!el) {
      return false;
    }

    const text =
      clean(
        el.innerText ||
        el.textContent ||
        el.getAttribute?.(
          'aria-label'
        ) ||
        ''
      );

    if (
      !text ||
      text.length > 100
    ) {
      return false;
    }

    return (
      /^place\s+bet$/i.test(text) ||
      /^confirm\s+bet$/i.test(text) ||
      /^place\s+wager$/i.test(text) ||
      /^submit\s+bet$/i.test(text)
    );
  }


  function findPlaceBetButton() {
    if (!document.body) {
      return null;
    }

    const candidates = [
      ...document.querySelectorAll(
        'button,[role="button"],[type="submit"],a'
      )
    ]
      .filter(
        el =>
          visible(el) &&
          isPlaceBetButton(el)
      )
      .sort(
        (a, b) =>
          area(a) -
          area(b)
      );

    return (
      candidates[0] ||
      null
    );
  }


  function highlightPlaceBetButton() {
    const button =
      findPlaceBetButton();

    if (!button) {
      return false;
    }

    try {
      button.scrollIntoView({
        block:
          'center',

        inline:
          'center',

        behavior:
          'smooth'
      });
    } catch {}

    try {
      button.style.setProperty(
        'outline',
        '4px solid #facc15',
        'important'
      );

      button.style.setProperty(
        'outline-offset',
        '4px',
        'important'
      );

      button.style.setProperty(
        'box-shadow',
        '0 0 0 6px rgba(250,204,21,.25), 0 0 22px rgba(250,204,21,.85)',
        'important'
      );

      button.style.setProperty(
        'position',
        button.style.position || 'relative',
        'important'
      );

      button.dataset.topSignalReady =
        '1';

    } catch {}

    return true;
  }


  async function onManualPlaceBetClick(
    event
  ) {
    if (
      finished ||
      returning ||
      betClickSaving
    ) {
      return;
    }

    if (!BET_PLACE) {
      return;
    }

    if (
      getAction() !== 'bet'
    ) {
      return;
    }

    if (
      event.isTrusted !== true
    ) {
      return;
    }

    if (
      !isBetReady()
    ) {
      return;
    }

    const button =
      findClickableFromEventTarget(
        event.target
      );

    if (
      !isPlaceBetButton(
        button
      )
    ) {
      return;
    }

    const disabled =
      button.disabled === true ||
      button.hasAttribute?.(
        'disabled'
      ) ||
      clean(
        button.getAttribute?.(
          'aria-disabled'
        )
      ).toLowerCase() === 'true';

    if (disabled) {
      return;
    }

    betClickSaving =
      true;

    const statusEl =
      document.getElementById(
        'tsStatus'
      );

    const oddsEl =
      document.getElementById(
        'tsOdds'
      );

    const infoEl =
      document.getElementById(
        'tsInfo'
      );

    if (statusEl) {
      statusEl.textContent =
        '✅ BET PLACED';

      statusEl.style.color =
        '#4ade80';
    }

    if (oddsEl) {
      oddsEl.textContent =
        'ЗАЛОЖЕН ✅';

      oddsEl.style.color =
        '#4ade80';
    }

    if (infoEl) {
      infoEl.textContent =
        'SAVING...';

      infoEl.style.color =
        '#4ade80';
    }

    try {
      await saveBetPlaced();

      finished =
        true;

      if (infoEl) {
        infoEl.textContent =
          'BET PLACED ✅';
      }

      setTimeout(
        () => {
          clearSession();

          location.href =
            DASHBOARD;
        },
        600
      );

    } catch (error) {
      betClickSaving =
        false;

      if (statusEl) {
        statusEl.textContent =
          '❌ SAVE ERROR';

        statusEl.style.color =
          '#f87171';
      }

      if (infoEl) {
        infoEl.textContent =
          String(
            error?.message ||
            error
          );

        infoEl.style.color =
          '#f87171';
      }
    }
  }


  document.addEventListener(
    'click',
    onManualPlaceBetClick,
    true
  );


  // ============================================================
  // RETURN
  // ============================================================

  function returnToDashboard(
    delay = 1500
  ) {
    if (returning) {
      return;
    }

    if (
      getAction() === 'bet'
    ) {
      return;
    }

    returning =
      true;

    setTimeout(
      () => {
        clearSession();

        location.href =
          DASHBOARD;
      },
      delay
    );
  }


  function scheduleDryReturn() {
    if (
      dryReturnStarted ||
      BET_PLACE
    ) {
      return;
    }

    dryReturnStarted =
      true;

    setTimeout(
      () => {
        clearSession();

        location.href =
          DASHBOARD;
      },
      DRY_RETURN_MS
    );
  }


  // ============================================================
  // REFRESH
  // ============================================================

  function refreshPage(
    infoEl
  ) {
    if (refreshing) {
      return;
    }

    refreshing =
      true;

    if (infoEl) {
      infoEl.textContent =
        'REFRESH 🔄';
    }

    setTimeout(
      () => {
        location.reload();
      },
      400
    );
  }


  // ============================================================
  // UPDATE
  // ============================================================

  async function update() {
    if (
      finished ||
      returning ||
      refreshing
    ) {
      return;
    }

    const action =
      getAction();

    const modeEl =
      document.getElementById(
        'tsMode'
      );

    const statusEl =
      document.getElementById(
        'tsStatus'
      );

    const scoreEl =
      document.getElementById(
        'tsScore'
      );

    const marketEl =
      document.getElementById(
        'tsMarket'
      );

    const h1El =
      document.getElementById(
        'ts1H'
      );

    const oddsEl =
      document.getElementById(
        'tsOdds'
      );

    const infoEl =
      document.getElementById(
        'tsInfo'
      );

    if (!modeEl) {
      return;
    }

    modeEl.textContent =
      VERSION +
      ' · ' +
      action.toUpperCase() +
      (
        action === 'bet'
          ? (
              BET_PLACE
                ? ' · CONFIRM MANUAL'
                : ' · DRY'
            )
          : ''
      );


    if (
      action !== 'check' &&
      action !== 'bet'
    ) {
      statusEl.textContent =
        '⚪ PASSIVE';

      statusEl.style.color =
        '#94a3b8';

      infoEl.textContent =
        'NO TOP SIGNAL ACTION';

      return;
    }


    // ==========================================================
    // SCORE
    // ==========================================================
    //
    // CHECK mode:
    //   score remains a hard safety gate.
    //
    // BET mode:
    //   score is informational only. Top Signal / Tracker / V27
    //   already validated the live state before opening Cloudbet,
    //   so a missing Cloudbet score must NOT block market search.
    // ==========================================================

    const liveScore =
      readLiveScore();

    if (liveScore) {
      if (
        liveScore.home !== 0 ||
        liveScore.away !== 0
      ) {
        if (
          action === 'check'
        ) {
          statusEl.textContent =
            '❌ STOP';

          statusEl.style.color =
            '#f87171';

          scoreEl.textContent =
            `${liveScore.home}-${liveScore.away}`;

          infoEl.textContent =
            'NOT 0:0';

          returnToDashboard(
            1200
          );

          return;
        }

        // BET mode: show warning, but do not stop the flow.
        scoreEl.textContent =
          `${liveScore.home}-${liveScore.away} ⚠`;

        scoreEl.style.color =
          '#facc15';

      } else {
        saveZeroScore(
          liveScore
        );

        scoreEl.textContent =
          '0-0';

        scoreEl.style.color =
          '#4ade80';
      }
    } else {
      const cachedScore =
        readCachedScore();

      if (
        action === 'check'
      ) {
        if (!cachedScore) {
          scoreEl.textContent =
            'SCORE —';

          infoEl.textContent =
            'WAIT SCORE';

          return;
        }

        scoreEl.textContent =
          '0-0 CACHED';

        scoreEl.style.color =
          '#4ade80';

      } else {
        // BET mode: no score in Cloudbet DOM is NOT a blocker.
        if (cachedScore) {
          scoreEl.textContent =
            '0-0 CACHED';

          scoreEl.style.color =
            '#4ade80';
        } else {
          scoreEl.textContent =
            'SCORE BYPASS ✅';

          scoreEl.style.color =
            '#4ade80';
        }
      }
    }


    // ==========================================================
    // TOTAL CARD
    // ==========================================================

    const card =
      findMainTotalCard();

    if (!card) {
      marketEl.textContent =
        'TOTAL ❌';

      marketEl.style.color =
        '#f87171';

      infoEl.textContent =
        action === 'bet'
          ? 'WAIT TOTAL · BET MODE STAYS'
          : 'WAIT TOTAL';

      oneHStageStart =
        null;

      return;
    }


    marketEl.textContent =
      'TOTAL ✅';

    marketEl.style.color =
      '#4ade80';


    // ==========================================================
    // 1H
    // ==========================================================

    const h1 =
      findPeriod(
        card,
        '1H'
      );

    const active =
      activePeriod(
        card
      );


    if (
      active !== '1H'
    ) {
      if (!h1) {
        h1El.textContent =
          '1H ❌';

        infoEl.textContent =
          action === 'bet'
            ? 'WAIT 1H · BET MODE STAYS'
            : 'WAIT 1H';

        oneHStageStart =
          null;

        return;
      }


      if (
        oneHStageStart === null
      ) {
        oneHStageStart =
          Date.now();

        last1HClick =
          0;

        clickCount =
          0;
      }


      const elapsed =
        Date.now() -
        oneHStageStart;


      const left =
        Math.max(
          0,
          20 -
          Math.floor(
            elapsed / 1000
          )
        );


      if (
        !isDisabled(
          h1
        ) &&
        Date.now() -
        last1HClick >=
        CLICK_INTERVAL
      ) {
        last1HClick =
          Date.now();

        clickCount++;

        click1H(
          card,
          h1
        );
      }


      h1El.textContent =
        '1H TRY ' +
        clickCount;

      h1El.style.color =
        '#facc15';

      infoEl.textContent =
        `REFRESH ${left}s`;


      if (
        elapsed >=
        REFRESH_AFTER
      ) {
        refreshPage(
          infoEl
        );
      }

      return;
    }


    oneHStageStart =
      null;


    h1El.textContent =
      '1H ✅';

    h1El.style.color =
      '#4ade80';


    // ==========================================================
    // 0.5
    // ==========================================================

    const market =
      find05Market(
        card
      );


    if (
      !market ||
      !validOdds(
        market.over
      )
    ) {
      oddsEl.textContent =
        '@ —';

      infoEl.textContent =
        action === 'bet'
          ? 'WAIT O0.5 · BET MODE STAYS'
          : 'WAIT O0.5';

      return;
    }


    const overOdds =
      Number(
        market.over
      );


    oddsEl.textContent =
      '@ ' +
      overOdds.toFixed(2);

    oddsEl.style.color =
      '#4ade80';


    // ==========================================================
    // CHECK
    // ==========================================================

    if (
      action === 'check'
    ) {
      if (saving) {
        return;
      }

      saving =
        true;

      statusEl.textContent =
        '0.5 FOUND ✅';

      infoEl.textContent =
        'SAVING...';

      try {
        await sendOdds(
          market
        );

        finished =
          true;

        statusEl.textContent =
          'SAVED ✅';

        infoEl.textContent =
          'RETURN';

        returning =
          true;

        setTimeout(
          () => {
            clearSession();

            location.href =
              DASHBOARD;
          },
          900
        );

      } catch (error) {
        saving =
          false;

        statusEl.textContent =
          'SAVE ERROR';

        statusEl.style.color =
          '#f87171';

        infoEl.textContent =
          String(
            error?.message ||
            error
          );
      }

      return;
    }


    // ==========================================================
    // BET
    // ==========================================================

    if (
      action === 'bet'
    ) {
      // Keep fresh odds stored.
      if (!saving) {
        saving =
          true;

        try {
          await sendOdds(
            market
          );
        } catch {}

        saving =
          false;
      }


      // Select O0.5.
      if (
        !oddsSelected &&
        !isBetReady()
      ) {
        const selected =
          fireClick(
            market.overEl
          );

        if (selected) {
          oddsSelected =
            true;

          setTimeout(
            () => {
              setBetReady();
            },
            800
          );
        }
      }


      if (
        !isBetReady()
      ) {
        statusEl.textContent =
          'SELECT O0.5';

        statusEl.style.color =
          '#facc15';

        infoEl.textContent =
          'OPEN BETSLIP...';

        return;
      }


      // Prepare 0.10 USDT stake.
      if (!stakePrepared) {
        const ok =
          setStakeAmount();

        if (!ok) {
          statusEl.textContent =
            '🟡 BET READY';

          statusEl.style.color =
            '#facc15';

          infoEl.textContent =
            'WAIT STAKE INPUT...';

          return;
        }

        stakePrepared =
          true;
      }


      statusEl.textContent =
        '🟡 BET READY';

      statusEl.style.color =
        '#facc15';

      marketEl.textContent =
        '1H O0.5 ✅';

      h1El.textContent =
        '1H ✅';

      oddsEl.textContent =
        '@ ' +
        overOdds.toFixed(
          2
        );


      // ========================================================
      // DRY MODE
      // ========================================================

      if (!BET_PLACE) {
        infoEl.textContent =
          BET_STAKE_USDT.toFixed(2) +
          ' USDT · PLACE BET DISABLED · RETURN 5s';

        scheduleDryReturn();

        return;
      }


      // ========================================================
      // MANUAL CONFIRM MODE
      // ========================================================

      const placeBetFound =
        highlightPlaceBetButton();

      if (placeBetFound) {
        statusEl.textContent =
          '🟡 READY TO CLICK';

        statusEl.style.color =
          '#facc15';

        infoEl.textContent =
          BET_STAKE_USDT.toFixed(2) +
          ' USDT · PLACE BET Е МАРКИРАН';
      } else {
        statusEl.textContent =
          '🟡 BET READY';

        statusEl.style.color =
          '#facc15';

        infoEl.textContent =
          BET_STAKE_USDT.toFixed(2) +
          ' USDT · WAIT PLACE BET BUTTON...';
      }

      return;
    }
  }


  // ============================================================
  // START
  // ============================================================

  function start() {
    createPanel();

    launchState =
      captureLaunch() ||
      launchState;

    getEventId();
    getAction();

    let running =
      false;

    setInterval(
      async () => {
        keepPanelAlive();

        if (running) {
          return;
        }

        running =
          true;

        try {
          await update();

        } catch (error) {
          console.error(
            '[TOP V7.12]',
            error
          );

        } finally {
          running =
            false;
        }
      },
      500
    );
  }


  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once: true
      }
    );
  } else {
    start();
  }

})();
