/* eslint-disable no-restricted-globals */
"use strict";

const SW_VERSION = "reader-offline-v14";
const SHELL_CACHE = `${SW_VERSION}-shell`;
const CONTENT_CACHE = `${SW_VERSION}-content`;

const CORE_SHELL_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./app-manifest.json",
  "./vendor/marked.min.js",
  "./vendor/purify.min.js",
  "./icons/icon.svg",
  "./icons/favicon.svg",
  "./icons/maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cacheCoreShell(cache, CORE_SHELL_URLS);
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, CONTENT_CACHE]);
      const names = await caches.keys();

      await Promise.all(
        names.map((name) => {
          if (!keep.has(name)) {
            return caches.delete(name);
          }
          return Promise.resolve(false);
        }),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!request || request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, "./index.html"));
    return;
  }

  const pathname = url.pathname.toLowerCase();

  if (isMarkdownPath(pathname)) {
    event.respondWith(staleWhileRevalidate(request, CONTENT_CACHE));
    return;
  }

  if (isReaderShellAssetPath(pathname)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (isStaticMediaPath(pathname)) {
    event.respondWith(staleWhileRevalidate(request, CONTENT_CACHE));
  }
});

self.addEventListener("message", (event) => {
  const payload =
    event && event.data && typeof event.data === "object" ? event.data : null;

  if (!payload || typeof payload.type !== "string") {
    return;
  }

  if (payload.type === "CACHE_URLS" && Array.isArray(payload.urls)) {
    event.waitUntil(cacheUrls(payload.urls));
    return;
  }

  if (payload.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isMarkdownPath(pathname) {
  return pathname.endsWith(".md");
}

function isReaderShellAssetPath(pathname) {
  if (pathname.endsWith("/reader") || pathname.endsWith("/reader/")) {
    return true;
  }

  const file = pathname.split("/").pop() || "";
  return (
    file === "index.html" ||
    file === "styles.css" ||
    file === "app.js" ||
    file === "manifest.json" ||
    file === "app-manifest.json" ||
    file === "sw.js"
  );
}

function isStaticMediaPath(pathname) {
  return (
    pathname.endsWith(".json") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".gif") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".svg")
  );
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);

  try {
    const networkRequest = new Request(request, { cache: "no-store" });
    const networkResponse = await fetch(networkRequest);
    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }

    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    return networkResponse;
  } catch (_error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }

    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) {
        return fallback;
      }
    }

    throw _error;
  }
}

async function cacheCoreShell(cache, urls) {
  const base = self.registration.scope || self.location.href;
  for (const url of urls) {
    const absolute = new URL(url, base).href;
    const req = new Request(absolute, { cache: "reload" });
    const res = await fetch(req);
    if (!res || !res.ok) {
      throw new Error(`Failed to cache shell asset: ${url}`);
    }
    await cache.put(req, res.clone());
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkFetch.catch(() => null);
    return cached;
  }

  const networkResponse = await networkFetch;
  if (networkResponse) {
    return networkResponse;
  }

  return new Response("Offline and content not cached yet.", {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function cacheUrls(rawUrls) {
  const cache = await caches.open(CONTENT_CACHE);
  const urls = normalizeUrls(rawUrls);
  const total = urls.length;
  const cachedUrls = [];
  let done = 0;
  let failed = 0;

  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response && response.ok) {
        await cache.put(url, response.clone());
        cachedUrls.push(url);
      } else {
        failed += 1;
      }
    } catch (_error) {
      failed += 1;
    }

    done += 1;
    await broadcast({
      type: "OFFLINE_PROGRESS",
      done,
      total,
    });
  }

  await broadcast({
    type: "OFFLINE_COMPLETE",
    cached: Math.max(0, done - failed),
    cachedUrls,
    failed,
    total,
  });
}

function normalizeUrls(rawUrls) {
  const unique = new Set();

  for (const rawUrl of rawUrls) {
    if (typeof rawUrl !== "string") {
      continue;
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const absolute = new URL(trimmed, self.location.href);
      if (absolute.origin !== self.location.origin) {
        continue;
      }
      unique.add(absolute.href);
    } catch (_error) {
      // Ignore invalid URLs.
    }
  }

  return [...unique];
}

async function broadcast(payload) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of clients) {
    client.postMessage(payload);
  }
}
