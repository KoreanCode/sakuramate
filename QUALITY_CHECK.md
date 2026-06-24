# OChess Visual Quality Check

Use this check after visual, sprite, or layout changes.

## Commands

```sh
npm run build
npm run preview -- --port 4173
npm run smoke:visual
```

Open `http://localhost:4173/`.

For repeatable validation, run `npm run quality:visual`. It builds the app, starts or reuses a local production preview, and checks the desktop and mobile board metrics in a clean browser context.

If the local Playwright browser is missing, run `npm run smoke:visual:install` once. It installs Chromium into the ignored `.playwright-browsers/` directory.

## Desktop Preview

Viewport: `1280 x 753`

- Board width and height should be at least `590px` when capture trays are visible.
- Board should use most of the available vertical space without document overflow.
- Top-rank sprites should have safe room above the board and must not overlap the header controls.
- Board overflow should remain visible so enlarged edge pieces are not clipped by the board container.
- Edge-column pieces should sit slightly inside the board edge; `--piece-edge-nudge-x` should remain `10%`.
- Individual square backgrounds should remain transparent so enlarged sprites are not masked at legs or feet.
- Each initial piece's visible center should map to its own board square.
- Home-rank rook vertical centers should stay aligned with the other back-rank pieces; `backRankRookDyMismatches` should be empty.
- Tapping the visible center of each initial white piece should select that piece's own square.
- The playable opening flow `e2-e4`, `e7-e5`, `g1-f3`, `g8-f6` should complete from visible piece taps and square-center move taps.
- Initial or restored board should show 64 squares.
- All board piece sprites should finish loading.
- Console errors should be empty.

## Mobile Preview

Viewport: `390 x 844`

- Board should fill the available phone width.
- Top-rank sprites should have safe room above the board and must not overlap the header controls.
- Board overflow should remain visible so enlarged edge pieces are not clipped by the board container.
- Edge-column pieces should sit slightly inside the board edge; `--piece-edge-nudge-x` should remain `10%`.
- Individual square backgrounds should remain transparent so enlarged sprites are not masked at legs or feet.
- Each initial piece's visible center should map to its own board square.
- Home-rank rook vertical centers should stay aligned with the other back-rank pieces; `backRankRookDyMismatches` should be empty.
- Tapping the visible center of each initial white piece should select that piece's own square.
- The playable opening flow `e2-e4`, `e7-e5`, `g1-f3`, `g8-f6` should complete from visible piece taps and square-center move taps.
- Document horizontal and vertical overflow should be absent.
- Console errors should be empty.

## Screenshot Expectation

Capture the board crop when possible. If screenshot capture is unavailable, record DOM smoke stats for board size, square count, sprite count, unloaded sprites, overflow, viewport, and console errors.
