# Thai Freelance ERP Lite

A lightweight invoicing/quotation ERP for Thai freelancers and small businesses — customers, products/services, and documents (quotations, invoices, receipts) with automatic WHT (withholding tax) calculation.

## Stack

- Plain static HTML/CSS/JS — no build step, `<script type="module">` throughout
- Firebase Auth (Google Sign-In) + Firestore for backend and data storage
- Free/Pro membership tiers with usage limits enforced via Firestore Security Rules

## Local development

Requires the [Firebase Local Emulator Suite](https://firebase.google.com/docs/emulator-suite) (needs a Java runtime):

```
npx http-server -p 8090 -c-1          # serve the app
firebase emulators:start --only auth,firestore   # in a separate terminal
```

Then open http://localhost:8090 — local dev automatically connects to the emulators instead of production Firebase.

## Deployment

Pushing to `main` auto-deploys to Firebase Hosting via GitHub Actions. Firestore rule changes in `firestore.rules` must additionally be published manually via the Firebase Console (Firestore Database → Rules).
