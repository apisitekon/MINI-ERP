// ====================================================
// Single memoized Firebase auth-state subscription, shared across every
// router-driven page navigation for the tab's lifetime (see js/router.js).
// ====================================================
import { onAuthChange } from './firebase-config.js';

let current;   // undefined = pending, null = signed out, object = signed in
const subscribers = new Set();

onAuthChange(user => {
  current = user;
  subscribers.forEach(fn => fn(user));
});

export function subscribe(fn) {
  subscribers.add(fn);
  if (current !== undefined) fn(current);  // replay latest known state immediately
  return () => subscribers.delete(fn);
}
