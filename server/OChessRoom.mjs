import { Room } from "colyseus";
import { Chess } from "chess.js";
import { OChessState, PlayerState } from "./state.mjs";

const colorNames = {
  w: "화이트",
  b: "블랙",
};

function cleanRoomTitle(value, fallback) {
  const title = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 22);
  return title || fallback;
}

function cleanName(value, fallback) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 14);
  return name || fallback;
}

function cleanChat(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 44);
}

function statusForGame(game) {
  const turn = game.turn();

  if (game.isCheckmate()) {
    return `${colorNames[turn === "w" ? "b" : "w"]} 승리`;
  }

  if (game.isDraw()) {
    return "무승부";
  }

  if (game.isCheck()) {
    return `${colorNames[turn]} 체크`;
  }

  return `${colorNames[turn]} 턴`;
}

function firstAvailableColor(players) {
  const used = new Set();
  players.forEach((player) => used.add(player.color));

  if (!used.has("w")) {
    return "w";
  }

  if (!used.has("b")) {
    return "b";
  }

  return "";
}

function nextCounter(value) {
  return Number.isFinite(value) ? value + 1 : 1;
}

export class OChessRoom extends Room {
  maxClients = 2;

  onCreate(options) {
    this.game = new Chess();
    const hostName = cleanName(options?.name, "플레이어");
    this.roomTitle = cleanRoomTitle(options?.roomTitle, `${hostName}의 방`);
    this.createdAt = Date.now();
    this.setState(new OChessState());
    this.resetMoveMeta();
    this.state.moveId = 0;
    void this.setMetadata({
      roomTitle: this.roomTitle,
      hostName,
      playerNames: [],
      status: "상대 기다리는 중",
      inProgress: false,
      createdAt: this.createdAt,
      updatedAt: this.createdAt,
    });
    this.syncGameState();

    this.onMessage("move", (client, payload) => {
      this.handleMove(client, payload);
    });

    this.onMessage("chat", (client, payload) => {
      this.handleChat(client, payload);
    });

    this.onMessage("setName", (client, payload) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.name = cleanName(payload?.name, player.name);
      }
    });

    this.onMessage("restart", (client) => {
      if (!this.state.players.has(client.sessionId)) {
        return;
      }

      this.game.reset();
      this.resetMoveMeta();
      this.state.moveId = nextCounter(this.state.moveId);
      this.syncGameState();
    });
  }

  onJoin(client, options) {
    const color = firstAvailableColor(this.state.players);

    if (!color) {
      client.leave(4001);
      return;
    }

    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.name = cleanName(options?.name, color === "w" ? "화이트" : "블랙");
    player.color = color;
    player.connected = true;
    player.chatText = "";
    player.chatExpiresAt = 0;

    this.state.players.set(client.sessionId, player);
    this.syncGameState();
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.syncGameState();
  }

  handleMove(client, payload) {
    const player = this.state.players.get(client.sessionId);

    if (!player) {
      return;
    }

    if (this.game.isGameOver()) {
      client.send("move-error", { reason: "이미 종료된 판이에요." });
      return;
    }

    if (this.game.turn() !== player.color) {
      client.send("move-error", { reason: "지금은 상대 턴이에요." });
      return;
    }

    const from = String(payload?.from ?? "");
    const to = String(payload?.to ?? "");
    const promotion = payload?.promotion ? String(payload.promotion) : undefined;
    const move = this.game.move({ from, to, promotion });

    if (!move) {
      client.send("move-error", { reason: "둘 수 없는 수예요." });
      return;
    }

    const captureSquare = move.isEnPassant()
      ? `${move.to[0]}${move.from[1]}`
      : move.to;

    this.state.lastFrom = move.from;
    this.state.lastTo = move.to;
    this.state.lastSan = move.san;
    this.state.capturedType = move.captured ?? "";
    this.state.capturedColor = move.captured ? (move.color === "w" ? "b" : "w") : "";
    this.state.captureSquare = move.captured ? captureSquare : "";
    this.state.moveId = nextCounter(this.state.moveId);
    this.syncGameState();
  }

  handleChat(client, payload) {
    const player = this.state.players.get(client.sessionId);
    const text = cleanChat(payload?.text);

    if (!player || !text) {
      return;
    }

    const expiresAt = Date.now() + 3600;
    player.chatText = text;
    player.chatExpiresAt = expiresAt;

    this.clock.setTimeout(() => {
      const current = this.state.players.get(client.sessionId);
      if (current && current.chatExpiresAt === expiresAt) {
        current.chatText = "";
        current.chatExpiresAt = 0;
      }
    }, 3600);
  }

  syncGameState() {
    this.state.fen = this.game.fen();
    this.state.turn = this.game.turn();
    this.state.status =
      this.state.players.size < 2 ? "상대 기다리는 중" : statusForGame(this.game);
    this.state.moveNumber = this.game.history().length;
    this.state.gameOver = this.game.isGameOver();
    this.state.winner = this.game.isCheckmate()
      ? this.game.turn() === "w"
        ? "b"
        : "w"
      : "";

    this.updateRoomListing();
  }

  resetMoveMeta() {
    this.state.lastFrom = "";
    this.state.lastTo = "";
    this.state.lastSan = "";
    this.state.capturedType = "";
    this.state.capturedColor = "";
    this.state.captureSquare = "";
  }

  updateRoomListing() {
    const players = [...this.state.players.values()];

    void this.setMetadata({
      roomTitle: this.roomTitle,
      hostName: players[0]?.name || this.metadata?.hostName || "플레이어",
      playerNames: players.map((player) => player.name),
      status: this.state.status,
      inProgress: this.game.history().length > 0,
      updatedAt: Date.now(),
    });
  }
}
