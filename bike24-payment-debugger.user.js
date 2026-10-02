// ==UserScript==
// @name         Bike24 Zahlungsarten-Debugger
// @namespace    https://github.com/MarkusP97/Bike24
// @version      2.1.0
// @description  Zeigt im Bike24-Checkout, welche Zahlungsarten verschwinden – wann, wie und durch welchen Code – und erstellt einen Bericht für den Support. Sendet keine Daten.
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
// @downloadURL  https://raw.githubusercontent.com/MarkusP97/Bike24/HEAD/bike24-payment-debugger.user.js
// @updateURL    https://raw.githubusercontent.com/MarkusP97/Bike24/HEAD/bike24-payment-debugger.user.js
// ==/UserScript==

// AUTOMATISCH ERZEUGT aus bike24-payment-debugger.js – bitte dort ändern und
// "node tools/build-userscript.mjs" ausführen.
window.B24_AUTO = true;   // Tampermonkey-Modus: still, bis auf der Seite Zahlungsarten auftauchen
/* ============================================================================
 * Bike24 Zahlungsarten-Debugger  v2.1.0
 * Vanilla JavaScript, keine Abhängigkeiten. Chrome / Edge / Brave / Firefox.
 * ----------------------------------------------------------------------------
 * WAS ES MACHT
 *   Beobachtet im Bike24-Checkout alle Zahlungsarten und meldet sofort, wenn
 *   eine verschwindet: WELCHE, WANN, WIE (CSS / entfernt / deaktiviert),
 *   durch WELCHEN Code (Datei + Zeile) und nach WELCHER Server-Antwort.
 *   Unten links erscheint ein kleines Panel mit Knopf "Bericht speichern".
 *   Es sendet NICHTS ins Internet: alles bleibt in deinem Browser, der Bericht
 *   ist eine Textdatei in deinem Download-Ordner.
 *
 * BENUTZUNG
 *   Einfachster Weg: Tampermonkey-Version (bike24-payment-debugger.user.js), siehe README.
 *   Konsole: F12 → Tab "Console" → einfügen → Enter (bei Warnung zuerst: allow pasting)
 *
 * BEFEHLE (in der Konsole eintippen)
 *   b24PayDbg.hilfe()      alle Befehle auf Deutsch erklärt
 *   b24PayDbg.status()     Tabelle: welche Zahlungsart ist da / weg / warum
 *   b24PayDbg.report()     Bericht (Support-Text + technischer Anhang) herunterladen
 *   b24PayDbg.compare()    Lauf mit 1 Artikel vs. Lauf mit mehreren Artikeln vergleichen
 *   b24PayDbg.find('css')  eigenen Selektor setzen, falls nichts gefunden wird
 *   b24PayDbg.stop()       alles abbauen, Seite ist wieder im Originalzustand
 *
 * BEISPIEL-OUTPUT (Konsole)
 *   [B24] ▶ Debugger v2.0.0 aktiv – 6 Zahlungsart(en) gefunden. Rot = verschwunden.
 *   ┌─────────┬─────────────┬───────────────┬──────┬────────────────┐
 *   │ (index) │ Zahlungsart │ Status        │ Grund│ Element        │
 *   │ 0       │ 'PayPal'    │ '✅ sichtbar' │ ''   │ '<li.payment>' │
 *   │ 1       │ 'Rechnung'  │ '✅ sichtbar' │ ''   │ '<li.payment>' │
 *   ▼ [B24] 🙈 14:02:10.640 (t+552ms) „Rechnung“ AUSGEBLENDET → display:none auf
 *         <li.payment.is-hidden> via CSS-Regel „.is-hidden { display: none; }“ aus checkout.css
 *       📍 Element: <li class="payment is-hidden">…</li>
 *       📝 Änderung: <li.payment.is-hidden> Attribut [class]: "payment" → "payment is-hidden"
 *       🧑‍💻 Ausgelöst von Bike24-Code: checkout.4f2a.js Zeile 1, Spalte 88213 → add("is-hidden")
 *       🌐 Server-Antwort 41ms vorher: POST /api/checkout/payment-methods → Status 200
 *          Auszug: {"paymentMethods":[{"code":"invoice","available":false,"reason":"MAX_AMOUNT"}…
 *       🛒 Warenkorb/Kontext: {summe: '412,97 €', artikel: '3', land: 'Deutschland', …}
 *       💡 Vermutung (nicht bewiesen): Betragsgrenze oder Bonitäts-/Risiko-Prüfung …
 *   (Zeitangabe t+…ms = Millisekunden seit Aufruf der Seite)
 * ========================================================================== */
(() => {
  'use strict';
  const AUTO = window.B24_AUTO === true;   // true = läuft als Tampermonkey-Skript: still, bis Zahlungsarten auftauchen

  // ── Doppelstart verhindern ───────────────────────────────────────────────────
  if (window.b24PayDbg) {
    if (!AUTO) console.info('%c[B24] ℹ️ Der Debugger läuft schon – nichts doppelt gestartet. Hilfe: b24PayDbg.hilfe()', 'color:#1a73e8');
    return;
  }

  const VERSION = '2.1.0', LS = 'b24PayDbg.runs', MAX = 300, PANEL_ID = 'b24-dbg-panel', T0 = Date.now();
  const state = new Map();                                   // Schlüssel → beobachtete Zahlungsart
  const events = [], muts = [], calls = [], net = [], cssAdds = [], restore = [];
  const owner = new WeakMap(), claimed = new WeakSet(), proxies = new WeakMap(), xhrInfo = new WeakMap();
  let custom = null, timer = 0, tablePrinted = false, stopped = false, pendingGone = null, ctxCache = null;
  let panelHost = null, panelMin = false, panelMsg = '';

  // ── Erkennungsmuster (bewusst generisch, damit Klassen-Änderungen bei Bike24 nichts kaputt machen) ──
  const KW = /paypal|klarna|kreditkarte|credit ?card|\bvisa\b|mastercard|\bamex\b|american express|\brechnung\b|invoice|vorkasse|vorauskasse|prepay|überweisung|bank ?transfer|lastschrift|\bsepa\b|giropay|apple ?pay|google ?pay|amazon ?pay|ratenkauf|ratenzahlung|installment|finanzierung|nachnahme|cash on delivery|twint|\bideal\b|bancontact|przelewy|\bblik\b|\beps\b|pay ?later|postfinance/i;
  const NETKW = /payment|zahlung|paypal|klarna|invoice|rechnung|prepay|vorkasse|creditcard|kreditkarte/i;
  const ATTR = /pay|zahl/i;                                  // name/id/value eines Radio-Buttons
  const NEGATTR = /ship|versand|deliver|liefer|adress|address|newsletter|salutation|anrede|gender/i;   // Versand-/Adress-Radios ausschließen
  const NEGTXT = /adresse|address|newsletter|anrede/i;                                              // "Rechnungsadresse" ≠ Zahlungsart
  const HIDE = /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d]*[1-9])/i;
  const COL = { red: 'color:#d93025;font-weight:bold', green: 'color:#188038', blue: 'color:#1a73e8;font-weight:bold', grey: 'color:#888' };

  // ── Kleine Helfer ────────────────────────────────────────────────────────────
  const now = () => performance.now();
  const clock = () => { const d = new Date(); return `${d.toLocaleTimeString('de-DE')}.${String(d.getMilliseconds()).padStart(3, '0')}`; };
  const cut = (s, n = 80) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
  const txt = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();
  const desc = n => !n || n.nodeType !== 1 ? String(n) : `<${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${[...n.classList].slice(0, 4).map(c => '.' + c).join('')}>`;
  const snip = n => cut((n?.outerHTML || '').replace(/\s+/g, ' '), 600);
  const av = v => v == null ? 'nicht gesetzt' : v === '' ? 'gesetzt' : `"${cut(v)}"`;   // Attributwert lesbar machen
  const keep = (arr, x) => { arr.push(x); if (arr.length > MAX) arr.shift(); return x; };
  const labelOf = s => (s.labels && s.labels[0]) || s.closest?.('label') || null;
  const nameOf = (el, seed) => cut(txt(seed && labelOf(seed)) || txt(el) || el.querySelector?.('img[alt]')?.alt || el.getAttribute?.('aria-label') || el.title || seed?.value || desc(el), 60);
  const related = (n, el) => !!n && n.nodeType === 1 && !!el && (n === el || n.contains(el) || el.contains(n));
  const rel = n => { if (!n || n.nodeType !== 1) return false; for (const o of state.values()) if (related(n, o.el)) return true; return false; };
  const relKeys = n => [...state.values()].filter(o => related(n, o.el)).map(o => o.k);    // welche Zahlungsarten betrifft das JETZT?
  const hits = (x, o) => x.keys.includes(o.k) || related(x.n, o.el);
  const say = (style, msg) => console.log('%c[B24] ' + msg, style);
  const getCtx = () => ctxCache || (ctxCache = ctx());

  // Stack-Trace erzeugen (länger als Standard, damit auch Bike24-Code hinter Framework-Code sichtbar wird)
  let SELF = '';                                            // Dateiname dieses Skripts im Stack (wird unten ermittelt)
  function mkErr(label) {
    let old; try { old = Error.stackTraceLimit; Error.stackTraceLimit = 50; } catch (e) { /* egal */ }
    const err = new Error('[B24] kein echter Fehler – nur der Weg zum auslösenden Code: ' + label);
    try { Error.stackTraceLimit = old; } catch (e) { /* egal */ }
    // eigene Zeilen (Debugger-Interna) aus dem Stack entfernen → erste Zeile = Code der Seite
    if (SELF) try { err.stack = err.stack.split('\n').filter(l => { const f = parseFrame(l); return !f || f.file !== SELF; }).join('\n'); } catch (e) { /* egal */ }
    return err;
  }
  // Eine Stack-Zeile zerlegen (Chrome: "at fn (datei:1:2)", Firefox: "fn@datei:1:2")
  const parseFrame = l => { const m = String(l).match(/(?:\bat\s+(?:(.*?)\s+\()?|^\s*([^@\s]*)@)(.*?):(\d+):(\d+)\)?\s*$/); return m ? { fn: m[1] || m[2] || '', file: m[3], line: +m[4], col: +m[5] } : null; };
  SELF = ((mkErr('self').stack || '').split('\n').map(parseFrame).find(Boolean) || {}).file || '';         // eigene Datei rausfiltern
  function culprit(err) {   // erste Stack-Zeile, die NICHT vom Debugger selbst stammt = Bike24-Code
    const f = (err?.stack || '').split('\n').map(parseFrame).find(x => x && x.file !== SELF && !/^(chrome|moz|safari)-extension:|^userscript/i.test(x.file));
    return f ? `${f.file.split(/[?#]/)[0].split('/').pop() || f.file} Zeile ${f.line}, Spalte ${f.col}${f.fn ? ' (Funktion ' + f.fn + ')' : ''}` : '';
  }

  // ── 1) Zahlungsarten finden: generische Selektoren mit Fallbacks ──────────────
  //  Stufe 1: Radio-Buttons, deren name/id/value nach Zahlung aussieht ODER deren Beschriftung eine Zahlungsart nennt
  //  Stufe 2 (falls Stufe 1 nichts findet): Text/Logo-Elemente (label, li, role=option …) mit Zahlungs-Keywords
  //  Footer/Header/Nav werden ignoriert (dort stehen oft nur Logos aller Zahlungsarten)
  const outside = e => !e.closest('footer,header,nav,#' + PANEL_ID);
  function findOptions() {
    const q = s => [...document.querySelectorAll(s)].filter(outside);
    let seeds;
    if (custom) seeds = q(custom);
    else {
      seeds = q('input[type=radio],[role=radio]').filter(r => {
        const a = `${r.name || ''} ${r.id} ${r.value || ''} ${r.getAttribute('data-testid') || ''}`, l = txt(labelOf(r) || r.closest('li') || r.parentElement);
        return ATTR.test(a) || (KW.test(l) && !NEGATTR.test(a) && !NEGTXT.test(l));
      });
      if (!seeds.length) seeds = q('label,li,[role=option],button,[data-payment],[data-payment-method],[data-testid*=payment i]')
        .filter(e => { const t = txt(e); return t.length < 200 && KW.test(t || e.querySelector('img[alt]')?.alt || '') && !NEGTXT.test(t); });
    }
    seeds = seeds.filter(s => !seeds.some(o => o !== s && s.contains(o)));            // nur die innersten Treffer
    const used = new Set();
    return seeds.map(seed => {
      // Vom Radio-Button zur ganzen "Zeile" hochklettern, solange sie genau EINE Zahlungsart enthält
      let el = seed;
      for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement && p.tagName !== 'FORM'
        && txt(p).length < 400 && seeds.filter(x => p.contains(x)).length === 1; p = p.parentElement) el = p;
      const v = seed.value && seed.value !== 'on' ? `${seed.name || ''}=${seed.value}` : '';
      const base = v || nameOf(el, seed); let k = base, i = 1;
      while (used.has(k)) k = `${base} #${++i}`;
      used.add(k);
      return { k, el, seed };
    });
  }

  // ── 2) Sichtbarkeit + exakte Methode des Ausblendens ──────────────────────────
  const visEl = e => {
    if (!e || !e.isConnected) return false;
    const r = e.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && (!e.checkVisibility || e.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  };
  const shown = o => { const l = o.useLabel && labelOf(o.seed); return visEl(o.el) && (!l || !o.el.contains(l) || visEl(l)); };
  const isDis = o => { try { return !!(o.seed.matches(':disabled') || o.seed.getAttribute('aria-disabled') === 'true' || o.el.getAttribute('aria-disabled') === 'true' || o.el.closest('[inert]')); } catch (e) { return false; } };

  // Sucht in allen lesbaren Stylesheets die CSS-Regel, die das Element versteckt
  function cssRuleFor(n, prop) {
    const ok = { display: v => v === 'none', visibility: v => v === 'hidden' }[prop] || (v => v !== '' && parseFloat(v) === 0);
    const found = []; let blocked = 0;
    const walk = (rules, src) => {
      for (const r of rules || []) {
        try {
          if (r.selectorText && ok(r.style.getPropertyValue(prop)) && n.matches(r.selectorText)) found.push(`„${cut(r.cssText, 140)}“ aus ${src}`);
          if (r.cssRules) walk(r.cssRules, src);                                       // @media, @supports, @layer, Nesting
        } catch (e) { /* ungültiger Selektor o.ä. */ }
      }
    };
    for (const sh of [...document.styleSheets, ...(document.adoptedStyleSheets || [])]) {
      let rules; try { rules = sh.cssRules; } catch (e) { blocked++; continue; }      // fremde Domain → nicht lesbar
      walk(rules, sh.href ? sh.href.split(/[?#]/)[0].split('/').pop() : sh.ownerNode ? '<style>-Block im HTML' : 'per JavaScript erzeugtem Stylesheet');
    }
    if (found.length) return 'CSS-Regel ' + found.slice(-2).join(' + ');
    return `CSS-Regel über Klasse "${cut(n.className, 80)}"${blocked ? ` (${blocked} Stylesheet(s) von fremder Domain sind nicht lesbar)` : ''}`;
  }
  const reason = o => o.vis && !o.gone ? (o.dis ? 'DEAKTIVIERT (disabled / nicht anklickbar)' : '') : whyHidden(o);
  function whyHidden(o) {
    if (!o.el.isConnected) return 'DOM-Knoten ENTFERNT (per JavaScript aus der Seite gelöscht)';
    const l = o.useLabel && labelOf(o.seed);
    const start = l && o.el.contains(l) && visEl(o.el) ? l : o.el;
    for (let n = start; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n), d = desc(n);
      const via = p => n.style.getPropertyValue(p) ? `Inline-Style style="${cut(n.getAttribute('style'), 100)}" (direkt per JavaScript gesetzt)` : cssRuleFor(n, p);
      if (cs.display === 'none') return `display:none auf ${d} via ${n.hidden ? 'hidden-Attribut' : via('display')}`;
      if (cs.visibility === 'hidden' && (!n.parentElement || getComputedStyle(n.parentElement).visibility !== 'hidden')) return `visibility:hidden auf ${d} via ${via('visibility')}`;
      if (parseFloat(cs.opacity) === 0) return `opacity:0 (durchsichtig) auf ${d} via ${via('opacity')}`;
      if (cs.contentVisibility === 'hidden') return `content-visibility:hidden auf ${d}`;
      if (n !== document.body && (parseFloat(cs.height) === 0 || parseFloat(cs.maxHeight) === 0) && cs.overflow !== 'visible')
        return `Höhe 0 + overflow:${cs.overflow} auf ${d} (zugeklappt) via ${via(parseFloat(cs.maxHeight) === 0 ? 'max-height' : 'height')}`;
    }
    if (o.el.closest('[inert]')) return 'inert-Attribut (nicht bedienbar)';
    return 'Größe 0 oder außerhalb des sichtbaren Bereichs – Ursache siehe „Änderung“-Zeilen';
  }

  // ── 3) Kontext: Hinweise, WARUM es nur beim Mehrfach-Kauf passiert ────────────
  function ctx() {
    const t = document.body?.innerText || '';
    const pick = (...res) => { for (const re of res) { const m = t.match(re); if (m) return m[1].trim(); } return '?'; };
    const P = '((?:€|EUR|CHF|£)\\s*\\d[\\d.,\']*|\\d[\\d.,\']*\\s*(?:€|EUR|CHF|£))';
    return {
      summe: pick(new RegExp(`(?:gesamtsumme|gesamtbetrag|gesamtpreis|zu zahlen|endbetrag|order total|grand total)[^\\d€£]{0,40}${P}`, 'i'), new RegExp(`(?:gesamt|summe|total)[^\\d€£]{0,40}${P}`, 'i')),
      artikel: pick(/(\d+)\s*(?:artikel|positionen|produkte|items?)\b/i, /warenkorb\s*\(\s*(\d+)\s*\)/i),
      land: txt(document.querySelector('select[name*=country i],select[id*=country i],select[name*=land i],select[autocomplete*=country]')?.selectedOptions?.[0]) || '?',
      hinweise: [...new Set((t.match(/[^\n]{0,60}(?:sperrgut|speditions?versand|spedition|vorbestell|nicht verfügbar|nicht möglich|nur bis|höchstbetrag|maximal|mindestbestellwert|bonität|lieferbar (?:in|ab)|nicht auf lager)[^\n]{0,60}/gi) || []).map(s => s.trim()))].slice(0, 6),
      warenkorbApi: lastCart ? `${lastCart.positionen ?? '?'} Position(en), ${lastCart.stueck || '?'} Stück; ${lastCart.summen.join(', ') || 'keine Summe gefunden'}` : '',
      applePayImBrowser: 'ApplePaySession' in window, paymentRequestImBrowser: 'PaymentRequest' in window, seite: location.pathname
    };
  }
  function guess(name, c) {
    const g = [];
    if (/rechnung|invoice|klarna|raten|installment|finanzierung|pay ?later/i.test(name)) g.push('Betragsgrenze oder Bonitäts-/Risiko-Prüfung des Zahlungsanbieters (bei mehreren Artikeln steigt die Summe)');
    if (/vorkasse|vorauskasse|prepay|überweisung|transfer/i.test(name)) g.push('gemischter Warenkorb (unterschiedliche Lieferzeiten/Lager) oder Betragsgrenze');
    if (/apple|google ?pay/i.test(name)) g.push('Browser-Erkennung (ApplePaySession/PaymentRequest) bzw. Wallet-Prüfung');
    if (/nachnahme|cash on delivery/i.test(name)) g.push('Versandart/Sperrgut – Nachnahme gibt es oft nur beim Standard-Paketversand');
    if (c.hinweise.some(h => /sperrgut|spedition/i.test(h))) g.push('Sperrgut-/Speditionsartikel im Warenkorb');
    if (c.hinweise.some(h => /vorbestell|lieferbar (in|ab)|nicht auf lager/i.test(h))) g.push('Artikel mit Vorbestellung/längerer Lieferzeit im Warenkorb');
    if (!g.length) g.push('Betragsgrenze, Sperrgut, gemischter Warenkorb, Lieferland/Packstation oder Risiko-Prüfung');
    return 'Vermutung (nicht bewiesen): ' + g.join(' ODER ');
  }
  const browserName = () => {
    const b = navigator.userAgentData?.brands?.filter(x => !/not.?a.?brand|chromium/i.test(x.brand)).map(x => `${x.brand} ${x.version}`).join(', ');
    const os = navigator.userAgentData?.platform || (navigator.userAgent.match(/\(([^;)]+)/) || [])[1] || '';
    return `${b || navigator.userAgent}${navigator.brave ? ' (Brave)' : ''} / ${os}`;
  };

  // ── 4) Ereignis melden: Kopfzeile sofort lesbar, alle Beweise darunter ───────
  function emit(icon, o, what, bad, tRef = now()) {
    const win = x => x.t <= tRef + 50 && tRef - x.t < 1500;
    const m = muts.filter(x => win(x) && (x.css ? bad && cssHides({ node: x.n }, o.el) : hits(x, o)));
    const c = calls.filter(x => win(x) && hits(x, o));
    const css = bad ? cssAdds.filter(x => x.t <= tRef + 50 && tRef - x.t < 4000 && cssHides(x, o.el)) : [];
    const recent = net.filter(x => x.end && x.end <= tRef + 50 && tRef - x.end < 4000);
    const srv = recent.filter(x => x.hit || NETKW.test(x.url));
    const k = getCtx();
    const list = [...net].reverse().find(x => x.methods && x.end && x.end <= tRef + 50);
    const inList = list ? list.methods.some(n => norm(n) === norm(o.name)) : null;
    const ev = {
      zeit: clock(), msNachSeitenaufruf: Math.round(tRef), typ: icon, zahlungsart: o.name, was: what, schlimm: bad,
      htmlVorher: o.html, htmlNachher: o.el.isConnected ? snip(o.el) : '(aus der Seite entfernt)',
      aenderungen: m.map(x => x.txt),
      code: c.map(x => ({ aufruf: `${x.op} auf ${x.target}`, wo: culprit(x.err), stack: x.err.stack })),
      css: css.map(x => ({ was: x.text, wo: culprit(x.err), stack: x.err.stack })),
      server: srv.map(x => ({ methode: x.m, url: x.url, status: x.st, fertigMs: Math.round(x.end), auszug: x.hit })),
      serverListe: list ? { url: list.url, msVorher: Math.round(tRef - list.end), enthaeltZahlungsart: inList, erlaubteZahlungsarten: list.methods } : null,
      weitereRequests: recent.length - srv.length, kontext: k, vermutung: bad ? guess(o.name, k) : ''
    };
    events.push(ev);
    o.last = `${icon} ${what.split(' →')[0].toLowerCase()} (t+${Math.round(tRef)}ms)`;
    const head = `${icon} ${ev.zeit} (t+${Math.round(tRef)}ms) „${o.name}“ ${what}`;
    if (!bad) { console.groupCollapsed('%c[B24] ' + head, COL.green); console.log('📍 Element:', o.el); console.groupEnd(); return; }
    console.group('%c[B24] ' + head, COL.red);
    console.log('📍 Element (anklicken = in der Seite zeigen):', o.el);
    console.log('📄 HTML vorher:', ev.htmlVorher, '\n📄 HTML nachher:', ev.htmlNachher);
    m.forEach(x => console.log('📝 Änderung:', x.txt));
    if (c.length) c.forEach(x => console.log(`🧑‍💻 Ausgelöst von Bike24-Code: ${culprit(x.err) || '(Datei unbekannt)'} → ${x.op}\n   Kompletter Weg dorthin (blaue Links anklickbar):`, x.err));
    else console.log('🧑‍💻 Kein auslösender Code erfasst (z.B. weil das Skript zu spät gestartet wurde). Tipp: README → „Code-Stelle manuell finden“.');
    css.forEach(x => console.log(`🎨 Versteckende CSS-Regel per JavaScript eingefügt: ${x.text}\n   von: ${culprit(x.err)}`, x.err));
    if (list && inList === false) console.log(`%c🎯 SERVER-ENTSCHEIDUNG: Die Antwort von ${list.m} ${list.url} (${Math.round(tRef - list.end)}ms vorher) enthält „${o.name}“ NICHT mehr.\n   Erlaubt laut Server: ${list.methods.join(', ')}\n   → Das JavaScript zeigt nur an, was der Server erlaubt. Die Regel steckt im Bike24-Backend.`, 'font-weight:bold');
    srv.forEach(x => console.log(`🌐 Server-Antwort ${Math.round(tRef - x.end)}ms vorher: ${x.m} ${x.url} → Status ${x.st}${x.hit ? '\n   Auszug: ' + x.hit : ''}`));
    if (ev.weitereRequests) say(COL.grey, `   (+${ev.weitereRequests} weitere Requests ohne erkennbaren Zahlungsbezug – stehen im Bericht)`);
    console.log('🛒 Warenkorb/Kontext:', k);
    console.log('💡 ' + ev.vermutung);
    console.groupEnd();
  }
  // Prüft, ob eine per JavaScript eingefügte CSS-Regel/Stylesheet dieses Element (oder ein Eltern-Element) versteckt
  function cssHides(x, el) {
    try {
      if (x.node?.sheet) { const hit = []; const walk = rs => { for (const r of rs || []) { try { if (r.selectorText && HIDE.test(r.style.cssText) && el.closest(r.selectorText)) hit.push(r); if (r.cssRules) walk(r.cssRules); } catch (e) { /* weiter */ } } }; walk(x.node.sheet.cssRules); return hit.length > 0; }
      for (const [, sel, body] of String(x.text).matchAll(/([^{}]+)\{([^{}]*)\}/g)) { try { if (HIDE.test(body) && el.closest(sel.trim())) return true; } catch (e) { /* weiter */ } }
    } catch (e) { /* fremde Domain */ }
    return false;
  }

  // ── 5) Abgleich vorher/nachher: eine Meldung pro echter Änderung, keine Log-Flut ──
  function scan() {
    timer = 0; ctxCache = null;
    if (stopped || !document.body) return;
    const found = findOptions(), seen = new Set(), silent = !tablePrinted, n0 = events.length;
    for (const { k, el, seed } of found) {
      seen.add(k);
      let o = state.get(k);
      if (!o) {
        const l = seed.matches?.('input') && labelOf(seed);
        o = { k, el, seed, name: nameOf(el, seed), useLabel: !!l && el.contains(l) && visEl(l), html: snip(el), last: '' };
        o.vis = shown(o); o.dis = isDis(o); state.set(k, o); claim(o);
        if (!silent) o.vis ? emit('➕', o, 'NEU erschienen', false) : emit('👻', o, 'erschienen, aber UNSICHTBAR → ' + whyHidden(o), true);
        continue;
      }
      if (o.el !== el || o.seed !== seed) { o.el = el; o.seed = seed; claim(o); }       // Framework hat neu gerendert
      const vis = shown(o), dis = isDis(o);
      if (o.gone) { o.gone = false; if (vis && !pendingGone) emit('↩️', o, 'wieder DA', false); }
      else if (o.vis && !vis) emit('🙈', o, 'AUSGEBLENDET → ' + whyHidden(o), true);
      else if (!o.vis && vis) emit('👀', o, 'jetzt SICHTBAR', false);
      if (o.dis !== dis) emit(dis ? '🚫' : '✅', o, dis ? 'DEAKTIVIERT (nicht mehr anklickbar)' : 'wieder AKTIV', dis);
      o.vis = vis; o.dis = dis; if (vis) o.html = snip(el);
    }
    // Liste wurde neu aufgebaut: wer fehlt jetzt?
    if (pendingGone && seen.size) {
      const missing = pendingGone.list.filter(o => !seen.has(o.k));
      say(COL.grey, `ℹ️ Zahlungsarten-Liste neu aufgebaut: ${pendingGone.list.length - missing.length} von ${pendingGone.list.length} wieder da.`);
      missing.forEach(o => emit('❌', o, 'FEHLT nach Neuaufbau der Liste → DOM-Knoten ENTFERNT', true, pendingGone.t));
      pendingGone = null;
    }
    const alive = [...state.values()].filter(o => !o.gone), vanished = alive.filter(o => !seen.has(o.k));
    if (silent) vanished.forEach(o => state.delete(o.k));                           // während des Ladens ersetzt (z.B. Vue-Template) → kein Alarm
    else if (vanished.length > 1 && vanished.length === alive.length && !seen.size) {
      // Komplette Liste weg: entweder Seitenwechsel (kein Bug) oder Neuaufbau → abwarten statt Fehlalarm
      pendingGone = { t: now(), list: vanished.filter(o => o.vis) };
      vanished.forEach(o => { o.gone = true; o.vis = false; });
      say(COL.grey, 'ℹ️ Zahlungsarten-Liste komplett entfernt (Seitenwechsel oder Neuaufbau) – ich prüfe, ob sie wiederkommt.');
    } else vanished.forEach(o => { if (o.vis) emit('❌', o, 'VERSCHWUNDEN → ' + whyHidden(o), true); o.gone = true; o.vis = false; });

    let first = false;
    if (!tablePrinted && state.size && document.readyState !== 'loading') { tablePrinted = first = true; firstReport(); }
    if (first || events.length !== n0) { saveRun(); renderPanel(); }
  }
  function schedule() { if (!timer && !stopped) timer = setTimeout(scan, 30); }        // max. 1 Abgleich pro 30ms
  // Zahlungsart + alle Eltern-Elemente markieren → Hooks erfassen dort Code-Aufrufe
  function claim(o) {
    const mark = n => { claimed.add(n); owner.set(n.classList, n); };
    for (let n = o.el; n && n.nodeType === 1; n = n.parentElement) mark(n);
    [o.seed, labelOf(o.seed)].forEach(n => n && n.nodeType === 1 && o.el.contains(n) && mark(n));   // Radio + Beschriftung
    try { ro.observe(o.el); } catch (e) { /* alter Browser */ }
  }
  function firstReport() {
    const all = [...state.values()], bad = all.filter(o => !o.vis || o.dis), good = all.length - bad.length;
    say(COL.blue, `▶ ${clock()} – ${all.length} Zahlungsart(en) gefunden, ${good} davon sichtbar. Ich beobachte jetzt. Rot = verschwunden.`);
    api.status();
    if (bad.length && good) console.warn(`[B24] ⚠️ ${bad.length} Zahlungsart(en) sind schon beim Start unsichtbar/deaktiviert: ${bad.map(o => o.name).join(', ')}.\n` +
      'Den Grund siehst du in der Tabelle (Spalte „Grund“). Den auslösenden CODE siehst du nur, wenn das Skript VOR dem Laden der Seite läuft → README, Weg A (Tampermonkey).');
    say(COL.grey, 'Bericht für den Support: Knopf „Bericht speichern“ im Panel unten links – oder b24PayDbg.report()');
  }

  // ── 6) MutationObserver: beobachtet das GANZE Dokument, auch später nachgeladene Elemente ──
  const maybeOption = n => { try { return n.matches('input[type=radio],[role=radio]') || !!n.querySelector('input[type=radio],[role=radio]') || (custom && (n.matches(custom) || !!n.querySelector(custom))) || KW.test(cut(n.textContent, 3000)); } catch (e) { return false; } };
  const mo = new MutationObserver(records => {
    const t = now(); let hit = false;
    for (const r of records) {
      const tg = r.target;
      if (tg.id === PANEL_ID) continue;
      if (r.type === 'attributes') {
        if (rel(tg)) { hit = true; keep(muts, { t, n: tg, keys: relKeys(tg), txt: `${desc(tg)} Attribut [${r.attributeName}]: ${av(r.oldValue)} → ${av(tg.getAttribute(r.attributeName))}` }); }
      } else if (r.type === 'characterData') {
        const p = tg.parentElement; if (p && rel(p)) { hit = true; keep(muts, { t, n: p, keys: relKeys(p), txt: `Text in ${desc(p)}: "${cut(r.oldValue)}" → "${cut(tg.data)}"` }); }
      } else {
        if (rel(tg)) hit = true;
        r.removedNodes.forEach(n => { if (n.nodeType === 1 && rel(n)) { hit = true; keep(muts, { t, n, keys: relKeys(n), txt: `${desc(n)} wurde aus ${desc(tg)} ENTFERNT` }); } });
        r.addedNodes.forEach(n => {
          if (n.nodeType !== 1 || n.id === PANEL_ID) return;
          if ((n.tagName === 'STYLE' || (n.tagName === 'LINK' && /stylesheet/i.test(n.rel))) && document.readyState !== 'loading') { hit = true; keep(muts, { t, n, keys: [], css: true, txt: `Stylesheet eingefügt: ${n.href || '<style> ' + cut(n.textContent)}` }); }
          else if (!hit && maybeOption(n)) hit = true;
        });
      }
    }
    if (hit) schedule();
  });
  // ResizeObserver: meldet, wenn eine Zahlungsart auf 0×0 schrumpft – auch wenn KEIN HTML geändert wurde (z.B. per CSSOM)
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : { observe() {}, disconnect() {} };

  // ── 7) Hooks auf DOM-Funktionen: liefern den STACK = welche Datei/Zeile blendet aus ──
  //  Greifen NUR, wenn eine Zahlungsart (oder ihre Eltern/Kinder) betroffen ist → kaum Overhead.
  //  Proxy statt Ersatzfunktion: Verhalten, Name und toString() bleiben wie das Original.
  function note(n, op, args) {
    try {
      if (stopped || !n || !rel(n)) return;
      keep(calls, { t: now(), n, keys: relKeys(n), target: desc(n), op: `${op}(${args.map(x => x?.nodeType ? desc(x) : typeof x === 'string' ? JSON.stringify(cut(x, 60)) : cut(JSON.stringify(x), 60)).join(', ')})`, err: mkErr(op) });
    } catch (e) { /* der Debugger darf die Seite niemals stören */ }
  }
  function hook(proto, prop, getEl) {
    const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.configurable || (!d.set && typeof d.value !== 'function')) return;
    const wrapped = new Proxy(d.set || d.value, { apply(f, self, a) { try { note(getEl(self, a), prop, a); } catch (e) { /* nie stören */ } return Reflect.apply(f, self, a); } });
    Object.defineProperty(proto, prop, d.set ? { ...d, set: wrapped } : { ...d, value: wrapped });
    restore.push(() => Object.defineProperty(proto, prop, d));
  }
  const self = t => t, a0 = (t, a) => a[0];
  const attr = (t, a) => /^(class|style|hidden|disabled|inert|aria-hidden|aria-disabled|data-[\w-]+)$/i.test(String(a[0])) ? t : null;
  const moved = (t, a) => {   // appendChild/insertBefore: verschobene Knoten + eingefügte Stylesheets
    const n = a[0];
    if (n && n.nodeType === 1 && (n.tagName === 'STYLE' || (n.tagName === 'LINK' && /stylesheet/i.test(n.rel))))
      keep(cssAdds, { t: now(), node: n, text: n.href || '<style>: ' + cut(n.textContent, 200), err: mkErr('Stylesheet eingefügt') });
    return n && n.isConnected ? n : null;
  };
  [['removeChild', a0], ['replaceChild', (t, a) => a[1]], ['appendChild', moved], ['insertBefore', moved], ['textContent', self]].forEach(([p, f]) => hook(Node.prototype, p, f));
  [['remove', self], ['replaceWith', self], ['replaceChildren', self], ['innerHTML', self], ['outerHTML', self], ['className', self],
    ['setAttribute', attr], ['removeAttribute', attr], ['toggleAttribute', attr]].forEach(([p, f]) => hook(Element.prototype, p, f));
  [['hidden', self], ['innerText', self]].forEach(([p, f]) => hook(HTMLElement.prototype, p, f));
  [window.HTMLInputElement, window.HTMLButtonElement, window.HTMLFieldSetElement].forEach(K => K && hook(K.prototype, 'disabled', self));
  ['add', 'remove', 'toggle', 'replace'].forEach(p => hook(DOMTokenList.prototype, p, t => owner.get(t) || null));
  ['insertRule', 'replaceSync', 'replace'].forEach(p => {       // CSS-Regeln, die per JavaScript eingefügt werden
    const d = window.CSSStyleSheet && Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype, p);
    if (!d || typeof d.value !== 'function' || !d.configurable) return;
    const w = new Proxy(d.value, { apply(f, sh, a) { try { if (!stopped && HIDE.test(String(a[0]))) keep(cssAdds, { t: now(), text: cut(String(a[0]), 300), err: mkErr('CSSStyleSheet.' + p) }); } catch (e) { /* nie stören */ } return Reflect.apply(f, sh, a); } });
    Object.defineProperty(CSSStyleSheet.prototype, p, { ...d, value: w });
    restore.push(() => Object.defineProperty(CSSStyleSheet.prototype, p, d));
  });
  // el.style.display = 'none': Chrome legt Style-Werte direkt aufs Objekt → Proxy auf el.style,
  // aber NUR für Zahlungsarten + deren Eltern (ohne <html>/<body>). Alle anderen Elemente bekommen das Original.
  const sd = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style');
  if (sd && sd.get && sd.configurable) {
    const SP = /^(display|visibility|opacity|height|maxHeight|cssText|contentVisibility)$/;
    const handler = el => ({
      get(t, k) { const v = Reflect.get(t, k, t); if (typeof v !== 'function') return v; return k === 'setProperty' || k === 'removeProperty' ? (...a) => { note(el, 'style.' + k, a); return v.apply(t, a); } : v.bind(t); },
      set(t, k, v) { if (typeof k === 'string' && SP.test(k)) note(el, 'style.' + k, [v]); return Reflect.set(t, k, v, t); }
    });
    const get = new Proxy(sd.get, { apply(f, el, a) {
      const s = Reflect.apply(f, el, a);
      if (stopped || !claimed.has(el) || el === document.body || el === document.documentElement) return s;
      let p = proxies.get(el); if (!p) proxies.set(el, p = new Proxy(s, handler(el)));
      return p;
    } });
    const set = sd.set && new Proxy(sd.set, { apply(f, el, a) { note(el, 'style', a); return Reflect.apply(f, el, a); } });
    Object.defineProperty(HTMLElement.prototype, 'style', { ...sd, get, set: set || sd.set });
    restore.push(() => Object.defineProperty(HTMLElement.prototype, 'style', sd));
  }

  // ── 8) Netzwerk mitschneiden: welche Server-Antwort kam kurz VOR dem Ausblenden? ──
  let lastCart = null;                                      // zuletzt gesehener Warenkorb aus der Shop-API
  const norm = n => String(n).toLowerCase().replace(/[\s\\/]+/g, '');
  function walkJson(o, fn, depth = 0, key = '') { if (depth > 4 || !o || typeof o !== 'object') return; fn(o, key); for (const [k, v] of Object.entries(o)) walkJson(v, fn, depth + 1, k); }
  function inspectJson(x, body) {   // erkennt Zahlungsarten-Listen und Warenkörbe in Server-Antworten
    let o; try { o = JSON.parse(body); } catch (e) { return; }
    walkJson(o, (v) => {
      if (!x.methods && Array.isArray(v) && v.length && v.every(m => m && typeof m === 'object' && typeof m.name === 'string' && ('id' in m || 'code' in m)) && v.some(m => KW.test(m.name)))
        x.methods = v.map(m => m.name);
    });
    if (/cart|basket|warenkorb/i.test(x.url)) {
      const c = { summen: [], positionen: null, stueck: 0 };
      walkJson(o, (v, k) => {
        for (const [kk, vv] of Object.entries(v)) if (/total|sum|grand|gesamt/i.test(kk) && (typeof vv === 'number' || /^\d+([.,]\d+)?$/.test(vv)) && c.summen.length < 6) c.summen.push(`${kk}=${vv}`);
        if (Array.isArray(v) && /^(items|positions|products|lines|articles|basketItems|cartItems)$/i.test(k)) { c.positionen = v.length; c.stueck = v.reduce((n, i) => n + (+(i?.quantity ?? i?.qty ?? i?.amount ?? 1) || 0), 0); }
      });
      if (c.summen.length || c.positionen != null) lastCart = x.cart = c;
    }
  }
  const hitOf = b => { b = String(b || ''); const i = b.search(NETKW); return i < 0 ? '' : cut(b.slice(Math.max(0, i - 120), i + 380).replace(/\s+/g, ' '), 500); };
  const oFetch = window.fetch;
  if (typeof oFetch === 'function') {
    window.fetch = new Proxy(oFetch, { apply(f, _this, args) {
      const [input, init] = args;
      const x = keep(net, { t: now(), m: String(init?.method || input?.method || 'GET').toUpperCase(), url: cut(String(input?.url || input), 300), hit: '' });
      const p = Reflect.apply(f, window, args);                                     // Original-Promise unverändert zurückgeben
      p.then(r => {
        try {
          x.st = r.status; x.end = now();
          const ct = r.headers.get('content-type') || '';
          if (/json|text|html|xml/.test(ct) && !/event-stream/.test(ct) && +(r.headers.get('content-length') || 0) < 2e6) r.clone().text().then(b => { x.hit = hitOf(b); if (/json/.test(ct)) inspectJson(x, b); }, () => {});
        } catch (e) { /* nie stören */ }
      }, () => { x.st = 'Fehler'; x.end = now(); });
      return p;
    } });
    restore.push(() => { window.fetch = oFetch; });
  }
  const XP = XMLHttpRequest.prototype, oOpen = XP.open, oSend = XP.send;
  XP.open = new Proxy(oOpen, { apply(f, xhr, a) { try { xhrInfo.set(xhr, { m: String(a[0]).toUpperCase(), url: cut(String(a[1]), 300), hit: '' }); } catch (e) { /* nie stören */ } return Reflect.apply(f, xhr, a); } });
  XP.send = new Proxy(oSend, { apply(f, xhr, a) {
    const x = xhrInfo.get(xhr);
    if (x && !stopped) {
      x.t = now(); keep(net, x);
      xhr.addEventListener('loadend', () => {
        x.st = xhr.status; x.end = now();
        try { const b = xhr.responseType === 'json' ? JSON.stringify(xhr.response) : (!xhr.responseType || xhr.responseType === 'text') ? xhr.responseText : ''; x.hit = hitOf(b); inspectJson(x, b); } catch (e) { /* egal */ }
      });
    }
    return Reflect.apply(f, xhr, a);
  } });
  restore.push(() => { XP.open = oOpen; XP.send = oSend; });

  // ── 9) Läufe speichern → Vergleich "1 Artikel" vs. "mehrere Artikel" ──────────
  function saveRun() {
    if (!state.size) return;
    try {
      const all = [...state.values()], c = getCtx();
      const runs = JSON.parse(localStorage.getItem(LS) || '[]').filter(r => r.id !== T0);
      runs.push({ id: T0, zeit: new Date(T0).toLocaleString('de-DE'), seite: location.pathname, summe: c.summe, artikel: c.artikel, land: c.land,
        verfuegbar: all.filter(o => o.vis && !o.dis && !o.gone).map(o => o.name), weg: all.filter(o => !o.vis || o.dis || o.gone).map(o => o.name) });
      localStorage.setItem(LS, JSON.stringify(runs.slice(-10)));
    } catch (e) { /* privates Fenster o.ä. → Vergleich nicht verfügbar */ }
  }
  function compareData() {
    let runs = []; try { runs = JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { /* egal */ }
    const none = { runs, ok: false, text: 'Noch kein Vergleich möglich. So geht’s: 1) Zahlungsseite mit nur 1 Artikel im Warenkorb öffnen, 2) danach mit mehreren Artikeln – dann nochmal „Vergleichen“.' };
    const cur = runs.find(r => r.id === T0) || runs[runs.length - 1];
    const earlier = cur ? runs.filter(r => r.id < cur.id) : [];
    const prev = [...earlier].reverse().find(r => r.summe !== cur.summe || r.artikel !== cur.artikel) || earlier[earlier.length - 1];
    if (!cur || !prev) return none;
    const onlyPrev = prev.verfuegbar.filter(x => !cur.verfuegbar.includes(x)), onlyCur = cur.verfuegbar.filter(x => !prev.verfuegbar.includes(x));
    const line = r => `${r.zeit} | Summe ${r.summe} | Artikel ${r.artikel} → verfügbar: ${r.verfuegbar.join(', ') || '—'}`;
    return { runs, ok: true, prev, cur, onlyPrev, onlyCur,
      text: `Früherer Lauf: ${line(prev)}\nAktueller Lauf: ${line(cur)}\n➜ Nur im früheren Lauf verfügbar: ${onlyPrev.join(', ') || '—'}\n➜ Nur im aktuellen Lauf verfügbar: ${onlyCur.join(', ') || '—'}` };
  }

  // ── 10) Bericht: Support-Text + technischer Anhang, persönliche Daten geschwärzt ──
  const redact = s => String(s)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[E-Mail entfernt]')
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g, '[IBAN entfernt]')
    .replace(/(?:\+|\b00)\d[\d\s/-]{7,}\d/g, '[Telefon entfernt]')
    .replace(/(\\?"(?:first_?name|last_?name|full_?name|vorname|nachname|street\w*|stra(?:ss|ß)e|house_?number|hausnummer|addition|company|firma|salutation|vat_?number|address\w*|adresse|zip\w*|plz|post_?code|postal_?code|city|ort|phone\w*|telefon\w*|e_?mail|birth\w*|geburt\w*)\\?"\s*:\s*\\?")(?:[^"\\]|\\(?!"))*/gi, '$1[entfernt]')
    .replace(/([?&](?:token|session|sid|auth|key|code|hash|signature)[^=&]*=)[^&"\s]+/gi, '$1[entfernt]');
  function buildReport() {
    const k = ctx(), cmp = compareData();
    return { tool: 'Bike24 Zahlungsarten-Debugger ' + VERSION, erstellt: new Date().toISOString(), seite: location.origin + location.pathname, browser: browserName(), kontext: k,
      zahlungsarten: [...state.values()].map(o => ({ name: o.name, sichtbar: o.vis && !o.gone, deaktiviert: o.dis, grund: reason(o), html: o.html })),
      ereignisse: events, vergleich: cmp.text, vergleichOk: cmp.ok,
      netzwerk: net.map(x => ({ methode: x.m, url: x.url, status: x.st, fertigMs: Math.round(x.end || 0), auszug: x.hit })) };
  }
  function mailText(d) {
    const bad = d.ereignisse.filter(e => e.schlimm), names = [...new Set(bad.map(e => e.zahlungsart))];
    const weg = d.zahlungsarten.filter(z => !z.sichtbar || z.deaktiviert);
    const L = ['Betreff: Zahlungsarten verschwinden im Checkout bei mehreren Artikeln', '', 'Hallo Bike24-Team,', '',
      'in eurem Checkout verschwinden bei mir Zahlungsarten von der Zahlungsseite, sobald mehrere Artikel im Warenkorb liegen. Mit nur einem Artikel sind sie verfügbar. Ich habe das mit einem Analyse-Skript im Browser aufgezeichnet:', ''];
    if (bad.length) {
      L.push(`• Betroffene Zahlungsarten: ${names.join(', ')}`);
      L.push(`• Zeitpunkt: ${bad[0].msNachSeitenaufruf} ms nach Aufruf der Seite (${new Date().toLocaleDateString('de-DE')}, ${bad[0].zeit} Uhr)`);
      [...new Set(bad.map(e => `• ${e.zahlungsart}: ${e.was}`))].forEach(l => L.push(l));
      const srvDec = bad.find(e => e.serverListe && e.serverListe.enthaeltZahlungsart === false);
      if (srvDec) L.push(`• Die Entscheidung fällt auf dem Server: Die Antwort von ${srvDec.serverListe.url} enthält „${[...new Set(bad.filter(e => e.serverListe?.enthaeltZahlungsart === false).map(e => e.zahlungsart))].join('“, „')}“ nicht mehr (${srvDec.serverListe.msVorher} ms vor dem Entfernen). Erlaubt waren nur noch: ${srvDec.serverListe.erlaubteZahlungsarten.join(', ')}.`);
      const code = [...new Set(bad.flatMap(e => [...e.code, ...e.css].map(c => c.wo)).filter(Boolean))];
      if (code.length) L.push(`• Ausgelöst durch euren JavaScript-Code: ${code.slice(0, 3).join(' | ')}`);
      const srv = [...new Map(bad.flatMap(e => e.server).map(s => [s.url, s])).values()].sort((a, b) => /payment/.test(b.url) - /payment/.test(a.url));
      if (srv.length) L.push(`• Server-Antwort kurz davor: ${srv.slice(0, 3).map(s => `${s.methode} ${s.url} (Status ${s.status})`).join(' | ')}`);
    } else if (weg.length) L.push(`• Nicht verfügbar: ${weg.map(z => `${z.name} (${z.grund || 'deaktiviert'})`).join('; ')}`);
    else L.push('• Hinweis: In diesem Lauf wurde kein Ausblenden aufgezeichnet.');
    L.push(`• Warenkorb laut Seite: Summe ${d.kontext.summe}, Artikel ${d.kontext.artikel}, Lieferland ${d.kontext.land}${d.kontext.warenkorbApi ? ` (laut Warenkorb-API: ${d.kontext.warenkorbApi})` : ''}`);
    if (d.kontext.hinweise.length) L.push(`• Hinweise auf der Seite: ${d.kontext.hinweise.join(' | ')}`);
    if (d.vergleichOk) L.push('• Vergleich meiner Läufe:', ...d.vergleich.split('\n').map(s => '   ' + s));
    L.push(`• Browser: ${d.browser}`, '',
      'Falls das Absicht ist (z. B. Betragsgrenze, Sperrgut oder gemischter Warenkorb), wäre ein kurzer Hinweis im Checkout super, statt die Zahlungsart ohne Erklärung auszublenden. Falls es ein Fehler ist: Das technische Protokoll hängt unten an.',
      '', 'Viele Grüße');
    return L.join('\n');
  }
  function download(text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = `bike24-zahlungsarten-bericht-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    a.addEventListener('click', e => e.stopPropagation());                          // Seite soll den Klick nicht abfangen
    (panelHost?.shadowRoot || document.body || document.documentElement).appendChild(a);
    a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // ── 11) Mini-Panel unten links (Shadow DOM → beeinflusst die Seite nicht) ─────
  // Ohne innerHTML gebaut + Stylesheet per CSSOM → funktioniert auch bei strenger Content-Security-Policy / Trusted Types
  const PANEL_CSS = `.b{position:fixed;left:12px;bottom:12px;z-index:2147483647;width:300px;max-width:calc(100vw - 24px);background:#111827;color:#f9fafb;font:13px/1.4 system-ui,sans-serif;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);padding:10px 12px;text-align:left}
    .h{display:flex;justify-content:space-between;align-items:center;font-weight:600;gap:8px}.h span{white-space:nowrap}
    .x{background:none;border:0;color:#9ca3af;font-size:16px;cursor:pointer;padding:0 4px}.s{margin:6px 0;font-weight:600;color:#86efac}.s.bad{color:#fca5a5}
    ul{list-style:none;margin:0 0 8px;padding:0;max-height:180px;overflow:auto}li{padding:2px 0;border-bottom:1px solid #1f2937}small{color:#9ca3af}
    .btns{display:flex;gap:6px}.btns button{flex:1;background:#2563eb;color:#fff;border:0;border-radius:6px;padding:6px;font:inherit;cursor:pointer}.btns button+button{background:#374151}
    .m{margin-top:8px;white-space:pre-wrap;color:#d1d5db;font-size:12px}.f{margin-top:6px;color:#6b7280;font-size:11px}`;
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) k.startsWith('data-') ? e.setAttribute(k, v) : (e[k === 'class' ? 'className' : k] = v);
    kids.flat().forEach(c => c != null && c !== false && e.append(c.nodeType ? c : String(c)));
    return e;
  };
  function renderPanel() {
    if (stopped || !document.body) return;
    try {
      if (!panelHost) {
        panelHost = document.createElement('div'); panelHost.id = PANEL_ID;
        const sr = panelHost.attachShadow({ mode: 'open' });
        try { const sh = new CSSStyleSheet(); sh.replaceSync(PANEL_CSS); sr.adoptedStyleSheets = [sh]; } catch (e) { sr.append(h('style', null, PANEL_CSS)); }
        sr.addEventListener('click', onPanelClick);
        panelHost.addEventListener('click', e => e.stopPropagation());
        document.documentElement.appendChild(panelHost);
      }
      if (panelHost.hidden) return;
      const all = [...state.values()], lost = all.filter(o => !o.vis || o.dis || o.gone);
      const icon = o => o.gone ? '❌' : !o.vis ? '🙈' : o.dis ? '🚫' : '✅';
      const box = h('div', { class: 'b' },
        h('div', { class: 'h' }, h('span', null, '🔍 Bike24-Debugger'),
          h('span', null, h('button', { class: 'x', 'data-act': 'min', title: 'ein-/ausklappen' }, panelMin ? '▴' : '▾'), h('button', { class: 'x', 'data-act': 'close', title: 'Panel ausblenden' }, '✕'))),
        h('div', { class: lost.length ? 's bad' : 's' }, lost.length ? `⚠️ ${lost.length} von ${all.length} Zahlungsarten weg` : `✅ Alle ${all.length} sichtbar – ich beobachte weiter`),
        !panelMin && [
          h('ul', null, all.map(o => h('li', null, `${icon(o)} ${o.name}`, o.last && [h('br'), h('small', null, o.last)]))),
          h('div', { class: 'btns' }, h('button', { 'data-act': 'report' }, '📄 Bericht speichern'), h('button', { 'data-act': 'compare' }, '⚖️ Vergleichen')),
          panelMsg && h('div', { class: 'm' }, panelMsg),
          h('div', { class: 'f' }, `Details: F12 → Konsole · v${VERSION}`)
        ]);
      const sr = panelHost.shadowRoot;
      [...sr.children].forEach(n => n.tagName !== 'STYLE' && n.remove());
      sr.append(box);
    } catch (e) { /* Panel ist nur Komfort – die Konsole funktioniert trotzdem */ }
  }
  function onPanelClick(e) {
    const act = e.target.closest?.('[data-act]')?.dataset.act;
    if (act === 'report') { api.report(); panelMsg = '✅ Bericht gespeichert – liegt in deinem Download-Ordner.'; }
    if (act === 'compare') { panelMsg = compareData().text; api.compare(); }
    if (act === 'min') panelMin = !panelMin;
    if (act === 'close') { panelHost.hidden = true; say(COL.grey, 'Panel ausgeblendet. Wieder einblenden: b24PayDbg.panel()'); return; }
    renderPanel();
  }

  // ── 12) Befehle für die Konsole ───────────────────────────────────────────────
  const api = {
    version: VERSION,
    hilfe() {
      console.log('%c[B24] Befehle (einfach eintippen + Enter):\n' +
        '  b24PayDbg.status()    → Tabelle: welche Zahlungsart ist da/weg und warum\n' +
        '  b24PayDbg.report()    → Bericht für den Bike24-Support herunterladen\n' +
        '  b24PayDbg.compare()   → Lauf mit 1 Artikel vs. Lauf mit mehreren Artikeln\n' +
        '  b24PayDbg.panel()     → Panel unten links wieder einblenden\n' +
        "  b24PayDbg.find('…')   → eigenen CSS-Selektor setzen, falls nichts gefunden wird\n" +
        '  b24PayDbg.reset()     → gespeicherte Läufe für den Vergleich löschen\n' +
        '  b24PayDbg.stop()      → Debugger beenden, Seite wieder im Originalzustand', 'color:#1a73e8');
    },
    status() {
      if (!state.size) return console.warn('[B24] Noch keine Zahlungsarten gefunden. Bist du schon auf der Seite, wo du die Zahlungsart auswählst?');
      console.table([...state.values()].map(o => ({ Zahlungsart: o.name, Status: o.gone ? '❌ entfernt' : !o.vis ? '🙈 unsichtbar' : o.dis ? '🚫 deaktiviert' : '✅ sichtbar', Grund: reason(o), Element: desc(o.el) })));
    },
    compare() {
      const c = compareData();
      if (c.runs.length) console.table(c.runs.map(r => ({ Lauf: r.zeit, Seite: r.seite, Summe: r.summe, Artikel: r.artikel, verfügbar: r.verfuegbar.join(', '), weg: r.weg.join(', ') })));
      say(c.ok ? 'font-weight:bold' : COL.grey, c.text);
    },
    report() {
      const d = buildReport(), mail = redact(mailText(d));
      download(mail + '\n\n' + '='.repeat(70) + '\nTECHNISCHER ANHANG (für die Entwickler bei Bike24)\n' + '='.repeat(70) + '\n' + redact(JSON.stringify(d, null, 2)));
      say(COL.blue, '📄 Bericht gespeichert (Download-Ordner). Oben steht der fertige Text für den Support, darunter der technische Anhang.');
      say(COL.grey, 'E-Mail-Adressen, Telefonnummern, IBANs und Adressfelder werden automatisch geschwärzt – kurz drüberschauen schadet trotzdem nicht.');
      console.log(mail);
    },
    find(sel) {
      if (sel) { try { document.querySelector(sel); } catch (e) { return console.warn(`[B24] „${sel}“ ist kein gültiger CSS-Selektor.`); } }
      custom = sel || null; state.clear(); tablePrinted = false; pendingGone = null; scan();
      if (!state.size) console.warn(`[B24] Mit „${sel}“ finde ich nichts. Tipp: README → „Wenn nichts gefunden wird“.`);
    },
    panel() { if (panelHost) panelHost.hidden = false; renderPanel(); },
    reset() { try { localStorage.removeItem(LS); } catch (e) { /* egal */ } say(COL.grey, 'Gespeicherte Läufe gelöscht.'); },
    data: buildReport,
    stop() {
      stopped = true; mo.disconnect(); ro.disconnect(); clearTimeout(timer);
      restore.splice(0).reverse().forEach(f => { try { f(); } catch (e) { /* egal */ } });
      panelHost?.remove(); document.removeEventListener('DOMContentLoaded', schedule); window.removeEventListener('load', schedule);
      delete window.b24PayDbg;
      say(COL.grey, '⏹ Gestoppt. Alles ist wieder im Originalzustand.');
    }
  };

  // ── Start ───────────────────────────────────────────────────────────────────
  mo.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true });
  document.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('load', schedule);
  window.b24PayDbg = api;
  if (!AUTO) say(COL.blue, `▶ Bike24-Zahlungsarten-Debugger v${VERSION} gestartet. Hilfe: b24PayDbg.hilfe()`);
  if (document.readyState !== 'loading') scan();
  if (!AUTO && !state.size) say(COL.grey, '⏳ Noch keine Zahlungsarten auf dieser Seite – ich warte, bis welche auftauchen (z.B. wenn du zur Zahlungsseite weitergehst).');
  if (!AUTO) setTimeout(() => {
    if (!stopped && !state.size) console.warn('[B24] ⚠️ Nach 10 Sekunden noch keine Zahlungsarten gefunden.\n' +
      'Bist du auf der Seite, auf der du die Zahlungsart auswählst? Falls ja: Rechtsklick auf eine Zahlungsart → „Untersuchen“ → im markierten HTML den Wert von name="…" ablesen und eingeben:\n' +
      "   b24PayDbg.find('input[name=\"HIER-DER-NAME\"]')");
  }, 10000);
})();
