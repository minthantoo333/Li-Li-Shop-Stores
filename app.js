function debounce(func, delay = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// --- GLOBAL VARIABLES ---
const appDb = firebase.firestore(); 

let appData = {
  mainStoreItems: [], homeStoreItems: [], shopStoreItems: [],
  addHistory: [], itemOutHistory: [], salesHistory: []
};

let lastSearch = { mainStoreItems: '', homeStoreItems: '', shopStoreItems: '', combinedStoreItems: '' };
let HISTORY_LIMIT = 10;
let globalSalePricePercentage = 50; 
let priceRoundingEnabled = false;

let groundCheckMode = { mainStoreItems: false, homeStoreItems: false, shopStoreItems: false };
let verifiedItems = { mainStoreItems: new Set(), homeStoreItems: new Set(), shopStoreItems: new Set() };
let newItems = new Set();
let filterStates = {
  mainStoreItems: { lowStock: false, unverified: false, category: {} },
  homeStoreItems: { lowStock: false, unverified: false, category: {} },
  shopStoreItems: { lowStock: false, unverified: false, category: {} },
  combinedStoreItems: { lowStock: false, unverified: false, category: {} }
};

let currentHistoryId = null;
const LOW_STOCK_THRESHOLD = 5;
const VALID_CATEGORIES = ['အင်္ကျီ', 'ဘောင်းဘီ', 'ဝမ်းဆက်', 'အခြား'];
const ITEMS_PER_PAGE = 10;
let currentPage = {};

let currentEditItem = null;
let currentEditStoreKey = null;
let currentEditTabId = null;

// --- RE-AUTHENTICATION FUNCTION ---
let lastAdminAuthTime = 0; 

let pendingSyncCount = 0;

function updateSyncBadge() {
    const badge = document.getElementById('unsynced-badge');
    if (badge) {
        if (pendingSyncCount > 0) {
            badge.textContent = pendingSyncCount;
            badge.style.display = 'flex'; // Badge ကို ပေါ်စေမည်
        } else {
            badge.style.display = 'none'; // 0 ဖြစ်သွားလျှင် ပြန်ဖျောက်မည်
        }
    }
}

const originalBatch = appDb.batch.bind(appDb);
appDb.batch = function() {
    const b = originalBatch();
    const originalCommit = b.commit.bind(b);
    b.commit = function() {
        const promise = originalCommit();
        
        pendingSyncCount++;
        updateSyncBadge();
        
       
        promise.then(() => {
            pendingSyncCount--;
            updateSyncBadge();
        }).catch(() => {
            pendingSyncCount--;
            updateSyncBadge();
        });
        
        return promise;
    };
    return b;
};


function promptPassword(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;';
        
        const box = document.createElement('div');
        box.style.cssText = 'background:white;padding:25px;border-radius:8px;width:320px;max-width:90%;box-shadow:0 4px 15px rgba(0,0,0,0.2); font-family:sans-serif;';
        
        const title = document.createElement('h3');
        title.textContent = '🔒 လုံခြုံရေး အတည်ပြုရန်';
        title.style.cssText = 'margin-top:0; color:#2c3e50; font-size:18px; margin-bottom:10px;';
        
        const msgEl = document.createElement('p');
        msgEl.textContent = message;
        msgEl.style.cssText = 'margin-bottom:15px; color:#7f8c8d; font-size:14px; line-height:1.5;';
        
        const input = document.createElement('input');
        input.type = 'password'; 
        input.placeholder = 'Enter password...';
        input.style.cssText = 'width:100%;padding:10px;margin-bottom:20px;border:1px solid #bdc3c7;border-radius:5px;box-sizing:border-box;font-size:16px;';
        
        const btnContainer = document.createElement('div');
        btnContainer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:10px 15px;border:none;background:#ecf0f1;color:#7f8c8d;border-radius:5px;cursor:pointer;font-weight:bold;';
        cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };
        
        const okBtn = document.createElement('button');
        okBtn.textContent = 'အတည်ပြုမည်';
        okBtn.style.cssText = 'padding:10px 15px;border:none;background:#2980b9;color:white;border-radius:5px;cursor:pointer;font-weight:bold;';
        okBtn.onclick = () => { document.body.removeChild(overlay); resolve(input.value); };
        
        input.addEventListener('keypress', (e) => { if(e.key === 'Enter') okBtn.click(); });
        
        btnContainer.appendChild(cancelBtn);
        btnContainer.appendChild(okBtn);
        
        box.appendChild(title);
        box.appendChild(msgEl);
        box.appendChild(input);
        box.appendChild(btnContainer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        
        input.focus();
    });
}

// --- RE-AUTHENTICATION FUNCTION (🌟 UPDATED FOR SUPERADMIN PASSWORD PROMPT 🌟) ---
async function verifyAdminPassword(actionCallback, requireImmediateAuth = false) {
    if (window.currentUserRole === 'user') {
        showNotification("ဤလုပ်ဆောင်ချက်ကို အသုံးပြုခွင့် မရှိပါ။", "error");
        return;
    }

    const user = firebase.auth().currentUser;
    if (!user) {
        showNotification("Please log in first.", "error");
        return;
    }

    // 🌟 ပစ္စည်းဖျက်မည်ဆိုပါက (requireImmediateAuth = true) Superadmin ဖြစ်စေ၊ Admin ဖြစ်စေ Password မဖြစ်မနေ တောင်းမည် 🌟
    if (!requireImmediateAuth) {
        if (window.currentUserRole === 'superadmin') {
            actionCallback(); 
            return;
        }
        const now = Date.now();
        if (now - lastAdminAuthTime < 15 * 60 * 1000) {
            actionCallback(); 
            return;
        }
    }

    let promptMsg = window.currentUserRole === 'superadmin' ? "🔒 Superadmin အတည်ပြုရန် Password ရိုက်ထည့်ပါ" : "သင့်အကောင့်၏ Password ကို ရိုက်ထည့်ပါ။";
    const password = await promptPassword(promptMsg);
    if (!password) return; 

    try {
        const credential = firebase.auth.EmailAuthProvider.credential(user.email, password);
        await user.reauthenticateWithCredential(credential);
        
        lastAdminAuthTime = Date.now();
        actionCallback();
    } catch (error) {
        console.error("Re-auth error:", error);
        alert("❌ Password မှားယွင်းနေပါသည်။ (Incorrect Password)");
    }
}

// --- STAFF ACCOUNTS VIEWER (🌟 NEW 🌟) ---
async function loadStaffAccounts() {
    try {
        const usersSnapshot = await appDb.collection('users').get();
        const ul = document.getElementById('staff-list-ul');
        if (!ul) return;
        ul.innerHTML = '';
        
        usersSnapshot.forEach(doc => {
            const data = doc.data();
            const li = document.createElement('li');
            const borderColor = data.role === 'superadmin' ? '#e74c3c' : (data.role === 'admin' ? '#f39c12' : '#2ecc71');
            li.style.cssText = `padding: 10px; background: #f9f9f9; margin-bottom: 5px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid ${borderColor};`;
            li.innerHTML = `
                <span style="font-weight: bold; color: #2c3e50;">${doc.id}</span> 
                <span style="background: #eee; padding: 2px 8px; border-radius: 10px; font-size: 11px; color: #555;">${data.role.toUpperCase()}</span>
            `;
            ul.appendChild(li);
        });
    } catch (error) {
        console.error("Error loading staff accounts:", error);
    }
}


// --- ဝန်ထမ်းအကောင့်သစ် ဖန်တီးခြင်း ---
async function createStaffAccount(event) {
    event.preventDefault();
    if (window.currentUserRole !== 'superadmin') {
        showNotification("Superadmin တစ်ဦးတည်းသာ အကောင့်ဖန်တီးခွင့်ရှိပါသည်။", "error");
        return;
    }

    const email = document.getElementById('new-staff-email').value;
    const password = document.getElementById('new-staff-password').value;
    const role = document.getElementById('new-staff-role').value; 
    
    showProgress('အကောင့်အသစ် ဖန်တီးနေပါသည်...');
    try {
        const secondaryApp = firebase.initializeApp(firebaseConfig, "SecondaryApp");
        await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
        
        await appDb.collection('users').doc(email).set({ role: role });

        await secondaryApp.auth().signOut();
        await secondaryApp.delete();
        
        showNotification(`ဝန်ထမ်းအကောင့် (${email} - ${role}) ကို အောင်မြင်စွာ ဖန်တီးပြီးပါပြီ။`, 'success');
        document.getElementById('create-staff-form').reset();
        
    } catch (error) {
        console.error("Create Account Error:", error);
        showNotification('အကောင့်ဖန်တီးရာတွင် အမှားအယွင်းဖြစ်နေပါသည်: ' + error.message, 'error');
    } finally {
        hideProgress();
    }
}

function showSyncStatus(status) {
    const syncEl = document.getElementById('sync-status');
    if (!syncEl) return;
    syncEl.style.display = 'inline-block';
    
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    
    let userEmail = 'Unknown';
    if (firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.email) {
        userEmail = firebase.auth().currentUser.email.split('@')[0];
    }

    if (status === 'syncing') {
        syncEl.innerHTML = `☁️ ${userEmail} syncing...`;
        syncEl.style.color = '#f39c12'; 
    } else if (status === 'synced') {
        const msg = `✅ ${userEmail} updated at ${timeString}`;
        syncEl.innerHTML = msg;
        syncEl.style.color = '#27ae60'; 
        localStorage.setItem(`lastSyncMessage_${userEmail}`, msg);
        localStorage.setItem('lastLoggedInUserForSync', userEmail);
    } else if (status === 'pending') {
        syncEl.innerHTML = `⏳ Pending Sync (Offline)`;
        syncEl.style.color = '#e74c3c'; 
    }
}


function loadLastSyncStatus() {
    const syncEl = document.getElementById('sync-status');
    if (!syncEl) return;

    let userEmail = '';
    if (firebase.auth && firebase.auth().currentUser && firebase.auth().currentUser.email) {
        userEmail = firebase.auth().currentUser.email.split('@')[0];
    }

    if (userEmail) {
        const lastMsg = localStorage.getItem(`lastSyncMessage_${userEmail}`);
        if (lastMsg) {
            syncEl.innerHTML = lastMsg;
            syncEl.style.color = '#27ae60';
            syncEl.style.display = 'inline-block';
            return;
        }
    }
    
    syncEl.style.display = 'none'; 
}


// --- IN-MEMORY DATA UPDATES ---

function updateSingleItemLocal(storeName, item) {
    const index = appData[storeName].findIndex(i => i.id === item.id);
    if (index !== -1) appData[storeName][index] = item;
    else appData[storeName].push(item);
}

function deleteSingleItemLocal(storeName, id) {
    appData[storeName] = appData[storeName].filter(i => i.id !== id);
}


// --- FIREBASE SYNC INITIALIZATION ---
let syncListeners = {};

// Read ပမာဏကို မှတ်ထားမည့် Global Variable (openDB အပေါ်မှာထားပါ)
let estimatedReadCount = 0; 

// Read Counter UI ကို ပြောင်းလဲပေးမည့် Function အသစ်
function updateReadCounterUI() {
    const display = document.getElementById('read-counter-display');
    if (display) {
        display.textContent = `Reads: ${estimatedReadCount}`;
    }
}


async function openDB() {
    showProgress('စနစ်စတင်နေပါသည် (Cloud Sync)...');
    try {
        const inventoryCollections = ['mainStoreItems', 'homeStoreItems', 'shopStoreItems'];
        const historyCollections = ['addHistory', 'itemOutHistory', 'salesHistory'];
        
        // --- ၁။ INVENTORY ကို အပြည့်အဝ အမြဲတမ်း Sync လုပ်မည် (လက်ကျန်ဖြစ်၍ အမြဲမှန်ရန် လိုသည်) ---
        inventoryCollections.forEach(col => {
            appData[col] = []; 
            if (syncListeners[col]) syncListeners[col](); 
            
            syncListeners[col] = appDb.collection(col).onSnapshot(snapshot => {
                let currentChanges = 0;
                snapshot.docChanges().forEach(change => { if (change.type === "added" || change.type === "modified") currentChanges++; });
                estimatedReadCount += currentChanges;
updateReadCounterUI(); 
                console.log(`[Read Counter] ${col} (Inventory) - Data ${currentChanges} ခု ဆွဲယူပါသည်။ (Total Read: ${estimatedReadCount})`);

                appData[col] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                refreshCurrentView();
            }, error => {
                console.error(`Sync error on ${col}:`, error);
            });
        });

        // --- ၂။ HISTORY ကို OFFLINE CACHE မှ အရင်ဆွဲထုတ်မည် (Read မစားပါ) ---
        for (const col of historyCollections) {
            appData[col] = [];
            try {
                const cacheSnapshot = await appDb.collection(col).get({ source: 'cache' });
                appData[col] = cacheSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                console.log(`[Cache] ${col} အတွက် Local မှ Data ${appData[col].length} ခု ရရှိပါသည်။`);
            } catch (e) {
                console.log(`Cache empty for ${col}`);
            }
        }
        refreshCurrentView(); // Cache ထဲက Data ဖြင့် UI ကို ချက်ချင်းပေါ်စေမည်

        // --- ၃။ FULL SYNC တစ်ခါမှ မလုပ်ရသေးပါက SERVER မှ အကုန်တစ်ခါ ဆွဲချမည် (Read စားမည်) ---
        const hasFullSync = localStorage.getItem('hasFullHistorySync');
        if (!hasFullSync) {
            console.log("ပထမဆုံးအကြိမ် History Data အားလုံးကို ဆွဲချနေပါသည်...");
            for (const col of historyCollections) {
                const serverSnapshot = await appDb.collection(col).get({ source: 'server' });
                const serverData = serverSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                
                // RAM ထဲသို့ ဆွဲချလိုက်သော Data များ ထည့်မည်
                appData[col] = serverData;
                
                estimatedReadCount += appData[col].length;
                console.log(`[Read Counter] ${col} မှ Full Data ${appData[col].length} ခု ဆွဲယူပါသည်။`);
            }
            localStorage.setItem('hasFullHistorySync', 'true'); 
            refreshCurrentView();
        }

        // --- ၄။ ၇ ရက်အတွင်း အသစ်ဝင်လာသော/ပြင်ထားသော HISTORY များကိုသာ REAL-TIME နားထောင်မည် ---
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const recentDateStr = sevenDaysAgo.toISOString();

        historyCollections.forEach(col => {
            if (syncListeners[col]) syncListeners[col](); 
            
            // lastUpdatedAt ကို အသုံးပြု၍ ၇ ရက်အတွင်း ပြင်ထား/သွင်းထားသည်များကိုသာ စစ်မည်
            let recentQuery = appDb.collection(col).where('lastUpdatedAt', '>=', recentDateStr);
            
            syncListeners[col] = recentQuery.onSnapshot(snapshot => {
                let currentChanges = 0;
                let needsRefresh = false;

                snapshot.docChanges().forEach(change => {
                    const data = { id: change.doc.id, ...change.doc.data() };
                    
                    if (change.type === "added" || change.type === "modified") {
                        currentChanges++;
                        needsRefresh = true;
                        // RAM ထဲက Data ကို အသစ်ဝင်လာတာနဲ့ အစားထိုးမည် (သို့) ပေါင်းထည့်မည်
                        const index = appData[col].findIndex(item => item.id === data.id);
                        if (index !== -1) {
                            appData[col][index] = data; 
                        } else {
                            appData[col].push(data); 
                        }
                    } else if (change.type === "removed") {
                        needsRefresh = true;
                        appData[col] = appData[col].filter(item => item.id !== data.id);
                    }
                });
                
                if (currentChanges > 0) {
                    estimatedReadCount += currentChanges;
                    console.log(`[Read Counter] ${col} (Recent) - အသစ်/ပြင်ဆင်မှု ${currentChanges} ခု ဝင်လာပါသည်။ (Total Read: ${estimatedReadCount})`);
                }
                if (needsRefresh) refreshCurrentView();
            });
        });

    } catch (e) {
        console.error("Initialization failed:", e);
        showNotification('Database စတင်ရာတွင် အမှားဖြစ်နေပါသည်။', 'error');
    } finally {
        hideProgress();
    }
}



function refreshCurrentView() {
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab) return;
  const tabId = activeTab.id;

  if (tabId === 'items-in-out') {
      loadAddHistory();
      loadItemOutHistory();
  } else if (tabId === 'pos-system') {
      if (typeof loadPosProducts === 'function') loadPosProducts();
      if(document.getElementById('pos-history').classList.contains('active') && typeof loadSalesHistory === 'function') loadSalesHistory();
  } else if (tabId === 'report') {
      if (typeof loadReports === 'function') loadReports();
  } else if (tabId.includes('-store')) {
      const storeKey = tabId === 'combined-store' ? 'combinedStoreItems' : tabId.replace('-store', 'StoreItems');
      loadItemsTable(storeKey, tabId);
  }
}

function getData(storeName) {
  return Promise.resolve(JSON.parse(JSON.stringify(appData[storeName] || [])));
}

function showProgress(message) {
  const progressContainer = document.getElementById('progress-container');
  progressContainer.style.display = 'block';
  progressContainer.querySelector('#progress-message').textContent = message;
}

function hideProgress() {
  document.getElementById('progress-container').style.display = 'none';
}

function migrateItemShopMarkers(item) {
  const clonedItem = { ...item };
  if (clonedItem && !clonedItem.shopMarkers && clonedItem.shopMarker) {
    clonedItem.shopMarkers = [clonedItem.shopMarker];
    delete clonedItem.shopMarker; 
  } else if (!clonedItem.shopMarkers) {
    clonedItem.shopMarkers = [];
  }
  return clonedItem;
}

function decodeDateFromMarker(markerString) {
  if (!markerString || typeof markerString !== 'string') return 0;
  const parts = markerString.trim().toUpperCase().split('-');
  if (parts.length !== 2) return 0;
  
  const dateCode = parts[1];
  const monthMatch = dateCode.match(/^\d{1,2}/);
  // A-E အစား A-J အထိ ပြောင်းလိုက်ပါသည် (1 မှ 9 နှင့် 0 အတွက်)
  const yearMatch = dateCode.match(/[A-J]{2}$/); 
  
  if (!monthMatch || !yearMatch) return 0;
  const month = parseInt(monthMatch[0], 10);
  if (month < 1 || month > 12) return 0;
  
  const yearLetters = yearMatch[0];
  
  const yearCipher = { 'A': '1', 'B': '2', 'C': '3', 'D': '4', 'E': '5', 'F': '6', 'G': '7', 'H': '8', 'I': '9', 'J': '0' };
  const yearStr = '20' + (yearCipher[yearLetters[0]] || '0') + (yearCipher[yearLetters[1]] || '0');
  const year = parseInt(yearStr, 10);
  return year * 100 + month;
}


function calculateSalePrice(item) {
    let latestMarker = '';
    let latestDate = -1; // 0 အစား -1 ပြောင်းထားပေးပါသည်
    (item.shopMarkers || []).forEach(marker => {
        const decodedDate = decodeDateFromMarker(marker);
        // ဒီနေရာတွင် > အစား >= ဟု ပြင်ဆင်လိုက်ပါသည်
        if (decodedDate >= latestDate) {
            latestDate = decodedDate;
            latestMarker = marker;
        }
    });

    const { basePrice, error } = decodeShopMarker(latestMarker);
    if (error || basePrice <= 0) return { salePrice: 0, isOverride: false };

    const percentageToUse = (item.salePriceMarkupOverride !== null && item.salePriceMarkupOverride !== undefined) 
        ? item.salePriceMarkupOverride : globalSalePricePercentage;
    
    let salePrice = basePrice * (1 + percentageToUse / 100);

    if (priceRoundingEnabled) {
        const remainder = salePrice % 1000;
        if (remainder >= 500) salePrice = salePrice - remainder + 1000;
        else salePrice = salePrice - remainder;
    } else {
        salePrice = Math.round(salePrice);
    }

    const isOverride = (item.salePriceMarkupOverride !== null && item.salePriceMarkupOverride !== undefined);
    return { salePrice, isOverride };
}


function openTab(tabName) {
  if (tabName === 'import-export') {
    if (window.currentUserRole === 'user') {
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.getElementById(tabName).classList.add('active');
        document.querySelector(`button[onclick="openTab('${tabName}')"]`).classList.add('active');
        return;
    }

    verifyAdminPassword(() => {
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.getElementById(tabName).classList.add('active');
        document.querySelector(`button[onclick="openTab('${tabName}')"]`).classList.add('active');
    });
    return;
  }

  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
  document.getElementById(tabName).classList.add('active');
  document.querySelector(`button[onclick="openTab('${tabName}')"]`).classList.add('active');

  const stores = {
    'main-store': 'mainStoreItems', 'home-store': 'homeStoreItems',
    'shop-store': 'shopStoreItems', 'combined-store': 'combinedStoreItems'
  };

  if (stores[tabName]) {
    currentPage[stores[tabName]] = 1;
    loadItemsTable(stores[tabName], tabName);
  } else if (tabName === 'pos-system') {
    openPosSubTab('pos-main', document.querySelector('.pos-sub-tab-button'));
    if (typeof loadPosProducts === 'function') loadPosProducts();
    if (typeof setupPosEventListeners === 'function') setupPosEventListeners();
  } else if (tabName === 'report') {
    if (typeof loadReports === 'function') loadReports();
  } else if (tabName === 'items-in-out') {
    document.getElementById('item-in').querySelector('.sub-tab-button')?.click();
    loadAddHistory(); loadItemOutHistory();
  }
}


function showUnsyncedChangesModal() {
    if (pendingSyncCount > 0) {
        
        showNotification(`⏳ Waiting for internet to sync (${pendingSyncCount} items)...`, "warning");
    } else {
        
        showNotification("✅ All data is fully synced to Cloud.", "success");
    }
}

function openSubTab(subTabId, button) {
  const parentTab = button.closest('.tab-content');
  parentTab.querySelectorAll('.sub-tab-content').forEach(tab => tab.classList.remove('active'));
  parentTab.querySelectorAll('.sub-tab-button').forEach(btn => btn.classList.remove('active'));
  document.getElementById(subTabId).classList.add('active');
  button.classList.add('active');
}

// --- POS UI HELPERS ---
function openPosSubTab(subTabId, button) {
    if(!button) return;
    const parentTab = button.closest('.tab-content');
    parentTab.querySelectorAll('.pos-sub-tab-content').forEach(tab => tab.classList.remove('active'));
    parentTab.querySelectorAll('.pos-sub-tab-button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(subTabId).classList.add('active');
    button.classList.add('active');
    if (subTabId === 'pos-history') {
        if (typeof loadSalesHistory === 'function') loadSalesHistory();
    }
}

function getCategoryIcon(category) {
    switch (category) {
        case 'အင်္ကျီ': return '👕';
        case 'ဘောင်းဘီ': return '👖';
        case 'ဝမ်းဆက်': return '👗';
        default: return '📦';
    }
}

// --- INVENTORY ADD/EDIT/DELETE (🌟 FIXED DATA LOSS RISK 🌟) ---

async function addItem(event) {
  event.preventDefault();
  if (!validateShopMarkerInput(document.getElementById('shop-marker'))) { showNotification('Fix Shop Marker error', 'error'); return; }

  const name = document.getElementById('item-name').value;
  const qtyIn = parseInt(document.getElementById('qty-in').value);

  if (!confirm(`သေချာပါသလား? သင်သည် [${name}] အရေအတွက် (${qtyIn}) ခုကို အသစ်ထည့်သွင်းမည်ဖြစ်သည်။`)) return;

  const code = document.getElementById('item-code').value;
  const shopMarkers = [document.getElementById('shop-marker').value.trim()];
  document.querySelectorAll('#additional-markers-container .additional-shop-marker').forEach(input => {
      if (input.value.trim()) shopMarkers.push(input.value.trim());
  });
  const category = document.getElementById('item-category').value;
  const destination = document.getElementById('add-destination').value;

  try {
      const batch = appDb.batch();
      const itemRef = appDb.collection(destination).doc(code);
      const histRef = appDb.collection('addHistory').doc();
      const now = new Date();
      const timestamp = now.toISOString();
      const date = timestamp.slice(0, 10);

      const existingItem = appData[destination].find(i => i.code === code);

      const isNew = !existingItem;
      const note = isNew ? "New Item Added" : "Restocked";
      const historyEntry = { date, timestamp, qtyIn, qtyOut: 0, note: note };
      let newItemData;

      if (existingItem) {
          // Local Update
          if(!existingItem.history) existingItem.history = [];
          existingItem.history.unshift(historyEntry);
          
          newItemData = { 
              ...existingItem,
              qtyIn: existingItem.qtyIn + qtyIn, 
              shopMarkers
          };
          
          // DB Update with arrayUnion
          batch.update(itemRef, { 
              qtyIn: firebase.firestore.FieldValue.increment(qtyIn), 
              shopMarkers, 
              history: firebase.firestore.FieldValue.arrayUnion(historyEntry) 
          });
      } else {
          newItemData = { name, code, shopMarkers, category, qtyIn, qtyOut: 0, salePriceMarkupOverride: null, history: [historyEntry], store: destination };
          batch.set(itemRef, newItemData);
      }

      const historyData = { date, timestamp, store: destination, name, code, shopMarkers, category, qtyIn, note, lastUpdatedAt: timestamp };
      batch.set(histRef, historyData);

      if (!newItems.has(`${destination}-${code}`)) newItems.add(`${destination}-${code}`);

      // Update Local RAM 
      updateSingleItemLocal(destination, { id: code, ...newItemData });
      updateSingleItemLocal('addHistory', { id: histRef.id, ...historyData });
      refreshCurrentView();
      
      // Sync to Firebase
      showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
      batch.commit().then(() => showSyncStatus('synced')).catch(e => {
          console.error("Firebase sync error:", e);
          showSyncStatus('pending');
      });

      event.target.reset();
      document.getElementById('additional-markers-container').innerHTML = ''; 
      toggleAutoCode(); 
      loadLastAddDestination(); 
      loadLastCategory();
      
      showNotification('ပစ္စည်းအောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ', 'success');
  } catch(e) {
      console.error(e); showNotification('Error adding item', 'error');
  }
}

async function updateItemOut(event) {
  event.preventDefault();
  
  const qtyOut = parseInt(document.getElementById('item-out-qty').value) || 0;
  const transferToEl = document.getElementById('item-out-transfer-to');
  const transferName = transferToEl.selectedOptions[0].text;

  if (!confirm(`သေချာပါသလား? သင်သည် ပစ္စည်း (${qtyOut}) ခုကို [${transferName}] လုပ်ဆောင်မည်ဖြစ်သည်။`)) return;

  const storeKey = document.getElementById('item-out-store').value;
  const code = document.getElementById('item-out-code').value;
  const transferTo = transferToEl.value;

  try {
      const batch = appDb.batch();
      const itemRef = appDb.collection(storeKey).doc(code);
      const historyRef = appDb.collection('itemOutHistory').doc();
      const now = new Date();

      const localItem = appData[storeKey].find(i => i.code === code);
      if(!localItem) throw new Error("Item not found");
      if (localItem.qtyIn - localItem.qtyOut < qtyOut) { 
          throw new Error("Insufficient stock!"); 
      }

      let note = `Removed ${qtyOut}`;
      let destRef = null;
      let destNewItemData = null;

      if (transferTo && transferTo !== storeKey) {
          const destStoreName = transferTo.replace('StoreItems', '');
          const fromStoreName = storeKey.replace('StoreItems', '');
          
          note = `Transferred ${qtyOut} to ${destStoreName}`;
          destRef = appDb.collection(transferTo).doc(code);
          const destLocalItem = appData[transferTo] ? appData[transferTo].find(i => i.code === code) : null;
          
          const destHistoryEntry = { 
              date: now.toISOString().slice(0, 10), 
              timestamp: now.toISOString(), 
              qtyIn: qtyOut, 
              qtyOut: 0, 
              note: `Received ${qtyOut} from ${fromStoreName}` 
          };
          
          if (destLocalItem) {
              if(!destLocalItem.history) destLocalItem.history = [];
              destLocalItem.history.unshift(destHistoryEntry);
              destNewItemData = { ...destLocalItem, qtyIn: destLocalItem.qtyIn + qtyOut };
              
              batch.update(destRef, { 
                  qtyIn: firebase.firestore.FieldValue.increment(qtyOut),
                  history: firebase.firestore.FieldValue.arrayUnion(destHistoryEntry)
              });
          } else {
              destNewItemData = { ...localItem, qtyIn: qtyOut, qtyOut: 0, history: [destHistoryEntry], store: transferTo };
              batch.set(destRef, destNewItemData);
          }
      }

      const outHistoryEntry = { date: now.toISOString().slice(0, 10), timestamp: now.toISOString(), qtyIn: 0, qtyOut, note };
      
      if(!localItem.history) localItem.history = [];
      localItem.history.unshift(outHistoryEntry);
      const updatedLocalItem = { ...localItem, qtyOut: localItem.qtyOut + qtyOut };
      
      batch.update(itemRef, { 
          qtyOut: firebase.firestore.FieldValue.increment(qtyOut), 
          history: firebase.firestore.FieldValue.arrayUnion(outHistoryEntry) 
      });

      const historyData = { 
        date: now.toISOString().slice(0, 10), timestamp: now.toISOString(), 
        store: storeKey, name: localItem.name, code, qtyOut, transferTo, 
        shopMarker: localItem.shopMarkers ? localItem.shopMarkers[0] : '', category: localItem.category || 'အခြား' ,
  note: note,
    lastUpdatedAt: now.toISOString()
      };


      batch.set(historyRef, historyData);

      updateSingleItemLocal(storeKey, { id: code, ...updatedLocalItem });
      if (destNewItemData) updateSingleItemLocal(transferTo, { id: code, ...destNewItemData });
      updateSingleItemLocal('itemOutHistory', { id: historyRef.id, ...historyData });
      refreshCurrentView();

      showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
      batch.commit().then(() => showSyncStatus('synced')).catch(e => {
          console.error("Firebase sync error:", e);
          showSyncStatus('pending');
      });

      event.target.reset();
      loadLastItemOutPreferences();
      showNotification('အောင်မြင်စွာ ထုတ်ယူ/ရွှေ့ပြောင်းပြီးပါပြီ', 'success');
  } catch(e) {
      console.error(e); 
      if (e.message === "Insufficient stock!") { alert('Insufficient stock!'); }
      else showNotification('Error: ' + e.message, 'error');
  }
}


function updateItemOutSearch() {
    const fromStore = document.getElementById('item-out-store').value;
    const transferSelect = document.getElementById('item-out-transfer-to');
    if (!transferSelect) return;

    const currentValue = transferSelect.value;
    transferSelect.innerHTML = '';

    const optionsData = [
        { value: 'mainStoreItems', text: 'ဂိုထောင်သို့ ရွှေ့မည်' },
        { value: 'homeStoreItems', text: 'အိမ်သို့ ရွှေ့မည်' },
        { value: 'shopStoreItems', text: 'ဆိုင်သို့ ရွှေ့မည်' }
    ];

    optionsData.forEach(data => {
        if (data.value !== fromStore) {
            const opt = document.createElement('option');
            opt.value = data.value;
            opt.text = data.text;
            transferSelect.appendChild(opt);
        }
    });

    // အကယ်၍ အခြား option မရှိတော့ပါက တစ်ခုခုကို ရွေးထားပေးရန် လိုအပ်ပါက ဤနေရာတွင် စစ်ဆေးနိုင်သည်
    const isValueStillValid = Array.from(transferSelect.options).some(opt => opt.value === currentValue);
    transferSelect.value = isValueStillValid ? currentValue : (transferSelect.options[0]?.value || "");
}


function saveLastItemOutPreferences() {
    const store = document.getElementById('item-out-store').value;
    const transferTo = document.getElementById('item-out-transfer-to').value;
    localStorage.setItem('lastOutStore', store);
    localStorage.setItem('lastOutTransfer', transferTo);
}

function loadLastItemOutPreferences() {
    document.getElementById('item-out-store').value = localStorage.getItem('lastOutStore') || 'mainStoreItems';
    
    updateItemOutSearch(); 
    
    const lastTransfer = localStorage.getItem('lastOutTransfer') || '';
    const transferSelect = document.getElementById('item-out-transfer-to');
    
    if (transferSelect && lastTransfer !== document.getElementById('item-out-store').value) {
        transferSelect.value = lastTransfer;
    } else if (transferSelect) {
        transferSelect.value = "";
    }
}


async function performEditSave(name, newCode, shopMarkers, category, qtyIn, salePriceMarkupOverride) {
  try {
      const oldCode = currentEditItem.code;
      const store = currentEditStoreKey;
      const batch = appDb.batch();
      const oldRef = appDb.collection(store).doc(oldCode);
      const newRef = appDb.collection(store).doc(newCode);
      const historyRef = appDb.collection('itemOutHistory').doc();
      const now = new Date().toISOString();

      const itemData = {...currentEditItem}; 

      if(oldCode !== newCode) {
          const isExists = [...appData.mainStoreItems, ...appData.homeStoreItems, ...appData.shopStoreItems].some(i => i.code === newCode);
          if(isExists) throw new Error("New code already exists!");
      }

      const currentOverride = itemData.salePriceMarkupOverride;
      let editNote = 'Edited';
      const changes = [];
      if (name !== currentEditItem.name) changes.push(`name: "${currentEditItem.name}"→"${name}"`);
      if (newCode !== currentEditItem.code) changes.push(`code: "${currentEditItem.code}"→"${newCode}"`);
      if (JSON.stringify(shopMarkers) !== JSON.stringify(currentEditItem.shopMarkers)) changes.push(`shopMarker`);
      if (category !== currentEditItem.category) changes.push(`category`);
      if (qtyIn !== currentEditItem.qtyIn) changes.push(`qtyIn: ${currentEditItem.qtyIn}→${qtyIn}`);
      if (salePriceMarkupOverride !== currentOverride) changes.push(`markup changed`);
      if (changes.length > 0) editNote += ' (' + changes.join(', ') + ')';

      itemData.name = name; itemData.code = newCode; itemData.shopMarkers = shopMarkers;
      itemData.category = category; itemData.qtyIn = qtyIn; itemData.salePriceMarkupOverride = salePriceMarkupOverride;
      
      if (!itemData.history) itemData.history = [];
      itemData.history.unshift({ date: now.slice(0,10), timestamp: now, qtyIn: 0, qtyOut: 0, note: editNote });

      if (oldCode !== newCode) {
          batch.set(newRef, itemData);
          batch.delete(oldRef);
      } else {
          batch.update(oldRef, itemData);
      }

      const historyData = { date: now.slice(0,10), timestamp: now, store, name, code: newCode, shopMarker: shopMarkers[0]||'', category, qtyOut: 0, transferTo: 'EDITED', lastUpdatedAt: now };
      batch.set(historyRef, historyData);

      if (oldCode !== newCode) deleteSingleItemLocal(store, oldCode);
      updateSingleItemLocal(store, { id: newCode, ...itemData });
      updateSingleItemLocal('itemOutHistory', { id: historyRef.id, ...historyData });
      refreshCurrentView();

      showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
      batch.commit().then(() => showSyncStatus('synced')).catch(e => {
          console.error("Firebase sync error:", e);
          showSyncStatus('pending');
      });

      showNotification('အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ', 'success');
      closeEditModal();
  } catch(e) {
      console.error(e); showNotification('Error editing item: ' + e.message, 'error');
  }
}

async function deleteItem(storeKey, code, tabId) {
  // SECURE DELETE WITH FIREBASE RE-AUTH
  verifyAdminPassword(async () => {
      try {
          const batch = appDb.batch();
          const docRef = appDb.collection(storeKey).doc(code);
          const historyRef = appDb.collection('itemOutHistory').doc();
          const now = new Date().toISOString();

          const localItem = appData[storeKey].find(i => i.code === code);
          
          if (localItem) {
              batch.delete(docRef); // Inventory အပြီးဖျက်သည် (Hard Delete)
              
              const historyData = { date: now.slice(0,10), timestamp: now, store: storeKey, name: localItem.name, code: localItem.code, shopMarker: localItem.shopMarkers?.[0]||'', category: localItem.category, qtyOut: localItem.qtyIn - localItem.qtyOut, transferTo: 'DELETED', lastUpdatedAt: now };
              batch.set(historyRef, historyData);
              
              deleteSingleItemLocal(storeKey, code);
              updateSingleItemLocal('itemOutHistory', { id: historyRef.id, ...historyData });
              refreshCurrentView();
              
              showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
              batch.commit().then(() => showSyncStatus('synced')).catch(e => {
                  console.error("Firebase sync error:", e);
                  showSyncStatus('pending');
              });

              showNotification('Item deleted successfully', 'success');
          }
      } catch(e) {
          console.error(e); showNotification('Error deleting', 'error');
      }
  }, true);
}

async function checkAndRemoveZeroStock(immediate = false, isSilent = false) {
  if (!isSilent) showProgress('Checking zero stock items...');
  const stores = ['mainStoreItems', 'homeStoreItems', 'shopStoreItems'];
  let totalRemoved = 0;
  let batch = appDb.batch();
  const now = new Date();
  let opCount = 0;

  for (const storeKey of stores) {
     const items = appData[storeKey] || [];
     for (const item of items) {
         const currentQty = item.qtyIn - item.qtyOut;
         if (currentQty <= 0) {
             let shouldRemove = immediate;
             if (!immediate) {
                 if (!item.history || item.history.length === 0) {
                     shouldRemove = true;
                 } else {
                     const lastUpdate = new Date(item.history[0]?.timestamp || item.history[0]?.date || new Date());
                     if ((now - lastUpdate) / (1000 * 60 * 60) >= 72) {
                         shouldRemove = true;
                     }
                 }
             }
             if (shouldRemove) {
                 const itemRef = appDb.collection(storeKey).doc(item.code);
                 batch.delete(itemRef); // Inventory အပြီးဖျက်သည် (Hard Delete)
                 const histRef = appDb.collection('itemOutHistory').doc();
                 const historyData = { date: now.toISOString().slice(0, 10), timestamp: now.toISOString(), store: storeKey, name: item.name, code: item.code, shopMarker: item.shopMarkers?.[0]||'', category: item.category, qtyOut: 0, transferTo: 'Deleted due to 0 stock', note: 'Auto-removed', lastUpdatedAt: now.toISOString() };
                 batch.set(histRef, historyData);
                 
                 deleteSingleItemLocal(storeKey, item.code);
                 updateSingleItemLocal('itemOutHistory', { id: histRef.id, ...historyData });
                 
                 totalRemoved++;
                 opCount += 2;
                 
                 if (opCount >= 450) {
                     showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
                     await batch.commit().then(() => showSyncStatus('synced')).catch(e => showSyncStatus('pending'));
                     batch = appDb.batch();
                     opCount = 0;
                 }
             }
         }
     }
  }

  if (totalRemoved > 0) {
     if (opCount > 0) {
         showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
         await batch.commit().then(() => showSyncStatus('synced')).catch(e => showSyncStatus('pending'));
     }
     refreshCurrentView();
     if (!isSilent) showNotification(`Removed ${totalRemoved} zero stock items from Cloud`, 'success', 7000);
  } else {
     if (!isSilent) showNotification('No zero stock items found.', 'info');
  }
  if (!isSilent) hideProgress();
}


// --- PREFERENCES & STATE MANAGEMENT ---

function savePosSettings() {
    const storeEl = document.getElementById('pos-source-store');
    if(storeEl) {
        localStorage.setItem('posSourceStore', storeEl.value);
        showNotification(`POS source store set to ${storeEl.value.replace('StoreItems', ' Store')}`, 'success');
        if(typeof posSourceStore !== 'undefined') {
            posSourceStore = storeEl.value; // Update global in pos.js if exists
        }
    }
}
function loadPosSettings() {
    const savedStore = localStorage.getItem('posSourceStore') || 'shopStoreItems';
    const storeEl = document.getElementById('pos-source-store');
    if(storeEl) storeEl.value = savedStore;
}
function saveSalePricePercentage(value) {
    globalSalePricePercentage = parseFloat(value) || 50;
    localStorage.setItem('globalSalePricePercentage', globalSalePricePercentage);
    document.getElementById('pricing-status').textContent = `Current Markup: ${globalSalePricePercentage}%`;
    refreshCurrentView();
}
function loadSalePricePercentage() {
    globalSalePricePercentage = parseFloat(localStorage.getItem('globalSalePricePercentage')) || 50;
    document.getElementById('global-sale-price-percentage').value = globalSalePricePercentage;
    document.getElementById('pricing-status').textContent = `Current Markup: ${globalSalePricePercentage}%`;
}
function savePriceRoundingPreference(isEnabled) {
    priceRoundingEnabled = isEnabled;
    localStorage.setItem('priceRoundingEnabled', isEnabled);
    showNotification(`Price rounding is now ${isEnabled ? 'ON' : 'OFF'}.`, 'success');
    refreshCurrentView();
}
function loadPriceRoundingPreference() {
    priceRoundingEnabled = localStorage.getItem('priceRoundingEnabled') === 'true';
    document.getElementById('price-rounding-checkbox').checked = priceRoundingEnabled;
}
function changeHistoryLimit(newLimit) {
    if (newLimit < 1 || newLimit > 100) return alert('Must be 1-100');
    HISTORY_LIMIT = newLimit;
    localStorage.setItem('historyLimit', newLimit);
    showNotification(`History limit changed to ${newLimit}`, 'success');
}
function loadHistoryLimit() {
    HISTORY_LIMIT = parseInt(localStorage.getItem('historyLimit')) || 10;
    document.getElementById('history-limit-input').value = HISTORY_LIMIT;
}

function saveLastAddDestination() {
    const destination = document.getElementById('add-destination').value;
    localStorage.setItem('lastAddDestination', destination);
}

function loadLastAddDestination() {
    const lastDestination = localStorage.getItem('lastAddDestination') || 'mainStoreItems';
    document.getElementById('add-destination').value = lastDestination;
}

function saveLastCategory() {
    const category = document.getElementById('item-category')?.value;
    if(category) localStorage.setItem('lastCategory', category);
}

function loadLastCategory() {
    const lastCategory = localStorage.getItem('lastCategory') || 'အင်္ကျီ';
    const catSelect = document.getElementById('item-category');
    if(catSelect) catSelect.value = lastCategory;
}

function closeClearDataModal() {
    const modal = document.getElementById('clear-data-modal');
    if(modal) modal.classList.remove('visible');
}


// --- IMPORT / EXPORT & CLOUD DATA MANAGEMENT ---

function exportFullDatabase() {
    const dataToExport = {
        mainStoreItems: appData.mainStoreItems || [],
        homeStoreItems: appData.homeStoreItems || [],
        shopStoreItems: appData.shopStoreItems || [],
        addHistory: appData.addHistory || [],
        itemOutHistory: appData.itemOutHistory || [],
        salesHistory: appData.salesHistory || []
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(dataToExport));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `lili_backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(dlAnchorElem);
    dlAnchorElem.click();
    dlAnchorElem.remove();
    showNotification("Backup ကို JSON ဖြင့် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။", "success");
}

function triggerRestoreDatabase() {
    document.getElementById('restore-file').click();
}

function cleanFirestoreData(obj) {
    if (obj === undefined) return null; 
    if (Array.isArray(obj)) return obj.map(cleanFirestoreData).filter(v => v !== undefined);
    if (obj !== null && typeof obj === 'object') {
        let res = {};
        for (let key in obj) {
            if (obj[key] !== undefined) {
                res[key] = cleanFirestoreData(obj[key]);
            }
        }
        return res;
    }
    return obj;
}

async function restoreDatabase() {
    const fileInput = document.getElementById('restore-file');
    const file = fileInput.files[0];
    if (!file) return;

    if (!confirm("⚠️ သတိပေးချက် - ဤ Backup ဖိုင်ကိုထည့်သွင်းပါက လက်ရှိ Cloud ပေါ်ရှိ Data များနှင့် ပေါင်းသွားပါမည် (Overwrite ဖြစ်မည်)။ သေချာပါသလား?")) {
        fileInput.value = '';
        return;
    }

    // 🌟 ဝင်နေစဉ် Window မပိတ်မိစေရန် 🌟
    window.onbeforeunload = function() {
        return "Data ထည့်သွင်းနေဆဲဖြစ်ပါသည်။ ထွက်လိုက်ပါက Data များ ရှုပ်ထွေးသွားနိုင်ပါသည်။";
    };

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            showProgress('Data များ Cloud သို့ ပြန်လည်ထည့်သွင်းနေပါသည်... (Browser ကို မပိတ်ပါနှင့်)');
            const backupData = JSON.parse(e.target.result);
            const collections = ['mainStoreItems', 'homeStoreItems', 'shopStoreItems', 'addHistory', 'itemOutHistory', 'salesHistory'];
            
            let batch = appDb.batch();
            let opCount = 0;

            for (const col of collections) {
                if (backupData[col]) {
                    let itemsToProcess = [];
                    if (Array.isArray(backupData[col])) {
                        itemsToProcess = backupData[col];
                    } else if (typeof backupData[col] === 'object') {
                        itemsToProcess = Object.entries(backupData[col]).map(([key, val]) => ({ id: key, ...val }));
                    }

                                       for (const rawItem of itemsToProcess) {
                        let item = migrateItemShopMarkers(rawItem); 

                        if (item.shopMarkers && Array.isArray(item.shopMarkers)) {
                            item.shopMarkers = item.shopMarkers.map(marker => autoCorrectShopMarker(marker));
                        }

                        let docId = item.id;

                        if (!docId || typeof docId === 'number') {
                            if (col === 'salesHistory') {
                                docId = item.id ? String(item.id) : `TXN-${new Date().getTime()}-${Math.floor(Math.random()*1000)}`;
                            } else if (['mainStoreItems', 'homeStoreItems', 'shopStoreItems'].includes(col)) {
                                docId = item.code ? String(item.code) : null;
                            } else {
                                docId = appDb.collection(col).doc().id; 
                            }
                        } else {
                            docId = String(docId);
                        }
                        
                        if (docId) {
                            docId = docId.replace(/\//g, '-');
                            
                            const docRef = appDb.collection(col).doc(docId);
                            let itemData = cleanFirestoreData({ ...item });
                            delete itemData.id; 
                            
                            batch.set(docRef, itemData, { merge: true });
                            opCount++;

                            if (opCount >= 450) { 
                                showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
                                await batch.commit().then(() => showSyncStatus('synced')).catch(e => showSyncStatus('pending'));
                                batch = appDb.batch();
                                opCount = 0;
                            }
                        }
                    }
                }
            }
            if (opCount > 0) {
                showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
                await batch.commit().then(() => showSyncStatus('synced')).catch(e => showSyncStatus('pending'));
            }
            showNotification('Backup Data များ Cloud သို့ အောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ', 'success', 8000);
        } catch (err) {
            console.error('Restore Error:', err);
            showNotification('Backup ဖိုင် မှားယွင်းနေပါသည်။ (Format မကိုက်ညီပါ)', 'error');
        } finally {
            hideProgress();
            fileInput.value = '';
            window.onbeforeunload = null; // ပြန်လည်ပယ်ဖျက်မည်
        }
    };
    reader.readAsText(file);
}

function selectAllClearOptions() {
    document.querySelectorAll('#clear-data-modal input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function deselectAllClearOptions() {
    document.querySelectorAll('#clear-data-modal input[type="checkbox"]').forEach(cb => cb.checked = false);
}

async function executeClearData() {
    const selectedStores = Array.from(document.querySelectorAll('#clear-data-modal input[type="checkbox"]:checked')).map(cb => cb.value);
    if (selectedStores.length === 0) {
        showNotification('ဖျက်လိုသော Data များကို ရွေးချယ်ပါ။', 'warning');
        return;
    }

    if (!confirm('ရွေးချယ်ထားသော Data များကို Cloud မှ အပြီးအပိုင် ဖျက်မည်မှာ သေချာပါသလား?')) return;

    showProgress('Data များကို ဖျက်နေပါသည်...');
    try {
        let batch = appDb.batch();
        let opCount = 0;

        for (const col of selectedStores) {
            if (appData[col] && Array.isArray(appData[col])) {
                for (const item of appData[col]) {
                    const docId = item.id || item.code;
                    if (docId) {
                        const docRef = appDb.collection(col).doc(String(docId));
                        
                        // အားလုံးကို အပြီးအပိုင် Hard Delete လုပ်မည်
                        batch.delete(docRef);
                        
                        opCount++;

                        if (opCount >= 450) {
                            showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
                            await batch.commit().then(() => showSyncStatus('synced')).catch(e => showSyncStatus('pending'));
                            batch = appDb.batch();
                            opCount = 0;
                        }
                    }
                }
            }
        }
        
        if (opCount > 0) {
            showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
            await batch.commit().then(() => showSyncStatus('synced')).catch(e => showSyncStatus('pending'));
        }
        
        document.getElementById('clear-data-modal').classList.remove('visible');
        showNotification('ရွေးချယ်ထားသော Data များကို အောင်မြင်စွာ ဖျက်ပစ်လိုက်ပါပြီ', 'success');
        
        // ဖုန်း Local RAM ထဲမှ ချက်ချင်းလိုက်ဖျက်ပေးမည်
        for (const col of selectedStores) {
            if (appData[col]) {
                 const items = [...appData[col]];
                 for(const item of items) {
                      deleteSingleItemLocal(col, item.id || item.code);
                 }
            }
        }
        refreshCurrentView();

    } catch (err) {
        console.error("Clear Error:", err);
        showNotification('Data များဖျက်ရာတွင် အမှားအယွင်းဖြစ်ပေါ်ခဲ့ပါသည်။', 'error');
    } finally {
        hideProgress();
    }
}


// --- UTILITIES & MARKERS ---
function highlightMatch(text, search) {
  if (!search || text === undefined || text === null) return text || '';
  const regex = new RegExp(`(${search})`, 'ig');
  return text.toString().replace(regex, '<span style="color: orange; font-weight: bold;">$1</span>');
}

function setupMarkerButtons() {
    document.getElementById('add-marker-btn').addEventListener('click', () => {
        const container = document.getElementById('additional-markers-container');
        const newRow = document.createElement('div');
        newRow.className = 'marker-input-row';
        newRow.innerHTML = `<input type="text" class="additional-shop-marker" oninput="validateShopMarkerInput(this)"><button type="button" class="marker-remove-btn">-</button>`;
        container.appendChild(newRow);
    });
    document.getElementById('edit-add-marker-btn').addEventListener('click', () => {
        const container = document.getElementById('edit-additional-markers-container');
        const newRow = document.createElement('div');
        newRow.className = 'marker-input-row';
        newRow.innerHTML = `<input type="text" class="additional-shop-marker" oninput="validateShopMarkerInput(this)"><button type="button" class="marker-remove-btn">-</button>`;
        container.appendChild(newRow);
    });
    document.addEventListener('click', function(event) {
        if (event.target && event.target.classList.contains('marker-remove-btn')) event.target.closest('.marker-input-row').remove();
    });
}

function decodeShopMarker(shopMarker) {
    const PRICE_CIPHER = { W: '1', H: '2', A: '3', T: '4', I: '5', S: '6', Y: '7', O: '8', U: '9', R: '0' };
    if (!shopMarker || typeof shopMarker !== 'string') return { basePrice: 0, error: 'Marker မရှိပါ။' };
    
    const parts = shopMarker.trim().toUpperCase().split('-');
    if (parts.length !== 2) return { basePrice: 0, error: 'Format မှားနေပါသည်။ (ဥပမာ - WHI-2BE)' };
    
    const [priceCode, dateCode] = parts;
    
    // Price Code စစ်ဆေးခြင်း
    if (!/^[A-Z]{2,3}$/.test(priceCode)) return { basePrice: 0, error: 'ဈေးနှုန်းကုဒ် မှားနေပါသည်။' };
    let priceString = '';
    for (const char of priceCode) {
        if (PRICE_CIPHER[char]) priceString += PRICE_CIPHER[char];
        else return { basePrice: 0, error: `'${char}' သည် WHATISYOUR တွင် မပါဝင်ပါ။` };
    }

    // လ နှင့် ခုနှစ် Format စစ်ဆေးခြင်း
    const monthMatch = dateCode.match(/^\d{1,2}/);
    const yearMatch = dateCode.match(/[A-J]{2}$/);
    if (!monthMatch || !yearMatch || dateCode.length !== (monthMatch[0].length + 2)) {
        return { basePrice: 0, error: 'လ နှင့် ခုနှစ် Format မှားနေပါသည်။' };
    }
    
    
    const month = parseInt(monthMatch[0], 10);
    if (month < 1 || month > 12) {
        return { basePrice: 0, error: 'လသည် ၁ မှ ၁၂ အတွင်းသာ ရှိရပါမည်။' };
    }

    return { basePrice: parseInt(priceString, 10) * 100, error: null };
}
// --- Marker များကို Auto-correct လုပ်ပေးမည့် Function အသစ် ---
function autoCorrectShopMarker(marker) {
    if (!marker || typeof marker !== 'string') return marker;
    
    const originalMarker = marker;
    // စာလုံးအကြီးပြောင်းပြီး လိုအပ်တဲ့ စာသားနဲ့ ဂဏန်း၊ တုံးတို (-) ကိုပဲ ယူပါမည်
    let value = marker.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    let rawValue = value.replace(/-/g, '');
    
    let correctedMarker = value;
    
    // မှန်ကန်တဲ့ Format (ဥပမာ: ABC-123) အဖြစ် ခွဲထုတ်ကြည့်ပါမည်
    let match = rawValue.match(/^([A-Z]{2,3})(\d+.*)$/);
    if (match) {
        correctedMarker = match[1] + '-' + match[2];
    } else if (rawValue.length > 3 && /^[A-Z]+$/.test(rawValue)) {
        correctedMarker = rawValue.substring(0, 3) + '-' + rawValue.substring(3);
    }
    
    // ပြင်ပြီးသား Marker က တကယ်ရော အလုပ်လုပ်လား စစ်ဆေးပါမည်
    const { error } = decodeShopMarker(correctedMarker);
    if (!error) {
        return correctedMarker; // အောင်မြင်စွာ ပြင်နိုင်ပါက ပြင်ထားသည်ကို သုံးမည်
    }
    
    // Auto-correct လုပ်လို့မရပါက မူလအတိုင်းပဲ ပြန်ထားခဲ့ပါမည်
    return originalMarker;
}


function validateShopMarkerInput(inputElement) {
    
    let value = inputElement.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    
    
    let rawValue = value.replace(/-/g, ''); 
    
    
    let match = rawValue.match(/^([A-Z]{2,3})(\d+.*)$/);
    
    if (match) {
        
        value = match[1] + '-' + match[2];
    } else if (rawValue.length > 3 && /^[A-Z]+$/.test(rawValue)) {
        
        value = rawValue.substring(0, 3) + '-' + rawValue.substring(3);
    } else {
        
        if (value.endsWith('-') && rawValue.length <= 3) {
            value = rawValue + '-';
        } else {
            value = rawValue;
        }
    }

    
    inputElement.value = value; 

    
    const validatorElement = document.getElementById(inputElement.id.includes('edit') ? 'edit-shop-marker-validator' : 'shop-marker-validator');
    if (!validatorElement) return true;
    
    if (!value) { 
        validatorElement.textContent = ''; 
        inputElement.classList.remove('input-error'); 
        return true; 
    }
    
    
    const { error } = decodeShopMarker(value);
    if (error) { 
        validatorElement.textContent = `Error: ${error}`; 
        inputElement.classList.add('input-error'); 
        return false; 
    } else { 
        validatorElement.textContent = ''; 
        inputElement.classList.remove('input-error'); 
        return true; 
    }
}



function generateUniqueCode() {
  const existingCodes = new Set([...appData.mainStoreItems, ...appData.homeStoreItems, ...appData.shopStoreItems].map(i => i.code));
  let newCode; 
  do { 
      newCode = `LL${Math.floor(100 + Math.random() * 900)}`; 
  } while (existingCodes.has(newCode));
  return newCode;
}

function toggleAutoCode() {
  const autoCheckbox = document.getElementById('auto-code-checkbox');
  const codeInput = document.getElementById('item-code');
  const reminder = document.getElementById('code-reminder');
  const nameInput = document.getElementById('item-name');
  
  if (autoCheckbox.checked) {
      codeInput.value = generateUniqueCode();
      reminder.style.display = 'none';
      reminder.onclick = null;
      reminder.style.cursor = 'default';
  } else {
      codeInput.value = ''; 
      
      if (nameInput.value.trim().length > 0) {
          const suggestedCode = generateUniqueCode();
          reminder.textContent = `Suggestion: ${suggestedCode} (click to use)`;
          reminder.style.display = 'block';
          reminder.style.color = '#3498db';
          reminder.style.cursor = 'pointer';
          reminder.onclick = () => {
              codeInput.value = suggestedCode;
              checkDuplicateCode(); 
          };
      } else {
          reminder.style.display = 'none';
          reminder.textContent = '';
      }
  }
}

function checkDuplicateCode() {
  const code = document.getElementById('item-code').value;
  const reminder = document.getElementById('code-reminder');
  const autoCheckbox = document.getElementById('auto-code-checkbox');
  
  if (autoCheckbox.checked) { 
      reminder.style.display = 'none'; 
      return; 
  }

  if (!code) { 
      toggleAutoCode(); 
      return; 
  }
  
  const isDuplicate = [...appData.mainStoreItems, ...appData.homeStoreItems, ...appData.shopStoreItems].some(i => i.code === code);
  
  if (isDuplicate) {
      reminder.textContent = 'This code already exists in the inventory!';
      reminder.style.display = 'block';
      reminder.style.color = 'red'; 
      reminder.style.cursor = 'default';
      reminder.onclick = null;
  } else {
      reminder.style.display = 'none';
  }
}

function searchAddItems() {
  const searchValue = document.getElementById("add-search-bar").value.toLowerCase();
  const destination = document.getElementById('add-destination').value;
  const resultsDiv = document.getElementById("add-search-results");
  resultsDiv.innerHTML = "";
  
  const filteredItems = (appData[destination] || []).map(migrateItemShopMarkers).filter(item =>
    item.name.toLowerCase().includes(searchValue) || 
    item.code.toLowerCase().includes(searchValue) || 
    (item.shopMarkers && item.shopMarkers.some(m => m.toLowerCase().includes(searchValue)))
  );
  
  if (filteredItems.length > 0 && searchValue) {
    // ၅ ခုတိတိကိုသာ ဖြတ်ယူပြသမည်
    filteredItems.slice(0, 5).forEach(item => {
      const p = document.createElement("p");
      
      const highlightedCode = highlightMatch(item.code, searchValue);
      const highlightedName = highlightMatch(item.name, searchValue);
      const highlightedMarker = highlightMatch((item.shopMarkers && item.shopMarkers[0]) || 'N/A', searchValue);
      
      p.innerHTML = `<span style="font-size:1.1em;">${highlightedCode}</span> , ${highlightedName} , ${highlightedMarker} (Qty: ${item.qtyIn - item.qtyOut})`;
      p.style.cursor = "pointer";
      p.onclick = () => {
        document.getElementById("item-name").value = item.name;
        document.getElementById("item-code").value = item.code;
        document.getElementById("item-category").value = item.category;
        const additionalMarkersContainer = document.getElementById('additional-markers-container');
        additionalMarkersContainer.innerHTML = ''; 
        document.getElementById("shop-marker").value = (item.shopMarkers && item.shopMarkers[0]) || '';
        if (item.shopMarkers && item.shopMarkers.length > 1) {
          item.shopMarkers.slice(1).forEach(marker => {
            const newRow = document.createElement('div'); newRow.className = 'marker-input-row';
            newRow.innerHTML = `<input type="text" class="additional-shop-marker" value="${marker}" oninput="validateShopMarkerInput(this)"><button type="button" class="marker-remove-btn">-</button>`;
            additionalMarkersContainer.appendChild(newRow);
          });
        }
        resultsDiv.innerHTML = "";
        checkDuplicateCode();
      };
      resultsDiv.appendChild(p);
    });

    // ၅ ခုထက်ပိုနေပါက အသိပေးစာသားပြမည်
    if (filteredItems.length > 5) {
        const moreInfo = document.createElement("p");
        moreInfo.innerHTML = `<span style="color: #7f8c8d; font-size: 12px; font-style: italic;">... နောက်ထပ် ကိုက်ညီသည့်ပစ္စည်း (${filteredItems.length - 5}) ခု ရှိပါသေးသည် ...</span>`;
        moreInfo.style.textAlign = "center";
        moreInfo.style.cursor = "default";
        moreInfo.style.margin = "5px 0 0 0";
        resultsDiv.appendChild(moreInfo);
    }
  } else if (searchValue) {
     resultsDiv.textContent = "No matching items found.";
  }
}


function searchItemOut() {
  const storeKey = document.getElementById('item-out-store').value;
  const searchValue = document.getElementById('item-out-search-bar').value.toLowerCase();
  const resultsDiv = document.getElementById('item-out-search-results');
  resultsDiv.innerHTML = '';
  
  const filteredItems = (appData[storeKey] || []).map(migrateItemShopMarkers).filter(item =>
    item.name.toLowerCase().includes(searchValue) || 
    item.code.toLowerCase().includes(searchValue) || 
    (item.shopMarkers && item.shopMarkers.some(m => m.toLowerCase().includes(searchValue)))
  );
  
  if (filteredItems.length > 0 && searchValue) {
    // ၅ ခုတိတိကိုသာ ဖြတ်ယူပြသမည်
    filteredItems.slice(0, 5).forEach(item => {
      const p = document.createElement('p');
      
      const highlightedCode = highlightMatch(item.code, searchValue);
      const highlightedName = highlightMatch(item.name, searchValue);
      const highlightedMarker = highlightMatch((item.shopMarkers && item.shopMarkers[0]) || 'N/A', searchValue);
      
      p.innerHTML = `<span style="font-size:1.1em;">${highlightedCode}</span> , ${highlightedName} , ${highlightedMarker} (Qty: ${item.qtyIn - item.qtyOut})`;
      p.style.cursor = 'pointer';
      p.onclick = () => {
        document.getElementById('item-out-name').value = item.name;
        document.getElementById('item-out-code').value = item.code;
        document.getElementById('item-out-shop-marker').value = (item.shopMarkers || []).join('_');
        document.getElementById('item-out-category').value = item.category;
        document.getElementById('item-out-current-qty').value = item.qtyIn - item.qtyOut;
        resultsDiv.innerHTML = '';
      };
      resultsDiv.appendChild(p);
    });

    // ၅ ခုထက်ပိုနေပါက အသိပေးစာသားပြမည်
    if (filteredItems.length > 5) {
        const moreInfo = document.createElement("p");
        moreInfo.innerHTML = `<span style="color: #7f8c8d; font-size: 12px; font-style: italic;">... နောက်ထပ် ကိုက်ညီသည့်ပစ္စည်း (${filteredItems.length - 5}) ခု ရှိပါသေးသည် ...</span>`;
        moreInfo.style.textAlign = "center";
        moreInfo.style.cursor = "default";
        moreInfo.style.margin = "5px 0 0 0";
        resultsDiv.appendChild(moreInfo);
    }
  } else if (searchValue) {
     resultsDiv.textContent = "No matching items found.";
  }
}


// --- RENDER FUNCTIONS (🌟 FIXED DATE SORTING 🌟) ---
function loadAddHistory() {
  const fromDate = document.getElementById('add-history-from').value || new Date().toISOString().slice(0, 10);
  const toDate = document.getElementById('add-history-to').value || new Date().toISOString().slice(0, 10);
  getData('addHistory').then(addHistory => {
    const filteredHistory = addHistory.filter(entry => entry.date >= fromDate && entry.date <= toDate).sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
    const tableBody = document.getElementById('add-history-table-body');
    const totalItems = filteredHistory.length;
    if (!currentPage['addHistory']) currentPage['addHistory'] = 1;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    const startIndex = (currentPage['addHistory'] - 1) * ITEMS_PER_PAGE;
    const paginatedHistory = filteredHistory.slice(startIndex, Math.min(startIndex + ITEMS_PER_PAGE, totalItems));
    tableBody.innerHTML = '';
    paginatedHistory.forEach(entry => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${entry.date}</td><td>${entry.store.split('Store')[0]}</td><td>${entry.name}</td><td>${entry.code}</td><td>${(entry.shopMarkers || []).join('_ ')}</td><td>${entry.category || ''}</td><td>${entry.qtyIn}</td>`;
      tableBody.appendChild(row);
    });
    updateHistoryPaginationControls('addHistory', 'add-history', currentPage['addHistory'], totalPages, totalItems);
  });
}

function loadItemOutHistory() {
  const fromDate = document.getElementById('item-out-history-from').value || new Date().toISOString().slice(0, 10);
  const toDate = document.getElementById('item-out-history-to').value || new Date().toISOString().slice(0, 10);
  getData('itemOutHistory').then(itemOutHistory => {
    const filteredHistory = itemOutHistory.filter(entry => entry.date >= fromDate && entry.date <= toDate).sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
    const tableBody = document.getElementById('item-out-history-table-body');
    const totalItems = filteredHistory.length;
    if (!currentPage['itemOutHistory']) currentPage['itemOutHistory'] = 1;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    const startIndex = (currentPage['itemOutHistory'] - 1) * ITEMS_PER_PAGE;
    const paginatedHistory = filteredHistory.slice(startIndex, Math.min(startIndex + ITEMS_PER_PAGE, totalItems));
    tableBody.innerHTML = '';
    paginatedHistory.forEach(entry => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${entry.date}</td><td>${entry.store.split('Store')[0]}</td><td>${entry.name}</td><td>${entry.code}</td><td>${entry.shopMarker || ''}</td><td>${entry.category || ''}</td><td>${entry.qtyOut}</td><td>${entry.transferTo || ''}</td>`;
      tableBody.appendChild(row);
    });
    updateHistoryPaginationControls('itemOutHistory', 'item-out-history', currentPage['itemOutHistory'], totalPages, totalItems);
  });
}

function loadItemsTable(storeKey, tabId) {
  if (storeKey === 'combinedStoreItems') {
    Promise.all([getData('mainStoreItems'), getData('homeStoreItems'), getData('shopStoreItems')]).then(([mainItems, homeItems, shopItems]) => {
      const searchValue = document.getElementById('combined-search-bar').value.toLowerCase();
      const tableBody = document.getElementById('combined-items-table-body');
      const statusDiv = document.getElementById('combined-status');
      const combinedItemsMap = new Map();
      [...mainItems, ...homeItems, ...shopItems].map(migrateItemShopMarkers).forEach(item => {
        if (combinedItemsMap.has(item.code)) {
          const existing = combinedItemsMap.get(item.code);
          existing.qtyIn += item.qtyIn; existing.qtyOut += item.qtyOut;
          existing.history = [...(existing.history || []), ...(item.history || [])].sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
          existing.shopMarkers = [...new Set([...(existing.shopMarkers || []), ...(item.shopMarkers || [])])];
          if(!existing.salePriceMarkupOverride && item.salePriceMarkupOverride) existing.salePriceMarkupOverride = item.salePriceMarkupOverride;
          if (item.store === 'mainStoreItems') existing.mainQty = (existing.mainQty || 0) + (item.qtyIn - item.qtyOut);
          else if (item.store === 'homeStoreItems') existing.homeQty = (existing.homeQty || 0) + (item.qtyIn - item.qtyOut);
          else if (item.store === 'shopStoreItems') existing.shopQty = (existing.shopQty || 0) + (item.qtyIn - item.qtyOut);
        } else {
          combinedItemsMap.set(item.code, { ...item, history: [...(item.history || [])], shopMarkers: [...(item.shopMarkers || [])], mainQty: item.store === 'mainStoreItems' ? item.qtyIn - item.qtyOut : 0, homeQty: item.store === 'homeStoreItems' ? item.qtyIn - item.qtyOut : 0, shopQty: item.store === 'shopStoreItems' ? item.qtyIn - item.qtyOut : 0 });
        }
      });
      const combinedItems = Array.from(combinedItemsMap.values());
      document.getElementById('combined-item-count').textContent = combinedItems.length;
      
      filterStates[storeKey].lowStock = document.getElementById('combined-low-stock-filter').checked;
      filterStates[storeKey].unverified = document.getElementById('combined-unverified-filter').checked;
      VALID_CATEGORIES.forEach(category => filterStates[storeKey].category[category] = document.getElementById(`combined-category-${category}-filter`)?.checked || false);

      const sortedItems = combinedItems.map(item => {
          const history = item.history || [];
          const creationTime = history.length > 0 ? new Date(history[0].timestamp || history[0].date || 0).getTime() : 0;
          return { ...item, creationTime };
      }).sort((a, b) => b.creationTime - a.creationTime);

      const selectedCategories = VALID_CATEGORIES.filter(c => filterStates[storeKey].category[c]);
      let filteredItems = sortedItems.filter(item =>
        (item.name.toLowerCase().includes(searchValue) || item.code.toLowerCase().includes(searchValue) || (item.shopMarkers && item.shopMarkers.some(m => m.toLowerCase().includes(searchValue)))) &&
        (selectedCategories.length === 0 || selectedCategories.includes(item.category)) &&
        (!filterStates[storeKey].lowStock || (item.qtyIn - item.qtyOut) < LOW_STOCK_THRESHOLD) &&
        (!filterStates[storeKey].unverified || !((item.mainQty === 0 || verifiedItems.mainStoreItems.has(item.code)) && (item.homeQty === 0 || verifiedItems.homeStoreItems.has(item.code)) && (item.shopQty === 0 || verifiedItems.shopStoreItems.has(item.code))))
      );

      if (!currentPage[storeKey]) currentPage[storeKey] = 1;
      const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
      const startIndex = (currentPage[storeKey] - 1) * ITEMS_PER_PAGE;
      const paginatedItems = filteredItems.slice(startIndex, Math.min(startIndex + ITEMS_PER_PAGE, filteredItems.length));
      
      tableBody.innerHTML = '';
      paginatedItems.forEach((item, index) => {
        const currentQty = item.qtyIn - item.qtyOut;
        const isFullyVerified = (item.mainQty === 0 || verifiedItems.mainStoreItems.has(item.code)) && (item.homeQty === 0 || verifiedItems.homeStoreItems.has(item.code)) && (item.shopQty === 0 || verifiedItems.shopStoreItems.has(item.code));
        const { salePrice, isOverride } = calculateSalePrice(item);
        
        const row = document.createElement('tr'); row.className = `item-row ${index % 2 === 0 ? 'even' : 'odd'}`;
        row.innerHTML = `<td>${item.name}</td><td>${item.code}</td><td>${(item.shopMarkers || []).join('_')}</td><td>${item.category}</td><td ${currentQty < LOW_STOCK_THRESHOLD ? 'class="low-stock"' : ''}>${currentQty} ${isFullyVerified ? '<span class="verified-label">✅</span>' : ''}</td><td>${salePrice > 0 ? salePrice.toLocaleString() + ' Ks' + (isOverride?' *':'') : 'N/A'}</td><td>M:${item.mainQty}, H:${item.homeQty}, S:${item.shopQty}</td>`;
        tableBody.appendChild(row);
      });
      document.getElementById('combined-unverified-status').textContent = `Unverified Items: ${sortedItems.filter(item => !((item.mainQty === 0 || verifiedItems.mainStoreItems.has(item.code)) && (item.homeQty === 0 || verifiedItems.homeStoreItems.has(item.code))  && (item.shopQty === 0 || verifiedItems.shopStoreItems.has(item.code)))).length}`;
      updatePaginationControls(storeKey, tabId, currentPage[storeKey], totalPages, filteredItems.length);
    });
  } else {
    getData(storeKey).then(rawItems => {
      let items = rawItems.map(migrateItemShopMarkers);
      const searchValue = document.getElementById(`${storeKey.split('Store')[0]}-search-bar`).value.toLowerCase();
      const tableBody = document.getElementById(`${storeKey.split('Store')[0]}-items-table-body`);
      const table = document.getElementById(`${storeKey.split('Store')[0]}-items-table`);
      document.getElementById(`${storeKey.split('Store')[0]}-item-count`).textContent = items.length;
      
      table.classList.toggle('ground-check-active', groundCheckMode[storeKey]);

      filterStates[storeKey].lowStock = document.getElementById(`${storeKey.split('Store')[0]}-low-stock-filter`).checked;
      filterStates[storeKey].unverified = document.getElementById(`${storeKey.split('Store')[0]}-unverified-filter`).checked;
      VALID_CATEGORIES.forEach(category => filterStates[storeKey].category[category] = document.getElementById(`${storeKey.split('Store')[0]}-category-${category}-filter`)?.checked || false);

      let sortedItems = items.sort((a, b) => {
          if (groundCheckMode[storeKey]) return a.code.localeCompare(b.code, undefined, { numeric: true });
          const timeA = a.history?.length > 0 ? new Date(a.history[0].timestamp || a.history[0].date || 0).getTime() : 0;
          const timeB = b.history?.length > 0 ? new Date(b.history[0].timestamp || b.history[0].date || 0).getTime() : 0;
          return timeB - timeA;
      });

      const selectedCategories = VALID_CATEGORIES.filter(c => filterStates[storeKey].category[c]);
      let filteredItems = sortedItems.filter(item =>
        (item.name.toLowerCase().includes(searchValue) || item.code.toLowerCase().includes(searchValue) || (item.shopMarkers && item.shopMarkers.some(m => m.toLowerCase().includes(searchValue)))) &&
        (selectedCategories.length === 0 || selectedCategories.includes(item.category)) &&
        (!filterStates[storeKey].lowStock || (item.qtyIn - item.qtyOut) < LOW_STOCK_THRESHOLD) &&
        (!filterStates[storeKey].unverified || !verifiedItems[storeKey].has(item.code))
      );

      if (!currentPage[storeKey]) currentPage[storeKey] = 1;
      const totalPages = Math.ceil(filteredItems.length / ITEMS_PER_PAGE);
      const startIndex = (currentPage[storeKey] - 1) * ITEMS_PER_PAGE;
      const paginatedItems = filteredItems.slice(startIndex, Math.min(startIndex + ITEMS_PER_PAGE, filteredItems.length));
      
      tableBody.innerHTML = '';
      paginatedItems.forEach((item, index) => {
        const currentQty = item.qtyIn - item.qtyOut;
        const isVerified = verifiedItems[storeKey].has(item.code);
        const { salePrice, isOverride } = calculateSalePrice(item);
        
              const row = document.createElement('tr');
      row.className = `item-row ${index % 2 === 0 ? 'even' : 'odd'} ${groundCheckMode[storeKey] ? (isVerified ? 'verified' : 'unverified') : ''}`;
      
      const deleteBtnHtml = window.currentUserRole === 'user' ? '' : `<button class="delete-btn" onclick="deleteItem('${storeKey}', '${item.code}', '${tabId}')">🗑️</button>`;

      row.innerHTML = `
        <td class="show-in-ground-check">${startIndex + index + 1}</td>
        <td>${item.name}</td><td>${item.code}</td><td>${(item.shopMarkers || []).join('_')}</td><td class="hide-in-ground-check">${item.category}</td>
        <td ${currentQty < LOW_STOCK_THRESHOLD ? 'class="low-stock"' : ''}>${currentQty} ${groundCheckMode[storeKey] ? (isVerified ? `<span class="verified-label" style="cursor:pointer;" title="Untick လုပ်မည်" onclick="verifyItem('${storeKey}', '${item.code}')">✅</span>` : `<input type="checkbox" onchange="verifyItem('${storeKey}', '${item.code}')">`) : ''}</td>

        <td>${salePrice > 0 ? salePrice.toLocaleString() + ' Ks' + (isOverride?' *':'') : 'N/A'}</td>
        <td class="hide-in-ground-check">
          <button class="edit-btn" onclick="editItem('${storeKey}', '${item.code}', '${tabId}')">✏️</button>
          ${deleteBtnHtml} 
        </td>
      `;

        row.onclick = (e) => { if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && !groundCheckMode[storeKey]) toggleHistory(`${storeKey}-${item.code}`); };
        tableBody.appendChild(row);
        
                const historyRow = document.createElement('tr'); 
        historyRow.classList.add('history-row'); 
        historyRow.id = `history-${storeKey}-${item.code}`;

        const sortedHistory = (item.history || []).slice().sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));

        historyRow.innerHTML = `<td colspan="8"><table><thead><tr><th>Date</th><th>Qty In</th><th>Qty Out</th><th>Note</th></tr></thead><tbody>${(sortedHistory.length > 0) ? sortedHistory.slice(0, HISTORY_LIMIT).map(h => `<tr><td>${h.date}</td>
<td>${h.qtyIn}</td><td>${h.qtyOut}</td><td>${h.note || ''}</td></tr>`).join('') : `<tr><td colspan="4">No history</td></tr>`}</tbody></table></td>`;
        
        tableBody.appendChild(historyRow);
      });

      let groundCheckStatus = document.getElementById(`${storeKey.split('Store')[0]}-ground-check-status`);
      if(!groundCheckStatus && document.querySelector(`#${storeKey.split('Store')[0]}-store .filter-container`)) {
          groundCheckStatus = document.createElement('div'); groundCheckStatus.id = `${storeKey.split('Store')[0]}-ground-check-status`; groundCheckStatus.className = 'ground-check-status';
          const container = document.querySelector(`#${storeKey.split('Store')[0]}-store`);
          container.insertBefore(groundCheckStatus, container.querySelector('.scrollable-table-container'));
      }
      if(groundCheckStatus) groundCheckStatus.textContent = `Unverified Items: ${sortedItems.filter(item => !verifiedItems[storeKey].has(item.code)).length}`;
      updatePaginationControls(storeKey, tabId, currentPage[storeKey], totalPages, filteredItems.length);
    });
  }
}

function updateHistoryPaginationControls(storeKey, tableId, current, totalPages, totalItems) {
  let paginationDiv = document.getElementById(`${tableId}-pagination`);
  if(!paginationDiv) { paginationDiv = document.createElement('div'); paginationDiv.id = `${tableId}-pagination`; paginationDiv.className = 'pagination'; document.getElementById(`${tableId}-table-body`).parentElement.parentElement.insertAdjacentElement('afterend', paginationDiv); }
  paginationDiv.innerHTML = ''; if (totalPages <= 1) return;
  const prevButton = document.createElement('button'); prevButton.textContent = 'Previous'; prevButton.disabled = current === 1;
  prevButton.onclick = () => { if (current > 1) { currentPage[storeKey]--; tableId === 'add-history' ? loadAddHistory() : loadItemOutHistory(); } };
  const nextButton = document.createElement('button'); nextButton.textContent = 'Next'; nextButton.disabled = current === totalPages;
  nextButton.onclick = () => { if (current < totalPages) { currentPage[storeKey]++; tableId === 'add-history' ? loadAddHistory() : loadItemOutHistory(); } };
  const pageInfo = document.createElement('span'); pageInfo.textContent = ` Page ${current} of ${totalPages} (${totalItems} items) `;
  paginationDiv.appendChild(prevButton); paginationDiv.appendChild(pageInfo); paginationDiv.appendChild(nextButton);
}

function updatePaginationControls(storeKey, tabId, current, totalPages, totalItems) {
  let paginationDiv = document.getElementById(`${storeKey.split('Store')[0]}-pagination`);
  if(!paginationDiv) { paginationDiv = document.createElement('div'); paginationDiv.id = `${storeKey.split('Store')[0]}-pagination`; paginationDiv.className = 'pagination'; document.getElementById(`${storeKey.split('Store')[0]}-items-table-body`).closest('.scrollable-table-container').after(paginationDiv); }
  paginationDiv.innerHTML = ''; if (totalPages <= 1) return;
  const prevButton = document.createElement('button'); prevButton.textContent = 'Previous'; prevButton.disabled = current === 1;
  prevButton.onclick = () => { if (current > 1) { currentPage[storeKey]--; loadItemsTable(storeKey, tabId); } };
  const nextButton = document.createElement('button'); nextButton.textContent = 'Next'; nextButton.disabled = current === totalPages;
  nextButton.onclick = () => { if (current < totalPages) { currentPage[storeKey]++; loadItemsTable(storeKey, tabId); } };
  const pageInfo = document.createElement('span'); pageInfo.textContent = ` Page ${current} of ${totalPages} (${totalItems} items) `;
  paginationDiv.appendChild(prevButton); paginationDiv.appendChild(pageInfo); paginationDiv.appendChild(nextButton);
}


// --- GROUND CHECK FUNCTIONS (CLOUD SYNCED) ---
function toggleGroundCheckMode(storeKey) {
  groundCheckMode[storeKey] = !groundCheckMode[storeKey];
  document.querySelector(`#${storeKey.split('Store')[0]}-ground-check-btn`).classList.toggle('active', groundCheckMode[storeKey]);
  loadItemsTable(storeKey, storeKey.split('Store')[0] + '-store');
}

async function verifyItem(storeKey, code) {
  if (!verifiedItems[storeKey]) verifiedItems[storeKey] = new Set();
  
  if (verifiedItems[storeKey].has(code)) {
      verifiedItems[storeKey].delete(code);
  } else {
      verifiedItems[storeKey].add(code);
  }
  
  loadItemsTable(storeKey, storeKey.split('Store')[0] + '-store');

  try {
      await appDb.collection('systemSettings').doc('verifiedItems').set({
          mainStoreItems: Array.from(verifiedItems.mainStoreItems),
          homeStoreItems: Array.from(verifiedItems.homeStoreItems),
          shopStoreItems: Array.from(verifiedItems.shopStoreItems)
      }, { merge: true });
  } catch (error) {
      console.error("Error saving verified items to cloud:", error);
  }
}

function loadVerifiedItems() {
  appDb.collection('systemSettings').doc('verifiedItems').onSnapshot(doc => {
    if (doc.exists) {
      const saved = doc.data();
      verifiedItems.mainStoreItems = new Set(saved.mainStoreItems || []);
      verifiedItems.homeStoreItems = new Set(saved.homeStoreItems || []);
      verifiedItems.shopStoreItems = new Set(saved.shopStoreItems || []);
    } else {
      verifiedItems.mainStoreItems = new Set();
      verifiedItems.homeStoreItems = new Set();
      verifiedItems.shopStoreItems = new Set();
    }
    refreshCurrentView(); 
  }, error => {
    console.error("Error syncing verified items:", error);
  });
}

async function unverifyAllItems() {
  if (!confirm(`Are you sure you want to unverify ALL items?`)) return;
  
  verifiedItems.mainStoreItems.clear(); 
  verifiedItems.homeStoreItems.clear(); 
  verifiedItems.shopStoreItems.clear();
  
  try {
      showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
      await appDb.collection('systemSettings').doc('verifiedItems').set({
          mainStoreItems: [], 
          homeStoreItems: [], 
          shopStoreItems: []
      });
      showSyncStatus('synced');
      refreshCurrentView();
      showNotification(`Successfully unverified all items.`, 'success');
  } catch(error) {
      console.error("Error unverifying items:", error);
      showSyncStatus('pending');
      showNotification(`Error: Could not unverify items on cloud.`, 'error');
  }
}

function toggleHistory(id) {
  const historyRow = document.getElementById(`history-${id}`);
  if (currentHistoryId && currentHistoryId !== id) document.getElementById(`history-${currentHistoryId}`)?.classList.remove('active');
  if(historyRow) { historyRow.classList.toggle('active'); currentHistoryId = historyRow.classList.contains('active') ? id : null; }
}

function editItem(storeKey, code, tabId) {
    const item = appData[storeKey].find(i => i.code === code);
    if (!item) { showNotification('Item not found!', 'error'); return; }
    currentEditItem = JSON.parse(JSON.stringify(item)); currentEditStoreKey = storeKey; currentEditTabId = tabId;
    document.getElementById('edit-item-name').value = item.name;
    document.getElementById('edit-item-code').value = item.code;
    migrateItemShopMarkers(item);
    document.getElementById('edit-additional-markers-container').innerHTML = ''; 
    document.getElementById('edit-shop-marker').value = item.shopMarkers[0] || '';
    if (item.shopMarkers.length > 1) {
        item.shopMarkers.slice(1).forEach(marker => {
            const newRow = document.createElement('div'); newRow.className = 'marker-input-row';
            newRow.innerHTML = `<input type="text" class="additional-shop-marker" value="${marker}" oninput="validateShopMarkerInput(this)"><button type="button" class="marker-remove-btn">-</button>`;
            document.getElementById('edit-additional-markers-container').appendChild(newRow);
        });
    }
    document.getElementById('edit-item-category').value = item.category;
    document.getElementById('edit-qty-in').value = item.qtyIn;
    document.getElementById('edit-sale-price-override').value = (item.salePriceMarkupOverride !== null && item.salePriceMarkupOverride !== undefined) ? item.salePriceMarkupOverride : '';
    document.getElementById('edit-current-qty').value = `${item.qtyIn - item.qtyOut} (${item.qtyIn} in - ${item.qtyOut} out)`;
    document.getElementById('edit-store-info').value = storeKey.replace('StoreItems', ' Store');
    document.getElementById('edit-code-reminder').style.display = 'none';
    document.getElementById('edit-item-modal').classList.add('visible');
    document.getElementById('edit-item-code').addEventListener('input', checkEditDuplicateCode);
}

function checkEditDuplicateCode() {
  const code = document.getElementById('edit-item-code').value;
  const reminder = document.getElementById('edit-code-reminder');
  if (!code || code === currentEditItem.code) { reminder.style.display = 'none'; return; }
  const isDuplicate = [...appData.mainStoreItems, ...appData.homeStoreItems, ...appData.shopStoreItems].some(item => item.code === code);
  reminder.style.display = isDuplicate ? 'block' : 'none';
}

function saveEditItem() {
  if (!validateShopMarkerInput(document.getElementById('edit-shop-marker'))) return;
  const name = document.getElementById('edit-item-name').value.trim();
  const newCode = document.getElementById('edit-item-code').value.trim();
  const shopMarkers = [document.getElementById('edit-shop-marker').value.trim()];
  document.querySelectorAll('#edit-additional-markers-container .additional-shop-marker').forEach(input => { if (input.value.trim()) shopMarkers.push(input.value.trim()); });
  const category = document.getElementById('edit-item-category').value;
  const qtyIn = parseInt(document.getElementById('edit-qty-in').value);
  const markupOverrideValue = document.getElementById('edit-sale-price-override').value;
  const salePriceMarkupOverride = markupOverrideValue === '' ? null : parseFloat(markupOverrideValue);

  if (newCode !== currentEditItem.code && [...appData.mainStoreItems, ...appData.homeStoreItems, ...appData.shopStoreItems].some(item => item.code === newCode)) {
      showNotification('This code already exists!', 'error'); return;
  }
  performEditSave(name, newCode, shopMarkers, category, qtyIn, salePriceMarkupOverride);
}

function closeEditModal() {
  document.getElementById('edit-item-modal').classList.remove('visible');
  document.getElementById('edit-item-form').reset();
  document.getElementById('edit-additional-markers-container').innerHTML = '';
  document.getElementById('edit-code-reminder').style.display = 'none';
  currentEditItem = null; currentEditStoreKey = null; currentEditTabId = null;
}

function showZeroStockModal() {
  const zeroStockItems = [...appData.mainStoreItems.map(i=>({...i, store:'Main Store'})), ...appData.homeStoreItems.map(i=>({...i, store:'Home Store'})), ...appData.shopStoreItems.map(i=>({...i, store:'Shop Store'}))].filter(i => i.qtyIn - i.qtyOut <= 0);
  if (zeroStockItems.length > 0) {
    const container = document.getElementById('zero-stock-list'); container.innerHTML = '';
    zeroStockItems.forEach(item => {
      const itemDiv = document.createElement('div'); itemDiv.className = 'zero-stock-item';
      itemDiv.innerHTML = `<div class="zero-stock-item-name">${item.name}</div><div class="zero-stock-item-code">${item.code}</div><div class="zero-stock-item-store">${item.store}</div><div class="zero-stock-item-qty">Qty: ${item.qtyIn - item.qtyOut}</div>`;
      container.appendChild(itemDiv);
    });
    document.getElementById('zero-stock-modal').classList.add('visible');
  } else showNotification('No zero stock items found.', 'info');
}

function closeZeroStockModal() { document.getElementById('zero-stock-modal').classList.remove('visible'); }
function removeAllZeroStockItems() {
  if (confirm('Are you sure you want to remove all zero stock items? This action cannot be undone.')) {
    closeZeroStockModal(); checkAndRemoveZeroStock(true);
  }
}

function showVerificationStatus() {
  const mainTotal = appData.mainStoreItems.length, homeTotal = appData.homeStoreItems.length, shopTotal = appData.shopStoreItems.length;
  const totalItems = mainTotal + homeTotal + shopTotal;
  const totalVerified = verifiedItems.mainStoreItems.size + verifiedItems.homeStoreItems.size + verifiedItems.shopStoreItems.size;
  alert(`Verification Status:\nMain: ${verifiedItems.mainStoreItems.size}/${mainTotal}\nHome: ${verifiedItems.homeStoreItems.size}/${homeTotal}\nShop: ${verifiedItems.shopStoreItems.size}/${shopTotal}\n\nTotal: ${totalVerified}/${totalItems} (${Math.round(totalVerified / totalItems * 100)}%)`);
}

function updateStorageStatus() {
  const size = JSON.stringify(appData).length;
  const localSizeKB = (size / 1024).toFixed(2);
  
  const statusElement = document.getElementById('storage-status');
  if (statusElement) {
      statusElement.innerHTML = `<strong>App Memory Size:</strong> ${localSizeKB} KB <br><strong>Cloud Sync Status:</strong> Active`;
  }
}

function showDetailedStorageInfo() {
  let message = `Store Breakdown:\n\n`;
  ['mainStoreItems', 'homeStoreItems', 'shopStoreItems', 'addHistory', 'itemOutHistory', 'salesHistory'].forEach(store => {
      message += `• ${store.replace('StoreItems',' Store').replace('History',' History')}: ${appData[store].length} items\n`;
  });
  alert(message);
}

function exportWithFilters() {
  const storeKey = document.getElementById('export-store-select').value;
  const storeName = document.getElementById('export-store-select').selectedOptions[0].text;
  const selectedCategories = Array.from(document.querySelectorAll('.cat-export-checkbox:checked')).map(cb => cb.value);
  if (selectedCategories.length === 0) return showNotification('Select at least one category.', 'warning');
  
  const filteredItems = (appData[storeKey]||[]).map(migrateItemShopMarkers).filter(item => selectedCategories.includes(item.category)).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  if (filteredItems.length === 0) return showNotification(`No items found.`, 'info');

  const titleRow = [storeName, '', selectedCategories.length > 1 ? 'Multiple-Categories' : selectedCategories[0], '', '', '', '', new Date().toLocaleDateString()];
  const headers = ['စဉ်', 'ပစ္စည်းအမည်', 'ကုဒ်', 'ဆိုင်အမှတ်အသား', 'ကွန်ပျူတာလက်ကျန်', 'Base Price (Ks)', 'Sale Price (Ks)', 'မြေပြင်လက်ကျန်'];
  const csvData = filteredItems.map((item, index) => {
      const { salePrice } = calculateSalePrice(item);
      const { basePrice } = decodeShopMarker(item.shopMarkers[0]);
      return [ index + 1, item.name, item.code, (item.shopMarkers || []).join('_'), item.qtyIn - item.qtyOut, basePrice > 0 ? basePrice : 'N/A', salePrice > 0 ? salePrice : 'N/A', '' ];
  });

  const csv = [titleRow, headers, ...csvData].map(row => row.join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
  link.download = `${storeName.replace(/ /g, '_')}_Export_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

function toggleAllCategories(source) { document.querySelectorAll('.cat-export-checkbox').forEach(cb => cb.checked = source.checked); }

function updateOnlineStatus() {
  const statusElement = document.getElementById('online-status');
  const isOfflineMode = !navigator.onLine; 
  
  if (!isOfflineMode) { 
      statusElement.textContent = 'Online'; 
      statusElement.classList.remove('offline'); 
  } else { 
      statusElement.textContent = 'Offline'; 
      statusElement.classList.add('offline'); 
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

function toggleFiltersVisibility(toggleBtn) {
  const filterContainer = toggleBtn.closest('.tab-content').querySelector('.filter-container');
  if (!filterContainer) return;
  const isCollapsed = filterContainer.classList.toggle('collapsed');
  toggleBtn.textContent = isCollapsed ? '▶' : '▼';
  if (isCollapsed) {
    filterContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    refreshCurrentView();
  }
}


// သင့်ရဲ့ Google Apps Script URL 
const GAS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwq8aZiwpuqJmKjOVifab_EOuTXbj-IjJsCUohOgD0ScS2KnK5VNiFfGZ1RUFqkaNyzqA/exec";
// 🔒 လုံခြုံရေးအတွက် Secret Key
const BACKUP_SECRET_KEY = "LILI_BACKUP_SECRET_2026"; 

function runDailyDriveBackup() {
    const todayDate = new Date().toDateString();
    const lastBackupDate = localStorage.getItem('lastDriveBackupDate');

    if (lastBackupDate !== todayDate) {
        console.log("Starting background backup to Google Drive...");
        
        setTimeout(() => {
            // 🌟 UX: Backup စတင်နေပြီဖြစ်ကြောင်း Processing Status အရင်ပြမည် (၁၀ စက္ကန့်ကြာ ပေါ်နေမည်)
            if (typeof showNotification === 'function') {
                showNotification('🔄 Google Drive သို့ Auto Backup စတင်သိမ်းဆည်းနေပါသည်... ခဏစောင့်ပါ', 'info', 10000);
            }

            try {
                const dataToExport = {
                    mainStoreItems: appData.mainStoreItems || [],
                    homeStoreItems: appData.homeStoreItems || [],
                    shopStoreItems: appData.shopStoreItems || [],
                    addHistory: appData.addHistory || [],
                    itemOutHistory: appData.itemOutHistory || [],
                    salesHistory: appData.salesHistory || []
                };

                const payload = {
                    secretKey: BACKUP_SECRET_KEY, 
                    fileName: `lili_backup_${new Date().toISOString().slice(0, 10)}.json`,
                    backupData: dataToExport
                };

                fetch(GAS_WEB_APP_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload)
                })
                .then(response => response.json())
                .then(result => {
                    if (result.status === 'success') {
                        localStorage.setItem('lastDriveBackupDate', todayDate);
                        console.log("Cloud Backup Successful! URL:", result.url);
                        
                        // 🌟 UX: အောင်မြင်သွားရင် Success Notification ပြောင်းပြမည် (၅ စက္ကန့်ကြာ ပေါ်နေမည်)
                        if (typeof showNotification === 'function') {
                            showNotification('✅ ယနေ့အတွက် Data များကို Google Drive သို့ Auto Backup သိမ်းဆည်းပြီးပါပြီ။', 'success', 5000);
                        }
                    } else {
                        console.error("Backup Failed:", result.message);
                        // 🌟 UX: မအောင်မြင်ခဲ့ရင် Error Message ပြမည်
                        if (typeof showNotification === 'function') {
                            showNotification('❌ Auto Backup မအောင်မြင်ပါ။ Data များလွန်းနေနိုင်ပါသည်။', 'error', 5000);
                        }
                    }
                })
                .catch(err => {
                    console.error("Backup fetch error:", err);
                    if (typeof showNotification === 'function') {
                        showNotification('❌ အင်တာနက်ချိတ်ဆက်မှု အားနည်းနေသဖြင့် Backup မအောင်မြင်ပါ။', 'error', 5000);
                    }
                });

            } catch (error) {
                console.error("Backup process error:", error);
            }
        }, 10000); // App ပွင့်ပြီး ၁၀ စက္ကန့်အကြာမှာ စလုပ်မည်
    }
}

function forceManualBackup() {
    // 🌟 ပို့နေကြောင်း Loading အရင်ပြမည်
    if (typeof showNotification === 'function') {
        showNotification('🔄 Google Drive သို့ Backup စတင်ပို့ဆောင်နေပါသည်... ခဏစောင့်ပါ', 'info', 10000);
    }

    try {
        const dataToExport = {
            mainStoreItems: appData.mainStoreItems || [],
            homeStoreItems: appData.homeStoreItems || [],
            shopStoreItems: appData.shopStoreItems || [],
            addHistory: appData.addHistory || [],
            itemOutHistory: appData.itemOutHistory || [],
            salesHistory: appData.salesHistory || []
        };

        const payload = {
            secretKey: BACKUP_SECRET_KEY, // Auto Backup မှာသုံးတဲ့ Key အတိုင်းပဲ သုံးမည်
            fileName: `lili_manual_backup_${new Date().toISOString().slice(0, 10)}.json`,
            backupData: dataToExport
        };

        fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        })
        .then(response => response.json())
        .then(result => {
            if (result.status === 'success') {
                console.log("Manual Backup Successful! URL:", result.url);
                if (typeof showNotification === 'function') {
                    showNotification('✅ Manual Backup အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။', 'success');
                }
            } else {
                console.error("Backup Failed:", result.message);
                if (typeof showNotification === 'function') {
                    showNotification('❌ Backup မအောင်မြင်ပါ။ Error: ' + result.message, 'error');
                }
            }
        })
        .catch(err => {
            console.error("Backup fetch error:", err);
            if (typeof showNotification === 'function') {
                showNotification('❌ အင်တာနက်ချိတ်ဆက်မှု အားနည်းနေပါသည်။', 'error');
            }
        });

    } catch (error) {
        console.error("Backup process error:", error);
    }
}



function runDailyCleanupOnStartup() {
    const lastCleanupDate = localStorage.getItem('lastCleanupDate');
    const todayDate = new Date().toDateString(); 

    if (lastCleanupDate !== todayDate) {
        console.log("Checking zero stock items for today...");
        
        checkAndRemoveZeroStock(false, true).then(() => {
            localStorage.setItem('lastCleanupDate', todayDate);
            console.log("Zero stock items checked and cleaned.");
        }).catch(err => {
            console.error("Cleanup error:", err);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    updateOnlineStatus(); loadVerifiedItems(); setupMarkerButtons();
  
    const searchBars = document.querySelectorAll('input[type="text"][id$="-search-bar"]');
    searchBars.forEach(searchBar => {
        searchBar.addEventListener('focus', () => document.body.classList.add('keyboard-open'));
        searchBar.addEventListener('blur', () => document.body.classList.remove('keyboard-open'));
    });

    document.querySelectorAll('.category-checkbox, [id$="-unverified-filter"], [id$="-low-stock-filter"]').forEach(el => {
        el.addEventListener('change', refreshCurrentView);
    });

    const debouncedRefresh = debounce(refreshCurrentView, 300);
    document.querySelectorAll('input[type="text"][id$="-search-bar"]:not(#add-search-bar):not(#item-out-search-bar):not(#pos-search-bar)').forEach(searchBar => {
        searchBar.addEventListener('input', debouncedRefresh);
    });

    const addSearchBar = document.getElementById('add-search-bar');
    if (addSearchBar) {
        addSearchBar.removeAttribute('onkeyup');
        addSearchBar.addEventListener('input', debounce(searchAddItems, 300));
    }
    const itemOutSearchBar = document.getElementById('item-out-search-bar');
    if (itemOutSearchBar) {
        itemOutSearchBar.removeAttribute('onkeyup');
        itemOutSearchBar.addEventListener('input', debounce(searchItemOut, 300));
    }

    const addDestSelect = document.getElementById('add-destination');
    if (addDestSelect) addDestSelect.addEventListener('change', saveLastAddDestination);

    const categorySelect = document.getElementById('item-category');
    if (categorySelect) categorySelect.addEventListener('change', saveLastCategory);

    const outStoreSelect = document.getElementById('item-out-store');
    if (outStoreSelect) outStoreSelect.addEventListener('change', saveLastItemOutPreferences);

    const transferSelect = document.getElementById('item-out-transfer-to');
    if (transferSelect) transferSelect.addEventListener('change', saveLastItemOutPreferences);

    document.getElementById('clear-form-btn').addEventListener('click', () => {
        document.getElementById('add-item-form').reset();
        document.getElementById('additional-markers-container').innerHTML = '';
        toggleAutoCode();
        loadLastAddDestination();
        loadLastCategory();
    });

    const itemNameInput = document.getElementById('item-name');
    if (itemNameInput) {
        itemNameInput.addEventListener('input', function() {
            const codeInput = document.getElementById('item-code');
            const autoCheckbox = document.getElementById('auto-code-checkbox');
            const reminder = document.getElementById('code-reminder');

            if (this.value.trim().length > 0 && !codeInput.value && !autoCheckbox.checked) {
                if (!reminder.textContent.includes('Suggestion:')) {
                    const suggestedCode = generateUniqueCode();
                    reminder.textContent = `Suggestion: ${suggestedCode} (click to use)`;
                    reminder.style.display = 'block';
                    reminder.style.color = '#3498db';
                    reminder.style.cursor = 'pointer';
                    reminder.onclick = () => {
                        codeInput.value = suggestedCode;
                        checkDuplicateCode();
                    };
                }
            } else if (this.value.trim().length === 0 && !codeInput.value && !autoCheckbox.checked) {
                reminder.style.display = 'none';
                reminder.textContent = '';
            }
        });
    }
    
    const savedTheme = localStorage.getItem('theme') || 'warm-theme';
    document.body.className = savedTheme;
    
    const updateThemeStylesheet = (theme) => {
        const themeLink = document.getElementById('theme-stylesheet');
        if (!themeLink) return;
        if (theme === 'dark-theme') themeLink.href = 'dark-theme.css';
        else if (theme === 'modern-theme') themeLink.href = 'modern-theme.css';
        else themeLink.href = ''; 
    };
    
    const updateThemeIcon = (theme) => {
        const icon = document.querySelector('.theme-icon');
        if (!icon) return;
        if (theme === 'dark-theme') icon.textContent = '🌌'; 
        else if (theme === 'modern-theme') icon.textContent = '🌧️'; 
        else icon.textContent = '💡';
    }
    
    updateThemeStylesheet(savedTheme);
    updateThemeIcon(savedTheme);
    
    const themeIcon = document.querySelector('.theme-icon');
    if(themeIcon) {
        const toggleTheme = () => {
            const themes = ['warm-theme', 'dark-theme', 'modern-theme'];
            const newTheme = themes[(themes.indexOf(document.body.className) + 1) % 3];
            document.body.className = newTheme; 
            localStorage.setItem('theme', newTheme);
            updateThemeStylesheet(newTheme);
            updateThemeIcon(newTheme);
        };
        themeIcon.addEventListener('click', toggleTheme);
        
        themeIcon.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleTheme();
            }
        });
    }

    runDailyCleanupOnStartup();
runDailyDriveBackup();
    loadLastSyncStatus();

    window.onclick = function(event) {
        if (event.target === document.getElementById('zero-stock-modal')) closeZeroStockModal();
        if (event.target === document.getElementById('edit-item-modal')) closeEditModal();
        if (event.target === document.getElementById('pos-confirmation-modal')) closePosConfirmationModal();
        if (event.target === document.getElementById('receipt-modal')) closeReceiptModal();
        if (event.target === document.getElementById('checkout-modal')) closeCheckoutModal();
        if (event.target === document.getElementById('clear-data-modal')) document.getElementById('clear-data-modal').classList.remove('visible');
    }
});

function applyRoleBasedUI() {
    const isUser = window.currentUserRole === 'user';
    const isSuperadmin = window.currentUserRole === 'superadmin';

    const settingsTabBtn = document.querySelector('.tab-button[onclick="openTab(\'import-export\')"]');
    if (settingsTabBtn) {
        settingsTabBtn.style.display = 'inline-block';
    }

    const settingsCards = document.querySelectorAll('#import-export > div > div');
    if (settingsCards.length >= 4) {
        settingsCards[0].style.display = isUser ? 'none' : 'block'; 
        settingsCards[1].style.display = isUser ? 'none' : 'block'; 
        settingsCards[2].style.display = isUser ? 'none' : 'block'; 
    }

    // --- UPDATED: Hide Danger Zone for both User and Admin (Only Superadmin sees it) ---
    const dangerZone = document.querySelector('.danger-card') || document.querySelector('div[style*="border-top: 2px solid #e74c3c;"]');
    if (dangerZone) {
        dangerZone.style.display = isSuperadmin ? 'block' : 'none';
    }

    const financeToggleBtn = document.getElementById('toggle-finance-btn');
    if (financeToggleBtn) {
        financeToggleBtn.style.display = isUser ? 'none' : 'flex';
    }

    const createStaffForm = document.getElementById('create-staff-form');
    if (createStaffForm) {
        createStaffForm.style.display = isSuperadmin ? 'block' : 'none';
    }

    // --- NEW: Always show POS tab for the User role ---
    if (isUser) {
        const posTabButton = document.querySelector('.tab-button[onclick="openTab(\'pos-system\')"]');
        if (posTabButton) {
            posTabButton.style.display = 'inline-block'; // Forces the tab to remain visible
        }
    }
}
