// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyDkMC3KN5bsJ0_ROotIHVxGjWeQ71k9LG8",
  authDomain: "clothingshopinventory.firebaseapp.com",
  projectId: "clothingshopinventory",
  storageBucket: "clothingshopinventory.firebasestorage.app",
  messagingSenderId: "1091466103768",
  appId: "1:1091466103768:web:97f5a2c92b34d1b01f80ad",
  measurementId: "G-B8VP4D2HB7"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Cloud Firestore and Auth
const db = firebase.firestore();
const auth = firebase.auth(); 

// --- ENABLE OFFLINE PERSISTENCE ---
db.enablePersistence({ synchronizeTabs: true })
  .catch((err) => {
      if (err.code == 'failed-precondition') {
          console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
      } else if (err.code == 'unimplemented') {
          console.warn('The current browser does not support all of the features required to enable offline persistence.');
      }
  });


// --- AUTHENTICATION FUNCTIONS ---

function signInWithEmail(email, password) {
  const btn = document.getElementById('btn-login');
  if(btn) btn.disabled = true;

  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL) 
    .then(() => {
      return auth.signInWithEmailAndPassword(email, password);
    })
    .then((userCredential) => {
      showNotification(`Signed in as ${userCredential.user.email}`, 'success');
      if(btn) btn.disabled = false;
    })
    .catch((error) => {
      console.error("Sign-In Error:", error);
      const errorMsg = document.getElementById('login-error');
      if (errorMsg) {
          errorMsg.textContent = `Sign-in failed: ${error.message}`;
          errorMsg.style.display = 'block';
      }
      if(btn) btn.disabled = false;
    });
}

function createAccountWithEmail(email, password) {
  const btn = document.getElementById('btn-create-account');
  if(btn) btn.disabled = true;

  auth.createUserWithEmailAndPassword(email, password)
    .then((userCredential) => {
      showNotification(`Account created for ${userCredential.user.email}.`, 'success');
      alert('IMPORTANT: A new user has been created. Ensure security rules are updated.');
      if(btn) btn.disabled = false;
    })
    .catch((error) => {
      console.error("Create Account Error:", error);
      const errorMsg = document.getElementById('login-error');
      if (errorMsg) {
          errorMsg.textContent = `Account creation failed: ${error.message}`;
          errorMsg.style.display = 'block';
      }
      if(btn) btn.disabled = false;
    });
}

function signOut() {
  auth.signOut()
    .then(() => {
      const syncEl = document.getElementById('sync-status');
      if (syncEl) syncEl.style.display = 'none';
      showNotification('You have been signed out.', 'info');
    })
    .catch((error) => {
      console.error("Sign-Out Error:", error);
      showNotification('Error signing out.', 'error');
    });
}

// --- SETUP LISTENERS ON PAGE LOAD ---

document.addEventListener('DOMContentLoaded', () => {
    const emailInput = document.getElementById('login-email');
    const passwordInput = document.getElementById('login-password');
    const signInButton = document.getElementById('btn-login');
    const createButton = document.getElementById('btn-create-account');
    
    if (signInButton) {
        signInButton.addEventListener('click', () => {
            const email = emailInput.value;
            const password = passwordInput.value;
            if (email && password) {
                signInWithEmail(email, password);
            } else {
                document.getElementById('login-error').textContent = 'Please enter email and password.';
                document.getElementById('login-error').style.display = 'block';
            }
        });
    }

    if (createButton) {
        createButton.addEventListener('click', () => {
            const email = emailInput.value;
            const password = passwordInput.value;
            if (email && password) {
                createAccountWithEmail(email, password);
            } else {
                document.getElementById('login-error').textContent = 'Please enter email and password.';
                document.getElementById('login-error').style.display = 'block';
            }
        });
    }
});


// --- ROLE DETECTOR & INITIALIZATION CONTROL ---
window.currentUserRole = 'user'; 

auth.onAuthStateChanged(user => {
  if (user) {
    const currentUserEmail = user.email.toLowerCase().trim();

    // ၁။ Local Storage ထဲက Role ကို ချက်ချင်းယူမည် (Server ကို မစောင့်ပါ)
    window.currentUserRole = localStorage.getItem(`cachedRole_${currentUserEmail}`) || 'user';

    const authStatus = document.getElementById('settings-auth-status');
    if (authStatus) {
        authStatus.textContent = `Logged in as: ${user.email} (${window.currentUserRole} - Loading...)`;
    }
    
    // ၂။ Splash Screen ကို ချက်ချင်းဖျောက်ပြီး App ကို ဖွင့်ပေးလိုက်မည်
    if (typeof showAppContent === 'function') {
        showAppContent();
        
        const splash = document.getElementById('initial-splash');
        if (splash) splash.style.display = 'none'; // ချက်ချင်းပျောက်သွားမည်
        
        setTimeout(() => {
            if (typeof applyRoleBasedUI === 'function') {
                applyRoleBasedUI(); 
            }
        }, 50);
    }

    // ၃။ Background ကနေ Server ပေါ်က Role ကို တိတ်တဆိတ် (Silently) လှမ်းစစ်မည်
    db.collection('users').doc(currentUserEmail).get()
      .then(userDoc => {
          if (userDoc.exists) {
              const actualRole = userDoc.data().role;
              
              // တကယ်လို့ Server ပေါ်က Role နဲ့ Local Role မတူဘူးဆိုရင်သာ အသစ်ပြောင်းပေးမည်
              if (actualRole !== window.currentUserRole) {
                  window.currentUserRole = actualRole; 
                  localStorage.setItem(`cachedRole_${currentUserEmail}`, actualRole);
                  
                  if (typeof applyRoleBasedUI === 'function') {
                      applyRoleBasedUI(); // UI ကို နောက်ကွယ်ကနေ Update လုပ်ပေးမည်
                  }
              }
              
              if (authStatus) {
                  authStatus.textContent = `Logged in as: ${user.email} (${window.currentUserRole})`;
              }
          }
      })
      .catch(error => {
          console.log("Background role fetch failed (Offline Mode), using cached role.", error);
          if (authStatus) {
              authStatus.textContent = `Logged in as: ${user.email} (${window.currentUserRole} - Offline)`;
          }
      });

  } else {
    // Logged Out အခြေအနေ
    const appContent = document.getElementById('app-content');
    const loginPage = document.getElementById('login-page');
    
    if (appContent) appContent.style.display = 'none';
    if (loginPage) loginPage.style.display = 'block';
    
    const splash = document.getElementById('initial-splash');
    if (splash) splash.style.display = 'none';
  }
});



// --- UTILITY (GLOBAL NOTIFICATION SYSTEM) ---

function showNotification(message, type = 'info', duration = 5000) {
  const notification = document.getElementById('notification-message');
  if(!notification) return;

  // စာသားနှင့် အရောင် သတ်မှတ်ခြင်း
  notification.textContent = message;
  notification.className = `notification-message ${type}`;
  
  // index.html ထဲတွင် အသေတပ်ထားသော style="display: none;" ကို ဖျောက်ပါမည်
  notification.style.display = 'block';

  // Animation အလုပ်လုပ်စေရန် Reflow လုပ်ခြင်း
  void notification.offsetWidth;

  // Floating အနေဖြင့် အောက်သို့ ဆင်းလာစေရန် show class ထည့်ပါမည်
  notification.classList.add('show');

  if (notification.timeout) {
    clearTimeout(notification.timeout);
  }

  notification.timeout = setTimeout(() => {
    // အချိန်ပြည့်လျှင် အပေါ်သို့ ပြန်တက်သွားပါမည်
    notification.classList.remove('show');
    
    // ပြန်တက်သွားချိန် (0.4 စက္ကန့်) စောင့်ပြီးမှ အပြီးဖျောက်ပါမည်
    setTimeout(() => {
      notification.style.display = 'none';
      notification.textContent = '';
      notification.className = 'notification-message';
    }, 400); 
  }, duration);
}
