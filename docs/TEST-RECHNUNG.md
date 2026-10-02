# Experiment: Filtert der Server „Rechnung“ – oder das Frontend?

**Idee:** Wir schreiben lokal in deinem Browser „Rechnung“ zurück in die Antwort von
`GET /api/checkout/payment-methods` und schauen, was Bike24 beim Weitergehen macht.
Es wird nichts gekauft, nichts an Bike24 gesendet, nur die eigene Seitenansicht verändert.

| Ergebnis | Bedeutung |
|---|---|
| (a) Seite verhält sich kaputt/komisch | Frontend verlässt sich auf die Server-Liste |
| (b) Weiter/Bestellübersicht wird abgelehnt (Fehlermeldung, Rückkehr zur Zahlungsart) | Server prüft die Regel selbst, **sauberes Verhalten, kein Fehler** |
| (c) Alles geht durch bis zur Übersicht | Regel wird nur im Frontend/in der Liste erzwungen, **das wäre meldenswert** |

> Wichtig: Nur bis **„Bestellübersicht“** gehen. Der finale Button („Zahlungspflichtig bestellen“ o. Ä.)
> wird vom Skript blockiert, aber **klick ihn trotzdem nie an.**

## Einmalige Einrichtung
1. Debugger ist installiert (v2.2.0, Update holen).
2. Neues Skript in Tampermonkey anlegen: **Dashboard → „+“ → Inhalt von `bike24-rechnung-test.user.js` einfügen → Speichern (Strg+S).**
   Reihenfolge im Dashboard: Debugger oben, Test-Skript darunter (dann sieht der Debugger die echte Server-Antwort).
   Bewusst **ohne** Auto-Update.
3. Das Test-Skript ist **standardmäßig AUS**.

## Checkliste (zum Abhaken)

**Teil 1: ohne Eingriff (Test-Skript AUS)**
- [ ] 1. Zahlungsseite mit wenig Inhalt öffnen. Screenshot: Warenkorbsumme + Liste der Zahlungsarten (mit „Rechnung“).
- [ ] 2. Menge Schritt für Schritt erhöhen, jeweils Summe notieren. Ab welcher Summe **X €** verschwindet „Rechnung“? Screenshot der Summe + Zahlungsarten (ohne „Rechnung“).
- [ ] 3. Debugger-Bericht speichern (Button „Bericht speichern“) → Datei `bericht-1-ohne-eingriff.txt`.

**Teil 2: mit Eingriff (Test-Skript AN)**
- [ ] 4. Auf der Bike24-Seite F12 → Konsole → `localStorage.b24RechnungTest = '1'` → Enter → Seite neu laden. Roter Banner „🧪 TEST-MODUS“ oben = aktiv.
- [ ] 5. Gleicher Warenkorb wie bei Schritt 2. Konsole zeigt `[Bike24 Test] Payment-Methods verändert: Rechnung hinzugefügt`. Screenshot der Konsole (mit Vorher/Nachher-Zeilen).
- [ ] 6. „Rechnung“ ist in der Liste sichtbar? Screenshot (Summe + Zahlungsarten sichtbar).
- [ ] 7. „Rechnung“ anklicken. Funktioniert die Auswahl? Screenshot.
- [ ] 8. „Weiter“ bis zur **Bestellübersicht**. Steht dort noch „Rechnung“? Oder Fehlermeldung / Rücksprung? Screenshot (jeder Schritt).
- [ ] 9. **Abbrechen.** Nicht bestellen. Debugger-Bericht speichern → `bericht-2-mit-eingriff.txt` (enthält automatisch den Hinweis „TESTLAUF“ + Log der Änderung).
- [ ] 10. Test-Skript wieder ausschalten: roter Banner → „Ausschalten“ (oder Konsole `__b24Inject.off()`), Seite neu laden.

## Auswertung
- **Fehlermeldung / Rücksprung bei Schritt 7–8** → Ergebnis (b): Server validiert. Kein Fehler, nur eine fehlende Erklärung im Checkout (das ist auch eine sinnvolle Rückmeldung an Bike24).
- **Alles geht durch bis Übersicht** → Ergebnis (c). Das heißt noch nicht, dass der Kauf am Ende klappt, denn die Prüfung kann erst beim finalen Absenden kommen, und das testen wir bewusst nicht.

## Zur „Bug-Bounty-Relevanz“ (ehrlich)
- Ich konnte **nicht prüfen**, ob Bike24 überhaupt ein Bug-Bounty-Programm hat (kein Web-Zugriff in dieser Aufgabe). Schau auf bike24.de nach `security.txt` (`bike24.de/.well-known/security.txt`) oder einer „Responsible Disclosure“-Seite. Gibt es keine, gibt es auch kein Bounty.
- Ein ausgeblendetes Zahlungsmittel bei höherer Summe ist normalerweise eine **Geschäftsregel**, keine Sicherheitslücke. Selbst im Fall (c) ist es höchstens ein Logikfehler und nur relevant, wenn der Server am Ende die Bestellung mit gesperrter Zahlungsart durchlässt, und das darfst du **ohne ausdrückliche Erlaubnis nicht testen** (das wäre ein echter Kaufversuch).
- Deshalb in der Meldung **kein** „Bug Bounty“-Druck aufbauen, sondern sachlich als Fehlerbericht/Hinweis schreiben.

## Entwurf für den Support (Version nach dem Test, Platzhalter in `[ ]` ausfüllen)

> **Betreff:** Zahlungsart „Rechnung“ verschwindet im Checkout bei höherer Warenkorbsumme
>
> Hallo Bike24-Team,
>
> bei mir verschwindet die Zahlungsart „Rechnung“ im Checkout, sobald die Warenkorbsumme ca. **[X] €** übersteigt (Mengen­änderung im Warenkorb, Konto mit Standard-Zahlungsart Rechnung). Laut Netzwerkprotokoll liefert `GET /api/checkout/payment-methods` ab dieser Summe „Rechnung“ nicht mehr aus; gleichzeitig erscheint „Klarna – Ratenkauf“.
>
> Fragen:
> 1. Ist das eine gewollte Betragsgrenze für den Rechnungskauf? Falls ja, wäre ein Hinweis im Checkout hilfreich (z. B. „Rechnung ist bis X € verfügbar“).
> 2. Falls nicht gewollt: Bitte prüfen.
>
> **Hinweis zur Transparenz:** Zur Eingrenzung habe ich in meinem eigenen Browser (rein lokal) die Antwort der Zahlungsarten-Liste testweise ergänzt, um zu sehen, ob die Seite „Rechnung“ dann annimmt. **[Ergebnis (a)/(b)/(c) eintragen, z. B. „Die Bestellübersicht lehnte die Auswahl mit der Meldung … ab“].** Es wurde dabei **keine Bestellung abgeschickt**.
>
> Anhänge: Screenshots [1–5], Bericht 1 (ohne Eingriff), Bericht 2 (Testlauf, im Bericht als „TESTLAUF“ markiert).
>
> Viele Grüße
