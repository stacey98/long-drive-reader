// Long Drive Reader v32 (2026-11-14): "words to sounds" in plain JavaScript, for the natural voice (Kokoro).
// Why: on her iPhone (Safari 26.6) the voice model works (v31 test A/B: 7.4 s of speech in 14.1 s), but kokoro-js's
// own words-to-sounds step, espeak-ng compiled to WebAssembly, never finishes (test C stuck > 4 min).
// This file replaces that step: numbers -> words (below), words -> IPA with the "phonemize" package
// (MIT, hans00/phonemize 2.0.1, dictionary + rules, no WebAssembly), then the IPA is rewritten in the style
// Kokoro was given in kokoro-js (espeak-ng en-us style: stress mark right before the vowel, long vowels marked,
// "t" between vowels said as a flap, and so on).
import { phonemize } from "./index.mjs";

// ---------- numbers -> words ----------
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", " thousand", " million", " billion", " trillion"];
function under1000(n) {
  const h = Math.floor(n / 100), r = n % 100, out = [];
  if (h) out.push(ONES[h] + " hundred");
  if (r) out.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? " " + ONES[r % 10] : ""));
  return out.join(" ");
}
export function cardinal(str) {
  str = String(str).replace(/^0+(?=\d)/, "");
  if (str.length > 15) return str.split("").map(d => ONES[+d]).join(" ");
  let n = Number(str);
  if (!n) return "zero";
  const parts = [];
  for (let i = 0; n > 0; i++, n = Math.floor(n / 1000)) {
    const c = n % 1000;
    if (c) parts.unshift(under1000(c) + SCALES[i]);
  }
  return parts.join(" ");
}
const digits = s => s.split("").map(d => ONES[+d]).join(" ");
function decimal(s) {
  const [a, b] = s.split(".");
  return (a ? cardinal(a) : "zero") + (b ? " point " + digits(b) : "");
}
function year(y) {
  const n = +y, hi = Math.floor(n / 100), lo = n % 100;
  if (n >= 2000 && n < 2010) return cardinal(y);                     // two thousand five
  if (lo === 0) return cardinal(String(hi)) + " hundred";            // nineteen hundred
  return cardinal(String(hi)) + " " + (lo < 10 ? "oh " + ONES[lo] : cardinal(String(lo)));
}
const ORD = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
function ordinal(n) {
  const w = cardinal(n), m = /(\w+)$/.exec(w), last = m[1];
  const o = ORD[last] || (last.endsWith("y") ? last.slice(0, -1) + "ieth" : last + "th");
  return w.slice(0, m.index) + o;
}
function plural(w) { return w.endsWith("y") ? w.slice(0, -1) + "ies" : w.endsWith("x") ? w + "es" : w + "s"; }
const CUR = { "$": ["dollar", "cent"], "€": ["euro", "cent"], "£": ["pound", "penny"] };
export function sayNumbers(t) {
  return String(t)
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/([$€£])\s?(\d+(?:\.\d+)?)(\s(?:hundred|thousand|million|billion|trillion))?(?![\d.]*\d)/g, (m, c, n, sc) => {
      const [one, sub] = CUR[c];
      if (sc) return decimal(n) + sc + " " + one + "s";
      const [a, b] = n.split(".");
      let s = cardinal(a) + " " + one + (a === "1" ? "" : "s");
      if (b && b.length === 2 && +b) s += " and " + cardinal(b) + " " + (+b === 1 ? sub : sub === "penny" ? "pence" : sub + "s");
      else if (b) s = decimal(n) + " " + one + "s";
      return s;
    })
    .replace(/(\d+(?:\.\d+)?)\s?%/g, (m, n) => decimal(n) + " percent")
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (m, n) => ordinal(n))
    .replace(/\b(1[1-9]\d\d|20\d\d)(s)?\b(?![.,]\d)/g, (m, y, s) => {
      const w = year(y);
      return s ? plural(w) : w;
    })
    .replace(/\b(\d{1,2}):([0-5]\d)\b/g, (m, h, mm) => cardinal(h) + " " + (mm === "00" ? "o'clock" : mm[0] === "0" ? "oh " + ONES[+mm[1]] : cardinal(mm)))
    .replace(/(\d)\s?[-–]\s?(?=\d)/g, "$1 to ")
    .replace(/\d*\.\d+|\d+/g, m => m.includes(".") ? decimal(m) : cardinal(m));
}

// ---------- IPA (phonemize style) -> Kokoro style ----------
const VOW = /^(aɪ|aʊ|eɪ|oʊ|ɔɪ|[iɪeɛæɑɒɔoʊuʌəɝɚaɐɜᵻy])/;
const CONS = /^(tʃ|dʒ|.)/;
// Short words Kokoro's training text (espeak-ng) left unstressed. Others of one syllable get a stress mark.
const WEAK = new Set(("a an the and or nor but of to in on at for from by with as is are was were be been am it its " +
  "i he she we they you your his her our their them us me my him that than then if so do does did has have had will " +
  "would can could shall should may might must there this these those what which who whom whose when where how up " +
  "out into onto per via its it's i'm i've i'd i'll you're we're they're he's she's that's there's let's").split(" "));
function word(ipa, w) {
  ipa = ipa.replace(/ɫ/g, "l").replace(/r/g, "ɹ").replace(/g/g, "ɡ").replace(/ː/g, "").replace(/[ʰ̩̃]/g, "");
  const u = []; let pend = 0;
  for (let i = 0; i < ipa.length;) {
    const ch = ipa[i];
    if (ch === "ˈ") { pend = 1; i++; continue; }
    if (ch === "ˌ") { pend = pend || 2; i++; continue; }
    let m = VOW.exec(ipa.slice(i));
    if (m) { u.push({ p: m[1], v: true, s: pend }); pend = 0; i += m[1].length; continue; }
    m = CONS.exec(ipa.slice(i)); u.push({ p: m[1], v: false }); i += m[1].length;
  }
  // "-ɚ" / "-ɝ" before a vowel keeps its r ("worried", "coverage"); a final "-y" is never stressed ("company").
  for (let k = 0; k < u.length - 1; k++) if ((u[k].p === "ɝ" || u[k].p === "ɚ") && u[k + 1].v) u.splice(k + 1, 0, { p: "ɹ", v: false });
  const vs = u.filter(x => x.v), lastV = vs[vs.length - 1];
  if (lastV && lastV.p === "i" && lastV.s === 2 && u.slice(u.indexOf(lastV) + 1).every(x => /^[zsd]$/.test(x.p))) lastV.s = 0;
  if (vs.length && !vs.some(x => x.s) && !WEAK.has(String(w).toLowerCase())) {
    (vs.find(x => x.p !== "ə") || vs[0]).s = 1;
  }
  let out = "";
  for (let k = 0; k < u.length; k++) {
    const x = u[k], nx = u[k + 1], pv = u[k - 1];
    if (x.v) {
      let p = x.p;
      if (p === "ɑ") p = "ɑː";
      else if (p === "ɔ") p = nx && nx.p === "ɹ" ? "oː" : "ɔː";
      else if (p === "ɝ" || p === "ɜ") p = x.s ? "ɜː" : "ɚ";
      else if (p === "i") p = x.s ? "iː" : "i";
      else if (p === "u") p = x.s ? "uː" : "u";
      else if (p === "ʌ" && !x.s) p = "ə";
      out += (x.s === 1 ? "ˈ" : x.s === 2 ? "ˌ" : "") + p;
    } else {
      let p = x.p;
      // American flap: t/d after a vowel (or r) and before an unstressed vowel, inside the word ("water", "city").
      if ((p === "t" || p === "d") && k > 0 && pv && (pv.v || pv.p === "ɹ") && nx && nx.v && !nx.s &&
          !(nx.p === "ə" && u[k + 2] && u[k + 2].p === "n" && !u[k + 3])) p = "ɾ";
      out += p;
    }
  }
  return out;
}
// Words the dictionary says oddly for American English (checked against espeak-ng output, 2026-11-14).
const FIX = { dollars: "dˈɑːlɚz", dollar: "dˈɑːlɚ", nineteen: "nˈaɪntiːn", new: "nˈuː", news: "nˈuːz", next: "nˈɛkst",
  their: "ðɛɹ", there: "ðɛɹ", theirs: "ðˈɛɹz", during: "dˈʊɹɪŋ", thirty: "θˈɜːɾi", thirteen: "θɜːtˈiːn" };
const PUNCT = /^([^\p{L}\p{N}'’]*)(.*?)([^\p{L}\p{N}'’]*)$/u;
export function toKokoro(text) {
  const said = sayNumbers(text).replace(/(\p{L})[-–](?=\p{L})/gu, "$1 ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ").trim();
  if (!said) return "";
  const words = said.split(" "), ipas = String(phonemize(said)).split(" ");
  // phonemize keeps one output word per input word in normal text; if the counts differ, go word by word.
  const pairs = ipas.length === words.length ? words.map((w, i) => [w, ipas[i]]) : words.map(w => [w, String(phonemize(w))]);
  const out = pairs.map(([w, ip]) => {
    const a = PUNCT.exec(ip), b = PUNCT.exec(w);
    const lw = b[2].toLowerCase(), core = !a[2] ? "" : FIX[lw] || word(a[2], b[2]);
    return (a[1] + core + a[3]).replace(/[^\p{L}\p{M}ˈˌːɾ;:,.!?¡¿—…"«»() ]/gu, "");
  }).filter(Boolean).join(" ");
  return out.replace(/(^| )ðə (?=[ˈˌ]?[iɪeɛæɑɒɔoʊuʌəɝɚaɐ])/g, "$1ðɪ ").replace(/(?<=nˈaɪn)ti(?!ː)/g, "di").replace(/ z(?=[;:,.!?¡¿—…"«»"" ]|$)/g, "z").trim();
}
