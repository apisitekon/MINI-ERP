// ====================================================
// Thai Freelance ERP Lite - Firebase Backend (Auth + Firestore)
// ====================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, Timestamp as FirestoreTimestamp, serverTimestamp,
  connectFirestoreEmulator, runTransaction
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
export const db = getFirestore(app);
export const Timestamp = FirestoreTimestamp;

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
  free: { label: 'Free', customerLimit: 50,  productLimit: 100  },
  pro:  { label: 'Pro',  customerLimit: 500, productLimit: 1000 },
};
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
      await syncUserBasicInfo(user);
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

// --- Users ---
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}
export async function saveUserProfile(uid, data) {
  await setDoc(doc(db, 'users', uid), data, { merge: true });
}

// --- Customers ---
export async function getCustomers(uid) {
  const snap = await getDocs(query(collection(db, 'customers'), where('uid', '==', uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

  return { id: customerRef.id };
}
export async function updateCustomer(id, data) {
  await updateDoc(doc(db, 'customers', id), data);
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
}

// --- Products / Services ---
export async function getProducts(uid) {
  const snap = await getDocs(query(collection(db, 'products'), where('uid', '==', uid)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

  return { id: productRef.id };
}
export async function updateProduct(id, data) {
  await updateDoc(doc(db, 'products', id), data);
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
}

// --- Plan / Admin ---
export async function getPlanUsage(uid) {
  const profile = await getUserProfile(uid);
  return {
    plan: profile?.plan || DEFAULT_PLAN,
    customerLimit: profile?.customerLimit ?? PLANS[DEFAULT_PLAN].customerLimit,
    productLimit:  profile?.productLimit  ?? PLANS[DEFAULT_PLAN].productLimit,
    customerCount: profile?.customerCount ?? 0,
    productCount:  profile?.productCount  ?? 0,
  };
}

export async function findUserByEmail(email) {
  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email.trim())));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { uid: d.id, ...d.data() };
}

export async function updateUserPlan(uid, { plan, customerLimit, productLimit }) {
  await setDoc(doc(db, 'users', uid), { plan, customerLimit, productLimit }, { merge: true });
}

// --- Documents ---
export async function getDocuments(uid, filters = {}) {
  const clauses = [where('uid', '==', uid)];
  if (filters.status) clauses.push(where('status', '==', filters.status));
  const snap = await getDocs(query(collection(db, 'documents'), ...clauses));
  const res = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.sort((a, b) => b.date.toDate() - a.date.toDate());
  return res;
}

export async function getRecentDocuments(uid, count = 5) {
  const res = await getDocuments(uid);
  return res.slice(0, count);
}

export async function getDocument(id) {
  const snap = await getDoc(doc(db, 'documents', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveDocument(uid, data) {
  const ref = await addDoc(collection(db, 'documents'), { ...data, uid });
  return { id: ref.id };
}

export async function updateDocument(id, data) {
  await updateDoc(doc(db, 'documents', id), data);
}

export async function deleteDocument(id) {
  await deleteDoc(doc(db, 'documents', id));
}

// --- Dashboard Aggregations ---
export async function getDashboardStats(uid) {
  const docs = await getDocuments(uid);
  return {
    monthlyRevenue: docs.filter(d => d.status === 'paid').reduce((s,d) => s + (d.subtotal||0), 0),
    pendingAmount: docs.filter(d => d.status === 'pending').reduce((s,d) => s + (d.netTotal||0), 0),
    pendingCount: docs.filter(d => d.status === 'pending').length,
    whtAccumulated: docs.filter(d => d.status === 'paid').reduce((s,d) => s + (d.whtAmount||0), 0)
  };
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
