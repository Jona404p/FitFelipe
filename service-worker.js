const CACHE_NAME = 'fitfelipe-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Instalar el service worker y cachear archivos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[ServiceWorker] Cachendo archivos');
        return cache.addAll(urlsToCache).catch(err => {
          console.log('[ServiceWorker] Error al cachear:', err);
          // No falla si hay error, continúa sin cacheo
        });
      })
  );
  self.skipWaiting();
});

// Activar el service worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Eliminando cache antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Estrategia: Network first, fallback to cache
self.addEventListener('fetch', event => {
  const { request } = event;
  
  // Solo cachear requests GET
  if (request.method !== 'GET') {
    return;
  }

  // Always check for a newer HTML shell so theme and UI fixes reach installed apps.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseToCache));
          return response;
        })
        .catch(() => caches.match(request).then(response => response || caches.match('/index.html')))
    );
    return;
  }

  // Para APIs (http://localhost:3000/api/*), usar network-first
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // No cachear respuestas de API
          return response;
        })
        .catch(err => {
          console.log('[ServiceWorker] Error en API, offline:', err);
          // Si falla, retornar una respuesta genérica
          return new Response(
            JSON.stringify({ message: 'Sin conexión a internet' }),
            { 
              status: 503, 
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }

  // Para otros recursos, usar cache-first
  event.respondWith(
    caches.match(request)
      .then(response => {
        if (response) {
          return response;
        }
        
        return fetch(request)
          .then(response => {
            // No cachear si no es una respuesta válida
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }
            
            // Cachear la respuesta
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
            });
            
            return response;
          })
          .catch(err => {
            console.log('[ServiceWorker] Fetch failed:', err);
            return new Response('Offline - recurso no disponible', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// Mensaje de cliente a service worker para actualización
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
