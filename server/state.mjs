import { schema } from "@colyseus/schema";

export const PlayerState = schema({
  sessionId: "string",
  name: "string",
  color: "string",
  connected: "boolean",
  chatText: "string",
  chatExpiresAt: "number",
});

export const OChessState = schema({
  fen: "string",
  turn: "string",
  status: "string",
  moveNumber: "number",
  moveId: "number",
  lastFrom: "string",
  lastTo: "string",
  lastSan: "string",
  capturedType: "string",
  capturedColor: "string",
  captureSquare: "string",
  gameOver: "boolean",
  winner: "string",
  players: { map: PlayerState, default: new Map() },
});
