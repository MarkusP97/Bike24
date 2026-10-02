// Baut aus bike24-payment-debugger.js die Tampermonkey-Version (.user.js).
// Aufruf: node tools/build-userscript.mjs   (nach jeder Änderung am Hauptskript)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'bike24-payment-debugger.js'), 'utf8');
const version = src.match(/VERSION = '([\d.]+)'/)[1];
const tlds = ['de', 'com', 'at', 'es', 'fr', 'it', 'nl', 'be', 'lu', 'fi', 'pl', 'dk', 'si', 'ie', 'ch'];
const url = 'https://raw.githubusercontent.com/MarkusP97/Bike24/HEAD/bike24-payment-debugger.user.js';

const header = `// ==UserScript==
// @name         Bike24 Zahlungsarten-Debugger
// @namespace    https://github.com/MarkusP97/Bike24
// @version      ${version}
// @description  Zeigt im Bike24-Checkout, welche Zahlungsarten verschwinden – wann, wie und durch welchen Code – und erstellt einen Bericht für den Support. Sendet keine Daten.
${tlds.map(t => `// @match        https://*.bike24.${t}/*`).join('\n')}
// @run-at       document-start
// @grant        none
// @noframes
// @downloadURL  ${url}
// @updateURL    ${url}
// ==/UserScript==

// AUTOMATISCH ERZEUGT aus bike24-payment-debugger.js – bitte dort ändern und
// "node tools/build-userscript.mjs" ausführen.
window.B24_AUTO = true;   // Tampermonkey-Modus: still, bis auf der Seite Zahlungsarten auftauchen
`;
writeFileSync(join(root, 'bike24-payment-debugger.user.js'), header + src);
console.log(`bike24-payment-debugger.user.js gebaut (v${version})`);
