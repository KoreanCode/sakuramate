import { spawn } from "node:child_process";
import path from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(process.cwd(), ".playwright-browsers");

const DEFAULT_PORT = 4173;
const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_PORT}/`;
const TARGET_URL = process.env.VISUAL_SMOKE_URL ?? DEFAULT_URL;

const VIEWPORTS = [
  {
    name: "desktop",
    width: 1280,
    height: 753,
    minBoardSize: 590,
  },
  {
    name: "mobile",
    width: 390,
    height: 844,
    minBoardSize: 360,
  },
];

async function isReachable(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReachable(url, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) {
      return true;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  return false;
}

function startPreviewServer() {
  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite", "preview", "--host", "127.0.0.1", "--port", String(DEFAULT_PORT), "--strictPort"],
    {
      env: { ...process.env, BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  return { child, getOutput: () => output.trim() };
}

async function launchChromium() {
  const { chromium } = await import("playwright");
  const attempts = [
    { name: "bundled chromium", options: {} },
    { name: "system chrome", options: { channel: "chrome" } },
  ];
  const failures = [];

  for (const attempt of attempts) {
    try {
      return await chromium.launch({ headless: true, ...attempt.options });
    } catch (error) {
      failures.push(`${attempt.name}: ${error.message}`);
    }
  }

  throw new Error(
    [
      "Could not launch a Chromium browser for visual smoke validation.",
      "Run `npm run smoke:visual:install` or install Google Chrome.",
      ...failures,
    ].join("\n"),
  );
}

function buildFailures(result) {
  const failures = [];
  const { homeMetrics, metrics, viewport } = result;

  if (!homeMetrics.homePresent) {
    failures.push(`${viewport.name}: expected home screen before gameplay`);
  }
  if (homeMetrics.boardSquaresBeforeStart !== 0) {
    failures.push(`${viewport.name}: expected no board squares before starting singleplay`);
  }
  if (!homeMetrics.primaryActionVisible) {
    failures.push(`${viewport.name}: expected visible singleplay primary action`);
  }
  if (homeMetrics.homeCharacterImages !== 0) {
    failures.push(
      `${viewport.name}: expected no visible home character images, saw ${homeMetrics.homeCharacterImages}`,
    );
  }
  if (!homeMetrics.titleText.includes("사쿠라메이트")) {
    failures.push(`${viewport.name}: expected home title, saw ${homeMetrics.titleText}`);
  }
  if (homeMetrics.docOverflowX || homeMetrics.docOverflowY) {
    failures.push(
      `${viewport.name}: home document overflow x=${homeMetrics.docOverflowX} y=${homeMetrics.docOverflowY}`,
    );
  }
  if (metrics.squareCount !== 64) {
    failures.push(`${viewport.name}: expected 64 squares, saw ${metrics.squareCount}`);
  }
  if (metrics.boardSprites !== 32) {
    failures.push(`${viewport.name}: expected 32 initial board sprites, saw ${metrics.boardSprites}`);
  }
  if (metrics.unloadedBoardSprites !== 0) {
    failures.push(`${viewport.name}: ${metrics.unloadedBoardSprites} board sprites failed to load`);
  }
  if (metrics.boardOverflowCss !== "visible" && (metrics.overflowSprites !== 0 || metrics.maxOverflow !== 0)) {
    failures.push(
      `${viewport.name}: board sprites overflowed board bounds (${metrics.overflowSprites}, max ${metrics.maxOverflow}px)`,
    );
  }
  if (metrics.docOverflowX || metrics.docOverflowY) {
    failures.push(`${viewport.name}: document overflow x=${metrics.docOverflowX} y=${metrics.docOverflowY}`);
  }
  if (metrics.boardWidth < viewport.minBoardSize || metrics.boardHeight < viewport.minBoardSize) {
    failures.push(
      `${viewport.name}: board ${metrics.boardWidth}x${metrics.boardHeight} below ${viewport.minBoardSize}px threshold`,
    );
  }
  if (metrics.avgPieceToSquareScale < 1.5 || metrics.avgPieceToSquareScale > 1.65) {
    failures.push(`${viewport.name}: piece width scale ${metrics.avgPieceToSquareScale} outside 1.50-1.65`);
  }
  if (metrics.pieceScaleCss !== "155%") {
    failures.push(`${viewport.name}: expected --piece-board-scale 155%, saw ${metrics.pieceScaleCss}`);
  }
  if (metrics.edgeTopNudgeYCss !== "-6%") {
    failures.push(`${viewport.name}: expected --piece-edge-top-nudge-y -6%, saw ${metrics.edgeTopNudgeYCss}`);
  }
  if (metrics.middleNudgeYCss !== "-5%") {
    failures.push(`${viewport.name}: expected --piece-middle-nudge-y -5%, saw ${metrics.middleNudgeYCss}`);
  }
  if (metrics.nearTopNudgeYCss !== "-4%") {
    failures.push(`${viewport.name}: expected --piece-near-top-nudge-y -4%, saw ${metrics.nearTopNudgeYCss}`);
  }
  if (metrics.nearBottomNudgeYCss !== "-6%") {
    failures.push(`${viewport.name}: expected --piece-near-bottom-nudge-y -6%, saw ${metrics.nearBottomNudgeYCss}`);
  }
  if (metrics.edgeBottomNudgeYCss !== "-4%") {
    failures.push(`${viewport.name}: expected --piece-edge-bottom-nudge-y -4%, saw ${metrics.edgeBottomNudgeYCss}`);
  }
  if (metrics.edgeNudgeXCss !== "5%") {
    failures.push(`${viewport.name}: expected --piece-edge-nudge-x 5%, saw ${metrics.edgeNudgeXCss}`);
  }
  if (!metrics.bodyCursorCss.includes("generated-spear-cursor.png")) {
    failures.push(`${viewport.name}: expected cute default cursor, saw ${metrics.bodyCursorCss}`);
  }
  if (metrics.sceneBackground1x.width < 864 || metrics.sceneBackground1x.height < 1821) {
    failures.push(
      `${viewport.name}: expected high quality 1x scene background, saw ${JSON.stringify(metrics.sceneBackground1x)}`,
    );
  }
  if (metrics.sceneBackground2x.width < 1728 || metrics.sceneBackground2x.height < 3642) {
    failures.push(
      `${viewport.name}: expected high quality 2x scene background, saw ${JSON.stringify(metrics.sceneBackground2x)}`,
    );
  }
  if (metrics.attackMarkerImage.width < 900 || metrics.attackMarkerImage.height < 900) {
    failures.push(
      `${viewport.name}: expected high quality attack marker image, saw ${JSON.stringify(metrics.attackMarkerImage)}`,
    );
  }
  if (!metrics.actionCursorCss.includes("generated-spear-pointer.png")) {
    failures.push(`${viewport.name}: expected cute action cursor, saw ${metrics.actionCursorCss}`);
  }
  if (metrics.boardOverflowCss !== "visible") {
    failures.push(`${viewport.name}: expected board overflow visible for edge-piece bleed, saw ${metrics.boardOverflowCss}`);
  }
  if (metrics.chromeOverlapSprites.length > 0) {
    failures.push(
      `${viewport.name}: visible sprites overlapped app chrome ${JSON.stringify(metrics.chromeOverlapSprites)}`,
    );
  }
  if (metrics.viewportClippedSprites.length > 0) {
    failures.push(
      `${viewport.name}: visible sprites were clipped by viewport ${JSON.stringify(metrics.viewportClippedSprites)}`,
    );
  }
  if (metrics.opaqueSquareBackgrounds !== 0) {
    failures.push(
      `${viewport.name}: expected transparent square backgrounds so enlarged sprites are not masked, saw ${metrics.opaqueSquareBackgrounds}`,
    );
  }
  if (metrics.visualCenterMismatches.length > 0) {
    failures.push(
      `${viewport.name}: visible piece centers mapped to wrong squares ${JSON.stringify(metrics.visualCenterMismatches)}`,
    );
  }
  if (metrics.backRankRookDyMismatches.length > 0) {
    failures.push(
      `${viewport.name}: back-rank rook vertical centers differ from peer pieces ${JSON.stringify(
        metrics.backRankRookDyMismatches,
      )}`,
    );
  }
  if (result.selectionMismatches.length > 0) {
    failures.push(
      `${viewport.name}: visual piece center selection mismatches ${JSON.stringify(result.selectionMismatches)}`,
    );
  }
  if (!result.playableFlow.ok) {
    failures.push(
      `${viewport.name}: playable opening flow failed ${JSON.stringify(
        result.playableFlow.steps.filter((step) => !step.pass),
      )}`,
    );
  }
  if (result.playableFlow.movedCenterOffsets.length > 0) {
    const movedPieceBaselineMismatches = result.playableFlow.movedCenterOffsets.filter((offset) => {
      return offset.centerDy < -7 || offset.centerDy > -2.5;
    });

    if (movedPieceBaselineMismatches.length > 0) {
      failures.push(
        `${viewport.name}: moved piece baselines drifted ${JSON.stringify(movedPieceBaselineMismatches)}`,
      );
    }
  }
  if (!result.playableFlow.attackMarkerCheck.pass) {
    failures.push(
      `${viewport.name}: attack marker check failed ${JSON.stringify(result.playableFlow.attackMarkerCheck)}`,
    );
  }
  if (!result.recoveryFlow.ok) {
    failures.push(
      `${viewport.name}: singleplayer recovery flow failed ${JSON.stringify(
        result.recoveryFlow.steps.filter((step) => !step.pass),
      )}`,
    );
  }
  if (result.consoleErrors.length > 0 || result.pageErrors.length > 0) {
    failures.push(
      `${viewport.name}: console/page errors ${JSON.stringify({
        consoleErrors: result.consoleErrors,
        pageErrors: result.pageErrors,
      })}`,
    );
  }

  return failures;
}

async function waitForBoardSprites(page) {
  await page.waitForFunction(() => {
    const pieces = [...document.querySelectorAll(".board .piece-sprite")];
    return pieces.length === 32 && pieces.every(
      (img) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0,
    );
  });
}

async function waitForHomeScreen(page) {
  await page.waitForFunction(() => {
    const home = document.querySelector(".home-screen");
    const action = document.querySelector("[aria-label='싱글플레이 시작']");
    return home && action;
  });
}

async function collectHomeMetrics(page) {
  await waitForHomeScreen(page);

  return page.evaluate(() => {
    const home = document.querySelector(".home-screen");
    const primaryAction = document.querySelector("[aria-label='싱글플레이 시작']");
    const primaryRect = primaryAction?.getBoundingClientRect();

    return {
      boardSquaresBeforeStart: document.querySelectorAll(".board .square").length,
      docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      docOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1,
      homePresent: Boolean(home),
      primaryActionVisible:
        Boolean(primaryAction) &&
        Boolean(primaryRect) &&
        primaryRect.width > 0 &&
        primaryRect.height > 0,
      homeCharacterImages: document.querySelectorAll(".home-screen .piece-sprite").length,
      titleText: document.querySelector(".home-copy h1")?.textContent?.trim() ?? "",
    };
  });
}

async function enterSinglePlayer(page) {
  await waitForHomeScreen(page);
  await page.getByRole("button", { name: "싱글플레이 시작" }).click();
  await waitForBoardSprites(page);
}

async function freezeBoardSprites(page) {
  await page.addStyleTag({
    content: `
      .piece-sprite {
        animation: none !important;
        transform: none !important;
      }
    `,
  });
  await waitForBoardSprites(page);
}

async function boardPointForSquare(page, square, mode) {
  return page.evaluate(
    ({ mode, square }) => {
      function alphaBounds(img) {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });

        if (!context) {
          return null;
        }

        context.drawImage(img, 0, 0);
        const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
        let left = width;
        let right = -1;
        let top = height;
        let bottom = -1;

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            if (data[(y * width + x) * 4 + 3] > 30) {
              left = Math.min(left, x);
              right = Math.max(right, x + 1);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y + 1);
            }
          }
        }

        return right === -1 ? null : { bottom, height, left, right, top, width };
      }

      const squareElement = [...document.querySelectorAll(".board .square")].find(
        (candidate) => candidate.getAttribute("aria-label") === square,
      );

      if (!squareElement) {
        return null;
      }

      if (mode === "visual") {
        const img = squareElement.querySelector(".piece-sprite");

        if (!img) {
          return null;
        }

        const rect = img.getBoundingClientRect();
        const bounds = alphaBounds(img);

        return bounds
          ? {
              x: rect.left + ((bounds.left + bounds.right) / 2 / bounds.width) * rect.width,
              y: rect.top + ((bounds.top + bounds.bottom) / 2 / bounds.height) * rect.height,
            }
          : {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            };
      }

      const rect = squareElement.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    },
    { mode, square },
  );
}

async function clickBoardPoint(page, target) {
  if (!target) {
    return false;
  }

  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(60);
  return true;
}

async function currentSelectedSquare(page) {
  return page.evaluate(() => {
    return document.querySelector(".board .square.is-selected")?.getAttribute("aria-label") ?? null;
  });
}

async function currentStatusText(page) {
  return page.evaluate(() => {
    return document.querySelector("h1")?.textContent?.trim() ?? "";
  });
}

async function runPlayableFlow(page) {
  const steps = [];

  async function selectVisual(square) {
    const target = await boardPointForSquare(page, square, "visual");
    const clicked = await clickBoardPoint(page, target);
    const selected = await currentSelectedSquare(page);
    const pass = clicked && selected === square;
    steps.push({ action: `select ${square}`, pass, selected });
    return pass;
  }

  async function moveTo(square, expectedStatuses) {
    const target = await boardPointForSquare(page, square, "square");
    const clicked = await clickBoardPoint(page, target);
    const selected = await currentSelectedSquare(page);
    const status = await currentStatusText(page);
    const pass = clicked && selected === null && expectedStatuses.includes(status);
    steps.push({ action: `move to ${square}`, pass, selected, status });
    return pass;
  }

  async function waitForAutoMove(square, color, type, expectedStatus) {
    await page.waitForFunction(
      ({ color, expectedStatus, square, type }) => {
        const squareElement = [...document.querySelectorAll(".board .square")].find(
          (candidate) => candidate.getAttribute("aria-label") === square,
        );
        const piece = squareElement?.querySelector(".piece-sprite");
        const status = document.querySelector("h1")?.textContent?.trim() ?? "";

        return (
          piece?.classList.contains(`piece-${color}`) &&
          piece?.classList.contains(`piece-kind-${type}`) &&
          status === expectedStatus
        );
      },
      { color, expectedStatus, square, type },
    );

    const selected = await currentSelectedSquare(page);
    const status = await currentStatusText(page);
    const pieceAtSquare = await page.evaluate((square) => {
      const squareElement = [...document.querySelectorAll(".board .square")].find(
        (candidate) => candidate.getAttribute("aria-label") === square,
      );
      const piece = squareElement?.querySelector(".piece-sprite");
      return piece
        ? {
            color: [...piece.classList].find((className) => /^piece-[wb]$/.test(className)),
            kind: [...piece.classList].find((className) => className.startsWith("piece-kind-")),
          }
        : null;
    }, square);
    const pass =
      selected === null &&
      status === expectedStatus &&
      pieceAtSquare?.color === `piece-${color}` &&
      pieceAtSquare?.kind === `piece-kind-${type}`;
    steps.push({ action: `auto move to ${square}`, pass, pieceAtSquare, selected, status });
    return pass;
  }

  await selectVisual("e2");
  await moveTo("e4", ["블랙 턴", "블랙 생각 중"]);
  await waitForAutoMove("e5", "b", "pawn", "화이트 턴");
  await selectVisual("g1");
  await moveTo("f3", ["블랙 턴", "블랙 생각 중"]);
  await waitForAutoMove("f6", "b", "knight", "화이트 턴");
  await page.waitForTimeout(650);

  const movedCenterOffsets = [];
  for (const square of ["e4", "e5", "f3", "f6"]) {
    const visualCenter = await boardPointForSquare(page, square, "visual");
    const squareCenter = await boardPointForSquare(page, square, "square");

    if (!visualCenter || !squareCenter) {
      continue;
    }

    movedCenterOffsets.push({
      centerDx: Number((visualCenter.x - squareCenter.x).toFixed(1)),
      centerDy: Number((visualCenter.y - squareCenter.y).toFixed(1)),
      square,
    });
  }

  await selectVisual("f3");
  const attackMarkerCheck = await page.evaluate(() => {
    const targets = [...document.querySelectorAll(".board .square.is-attack-target")].map((square) => {
      const marker = square.querySelector(".attack-marker");
      return {
        hasMarker: marker instanceof HTMLImageElement,
        markerLoaded:
          marker instanceof HTMLImageElement &&
          marker.complete &&
          marker.naturalWidth >= 900 &&
          marker.naturalHeight >= 900,
        square: square.getAttribute("aria-label"),
      };
    });

    return {
      pass:
        targets.length === 1 &&
        targets[0]?.square === "e5" &&
        targets[0]?.hasMarker === true &&
        targets[0]?.markerLoaded === true,
      targets,
    };
  });

  return {
    attackMarkerCheck,
    movedCenterOffsets,
    ok: steps.every((step) => step.pass),
    steps,
  };
}

async function pieceAtSquare(page, square) {
  return page.evaluate((squareName) => {
    const squareElement = [...document.querySelectorAll(".board .square")].find(
      (candidate) => candidate.getAttribute("aria-label") === squareName,
    );
    const piece = squareElement?.querySelector(".piece-sprite");

    if (!piece) {
      return null;
    }

    return {
      color: [...piece.classList].find((className) => /^piece-[wb]$/.test(className)) ?? null,
      kind: [...piece.classList].find((className) => className.startsWith("piece-kind-")) ?? null,
    };
  }, square);
}

async function runRecoveryFlow(page) {
  const steps = [];

  async function startFreshGame() {
    await page.reload({ waitUntil: "networkidle" });
    await enterSinglePlayer(page);
    await freezeBoardSprites(page);
  }

  async function selectVisual(square) {
    const target = await boardPointForSquare(page, square, "visual");
    const clicked = await clickBoardPoint(page, target);
    const selected = await currentSelectedSquare(page);
    const pass = clicked && selected === square;
    steps.push({ action: `recovery select ${square}`, pass, selected });
    return pass;
  }

  async function moveTo(square) {
    const target = await boardPointForSquare(page, square, "square");
    const clicked = await clickBoardPoint(page, target);
    const selected = await currentSelectedSquare(page);
    const status = await currentStatusText(page);
    const pass = clicked && selected === null && ["블랙 턴", "블랙 생각 중"].includes(status);
    steps.push({ action: `recovery move to ${square}`, pass, selected, status });
    return pass;
  }

  async function assertInitialBoard(action) {
    const status = await currentStatusText(page);
    const e2 = await pieceAtSquare(page, "e2");
    const e4 = await pieceAtSquare(page, "e4");
    const e5 = await pieceAtSquare(page, "e5");
    const e7 = await pieceAtSquare(page, "e7");
    const moveStrip = await page.evaluate(() => {
      return [...document.querySelectorAll(".match-strip span, .match-strip b")]
        .map((node) => node.textContent)
        .join(" ");
    });
    const pass =
      status === "화이트 턴" &&
      moveStrip === "0수 새 판" &&
      e2?.color === "piece-w" &&
      e2?.kind === "piece-kind-pawn" &&
      e7?.color === "piece-b" &&
      e7?.kind === "piece-kind-pawn" &&
      e4 === null &&
      e5 === null;
    steps.push({ action, e2, e4, e5, e7, moveStrip, pass, status });
    return pass;
  }

  await startFreshGame();
  await selectVisual("e2");
  await moveTo("e4");
  await page.getByRole("button", { name: "홈으로", exact: true }).click();
  await page.waitForTimeout(900);
  const homeAfterThinking = await page.evaluate(() => {
    return {
      boardSquares: document.querySelectorAll(".board .square").length,
      homeCharacterImages: document.querySelectorAll(".home-screen .piece-sprite").length,
      homePresent: Boolean(document.querySelector(".home-screen")),
    };
  });
  steps.push({
    action: "home during black response",
    ...homeAfterThinking,
    pass:
      homeAfterThinking.homePresent === true &&
      homeAfterThinking.boardSquares === 0 &&
      homeAfterThinking.homeCharacterImages === 0,
  });

  await enterSinglePlayer(page);
  await freezeBoardSprites(page);
  await selectVisual("e2");
  await moveTo("e4");
  await page.getByRole("button", { name: "새 게임", exact: true }).click();
  await page.waitForTimeout(900);
  await assertInitialBoard("new game during black response");

  await startFreshGame();
  await selectVisual("e2");
  await moveTo("e4");
  await page.waitForFunction(() => {
    const e5 = [...document.querySelectorAll(".board .square")].find(
      (square) => square.getAttribute("aria-label") === "e5",
    );
    const piece = e5?.querySelector(".piece-sprite.piece-b.piece-kind-pawn");
    const status = document.querySelector("h1")?.textContent?.trim() ?? "";
    return piece && status === "화이트 턴";
  });
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await page.waitForTimeout(220);
  await assertInitialBoard("undo after black response");

  return {
    ok: steps.every((step) => step.pass),
    steps,
  };
}

async function collectViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(TARGET_URL, { waitUntil: "networkidle" });
  const homeMetrics = await collectHomeMetrics(page);
  await enterSinglePlayer(page);
  await freezeBoardSprites(page);

  const metrics = await page.evaluate(async () => {
    function imageMetrics(src) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            height: img.naturalHeight,
            loaded: true,
            src,
            width: img.naturalWidth,
          });
        };
        img.onerror = () => {
          resolve({
            height: 0,
            loaded: false,
            src,
            width: 0,
          });
        };
        img.src = src;
      });
    }

    function alphaBounds(img) {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });

      if (!context) {
        return null;
      }

      context.drawImage(img, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      let left = width;
      let right = -1;
      let top = height;
      let bottom = -1;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (data[(y * width + x) * 4 + 3] > 30) {
            left = Math.min(left, x);
            right = Math.max(right, x + 1);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + 1);
          }
        }
      }

      return right === -1 ? null : { bottom, height, left, right, top, width };
    }

    function visibleRect(img) {
      const rect = img.getBoundingClientRect();
      const bounds = alphaBounds(img);

      if (!bounds) {
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        };
      }

      const left = rect.left + (bounds.left / bounds.width) * rect.width;
      const right = rect.left + (bounds.right / bounds.width) * rect.width;
      const top = rect.top + (bounds.top / bounds.height) * rect.height;
      const bottom = rect.top + (bounds.bottom / bounds.height) * rect.height;

      return {
        bottom,
        height: bottom - top,
        left,
        right,
        top,
        width: right - left,
      };
    }

    const board = document.querySelector(".board");
    const topBar = document.querySelector(".top-bar");
    const squares = [...document.querySelectorAll(".board .square")];
    const pieces = [...document.querySelectorAll(".board .piece-sprite")];
    const boardRect = board.getBoundingClientRect();
    const topBarRect = topBar.getBoundingClientRect();
    const firstSquareRect = squares[0].getBoundingClientRect();
    const boardStyle = getComputedStyle(board);
    const borderLeft = Number.parseFloat(boardStyle.borderLeftWidth) || 0;
    const borderRight = Number.parseFloat(boardStyle.borderRightWidth) || 0;
    const borderTop = Number.parseFloat(boardStyle.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(boardStyle.borderBottomWidth) || 0;
    const boardContentLeft = boardRect.left + borderLeft;
    const boardContentTop = boardRect.top + borderTop;
    const boardContentWidth = boardRect.width - borderLeft - borderRight;
    const boardContentHeight = boardRect.height - borderTop - borderBottom;
    const squareLabels = squares.map((square) => square.getAttribute("aria-label"));
    const squareAtPoint = (x, y) => {
      const pointX = x - boardContentLeft;
      const pointY = y - boardContentTop;

      if (pointX < 0 || pointY < 0 || pointX > boardContentWidth || pointY > boardContentHeight) {
        return null;
      }

      const column = Math.min(7, Math.floor((pointX / boardContentWidth) * 8));
      const row = Math.min(7, Math.floor((pointY / boardContentHeight) * 8));
      return squareLabels[row * 8 + column] ?? null;
    };
    const elementRects = pieces.map((img) => {
      const rect = img.getBoundingClientRect();
      return {
        complete: img.complete,
        naturalHeight: img.naturalHeight,
        naturalWidth: img.naturalWidth,
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
      };
    });
    const pieceRects = pieces.map((img) => visibleRect(img));
    const chromeOverlapSprites = squares.flatMap((square) => {
      const img = square.querySelector(".piece-sprite");

      if (!img) {
        return [];
      }

      const rect = visibleRect(img);
      const overlapY = Math.max(
        0,
        Math.min(rect.bottom, topBarRect.bottom) - Math.max(rect.top, topBarRect.top),
      );

      return overlapY > 1
        ? [
            {
              overlapY: Number(overlapY.toFixed(1)),
              square: square.getAttribute("aria-label"),
            },
          ]
        : [];
    });
    const viewportClippedSprites = squares.flatMap((square) => {
      const img = square.querySelector(".piece-sprite");

      if (!img) {
        return [];
      }

      const rect = visibleRect(img);
      const clipTop = Math.max(0, -rect.top);
      const clipBottom = Math.max(0, rect.bottom - window.innerHeight);
      const clipLeft = Math.max(0, -rect.left);
      const clipRight = Math.max(0, rect.right - window.innerWidth);

      return Math.max(clipTop, clipBottom, clipLeft, clipRight) > 1
        ? [
            {
              clipBottom: Number(clipBottom.toFixed(1)),
              clipLeft: Number(clipLeft.toFixed(1)),
              clipRight: Number(clipRight.toFixed(1)),
              clipTop: Number(clipTop.toFixed(1)),
              square: square.getAttribute("aria-label"),
            },
          ]
        : [];
    });
    const visualCenters = squares.flatMap((square) => {
      const img = square.querySelector(".piece-sprite");

      if (!img) {
        return [];
      }

      const rect = visibleRect(img);
      const squareRect = square.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const kind =
        [...img.classList]
          .find((className) => className.startsWith("piece-kind-"))
          ?.replace("piece-kind-", "") ?? "unknown";
      const state =
        [...img.classList]
          .find((className) => className.startsWith("state-"))
          ?.replace("state-", "") ?? "unknown";

      return [
        {
          centerDx: Number((x - (squareRect.left + squareRect.width / 2)).toFixed(1)),
          centerDy: Number((y - (squareRect.top + squareRect.height / 2)).toFixed(1)),
          kind,
          mapped: squareAtPoint(x, y),
          square: square.getAttribute("aria-label"),
          state,
        },
      ];
    });
    const backRankRookDyMismatches = visualCenters
      .filter((center) => {
        return center.kind === "rook" && center.state === "idle" && /[18]$/.test(center.square);
      })
      .flatMap((center) => {
        const rank = center.square.at(-1);
        const peers = visualCenters.filter((candidate) => {
          return (
            candidate.square.endsWith(rank) &&
            candidate.kind !== "rook" &&
            candidate.state === "idle"
          );
        });

        if (peers.length === 0) {
          return [];
        }

        const peerAverageDy =
          peers.reduce((sum, candidate) => sum + candidate.centerDy, 0) / peers.length;
        const delta = Number((center.centerDy - peerAverageDy).toFixed(1));

        return Math.abs(delta) > 1.8
          ? [
              {
                delta,
                peerAverageDy: Number(peerAverageDy.toFixed(1)),
                square: center.square,
              },
            ]
          : [];
      });
    const tolerance = 1;
    const overflowPieces = pieceRects.filter((rect) => {
      return (
        rect.left < boardRect.left - tolerance ||
        rect.top < boardRect.top - tolerance ||
        rect.right > boardRect.right + tolerance ||
        rect.bottom > boardRect.bottom + tolerance
      );
    });
    const maxOverflow = pieceRects.reduce((acc, rect) => {
      return Math.max(
        acc,
        Math.max(0, boardRect.left - rect.left),
        Math.max(0, boardRect.top - rect.top),
        Math.max(0, rect.right - boardRect.right),
        Math.max(0, rect.bottom - boardRect.bottom),
      );
    }, 0);
    const unloadedPieces = elementRects.filter((rect) => {
      return !rect.complete || rect.naturalWidth === 0 || rect.naturalHeight === 0;
    });
    const attackMarkerImage = await imageMetrics("/assets/ui/attack-marker.png");
    const sceneBackground1x = await imageMetrics("/assets/backgrounds/anime-chess-salon.webp");
    const sceneBackground2x = await imageMetrics("/assets/backgrounds/anime-chess-salon@2x.webp");

    return {
      avgPieceHeightToSquareScale: Number(
        (elementRects.reduce((sum, rect) => sum + rect.height, 0) / pieces.length / firstSquareRect.height).toFixed(3),
      ),
      avgPieceToSquareScale: Number(
        (elementRects.reduce((sum, rect) => sum + rect.width, 0) / pieces.length / firstSquareRect.width).toFixed(3),
      ),
      avgVisiblePieceHeightToSquareScale: Number(
        (pieceRects.reduce((sum, rect) => sum + rect.height, 0) / pieces.length / firstSquareRect.height).toFixed(3),
      ),
      avgVisiblePieceToSquareScale: Number(
        (pieceRects.reduce((sum, rect) => sum + rect.width, 0) / pieces.length / firstSquareRect.width).toFixed(3),
      ),
      boardHeight: Math.round(boardRect.height),
      boardOverflowCss: boardStyle.overflow,
      boardSprites: pieces.length,
      boardWidth: Math.round(boardRect.width),
      actionCursorCss: getComputedStyle(squares[0]).cursor,
      bodyCursorCss: getComputedStyle(document.body).cursor,
      docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      docOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1,
      edgeBottomNudgeYCss: boardStyle.getPropertyValue("--piece-edge-bottom-nudge-y").trim(),
      edgeNudgeXCss: boardStyle.getPropertyValue("--piece-edge-nudge-x").trim(),
      edgeTopNudgeYCss: boardStyle.getPropertyValue("--piece-edge-top-nudge-y").trim(),
      middleNudgeYCss: boardStyle.getPropertyValue("--piece-middle-nudge-y").trim(),
      nearBottomNudgeYCss: boardStyle.getPropertyValue("--piece-near-bottom-nudge-y").trim(),
      nearTopNudgeYCss: boardStyle.getPropertyValue("--piece-near-top-nudge-y").trim(),
      elementOverflowSprites: elementRects.filter((rect) => {
        return (
          rect.left < boardRect.left - tolerance ||
          rect.top < boardRect.top - tolerance ||
          rect.right > boardRect.right + tolerance ||
          rect.bottom > boardRect.bottom + tolerance
        );
      }).length,
      maxOverflow: Number(maxOverflow.toFixed(2)),
      opaqueSquareBackgrounds: squares.filter((square) => getComputedStyle(square).backgroundColor !== "rgba(0, 0, 0, 0)").length,
      overflowSprites: overflowPieces.length,
      attackMarkerImage,
      pieceScaleCss: boardStyle.getPropertyValue("--piece-board-scale").trim(),
      sceneBackground1x,
      sceneBackground2x,
      squareCount: squares.length,
      squareHeight: Math.round(firstSquareRect.height),
      squareWidth: Math.round(firstSquareRect.width),
      unloadedBoardSprites: unloadedPieces.length,
      backRankRookDyMismatches,
      chromeOverlapSprites,
      pieceCenterOffsets: visualCenters,
      viewportClippedSprites,
      visualCenterMismatches: visualCenters.filter((center) => center.square !== center.mapped),
    };
  });

  const selectionTargets = await page.evaluate(() => {
    function alphaBounds(img) {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });

      if (!context) {
        return null;
      }

      context.drawImage(img, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
      let left = width;
      let right = -1;
      let top = height;
      let bottom = -1;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (data[(y * width + x) * 4 + 3] > 30) {
            left = Math.min(left, x);
            right = Math.max(right, x + 1);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + 1);
          }
        }
      }

      return right === -1 ? null : { bottom, height, left, right, top, width };
    }

    return [...document.querySelectorAll(".board .square")]
      .flatMap((square) => {
        const img = square.querySelector(".piece-sprite.piece-w");

        if (!img) {
          return [];
        }

        const rect = img.getBoundingClientRect();
        const bounds = alphaBounds(img);
        const x = bounds
          ? rect.left + ((bounds.left + bounds.right) / 2 / bounds.width) * rect.width
          : rect.left + rect.width / 2;
        const y = bounds
          ? rect.top + ((bounds.top + bounds.bottom) / 2 / bounds.height) * rect.height
          : rect.top + rect.height / 2;

        return [
          {
            square: square.getAttribute("aria-label"),
            x,
            y,
          },
        ];
      });
  });

  const selectionResults = [];

  for (const target of selectionTargets) {
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(20);
    const selectedSquare = await page.evaluate(() => {
      return document.querySelector(".board .square.is-selected")?.getAttribute("aria-label") ?? null;
    });

    selectionResults.push({
      selectedSquare,
      square: target.square,
    });
  }

  const selectionMismatches = selectionResults.filter((result) => {
    return result.selectedSquare !== result.square;
  });

  await page.reload({ waitUntil: "networkidle" });
  await enterSinglePlayer(page);
  await freezeBoardSprites(page);
  const playableFlow = await runPlayableFlow(page);
  const recoveryFlow = await runRecoveryFlow(page);

  await context.close();

  return {
    consoleErrors,
    homeMetrics,
    metrics,
    pageErrors,
    playableFlow,
    recoveryFlow,
    selectionMismatches,
    selectionResults,
    viewport,
  };
}

let previewServer = null;

try {
  if (!(await isReachable(TARGET_URL))) {
    if (process.env.VISUAL_SMOKE_URL) {
      throw new Error(`VISUAL_SMOKE_URL is not reachable: ${TARGET_URL}`);
    }

    previewServer = startPreviewServer();
    const reachable = await waitForReachable(TARGET_URL);

    if (!reachable) {
      throw new Error(`Vite preview did not become reachable at ${TARGET_URL}.\n${previewServer.getOutput()}`);
    }
  }

  const browser = await launchChromium();
  const results = [];

  try {
    for (const viewport of VIEWPORTS) {
      results.push(await collectViewport(browser, viewport));
    }
  } finally {
    await browser.close();
  }

  const failures = results.flatMap(buildFailures);
  const report = {
    ok: failures.length === 0,
    url: TARGET_URL,
    results: results.map((result) => ({
      viewport: `${result.viewport.name} ${result.viewport.width}x${result.viewport.height}`,
      homeMetrics: result.homeMetrics,
      metrics: result.metrics,
      consoleErrors: result.consoleErrors,
      pageErrors: result.pageErrors,
      playableFlow: result.playableFlow,
      recoveryFlow: result.recoveryFlow,
      selectionMismatches: result.selectionMismatches,
    })),
    failures,
  };

  console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
} finally {
  if (previewServer) {
    previewServer.child.kill();
  }
}
