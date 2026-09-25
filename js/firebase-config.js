// ====================================================
// Thai Freelance ERP Lite - Firebase Backend (Auth + Firestore)
// ====================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocFromCache, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, getDocsFromCache, getCountFromServer,
  Timestamp as FirestoreTimestamp, serverTimestamp, connectFirestoreEmulator, runTransaction
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBoVsXi_Hyob4IggYIV1AIT25_vHkn1T7M",
  authDomain: "minierp-25208.firebaseapp.com",
  projectId: "minierp-25208",
  storageBucket: "minierp-25208.firebasestorage.app",
  messagingSenderId: "562182956188",
  appId: "1:562182956188:web:b2173fcf2ca58a6165f959",
  measurementId: "G-KGW0QJNC35"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const Timestamp = FirestoreTimestamp;

// Persistent local cache so repeat page loads (this is a multi-page app — every
// navigation re-initializes Firestore) can render from IndexedDB instantly instead of
// always waiting on a fresh network round-trip. Falls back to memory-only cache on
// browsers/contexts where IndexedDB isn't available (e.g. some private-browsing modes).
let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn('Firestore persistent cache unavailable, using memory cache:', e);
  dbInstance = getFirestore(app);
}
export const db = dbInstance;

// Local dev runs against the Firebase Local Emulator Suite instead of production:
// real Google sign-in on localhost fights Chrome's COOP/storage-partitioning rules
// (see project notes), and the emulator sidesteps that entirely with a fake sign-in UI.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8085);
}

const ADMIN_EMAIL = 'apisitekon@gmail.com';

// ---- Plans ----
export const PLANS = {
  free: { label: 'Free', customerLimit: 50,  productLimit: 100,  businessLimit: 1 },
  pro:  { label: 'Pro',  customerLimit: 500, productLimit: 1000, businessLimit: 3 },
};
// Contact for plan upgrades and custom quotes (e.g. more than 3 businesses on Pro).
export const ADMIN_CONTACT_EMAIL = 'apisitekon@gmail.com';
export const DEFAULT_PLAN = 'free';

function defaultPlanFields() {
  const p = PLANS[DEFAULT_PLAN];
  return { plan: DEFAULT_PLAN, customerLimit: p.customerLimit, productLimit: p.productLimit };
}

function mapUser(user) {
  if (!user) return null;
  return { uid: user.uid, displayName: user.displayName, email: user.email, photoURL: user.photoURL };
}

// Only ever succeeds for ADMIN_EMAIL — enforced server-side by the admins/{uid} create rule.
async function bootstrapAdmin(user) {
  if (!user || user.email !== ADMIN_EMAIL) return;
  try {
    await setDoc(doc(db, 'admins', user.uid), { email: user.email, addedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    // Ignored: expected to fail for anyone other than ADMIN_EMAIL.
  }
}

// Keeps users/{uid}.email/displayName current so the admin plan page can find people by
// email — never touches plan/limit/count fields, so this merge-write is always safe
// under the field-guard rules regardless of who's signing in.
async function syncUserBasicInfo(user) {
  if (!user) return;
  try {
    await setDoc(doc(db, 'users', user.uid), { email: user.email, displayName: user.displayName || '' }, { merge: true });
  } catch (e) {
    // Non-fatal: profile sync failing shouldn't block sign-in.
  }
}

// ====================================================
// Auth Helpers
// ====================================================
// Popup rather than redirect: with authDomain (firebaseapp.com) on a different origin
// than the app itself (e.g. localhost during dev), the redirect flow's cross-origin
// handoff can silently fail under Chrome's third-party storage partitioning. Popup
// avoids that — the harmless COOP "window.closed" console warning some browsers show
// doesn't block it (Firebase Auth also completes the handshake via postMessage).
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  await bootstrapAdmin(result.user);
  await syncUserBasicInfo(result.user);
  return mapUser(result.user);
}

export async function signOutUser() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      await bootstrapAdmin(user);
      // Not awaited: this is a background profile-sync write, not something the page needs
      // to wait on. Awaiting it here would serialize it in front of every page's own data
      // fetch (every page's requireAuth() waits on this callback before loading anything).
      syncUserBasicInfo(user);
    }
    callback(mapUser(user));
  });
}

export function getCurrentUser() {
  return mapUser(auth.currentUser);
}

export async function isAdmin(uid) {
  if (!uid) return false;
  const snap = await getDoc(doc(db, 'admins', uid));
  return snap.exists();
}

// ====================================================
// Firestore Helpers
// ====================================================

// ---- Short-lived read cache ----
// This is a router-driven SPA with no other cross-page state (js/router.js re-executes each
// page's own inline script from a fresh closure on every navigation, so a page's own `let
// allDocs = []`-style locals can never survive a nav) — without this, bouncing between pages
// within the same session refetches every collection from zero every time, even seconds
// apart. TTL is short so a stale read is never visible for long even if a write path below
// were to miss an invalidation; every mutating function clears the whole cache on success so
// the current tab always sees its own edits immediately (this module persists across
// router.js navigations, so the cache does too).
const READ_CACHE_TTL_MS = 30000;
const _readCache = new Map();
function cacheGet(key) {
  const hit = _readCache.get(key);
  if (!hit || Date.now() - hit.at > READ_CACHE_TTL_MS) return undefined;
  return hit.data;
}
function cacheSet(key, data) {
  _readCache.set(key, { data, at: Date.now() });
}
function cacheClear() {
  _readCache.clear();
}

// Dedupes the background revalidation fetch below: if two callers hit an instant-paint cache
// read for the same key before the first revalidation lands, they share one network fetch
// instead of each firing their own.
const _inFlightRevalidate = new Map();
function revalidate(key, fetchFn) {
  if (_inFlightRevalidate.has(key)) return;
  const p = fetchFn()
    .then(data => cacheSet(key, data))
    .catch(() => {}) // best-effort background refresh; a failure here just leaves the TTL cache cold
    .finally(() => _inFlightRevalidate.delete(key));
  _inFlightRevalidate.set(key, p);
}

// --- Users ---
export async function getUserProfile(uid) {
  const key = `profile:${uid}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const userRef = doc(db, 'users', uid);
  // Instant-paint path: if this doc is already in the SDK's local IndexedDB cache (e.g. a
  // returning visit on this device), return it immediately instead of waiting on the network,
  // then revalidate against the server in the background so the *next* read within the TTL
  // window gets the confirmed-fresh value.
  try {
    const cachedSnap = await getDocFromCache(userRef);
    if (cachedSnap.exists()) {
      const data = cachedSnap.data();
      revalidate(key, async () => {
        const snap = await getDoc(userRef);
        return snap.exists() ? snap.data() : null;
      });
      return data;
    }
  } catch (e) {
    // Nothing cached locally yet (true first visit for this doc) — fall through to network.
  }

  const snap = await getDoc(userRef);
  const data = snap.exists() ? snap.data() : null;
  cacheSet(key, data);
  return data;
}
export async function saveUserProfile(uid, data) {
  await setDoc(doc(db, 'users', uid), data, { merge: true });
  cacheClear();
}

// --- Businesses (several issuer profiles per account) ---
// Stored on users/{uid} as `businesses: [{ id, name, taxId, phone, promptPay, address }]`
// plus `defaultBusinessId`. The legacy flat fields (businessName, businessTaxId, …) are
// kept mirrored from the default business so pages/documents that predate multi-business
// keep working. The list size is capped per plan by firestore.rules (Free 1, Pro 3, or an
// admin-set `businessLimit` override for custom quotes).
export function businessLimitFor(profile) {
  if (typeof profile?.businessLimit === 'number') return profile.businessLimit;
  return (PLANS[profile?.plan] || PLANS[DEFAULT_PLAN]).businessLimit;
}

export function getBusinesses(profile) {
  if (Array.isArray(profile?.businesses) && profile.businesses.length) return profile.businesses;
  // Legacy single-business profile -> present it as a one-item list.
  if (profile && (profile.businessName || profile.businessTaxId || profile.businessAddress
      || profile.businessPhone || profile.businessPromptPay)) {
    return [{
      id: 'default',
      name: profile.businessName || '',
      taxId: profile.businessTaxId || '',
      phone: profile.businessPhone || '',
      promptPay: profile.businessPromptPay || '',
      address: profile.businessAddress || '',
    }];
  }
  return [];
}

export function getDefaultBusiness(profile) {
  const list = getBusinesses(profile);
  return list.find(b => b.id === profile?.defaultBusinessId) || list[0] || null;
}

// Businesses this account may currently issue documents from: the default first, then
// the rest, capped at the plan limit (an account downgraded from Pro keeps its data but
// only the first N stay selectable).
export function getUsableBusinesses(profile) {
  const list = getBusinesses(profile);
  const def = getDefaultBusiness(profile);
  const ordered = def ? [def, ...list.filter(b => b.id !== def.id)] : list;
  return ordered.slice(0, Math.max(1, businessLimitFor(profile)));
}

// The business a document was issued from; falls back to the default business.
export function resolveBusiness(profile, businessId) {
  const list = getBusinesses(profile);
  return (businessId && list.find(b => b.id === businessId)) || getDefaultBusiness(profile);
}

export async function saveBusinesses(uid, businesses, defaultBusinessId) {
  const def = businesses.find(b => b.id === defaultBusinessId) || businesses[0] || null;
  await setDoc(doc(db, 'users', uid), {
    businesses,
    defaultBusinessId: def?.id || null,
    businessName: def?.name || '',
    businessTaxId: def?.taxId || '',
    businessPhone: def?.phone || '',
    businessPromptPay: def?.promptPay || '',
    businessAddress: def?.address || '',
  }, { merge: true });
  cacheClear();
}

// --- Customers ---
export async function getCustomers(uid) {
  const key = `customers:${uid}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const snap = await getDocs(query(collection(db, 'customers'), where('uid', '==', uid)));
  const res = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheSet(key, res);
  return res;
}
export async function addCustomer(uid, data) {
  const customerRef = doc(collection(db, 'customers'));
  const userRef = doc(db, 'users', uid);

  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const profile = userSnap.exists() ? userSnap.data() : null;
    const count = profile?.customerCount ?? 0;
    const limit = profile?.customerLimit ?? PLANS[DEFAULT_PLAN].customerLimit;
    if (count >= limit) throw new Error('LIMIT_REACHED_CUSTOMER');

    tx.set(customerRef, { ...data, uid });
    tx.set(userRef, userSnap.exists()
      ? { customerCount: count + 1 }
      : { ...defaultPlanFields(), customerCount: 1, productCount: 0 },
      { merge: true });
  });

  cacheClear();
  return { id: customerRef.id };
}
export async function updateCustomer(id, data) {
  await updateDoc(doc(db, 'customers', id), data);
  cacheClear();
}
export async function deleteCustomer(id) {
  const customerRef = doc(db, 'customers', id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(customerRef);
    if (!snap.exists()) return;
    const { uid } = snap.data();
    const userRef = doc(db, 'users', uid);
    const userSnap = await tx.get(userRef);
    const count = userSnap.exists() ? (userSnap.data().customerCount ?? 0) : 0;
    tx.delete(customerRef);
    tx.set(userRef, { customerCount: Math.max(0, count - 1) }, { merge: true });
  });
  cacheClear();
}

// --- Products / Services ---
export async function getProducts(uid) {
  const key = `products:${uid}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const snap = await getDocs(query(collection(db, 'products'), where('uid', '==', uid)));
  const res = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheSet(key, res);
  return res;
}
export async function addProduct(uid, data) {
  const productRef = doc(collection(db, 'products'));
  const userRef = doc(db, 'users', uid);

  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    const profile = userSnap.exists() ? userSnap.data() : null;
    const count = profile?.productCount ?? 0;
    const limit = profile?.productLimit ?? PLANS[DEFAULT_PLAN].productLimit;
    if (count >= limit) throw new Error('LIMIT_REACHED_PRODUCT');

    tx.set(productRef, { ...data, uid });
    tx.set(userRef, userSnap.exists()
      ? { productCount: count + 1 }
      : { ...defaultPlanFields(), customerCount: 0, productCount: 1 },
      { merge: true });
  });

  cacheClear();
  return { id: productRef.id };
}
export async function updateProduct(id, data) {
  await updateDoc(doc(db, 'products', id), data);
  cacheClear();
}
export async function deleteProduct(id) {
  const productRef = doc(db, 'products', id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists()) return;
    const { uid } = snap.data();
    const userRef = doc(db, 'users', uid);
    const userSnap = await tx.get(userRef);
    const count = userSnap.exists() ? (userSnap.data().productCount ?? 0) : 0;
    tx.delete(productRef);
    tx.set(userRef, { productCount: Math.max(0, count - 1) }, { merge: true });
  });
  cacheClear();
}

// --- Plan / Admin ---
// Pure mapping, split out so a caller that already has the profile (e.g. insights.html,
// which needs the full profile anyway) can derive plan usage without a second Firestore
// read of the same users/{uid} document that getPlanUsage would otherwise trigger.
export function planUsageFromProfile(profile) {
  return {
    plan: profile?.plan || DEFAULT_PLAN,
    customerLimit: profile?.customerLimit ?? PLANS[DEFAULT_PLAN].customerLimit,
    productLimit:  profile?.productLimit  ?? PLANS[DEFAULT_PLAN].productLimit,
    customerCount: profile?.customerCount ?? 0,
    productCount:  profile?.productCount  ?? 0,
    businessLimit: businessLimitFor(profile),
    businessCount: getBusinesses(profile).length,
  };
}

export async function getPlanUsage(uid) {
  const profile = await getUserProfile(uid);
  return planUsageFromProfile(profile);
}

export async function findUserByEmail(email) {
  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email.trim())));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { uid: d.id, ...d.data() };
}

export async function updateUserPlan(uid, { plan, customerLimit, productLimit, businessLimit }) {
  const data = { plan, customerLimit, productLimit };
  if (typeof businessLimit === 'number') data.businessLimit = businessLimit;
  await setDoc(doc(db, 'users', uid), data, { merge: true });
  cacheClear();
}

// --- Documents ---
function mapAndSortDocs(snap) {
  const res = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.sort((a, b) => b.date.toDate() - a.date.toDate());
  return res;
}

export async function getDocuments(uid, filters = {}) {
  const key = `documents:${uid}:${filters.status || ''}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const clauses = [where('uid', '==', uid)];
  if (filters.status) clauses.push(where('status', '==', filters.status));
  const q = query(collection(db, 'documents'), ...clauses);

  // Same instant-paint-then-revalidate pattern as getUserProfile above. A genuinely empty
  // result (new account, zero documents) is treated as a cache miss too, rather than trying
  // to distinguish "never cached" from "confirmed empty" — new accounts just always pay one
  // real fetch, which is a fine trade for the simplicity.
  try {
    const cachedSnap = await getDocsFromCache(q);
    if (!cachedSnap.empty) {
      const res = mapAndSortDocs(cachedSnap);
      revalidate(key, async () => mapAndSortDocs(await getDocs(q)));
      return res;
    }
  } catch (e) {
    // Nothing cached locally yet — fall through to network.
  }

  const snap = await getDocs(q);
  const res = mapAndSortDocs(snap);
  cacheSet(key, res);
  return res;
}

// Used for document numbering (getNextDocNumber in document-editor.html), which used to
// fetch every document the user has ever created just to count how many share `type` — an
// unbounded fetch that grows with account age. A server-side count query answers the same
// question without downloading any document bodies, and two equality filters need no
// composite index.
export async function getDocumentCountByType(uid, type) {
  const snap = await getCountFromServer(
    query(collection(db, 'documents'), where('uid', '==', uid), where('type', '==', type))
  );
  return snap.data().count;
}

export async function getDocument(id) {
  const snap = await getDoc(doc(db, 'documents', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Reuses getDocuments' existing fetch-all-filter-client-side pattern instead of a new
// Firestore query shape — used to find documents linking back to a given quotation/invoice
// (e.g. field='sourceQuotationId') without needing a composite index.
export async function getLinkedDocuments(uid, field, id) {
  if (!id) return [];
  const all = await getDocuments(uid);
  return all.filter(d => d[field] === id);
}

export async function saveDocument(uid, data) {
  const ref = await addDoc(collection(db, 'documents'), { ...data, uid });
  cacheClear();
  return { id: ref.id };
}

export async function updateDocument(id, data) {
  await updateDoc(doc(db, 'documents', id), data);
  cacheClear();
}

export async function deleteDocument(id) {
  await deleteDoc(doc(db, 'documents', id));
  cacheClear();
}

// --- Dashboard Aggregations ---
// Fetches the documents collection once and derives both the KPI stats and the recent-docs
// list from it, instead of the two callers each independently re-querying the same data.
export async function getDashboardData(uid, recentCount = 5) {
  const docs = await getDocuments(uid);
  const stats = {
    monthlyRevenue: docs.filter(d => d.status === 'paid').reduce((s,d) => s + (d.subtotal||0), 0),
    pendingAmount: docs.filter(d => d.status === 'pending').reduce((s,d) => s + (d.netTotal||0), 0),
    pendingCount: docs.filter(d => d.status === 'pending').length,
    whtAccumulated: docs.filter(d => d.status === 'paid').reduce((s,d) => s + (d.whtAmount||0), 0)
  };
  return { stats, recentDocs: docs.slice(0, recentCount) };
}

// ====================================================
// Pure Functions
// ====================================================
export function calculateDocument(items, whtEnabled = true, whtRate = 0.03) {
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const whtAmount = whtEnabled ? subtotal * whtRate : 0;
  const netTotal = subtotal - whtAmount;
  return { subtotal, whtAmount, whtRate: whtEnabled ? whtRate : 0, netTotal };
}

export function generateDocNumber(type, sequence) {
  const prefix = { QUOTATION: 'QUO', INVOICE: 'INV', RECEIPT: 'REC' }[type] || 'DOC';
  const year = new Date().getFullYear();
  const num = String(sequence).padStart(3, '0');
  return `${prefix}-${year}-${num}`;
}
