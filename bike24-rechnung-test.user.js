// ==UserScript==
// @name         Bike24 Rechnung-Test (Interceptor, nur Experiment)
// @namespace    https://github.com/MarkusP97/Bike24
// @version      1.0.0
// @description  EXPERIMENT: Schreibt „Rechnung“ lokal in die Antwort von /api/checkout/payment-methods zurück, um zu prüfen, ob nur das Frontend filtert oder der Server beim Kaufabschluss ablehnt. Standardmäßig AUS. Blockiert die finale Bestellung.
// @match        https://*.bike24.de/*
// @match        https://*.bike24.com/*
// @match        https://*.bike24.at/*
// @match        https://*.bike24.es/*
// @match        https://*.bike24.fr/*
// @match        https://*.bike24.it/*
// @match        https://*.bike24.nl/*
// @match        https://*.bike24.be/*
// @match        https://*.bike24.lu/*
// @match        https://*.bike24.fi/*
// @match        https://*.bike24.pl/*
// @match        https://*.bike24.dk/*
// @match        https://*.bike24.si/*
// @match        https://*.bike24.ie/*
// @match        https://*.bike24.ch/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

/*
 * Bike24 Rechnung-Test – verändert NUR im eigenen Browser, NUR die Antwort von
 * GET /api/checkout/payment-methods, NUR wenn „Rechnung“ darin fehlt.
 * Sendet keine Daten, ändert nichts am Server. Standardmäßig AUS (siehe docs/TEST-RECHNUNG.md).
 *
 * Einschalten:  localStorage.b24RechnungTest = '1'   (Konsole, dann Seite neu laden)
 * Ausschalten:  __b24Inject.off()                      (oder roter Banner → „Ausschalten“)
 *
 * Sicherheitsnetz (nur im AN-Zustand): Klicks auf Buttons wie „Zahlungspflichtig bestellen“ /
 * „Jetzt kaufen“ und POST/PUT-Anfragen an Bestell-Endpunkte werden blockiert. Das ist ein
 * zusätzliches Netz, kein Ersatz für Aufmerksamkeit: den finalen Button trotzdem NIE anklicken.
 */
(function () {
  'use strict';
  if (window.__b24Inject) return;

  const FLAG = 'b24RechnungTest', TPL_KEY = 'b24RechnungTpl';
  const PM = /\/api\/checkout\/payment-methods\/?$/;          // Mehrzahl! …/payment-method (Einzahl) bleibt unberührt
  const ORDER_ENDPOINT = /order/i, ORDER_OK = /orders-process|delivery-conditions/i;   // orders-process läuft auch bei jedem Seitenaufruf
  const ORDER_BUTTON = /zahlungspflichtig|kostenpflichtig|jetzt\s+(bestellen|kaufen|bezahlen)|bestellung\s+(abschicken|abschlie[ßs]en|aufgeben)|place\s+order|buy\s+now|pay\s+now|complete\s+(your\s+)?order/i;
  const FALLBACK_TPL = { id: 5, name: 'Rechnung', description: 'Mit Lieferung Ihrer Bestellung erhalten Sie von uns eine Rechnung mit Zahlungsziel. Diese können Sie unkompliziert per Überweisung innerhalb der vorgegebenen Frist bezahlen.', icons: ['PAYMENT_INVOICE'] };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } },
    sget(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sset(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* egal */ } }
  };
  const enabled = store.get(FLAG) === '1';
  const log = [];                                              // jede Veränderung und jede Blockade, mit Vorher/Nachher
  const blocked = [];
  const api = window.__b24Inject = {
    enabled, log, blocked,
    on() { store.set(FLAG, '1'); console.info('[Bike24 Test] AN – Seite neu laden.'); },
    off() { store.set(FLAG, '0'); console.info('[Bike24 Test] AUS – Seite neu laden.'); },
    status() { console.table({ aktiv: enabled, veraenderungen: log.length, blockiert: blocked.length }); return { aktiv: enabled, log, blocked }; }
  };
  if (!enabled) { console.info('[Bike24 Test] Rechnung-Test ist AUS. Einschalten: localStorage.b24RechnungTest = "1" und Seite neu laden.'); return; }

  // ── Banner (Shadow DOM, damit die Seite nicht stört und wir nicht von ihr gestört werden) ──
  let bannerText = null;
  function banner() {
    if (bannerText || !document.documentElement) return;
    const host = document.createElement('div'); host.style.cssText = 'all:initial;position:fixed;top:0;left:0;right:0;z-index:2147483647;pointer-events:none';
    const sh = host.attachShadow({ mode: 'closed' }), bar = document.createElement('div'), btn = document.createElement('button');
    bar.style.cssText = 'font:600 13px system-ui,sans-serif;background:#b00020;color:#fff;padding:6px 12px;display:flex;gap:12px;align-items:center;justify-content:center';
    bannerText = document.createElement('span'); btn.textContent = 'Ausschalten';
    btn.style.cssText = 'font:inherit;padding:2px 8px;cursor:pointer;pointer-events:auto'; btn.onclick = () => { api.off(); location.reload(); };
    bar.append(bannerText, btn); sh.append(bar); document.documentElement.append(host); refresh();
  }
  function refresh() { if (bannerText) bannerText.textContent = `🧪 TEST-MODUS: Antworten werden lokal verändert (${log.length}×) – nichts kaufen! Blockiert: ${blocked.length}`; }

  // ── Kern: die Zahlungsarten-Liste anpassen ──
  const nameOf = m => (m && typeof m.name === 'string' ? m.name : '?');
  const isInvoice = m => m && (m.id === 5 || /^rechnung$/i.test(String(m.name || '').trim()));
  function template(list) {
    const real = list.find(isInvoice);
    if (real) { store.sset(TPL_KEY, JSON.stringify(real)); return null; }       // echte Daten merken, falls sie mal geliefert werden
    try { const t = JSON.parse(store.sget(TPL_KEY)); if (t && isInvoice(t)) return t; } catch (e) { /* egal */ }
    return FALLBACK_TPL;
  }
  function transform(text, url) {   // gibt den neuen Text zurück – oder null, wenn nichts zu ändern ist
    let list; try { list = JSON.parse(text); } catch (e) { console.warn('[Bike24 Test] payment-methods ist kein JSON – nichts verändert.'); return null; }
    if (!Array.isArray(list)) { console.warn('[Bike24 Test] payment-methods ist kein Array – nichts verändert.'); return null; }
    const tpl = template(list);
    if (!tpl) { console.info('[Bike24 Test] „Rechnung“ ist in der Server-Antwort bereits enthalten – nichts verändert.'); return null; }
    const vorher = list.map(nameOf), after = [JSON.parse(JSON.stringify(tpl)), ...list];
    const entry = { zeit: new Date().toISOString(), url: String(url), vorher, nachher: after.map(nameOf), eingefuegt: tpl };
    log.push(entry); refresh();
    console.log('%c[Bike24 Test] Payment-Methods verändert: Rechnung hinzugefügt', 'font-weight:bold;color:#b00020');
    console.log('[Bike24 Test] Vorher (Server):', vorher.join(' | '));
    console.log('[Bike24 Test] Nachher (Seite):', entry.nachher.join(' | '));
    return JSON.stringify(after);
  }
  const matches = (u, method) => { try { return String(method || 'GET').toUpperCase() === 'GET' && PM.test(new URL(String(u), location.href).pathname); } catch (e) { return false; } };
  const isOrderCall = (u, method) => { try { return /^(POST|PUT|PATCH)$/i.test(method || 'GET') && ORDER_ENDPOINT.test(new URL(String(u), location.href).pathname) && !ORDER_OK.test(String(u)); } catch (e) { return false; } };
  const block = what => { blocked.push({ zeit: new Date().toISOString(), was: what }); refresh(); console.warn(`[Bike24 Test] BLOCKIERT: ${what} (Test-Modus verhindert Bestellabschluss)`); };

  // ── fetch ──
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') window.fetch = function (input, init) {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
    const method = (init && init.method) || (input && input.method) || 'GET';
    if (isOrderCall(url, method)) {
      block(`${String(method).toUpperCase()} ${url}`);
      return Promise.resolve(new Response('{"blockedByTestMode":true}', { status: 499, headers: { 'content-type': 'application/json' } }));
    }
    const p = origFetch.apply(this, arguments);
    if (!matches(url, method)) return p;
    return p.then(async res => {
      try {
        if (!res.ok) return res;
        const out = transform(await res.clone().text(), res.url || url);
        if (out === null) return res;
        const headers = new Headers(res.headers); headers.delete('content-length'); headers.delete('content-encoding');
        const neu = new Response(out, { status: res.status, statusText: res.statusText, headers });
        try { Object.defineProperty(neu, 'url', { value: res.url }); } catch (e) { /* egal */ }
        return neu;
      } catch (e) { console.warn('[Bike24 Test] Fehler beim Verändern – Original-Antwort wird verwendet:', e); return res; }
    });
  };

  // ── XMLHttpRequest ──
  const XP = XMLHttpRequest.prototype, origOpen = XP.open, origSend = XP.send;
  const dText = Object.getOwnPropertyDescriptor(XP, 'responseText'), dResp = Object.getOwnPropertyDescriptor(XP, 'response');
  XP.open = function (method, url) {
    this.__b24Block = false;
    try {
      if (isOrderCall(url, method)) { this.__b24Block = `${String(method).toUpperCase()} ${url}`; }
      else if (matches(url, method) && dText && dResp) hook(this, url);
    } catch (e) { /* Original-Verhalten bleibt */ }
    return origOpen.apply(this, arguments);
  };
  XP.send = function () {
    if (this.__b24Block) {
      block(this.__b24Block);
      setTimeout(() => { try { this.dispatchEvent(new ProgressEvent('error')); } catch (e) { /* egal */ } }, 0);
      return undefined;
    }
    return origSend.apply(this, arguments);
  };
  function hook(x, url) {
    let done = false, out = null;
    const patched = () => {
      if (x.readyState !== 4 || x.status < 200 || x.status >= 300) return null;
      if (!done) {
        done = true;
        try {
          const t = x.responseType === 'json' ? JSON.stringify(dResp.get.call(x)) : dText.get.call(x);
          out = t ? transform(t, url) : null;
        } catch (e) { console.warn('[Bike24 Test] XHR: Fehler beim Verändern – Original-Antwort wird verwendet:', e); }
      }
      return out;
    };
    Object.defineProperty(x, 'responseText', { configurable: true, get() { const o = x.responseType && x.responseType !== 'text' ? null : patched(); return o !== null ? o : dText.get.call(this); } });
    Object.defineProperty(x, 'response', {
      configurable: true, get() {
        const o = x.responseType === '' || x.responseType === 'text' || x.responseType === 'json' ? patched() : null;
        if (o === null) return dResp.get.call(this);
        return x.responseType === 'json' ? JSON.parse(o) : o;
      }
    });
  }

  // ── Sicherheitsnetz: finale Bestell-Buttons und -Formulare blockieren ──
  const labelOf = el => `${el.innerText || el.textContent || ''} ${el.value || ''} ${el.getAttribute('aria-label') || ''}`.trim();
  function guard(ev) {
    const el = ev.target && ev.target.closest ? ev.target.closest('button,[type=submit],[role=button],a,input[type=button]') : null;
    const form = ev.type === 'submit' ? ev.target : null;
    const text = el ? labelOf(el) : form ? labelOf(form.querySelector('[type=submit],button') || form) : '';
    if (!ORDER_BUTTON.test(text)) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    block(`${ev.type} auf „${text.replace(/\s+/g, ' ').slice(0, 60)}“`);
  }
  ['click', 'submit', 'auxclick'].forEach(t => document.addEventListener(t, guard, true));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner, { once: true }); else banner();
  console.info('[Bike24 Test] Rechnung-Test ist AN. Verändert wird nur GET /api/checkout/payment-methods; Bestell-Buttons sind blockiert.');
})();
