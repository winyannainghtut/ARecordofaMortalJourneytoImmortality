const CACHE_NAME = 'novel-reader-v1';
const DATA_CACHE_NAME = 'novel-offline-cache-v1';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './app-manifest.json',
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
    // Try network first, then cache (for both html, asset and markdown)
    // We want user to get the latest markdown if possible
    // If no network, fallback to cache

    const isMDFile = event.request.url.endsWith('.md');

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                // Cache the dynamically fetched items if needed
                return networkResponse;
            }).catch((e) => {
                // Fallback happens here
                if (cachedResponse) {
                    return cachedResponse;
                }
                throw e;
            });

            return cachedResponse || fetchPromise;
        })
    );
});
