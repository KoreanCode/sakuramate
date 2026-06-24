import { Server, matchMaker } from "colyseus";
import { OChessRoom } from "./OChessRoom.mjs";

const port = Number.parseInt(process.env.PORT ?? "2567", 10);

function roomSummary(room) {
  const metadata = room.metadata ?? {};
  const createdAt =
    metadata.createdAt || (room.createdAt instanceof Date ? room.createdAt.getTime() : Date.now());
  const playerNames = Array.isArray(metadata.playerNames) ? metadata.playerNames : [];

  return {
    id: room.roomId,
    title: metadata.roomTitle || "사쿠라 대국",
    hostName: metadata.hostName || playerNames[0] || "플레이어",
    players: Math.min(room.clients, room.maxClients),
    maxPlayers: room.maxClients,
    playerNames,
    status: metadata.status || (room.clients < room.maxClients ? "대기 중" : "대국 중"),
    joinable: !room.locked && !room.private && room.clients < room.maxClients,
    inProgress: Boolean(metadata.inProgress),
    createdAt,
  };
}

const gameServer = new Server({
  express: (app) => {
    app.use((request, response, next) => {
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (request.method === "OPTIONS") {
        response.sendStatus(204);
        return;
      }

      next();
    });

    app.get("/health", (_request, response) => {
      response.json({ ok: true, room: "ochess" });
    });

    app.get("/rooms", async (_request, response) => {
      try {
        const rooms = await matchMaker.query({ name: "ochess" }, { createdAt: -1 });
        response.json({
          ok: true,
          rooms: rooms
            .filter((room) => !room.private && !room.unlisted)
            .map(roomSummary),
        });
      } catch (error) {
        response.status(500).json({
          ok: false,
          error: error instanceof Error ? error.message : "방 목록을 불러오지 못했어요.",
        });
      }
    });

    app.get("/", (_request, response) => {
      response.type("text/plain").send("OChess Colyseus server");
    });
  },
});
gameServer.define("ochess", OChessRoom);

gameServer.listen(port);
console.log(`[OChess] Colyseus server listening on ws://localhost:${port}`);
