/* ============================================================================
 * Bike24 Zahlungsarten-Debugger v1.0  (Vanilla JS, keine Abhängigkeiten)
 * Chrome / Edge / Brave / Firefox
 * ----------------------------------------------------------------------------
 * Ablauf: F12 → Console → komplett einfügen → Enter. Er beobachtet sofort.
 * Befehle danach:
 *   b24PayDbg.status()       aktuelle Zahlungsarten als Tabelle
 *   b24PayDbg.report()       Beweis-Log als JSON herunterladen (für den Support)
 *   b24PayDbg.compare()      letzten Lauf (z.B. 1 Artikel) mit diesem (mehrere) vergleichen
 *   b24PayDbg.find('css')    eigenen Selektor setzen, falls nichts gefunden wird
 *   b24PayDbg.stop()         alles abbauen und Original-Funktionen wiederherstellen
 *
 * Beispiel-Output:
 *   [B24] ▶ Debugger aktiv (14:02:10.118, t+1830ms) – 6 Zahlungsart(en) gefunden
 *   ┌─────────┬──────────────┬─────────┬─────────────┬───────┬───────────────────────┐
 *   │ (index) │ Zahlungsart  │ sichtbar│ deaktiviert │ Grund │ Element               │
 *   │ 0       │ 'PayPal'     │ true    │ false       │ ''    │ '<li.payment-item>'   │
 *   │ 1       │ 'Rechnung'   │ true    │ false       │ ''    │ '<li.payment-item>'   │
 *   [B24] 🙈 14:02:10.640 (t+2352ms) "Rechnung" AUSGEBLENDET → display:none auf
 *         <li.payment-item.is-hidden> via CSS-Regel (class="payment-item is-hidden")
 *     Mutation: <li.payment-item> [class] "payment-item" → "payment-item is-hidden"
 *     JS-Aufruf classList.add("is-hidden") auf <li.payment-item> → Error: … at checkout.js:1:8821 (klickbar)
 *     Netzwerk davor: POST /checkout/payment-methods → 200 (t+2290ms) {"allowed":["paypal",…]}
 *     Kontext: {summe: "412,97 €", artikelHinweis: "3 Artikel", land: "Deutschland", …}
 *     Vermutung: Betrags-Limit / Risiko-Check des Zahlungsanbieters …
 * ========================================================================== */
(() => {
  // --- Doppelstart verhindern -------------------------------------------------
  if (window.b24PayDbg) return console.info('[B24] ℹ️ Debugger läuft bereits → b24PayDbg.status() / .report() / .stop()');

  const T0 = Date.now(), LS = 'b24PayDbg.runs', MAXBUF = 200;
  const state = new Map(), events = [], muts = [], calls = [], net = [], restore = [], owner = new WeakMap(), claimed = new WeakSet();
  let custom = null, timer = 0, firstFillDone = false;
  // Erkennt Zahlungsarten am Text/Logo – bewusst breit, damit Bike24 Klassen ändern kann, ohne dass das Skript bricht
  const KW = /paypal|klarna|kredit|credit|visa|mastercard|amex|rechnung|invoice|vorkasse|prepay|überweis|transfer|lastschrift|sepa|sofort|giropay|apple ?pay|google ?pay|amazon ?pay|raten|installment|nachnahme|twint|ideal|bancontact|przelewy|pay ?later|zahlung|payment/i;

  // --- Helfer ------------------------------------------------------------------
  const ts = () => `${new Date().toLocaleTimeString('de-DE')}.${String(Date.now() % 1000).padStart(3, '0')} (t+${Math.round(performance.now())}ms)`;
  const desc = n => !n || n.nodeType !== 1 ? String(n) : `<${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${[...n.classList].slice(0, 4).map(c => '.' + c).join('')}>`;
  const snip = n => (n.outerHTML || '').replace(/\s+/g, ' ').slice(0, 400);
  const nameOf = (e, seed) => ((e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50) || e.querySelector?.('img[alt]')?.alt || e.getAttribute?.('aria-label') || e.title || seed?.value || desc(e));
  const keep = (arr, x) => { arr.push(x); if (arr.length > MAXBUF) arr.shift(); };
  const related = (n, el) => !!n && n.nodeType === 1 && (n === el || n.contains(el) || el.contains(n));
  const rel = n => { for (const o of state.values()) if (related(n, o.el)) return true; return false; };

  // --- Zahlungsarten finden (generisch, mit Fallbacks) --------------------------
  // Stufe 1: Radio-Buttons, deren name/id/value oder Beschriftung nach Zahlungsart aussieht
  // Stufe 2: Text-/Logo-Elemente (label, li, role=radio …) mit Zahlungs-Keywords
  // Footer/Header/Nav werden ignoriert (dort hängen oft nur Logos aller Zahlungsarten)
  function findOptions() {
    const out = q => [...document.querySelectorAll(q)].filter(e => !e.closest('footer,header,nav'));
    let seeds = custom ? out(custom) : out('input[type=radio],[role=radio]').filter(r => /pay|zahl/i.test(`${r.name} ${r.id} ${r.value}`) || KW.test(nameOf(r.closest('label,li') || r.parentElement || r)));
    if (!seeds.length && !custom) seeds = out('label,li,[role=option],[data-payment],[data-payment-method],[data-testid*=payment i]').filter(e => e.textContent.length < 200 && KW.test(nameOf(e)));
    seeds = seeds.filter(s => !seeds.some(o => o !== s && s.contains(o)));        // nur innerste Treffer
    return seeds.map(seed => {                                                     // zum "Options-Wrapper" hochklettern,
      let el = seed;                                                               // solange er genau EINE Zahlungsart enthält
      for (let p = el.parentElement; p && p !== document.body && p.tagName !== 'FORM' && p.textContent.length < 400 && seeds.filter(x => p.contains(x)).length === 1; p = p.parentElement) el = p;
      return { k: seed.value || seed.id || nameOf(el, seed), el, seed };
    });
  }

  // --- Sichtbarkeit + exakte Ursache des Ausblendens ---------------------------
  const isVis = e => { if (!e.isConnected) return false; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && (!e.checkVisibility || e.checkVisibility({ opacityProperty: true, visibilityProperty: true })); };
  function whyHidden(o) {
    if (!o.el.isConnected) return 'DOM-Knoten ENTFERNT (removeChild / innerHTML / Framework-Re-Render)';
    for (let n = o.el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n), d = desc(n), via = p => n.style[p] ? 'Inline-Style (JS)' : `CSS-Regel (class="${n.className}")`;
      if (cs.display === 'none') return `display:none auf ${d} via ${n.hidden ? 'hidden-Attribut' : via('display')}`;
      if (cs.visibility === 'hidden' && (!n.parentElement || getComputedStyle(n.parentElement).visibility !== 'hidden')) return `visibility:hidden auf ${d} via ${via('visibility')}`;
      if (cs.opacity === '0') return `opacity:0 auf ${d} via ${via('opacity')}`;
      if (cs.contentVisibility === 'hidden') return `content-visibility:hidden auf ${d}`;
      if ((parseFloat(cs.height) === 0 || cs.maxHeight === '0px') && cs.overflow !== 'visible') return `Höhe 0 + overflow:${cs.overflow} auf ${d} (zugeklappt)`;
    }
    return 'unsichtbar (Größe 0 / außerhalb des Viewports) – Ursache siehe Mutationen';
  }

  // --- Kontext: Infos, die erklären, WARUM es nur beim Mehrfach-Kauf passiert ---
  function ctx() {
    const txt = document.body?.innerText || '', sel = document.querySelector('select[name*=country i],select[id*=country i],select[name*=land i]');
    return {
      summe: (txt.match(/(gesamt|summe|total|zu zahlen)[^\d€]{0,40}((?:€\s*)?\d[\d.]*,\d{2}(?:\s*€)?)/i) || [])[2] || '?',
      artikelHinweis: (txt.match(/\d+\s*(artikel|positionen|items?)\b/i) || [])[0] || '?',
      land: sel ? sel.selectedOptions[0]?.textContent.trim() : '?',
      sperrgutHinweis: /sperrgut|spedition|bulky/i.test(txt), lieferzeitHinweis: (txt.match(/lieferbar in[^\n]{0,30}|nicht auf lager|vorbestell[^\n]{0,20}/i) || [])[0] || '',
      applePay: 'ApplePaySession' in window, paymentRequestAPI: 'PaymentRequest' in window, browser: navigator.userAgent, seite: location.pathname
    };
  }
  const guess = name => /rechnung|invoice|klarna|raten|installment|pay ?later/i.test(name) ? 'Betrags-Limit / Bonitäts- bzw. Risiko-Check des Zahlungsanbieters (höherer Warenkorbwert bei mehreren Artikeln) → Netzwerk-Antwort prüfen'
    : /vorkasse|prepay|überweis|transfer/i.test(name) ? 'Mischwarenkorb (Artikel mit unterschiedlicher Lieferzeit/Lager) oder Betrags-Limit'
    : /apple|google ?pay/i.test(name) ? 'Browser-Feature-Erkennung (ApplePaySession / PaymentRequest) oder Wallet-Check'
    : /nachnahme/i.test(name) ? 'Versandart/Sperrgut – Nachnahme oft nur für Paket-Standardversand'
    : 'Warenkorbwert-Limit, Sperrgut/Spedition, Mischwarenkorb (Lieferzeiten), Lieferadresse (Land/Packstation), Risiko-Check';

  // --- Ereignis loggen: Kopfzeile sofort lesbar, Beweise gruppiert darunter ------
  function emit(icon, o, what) {
    const t = performance.now(), m = muts.filter(x => t - x.t < 1500 && related(x.n, o.el)), c = calls.filter(x => t - x.t < 1500 && related(x.n, o.el));
    const n = net.filter(x => x.end && t - x.end < 3000), color = icon === '🙈' || icon === '❌' || icon === '🚫' ? 'color:#d33' : 'color:#2a7';
    const ev = { zeit: ts(), typ: icon, zahlungsart: o.name, was: what, htmlVorher: o.html, htmlNachher: o.el.isConnected ? snip(o.el) : '(entfernt)',
      mutationen: m.map(x => x.txt), jsAufrufe: c.map(x => `${x.op} auf ${x.target}\n${x.err.stack}`), netzwerk: n.map(x => `${x.m} ${x.url} → ${x.st} (t+${Math.round(x.end)}ms) ${x.hit}`), kontext: ctx(), vermutung: guess(o.name) };
    events.push(ev);
    console.group(`%c[B24] ${icon} ${ev.zeit} "${o.name}" ${what}`, `${color};font-weight:bold`);
    console.log('Element jetzt:', o.el, '\nHTML vorher:', ev.htmlVorher, '\nHTML nachher:', ev.htmlNachher);
    m.forEach(x => console.log('Mutation:', x.txt));
    c.forEach(x => console.log(`JS-Aufruf ${x.op} auf ${x.target} – Stack (Dateilinks klickbar):`, x.err));
    if (!c.length && icon !== '➕' && icon !== '👀') console.log(`ℹ️ Kein JS-Stack erfasst. Für 100% Beweis: Elements-Tab → Rechtsklick auf ${desc(o.el)} bzw. Eltern-Element → "Break on" → "attribute modifications"/"node removal" → Seite neu laden.`);
    n.forEach(x => console.log(`Netzwerk davor: ${x.m} ${x.url} → ${x.st} (t+${Math.round(x.end)}ms)`, x.hit || ''));
    console.log('Kontext:', ev.kontext, '\nVermutung (Hypothese, kein Beweis):', ev.vermutung);
    console.groupEnd();
  }

  // --- Abgleich vorher/nachher (diff pro Zahlungsart, keine Log-Flut) -----------
  function scan() {
    timer = 0;
    const found = findOptions(), seen = new Set(), wasEmpty = !state.size, n0 = events.length;
    for (const { k, el, seed } of found) {
      seen.add(k);
      const vis = isVis(el), dis = !!seed.disabled || seed.getAttribute('aria-disabled') === 'true';
      let o = state.get(k);
      if (!o) { o = { k, el, seed, name: nameOf(el, seed), vis, dis, html: snip(el) }; state.set(k, o); claim(o); if (!wasEmpty) emit(vis ? '➕' : '👻', o, vis ? 'NEU erschienen' : 'erschienen, aber UNSICHTBAR → ' + whyHidden(o)); continue; }
      if (o.el !== el) { o.el = el; o.seed = seed; claim(o); }                        // Framework hat neu gerendert
      if ((o.vis || o.gone) && !vis) { if (o.vis) emit('🙈', o, 'AUSGEBLENDET → ' + whyHidden(o)); }
      else if ((!o.vis || o.gone) && vis) emit('👀', o, o.gone ? 'wieder DA' : 'wieder SICHTBAR');
      if (o.dis !== dis) emit(dis ? '🚫' : '✅', o, dis ? 'DEAKTIVIERT (disabled)' : 'wieder AKTIV');
      Object.assign(o, { vis, dis, gone: false }); if (vis) o.html = snip(el);
    }
    for (const o of state.values()) if (!seen.has(o.k) && !o.gone) { if (o.vis) emit('❌', o, 'VERSCHWUNDEN → ' + whyHidden(o)); Object.assign(o, { gone: true, vis: false }); }
    if (wasEmpty && state.size && !firstFillDone) { firstFillDone = true; console.log(`%c[B24] ▶ ${ts()} – ${state.size} Zahlungsart(en) gefunden:`, 'color:#27c;font-weight:bold'); api.status(); }
    if (events.length !== n0 || firstFillDone && wasEmpty) saveRun();                  // Lauf für compare() sichern
  }
  // Zahlungsart + alle Eltern markieren (für Stack-Erfassung bei el.style.display='none' / classList.add)
  function claim(o) { for (let n = o.el; n && n.nodeType === 1; n = n.parentElement) { claimed.add(n); owner.set(n.classList, n); } }

  // --- MutationObserver: beobachtet das GANZE Dokument (auch Lazy-Loading/Future-DOM) ---
  const mo = new MutationObserver(rs => {
    const t = performance.now();
    for (const r of rs) {
      if (r.type === 'attributes') { if (rel(r.target)) keep(muts, { t, n: r.target, txt: `${desc(r.target)} [${r.attributeName}] "${r.oldValue ?? ''}" → "${r.target.getAttribute(r.attributeName) ?? '(entfernt)'}"` }); }
      else r.removedNodes.forEach(n => rel(n) && keep(muts, { t, n, txt: `${desc(n)} aus ${desc(r.target)} ENTFERNT` }));
    }
    if (!timer) timer = setTimeout(scan, 30);                                       // Throttle: max. 1 Scan / 30ms
  });
  mo.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-hidden', 'aria-disabled'] });

  // --- DOM-API-Hooks: liefern den JS-STACK (welche Datei/Zeile blendet aus) -----
  // Greifen nur, wenn das Ziel eine Zahlungsart (oder deren Eltern/Kinder) ist → kaum Overhead
  function note(n, op, a) {   // speichert Aufruf + new Error() → Stack zeigt Datei:Zeile des Bike24-Codes
    try { if (n && rel(n)) keep(calls, { t: performance.now(), n, target: desc(n), op: `${op}(${a.map(x => x?.nodeType ? desc(x) : JSON.stringify(x)?.slice(0, 60)).join(', ')})`, err: new Error(`[B24] ${op}`) }); } catch (e) { /* Debugger darf die Seite nie stören */ }
  }
  function hook(proto, prop, getEl) {
    const d = proto && Object.getOwnPropertyDescriptor(proto, prop); if (!d || !d.configurable) return;
    const wrap = f => function (...a) { note(getEl(this, a), prop, a); return f.apply(this, a); };
    Object.defineProperty(proto, prop, d.set ? { ...d, set: wrap(d.set) } : { ...d, value: wrap(d.value) });
    restore.push(() => Object.defineProperty(proto, prop, d));
  }
  const self = t => t, arg0 = (t, a) => a[0], attr = (t, a) => /^(class|style|hidden|disabled|aria-hidden)$/i.test(a[0]) && t;
  [['removeChild', arg0], ['replaceChild', (t, a) => a[1]], ['textContent', self]].forEach(([p, f]) => hook(Node.prototype, p, f));
  [['remove', self], ['replaceWith', self], ['replaceChildren', self], ['innerHTML', self], ['outerHTML', self], ['className', self], ['setAttribute', attr], ['removeAttribute', attr], ['toggleAttribute', attr]].forEach(([p, f]) => hook(Element.prototype, p, f));
  hook(HTMLElement.prototype, 'hidden', self); hook(HTMLInputElement.prototype, 'disabled', self);
  ['add', 'remove', 'toggle', 'replace'].forEach(p => hook(DOMTokenList.prototype, p, t => owner.get(t)));
  // el.style.display = 'none': Chrome legt Style-Properties direkt auf die Instanz → Proxy auf el.style,
  // aber NUR für Zahlungsarten + deren Eltern (claimed). Alle anderen Elemente bekommen das Original.
  const sd = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style'), proxies = new WeakMap();
  if (sd?.get && sd.configurable) {
    Object.defineProperty(HTMLElement.prototype, 'style', { ...sd, get() {
      const s = sd.get.call(this), el = this; if (!claimed.has(el)) return s;
      if (!proxies.has(el)) proxies.set(el, new Proxy(s, {
        get: (t, k) => { const v = Reflect.get(t, k, t); return typeof v !== 'function' ? v : /^(setProperty|removeProperty)$/.test(k) ? (...a) => { note(el, `style.${k}`, a); return v.apply(t, a); } : v.bind(t); },
        set: (t, k, v) => { if (/^(display|visibility|opacity|height|maxHeight|cssText)$/.test(k)) note(el, `style.${k}`, [v]); return Reflect.set(t, k, v, t); } }));
      return proxies.get(el);
    } });
    restore.push(() => Object.defineProperty(HTMLElement.prototype, 'style', sd));
  }

  // --- Netzwerk mitschneiden: welche Server-Antwort kam kurz VOR dem Ausblenden ---
  const hit = b => { const i = b.search(KW); return i < 0 ? '' : b.slice(Math.max(0, i - 100), i + 300).replace(/\s+/g, ' '); };
  const oFetch = window.fetch;
  window.fetch = function (input, init) {
    const x = { t: performance.now(), m: init?.method || input?.method || 'GET', url: String(input?.url || input).slice(0, 200), hit: '' }; keep(net, x);
    return oFetch.apply(this, arguments).then(r => {
      x.st = r.status; x.end = performance.now();
      if (/json|text|html/.test(r.headers.get('content-type') || '')) r.clone().text().then(b => { x.hit = hit(b); }).catch(() => {});
      return r;
    });
  };
  const oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__b24 = { m, url: String(url).slice(0, 200), hit: '' }; return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    const x = this.__b24; if (x) { x.t = performance.now(); keep(net, x); this.addEventListener('loadend', () => { x.st = this.status; x.end = performance.now(); try { if (!this.responseType || this.responseType === 'text') x.hit = hit(this.responseText); } catch (e) {} }); }
    return oSend.apply(this, arguments);
  };
  restore.push(() => { window.fetch = oFetch; XMLHttpRequest.prototype.open = oOpen; XMLHttpRequest.prototype.send = oSend; });

  // --- Läufe speichern (localStorage) → Vergleich 1 Artikel vs. mehrere Artikel ---
  function saveRun() {
    try {
      const runs = JSON.parse(localStorage.getItem(LS) || '[]').filter(r => r.id !== T0), c = ctx(), all = [...state.values()];
      runs.push({ id: T0, zeit: new Date(T0).toLocaleString('de-DE'), summe: c.summe, artikelHinweis: c.artikelHinweis, land: c.land, sichtbar: all.filter(o => o.vis && !o.dis).map(o => o.name), weg: all.filter(o => !o.vis || o.dis).map(o => o.name) });
      localStorage.setItem(LS, JSON.stringify(runs.slice(-6)));
    } catch (e) { /* privates Fenster o.ä. → Vergleich nicht verfügbar */ }
  }

  // --- Öffentliche Befehle ----------------------------------------------------
  const api = window.b24PayDbg = {
    status() { console.table([...state.values()].map(o => ({ Zahlungsart: o.name, sichtbar: o.vis, deaktiviert: o.dis, Grund: o.vis ? '' : whyHidden(o), Element: desc(o.el) }))); },
    find(sel) { custom = sel || null; state.clear(); firstFillDone = false; scan(); if (!state.size) console.warn(`[B24] Selektor "${sel}" findet nichts.`); },
    compare() {
      let runs = []; try { runs = JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) {}
      if (runs.length < 2) return console.info('[B24] Noch kein Vergleich möglich: erst mit 1 Artikel laufen lassen, dann mit mehreren.');
      const [a, b] = runs.slice(-2), fehlt = a.sichtbar.filter(x => !b.sichtbar.includes(x)), neu = b.sichtbar.filter(x => !a.sichtbar.includes(x));
      console.table([a, b].map(r => ({ Lauf: r.zeit, Summe: r.summe, Artikel: r.artikelHinweis, Land: r.land, sichtbar: r.sichtbar.join(', '), weg: r.weg.join(', ') })));
      console.log(`%c[B24] Unterschied: fehlt im 2. Lauf → ${fehlt.join(', ') || '—'} | zusätzlich → ${neu.join(', ') || '—'}`, 'font-weight:bold');
    },
    report() {
      const data = { tool: 'Bike24 Zahlungsarten-Debugger v1.0', url: location.href, gestartet: new Date(T0).toISOString(), kontext: ctx(),
        zahlungsarten: [...state.values()].map(o => ({ name: o.name, sichtbar: o.vis, deaktiviert: o.dis, grund: o.vis ? '' : whyHidden(o), html: o.html })),
        ereignisse: events, netzwerk: net.map(x => ({ methode: x.m, url: x.url, status: x.st, ende_ms: Math.round(x.end || 0), zahlungsbezug: x.hit })) };
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `bike24-zahlungsarten-debug-${T0}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      console.info('[B24] 📄 Report heruntergeladen. Vor dem Senden durchsehen: Netzwerk-Auszüge können Adresse/E-Mail enthalten → ggf. schwärzen.');
      return data;
    },
    stop() { mo.disconnect(); clearTimeout(timer); restore.forEach(f => f()); delete window.b24PayDbg; console.info('[B24] ⏹ Gestoppt, alle Hooks entfernt.'); }
  };

  // --- Start ---------------------------------------------------------------------
  console.log(`%c[B24] ▶ Debugger aktiv (${ts()}) – beobachte Zahlungsarten, Mutationen, JS-Aufrufe & Netzwerk`, 'color:#27c;font-weight:bold');
  if (document.body) scan();
  if (!state.size) console.warn('[B24] ⚠️ Noch kein Zahlungsarten-Container gefunden – Observer wartet auf nachgeladene Elemente (Lazy Loading / nächster Checkout-Schritt).');
  setTimeout(() => {
    if (!api || window.b24PayDbg !== api) return;
    if (!state.size) console.warn('[B24] ⚠️ Nach 10s keine Zahlungsarten gefunden. Lösung: Rechtsklick auf eine Zahlungsart → "Untersuchen" → Klasse/name ablesen → z.B. b24PayDbg.find(\'input[name="paymentMethod"]\')');
    else if (!events.length) console.info('[B24] ℹ️ 10s ohne Änderung. Waren Zahlungsarten schon VOR dem Start weg? → b24PayDbg.status() zeigt Grund; für Stack-Beweis Breakpoint-Methode aus der README nutzen.');
  }, 10000);
})();
