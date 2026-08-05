# CLAUDE.md

## Project

NotifAI-USTC is a Vue 3 and Vuetify frontend for browsing USTC campus notices. It presents server-provided AI summaries and deadlines while keeping user preferences in LocalStorage. The backend, crawler, AI pipeline, feedback receiver, and push service are outside this repository.

`README.md` is the authoritative product and engineering contract, including the backend API contract and data boundaries.

## Commands

```bash
npm run dev
npm run lint
npm run type-check
npm run test
npm run test:e2e
npm run build
npm run check
```

Lint is read-only by default. Use `npm run lint:fix` and `npm run format` only when edits are intended.

## Stack

- Vue 3 Composition API with `<script setup>`
- TypeScript strict mode
- Vuetify 3 with Vite auto-import
- Vue Router using `createWebHashHistory`
- Pinia with validated, versioned LocalStorage persistence
- Axios with runtime validation at the API boundary
- Vitest, Vue Test Utils, and Playwright

## Architecture

```text
src/
├── components/   reusable business UI
├── composables/  shared browser and UI state
├── mock/         development-only notice data
├── plugins/      Vuetify setup
├── router/       hash routes and document titles
├── stores/       preferences, folders, and notice cache
├── types/        API and domain contracts
├── utils/        requests, validation, dates, sharing
└── views/        application pages
```

The server owns notices, source classification, summaries, and extracted fields. The client owns only local preferences and a non-authoritative in-memory notice cache.

## Required Invariants

1. Keep hash routing for static and Capacitor-compatible deployment.
2. Read the API base from `VITE_API_BASE_URL`; reject credentials, query strings, and fragments. Mock data requires `VITE_USE_MOCK=true` and must never run in production.
3. Validate every API and LocalStorage payload at runtime before use.
4. Treat `cleanContent`, URLs, route params, and clipboard operations as untrusted boundaries.
5. Never allow `on*` attributes, scripts, forms, iframe, arbitrary inline styles, or untrusted active media through notice HTML.
6. Parse date-only values as local calendar dates. Do not pass `YYYY-MM-DD` directly to `new Date()`.
7. Preserve stale data during request failures and show an explicit retry state. Do not convert errors into empty results.
8. Cancel or supersede stale list/detail requests before committing their results.
9. Do not claim push delivery, feedback submission, or all-record operations unless the full backend/browser path exists.
10. All core actions must work with keyboard and screen readers; icon-only buttons need accessible names.

## Environment

```dotenv
VITE_API_BASE_URL=http://localhost:3000/api
VITE_USE_MOCK=false
```

`VITE_*` values are public browser configuration, never secrets. Production servers should supply CSP, HSTS, CORS, and cache headers.
