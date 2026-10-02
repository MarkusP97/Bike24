# Bike24 Zahlungsarten-Debugger 🔍

Konsolen-Skript (Vanilla JS, keine Abhängigkeiten), das im Bike24-Checkout aufzeichnet, **welche Zahlungsarten verschwinden, wann, wie und durch welchen JavaScript-Code**. Der Anlass: Bei mehreren Artikeln im Warenkorb verschwinden einige Zahlungsarten ca. 0,5 s nach dem Laden der Seite.

Datei: [`bike24-payment-debugger.js`](./bike24-payment-debugger.js)

## Was es loggt

| Was | Wie |
|---|---|
| Alle Zahlungsarten beim Start | `console.table` mit Name, sichtbar, deaktiviert, Grund |
| Ausgeblendet / entfernt / deaktiviert | `MutationObserver` auf dem ganzen Dokument, auch für nachgeladene Elemente |
| **Exakte Methode** | `display:none` per CSS-Klasse, Inline-Style oder `hidden`, `visibility`, `opacity`, Höhe 0, entfernter DOM-Knoten, `disabled` |
| **Verursachender JS-Code** | Hooks auf `classList`, `style`, `remove()`, `removeChild`, `innerHTML`, `setAttribute` usw. Sie greifen **nur** bei Zahlungsarten-Elementen und liefern einen klickbaren Stack (Datei:Zeile) |
| **Auslöser** | `fetch`/XHR-Mitschnitt: Welche Server-Antwort kam kurz vor dem Ausblenden (mit Ausschnitt, der Zahlungsarten erwähnt) |
| Kontext | Warenkorbsumme, Artikelanzahl, Land, Sperrgut- und Lieferzeit-Hinweise, ApplePay/PaymentRequest-Support |
| 1 Artikel vs. mehrere | `b24PayDbg.compare()` vergleicht die zwei letzten Läufe (in localStorage gespeichert) |

## Anleitung (Chrome / Edge / Brave)

Das Ausblenden passiert ca. 0,5 s nach dem Laden. Das ist zu schnell, um das Skript per Hand einzufügen. Deshalb gehst du so vor:

1. Zur Zahlungsart-Seite im Checkout gehen, dann `F12` drücken.
2. Im Tab **Sources** rechts **Event Listener Breakpoints** aufklappen, dann **Script** → ✅ **Script First Statement** anhaken.
3. Seite neu laden (`F5`). Der Debugger hält beim ersten Skript an.
4. Im Tab **Console** den kompletten Inhalt von `bike24-payment-debugger.js` einfügen und `Enter` drücken.
5. In **Sources** das Häkchen bei *Script First Statement* wieder entfernen und dann `F8` (Fortsetzen) drücken.
6. Zuschauen: Rote Gruppen 🙈 ❌ 🚫 zeigen jede verschwundene Zahlungsart samt Beweis.

> 💡 Falls der Checkout ohne Neuladen zwischen den Schritten wechselt (Single-Page-App), reicht es auch, das Skript **vorher** im Warenkorb einzufügen.
> Wenn du es erst einfügst, nachdem die Zahlungsarten schon weg sind, zeigt die Tabelle beim Start trotzdem, *welche* versteckt sind und *wie*. Nur der JS-Stack fehlt dann.

**Vergleich für den Beweis „nur bei mehreren Artikeln“:**
1. Mit **1 Artikel** wie oben einmal laufen lassen.
2. Mit **mehreren Artikeln** noch einmal laufen lassen.
3. `b24PayDbg.compare()` eingeben. Ausgabe: Summe und Artikel beider Läufe plus *„fehlt im 2. Lauf → Rechnung, …“*

## Befehle

```js
b24PayDbg.status()    // aktuelle Zahlungsarten als Tabelle
b24PayDbg.compare()   // 1-Artikel-Lauf vs. Mehr-Artikel-Lauf
b24PayDbg.report()    // JSON-Beweisdatei herunterladen
b24PayDbg.find('input[name="paymentMethod"]')  // eigener Selektor, falls nichts gefunden wird
b24PayDbg.stop()      // alles abbauen, Originalfunktionen wiederherstellen
```

## Wenn nichts geloggt wird

- **„Kein Zahlungsarten-Container gefunden“:** Rechtsklick auf eine Zahlungsart → *Untersuchen*. Dann `name`, Klasse oder `data-…` ablesen und `b24PayDbg.find('…')` aufrufen.
- **Zahlungsarten gefunden, aber keine Änderung:** Wahrscheinlich waren sie schon vor dem Start weg. `b24PayDbg.status()` zeigt den Grund. Für den Stack nimmst du die Breakpoint-Methode oben.
- **„Kein JS-Stack erfasst“:** Im Elements-Tab Rechtsklick auf das Element (oder dessen Eltern) → *Break on* → *attribute modifications* / *node removal* wählen, dann neu laden. Der Debugger hält genau an der verantwortlichen Codezeile an.
- **Zahlungsarten in einem iframe** (z. B. Klarna/PayPal-Widget): In der Console oben links den Kontext (`top` ▾) auf das iframe umstellen und das Skript dort einfügen.

## Bug-Report an den Bike24-Support

1. `b24PayDbg.report()` aufrufen. Damit wird `bike24-zahlungsarten-debug-<zeit>.json` heruntergeladen.
2. ⚠️ **Datei vorher durchsehen:** Die Netzwerk-Auszüge können Adresse oder E-Mail enthalten. Solche Stellen schwärzen.
3. Screenshot der Console mit aufgeklappter roter Gruppe und der `compare()`-Ausgabe machen.
4. Vorlage:

```
Betreff: Zahlungsarten verschwinden im Checkout bei mehreren Artikeln

Hallo Bike24-Team,

im Checkout verschwinden bei mehreren Artikeln im Warenkorb nach ca. 0,5 s
folgende Zahlungsarten: <aus compare(): "fehlt im 2. Lauf">.
Mit nur einem Artikel sind alle verfügbar.

- 1 Artikel (<Summe>): <sichtbar>
- <n> Artikel (<Summe>): <sichtbar>
- Ausgeblendet per: <z. B. "display:none via CSS-Klasse is-hidden">
- Ausgelöst durch: <JS-Datei:Zeile aus dem Stack> nach Antwort von <Request-URL>
- Browser: <Browser/Version>, Lieferland: <Land>

Falls das Absicht ist (z. B. Betragslimit für Rechnung/Klarna, Sperrgut,
Mischwarenkorb), bitte im Checkout einen Hinweis anzeigen, statt die Option
kommentarlos auszublenden. Debug-Log und Screenshots hängen an.

Viele Grüße
```

## Getestet

- Chromium (Headless, Playwright), getestet mit einer Checkout-ähnlichen Testseite: CSS-Klasse, Inline-`style.display`, `remove()` und `disabled` wurden jeweils mit Methode, Mutation, Stack und Netzwerk-Auslöser erkannt. Getestet wurden Start vor dem Laden und nach dem Laden, Doppelstart-Schutz, `compare()`, `report()` und `stop()`.
- Edge und Brave basieren auf Chromium. Firefox wurde nicht automatisiert getestet. Das Skript nutzt nur Standard-APIs, und wo `checkVisibility` fehlt, gibt es einen Fallback.
