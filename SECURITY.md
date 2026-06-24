# OChess Security Baseline

## Scope

OChess is currently a local browser game prototype. It has no server API, accounts, payments, chat, analytics, or multiplayer transport.

## Browser Policy

- `index.html` defines a Content Security Policy that limits scripts, images, fonts, and connections to the app origin.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`, and `frame-src 'none'` are set because the MVP does not need plugins, forms, or embedded frames.
- Development websocket connections are limited to localhost addresses for Vite HMR.

## Data Boundary

- The app stores only local chess state in `localStorage` under `ochess:game:v1`.
- Stored data is limited to PGN move history, board orientation, and a save timestamp.
- Do not store secrets, credentials, personal data, payment data, chat content, or remote tokens in browser storage.
- If saved data is corrupt, the app clears that entry, starts a fresh board, and shows a non-blocking recovery notice.

## Asset Boundary

- Runtime sprites are self-hosted under `public/assets`.
- Do not load third-party runtime scripts, remote sprite CDNs, trackers, or external fonts without updating this baseline and the CSP.

## Validation

Before handing off a service-quality build, run:

```sh
npm run build
```

For UI-affecting changes, also verify the board in a browser:

- 64 squares are present.
- 32 initial piece sprites load.
- Console errors are empty.
- Top and bottom pieces do not clip outside the board.

## Stop Conditions

Update this baseline before adding any of the following:

- Online multiplayer, matchmaking, accounts, or user profiles.
- Remote APIs, telemetry, analytics, or asset CDNs.
- PGN import/export from untrusted files or pasted text.
- In-app purchases, ads, or payment flows.
- Any feature that handles secrets, personal data, or user-generated messages.
