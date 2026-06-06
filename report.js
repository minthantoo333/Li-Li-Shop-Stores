

// --- report.js (Analytics Dashboard Engine) ---

let dailySalesChartInstance = null;
let stockChartInstance = null; 

// Graph တွင် လက်ဖြင့်ရွှေ့လျှင် အောက်သို့ မျဉ်းစက်လေး (Vertical Line) ပေါ်စေမည့် Plugin
const verticalLinePlugin = {
    id: 'verticalLine',
    afterDraw: chart => {
        if (chart.tooltip?._active && chart.tooltip._active.length) {
            const activePoint = chart.tooltip._active[0];
            const ctx = chart.ctx;
            const x = activePoint.element.x;
            const topY = chart.scales.y.top;
            const bottomY = chart.scales.y.bottom;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, topY);
            ctx.lineTo(x, bottomY);
            ctx.lineWidth = 1;
            ctx.strokeStyle = 'rgba(231, 76, 60, 0.8)'; 
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.restore();
        }
    }
};

let deadStockData = { '3_To_6_Months': [], '6_To_9_Months': [], 'Over_9_Months': [] };
let isFinancialsVisible = false;

// 🌟 Local Database မလိုတော့ပါ။ Firebase မှ Sync လုပ်ထားသော appData ထဲမှသာ တိုက်ရိုက်စစ်ထုတ်မည် 🌟
async function fetchSalesDataFromLocalDB(monthPrefix) {
    return new Promise((resolve) => {
        const monthSales = (appData.salesHistory || []).filter(txn => txn.timestamp.startsWith(monthPrefix));
        resolve(monthSales);
    });
}

// 🌟 အစီရင်ခံစာ တွက်ချက်ခြင်း (Server ကို မသုံးဘဲ RAM ထဲမှ တွက်မည်) 🌟
async function loadReports() {
  showProgress('အစီရင်ခံစာ အချက်အလက်များ ရယူနေပါသည်...');
  try {
      const month = document.getElementById('report-month').value || new Date().toISOString().slice(0, 7);
      const selectedStoreForDS = document.getElementById('dead-stock-store').value;
      
      const allInventoryItems = [
          ...(appData.mainStoreItems || []).map(i => ({...i, store: 'mainStoreItems'})), 
          ...(appData.homeStoreItems || []).map(i => ({...i, store: 'homeStoreItems'})), 
          ...(appData.shopStoreItems || []).map(i => ({...i, store: 'shopStoreItems'}))
      ];
      
      const monthSales = await fetchSalesDataFromLocalDB(month);
      
      let totalRevenue = 0; let totalCost = 0; let totalItemsSold = 0;
      let itemSalesCount = {};

      const [yearStr, monthStr] = month.split('-');
      const daysInMonth = new Date(yearStr, monthStr, 0).getDate();
      const dailySalesData = new Array(daysInMonth).fill(0);
      const dailyLabels = Array.from({length: daysInMonth}, (_, i) => i + 1);

      monthSales.forEach(txn => {
          totalRevenue += txn.totalAmount;
          const saleDay = new Date(txn.timestamp).getDate();
          dailySalesData[saleDay - 1] += txn.totalAmount;
          
          txn.items.forEach(soldItem => {
              totalItemsSold += soldItem.quantity;
              const itemNameCode = `${soldItem.code} (${soldItem.name})`;
              itemSalesCount[itemNameCode] = (itemSalesCount[itemNameCode] || 0) + soldItem.quantity;

              const invItem = allInventoryItems.find(i => i.code === soldItem.code);
              let itemBasePrice = 0;
              if (invItem && invItem.shopMarkers && invItem.shopMarkers.length > 0) {
                  const { basePrice } = decodeShopMarker(invItem.shopMarkers[0]); 
                  if (basePrice) itemBasePrice = basePrice;
              }
              totalCost += (itemBasePrice * soldItem.quantity);
          });
      });

      const estimatedProfit = totalRevenue - totalCost;

      
      let totalAssetValue = 0;
      let storeRemaining = { main: 0, home: 0, shop: 0 };

      allInventoryItems.forEach(item => {
          const remainingQty = item.qtyIn - item.qtyOut;
          if (remainingQty > 0) {
              if (item.store === 'mainStoreItems') storeRemaining.main += remainingQty;
              else if (item.store === 'homeStoreItems') storeRemaining.home += remainingQty;
              else if (item.store === 'shopStoreItems') storeRemaining.shop += remainingQty;

              if (item.shopMarkers && item.shopMarkers.length > 0) {
                  const { basePrice } = decodeShopMarker(item.shopMarkers[0]);
                  if (basePrice) totalAssetValue += (basePrice * remainingQty);
              }
          }
      });

      // ==========================================
      // ၃။ Dead Stock တွက်ချက်ခြင်း (တိကျသော အပိုင်းခြားများဖြင့်)
      // ==========================================
      const now = new Date().getTime();
      const dayInMs = 24 * 60 * 60 * 1000;
      deadStockData = { '3_To_6_Months': [], '6_To_9_Months': [], 'Over_9_Months': [] };

      allInventoryItems.forEach(item => {
          if (selectedStoreForDS !== 'all' && item.store !== selectedStoreForDS) return;

          const remainingQty = item.qtyIn - item.qtyOut;
          if (remainingQty > 0) {
              let inactiveDays = 0;
              
              if (!item.history || item.history.length === 0) inactiveDays = 999; 
              else {
                  const outHistories = item.history.filter(h => h.qtyOut > 0);
                  if (outHistories.length === 0) {
                      const firstInDate = new Date(item.history[item.history.length - 1].timestamp || item.history[item.history.length - 1].date).getTime();
                      inactiveDays = (now - firstInDate) / dayInMs;
                  } else {
                      const lastOutDate = new Date(outHistories[0].timestamp || outHistories[0].date).getTime();
                      inactiveDays = (now - lastOutDate) / dayInMs;
                  }
              }

              const exportItem = { name: item.name, code: item.code, qty: remainingQty, days: Math.floor(inactiveDays), store: item.store };

              // တိကျသော အပိုင်းခြားများဖြင့် ခွဲခြားခြင်း
              if (inactiveDays >= 270) {
                  deadStockData['Over_9_Months'].push(exportItem);
              } else if (inactiveDays >= 180 && inactiveDays < 270) {
                  deadStockData['6_To_9_Months'].push(exportItem);
              } else if (inactiveDays >= 90 && inactiveDays < 180) {
                  deadStockData['3_To_6_Months'].push(exportItem);
              }
          }
      });

      // ==========================================
      // ၄။ UI သို့ Data များ ပြသခြင်း
      // ==========================================
      
      const revEl = document.getElementById('report-total-revenue'); 
      if(revEl) revEl.dataset.val = totalRevenue;
      
      const profEl = document.getElementById('report-total-profit'); 
      if(profEl) profEl.dataset.val = estimatedProfit;
      
      const assetEl = document.getElementById('report-asset-value'); 
      if(assetEl) assetEl.dataset.val = totalAssetValue;

      const soldEl = document.getElementById('report-total-sold'); 
      if(soldEl) soldEl.textContent = totalItemsSold + ' ခု';

      // Financials ပွင့်နေလျှင် ဂဏန်းကို အသစ်ပြန်ထည့်ပေးမည်
      if (isFinancialsVisible) {
          if(revEl) revEl.textContent = totalRevenue.toLocaleString() + ' Ks';
          if(profEl) profEl.textContent = estimatedProfit.toLocaleString() + ' Ks';
          if(assetEl) assetEl.textContent = totalAssetValue.toLocaleString() + ' Ks';
          if(revEl) revEl.style.letterSpacing = 'normal';
          if(profEl) profEl.style.letterSpacing = 'normal';
          if(assetEl) assetEl.style.letterSpacing = 'normal';
      } else {
          if(revEl) revEl.textContent = '******';
          if(profEl) profEl.textContent = '******';
          if(assetEl) assetEl.textContent = '******';
          if(revEl) revEl.style.letterSpacing = '2px';
          if(profEl) profEl.style.letterSpacing = '2px';
          if(assetEl) assetEl.style.letterSpacing = '2px';
      }

      // Best Sellers (Top 10)
      const bestSellers = Object.entries(itemSalesCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const bestSellersEl = document.getElementById('report-best-sellers');
      if (bestSellersEl) {
          bestSellersEl.innerHTML = bestSellers.length > 0
              ? bestSellers.map(b => `<li><strong>${b[0]}</strong>: ${b[1]} ခု</li>`).join('')
              : '<li>ယခုလ အရောင်းမရှိသေးပါ</li>';
      }

      // Dead Stock Numbers UI
      const ds3El = document.getElementById('ds-3m'); if(ds3El) ds3El.textContent = deadStockData['3_To_6_Months'].length;
      const ds6El = document.getElementById('ds-6m'); if(ds6El) ds6El.textContent = deadStockData['6_To_9_Months'].length;
      const ds9El = document.getElementById('ds-9m'); if(ds9El) ds9El.textContent = deadStockData['Over_9_Months'].length;


      // ==========================================
      // ၅။ Charts များ ဆွဲခြင်း (Mobile Responsive)
      // ==========================================
      
      // 5.1 Store Stock Pie Chart
      const ctxStock = document.getElementById('stockChart');
      if (ctxStock) {
          if (stockChartInstance) stockChartInstance.destroy();
          stockChartInstance = new Chart(ctxStock, {
              type: 'pie',
              data: {
                  labels: ['ဂိုထောင် (Main)', 'အိမ် (Home)', 'ဆိုင် (Shop)'],
                  datasets: [{
                      data: [storeRemaining.main, storeRemaining.home, storeRemaining.shop],
                      backgroundColor: ['#3498db', '#9b59b6', '#e67e22'],
                      hoverOffset: 4,
                      borderWidth: 1
                  }]
              },
              options: { 
                  responsive: true,
                  maintainAspectRatio: false, 
                  plugins: { legend: { position: 'bottom' } }
              }
          });
      }

      // 5.2 Daily Sales Line Chart
      const ctxDaily = document.getElementById('dailySalesChart');
      if (ctxDaily) {
          if (dailySalesChartInstance) dailySalesChartInstance.destroy();
          dailySalesChartInstance = new Chart(ctxDaily, {
              type: 'line',
              data: {
                  labels: dailyLabels,
                  datasets: [{
                      label: 'နေ့စဉ် အရောင်း',
                      data: dailySalesData,
                      borderColor: '#3498db',
                      backgroundColor: 'rgba(52, 152, 219, 0.2)',
                      borderWidth: 2,
                      fill: true,
                      tension: 0.4, 
                      pointRadius: 3,
                      pointHoverRadius: 6
                  }]
              },
              options: {
                  responsive: true,
                  maintainAspectRatio: false, 
                  interaction: {
                      mode: 'index',
                      intersect: false, 
                  },
                  plugins: { 
                      legend: { display: false },
                      tooltip: {
                          callbacks: {
                              label: function(context) { return 'ရောင်းရငွေ: ' + context.parsed.y.toLocaleString() + ' Ks'; }
                          }
                      }
                  },
                  scales: { 
                      y: { beginAtZero: true, ticks: { callback: function(value) { return value / 1000 + 'k'; } } },
                      x: { grid: { display: false } }
                  }
              },
              plugins: [verticalLinePlugin] 
          });
      }
      
  } catch (error) {
      console.error("Error generating report:", error);
      showNotification("အစီရင်ခံစာ တွက်ချက်ရာတွင် အမှားဖြစ်ပေါ်နေပါသည်။", "error");
  } finally {
      hideProgress();
filterAssetValue();
  }
}

// --- ငွေစာရင်းများကို အဖွင့်အပိတ် (Show/Hide) လုပ်မည့် Function ---
function toggleFinancials() {
    const btn = document.getElementById('toggle-finance-btn');
    const icon = document.getElementById('finance-icon');
    const revEl = document.getElementById('report-total-revenue');
    const profEl = document.getElementById('report-total-profit');
    const assetEl = document.getElementById('report-asset-value');

    if (!isFinancialsVisible) {
        verifyAdminPassword(() => {
            isFinancialsVisible = true;
            icon.textContent = '🙈';
            btn.innerHTML = '<span id="finance-icon">🙈</span> Hide';
            
            revEl.textContent = parseInt(revEl.dataset.val).toLocaleString() + ' Ks';
            profEl.textContent = parseInt(profEl.dataset.val).toLocaleString() + ' Ks';
            assetEl.textContent = parseInt(assetEl.dataset.val).toLocaleString() + ' Ks';
            
            revEl.style.letterSpacing = 'normal';
            profEl.style.letterSpacing = 'normal';
            assetEl.style.letterSpacing = 'normal';
        });

    } else {
        isFinancialsVisible = false;
        icon.textContent = '👁️';
        btn.innerHTML = '<span id="finance-icon">👁️</span> Show';
        
        revEl.textContent = '******';
        profEl.textContent = '******';
        assetEl.textContent = '******';
        
        revEl.style.letterSpacing = '2px';
        profEl.style.letterSpacing = '2px';
        assetEl.style.letterSpacing = '2px';
    }
}

// --- Dead Stock ကို Click နှိပ်၍ Export ထုတ်ပေးမည့် Function ---
function exportDeadStockData(period) {
    const dataList = deadStockData[period];
    const storeName = document.getElementById('dead-stock-store').selectedOptions[0].text;

    if (!dataList || dataList.length === 0) {
        const readablePeriod = period === 'Over_9_Months' ? '၉ လကျော်' : period.replace('_To_', ' မှ ').replace('_Months', ' လကြား');
        showNotification(`[${storeName}] အတွက် ${readablePeriod} Dead Stock မရှိပါ။`, 'info');
        return;
    }

    const headers = ['စဉ်', 'ဆိုင်/နေရာ', 'ပစ္စည်းအမည်', 'ကုဒ်', 'လက်ကျန်အရေအတွက်', 'ရောင်းမထွက်သော ရက်ပေါင်း'];
    const csvData = dataList.map((item, index) => [
        index + 1, item.store.replace('StoreItems',''), item.name, item.code, item.qty, item.days
    ]);

    const readablePeriod = period === 'Over_9_Months' ? 'Over 9 Months' : period.replace('_', ' ');
    const titleRow = [`Dead Stock Report (${readablePeriod}) - ${storeName}`, '', '', '', '', new Date().toLocaleDateString()];
    const csv = [titleRow, headers, ...csvData].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); 
    link.href = URL.createObjectURL(blob);
    link.download = `DeadStock_${storeName}_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
    
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link);
    
    showNotification('Export အောင်မြင်စွာ ထုတ်ယူပြီးပါပြီ။', 'success');
}

// --- Asset Value ကို Dropdown ဖြင့် စစ်ထုတ်ပေးမည့် သီးသန့် Function ---
function filterAssetValue() {
    const store = document.getElementById('asset-store-filter').value;
    let totalVal = 0;
    const storesToCheck = store === 'all' ? ['mainStoreItems', 'homeStoreItems', 'shopStoreItems'] : [store];

    storesToCheck.forEach(s => {
        (appData[s] || []).forEach(item => {
            const qty = item.qtyIn - item.qtyOut;
            if (qty > 0 && item.shopMarkers && item.shopMarkers.length > 0) {
                const { basePrice } = decodeShopMarker(item.shopMarkers[0]);
                if (basePrice) totalVal += (basePrice * qty);
            }
        });
    });

    const el = document.getElementById('report-asset-value');
    if (el) {
        el.dataset.val = totalVal;
        if (typeof isFinancialsVisible !== 'undefined' && isFinancialsVisible) {
            el.textContent = totalVal.toLocaleString() + ' Ks';
            el.style.letterSpacing = 'normal';
        } else {
            el.textContent = '******';
            el.style.letterSpacing = '2px';
        }
    }
}
