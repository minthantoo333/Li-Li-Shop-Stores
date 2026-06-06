// --- POS GLOBAL VARIABLES ---
let posCart = [];
let posSourceStore = 'shopStoreItems';
let currentTransactionData = null;

// Pagination Variables
let posCurrentPage = 1;
const POS_ITEMS_PER_PAGE = 12;

// --- CAMERA BARCODE SCANNER LOGIC ---
let html5QrcodeScanner;

function startCameraScanner() {
    document.getElementById('qr-reader').style.display = 'block';
    document.getElementById('stop-camera-scan-btn').style.display = 'block';
    document.getElementById('start-camera-scan-btn').style.display = 'none';

    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("qr-reader");
    }

    html5QrcodeScanner.start(
        { facingMode: "environment" }, // နောက်ကင်မရာကို သုံးရန်
        { fps: 10, qrbox: { width: 250, height: 100 } },
        (decodedText, decodedResult) => {
            // ဖတ်လို့ အောင်မြင်သွားရင်
            stopCameraScanner();
            document.getElementById('pos-search-bar').value = decodedText;
            handleBarcodeScan(decodedText);
        },
        (errorMessage) => {
            // ဖတ်နေဆဲ အမှားများ (လျစ်လျူရှုနိုင်ပါသည်)
        }
    ).catch((err) => {
        showNotification("Camera အသုံးပြုခွင့် မရပါ (သို့) Camera မရှိပါ။", "error");
        stopCameraScanner();
    });
}

function stopCameraScanner() {
    if (html5QrcodeScanner && html5QrcodeScanner.isScanning) {
        html5QrcodeScanner.stop().then(() => {
            document.getElementById('qr-reader').style.display = 'none';
            document.getElementById('stop-camera-scan-btn').style.display = 'none';
            document.getElementById('start-camera-scan-btn').style.display = 'block';
        });
    }
}


// --- PHYSICAL BARCODE SCANNER LOGIC (USB/Bluetooth) ---
let barcodeBuffer = '';
let barcodeTimeout = null;

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.id !== 'pos-search-bar') return;
    if (e.key === 'Enter') {
        if (barcodeBuffer.length > 0) {
            document.getElementById('pos-search-bar').value = barcodeBuffer;
            handleBarcodeScan(barcodeBuffer);
            barcodeBuffer = '';
        }
    } else if (e.key.length === 1) {
        barcodeBuffer += e.key;
        clearTimeout(barcodeTimeout);
        barcodeTimeout = setTimeout(() => { barcodeBuffer = ''; }, 100); 
    }
});

async function handleBarcodeScan(scannedCode) {
    const items = await getData(posSourceStore);
    const item = items.find(i => i.code.toLowerCase() === scannedCode.trim().toLowerCase());

    if (item) {
        const currentQty = item.qtyIn - item.qtyOut;
        if (currentQty > 0) {
            const { salePrice } = calculateSalePrice(migrateItemShopMarkers(item));
            addMultipleToCart(item.code, item.name, salePrice, 1, currentQty);
            showNotification(`Added ${item.name} to cart.`, 'success');
        } else {
            showNotification('Item is out of stock!', 'error');
        }
    } else {
        // မတွေ့ရင် ရိုးရိုး Search အနေနဲ့ အလုပ်လုပ်စေရန်
        posCurrentPage = 1;
        loadPosProducts();
        showNotification('Barcode not found. Searching...', 'info');
    }
}


// --- POS TAB VISIBILITY & SETUP ---
function togglePosTabVisibility(isVisible) {
    const posTabButton = document.querySelector('.tab-button[onclick="openTab(\'pos-system\')"]');
    if (posTabButton) posTabButton.style.display = isVisible ? '' : 'none';
    localStorage.setItem('posTabVisible', isVisible);
}
  
function loadPosTabVisibility() {
    const isVisible = localStorage.getItem('posTabVisible') !== 'false';
    const posTabButton = document.querySelector('.tab-button[onclick="openTab(\'pos-system\')"]');
    const toggle = document.getElementById('pos-tab-toggle');
    if (toggle) toggle.checked = isVisible;
    if (posTabButton) posTabButton.style.display = isVisible ? '' : 'none';
}

function toggleCartPanel() {
    document.querySelector('.pos-cart-panel').classList.toggle('visible');
}

function setupPosEventListeners() {
    const debouncedSearch = debounce(() => {
        posCurrentPage = 1;
        loadPosProducts();
    }, 300); 
    
    const searchBar = document.getElementById('pos-search-bar');
    if(searchBar) searchBar.addEventListener('keyup', debouncedSearch); 
    
    document.getElementById('pos-discount-input')?.addEventListener('input', updateCartSummary);
    document.getElementById('complete-sale-btn')?.addEventListener('click', proceedToCheckout);
    document.getElementById('floating-cart-btn')?.addEventListener('click', toggleCartPanel);
    
    // Camera Scan Buttons
    document.getElementById('start-camera-scan-btn')?.addEventListener('click', startCameraScanner);
    document.getElementById('stop-camera-scan-btn')?.addEventListener('click', stopCameraScanner);
}

// --- POS PRODUCTS & PAGINATION ---
async function getFilteredPosProducts(searchValue) {
    const items = await getData(posSourceStore);
    const itemsWithStatus = items.map(migrateItemShopMarkers).map(item => {
          const hasStock = (item.qtyIn - item.qtyOut) > 0;
          const recency = item.history?.length > 0 ? new Date(item.history[0].timestamp || item.history[0].date).getTime() : 0;
          return { ...item, recency, hasStock };
    });
  
    itemsWithStatus.sort((a, b) => {
      if (a.hasStock !== b.hasStock) return a.hasStock ? -1 : 1;
      return b.recency - a.recency;
    });
  
    if (!searchValue) return itemsWithStatus;
    return itemsWithStatus.filter(item => item.name.toLowerCase().includes(searchValue) || item.code.toLowerCase().includes(searchValue));
}
  
async function loadPosProducts() {
    const searchInput = document.getElementById('pos-search-bar');
    const searchValue = searchInput ? searchInput.value.toLowerCase() : '';
    try {
        const filteredItems = await getFilteredPosProducts(searchValue);
        renderPosGrid(filteredItems);
    } catch (error) {
        document.getElementById('pos-search-results').innerHTML = '<p>Error loading products.</p>';
    }
}

function renderPosGrid(filteredItems) {
    const resultsGrid = document.getElementById('pos-search-results');
    const paginationDiv = document.getElementById('pos-pagination');
    if (!resultsGrid || !paginationDiv) return;
    
    const totalItems = filteredItems.length;
    const totalPages = Math.ceil(totalItems / POS_ITEMS_PER_PAGE) || 1;
    
    if (posCurrentPage > totalPages) posCurrentPage = totalPages;
    if (posCurrentPage < 1) posCurrentPage = 1;

    const startIndex = (posCurrentPage - 1) * POS_ITEMS_PER_PAGE;
    const paginatedItems = filteredItems.slice(startIndex, startIndex + POS_ITEMS_PER_PAGE);

    const itemCountEl = document.getElementById('pos-item-count');
    if (itemCountEl) {
        itemCountEl.textContent = totalItems === 0 ? "No items found." : `Showing ${startIndex + 1}-${Math.min(startIndex + POS_ITEMS_PER_PAGE, totalItems)} of ${totalItems} items.`;
    }
    
    resultsGrid.innerHTML = '';
    if (paginatedItems.length === 0) { 
        resultsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align:center;">No products found.</p>'; 
        paginationDiv.innerHTML = '';
        return; 
    }
    
    paginatedItems.forEach(item => resultsGrid.appendChild(renderPosProductCard(item)));

    // Pagination UI
    paginationDiv.innerHTML = '';
    if (totalPages > 1) {
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '◀ Prev';
        prevBtn.style.padding = '8px 15px';
        prevBtn.disabled = posCurrentPage === 1;
        prevBtn.onclick = () => { posCurrentPage--; loadPosProducts(); };
        
        const pageInfo = document.createElement('span');
        pageInfo.textContent = ` Page ${posCurrentPage} of ${totalPages} `;
        pageInfo.style.alignSelf = 'center';
        pageInfo.style.fontWeight = 'bold';

        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next ▶';
        nextBtn.style.padding = '8px 15px';
        nextBtn.disabled = posCurrentPage === totalPages;
        nextBtn.onclick = () => { posCurrentPage++; loadPosProducts(); };

        paginationDiv.appendChild(prevBtn);
        paginationDiv.appendChild(pageInfo);
        paginationDiv.appendChild(nextBtn);
    }
}

function renderPosProductCard(item) {
    const card = document.createElement('div');
    card.className = 'pos-product-card';
    card.id = `pos-card-${item.code}`;
    const currentQty = item.qtyIn - item.qtyOut;
    if (currentQty <= 0) card.classList.add('out-of-stock');

    const { salePrice } = calculateSalePrice(item);
    if (currentQty > 0) card.onclick = () => showPosConfirmationModal(item.code);

    const icon = typeof getCategoryIcon === 'function' ? getCategoryIcon(item.category) : '📦';

    card.innerHTML = `
        <div class="pos-product-icon">${icon}</div>
        <div class="pos-product-name">${item.name}</div>
        <div class="pos-product-code">${item.code}</div>
        <div class="pos-product-price">${salePrice.toLocaleString()} Ks</div>
        <div class="pos-product-stock" id="pos-stock-${item.code}">Stock: ${currentQty}</div>
    `;
    return card;
}

// --- CART & MODAL FUNCTIONS ---
async function showPosConfirmationModal(code) {
    const modal = document.getElementById('pos-confirmation-modal');
    const items = await getData(posSourceStore);
    let item = items.find(i => i.code === code);
    if (!item) { showNotification('Item not found.', 'error'); return; }
    
    item = migrateItemShopMarkers(item);
    const currentQty = item.qtyIn - item.qtyOut;
    const { salePrice: defaultSalePrice } = calculateSalePrice(item);

    document.getElementById('confirmation-item-name').textContent = item.name;
    document.getElementById('confirmation-item-code').textContent = item.code;
    document.getElementById('confirmation-item-markers').textContent = item.shopMarkers.join(', ') || 'N/A';
    document.getElementById('confirmation-item-stock').textContent = currentQty;
    
    const qtyInput = document.getElementById('confirmation-item-qty');
    qtyInput.value = 1; qtyInput.max = currentQty;
    document.getElementById('confirmation-sale-price').value = defaultSalePrice;
    
    const addButton = document.getElementById('add-from-confirmation-btn');
    addButton.dataset.itemCode = item.code;
    addButton.dataset.itemName = item.name;
    addButton.dataset.maxQty = currentQty;

    validateConfirmationQty(); 
    modal.classList.add('visible');
}

function closePosConfirmationModal() {
    document.getElementById('pos-confirmation-modal').classList.remove('visible');
    document.getElementById('confirmation-qty-status').textContent = '';
}

function adjustConfirmationValue(type, amount) {
    let inputElement = document.getElementById(type === 'qty' ? 'confirmation-item-qty' : 'confirmation-sale-price');
    if (!inputElement) return;
    let newValue = (parseInt(inputElement.value, 10) || 0) + amount;
    if (newValue < (inputElement.min || 0)) newValue = parseInt(inputElement.min || 0);
    inputElement.value = newValue;
    if (type === 'qty') validateConfirmationQty();
}

function validateConfirmationQty() {
    const qtyInput = document.getElementById('confirmation-item-qty');
    const statusElement = document.getElementById('confirmation-qty-status');
    const confirmButton = document.getElementById('add-from-confirmation-btn');
    const currentQty = parseInt(qtyInput.value, 10);
    const maxQty = parseInt(qtyInput.max, 10);

    if (isNaN(currentQty) || currentQty < 1) {
        statusElement.textContent = 'Quantity must be at least 1.';
        confirmButton.disabled = true; return false;
    }
    if (currentQty > maxQty) {
        statusElement.textContent = `Exceeds available stock of ${maxQty}.`;
        confirmButton.disabled = true; return false;
    } 
    statusElement.textContent = '';
    confirmButton.disabled = false;
    return true;
}

async function addItemFromConfirmationModal() {
    if (!validateConfirmationQty()) return;
    const addButton = document.getElementById('add-from-confirmation-btn');
    const { itemCode, itemName, maxQty } = addButton.dataset;
    const customPrice = parseFloat(document.getElementById('confirmation-sale-price').value);
    const quantityToAdd = parseInt(document.getElementById('confirmation-item-qty').value, 10);
    
    if (isNaN(customPrice) || customPrice < 0) { showNotification('Please enter a valid price.', 'error'); return; }
    
    addMultipleToCart(itemCode, itemName, customPrice, quantityToAdd, parseInt(maxQty, 10));
    closePosConfirmationModal();
}

function addMultipleToCart(code, name, price, quantityToAdd, maxQty) {
    const existingItem = posCart.find(item => item.code === code);
    if (existingItem) {
        if (existingItem.quantity + quantityToAdd <= maxQty) existingItem.quantity += quantityToAdd;
        else { showNotification(`Cannot add. Only ${maxQty - existingItem.quantity} more available.`, 'warning'); return; }
    } else {
        posCart.push({ code, name, price, quantity: quantityToAdd, maxQty });
    }
    renderCart(); updatePosCardStock(code, maxQty);
}

function updatePosCardStock(code, maxQty) {
    const itemInCart = posCart.find(i => i.code === code);
    const remainingStock = maxQty - (itemInCart ? itemInCart.quantity : 0);
    const stockElement = document.getElementById(`pos-stock-${code}`);
    if (stockElement) stockElement.textContent = `Stock: ${remainingStock}`;
    const cardElement = document.getElementById(`pos-card-${code}`);
    if (cardElement) {
        if (remainingStock <= 0) {
            cardElement.classList.add('out-of-stock');
            cardElement.onclick = null;
        } else {
            cardElement.classList.remove('out-of-stock');
            cardElement.onclick = () => showPosConfirmationModal(code);
        }
    }
}

function renderCart() {
    const cartItemsDiv = document.getElementById('pos-cart-items');
    cartItemsDiv.innerHTML = '';
    if (posCart.length === 0) {
        cartItemsDiv.innerHTML = '<p class="pos-cart-empty">Cart is empty</p>';
    } else {
        posCart.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'pos-cart-item';
            itemDiv.innerHTML = `
                <div class="pos-cart-item-details">
                    <div class="pos-cart-item-name">${item.name}</div>
                    <div class="pos-cart-item-price">${item.quantity} x ${item.price.toLocaleString()} Ks</div>
                </div>
                <div class="pos-cart-item-qty">
                    <button class="qty-btn" onclick="updateCartItemQuantity('${item.code}', -1); event.stopPropagation();">-</button>
                    <span>${item.quantity}</span>
                    <button class="qty-btn" onclick="updateCartItemQuantity('${item.code}', 1); event.stopPropagation();">+</button>
                </div>
                <button class="pos-cart-item-remove" onclick="removeFromCart('${item.code}'); event.stopPropagation();">&times;</button>
            `;
            cartItemsDiv.appendChild(itemDiv);
        });
    }
    updateCartSummary();
}

function updateCartItemQuantity(code, change) {
    const item = posCart.find(i => i.code === code);
    if (item) {
        const newQuantity = item.quantity + change;
        if (newQuantity > 0 && newQuantity <= item.maxQty) item.quantity = newQuantity;
        else if (newQuantity > item.maxQty) showNotification(`Max stock is ${item.maxQty}.`, 'warning');
        else removeFromCart(code);
        updatePosCardStock(code, item.maxQty);
    }
    renderCart();
}

function removeFromCart(code) {
    const item = posCart.find(i => i.code === code);
    if(item) updatePosCardStock(code, item.maxQty);
    posCart = posCart.filter(i => i.code !== code);
    renderCart();
}

function updateCartSummary() {
    const subtotal = posCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discount = parseFloat(document.getElementById('pos-discount-input').value) || 0;
    const total = subtotal - discount;
    document.getElementById('pos-subtotal-amount').textContent = `${subtotal.toLocaleString()} Ks`;
    document.getElementById('pos-total-amount').textContent = `${total.toLocaleString()} Ks`;
    document.getElementById('floating-cart-badge').textContent = posCart.reduce((sum, item) => sum + item.quantity, 0);
}

function clearCart() { posCart = []; document.getElementById('pos-discount-input').value = '0'; renderCart(); }

function proceedToCheckout() {
    if (posCart.length === 0) { showNotification('Cart is empty.', 'error'); return; }
    const cartPanel = document.querySelector('.pos-cart-panel');
    if (cartPanel && cartPanel.classList.contains('visible')) cartPanel.classList.remove('visible');

    const subtotal = posCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discount = parseFloat(document.getElementById('pos-discount-input').value) || 0;
    
    currentTransactionData = {
        subtotal, discount, totalAmount: subtotal - discount,
        sourceStore: posSourceStore, items: posCart.map(item => ({...item}))
    };
    showCheckoutModal();
}

function showCheckoutModal() {
    if (!currentTransactionData) return;
    document.getElementById('checkout-subtotal').textContent = `${currentTransactionData.subtotal.toLocaleString()} Ks`;
    document.getElementById('checkout-discount').textContent = `${currentTransactionData.discount.toLocaleString()} Ks`;
    document.getElementById('checkout-total').textContent = `${currentTransactionData.totalAmount.toLocaleString()} Ks`;
    document.getElementById('cash-received-input').value = '';
    document.getElementById('customer-name-input').value = 'Walk-in Customer';
    calculateChange(); 
    document.getElementById('checkout-modal').classList.add('visible');
    document.getElementById('cash-received-input').focus();
}

function closeCheckoutModal() {
    document.getElementById('checkout-modal').classList.remove('visible');
    currentTransactionData = null; 
}

function calculateChange() {
    if (!currentTransactionData) return;
    const change = (parseFloat(document.getElementById('cash-received-input').value) || 0) - currentTransactionData.totalAmount;
    document.getElementById('change-due-display').textContent = `${change.toLocaleString()} Ks`;
}

// POS CHECKOUT DB SYNC
async function handleConfirmPayment() {
    if (!currentTransactionData) return;
    const cashReceived = parseFloat(document.getElementById('cash-received-input').value) || 0;

    if (cashReceived < currentTransactionData.totalAmount) {
        document.getElementById('checkout-status-message').textContent = 'Cash received is less than the total amount due.';
        return; 
    }
    
    document.getElementById('checkout-status-message').textContent = ''; 
    
    try {
        const batch = appDb.batch();
        const now = new Date();
        const txnId = `TXN-${now.getTime()}-${Math.floor(Math.random()*1000)}`;
        
        const finalTransaction = {
            ...currentTransactionData,
            id: txnId,
            timestamp: now.toISOString(),
            lastUpdatedAt: now.toISOString(),
            paymentMethod: document.getElementById('checkout-payment-method').value,
            customerName: document.getElementById('customer-name-input').value || 'Walk-in Customer',
            cashReceived: cashReceived,
            changeDue: cashReceived - currentTransactionData.totalAmount
        };

        for (const cartItem of finalTransaction.items) {
            const itemRef = appDb.collection(finalTransaction.sourceStore).doc(cartItem.code);
            const localItem = appData[finalTransaction.sourceStore].find(i => i.code === cartItem.code);
            
            const historyEntry = {
                date: now.toISOString().slice(0, 10), 
                timestamp: now.toISOString(),
                qtyIn: 0, 
                qtyOut: cartItem.quantity, 
                note: `Sold via POS (TXN: ${txnId})`
            };
            
            if(localItem) {
                if(!localItem.history) localItem.history = [];
                localItem.history.unshift(historyEntry);
                localItem.qtyOut += cartItem.quantity;
            }

            batch.update(itemRef, { 
                qtyOut: firebase.firestore.FieldValue.increment(cartItem.quantity), 
                history: firebase.firestore.FieldValue.arrayUnion(historyEntry) 
            });
        }
        
        const saleRef = appDb.collection('salesHistory').doc(txnId);
        batch.set(saleRef, finalTransaction);
        
        showSyncStatus(navigator.onLine ? 'syncing' : 'pending');
        batch.commit()
            .then(() => showSyncStatus('synced'))
            .catch(e => {
                console.error("Firebase sync error:", e);
                showSyncStatus('pending');
            });
        
        closeCheckoutModal();
        showReceiptModal(finalTransaction);
        clearCart();
        refreshCurrentView(); // UI Update from app.js
    } catch (error) {
        console.error('Sale failed:', error);
        showNotification('Error processing sale. Please check your connection.', 'error');
    }
}

// RECEIPT FUNCTIONS
function showReceiptModal(transaction) {
  currentTransactionData = transaction;
  document.getElementById('receipt-id').textContent = transaction.id;
  document.getElementById('receipt-date').textContent = new Date(transaction.timestamp).toLocaleString();
  document.getElementById('receipt-customer-name').textContent = transaction.customerName;

  const itemsBody = document.getElementById('receipt-items-body');
  itemsBody.innerHTML = ''; 
  transaction.items.forEach(item => {
    const itemRow = document.createElement('div');
    itemRow.className = 'receipt-item-row';
    itemRow.innerHTML = `
      <div class="item-col">${item.name}<div class="item-col-sub">(${item.quantity} x ${item.price.toLocaleString()})</div></div>
      <div class="total-col">${(item.price * item.quantity).toLocaleString()}</div>`;
    itemsBody.appendChild(itemRow);
  });

  document.getElementById('receipt-subtotal').textContent = `${transaction.subtotal.toLocaleString()} Ks`;
  document.getElementById('receipt-discount').textContent = `${transaction.discount.toLocaleString()} Ks`;
  document.getElementById('receipt-total').textContent = `${transaction.totalAmount.toLocaleString()} Ks`;
  document.getElementById('receipt-payment-method').textContent = transaction.paymentMethod;
  document.getElementById('receipt-cash-received').textContent = `${(transaction.cashReceived || 0).toLocaleString()} Ks`;
  document.getElementById('receipt-change').textContent = `${(transaction.changeDue || 0).toLocaleString()} Ks`;
  document.getElementById('receipt-modal').classList.add('visible');
}

function closeReceiptModal() { document.getElementById('receipt-modal').classList.remove('visible'); }
function printReceipt() { window.print(); }

async function loadSalesHistory() {
    const fromDate = document.getElementById('sales-history-from').value;
    const toDate = document.getElementById('sales-history-to').value;
    const tableBody = document.getElementById('sales-history-table-body');
    const summaryView = document.getElementById('sales-summary-view');
    
    let filteredHistory = (appData.salesHistory || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (fromDate) filteredHistory = filteredHistory.filter(t => t.timestamp.slice(0, 10) >= fromDate);
    if (toDate) filteredHistory = filteredHistory.filter(t => t.timestamp.slice(0, 10) <= toDate);
    
    tableBody.innerHTML = '';
    if (filteredHistory.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6">No sales found.</td></tr>';
        summaryView.innerHTML = ''; return;
    }

    let totalSales = 0;
    filteredHistory.forEach(txn => {
        totalSales += txn.totalAmount;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${new Date(txn.timestamp).toLocaleString()}</td>
            <td>${txn.id}</td>
            <td>${txn.items.reduce((sum, i) => sum + i.quantity, 0)}</td>
            <td>${txn.totalAmount.toLocaleString()} Ks</td>
            <td>${txn.paymentMethod}</td>
            <td><button class="preview-btn" onclick='showReceiptModal(${JSON.stringify(txn)})'>View</button></td>
        `;
        tableBody.appendChild(row);
    });
    summaryView.innerHTML = `<p><strong>Total Sales:</strong> ${totalSales.toLocaleString()} Ks</p><p><strong>Total Transactions:</strong> ${filteredHistory.length}</p>`;
}