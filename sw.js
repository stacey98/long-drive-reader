// Long Drive Reader · offline copy (service worker), v28.
// Used only by the website copy of the app (a normal top-level page). The page never registers it inside
// claude.ai's frame. Change VERSION with every app version: the page then shows "Update ready — tap to reload".
//
// What is kept, and how:
//  - The page (index.html), its manifest and icon: network first (a new version arrives at the next visit),
//    the kept copy when there is no signal. Cache "ldr-page-v<VERSION>", replaced with each version.
//  - Files that never change, once fetched: text recognition data (tess/), the voice runtime (kokoro/ort.part*,
//    the .mjs, config and tokenizer files) and the pinned CDN scripts (pdf.js, Tesseract, kokoro-js, JSZip,
//    mammoth) and the reading font. Cache first. Cache "ldr-files-1", kept across versions.
//  - NOT kept here: the natural voice's model (kokoro/model.part*.wasm, 84 MB) and its voices (kokoro/voices/).
//    transformers.js already keeps the model in its own browser cache ("transformers-cache") and kokoro-js keeps
//    every voice it has used in "kokoro-voices"; keeping them here too would store them twice.
//  - Never touched: test files (test/), this file, other websites.
"use strict";
const VERSION = "29";
const PAGE = "ldr-page-v" + VERSION;
const FILES = "ldr-files-1";
const SHELL = ["./", "manifest.webmanifest", "icon/long-drive-reader-icon.png"];
const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/",
  "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/",
  "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/",
  "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/",
  "https://fonts.gstatic.com/"
];
const FONT_CSS = "https://fonts.googleapis.com/css2";
const SKIP = /^kokoro\/model\.part\d+\.wasm$|^kokoro\/voices\/|^test\/|^sw\.js$/;

const scopeUrl = () => self.registration.scope;
// The path inside the app's folder, or null for anything outside it.
function appPath(url) {
  const scope = new URL(scopeUrl());
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  try { return decodeURIComponent(url.pathname.slice(scope.pathname.length)); } catch (err) { return null; }
}
const isPage = path => path === "" || path === "index.html";
function allowed(u) {
  let url;
  try { url = new URL(u, scopeUrl()); } catch (e) { return false; }
  if (CDN.some(p => url.href.startsWith(p))) return true;
  const path = appPath(url);
  return path !== null && !SKIP.test(path) && !isPage(path);
}

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(PAGE);
    await Promise.all(SHELL.map(u => cache.add(new Request(u, { cache: "no-cache" })).catch(() => {})));
  })());
  // No skipWaiting() here: a new version waits until the page asks for it ("Update ready — tap to reload").
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("ldr-page-") && k !== PAGE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  const d = e.data || {};
  if (d.cmd === "skipWaiting") self.skipWaiting();
  else if (d.cmd === "warm" && Array.isArray(d.urls)) e.waitUntil(warm(d.urls));
});

// Keep files the page names (fetched inside background threads, which may not pass through here).
async function warm(urls) {
  const cache = await caches.open(FILES);
  for (const u of urls.slice(0, 40)) {
    if (typeof u !== "string" || !allowed(u)) continue;
    try {
      if (await cache.match(u)) continue;
      const res = await fetch(u, { mode: "cors", credentials: "omit" });
      if (res.ok) await cache.put(u, res);
    } catch (err) { /* no signal or refused: try again another time */ }
  }
}

async function networkFirst(req, name, key) {
  const cache = await caches.open(name);
  try {
    let res = await fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" }));
    // A redirected answer can't be handed to a page load as it is; pass on a plain copy.
    if (res && res.redirected) res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
    if (res && res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = (await cache.match(key)) || (await cache.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, name, cors) {
  const cache = await caches.open(name);
  const hit = await cache.match(req.url);
  // (A kept "opaque" answer can only stand in for a request that accepts one.)
  if (hit && !(hit.type === "opaque" && req.mode !== "no-cors")) return hit;
  let res = null;
  if (cors) { try { res = await fetch(req.url, { mode: "cors", credentials: "omit" }); } catch (err) { res = null; } }
  if (!res) res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req.url, res.clone()).catch(() => {});
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  if (req.mode !== "navigate" && req.cache === "no-store") return; // (the #check page measures the network itself)
  const path = appPath(url);
  if (path !== null) {
    if (SKIP.test(path)) return;
    if (isPage(path)) { e.respondWith(networkFirst(req, PAGE, scopeUrl())); return; }
    if (req.mode === "navigate") return; // another page in the folder: leave it alone
    if (path === "manifest.webmanifest" || path.startsWith("icon/")) { e.respondWith(networkFirst(req, PAGE, url.origin + url.pathname)); return; }
    e.respondWith(cacheFirst(req, FILES, false));
    return;
  }
  if (req.url.startsWith(FONT_CSS)) { e.respondWith(networkFirst(req, FILES, req.url)); return; }
  if (CDN.some(p => req.url.startsWith(p))) e.respondWith(cacheFirst(req, FILES, true));
});
