/*!
 * CRM attribution capture.
 *
 * Reads advertising identifiers the moment a visitor lands and keeps them
 * until an enquiry is submitted -- across page views, across a closed tab,
 * and across subdomains.
 *
 * This is the reason the CRM can attribute a lead at all. Reading the query
 * string at the point of submission, which is what the enquiry form used to
 * do on its own, only works if the visitor never navigates between the ad
 * click and the form. In practice they always do, which is why no lead in
 * the system currently carries a click identifier.
 *
 * Deliberately dependency-free and unbundled: it has to drop onto the
 * marketing site (WordPress or otherwise), which is not built from this
 * repository. Load it in <head>, as early as possible, on every page:
 *
 *   <script src="https://crm.example.com/crm-attribution.js"
 *           data-cookie-domain=".example.com"></script>
 *
 * Field names must match ATTRIBUTION_FIELDS in
 * apps/api/src/attribution/attribution-contract.js. The build fails if they
 * drift -- see apps/api/scripts/check-attribution-contract.js.
 */
(function (window, document) {
  'use strict';

  if (!window || window.crmAttribution) return;

  /* CONTRACT_FIELDS_START */
  var FIELDS = [
    'origin',
    'clickIdType',
    'clickId',
    'campaignSource',
    'campaignMedium',
    'campaignName',
    'campaignTerm',
    'campaignContent',
    'platformCampaignId',
    'platformAdgroupId',
    'platformAdId',
    'platformLeadId',
    'landingUrl',
    'referrerUrl',
    'deviceType',
    'capturedAt'
  ];
  /* CONTRACT_FIELDS_END */

  /*
   * Click identifiers, highest priority first. Mirrors the seed rows in
   * crm_attribution_platforms; the server re-classifies from that table, so
   * this list only has to be good enough to decide what to keep. A platform
   * added server-side still works here as long as its parameter is listed --
   * and if it is not, the raw query string is stored anyway.
   */
  var CLICK_PARAMS = [
    { param: 'gclid', type: 'gclid' },
    { param: 'gbraid', type: 'gbraid' },
    { param: 'wbraid', type: 'wbraid' },
    { param: 'dclid', type: 'dclid' },
    { param: 'fbclid', type: 'fbclid' },
    { param: 'msclkid', type: 'msclkid' },
    { param: 'ttclid', type: 'ttclid' },
    { param: 'li_fat_id', type: 'li_fat_id' }
  ];

  var UTM_MAP = {
    utm_source: 'campaignSource',
    utm_medium: 'campaignMedium',
    utm_campaign: 'campaignName',
    utm_term: 'campaignTerm',
    utm_content: 'campaignContent'
  };

  var STORAGE_KEY = 'crm_attr_v1';
  var MAX_TOUCHES = 10;          // plenty for reporting, bounded for storage
  var TTL_DAYS = 90;             // a typical admissions consideration window
  var HANDOFF_TIME_PARAM = 'crm_captured_at';

  function config() {
    var script = document.currentScript
      || document.querySelector('script[src*="crm-attribution"]');
    var custom = window.CRM_ATTRIBUTION_CONFIG || {};
    var linkDomains = custom.linkDomains
      || (script && script.getAttribute('data-link-domains'))
      || '';
    return {
      // Set to the registrable domain (".example.com") so the value survives
      // the hop from the marketing site to the enquiry form on a subdomain.
      cookieDomain: custom.cookieDomain
        || (script && script.getAttribute('data-cookie-domain'))
        || '',
      // Hosts on a DIFFERENT domain that links should carry attribution to.
      // A cookie cannot cross a domain boundary, so links to these hosts get
      // the identifiers appended instead. Comma separated.
      linkDomains: String(linkDomains).split(',')
        .map(function (d) { return d.trim().toLowerCase(); })
        .filter(Boolean),
      ttlDays: Number(custom.ttlDays) || TTL_DAYS
    };
  }

  function nowIso() { return new Date().toISOString(); }

  function deviceType() {
    var ua = String(window.navigator && window.navigator.userAgent || '');
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
    if (/Mobi|Android|iPhone|iPod/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  function queryParams() {
    var out = {};
    var search = window.location.search || '';
    if (search.charAt(0) === '?') search = search.slice(1);
    if (!search) return out;
    var parts = search.split('&');
    for (var i = 0; i < parts.length; i += 1) {
      if (!parts[i]) continue;
      var pair = parts[i].split('=');
      var key = decodeURIComponent(pair[0] || '').trim();
      var value = decodeURIComponent((pair[1] || '').replace(/\+/g, ' ')).trim();
      if (key && value) out[key.toLowerCase()] = value;
    }
    return out;
  }

  /* ---------------- storage: localStorage first, cookie as the fallback --- */

  function readCookie(name) {
    var all = String(document.cookie || '').split('; ');
    for (var i = 0; i < all.length; i += 1) {
      if (all[i].indexOf(name + '=') === 0) {
        try { return decodeURIComponent(all[i].slice(name.length + 1)); } catch (e) { return ''; }
      }
    }
    return '';
  }

  function writeCookie(name, value, days, domain) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    var cookie = name + '=' + encodeURIComponent(value)
      + '; expires=' + expires + '; path=/; SameSite=Lax';
    if (domain) cookie += '; domain=' + domain;
    if (window.location.protocol === 'https:') cookie += '; Secure';
    try { document.cookie = cookie; } catch (e) { /* nothing we can do */ }
  }

  function load() {
    var raw = '';
    try { raw = window.localStorage.getItem(STORAGE_KEY) || ''; } catch (e) { raw = ''; }
    // Cookie wins when localStorage is empty: that is the cross-subdomain hop.
    if (!raw) raw = readCookie(STORAGE_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.touches || !parsed.touches.length) return null;
      if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function save(state) {
    var raw = JSON.stringify(state);
    var settings = config();
    try { window.localStorage.setItem(STORAGE_KEY, raw); } catch (e) { /* private mode */ }
    writeCookie(STORAGE_KEY, raw, settings.ttlDays, settings.cookieDomain);
  }

  /* ---------------- capture ---------------------------------------------- */

  function readTouch() {
    var params = queryParams();
    var touch = { origin: 'website', capturedAt: nowIso(), deviceType: deviceType() };

    for (var i = 0; i < CLICK_PARAMS.length; i += 1) {
      var candidate = params[CLICK_PARAMS[i].param];
      if (candidate) {
        touch.clickIdType = CLICK_PARAMS[i].type;
        touch.clickId = candidate;
        break;
      }
    }
    for (var param in UTM_MAP) {
      if (Object.prototype.hasOwnProperty.call(UTM_MAP, param) && params[param]) {
        touch[UTM_MAP[param]] = params[param];
      }
    }

    touch.landingUrl = String(window.location.href || '').slice(0, 1000);
    touch.referrerUrl = String(document.referrer || '').slice(0, 1000);

    // A decorated link from another domain carries the ORIGINAL landing time.
    // Without this the enquiry site would stamp the moment they arrived here,
    // losing how long the visitor actually took to decide.
    if (params[HANDOFF_TIME_PARAM]) touch.capturedAt = params[HANDOFF_TIME_PARAM];

    // Keep whatever else came in; the server stores it verbatim for auditing
    // and can classify a platform this script has never heard of.
    touch.params = params;
    return touch;
  }

  /** Worth recording only if it says something about where they came from. */
  function isMeaningful(touch) {
    return Boolean(touch.clickId || touch.campaignSource || touch.campaignName);
  }

  /** Same advertisement as last time -- refresh, back button, second page. */
  function sameAs(a, b) {
    if (!a || !b) return false;
    return String(a.clickId || '') === String(b.clickId || '')
      && String(a.campaignName || '') === String(b.campaignName || '')
      && String(a.campaignSource || '') === String(b.campaignSource || '');
  }

  function capture() {
    var touch = readTouch();
    var state = load();

    if (!state) {
      // Nothing stored. Record the landing either way: an organic visit is
      // still a fact worth having, and it becomes touch 1.
      state = { version: 1, touches: [touch], expiresAt: null };
      state.expiresAt = new Date(Date.now() + config().ttlDays * 864e5).toISOString();
      save(state);
      return state;
    }

    // The first touch is never overwritten. A later advertisement is
    // appended, which is what lets the CRM report first and last touch.
    var last = state.touches[state.touches.length - 1];
    if (isMeaningful(touch) && !sameAs(touch, last)) {
      state.touches.push(touch);
      if (state.touches.length > MAX_TOUCHES) {
        // Drop from the middle: the first touch and the recent ones matter.
        state.touches = [state.touches[0]].concat(state.touches.slice(-(MAX_TOUCHES - 1)));
      }
      save(state);
    }
    return state;
  }

  /* ---------------- cross-domain handoff ---------------------------------- */

  /*
   * Append the first touch to a URL.
   *
   * Needed when the enquiry form lives on a different domain from the site
   * the advertisement landed on: cookies and localStorage are both scoped to
   * one domain, so the only way across is the link itself.
   *
   * The identifiers go back under the platform's own parameter names --
   * gclid=..., utm_source=... -- so the copy of this script on the receiving
   * site captures them exactly as if the visitor had just clicked the ad.
   * No second vocabulary, no special-casing on the far side.
   */
  function decorate(url) {
    try {
      var state = load();
      if (!state || !state.touches.length) return url;
      var first = state.touches[0];

      var extra = [];
      var add = function (key, value) {
        if (value) extra.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
      };

      // click_id_type matches the platform's parameter name by design.
      if (first.clickIdType && first.clickId) add(first.clickIdType, first.clickId);
      for (var param in UTM_MAP) {
        if (Object.prototype.hasOwnProperty.call(UTM_MAP, param)) add(param, first[UTM_MAP[param]]);
      }
      // Nothing to hand off. Leave the link exactly as the site authored it:
      // a landing time on its own says nothing about where they came from,
      // and every organic visit would otherwise get its links rewritten.
      if (!extra.length) return url;
      add(HANDOFF_TIME_PARAM, first.capturedAt);

      var text = String(url);
      // Never clobber a parameter the link already carries; an explicitly
      // tagged link is a deliberate choice and outranks stored history.
      var existing = text.indexOf('?') === -1 ? '' : text.slice(text.indexOf('?') + 1);
      var kept = [];
      for (var i = 0; i < extra.length; i += 1) {
        var name = extra[i].split('=')[0];
        if (existing.indexOf(name + '=') === -1) kept.push(extra[i]);
      }
      if (!kept.length) return text;

      var hash = '';
      var hashAt = text.indexOf('#');
      if (hashAt !== -1) { hash = text.slice(hashAt); text = text.slice(0, hashAt); }
      return text + (text.indexOf('?') === -1 ? '?' : '&') + kept.join('&') + hash;
    } catch (e) {
      return url;
    }
  }

  /** Rewrite links to the configured other-domain hosts, once the DOM is up. */
  function decorateLinks() {
    var domains = config().linkDomains;
    if (!domains.length) return;
    var anchors = document.getElementsByTagName('a');
    for (var i = 0; i < anchors.length; i += 1) {
      var anchor = anchors[i];
      var href = anchor.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) continue;
      var host = '';
      try { host = String(anchor.hostname || '').toLowerCase(); } catch (e) { continue; }
      if (!host) continue;
      for (var d = 0; d < domains.length; d += 1) {
        if (host === domains[d] || host.slice(-(domains[d].length + 1)) === '.' + domains[d]) {
          var next = decorate(anchor.href);
          if (next !== anchor.href) anchor.setAttribute('href', next);
          break;
        }
      }
    }
  }

  /* ---------------- public surface --------------------------------------- */

  var api = {
    /** The payload to send with a lead. First touch, plus the rest for audit. */
    get: function () {
      var state = load() || capture();
      if (!state || !state.touches.length) return null;
      var first = state.touches[0];
      var payload = {};
      for (var i = 0; i < FIELDS.length; i += 1) {
        var field = FIELDS[i];
        if (first[field] != null && first[field] !== '') payload[field] = first[field];
      }
      payload.origin = payload.origin || 'website';
      // Later touches travel alongside rather than replacing anything.
      if (state.touches.length > 1) payload.laterTouches = state.touches.slice(1);
      if (first.params) payload.params = first.params;
      return payload;
    },

    /** Every touch, oldest first. */
    all: function () {
      var state = load();
      return state && state.touches ? state.touches.slice() : [];
    },

    /** Re-read the current URL. Call after a client-side route change. */
    refresh: function () { return capture(); },

    /** Append the stored first touch to a URL on another domain. */
    decorate: decorate,

    /** Re-scan the page for links to decorate, after content is injected. */
    decorateLinks: decorateLinks,

    /** Forget everything, for a consent withdrawal or a test. */
    clear: function () {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      writeCookie(STORAGE_KEY, '', -1, config().cookieDomain);
    },

    fields: FIELDS.slice()
  };

  window.crmAttribution = api;

  try { capture(); } catch (e) { /* never break the host page */ }

  // Links are decorated once the DOM exists. Wrapped because a thrown error
  // here would be an error on someone else's marketing site.
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        try { decorateLinks(); } catch (e) { /* ignore */ }
      });
    } else {
      decorateLinks();
    }
  } catch (e) { /* ignore */ }
}(typeof window !== 'undefined' ? window : null, typeof document !== 'undefined' ? document : null));
