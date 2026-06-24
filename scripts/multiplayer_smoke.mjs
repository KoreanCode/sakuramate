import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@colyseus/sdk";

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
          reject(new Error("Could not allocate a multiplayer smoke port"));
        }
      });
    });
  });
}

const port = await getOpenPort();
const endpoint = `http://localhost:${port}`;

function waitForState(room, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for multiplayer state"));
    }, timeoutMs);

    const check = (state) => {
      if (predicate(state)) {
        clearTimeout(timeout);
        resolve(state);
      }
    };

    room.onStateChange(check);
    check(room.state);
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still booting.
    }
    await delay(120);
  }

  throw new Error("Multiplayer server did not become healthy");
}

const server = spawn(process.execPath, ["server/main.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
server.stdout.on("data", (chunk) => {
  serverLog += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverLog += chunk.toString();
});

try {
  await waitForHealth();

  const clientA = new Client(endpoint);
  const clientB = new Client(endpoint);
  const roomA = await clientA.create("ochess", { name: "Mika", roomTitle: "꽃잎 테스트방" });

  const listResponse = await fetch(`${endpoint}/rooms`);
  if (!listResponse.ok) {
    throw new Error(`Expected room list response, got ${listResponse.status}`);
  }

  const listPayload = await listResponse.json();
  const listedRoom = listPayload.rooms?.find((room) => room.id === roomA.roomId);
  if (!listedRoom) {
    throw new Error(`Created room was not listed. Payload: ${JSON.stringify(listPayload)}`);
  }

  if (listedRoom.title !== "꽃잎 테스트방" || listedRoom.players !== 1 || !listedRoom.joinable) {
    throw new Error(`Unexpected listed room summary: ${JSON.stringify(listedRoom)}`);
  }

  const roomB = await clientB.joinById(roomA.roomId, { name: "Yuna" });

  await waitForState(roomA, (state) => state.players.size === 2);
  await waitForState(roomB, (state) => state.players.size === 2);

  const players = [...roomA.state.players.values()].map((player) => ({
    name: player.name,
    color: player.color,
  }));

  if (!players.some((player) => player.name === "Mika" && player.color === "w")) {
    throw new Error(`Expected Mika to be white. Players: ${JSON.stringify(players)}`);
  }

  if (!players.some((player) => player.name === "Yuna" && player.color === "b")) {
    throw new Error(`Expected Yuna to be black. Players: ${JSON.stringify(players)}`);
  }

  roomA.send("move", { from: "e2", to: "e4" });
  await waitForState(roomB, (state) => state.lastFrom === "e2" && state.lastTo === "e4");

  roomA.send("chat", { text: "안녕!" });
  await waitForState(roomB, (state) =>
    [...state.players.values()].some((player) => player.name === "Mika" && player.chatText === "안녕!"),
  );

  await roomA.leave();
  await roomB.leave();

  const clientC = new Client(endpoint);
  const clientD = new Client(endpoint);
  const roomC = await clientC.joinOrCreate("ochess", {
    name: "Rin",
    roomTitle: "랜덤 테스트방",
  });
  const roomD = await clientD.joinOrCreate("ochess", { name: "Sora" });

  await waitForState(roomC, (state) => state.players.size === 2);
  await waitForState(roomD, (state) => state.players.size === 2);

  if (roomC.roomId !== roomD.roomId) {
    throw new Error(`Expected random match to share room. ${roomC.roomId} !== ${roomD.roomId}`);
  }

  await roomC.leave();
  await roomD.leave();

  console.log(
    JSON.stringify(
      {
        ok: true,
        players,
        lastMove: `${roomB.state.lastFrom}${roomB.state.lastTo}`,
        listedRoom,
        randomRoomId: roomC.roomId,
        serverLog: serverLog.trim().split("\n").slice(-2),
      },
      null,
      2,
    ),
  );
} finally {
  server.kill("SIGTERM");
}
