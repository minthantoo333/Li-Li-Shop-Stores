
const CACHE_NAME = 'lili-inventory-tracker-v4'; // Increment version for force update

// အင်တာနက်မရှိချိန် ဖွင့်နိုင်ရန် မှတ်ထားရမည့် ဖိုင်များစာရင်း
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './firebase.js',
  './logo.png',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png',
  './icon-180x180.png',
  // Firebase SDK ဖိုင်များကိုပါ ထည့်သွင်းထားပါသည်
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js'
];

// 1. App ကို ဖွင့်လိုက်တာနဲ့ ဖိုင်တွေကို ဖုန်း/Browser ထဲမှာ ဒေါင်းလုဒ်ဆွဲပြီး မှတ်ထားခြင်း (Install)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching static assets');
        return cache.addAll(urlsToCache);
      })
  );
  // Service Worker အသစ်ကို ချက်ချင်း အလုပ်လုပ်ခိုင်းခြင်း
  self.skipWaiting();
});

// 2. Cache အဟောင်းတွေ (ဥပမာ v3 ကနေ v4 ပြောင်းရင်) ရှိနေခဲ့ရင် ရှင်းလင်းခြင်း (Activate)
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Clients များကို Service worker အသစ်က ချက်ချင်း ထိန်းချုပ်ခြင်း
  self.clients.claim();
});

// 3. အင်တာနက်ပိတ်ထားချိန်မှာ App က ဖိုင်တွေကို လှမ်းတောင်းရင် Cache ထဲက ပြန်ထုတ်ပေးခြင်း (Fetch)
self.addEventListener('fetch', event => {
  
  // မှတ်ချက် - Firebase Database နဲ့ Authentication Request တွေကို Cache လုပ်စရာမလိုပါ 
  // (Firestore က သူ့ဘာသာ Offline စနစ် ပါပြီးသားဖြစ်ပါတယ်)
  if (event.request.url.includes('firestore.googleapis.com') || 
      event.request.url.includes('identitytoolkit.googleapis.com') ||
      event.request.url.includes('securetoken.googleapis.com')) {
    return; // Firebase API call များကို Network ကနေပဲ သွားခိုင်းရန်
  }

  // ကျန်တဲ့ HTML, CSS, JS တွေကိုတော့ အင်တာနက်မရှိရင် Cache ထဲကနေ ပြန်ပေးမယ်
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache ထဲမှာ ရှိရင် အဲ့ဒါကိုပဲ ပြန်ပေးမယ် (Offline အလုပ်လုပ်ပြီ)
        if (response) {
          return response;
        }

        // Cache ထဲမှာ မရှိရင် အင်တာနက်ကနေ ဆွဲမယ်
        return fetch(event.request).then(
          function(response) {
            // လာတဲ့ Response က အဆင်မပြေရင် ဒီတိုင်း ပြန်ပို့မယ်
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // မှန်ကန်ရင် နောက်တစ်ခါ အင်တာနက်မရှိချိန်သုံးဖို့ Cache ထဲမှာ မှတ်ထားလိုက်မယ်
            let responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      }).catch(() => {
        // Offline ဖြစ်နေပြီး ဘာ Cache မှ မရှိရင် index.html ကို ပြန်ပြဖို့
        if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
        }
      })
  );
});
