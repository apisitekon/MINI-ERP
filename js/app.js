// ====================================================
// Thai Freelance ERP Lite - App Router & Global State
// ====================================================

// ---- State ----
export const state = {
  user: null,
  profile: null,
  customers: [],
  products: [],
  currentPage: 'dashboard'
};

// ---- Router ----
const routes = {
  'dashboard':         'index.html',
  'documents':         'documents.html',
  'document-editor':   'document-editor.html',
  'customers':         'customers.html',
  'products':          'products.html',
  'settings':          'settings.html',
  'plan':              'plan.html',
  'admin':             'admin.html',
  'login':             'login.html',
};

export function navigate(page, params = {}) {
  const file = routes[page];
  if (!file) return;
  const url = new URL(file, window.location.origin + window.location.pathname.replace(/[^/]*$/, ''));
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  window.location.href = url.toString();
}

export function getParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

// ---- Active Nav Highlight ----
export function setActiveNav(page) {
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.page === page) item.classList.add('active');
  });
}

// ---- Number Format ----
export function formatTHB(amount) {
  if (amount === undefined || amount === null) return '0.00';
  return Number(amount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(ts) {
  if (!ts) return '-';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateInput(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().split('T')[0];
}

// ---- Toast ----
export function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast' + (type === 'error' ? ' toast--error' : '');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ---- Modal ----
export function openModal(id) {
  document.getElementById(id)?.classList.add('active');
}
export function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
}

// ---- Loading ----
export function setLoading(el, loading) {
  if (loading) {
    el.disabled = true;
    el.dataset.originalText = el.innerHTML;
    el.innerHTML = '<span class="spinner"></span>';
  } else {
    el.disabled = false;
    if (el.dataset.originalText) el.innerHTML = el.dataset.originalText;
  }
}

// ---- Auth Guard ----
export async function requireAuth(onAuthReady) {
  const { onAuthChange, isAdmin } = await import('./firebase-config.js');
  onAuthChange(user => {
    if (!user) {
      // Not logged in: if not on dashboard, redirect to it
      if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
        navigate('dashboard');
      }
      return;
    }
    renderAdminNavLink(user.uid, isAdmin);
    onAuthReady(user);
  });
}

// Toggles the #admin-nav-link element (if present on the page) based on admin status.
// Centralized here so every page using requireAuth gets consistent admin nav visibility
// without each page having to remember to check isAdmin() itself.
async function renderAdminNavLink(uid, isAdminFn) {
  const el = document.getElementById('admin-nav-link');
  if (!el) return;
  try {
    if (await isAdminFn(uid)) el.style.display = 'flex';
  } catch (e) {
    console.error('renderAdminNavLink failed:', e);
  }
}

export async function signOutUser() {
  const { signOutUser: fbSignOut } = await import('./firebase-config.js');
  await fbSignOut();
}

// ---- Render Sidebar / Nav ----
export function renderNav(activePage) {
  const navItems = [
    { page: 'dashboard',   icon: 'dashboard',   label: 'Dashboard' },
    { page: 'documents',   icon: 'description',  label: 'เอกสาร' },
    { page: 'customers',   icon: 'group',        label: 'ลูกค้า' },
    { page: 'products',    icon: 'inventory_2',  label: 'สินค้า/บริการ' },
    { page: 'plan',        icon: 'workspace_premium', label: 'แพ็กเกจ' },
    { page: 'settings',    icon: 'settings',     label: 'ตั้งค่า' },
  ];

  // Sidebar (Desktop)
  const sidebarNav = document.getElementById('sidebar-nav');
  if (sidebarNav) {
    sidebarNav.innerHTML = navItems.map(item => `
      <a class="nav-item ${item.page === activePage ? 'active' : ''}"
         data-page="${item.page}"
         href="${routes[item.page] || '#'}"
         onclick="event.preventDefault(); navigate('${item.page}')">
        <span class="material-symbols-outlined">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `).join('');
  }

  // Bottom Nav (Mobile) — only Dashboard, Documents, Customers, Settings
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    const mobileItems = navItems.filter(i => ['dashboard','documents','customers','settings'].includes(i.page));
    bottomNav.innerHTML = mobileItems.map(item => `
      <a class="bottom-nav-item ${item.page === activePage ? 'active' : ''}"
         data-page="${item.page}"
         href="${routes[item.page] || '#'}">
        <span class="material-symbols-outlined">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `).join('');
  }
}

// ---- Document Calculation ----
export function calcDocument(items = [], whtEnabled = true, whtRate = 0.03) {
  const subtotal = items.reduce((sum, i) => sum + (parseFloat(i.price || 0) * parseFloat(i.qty || 0)), 0);
  const whtAmount = whtEnabled ? subtotal * whtRate : 0;
  const netTotal = subtotal - whtAmount;
  return { subtotal, whtAmount, whtRate: whtEnabled ? whtRate : 0, netTotal };
}

// ---- Status Badge HTML ----
export function statusBadge(status) {
  const map = {
    paid:      ['badge--paid',      'Paid (ชำระแล้ว)'],
    pending:   ['badge--pending',   'Pending (รอชำระ)'],
    draft:     ['badge--draft',     'Draft (ร่าง)'],
    cancelled: ['badge--cancelled', 'Cancelled (ยกเลิก)'],
  };
  const [cls, label] = map[status] || ['badge--draft', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

// ---- Tax ID Format ----
export function formatTaxId(value) {
  const digits = value.replace(/\D/g, '').slice(0, 13);
  const parts = [digits.slice(0,1), digits.slice(1,5), digits.slice(5,10), digits.slice(10,12), digits.slice(12,13)];
  return parts.filter(Boolean).join('-');
}

// ---- Thai Baht Text (e.g. 270000 -> "สองแสนเจ็ดหมื่นบาทถ้วน") ----
export function bahtText(amount) {
  const DIGITS = ['ศูนย์','หนึ่ง','สอง','สาม','สี่','ห้า','หก','เจ็ด','แปด','เก้า'];
  const POSITIONS = ['','สิบ','ร้อย','พัน','หมื่น','แสน'];

  function convertGroup(n) {
    const digits = String(n).split('').map(Number);
    const len = digits.length;
    let str = '';
    digits.forEach((d, i) => {
      const pos = len - i - 1;
      if (d === 0) return;
      if (pos === 0 && d === 1 && len > 1) str += 'เอ็ด';
      else if (pos === 1 && d === 2) str += 'ยี่' + POSITIONS[1];
      else if (pos === 1 && d === 1) str += POSITIONS[1];
      else str += DIGITS[d] + POSITIONS[pos];
    });
    return str;
  }

  function convertInteger(n) {
    if (n === 0) return 'ศูนย์';
    const millionGroups = [];
    while (n > 0) { millionGroups.push(n % 1000000); n = Math.floor(n / 1000000); }
    let result = '';
    for (let i = millionGroups.length - 1; i >= 0; i--) {
      if (millionGroups[i] > 0) result += convertGroup(millionGroups[i]) + (i > 0 ? 'ล้าน' : '');
    }
    return result;
  }

  const isNegative = Number(amount) < 0;
  const abs = Math.abs(Number(amount) || 0);
  const [baht, satang] = abs.toFixed(2).split('.').map(Number);

  let text = convertInteger(baht) + 'บาท';
  text += satang > 0 ? convertInteger(satang) + 'สตางค์' : 'ถ้วน';
  return isNegative ? 'ลบ' + text : text;
}
