const CACHE_NAME = 'novel-reader-v2';
const DATA_CACHE_NAME = 'novel-offline-cache-v2';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './app-manifest.json',
    './icon.svg',
    'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
    'https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js',
    'https://fonts.googleapis.com/css2?family=Alegreya:wght@400;500;700&family=Atkinson+Hyperlegible:wght@400;700&family=Noto+Sans+Myanmar:wght@400;500;700&family=Noto+Serif+Myanmar:wght@400;500;700&family=Outfit:wght@400;500;600;700&family=Padauk:wght@400;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME && key !== DATA_CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const cacheName = isMarkdownRequest(request) ? DATA_CACHE_NAME : CACHE_NAME;
    const cache = await caches.open(cacheName);

    try {
        const networkResponse = await fetch(request);
        if (networkResponse && networkResponse.ok) {
            await cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }

        if (cacheName !== CACHE_NAME) {
            const fallback = await caches.match(request);
            if (fallback) {
                return fallback;
            }
        }

        throw error;
    }
}

function isMarkdownRequest(request) {
    try {
        return new URL(request.url).pathname.toLowerCase().endsWith('.md');
    } catch (_error) {
        return false;
    }
}
