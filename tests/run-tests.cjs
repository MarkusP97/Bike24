// Automatische Browser-Tests für den Bike24 Zahlungsarten-Debugger.
// Startet einen lokalen Test-Server mit nachgebauten Checkout-Seiten (Vanilla, React, Vue, jQuery …)
// und prüft in echtem Chromium, ob der Debugger alles korrekt erkennt – und die Seite nicht stört.
//
// Aufruf:  cd tests && npm install && npm test
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

let pw;
try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bike24-payment-debugger.js'), 'utf8');
const INJ = fs.readFileSync(path.join(ROOT, 'bike24-rechnung-test.user.js'), 'utf8');
const USER = fs.readFileSync(path.join(ROOT, 'bike24-payment-debugger.user.js'), 'utf8');
const NM = path.join(__dirname, 'node_modules');
const DL = path.join(__dirname, 'downloads');

// Server-Antwort wie bei einem echten Shop – inkl. persönlicher Daten, um die Schwärzung zu testen
const API = JSON.stringify({
  paymentMethods: [
    { code: 'paypal', available: true }, { code: 'invoice', available: false, reason: 'MAX_AMOUNT' },
    { code: 'prepayment', available: false, reason: 'MIXED_CART' }, { code: 'creditcard', available: true }
  ],
  customer: { email: 'max.mustermann@example.com', firstName: 'Max', lastName: 'Mustermann', street: 'Musterweg 1', phone: '+49 170 1234567' }
});

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    // Bike24-ähnliche API (Struktur aus echten Nutzer-Berichten)
    const multi = url.search.includes('multi');
    if (url.pathname === '/api/checkout/payment-methods') {
      const all = [{ id: 5, name: 'Rechnung' }, { id: 29, name: 'Kredit-/Debitkarte' }, { id: 100, name: 'Kredit-/ Debitkarte' }, { id: 15, name: 'PayPal' }, { id: 7, name: 'Vorkasse' }];
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(all.filter(m => !(multi && m.id === 5)).map(m => ({ ...m, description: 'Zahlung per ' + m.name, icons: [] }))));
    }
    if (url.pathname === '/api/cart') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(multi ? { items: [{ quantity: 2 }, { quantity: 1 }], totalPrice: 412.97 } : { items: [{ quantity: 1 }], totalPrice: 89.99 })); }
    if (url.pathname === '/api/v2/user-account') {   // echte Antworten enthalten \u-Escapes – Schwärzung muss damit klarkommen
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"defaultPayment":5,"deliveryAddressList":[{"firstName":"Max","lastName":"Mustermann","street":"Musterstra\\u00dfe 87","houseNumber":"87","postalCode":"90402","city":"N\\u00fcrnberg","phone":"0911 123456"}]}');
    }
    if (url.pathname === '/api/payment-methods') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(API); }
    let file; const headers = {};
    if (url.pathname.startsWith('/csp/')) {   // gleiche Testseiten, aber mit strenger Sicherheits-Policy wie bei großen Shops
      file = path.join(__dirname, 'fixtures', url.pathname.slice(5));
      headers['content-security-policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'; require-trusted-types-for 'script'; trusted-types default";
    } else if (url.pathname.startsWith('/fixtures/')) file = path.join(__dirname, url.pathname);
    else if (url.pathname.startsWith('/nm/')) file = path.join(NM, url.pathname.slice(4));
    if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end('404'); }
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript';
    res.writeHead(200, { 'content-type': type, ...headers }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// ── Mini-Testframework ─────────────────────────────────────────────────────────
const results = [];
function check(test, name, ok, detail = '') { results.push({ test, name, ok: !!ok, detail }); }
const evOf = (data, name) => (data?.ereignisse || []).filter(e => e.zahlungsart.includes(name));
const badOf = data => (data?.ereignisse || []).filter(e => e.schlimm);
const codeTxt = e => (e?.code || []).map(c => `${c.aufruf} @ ${c.wo}`).join(' | ');

(async () => {
  fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const server = await serve();
  const BASE = `http://127.0.0.1:${server.address().port}`;
  const browser = await pw.chromium.launch();

  async function open(fixture, { mode = 'early', context, query = '', wait = 1500, late = 150, pre, post } = {}) {
    const ctx = context || await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage(); const logs = []; const errors = [];
    page.on('console', m => logs.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', e => errors.push(e.message));
    if (pre) await page.addInitScript(pre);
    if (mode === 'early') await page.addInitScript(SRC);
    if (mode === 'auto') await page.addInitScript(USER);
    if (post) await page.addInitScript(post);   // läuft NACH dem Debugger (wie ein später installiertes Userscript)
    await page.goto(`${BASE}/${fixture.includes('/') ? fixture : 'fixtures/' + fixture}${query}`);
    if (mode === 'late') { await page.waitForTimeout(late); await page.evaluate(SRC); }
    await page.waitForTimeout(wait);
    const data = await page.evaluate(() => window.b24PayDbg ? window.b24PayDbg.data() : null);
    const b24 = logs.filter(l => l.text.includes('[B24]'));
    return { page, ctx, logs, b24, errors, data };
  }

  // 1) Vanilla-JS: alle 8 Ausblend-Methoden, Start vor dem Laden (wie Tampermonkey)
  {
    const T = 'vanilla (früher Start)';
    const { data, errors, b24, ctx } = await open('vanilla.html');
    const names = data.zahlungsarten.map(z => z.name);
    check(T, '9 Zahlungsarten erkannt', names.length === 9, names.join(', '));
    check(T, '„Rechnungsadresse“-Radio NICHT als Zahlungsart erkannt', !names.some(n => /adresse/i.test(n)), names.join(', '));
    check(T, 'Versand-Radio „Nachnahme“ NICHT erkannt', !names.some(n => /versand per/i.test(n)));
    check(T, 'Footer-/Header-Logos ignoriert', !names.some(n => /sichere zahlung|logos/i.test(n)));
    const expect = [
      ['Kauf auf Rechnung', '🙈', /display:none.*\.is-hidden/, /classList|add\("is-hidden"\)/],
      ['Vorkasse', '❌', /ENTFERNT/, /remove\(\)/],
      ['Kreditkarte', '🙈', /Inline-Style/, /style\.display\("none"\)/],
      ['Apple Pay', '🚫', /DEAKTIVIERT/, /disabled\(true\)/],
      ['SEPA', '🙈', /hidden-Attribut/, /hidden\(true\)/],
      ['Klarna', '🙈', /opacity:0/, /style\.setProperty\("opacity"/],
      ['giropay', '🙈', /visibility:hidden/, /setAttribute\("style"/],
      ['Google Pay', '🙈', /data-state=off|\[data-state="?off"?\]/, null]
    ];
    for (const [n, icon, how, code] of expect) {
      const e = evOf(data, n).find(x => x.typ === icon);
      check(T, `${n}: ${icon} erkannt`, e, JSON.stringify(evOf(data, n).map(x => x.typ)));
      check(T, `${n}: Methode korrekt`, e && how.test(e.was), e?.was);
      if (code) {
        check(T, `${n}: auslösender Aufruf erfasst`, e && code.test(codeTxt(e)), codeTxt(e));
        check(T, `${n}: Code-Stelle zeigt auf Seiten-Skript (applyPaymentRules)`, e && e.code.some(c => /vanilla\.html.*applyPaymentRules/.test(c.wo)), codeTxt(e));
      } else check(T, `${n}: Attribut-Änderung als Beweis geloggt`, e && e.aenderungen.some(a => /data-state/.test(a)), e?.aenderungen.join(' | '));
    }
    const inv = evOf(data, 'Rechnung')[0];
    check(T, 'Server-Antwort vor dem Ausblenden erfasst (fetch)', inv?.server.some(s => /\/api\/payment-methods/.test(s.url) && /MAX_AMOUNT/.test(s.auszug)), JSON.stringify(inv?.server));
    check(T, 'Kontext: Summe/Artikel/Land', data.kontext.summe === '412,97 €' && data.kontext.artikel === '3' && data.kontext.land === 'Deutschland', JSON.stringify(data.kontext));
    check(T, 'Vermutung für Rechnung nennt Betragsgrenze', /Betragsgrenze/.test(inv?.vermutung));
    check(T, 'genau 8 rote Meldungen (keine Log-Flut)', badOf(data).length === 8, badOf(data).map(e => e.typ + e.zahlungsart).join(', '));
    check(T, 'keine JavaScript-Fehler auf der Seite', errors.length === 0, errors.join(' | '));
    check(T, 'Tabelle beim Start ausgegeben', b24.some(l => /9 Zahlungsart\(en\) gefunden/.test(l.text)));
    await ctx.close();
  }

  // 2) Konsole: eingefügt 150ms nach dem Laden (vor dem Ausblenden)
  {
    const T = 'vanilla (Konsole, rechtzeitig)';
    const { data, errors, ctx } = await open('vanilla.html', { mode: 'late', late: 150 });
    check(T, '8 rote Meldungen', badOf(data).length === 8, badOf(data).map(e => e.zahlungsart).join(', '));
    check(T, 'Code-Stelle trotzdem gefunden', evOf(data, 'Kreditkarte')[0]?.code.some(c => /applyPaymentRules/.test(c.wo)));
    check(T, 'keine Seitenfehler', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 3) Konsole: zu spät eingefügt (Zahlungsarten schon weg)
  {
    const T = 'vanilla (Konsole, zu spät)';
    const { data, b24, ctx } = await open('vanilla.html', { mode: 'late', late: 1300, wait: 300 });
    const hidden = data.zahlungsarten.filter(z => !z.sichtbar || z.deaktiviert);
    check(T, 'versteckte Zahlungsarten in der Tabelle', hidden.length === 7, hidden.map(z => z.name).join(', '));
    check(T, 'Grund wird trotzdem genannt', hidden.every(z => z.grund), JSON.stringify(hidden.map(z => z.grund)));
    check(T, 'Warnung „schon beim Start unsichtbar“', b24.some(l => l.type === 'warning' && /schon beim Start/.test(l.text)));
    await ctx.close();
  }

  // 4) React 18 (keyed Liste, Einträge werden entfernt)
  {
    const T = 'React 18';
    const { data, errors, page, ctx } = await open('react.html');
    for (const n of ['Rechnung', 'Vorkasse']) {
      const e = evOf(data, n).find(x => x.typ === '❌');
      check(T, `${n}: ❌ entfernt`, e, JSON.stringify(evOf(data, n)));
      check(T, `${n}: removeChild + Stack erfasst`, e && /removeChild/.test(codeTxt(e)) && e.code[0].wo, codeTxt(e));
    }
    check(T, 'PayPal/Kreditkarte nicht gemeldet', !evOf(data, 'PayPal').length && !evOf(data, 'Kreditkarte').length);
    await page.click('input[value=paypal]'); await page.waitForTimeout(100);
    check(T, 'React funktioniert weiter (Klick auf PayPal)', /paypal/.test(await page.textContent('#sel')));
    check(T, 'keine Seitenfehler', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 5) Vue 3 (v-for entfernt + v-show blendet per style.display aus)
  {
    const T = 'Vue 3';
    const { data, errors, page, ctx } = await open('vue.html');
    check(T, 'kein Fehlalarm durch das Vue-Template beim Laden', !data.ereignisse.some(e => /\{\{/.test(e.zahlungsart)), data.ereignisse.map(e => e.zahlungsart).join(', '));
    for (const n of ['Rechnung', 'Vorkasse']) check(T, `${n}: ❌ mit removeChild`, evOf(data, n).some(e => e.typ === '❌' && /removeChild/.test(codeTxt(e))), JSON.stringify(evOf(data, n).map(codeTxt)));
    const cc = evOf(data, 'Kreditkarte').find(e => e.typ === '🙈');
    check(T, 'Kreditkarte: 🙈 per v-show (Inline-Style + style.display)', cc && /Inline-Style/.test(cc.was) && /style\.display/.test(codeTxt(cc)), cc ? cc.was + ' / ' + codeTxt(cc) : 'nicht gemeldet');
    await page.click('input[value=paypal]'); await page.waitForTimeout(100);
    check(T, 'Vue funktioniert weiter (v-model)', /paypal/.test(await page.textContent('#sel')));
    check(T, 'keine Seitenfehler', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 6) jQuery (addClass, hide, remove, XHR)
  {
    const T = 'jQuery 3';
    const { data, errors, ctx } = await open('jquery.html');
    const inv = evOf(data, 'Rechnung')[0], cc = evOf(data, 'Kreditkarte')[0], pre = evOf(data, 'Vorkasse')[0];
    check(T, 'Rechnung: .addClass → CSS-Regel .d-none', inv && /\.d-none/.test(inv.was) && /setAttribute\("class"|className|add\(/.test(codeTxt(inv)), inv ? inv.was + ' / ' + codeTxt(inv) : '-');
    check(T, 'Kreditkarte: .hide() → Inline-Style', cc && /Inline-Style/.test(cc.was) && /style\.display/.test(codeTxt(cc)), cc ? cc.was + ' / ' + codeTxt(cc) : '-');
    check(T, 'Vorkasse: .remove() → removeChild', pre && /removeChild/.test(codeTxt(pre)), pre ? codeTxt(pre) : '-');
    check(T, 'Server-Antwort per XHR erfasst', inv?.server.some(s => /payment-methods/.test(s.url) && /MAX_AMOUNT/.test(s.auszug)), JSON.stringify(inv?.server));
    check(T, 'keine Seitenfehler', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 7) Nachgeladene Zahlungsarten (Lazy Loading / Single-Page-Checkout)
  {
    const T = 'Lazy Loading';
    const { data, b24, ctx } = await open('lazy.html', { wait: 2000 });
    check(T, 'Zahlungsarten nach dem Nachladen gefunden', data?.zahlungsarten.length === 3, JSON.stringify(data?.zahlungsarten.map(z => z.name)));
    check(T, 'Tabelle erst beim Erscheinen, ohne ➕-Flut', b24.some(l => /3 Zahlungsart\(en\) gefunden/.test(l.text)) && !data.ereignisse.some(e => e.typ === '➕'));
    const inv = evOf(data, 'Rechnung')[0];
    check(T, 'Rechnung 🙈 mit Code-Stelle hideInvoice', inv?.typ === '🙈' && inv.code.some(c => /hideInvoice/.test(c.wo)), inv ? codeTxt(inv) : '-');
    await ctx.close();
  }

  // 8) Liste wird in einem Rutsch neu aufgebaut (innerHTML)
  {
    const T = 'Neuaufbau (innerHTML)';
    const { data, ctx } = await open('rebuild.html');
    check(T, 'nur Rechnung als ❌ gemeldet', badOf(data).length === 1 && badOf(data)[0].zahlungsart === 'Rechnung', badOf(data).map(e => e.zahlungsart).join(', '));
    check(T, 'innerHTML als Auslöser', /innerHTML/.test(codeTxt(badOf(data)[0])), codeTxt(badOf(data)[0]));
    await ctx.close();
  }

  // 9) Liste erst geleert, dann neu aufgebaut
  {
    const T = 'Neuaufbau (erst leer, dann neu)';
    const { data, b24, ctx } = await open('rebuild.html', { query: '?gap' });
    const e = badOf(data);
    check(T, 'Rechnung als „FEHLT nach Neuaufbau“', e.length === 1 && /FEHLT/.test(e[0].was) && e[0].zahlungsart === 'Rechnung', e.map(x => x.zahlungsart + ': ' + x.was).join(' | '));
    check(T, 'replaceChildren als Auslöser', /replaceChildren/.test(codeTxt(e[0])), codeTxt(e[0]));
    check(T, 'Info-Meldung „3 von 4 wieder da“', b24.some(l => /3 von 4 wieder da/.test(l.text)));
    await ctx.close();
  }

  // 10) Nutzer verlässt die Zahlungsseite (Single-Page-App) → KEIN Fehlalarm
  {
    const T = 'Seitenwechsel';
    const { data, b24, ctx } = await open('leave.html');
    check(T, 'keine roten Meldungen', badOf(data).length === 0, badOf(data).map(e => e.zahlungsart).join(', '));
    check(T, 'graue Info statt Alarm', b24.some(l => /komplett entfernt/.test(l.text)));
    await ctx.close();
  }

  // 11) CSS-Tricks ohne DOM-Änderung (insertRule), nur Beschriftung versteckt, neues <style>
  {
    const T = 'CSS-Tricks';
    const { data, errors, ctx } = await open('cssom.html');
    const inv = evOf(data, 'Rechnung')[0], cc = evOf(data, 'Kreditkarte')[0], gp = evOf(data, 'giropay')[0];
    check(T, 'insertRule ohne DOM-Änderung erkannt (ResizeObserver)', inv?.typ === '🙈' && /\.pm-inv/.test(inv.was), inv?.was);
    check(T, 'insertRule-Aufruf mit Code-Stelle', inv?.css.some(c => /cssTricks/.test(c.wo)), JSON.stringify(inv?.css));
    check(T, 'nur Beschriftung versteckt → erkannt', cc?.typ === '🙈' && /<label>/.test(cc.was), cc?.was);
    check(T, '… mit Code-Stelle', cc?.code.some(c => /style\.display/.test(c.aufruf) && /cssTricks/.test(c.wo)), cc ? codeTxt(cc) : '-');
    check(T, 'neues <style> erkannt + Code-Stelle', gp?.typ === '🙈' && gp.css.some(c => /cssTricks/.test(c.wo)), gp ? gp.was + ' / ' + JSON.stringify(gp.css) : '-');
    check(T, 'keine Seitenfehler', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 12) Nur Logos, keine Radio-Buttons (Fallback über Bild-Alt-Text)
  {
    const T = 'Logo-Kacheln (Fallback)';
    const { data, ctx } = await open('logos.html');
    check(T, '3 Zahlungsarten über Bild-Alt-Text', data?.zahlungsarten.length === 3, JSON.stringify(data?.zahlungsarten.map(z => z.name)));
    check(T, 'Rechnung 🙈', evOf(data, 'Rechnung')[0]?.typ === '🙈');
    await ctx.close();
  }

  // 13) Tampermonkey-Modus auf einer Produktseite → komplett still
  {
    const T = 'Tampermonkey auf Produktseite';
    const { b24, page, ctx } = await open('nonpayment.html', { mode: 'auto' });
    check(T, 'keine einzige Konsolen-Meldung', b24.length === 0, b24.map(l => l.text).join(' | '));
    check(T, 'kein Panel', await page.evaluate(() => !document.getElementById('b24-dbg-panel')));
    await ctx.close();
  }

  // 14) Tampermonkey-Modus im Checkout: Panel, Bericht-Knopf, Schwärzung
  {
    const T = 'Tampermonkey + Panel + Bericht';
    const { page, ctx } = await open('vanilla.html', { mode: 'auto' });
    const panelText = await page.evaluate(() => document.getElementById('b24-dbg-panel')?.shadowRoot?.textContent || '');
    check(T, 'Panel zeigt „8 von 9 Zahlungsarten weg“', /8 von 9 Zahlungsarten weg/.test(panelText), panelText.slice(0, 120));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => document.getElementById('b24-dbg-panel').shadowRoot.querySelector('[data-act=report]').click())]);
    const file = path.join(DL, dl.suggestedFilename()); await dl.saveAs(file);
    const rep = fs.readFileSync(file, 'utf8');
    check(T, 'Bericht-Datei heruntergeladen', /bike24-zahlungsarten-bericht-.*\.txt$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    check(T, 'Bericht beginnt mit fertigem Support-Text', rep.startsWith('Betreff: Zahlungsarten verschwinden'));
    check(T, 'Bericht nennt Code-Stelle + Server-Antwort', /applyPaymentRules/.test(rep) && /\/api\/payment-methods/.test(rep));
    check(T, 'E-Mail geschwärzt', !rep.includes('max.mustermann@example.com') && /email\\?":\s*\\?"\[entfernt\]/.test(rep));
    check(T, 'Telefon geschwärzt', !/\+49 170/.test(rep));
    check(T, 'Name/Straße geschwärzt', !/Mustermann|Musterweg/.test(rep), (rep.match(/.{40}Muster.{20}/) || [''])[0]);
    check(T, 'technischer Anhang ist gültiges JSON', (() => { try { JSON.parse(rep.split(/TECHNISCHER ANHANG.*\n=+\n/)[1]); return true; } catch (e) { return false; } })());
    await page.evaluate(() => document.getElementById('b24-dbg-panel').shadowRoot.querySelector('[data-act=compare]').click());
    const p2 = await page.evaluate(() => document.getElementById('b24-dbg-panel').shadowRoot.textContent);
    check(T, 'Vergleichen-Knopf zeigt Hinweis', /Vergleich/.test(p2));
    await ctx.close();
  }

  // 15) Vergleich: erst 1 Artikel, dann mehrere Artikel
  {
    const T = 'Vergleich 1 vs. mehrere Artikel';
    const ctx = await browser.newContext();
    await (await open('vanilla.html', { mode: 'auto', context: ctx, query: '?single', wait: 800 })).page.close();
    const { data, page } = await open('vanilla.html', { mode: 'auto', context: ctx });
    check(T, 'Vergleich möglich', data.vergleichOk, data.vergleich);
    check(T, 'fehlende Zahlungsarten korrekt', /Nur im früheren Lauf verfügbar: Kauf auf Rechnung, Vorkasse.*Kreditkarte, Apple Pay, SEPA-Lastschrift, Klarna Ratenkauf, giropay, Google Pay/s.test(data.vergleich), data.vergleich);
    check(T, 'Summen beider Läufe', /89,99 €/.test(data.vergleich) && /412,97 €/.test(data.vergleich));
    await page.close(); await ctx.close();
  }

  // 16) Doppelt eingefügt
  {
    const T = 'Doppelstart';
    const { page, b24, ctx } = await open('vanilla.html', { query: '?single', wait: 300 });
    await page.evaluate(SRC); await page.waitForTimeout(100);
    const logs = []; page.on('console', m => logs.push(m.text()));
    await page.evaluate(SRC);
    check(T, 'Hinweis „läuft schon“', logs.some(t => /läuft schon/.test(t)));
    check(T, 'nur ein Panel', await page.evaluate(() => document.querySelectorAll('#b24-dbg-panel').length === 1));
    check(T, 'Startmeldung nur einmal', b24.filter(l => /gestartet/.test(l.text)).length === 1);
    await ctx.close();
  }

  // 17) Nichts gefunden → Hinweis + eigener Selektor
  {
    const T = 'Eigener Selektor (find)';
    const { page, b24, ctx } = await open('custom.html', { mode: 'late', late: 100, wait: 200 });
    check(T, 'Hinweis „warte auf Zahlungsarten“', b24.some(l => /Noch keine Zahlungsarten/.test(l.text)));
    await page.evaluate(() => b24PayDbg.find('.zahlungsoption'));
    await page.waitForTimeout(1600);
    const data = await page.evaluate(() => b24PayDbg.data());
    check(T, '2 Optionen per find() gefunden', data.zahlungsarten.length === 2, JSON.stringify(data.zahlungsarten.map(z => z.name)));
    check(T, 'Entfernen von Option B erkannt', evOf(data, 'Option B').some(e => e.typ === '❌'));
    const logs = []; page.on('console', m => logs.push(m.text()));
    await page.evaluate(() => b24PayDbg.find('###'));
    check(T, 'ungültiger Selektor → freundliche Meldung', logs.some(t => /kein gültiger CSS-Selektor/.test(t)));
    await ctx.close();
  }

  // 18) Seite darf NICHT gestört werden + stop() stellt alles wieder her
  {
    const T = 'Sicherheit/Stabilität';
    const pre = `window.__orig = { remove: Element.prototype.remove, removeChild: Node.prototype.removeChild, styleGet: Object.getOwnPropertyDescriptor(HTMLElement.prototype,'style').get,
      add: DOMTokenList.prototype.add, fetch: window.fetch, open: XMLHttpRequest.prototype.open, insertRule: CSSStyleSheet.prototype.insertRule,
      className: Object.getOwnPropertyDescriptor(Element.prototype,'className').set };`;
    const { page, errors, ctx } = await open('vanilla.html', { query: '?single', wait: 400, pre });
    const r = await page.evaluate(async () => {
      const li = document.getElementById('pp'), out = {};
      out.claimed = li.style !== Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style').get.call(document.createElement('div'));
      out.identity = li.style === li.style;
      li.style.setProperty('color', 'rgb(255, 0, 0)'); out.setProperty = getComputedStyle(li).color === 'rgb(255, 0, 0)';
      li.style.cssText = 'color: blue'; out.cssText = li.style.color === 'blue';
      li.style = 'color: green'; out.styleSetter = li.style.getPropertyValue('color') === 'green';
      out.instanceOf = li.style instanceof CSSStyleDeclaration;
      out.iterable = [...li.style].includes('color');
      out.toStringTag = Object.prototype.toString.call(li.style) === '[object CSSStyleDeclaration]';
      out.classList = li.classList.toggle('x') === true && li.classList.contains('x');
      const nat = f => Function.prototype.toString.call(f).includes('[native code]');
      out.nativeLook = nat(Element.prototype.remove) && nat(window.fetch) && nat(XMLHttpRequest.prototype.open) && nat(DOMTokenList.prototype.add) && nat(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style').get);
      const f = window.fetch; out.fetchUnbound = (await (await f('/api/payment-methods')).json()).paymentMethods.length === 4;
      out.xhrJson = await new Promise(res => { const x = new XMLHttpRequest(); x.responseType = 'json'; x.onload = () => res(x.response.paymentMethods.length === 4); x.open('GET', '/api/payment-methods'); x.send(); });
      out.fetchError = await fetch('http://127.0.0.1:1/nope').then(() => false, () => true);
      b24PayDbg.stop();
      const o = window.__orig;
      out.restored = Element.prototype.remove === o.remove && Node.prototype.removeChild === o.removeChild && Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'style').get === o.styleGet
        && DOMTokenList.prototype.add === o.add && window.fetch === o.fetch && XMLHttpRequest.prototype.open === o.open && CSSStyleSheet.prototype.insertRule === o.insertRule
        && Object.getOwnPropertyDescriptor(Element.prototype, 'className').set === o.className;
      out.noPanel = !document.getElementById('b24-dbg-panel'); out.noApi = !window.b24PayDbg;
      return out;
    });
    for (const [k, v] of Object.entries(r)) check(T, k, v);
    check(T, 'keine Seitenfehler (inkl. fetch-Fehlerfall)', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 19) Performance: 20.000 DOM-Operationen mit/ohne Debugger
  {
    const T = 'Performance';
    const bench = () => { const host = document.createElement('div'); document.body.appendChild(host); const t = performance.now();
      for (let i = 0; i < 20000; i++) { const d = document.createElement('span'); host.appendChild(d); d.classList.add('a'); d.setAttribute('data-x', i); d.style.color = 'red'; d.textContent = 'x'; host.removeChild(d); }
      const r = performance.now() - t; host.remove(); return r; };
    const run = async mode => { const { page, ctx } = await open('vanilla.html', { mode, query: '?single', wait: 300 }); let best = Infinity; for (let i = 0; i < 3; i++) best = Math.min(best, await page.evaluate(bench)); await ctx.close(); return best; };
    const base = await run('none'), dbg = await run('early');
    check(T, `Overhead akzeptabel (ohne: ${base.toFixed(0)}ms, mit: ${dbg.toFixed(0)}ms für 120.000 Operationen)`, dbg < base * 4 + 50, `Faktor ${(dbg / base).toFixed(2)}`);
  }

  // 20) Bericht über die Konsole
  {
    const T = 'Bericht per Konsole';
    const { page, ctx } = await open('vanilla.html');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => b24PayDbg.report())]);
    const rep = fs.readFileSync(await dl.path(), 'utf8');
    check(T, 'Download über b24PayDbg.report()', rep.includes('Betreff:') && rep.includes('TECHNISCHER ANHANG'));
    check(T, 'Mail nennt betroffene Zahlungsarten', /Betroffene Zahlungsarten: .*Kauf auf Rechnung/.test(rep));
    await ctx.close();
  }

  // 23) Bike24-Struktur aus echten Berichten: Server liefert „Rechnung“ nicht mehr → Beweis „Server entscheidet“
  {
    const T = 'Bike24-Struktur (aus echten Berichten)';
    const { data, page, ctx } = await open('bike24like.html', { mode: 'auto' });
    const e = evOf(data, 'Rechnung').find(x => x.typ === '❌');
    check(T, 'Rechnung ❌ mit removeChild', e && /removeChild/.test(codeTxt(e)), JSON.stringify(evOf(data, 'Rechnung').map(x => x.typ)));
    check(T, 'Server-Liste erkannt: Rechnung fehlt darin', e?.serverListe?.enthaeltZahlungsart === false && /payment-methods/.test(e.serverListe.url), JSON.stringify(e?.serverListe));
    check(T, 'versteckte Legacy-Kreditkarte (id 100) ist kein Fehlalarm', !badOf(data).some(x => x.zahlungsart === 'Kredit-/ Debitkarte'));
    check(T, 'Warenkorb aus API gelesen (3 Stück, 412.97)', /3 Stück/.test(data.kontext.warenkorbApi) && /412\.97/.test(data.kontext.warenkorbApi), data.kontext.warenkorbApi);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => b24PayDbg.report())]);
    const rep = fs.readFileSync(await dl.path(), 'utf8');
    check(T, 'Mail nennt „Entscheidung fällt auf dem Server“', /Entscheidung fällt auf dem Server.*Rechnung/.test(rep));
    check(T, 'Adresse mit \\u-Escapes vollständig geschwärzt', !/u00df|u00fc|rnberg|Muster|90402|"87"/.test(rep), (rep.match(/.{30}(u00df|u00fc|rnberg|Muster|90402).{10}/) || [''])[0]);
    await ctx.close();
  }

  // 24) Rechnung-Test-Interceptor: Standard AUS, AN schreibt „Rechnung“ zurück, Debugger sieht das Original
  {
    const T = 'Rechnung-Test (Interceptor)';
    const off = await open('bike24like.html', { mode: 'auto', post: INJ });
    check(T, 'Standard AUS: Rechnung verschwindet wie bisher', badOf(off.data).some(x => x.zahlungsart === 'Rechnung'));
    check(T, 'Standard AUS: nichts verändert', await off.page.evaluate(() => __b24Inject.log.length === 0 && !__b24Inject.enabled));
    await off.ctx.close();

    const on = await open('bike24like.html', { mode: 'auto', post: `localStorage.setItem('b24RechnungTest','1');\n` + INJ });
    check(T, 'Konsole: „Payment-Methods verändert: Rechnung hinzugefügt“', on.logs.some(l => /Payment-Methods verändert: Rechnung hinzugefügt/.test(l.text)), on.logs.map(l => l.text).join(' // ').slice(0, 300));
    const inj = await on.page.evaluate(() => __b24Inject.log);
    check(T, 'Log: vorher ohne, nachher mit Rechnung (an erster Stelle)', inj.length === 1 && !inj[0].vorher.includes('Rechnung') && inj[0].nachher[0] === 'Rechnung', JSON.stringify(inj));
    check(T, 'Nur payment-methods verändert, übrige Einträge unverändert', inj[0]?.nachher.slice(1).join() === inj[0]?.vorher.join());
    check(T, 'Seite zeigt „Rechnung“ jetzt (Eintrag bleibt im DOM)', await on.page.evaluate(() => !!document.getElementById('payment-method-item-5')));
    check(T, 'Debugger meldet KEIN Verschwinden (Eintrag blieb)', !badOf(on.data).some(x => x.zahlungsart === 'Rechnung'));
    const [dl] = await Promise.all([on.page.waitForEvent('download'), on.page.evaluate(() => b24PayDbg.report())]);
    const rep = fs.readFileSync(await dl.path(), 'utf8');
    check(T, 'Bericht warnt: TESTLAUF + testEingriff im Anhang', /ACHTUNG – TESTLAUF/.test(rep) && /"testEingriff": \[\s*\{/.test(rep));
    const pmNet = JSON.parse(rep.slice(rep.indexOf('{\n  "tool"'))).netzwerk.filter(n => /payment-methods\?multi/.test(n.url));
    check(T, 'Debugger (innen) sah die ORIGINAL-Server-Liste ohne Rechnung', pmNet.length >= 1 && pmNet.every(n => !/Rechnung/.test(n.auszug)), JSON.stringify(pmNet).slice(0, 300));
    check(T, 'roter Banner vorhanden, blockiert keine Klicks', await on.page.evaluate(() => { const h = [...document.documentElement.children].find(e => e.style.zIndex === '2147483647' && e.style.pointerEvents === 'none'); return !!h && h.getBoundingClientRect().height > 10; }));
    check(T, 'keine Seitenfehler', on.errors.length === 0, on.errors.join('; '));
    await on.ctx.close();

    const g = await open('order-guard.html', { mode: 'auto', post: `localStorage.setItem('b24RechnungTest','1');\n` + INJ, wait: 300 });
    await g.page.click('#next'); await g.page.click('#order'); await g.page.click('#order2');
    const r = await g.page.evaluate(async () => {
      const a = await fetch('/api/checkout/order', { method: 'POST' }), b = await fetch('/api/checkout/orders-process', { method: 'POST' });
      const x = await new Promise(res => { const q = new XMLHttpRequest(); q.open('POST', '/api/checkout/place-order'); q.onerror = () => res('error'); q.onload = () => res('sent'); q.send(); });
      return { next: !!window.__next, ordered: !!window.__ordered, ordered2: !!window.__ordered2, orderFetch: a.status, processFetch: b.status, xhr: x, blocked: __b24Inject.blocked.length };
    });
    check(T, 'Weiter-Button („Bestellübersicht“) funktioniert', r.next);
    check(T, 'Finale Bestell-Buttons blockiert („Zahlungspflichtig bestellen“, „Jetzt kaufen“)', !r.ordered && !r.ordered2, JSON.stringify(r));
    check(T, 'POST an Bestell-Endpunkt (fetch + XHR) blockiert, orders-process läuft normal', r.orderFetch === 499 && r.xhr === 'error' && r.processFetch === 404, JSON.stringify(r));
    await g.ctx.close();
  }

  // 21) Strenge Content-Security-Policy + Trusted Types (Panel darf nicht kaputtgehen)
  {
    const T = 'Strenge Sicherheits-Policy (CSP + Trusted Types)';
    const { page, data, errors, ctx } = await open('csp/vanilla.html', { mode: 'auto' });
    check(T, 'Inline-Style-Hides trotzdem erkannt', evOf(data, 'Kreditkarte').some(e => e.typ === '🙈' && /applyPaymentRules/.test(codeTxt(e))));
    const styled = await page.evaluate(() => { const b = document.getElementById('b24-dbg-panel')?.shadowRoot?.querySelector('.b'); return b ? getComputedStyle(b).position : 'kein Panel'; });
    check(T, 'Panel wird formatiert angezeigt (position: fixed)', styled === 'fixed', styled);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => document.getElementById('b24-dbg-panel').shadowRoot.querySelector('[data-act=report]').click())]);
    check(T, 'Bericht-Download funktioniert', /bericht/.test(dl.suggestedFilename()));
    check(T, 'keine Seitenfehler', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 22) Screenshot vom Panel (zur Sichtkontrolle, landet in tests/downloads/)
  {
    const { page, ctx } = await open('vanilla.html', { mode: 'auto' });
    await page.setViewportSize({ width: 900, height: 620 });
    await page.screenshot({ path: path.join(DL, 'panel.png') });
    await ctx.close();
  }

  await browser.close(); server.close();

  // ── Ausgabe ────────────────────────────────────────────────────────────────
  let cur = '';
  for (const r of results) {
    if (r.test !== cur) { cur = r.test; console.log(`\n■ ${cur}`); }
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : `\n      → ${String(r.detail).slice(0, 400)}`}`);
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} Prüfungen bestanden${failed ? ` – ${failed} FEHLGESCHLAGEN` : ' 🎉'}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
