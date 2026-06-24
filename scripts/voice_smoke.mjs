import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(process.cwd(), ".playwright-browsers");

function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("Could not allocate a voice smoke port"));
        }
      });
    });
  });
}

async function waitForReachable(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) {
        return true;
      }
    } catch {
      // Preview server is still booting.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 150);
    });
  }

  return false;
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

  throw new Error(["Could not launch Chromium for voice smoke validation.", ...failures].join("\n"));
}

function installSpeechProbe(page) {
  return page.addInitScript(() => {
    const speechLog = [];
    let active = 0;
    let maxActive = 0;
    let overlap = false;

    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = "";
        this.pitch = 1;
        this.rate = 1;
        this.volume = 1;
        this.voice = null;
        this.onend = null;
        this.onerror = null;
      }
    }

    const synth = {
      getVoices() {
        return [{ name: "Yuna", lang: "ko-KR" }];
      },
      cancel() {
        active = 0;
      },
      speak(utterance) {
        if (active > 0) {
          overlap = true;
        }

        active += 1;
        maxActive = Math.max(maxActive, active);
        speechLog.push({
          text: utterance.text,
          pitch: utterance.pitch,
          rate: utterance.rate,
          volume: utterance.volume,
          voice: utterance.voice?.name ?? null,
          lang: utterance.lang,
        });

        setTimeout(() => {
          active = Math.max(0, active - 1);
          utterance.onend?.();
        }, 140);
      },
      get speaking() {
        return active > 0;
      },
      get pending() {
        return false;
      },
      pause() {},
      resume() {},
    };

    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: FakeUtterance,
      configurable: true,
    });
    Object.defineProperty(window, "speechSynthesis", {
      value: synth,
      configurable: true,
    });
    Object.defineProperty(window, "__speechProbe", {
      value: {
        log: speechLog,
        get maxActive() {
          return maxActive;
        },
        get overlap() {
          return overlap;
        },
      },
      configurable: true,
    });
  });
}

function probeSnapshot(page) {
  return page.evaluate(() => ({
    log: window.__speechProbe.log,
    overlap: window.__speechProbe.overlap,
    maxActive: window.__speechProbe.maxActive,
  }));
}

function hasAny(texts, expected) {
  return texts.some((text) => expected.includes(text));
}

const port = await getOpenPort();
const url = `http://127.0.0.1:${port}/`;
const preview = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let previewOutput = "";
preview.stdout.on("data", (chunk) => {
  previewOutput += chunk.toString();
});
preview.stderr.on("data", (chunk) => {
  previewOutput += chunk.toString();
});

try {
  if (!(await waitForReachable(url))) {
    throw new Error(`Vite preview did not become reachable at ${url}.\n${previewOutput}`);
  }

  const browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 430, height: 860 } });
  const errors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  await installSpeechProbe(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("ochess:sound:v1", "on");
    localStorage.setItem("ochess:music:v1", "off");
    localStorage.removeItem("ochess:game:v1");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "싱글플레이 시작" }).click();
  await page.getByRole("button", { name: "e2" }).click();
  await page.waitForTimeout(260);
  await page.getByRole("button", { name: "g1" }).click();
  await page.waitForTimeout(260);

  const selectProbe = await probeSnapshot(page);
  const selectTexts = selectProbe.log.map((entry) => entry.text);
  const hasPawnSelect = hasAny(selectTexts, ["네에?", "제가요?", "불렀어요?"]);
  const hasKnightSelect = hasAny(selectTexts, ["출동할까요?", "빙글 갈게요?", "제 차례죠?"]);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.__speechProbe.log.length = 0;
    localStorage.setItem("ochess:sound:v1", "on");
    localStorage.setItem("ochess:music:v1", "off");
    localStorage.setItem(
      "ochess:game:v1",
      JSON.stringify({
        orientation: "w",
        pgn: "1. e4 d5",
        savedAt: new Date().toISOString(),
      }),
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "저장된 게임 이어하기" }).click();
  await page.getByRole("button", { name: "e4" }).click();
  await page.getByRole("button", { name: "d5" }).click();
  await page.waitForTimeout(540);

  const captureProbe = await probeSnapshot(page);
  const captureTexts = captureProbe.log.map((entry) => entry.text);
  const hasPawnAttack = hasAny(captureTexts, ["콩!", "살짝 콕!", "미안해요!"]);
  const hasPawnDefeat = hasAny(captureTexts, ["먼저 쉴게요", "퇴근할게요", "졌어요오"]);

  await browser.close();

  const result = {
    ok:
      errors.length === 0 &&
      hasPawnSelect &&
      hasKnightSelect &&
      hasPawnAttack &&
      hasPawnDefeat &&
      !selectProbe.overlap &&
      !captureProbe.overlap,
    errors,
    selectTexts,
    hasPawnSelect,
    hasKnightSelect,
    selectMaxActive: selectProbe.maxActive,
    selectOverlap: selectProbe.overlap,
    captureTexts,
    hasPawnAttack,
    hasPawnDefeat,
    captureMaxActive: captureProbe.maxActive,
    captureOverlap: captureProbe.overlap,
  };

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
} finally {
  preview.kill("SIGTERM");
}
