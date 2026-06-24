# OChess Demo Deployment

## Build

Install dependencies, then build the static app:

```sh
npm ci
npm run build
```

The build output is written to `dist/`.

## Local Production Preview

Run the built app without the Vite development server:

```sh
npm run preview -- --port 4173
```

Open:

```text
http://localhost:4173/
```

Expected smoke result:

- The page title is `OChess`.
- The board shows 64 squares.
- The initial board shows 32 piece sprites.
- Sprite images finish loading.
- Console errors are empty.
- The board does not overflow the mobile viewport.

## Static Hosting Boundary

For a simple demo host, publish the contents of `dist/` as the site root. The current build assumes root-relative assets such as `/assets/...`; if OChess is hosted under a subpath, configure Vite `base` before building.

No production deployment, domain, CDN, analytics, accounts, or remote API is part of the current MVP.
