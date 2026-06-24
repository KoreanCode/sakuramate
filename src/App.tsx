import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Client as ColyseusClient, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Chess, type Color, type Move, type Piece, type PieceSymbol, type Square } from "chess.js";
import {
  ArrowLeft,
  Home,
  LogIn,
  MessageCircle,
  Music,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Shuffle,
  Undo2,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

type AppScreen = "home" | "game";
type PlayMode = "single" | "multi";
type PieceKind = "pawn" | "rook" | "knight" | "bishop" | "queen" | "king";
type PieceState = "idle" | "selected" | "attack" | "hurt" | "defeated";
type MotionMap = Partial<Record<Square, PieceState>>;

type CaptureGhost = {
  id: number;
  square: Square;
  piece: Piece;
  state: Extract<PieceState, "hurt" | "defeated">;
};

type PendingPromotion = {
  choices: PieceSymbol[];
  color: Color;
  from: Square;
  to: Square;
};

type SavedGame = {
  orientation?: Color;
  pgn?: string;
  savedAt?: string;
};

type StorageNotice = "save-reset" | "save-unavailable";
type SoundCue = "select" | "move" | "attack" | "hurt" | "defeat" | "check" | "checkmate";
type SoundDetail = {
  piece?: PieceSymbol;
};

type InitialGameState = {
  fen: string;
  game: Chess;
  orientation: Color;
  notice: StorageNotice | null;
};

type MultiplayerStatus = "idle" | "connecting" | "connected" | "error";
type HomeMode = "menu" | "lobby";
type LobbyView = "list" | "create";
type LobbyStatus = "idle" | "loading" | "ready" | "error";

type MultiplayerPlayer = {
  sessionId: string;
  name: string;
  color: Color;
  connected: boolean;
  chatText: string;
  chatExpiresAt: number;
};

type MultiplayerState = {
  status: MultiplayerStatus;
  roomId: string | null;
  sessionId: string | null;
  color: Color | null;
  statusText: string;
  error: string | null;
  players: MultiplayerPlayer[];
  moveNumber: number;
  moveId: number;
  lastSan: string;
};

type RoomSummary = {
  id: string;
  title: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  playerNames: string[];
  status: string;
  joinable: boolean;
  inProgress: boolean;
  createdAt: number;
};

type RoomListState = {
  status: LobbyStatus;
  rooms: RoomSummary[];
  error: string | null;
};

type RemotePlayerState = {
  sessionId?: string;
  name?: string;
  color?: string;
  connected?: boolean;
  chatText?: string;
  chatExpiresAt?: number;
};

type OChessServerState = {
  fen?: string;
  status?: string;
  moveNumber?: number;
  moveId?: number;
  lastFrom?: string;
  lastTo?: string;
  lastSan?: string;
  capturedType?: string;
  capturedColor?: string;
  captureSquare?: string;
  players?: {
    forEach(callback: (player: RemotePlayerState, sessionId: string) => void): void;
    size?: number;
  };
};

type OChessClientRoom = ColyseusRoom<unknown, OChessServerState>;

const storageKey = "ochess:game:v1";
const nicknameKey = "ochess:nickname";
const soundKey = "ochess:sound:v1";
const musicKey = "ochess:music:v1";
const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const ranks = [8, 7, 6, 5, 4, 3, 2, 1] as const;

const pieceKinds: Record<PieceSymbol, PieceKind> = {
  p: "pawn",
  r: "rook",
  n: "knight",
  b: "bishop",
  q: "queen",
  k: "king",
};

const pieceNames: Record<PieceSymbol, string> = {
  p: "폰",
  r: "룩",
  n: "나이트",
  b: "비숍",
  q: "퀸",
  k: "킹",
};

const sideNames: Record<Color, string> = {
  w: "화이트",
  b: "블랙",
};

const initialMultiplayerState: MultiplayerState = {
  status: "idle",
  roomId: null,
  sessionId: null,
  color: null,
  statusText: "",
  error: null,
  players: [],
  moveNumber: 0,
  moveId: 0,
  lastSan: "",
};

const initialRoomListState: RoomListState = {
  status: "idle",
  rooms: [],
  error: null,
};

const storageNoticeText: Record<StorageNotice, string> = {
  "save-reset": "저장된 판을 불러오지 못해 새 판으로 시작했어요.",
  "save-unavailable": "이 브라우저에서는 자동 저장을 사용할 수 없어요.",
};

const promotionOrder: PieceSymbol[] = ["q", "n", "r", "b"];
const attackMarkerPath = "/assets/ui/attack-marker.png";
const pieceValues: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const preloadFrames = Object.values(pieceKinds).flatMap((kind) =>
  (["idle", "selected", "attack", "hurt", "defeated"] as const).map(
    (state) => `/assets/frames/${kind}/${state}.png`,
  ),
);

function freshInitialGameState(notice: StorageNotice | null = null): InitialGameState {
  const game = new Chess();
  return { game, fen: game.fen(), orientation: "w", notice };
}

function readInitialGameState(): InitialGameState {
  if (typeof window === "undefined") {
    return freshInitialGameState();
  }

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return freshInitialGameState("save-unavailable");
  }

  if (!raw) {
    return freshInitialGameState();
  }

  try {
    const saved = JSON.parse(raw) as SavedGame;
    const game = new Chess();

    if (saved.pgn) {
      game.loadPgn(saved.pgn);
    }

    return {
      game,
      fen: game.fen(),
      orientation: "w",
      notice: null,
    };
  } catch {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // If storage itself is unavailable, the fresh board is still usable.
    }

    return freshInitialGameState("save-reset");
  }
}

function writeSavedGame(game: Chess, orientation: Color): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        orientation,
        pgn: game.pgn(),
        savedAt: new Date().toISOString(),
      } satisfies SavedGame),
    );

    return true;
  } catch {
    // Storage can fail in private browsing or quota-limited environments.
    return false;
  }
}

function readNickname(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage.getItem(nicknameKey) ?? "";
  } catch {
    return "";
  }
}

function writeNickname(name: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(nicknameKey, name);
  } catch {
    // Nickname persistence is optional; gameplay can continue without it.
  }
}

function readSoundPreference(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(soundKey) !== "off";
  } catch {
    return true;
  }
}

function writeSoundPreference(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(soundKey, enabled ? "on" : "off");
  } catch {
    // Sound preference is optional; gameplay should not depend on storage.
  }
}

function readMusicPreference(): boolean {
  if (typeof window === "undefined") {
    return true;
  }

  try {
    return window.localStorage.getItem(musicKey) !== "off";
  } catch {
    return true;
  }
}

function writeMusicPreference(enabled: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(musicKey, enabled ? "on" : "off");
  } catch {
    // Music preference is optional; gameplay should not depend on storage.
  }
}

function fallbackNickname(): string {
  return `플레이어${Math.floor(100 + Math.random() * 900)}`;
}

function cleanNickname(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 14);
}

function cleanRoomTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 22);
}

function colyseusEndpoint(): string {
  if (typeof window === "undefined") {
    return "http://localhost:2567";
  }

  const configured = import.meta.env.VITE_COLYSEUS_URL;
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${window.location.hostname}:2567`;
}

function roomsEndpoint(): string {
  return `${colyseusEndpoint().replace(/\/$/, "")}/rooms`;
}

function asColor(value: string | undefined): Color | null {
  return value === "w" || value === "b" ? value : null;
}

function asPieceSymbol(value: string | undefined): PieceSymbol | null {
  return value === "p" ||
    value === "r" ||
    value === "n" ||
    value === "b" ||
    value === "q" ||
    value === "k"
    ? value
    : null;
}

function numberOrZero(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function readServerPlayers(players: OChessServerState["players"]): MultiplayerPlayer[] {
  const list: MultiplayerPlayer[] = [];

  players?.forEach((player, sessionId) => {
    const color = asColor(player.color);
    if (!color) {
      return;
    }

    list.push({
      sessionId: player.sessionId || sessionId,
      name: player.name || sideNames[color],
      color,
      connected: player.connected !== false,
      chatText: player.chatText || "",
      chatExpiresAt: numberOrZero(player.chatExpiresAt),
    });
  });

  return list.sort((a, b) => (a.color === b.color ? 0 : a.color === "w" ? -1 : 1));
}

function buildSquares(orientation: Color): Square[] {
  const rankList = orientation === "w" ? ranks : [...ranks].reverse();
  const fileList = orientation === "w" ? files : [...files].reverse();

  return rankList.flatMap((rank) =>
    fileList.map((file) => `${file}${rank}` as Square),
  );
}

function statusText(game: Chess): string {
  const turn = game.turn();

  if (game.isCheckmate()) {
    return `${sideNames[turn === "w" ? "b" : "w"]} 체크메이트`;
  }

  if (game.isDraw()) {
    return "무승부";
  }

  if (game.isCheck()) {
    return `${sideNames[turn]} 체크`;
  }

  return `${sideNames[turn]} 턴`;
}

function chooseSinglePlayerMove(game: Chess): Move | null {
  const moves = game.moves({ verbose: true });

  if (moves.length === 0) {
    return null;
  }

  const centerSquares = new Set(["d4", "d5", "e4", "e5"]);
  const nearCenterSquares = new Set(["c4", "c5", "d3", "d6", "e3", "e6", "f4", "f5"]);
  const openingBoosts = new Map([
    ["e7e5", 28],
    ["g8f6", 24],
    ["b8c6", 16],
    ["f8c5", 12],
    ["d7d5", 10],
  ]);

  return moves
    .map((move, index) => {
      const key = `${move.from}${move.to}`;
      let score = openingBoosts.get(key) ?? 0;

      if (move.captured) {
        score += 80 + pieceValues[move.captured] * 12;
      }

      if (move.promotion) {
        score += pieceValues[move.promotion] * 10;
      }

      if (centerSquares.has(move.to)) {
        score += 8;
      } else if (nearCenterSquares.has(move.to)) {
        score += 4;
      }

      if (move.piece !== "p" && move.from.endsWith("8")) {
        score += 5;
      }

      if (move.san.includes("#")) {
        score += 120;
      } else if (move.san.includes("+")) {
        score += 18;
      }

      return { index, move, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].move;
}

function findKingSquare(game: Chess, color: Color): Square | null {
  for (const file of files) {
    for (const rank of ranks) {
      const square = `${file}${rank}` as Square;
      const piece = game.get(square);

      if (piece?.type === "k" && piece.color === color) {
        return square;
      }
    }
  }

  return null;
}

function promotionChoicesForMove(game: Chess, from: Square, to: Square): PieceSymbol[] {
  const choices = game
    .moves({ square: from, verbose: true })
    .filter((move) => move.to === to && move.promotion)
    .map((move) => move.promotion as PieceSymbol);

  return promotionOrder.filter((choice) => choices.includes(choice));
}

function spritePath(piece: Piece, state: PieceState): string {
  return `/assets/frames/${pieceKinds[piece.type]}/${state}.png`;
}

function PieceSprite({
  piece,
  state,
  squareIndex,
  compact = false,
}: {
  piece: Piece;
  state: PieceState;
  squareIndex: number;
  compact?: boolean;
}) {
  const label = `${sideNames[piece.color]} ${pieceNames[piece.type]}`;

  return (
    <img
      className={[
        "piece-sprite",
        `piece-${piece.color}`,
        `piece-kind-${pieceKinds[piece.type]}`,
        `state-${state}`,
        compact ? "piece-compact" : "",
      ].join(" ")}
      src={spritePath(piece, state)}
      alt={label}
      draggable={false}
      style={{ "--delay": `${(squareIndex % 7) * -0.16}s` } as React.CSSProperties}
    />
  );
}

function CapturedTray({
  title,
  pieces,
}: {
  title: string;
  pieces: Piece[];
}) {
  return (
    <section className="capture-tray" aria-label={`${title} ${pieces.length}개`}>
      <div className={["captured-list", pieces.length === 0 ? "is-empty" : ""].join(" ")}>
        {pieces.length > 0
          ? pieces.map((piece, index) => (
              <span className="captured-piece" key={`${piece.color}-${piece.type}-${index}`}>
                <PieceSprite
                  piece={piece}
                  state="idle"
                  squareIndex={index}
                  compact
                />
              </span>
            ))
          : Array.from({ length: 6 }, (_, index) => (
              <span className="capture-slot" key={index} aria-hidden="true" />
            ))}
      </div>
    </section>
  );
}

function HomeScreen({
  canContinue,
  homeMode,
  lobbyView,
  nickname,
  multiplayerStatus,
  multiplayerError,
  roomList,
  roomTitle,
  onContinue,
  onCloseLobby,
  onCreateRoom,
  onJoinRoom,
  onLobbyViewChange,
  onOpenLobby,
  onRandomMatch,
  onRefreshRooms,
  onRoomTitleChange,
  onStartSingle,
  onNicknameChange,
}: {
  canContinue: boolean;
  homeMode: HomeMode;
  lobbyView: LobbyView;
  nickname: string;
  multiplayerStatus: MultiplayerStatus;
  multiplayerError: string | null;
  roomList: RoomListState;
  roomTitle: string;
  onContinue: () => void;
  onCloseLobby: () => void;
  onCreateRoom: (event: FormEvent<HTMLFormElement>) => void;
  onJoinRoom: (roomId: string) => void;
  onLobbyViewChange: (view: LobbyView) => void;
  onOpenLobby: () => void;
  onRandomMatch: () => void;
  onRefreshRooms: () => void;
  onRoomTitleChange: (value: string) => void;
  onStartSingle: () => void;
  onNicknameChange: (value: string) => void;
}) {
  const isConnecting = multiplayerStatus === "connecting";
  const isLobby = homeMode === "lobby";
  const isRoomList = lobbyView === "list";

  return (
    <section className="home-screen" aria-label="사쿠라메이트 홈">
      <div className={["home-copy", isLobby ? "is-lobby" : ""].join(" ")}>
        <h1 className="home-logo-heading">
          <img
            className="home-title-logo"
            src="/assets/ui/sakura-mate-logo-v2.png"
            alt="사쿠라메이트"
            draggable={false}
          />
          <span className="visually-hidden">사쿠라메이트</span>
        </h1>

        {isLobby ? (
          <div className="lobby-panel" aria-label="멀티플레이 로비">
            <div className="lobby-head">
              <button
                type="button"
                className="lobby-icon-button"
                title="뒤로"
                aria-label="홈 메뉴로 돌아가기"
                onClick={onCloseLobby}
                disabled={isConnecting}
              >
                <ArrowLeft size={16} />
              </button>
              <div>
                <span>멀티플레이</span>
                <b>대국 방</b>
              </div>
              <button
                type="button"
                className="lobby-icon-button"
                title="새로고침"
                aria-label="방 목록 새로고침"
                onClick={onRefreshRooms}
                disabled={isConnecting || roomList.status === "loading"}
              >
                <RefreshCw size={16} />
              </button>
            </div>

            <label className="home-nickname lobby-nickname">
              <span>닉네임</span>
              <input
                type="text"
                value={nickname}
                maxLength={14}
                placeholder="플레이어"
                aria-label="멀티플레이 닉네임"
                onChange={(event) => onNicknameChange(event.target.value)}
                disabled={isConnecting}
              />
            </label>

            <div className="lobby-tabs" role="tablist" aria-label="멀티플레이 메뉴">
              <button
                type="button"
                className={isRoomList ? "is-active" : ""}
                role="tab"
                aria-selected={isRoomList}
                onClick={() => onLobbyViewChange("list")}
              >
                <Users size={15} />
                <span>방 리스트</span>
              </button>
              <button
                type="button"
                className={!isRoomList ? "is-active" : ""}
                role="tab"
                aria-selected={!isRoomList}
                onClick={() => onLobbyViewChange("create")}
              >
                <Plus size={15} />
                <span>방 생성</span>
              </button>
            </div>

            {isRoomList ? (
              <div className="lobby-view" role="tabpanel" aria-label="방 리스트">
                <button
                  type="button"
                  className="home-secondary random-match-button"
                  aria-label="랜덤 매칭"
                  onClick={onRandomMatch}
                  disabled={isConnecting}
                >
                  <Shuffle size={16} />
                  <span>{isConnecting ? "연결 중" : "랜덤 매칭"}</span>
                </button>

                <div className="room-list" aria-label="방 리스트">
                  {roomList.status === "loading" ? (
                    <div className="room-list-state">방 찾는 중</div>
                  ) : roomList.rooms.length === 0 ? (
                    <div className="room-list-state">대기 중인 방 없음</div>
                  ) : (
                    roomList.rooms.map((room) => (
                      <article className="room-card" key={room.id}>
                        <div className="room-card-main">
                          <b>{room.title}</b>
                          <span>{room.hostName}</span>
                        </div>
                        <div className="room-card-side">
                          <span>
                            {room.players}/{room.maxPlayers}
                          </span>
                          <small>{room.inProgress ? "진행 중" : room.status}</small>
                        </div>
                        <button
                          type="button"
                          className="room-join-button"
                          aria-label={`${room.title} 참여하기`}
                          onClick={() => onJoinRoom(room.id)}
                          disabled={!room.joinable || isConnecting}
                        >
                          <LogIn size={15} />
                          <span>참여</span>
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <form
                className="room-create-form lobby-view"
                onSubmit={onCreateRoom}
                role="tabpanel"
                aria-label="방 생성"
              >
                <label className="room-title-field">
                  <span>방 이름</span>
                  <input
                    type="text"
                    value={roomTitle}
                    maxLength={22}
                    placeholder="방 이름"
                    aria-label="방 이름"
                    onChange={(event) => onRoomTitleChange(event.target.value)}
                    disabled={isConnecting}
                  />
                </label>
                <button
                  type="submit"
                  className="home-primary"
                  aria-label="방 생성"
                  disabled={isConnecting}
                >
                  <Plus size={16} />
                  <span>{isConnecting ? "생성 중" : "방 생성"}</span>
                </button>
              </form>
            )}

            {roomList.error ? (
              <p className="home-error" role="alert">
                {roomList.error}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <p>가볍게 한 판 시작</p>
            <label className="home-nickname">
              <span>닉네임</span>
              <input
                type="text"
                value={nickname}
                maxLength={14}
                placeholder="플레이어"
                aria-label="멀티플레이 닉네임"
                onChange={(event) => onNicknameChange(event.target.value)}
              />
            </label>
            <div className="home-actions">
              <button
                type="button"
                className="home-primary"
                aria-label="싱글플레이 시작"
                onClick={onStartSingle}
              >
                <Play size={18} fill="currentColor" />
                <span>싱글플레이</span>
              </button>
              <button
                type="button"
                className="home-secondary home-multi"
                aria-label="멀티플레이 시작"
                onClick={onOpenLobby}
                disabled={isConnecting}
              >
                <Users size={17} />
                <span>{isConnecting ? "연결 중" : "멀티플레이"}</span>
              </button>
              {canContinue ? (
                <button
                  type="button"
                  className="home-secondary"
                  aria-label="저장된 게임 이어하기"
                  onClick={onContinue}
                >
                  이어하기
                </button>
              ) : null}
            </div>
          </>
        )}

        {multiplayerError ? (
          <p className="home-error" role="alert">
            {multiplayerError}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function MultiplayerDock({
  multiplayer,
  chatDraft,
  onChatDraftChange,
  onSendChat,
}: {
  multiplayer: MultiplayerState;
  chatDraft: string;
  onChatDraftChange: (value: string) => void;
  onSendChat: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const sideLabel = multiplayer.color ? sideNames[multiplayer.color] : "대기";
  const connected = multiplayer.status === "connected";

  return (
    <section className="multiplayer-dock" aria-label="멀티플레이 채팅">
      <div className="multiplayer-meta">
        <span>{sideLabel}</span>
        <b>{multiplayer.players.length}/2</b>
      </div>
      <form className="chat-form" onSubmit={onSendChat}>
        <MessageCircle size={15} aria-hidden="true" />
        <input
          type="text"
          value={chatDraft}
          maxLength={44}
          placeholder={connected ? "채팅" : "연결 대기"}
          aria-label="멀티플레이 채팅 입력"
          disabled={!connected}
          onChange={(event) => onChatDraftChange(event.target.value)}
        />
        <button
          type="submit"
          title="전송"
          aria-label="채팅 전송"
          disabled={!connected || chatDraft.trim().length === 0}
        >
          <Send size={15} />
        </button>
      </form>
      {multiplayer.error ? <span className="multiplayer-error">{multiplayer.error}</span> : null}
    </section>
  );
}

function getCapturedPieces(history: Move[]): Record<Color, Piece[]> {
  return history.reduce<Record<Color, Piece[]>>(
    (acc, move) => {
      if (!move.captured) {
        return acc;
      }

      const capturedColor: Color = move.color === "w" ? "b" : "w";
      acc[capturedColor].push({ type: move.captured, color: capturedColor });
      return acc;
    },
    { w: [], b: [] },
  );
}

function clearSquareMotion(
  square: Square,
  setMotions: React.Dispatch<React.SetStateAction<MotionMap>>,
) {
  window.setTimeout(() => {
    setMotions((current) => {
      const next = { ...current };
      delete next[square];
      return next;
    });
  }, 520);
}

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type OChessAudioEngine = {
  play(cue: SoundCue, detail?: SoundDetail): void;
  startMusic(): void;
  stopMusic(): void;
  stopVoices(): void;
};

type PieceVoiceProfile = {
  pitch: number;
  rate: number;
  toneRatio: number;
  lines: Record<SoundCue, string[]>;
};

const defaultSoundLines: Record<SoundCue, string[]> = {
  select: ["응?", "갈까요?", "저예요?"],
  move: ["슝!", "사뿐!", "가볼게요!"],
  attack: ["얍!", "받아주세요!", "틈이에요!"],
  hurt: ["아잉!", "너무해요!", "히잉!"],
  defeat: ["먼저 쉴게요", "졌어요오", "후퇴할게요"],
  check: ["체크예요!", "조심하세요!"],
  checkmate: ["체크메이트!", "끝났어요!"],
};

const pieceVoiceProfiles: Record<PieceSymbol, PieceVoiceProfile> = {
  p: {
    pitch: 1.92,
    rate: 1.5,
    toneRatio: 1.08,
    lines: {
      select: ["네에?", "제가요?", "불렀어요?"],
      move: ["총총 갈게요", "한 칸씩!", "쪼르르"],
      attack: ["콩!", "살짝 콕!", "미안해요!"],
      hurt: ["아잉!", "아팠어요", "흐잉"],
      defeat: ["먼저 쉴게요", "퇴근할게요", "졌어요오"],
      check: ["체크예요!", "제가 해냈어요!"],
      checkmate: ["제가 끝냈어요!", "이겼다아!"],
    },
  },
  n: {
    pitch: 1.82,
    rate: 1.47,
    toneRatio: 1.16,
    lines: {
      select: ["출동할까요?", "빙글 갈게요?", "제 차례죠?"],
      move: ["점프할게요", "빙글 착지!", "깡총 아니고 점프!"],
      attack: ["옆구리 콕!", "방심했죠?", "휘리릭!"],
      hurt: ["어라라?", "넘어졌어요", "아야야"],
      defeat: ["착지 실패요", "다음엔 이겨요", "잠깐 쉬어요"],
      check: ["체크, 놀랐죠?", "길 막았어요!"],
      checkmate: ["완벽 착지!", "체크메이트예요!"],
    },
  },
  b: {
    pitch: 1.74,
    rate: 1.34,
    toneRatio: 0.96,
    lines: {
      select: ["기도할까요?", "부드럽게요", "제가 볼게요"],
      move: ["사선으로 살랑", "빛 따라 갈게요", "조용히 갈게요"],
      attack: ["반짝 찌르기", "빈틈 보였어요", "빛이에요!"],
      hurt: ["아프네요", "너무하세요", "흐음"],
      defeat: ["기도는 여기까지", "잠시 물러나요", "졌네요"],
      check: ["성스러운 체크", "왕관이 보여요"],
      checkmate: ["기도가 닿았어요", "체크메이트입니다"],
    },
  },
  r: {
    pitch: 1.62,
    rate: 1.28,
    toneRatio: 0.88,
    lines: {
      select: ["지켜드릴게요", "정면인가요?", "든든하게요"],
      move: ["직진합니다", "성큼 갈게요", "길을 열게요"],
      attack: ["꽝이에요!", "밀어붙여요!", "정면 돌파!"],
      hurt: ["버틸게요", "꽤 아파요", "아직 괜찮아요"],
      defeat: ["방어 실패요", "성문 닫아요", "물러납니다"],
      check: ["정면 체크!", "피할 길 없어요"],
      checkmate: ["방어선 완성!", "체크메이트예요"],
    },
  },
  q: {
    pitch: 1.7,
    rate: 1.36,
    toneRatio: 1.02,
    lines: {
      select: ["맡겨주세요", "여왕님 등장이에요", "화려하게요?"],
      move: ["반짝 이동", "우아하게 갈게요", "무대 중앙으로"],
      attack: ["피날레예요!", "반짝 끝!", "제 차례예요!"],
      hurt: ["어머?", "드레스 구겨졌어요", "무례해요"],
      defeat: ["오늘은 봐드릴게요", "왕관은 맡길게요", "퇴장합니다"],
      check: ["체크, 우아하게", "도망치지 마세요"],
      checkmate: ["체크메이트예요", "무대 종료예요"],
    },
  },
  k: {
    pitch: 1.56,
    rate: 1.22,
    toneRatio: 0.82,
    lines: {
      select: ["나 지켜줘요", "왕관 조심", "천천히 갈래요"],
      move: ["살금살금", "한 발만요", "조심히 갈게요"],
      attack: ["저도 할 수 있어요", "살짝만!", "왕관 펀치!"],
      hurt: ["꺄악!", "큰일이에요", "도와줘요"],
      defeat: ["왕관 내려놔요", "졌어요...", "다음 판 가요"],
      check: ["저 체크래요!", "위험해요!"],
      checkmate: ["체크메이트라니", "왕국 종료예요"],
    },
  },
};

const soundPriority: Record<SoundCue, number> = {
  select: 1,
  move: 1,
  hurt: 2,
  attack: 3,
  defeat: 4,
  check: 5,
  checkmate: 6,
};

function createOChessAudioEngine(): OChessAudioEngine {
  let audioContext: AudioContext | null = null;
  let musicGain: GainNode | null = null;
  let musicTimer: number | null = null;
  let musicBar = 0;
  let activeVoiceToken = 0;
  let pendingVoice: VoiceRequest | null = null;
  let voiceTimer: number | null = null;
  let lastVoiceStartedAt = 0;

  type VoiceRequest = {
    cue: SoundCue;
    piece?: PieceSymbol;
    text: string;
    pitch: number;
    rate: number;
    volume: number;
    priority: number;
    createdAt: number;
  };

  function ensureContext(): AudioContext | null {
    if (typeof window === "undefined") {
      return null;
    }

    if (!audioContext) {
      const audioWindow = window as AudioWindow;
      const AudioContextConstructor =
        audioWindow.AudioContext ?? audioWindow.webkitAudioContext;

      if (!AudioContextConstructor) {
        return null;
      }

      audioContext = new AudioContextConstructor();
    }

    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }

    return audioContext;
  }

  function playTone(
    frequency: number,
    delay: number,
    duration: number,
    volume: number,
    type: OscillatorType = "triangle",
  ) {
    const context = ensureContext();
    if (!context) {
      return;
    }

    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function ensureMusicGain(): { context: AudioContext; gain: GainNode } | null {
    const context = ensureContext();

    if (!context) {
      return null;
    }

    if (!musicGain) {
      musicGain = context.createGain();
      musicGain.gain.setValueAtTime(0.0001, context.currentTime);
      musicGain.connect(context.destination);
    }

    return { context, gain: musicGain };
  }

  function playMusicTone(
    context: AudioContext,
    destination: GainNode,
    frequency: number,
    start: number,
    duration: number,
    volume: number,
    type: OscillatorType = "triangle",
  ) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }

  function scheduleMusicBar() {
    const music = ensureMusicGain();

    if (!music) {
      return;
    }

    const { context, gain } = music;
    const beat = 0.46;
    const base = context.currentTime + 0.06;
    const melodyPatterns = [
      [659.25, 783.99, 880, 783.99, 659.25, 587.33, 659.25, 493.88],
      [587.33, 659.25, 783.99, 987.77, 880, 783.99, 659.25, 587.33],
      [493.88, 587.33, 659.25, 783.99, 659.25, 587.33, 493.88, 440],
      [523.25, 659.25, 783.99, 880, 987.77, 880, 783.99, 659.25],
    ];
    const bassPatterns = [
      [164.81, 164.81, 196, 196],
      [146.83, 146.83, 196, 196],
      [130.81, 130.81, 164.81, 164.81],
      [146.83, 164.81, 196, 246.94],
    ];
    const melody = melodyPatterns[musicBar % melodyPatterns.length];
    const bass = bassPatterns[musicBar % bassPatterns.length];

    melody.forEach((frequency, index) => {
      const start = base + index * beat;
      playMusicTone(context, gain, frequency, start, beat * 0.58, 0.018, "triangle");

      if (index % 2 === 0) {
        playMusicTone(context, gain, frequency * 2, start + 0.03, beat * 0.34, 0.006, "sine");
      }
    });

    bass.forEach((frequency, index) => {
      playMusicTone(context, gain, frequency, base + index * beat * 2, beat * 1.15, 0.012, "sine");
    });

    musicBar += 1;
  }

  function playNoise(delay: number, duration: number, volume: number) {
    const context = ensureContext();
    if (!context) {
      return;
    }

    const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);

    for (let index = 0; index < frameCount; index += 1) {
      const fade = 1 - index / frameCount;
      data[index] = (Math.random() * 2 - 1) * fade;
    }

    const start = context.currentTime + delay;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = buffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(1200, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  function chooseVoice(): SpeechSynthesisVoice | null {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return null;
    }

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find((voice) => {
      const name = voice.name.toLowerCase();
      const lang = voice.lang.toLowerCase();

      return (
        /yuna|sora|kyoko|nanami|haruka|sayaka|miyu|heami|sunhi|nayeon/i.test(name) ||
        (/google/i.test(name) && (/ko|ja|korean|japanese|한국|日本語/i.test(name) || /^ko|^ja/.test(lang)))
      );
    });

    return (
      preferredVoice ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith("ko")) ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith("ja")) ??
      null
    );
  }

  function stopVoiceLane() {
    if (typeof window !== "undefined" && voiceTimer !== null) {
      window.clearTimeout(voiceTimer);
    }

    voiceTimer = null;
    pendingVoice = null;
    activeVoiceToken = 0;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function voiceDurationMs(request: VoiceRequest): number {
    const textLength = [...request.text].length;
    const cueBase = request.cue === "checkmate" ? 620 : request.cue === "defeat" ? 520 : 420;

    return Math.min(880, Math.max(360, cueBase + (textLength * 26) / request.rate));
  }

  function finishVoice(token: number) {
    if (token !== activeVoiceToken) {
      return;
    }

    if (typeof window !== "undefined" && voiceTimer !== null) {
      window.clearTimeout(voiceTimer);
    }

    voiceTimer = null;
    activeVoiceToken = 0;

    if (!pendingVoice) {
      return;
    }

    const nextVoice = pendingVoice;
    pendingVoice = null;

    if (Date.now() - nextVoice.createdAt > 900) {
      return;
    }

    const wait = Math.max(0, 110 - (Date.now() - lastVoiceStartedAt));
    voiceTimer = window.setTimeout(() => startVoice(nextVoice), wait);
  }

  function startVoice(request: VoiceRequest) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const token = activeVoiceToken + 1;
    activeVoiceToken = token;
    lastVoiceStartedAt = Date.now();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(request.text);
    const voice = chooseVoice();

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "ko-KR";
    }

    utterance.pitch = request.pitch;
    utterance.rate = request.rate;
    utterance.volume = request.volume;
    utterance.onend = () => finishVoice(token);
    utterance.onerror = () => finishVoice(token);

    window.speechSynthesis.speak(utterance);

    if (voiceTimer !== null) {
      window.clearTimeout(voiceTimer);
    }

    voiceTimer = window.setTimeout(() => finishVoice(token), voiceDurationMs(request));
  }

  function queueVoice(request: VoiceRequest) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    if (activeVoiceToken !== 0) {
      if (!pendingVoice || request.priority >= pendingVoice.priority) {
        pendingVoice = request;
      }
      return;
    }

    const wait = Math.max(0, 110 - (Date.now() - lastVoiceStartedAt));
    if (wait > 0) {
      pendingVoice = request;

      if (voiceTimer === null) {
        voiceTimer = window.setTimeout(() => {
          const nextVoice = pendingVoice;
          pendingVoice = null;
          voiceTimer = null;

          if (nextVoice) {
            startVoice(nextVoice);
          }
        }, wait);
      }
      return;
    }

    startVoice(request);
  }

  function buildVoiceRequest(cue: SoundCue, piece?: PieceSymbol): VoiceRequest {
    const profile = piece ? pieceVoiceProfiles[piece] : null;
    const options = profile?.lines[cue] ?? defaultSoundLines[cue];
    const text = options[Math.floor(Math.random() * options.length)];
    const cuePitchOffset = cue === "hurt" ? 0.08 : cue === "defeat" ? -0.14 : cue === "checkmate" ? 0.02 : 0;
    const cueRateOffset = cue === "checkmate" ? -0.12 : cue === "defeat" ? -0.08 : 0;

    return {
      cue,
      piece,
      text,
      pitch: Math.min(2, Math.max(1.1, (profile?.pitch ?? 1.78) + cuePitchOffset)),
      rate: Math.min(1.62, Math.max(1.08, (profile?.rate ?? 1.38) + cueRateOffset)),
      volume: cue === "hurt" || cue === "defeat" ? 0.72 : 0.64,
      priority: soundPriority[cue],
      createdAt: Date.now(),
    };
  }

  function speak(cue: SoundCue, piece?: PieceSymbol) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    queueVoice(buildVoiceRequest(cue, piece));
  }

  return {
    play(cue, detail) {
      const toneRatio = detail?.piece ? pieceVoiceProfiles[detail.piece].toneRatio : 1;

      switch (cue) {
        case "select":
          playTone(760 * toneRatio, 0, 0.075, 0.055);
          playTone(1140 * toneRatio, 0.04, 0.09, 0.04);
          speak(cue, detail?.piece);
          break;
        case "move":
          playTone(540 * toneRatio, 0, 0.08, 0.04, "sine");
          playTone(860 * toneRatio, 0.045, 0.1, 0.045, "triangle");
          speak(cue, detail?.piece);
          break;
        case "attack":
          playTone(420 * toneRatio, 0, 0.06, 0.07, "sawtooth");
          playTone(940 * toneRatio, 0.045, 0.12, 0.06, "triangle");
          playNoise(0.035, 0.08, 0.055);
          speak(cue, detail?.piece);
          break;
        case "hurt":
          playTone(720 * toneRatio, 0, 0.06, 0.045, "square");
          playTone(410 * toneRatio, 0.05, 0.1, 0.04, "triangle");
          playNoise(0.015, 0.07, 0.035);
          speak(cue, detail?.piece);
          break;
        case "defeat":
          playTone(520 * toneRatio, 0, 0.12, 0.04, "triangle");
          playTone(320 * toneRatio, 0.11, 0.16, 0.04, "sine");
          speak(cue, detail?.piece);
          break;
        case "check":
          playTone(800 * toneRatio, 0, 0.08, 0.06);
          playTone(1180 * toneRatio, 0.07, 0.12, 0.055);
          playTone(1480 * toneRatio, 0.14, 0.13, 0.048);
          speak(cue, detail?.piece);
          break;
        case "checkmate":
          playTone(680 * toneRatio, 0, 0.08, 0.06);
          playTone(980 * toneRatio, 0.08, 0.1, 0.055);
          playTone(1320 * toneRatio, 0.18, 0.18, 0.052);
          speak(cue, detail?.piece);
          break;
      }
    },
    startMusic() {
      if (typeof window === "undefined" || musicTimer !== null) {
        return;
      }

      const music = ensureMusicGain();

      if (!music) {
        return;
      }

      const now = music.context.currentTime;
      music.gain.gain.cancelScheduledValues(now);
      music.gain.gain.setValueAtTime(Math.max(music.gain.gain.value, 0.0001), now);
      music.gain.gain.linearRampToValueAtTime(0.78, now + 0.42);
      scheduleMusicBar();
      musicTimer = window.setInterval(scheduleMusicBar, 3600);
    },
    stopMusic() {
      if (typeof window !== "undefined" && musicTimer !== null) {
        window.clearInterval(musicTimer);
      }

      musicTimer = null;

      if (audioContext && musicGain) {
        const now = audioContext.currentTime;
        musicGain.gain.cancelScheduledValues(now);
        musicGain.gain.setValueAtTime(Math.max(musicGain.gain.value, 0.0001), now);
        musicGain.gain.linearRampToValueAtTime(0.0001, now + 0.28);
      }
    },
    stopVoices() {
      stopVoiceLane();
    },
  };
}

export default function App() {
  const initialStateRef = useRef<InitialGameState | null>(null);
  if (!initialStateRef.current) {
    initialStateRef.current = readInitialGameState();
  }

  const gameRef = useRef(initialStateRef.current.game);
  const ghostIdRef = useRef(0);
  const roomRef = useRef<OChessClientRoom | null>(null);
  const lastServerMoveIdRef = useRef(0);
  const audioRef = useRef<OChessAudioEngine | null>(null);
  const [fen, setFen] = useState(initialStateRef.current.fen);
  const [screen, setScreen] = useState<AppScreen>("home");
  const [homeMode, setHomeMode] = useState<HomeMode>("menu");
  const [lobbyView, setLobbyView] = useState<LobbyView>("list");
  const [playMode, setPlayMode] = useState<PlayMode>("single");
  const [orientation, setOrientation] = useState<Color>(initialStateRef.current.orientation);
  const [nickname, setNickname] = useState(readNickname);
  const [roomTitle, setRoomTitle] = useState("");
  const [roomList, setRoomList] = useState<RoomListState>(initialRoomListState);
  const [chatDraft, setChatDraft] = useState("");
  const [multiplayer, setMultiplayer] = useState<MultiplayerState>(initialMultiplayerState);
  const [selected, setSelected] = useState<Square | null>(null);
  const [storageNotice, setStorageNotice] = useState<StorageNotice | null>(
    initialStateRef.current.notice,
  );
  const [motions, setMotions] = useState<MotionMap>({});
  const [ghosts, setGhosts] = useState<CaptureGhost[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [isComputerThinking, setIsComputerThinking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(readSoundPreference);
  const [musicEnabled, setMusicEnabled] = useState(readMusicPreference);

  const game = gameRef.current;
  const isInCheck = game.isCheck();
  const isCheckmate = game.isCheckmate();
  const checkAlertText = isCheckmate ? "체크메이트!" : "체크!";
  const squares = useMemo(() => buildSquares(orientation), [orientation]);
  const history = useMemo(() => game.history({ verbose: true }), [fen, game]);
  const lastMove = history[history.length - 1] ?? null;
  const checkedKingSquare = isInCheck ? findKingSquare(game, game.turn()) : null;
  const legalMoveList = useMemo(
    () => (selected ? game.moves({ square: selected, verbose: true }) : []),
    [fen, game, selected],
  );
  const legalMoves = useMemo(
    () => legalMoveList.map((move) => move.to),
    [legalMoveList],
  );
  const legalSet = useMemo(() => new Set(legalMoves), [legalMoves]);
  const attackTargetSet = useMemo(
    () =>
      new Set(
        legalMoveList.flatMap((move) => {
          if (!move.captured) {
            return [];
          }

          const captureSquare =
            typeof move.isEnPassant === "function" && move.isEnPassant()
              ? (`${move.to[0]}${move.from[1]}` as Square)
              : move.to;

          return [captureSquare];
        }),
      ),
    [legalMoveList],
  );
  const captured = useMemo(() => getCapturedPieces(history), [history]);
  const playersByColor = useMemo(
    () => new Map(multiplayer.players.map((player) => [player.color, player])),
    [multiplayer.players],
  );
  const canUndo = playMode === "single" && history.length > 0;
  const hasProgress = history.length > 0;
  const isMyMultiplayerTurn =
    playMode !== "multi" ||
    (multiplayer.status === "connected" && multiplayer.color === game.turn());
  const isSinglePlayerBotTurn =
    screen === "game" &&
    playMode === "single" &&
    game.turn() === "b" &&
    !game.isGameOver() &&
    !pendingPromotion;
  const displayStatus =
    playMode === "multi"
      ? multiplayer.status === "connecting"
        ? "멀티 연결 중"
        : multiplayer.statusText || statusText(game)
      : isComputerThinking
        ? "블랙 생각 중"
        : statusText(game);
  const moveCount = playMode === "multi" ? multiplayer.moveNumber : history.length;
  const lastMoveLabel =
    playMode === "multi" ? multiplayer.lastSan || "새 판" : lastMove ? lastMove.san : "새 판";

  useEffect(() => {
    if (playMode === "multi") {
      return;
    }

    if (!writeSavedGame(game, orientation)) {
      setStorageNotice((current) => current ?? "save-unavailable");
    }
  }, [fen, game, orientation, playMode]);

  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      if (room) {
        void room.leave();
      }

      audioRef.current?.stopMusic();
    };
  }, []);

  function clearBoardUi() {
    setSelected(null);
    setPendingPromotion(null);
    setMotions({});
    setGhosts([]);
  }

  function playSound(cue: SoundCue, piece?: PieceSymbol) {
    if (!soundEnabled) {
      return;
    }

    if (!audioRef.current) {
      audioRef.current = createOChessAudioEngine();
    }

    audioRef.current.play(cue, { piece });
  }

  function startMusicIfEnabled() {
    if (!musicEnabled) {
      return;
    }

    if (!audioRef.current) {
      audioRef.current = createOChessAudioEngine();
    }

    audioRef.current.startMusic();
  }

  function toggleSound() {
    const nextEnabled = !soundEnabled;
    setSoundEnabled(nextEnabled);
    writeSoundPreference(nextEnabled);

    if (nextEnabled) {
      if (!audioRef.current) {
        audioRef.current = createOChessAudioEngine();
      }

      audioRef.current.play("select");
    } else {
      audioRef.current?.stopVoices();
    }
  }

  function toggleMusic() {
    const nextEnabled = !musicEnabled;
    setMusicEnabled(nextEnabled);
    writeMusicPreference(nextEnabled);

    if (!audioRef.current) {
      audioRef.current = createOChessAudioEngine();
    }

    if (nextEnabled) {
      audioRef.current.startMusic();
    } else {
      audioRef.current.stopMusic();
    }
  }

  function leaveMultiplayerRoom() {
    const room = roomRef.current;
    roomRef.current = null;
    lastServerMoveIdRef.current = 0;
    setMultiplayer(initialMultiplayerState);
    setChatDraft("");

    if (room) {
      void room.leave();
    }
  }

  function syncMultiplayerState(room: OChessClientRoom, state: OChessServerState) {
    if (roomRef.current !== room) {
      return;
    }

    const serverFen = state.fen || new Chess().fen();
    let nextGame: Chess;

    try {
      nextGame = new Chess(serverFen);
    } catch {
      setMultiplayer((current) => ({
        ...current,
        status: "error",
        error: "서버 보드 상태를 읽지 못했어요.",
      }));
      return;
    }

    const players = readServerPlayers(state.players);
    const self = players.find((player) => player.sessionId === room.sessionId) ?? null;
    const nextColor = self?.color ?? null;
    const moveId = numberOrZero(state.moveId);

    gameRef.current = nextGame;
    setFen(nextGame.fen());
    setOrientation(nextColor === "b" ? "b" : "w");

    if (moveId > lastServerMoveIdRef.current) {
      const to = state.lastTo as Square | undefined;
      const capturedType = asPieceSymbol(state.capturedType);
      const capturedColor = asColor(state.capturedColor);
      const resultCue = nextGame.isCheckmate()
        ? "checkmate"
        : nextGame.isCheck()
          ? "check"
          : undefined;

      if (to) {
        const movedPiece = nextGame.get(to)?.type;

        triggerMoveMotion(
          to,
          movedPiece,
          capturedType && capturedColor ? { type: capturedType, color: capturedColor } : null,
          (state.captureSquare || to) as Square,
          resultCue,
        );
      }

      lastServerMoveIdRef.current = moveId;
    }

    setMultiplayer((current) => ({
      ...current,
      status: "connected",
      roomId: room.roomId,
      sessionId: room.sessionId,
      color: nextColor,
      statusText: state.status || "",
      error: null,
      players,
      moveNumber: numberOrZero(state.moveNumber),
      moveId,
      lastSan: state.lastSan || "",
    }));
  }

  async function refreshRoomList() {
    setRoomList((current) => ({
      ...current,
      status: "loading",
      error: null,
    }));

    try {
      const response = await fetch(roomsEndpoint());
      const payload = (await response.json()) as {
        ok?: boolean;
        rooms?: RoomSummary[];
        error?: string;
      };

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "방 목록을 불러오지 못했어요.");
      }

      setRoomList({
        status: "ready",
        rooms: Array.isArray(payload.rooms) ? payload.rooms : [],
        error: null,
      });
    } catch (error) {
      setRoomList({
        status: "error",
        rooms: [],
        error: error instanceof Error ? error.message : "방 목록을 불러오지 못했어요.",
      });
    }
  }

  function openMultiplayerLobby() {
    const playerName = cleanNickname(nickname) || fallbackNickname();
    setNickname(playerName);
    writeNickname(playerName);
    setRoomTitle((current) => current || `${playerName}의 방`);
    setHomeMode("lobby");
    setLobbyView("list");
    setMultiplayer((current) => ({
      ...current,
      error: null,
    }));
    void refreshRoomList();
  }

  function closeMultiplayerLobby() {
    if (multiplayer.status === "connecting") {
      return;
    }

    setHomeMode("menu");
  }

  function createMultiplayerRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void connectMultiplayer({
      kind: "create",
      roomTitle,
    });
  }

  function joinListedRoom(roomId: string) {
    void connectMultiplayer({
      kind: "join",
      roomId,
    });
  }

  function randomMatch() {
    void connectMultiplayer({
      kind: "random",
    });
  }

  async function connectMultiplayer(
    intent:
      | { kind: "create"; roomTitle: string }
      | { kind: "join"; roomId: string }
      | { kind: "random" },
  ) {
    if (multiplayer.status === "connecting") {
      return;
    }

    const playerName = cleanNickname(nickname) || fallbackNickname();
    setNickname(playerName);
    writeNickname(playerName);
    leaveMultiplayerRoom();
    clearBoardUi();
    setMultiplayer({ ...initialMultiplayerState, status: "connecting" });

    try {
      const client = new ColyseusClient(colyseusEndpoint());
      const room =
        intent.kind === "create"
          ? await client.create<OChessServerState>("ochess", {
              name: playerName,
              roomTitle: cleanRoomTitle(intent.roomTitle) || `${playerName}의 방`,
            })
          : intent.kind === "join"
            ? await client.joinById<OChessServerState>(intent.roomId, {
                name: playerName,
              })
            : await client.joinOrCreate<OChessServerState>("ochess", {
                name: playerName,
                roomTitle: `${playerName}의 랜덤 방`,
              });

      roomRef.current = room;
      lastServerMoveIdRef.current = 0;
      setPlayMode("multi");
      setIsComputerThinking(false);
      setScreen("game");
      startMusicIfEnabled();

      room.onMessage<{ reason?: string }>("move-error", (payload) => {
        setMultiplayer((current) => ({
          ...current,
          error: payload.reason || "둘 수 없는 수예요.",
        }));
      });

      room.onError((code, message) => {
        if (roomRef.current !== room) {
          return;
        }

        setMultiplayer((current) => ({
          ...current,
          status: "error",
          error: message || `멀티 오류 ${code}`,
        }));
      });

      room.onLeave(() => {
        if (roomRef.current !== room) {
          return;
        }

        roomRef.current = null;
        setMultiplayer((current) => ({
          ...current,
          status: "error",
          error: "멀티 연결이 끊겼어요.",
        }));
      });

      room.onStateChange((state) => {
        syncMultiplayerState(room, state);
      });
      syncMultiplayerState(room, room.state);
    } catch {
      setMultiplayer({
        ...initialMultiplayerState,
        status: "error",
        error: "멀티 서버에 연결하지 못했어요.",
      });
      setScreen("home");
      setPlayMode("single");
      setHomeMode("lobby");
      setLobbyView("list");
      void refreshRoomList();
    }
  }

  function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatDraft.trim();

    if (!text || !roomRef.current || multiplayer.status !== "connected") {
      return;
    }

    roomRef.current.send("chat", { text });
    setChatDraft("");
  }

  function resetBoard() {
    if (playMode === "multi") {
      roomRef.current?.send("restart");
      clearBoardUi();
      return;
    }

    game.reset();
    setFen(game.fen());
    clearBoardUi();
  }

  function startSinglePlayer() {
    leaveMultiplayerRoom();
    const freshGame = new Chess();
    gameRef.current = freshGame;
    setPlayMode("single");
    setOrientation("w");
    setFen(freshGame.fen());
    clearBoardUi();
    setScreen("game");
    startMusicIfEnabled();
  }

  function continueSinglePlayer() {
    leaveMultiplayerRoom();
    setPlayMode("single");
    setOrientation("w");
    clearBoardUi();
    setScreen("game");
    startMusicIfEnabled();
  }

  function returnHome() {
    audioRef.current?.stopMusic();

    if (playMode === "multi") {
      leaveMultiplayerRoom();
      const freshGame = new Chess();
      gameRef.current = freshGame;
      setFen(freshGame.fen());
      setOrientation("w");
      setPlayMode("single");
    }

    clearBoardUi();
    setHomeMode("menu");
    setLobbyView("list");
    setScreen("home");
  }

  function undoMove() {
    if (playMode !== "single" || !canUndo || isComputerThinking) {
      return;
    }

    const undoCount =
      playMode === "single" && game.turn() === "w" && game.history().length > 1 ? 2 : 1;

    for (let index = 0; index < undoCount; index += 1) {
      game.undo();
    }

    setFen(game.fen());
    setSelected(null);
    setPendingPromotion(null);
    setMotions({});
    setGhosts([]);
  }

  function triggerMoveMotion(
    to: Square,
    movedPiece: PieceSymbol | undefined,
    capturedPiece: Piece | null,
    captureSquare: Square = to,
    resultCue?: Extract<SoundCue, "check" | "checkmate">,
  ) {
    playSound(capturedPiece ? "attack" : "move", movedPiece);

    setMotions((current) => ({
      ...current,
      [to]: capturedPiece ? "attack" : "selected",
    }));
    clearSquareMotion(to, setMotions);

    if (!capturedPiece) {
      if (resultCue) {
        window.setTimeout(() => playSound(resultCue, movedPiece), 150);
      }

      return;
    }

    const id = ghostIdRef.current + 1;
    ghostIdRef.current = id;
    setGhosts((current) => [
      ...current,
      { id, square: captureSquare, piece: capturedPiece, state: "hurt" },
    ]);

    window.setTimeout(() => {
      playSound("hurt", capturedPiece.type);
    }, 150);

    window.setTimeout(() => {
      setGhosts((current) =>
        current.map((ghost) =>
          ghost.id === id ? { ...ghost, state: "defeated" } : ghost,
        ),
      );
      playSound("defeat", capturedPiece.type);
    }, 260);

    if (resultCue) {
      window.setTimeout(() => playSound(resultCue, movedPiece), 520);
    }

    window.setTimeout(() => {
      setGhosts((current) => current.filter((ghost) => ghost.id !== id));
    }, 860);
  }

  function selectSquare(square: Square) {
    setPendingPromotion(null);

    const piece = game.get(square);
    if (piece?.color === game.turn()) {
      playSound("select", piece.type);
      setSelected(square);
      return;
    }

    setSelected(null);
  }

  function commitMove(from: Square, to: Square, promotion?: PieceSymbol) {
    const move = game.move({ from, to, promotion });
    if (!move) {
      selectSquare(to);
      return;
    }

    const capturedPiece: Piece | null = move.captured
      ? { type: move.captured, color: move.color === "w" ? "b" : "w" }
      : null;
    const captureSquare = move.isEnPassant()
      ? (`${move.to[0]}${move.from[1]}` as Square)
      : move.to;
    const resultCue = game.isCheckmate() ? "checkmate" : game.isCheck() ? "check" : undefined;

    setFen(game.fen());
    setSelected(null);
    setPendingPromotion(null);
    triggerMoveMotion(move.to, move.piece, capturedPiece, captureSquare, resultCue);
  }

  function submitMove(from: Square, to: Square, promotion?: PieceSymbol) {
    if (playMode === "multi") {
      if (!roomRef.current || multiplayer.color !== game.turn()) {
        return;
      }

      roomRef.current.send("move", { from, to, promotion });
      setSelected(null);
      setPendingPromotion(null);
      return;
    }

    commitMove(from, to, promotion);
  }

  function moveSelected(to: Square) {
    if (!selected) {
      return;
    }

    const promotionChoices = promotionChoicesForMove(game, selected, to);

    if (promotionChoices.length > 1) {
      setPendingPromotion({
        choices: promotionChoices,
        color: game.turn(),
        from: selected,
        to,
      });
      return;
    }

    submitMove(selected, to, promotionChoices[0]);
  }

  function onSquarePress(square: Square) {
    if (isSinglePlayerBotTurn || isComputerThinking) {
      return;
    }

    if (playMode === "multi" && !isMyMultiplayerTurn) {
      return;
    }

    if (pendingPromotion) {
      setPendingPromotion(null);
    }

    if (selected && legalSet.has(square)) {
      moveSelected(square);
      return;
    }

    if (selected === square) {
      setSelected(null);
      return;
    }

    selectSquare(square);
  }

  function squareFromBoardPoint(
    clientX: number,
    clientY: number,
    boardElement: HTMLDivElement,
  ): Square | null {
    const rect = boardElement.getBoundingClientRect();
    const style = window.getComputedStyle(boardElement);
    const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
    const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
    const left = rect.left + borderLeft;
    const top = rect.top + borderTop;
    const width = rect.width - borderLeft - borderRight;
    const height = rect.height - borderTop - borderBottom;
    const x = clientX - left;
    const y = clientY - top;

    if (x < 0 || y < 0 || x > width || y > height) {
      return null;
    }

    const column = Math.min(7, Math.floor((x / width) * 8));
    const row = Math.min(7, Math.floor((y / height) * 8));
    return squares[row * 8 + column] ?? null;
  }

  function onBoardClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (event.detail === 0) {
      return;
    }

    const square = squareFromBoardPoint(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );

    if (!square) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSquarePress(square);
  }

  useEffect(() => {
    if (!isSinglePlayerBotTurn) {
      setIsComputerThinking(false);
      return;
    }

    setSelected(null);
    setIsComputerThinking(true);

    const timeout = window.setTimeout(() => {
      const move = chooseSinglePlayerMove(game);

      if (move) {
        commitMove(move.from, move.to, move.promotion);
      }

      setIsComputerThinking(false);
    }, 560);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [fen, game, isSinglePlayerBotTurn]);

  return (
    <main
      className={[
        "app-shell",
        screen === "home" ? "is-home" : "is-game",
        playMode === "multi" ? "has-multiplayer" : "",
        storageNotice ? "has-notice" : "",
      ].join(" ")}
    >
      <div className="sprite-preload" aria-hidden="true">
        <img src={attackMarkerPath} alt="" />
        {preloadFrames.map((src) => (
          <img key={src} src={src} alt="" />
        ))}
      </div>

      {screen === "home" ? (
        <HomeScreen
          canContinue={hasProgress}
          homeMode={homeMode}
          lobbyView={lobbyView}
          nickname={nickname}
          multiplayerStatus={multiplayer.status}
          multiplayerError={multiplayer.error}
          roomList={roomList}
          roomTitle={roomTitle}
          onContinue={continueSinglePlayer}
          onCloseLobby={closeMultiplayerLobby}
          onCreateRoom={createMultiplayerRoom}
          onJoinRoom={joinListedRoom}
          onLobbyViewChange={setLobbyView}
          onOpenLobby={openMultiplayerLobby}
          onRandomMatch={randomMatch}
          onRefreshRooms={() => void refreshRoomList()}
          onRoomTitleChange={setRoomTitle}
          onStartSingle={startSinglePlayer}
          onNicknameChange={setNickname}
        />
      ) : (
        <>
      <header className="top-bar">
        <div className={["turn-chip", isInCheck ? "is-alert" : ""].join(" ")}>
          <h1>{displayStatus}</h1>
          <span className="match-strip">
            <span>{moveCount}수</span>
            <b>{lastMoveLabel}</b>
          </span>
        </div>
        <div className="icon-row">
          <button type="button" title="홈" aria-label="홈으로" onClick={returnHome}>
            <Home size={17} />
          </button>
          <button
            type="button"
            title={soundEnabled ? "효과음 끄기" : "효과음 켜기"}
            aria-label={soundEnabled ? "효과음 끄기" : "효과음 켜기"}
            onClick={toggleSound}
          >
            {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button
            type="button"
            className={musicEnabled ? "" : "is-muted"}
            title={musicEnabled ? "브금 끄기" : "브금 켜기"}
            aria-label={musicEnabled ? "브금 끄기" : "브금 켜기"}
            onClick={toggleMusic}
          >
            <Music size={17} />
          </button>
          <button
            type="button"
            title="되돌리기"
            aria-label="되돌리기"
            onClick={undoMove}
            disabled={!canUndo || isComputerThinking}
          >
            <Undo2 size={17} />
          </button>
          <button type="button" title="새 게임" aria-label="새 게임" onClick={resetBoard}>
            <RotateCcw size={17} />
          </button>
        </div>
      </header>

      {isInCheck ? (
        <div className="check-alert-banner" role="status" aria-live="polite">
          <span>{checkAlertText}</span>
        </div>
      ) : null}

      {storageNotice ? (
        <aside className="storage-notice" role="status" aria-live="polite">
          <span>{storageNoticeText[storageNotice]}</span>
          <button
            type="button"
            title="알림 닫기"
            aria-label="알림 닫기"
            onClick={() => setStorageNotice(null)}
          >
            <X size={16} />
          </button>
        </aside>
      ) : null}

      <CapturedTray title="블랙 포획" pieces={captured.b} />

      <section className="board-wrap" aria-label="체스 보드">
        <div className="board" onClickCapture={onBoardClickCapture}>
          {squares.map((square, index) => {
            const piece = game.get(square);
            const isSelected = selected === square;
            const isLegal = legalSet.has(square);
            const isAttackTarget = attackTargetSet.has(square);
            const squareColor = (index + Math.floor(index / 8)) % 2 === 0 ? "light" : "dark";
            const state = isSelected ? "selected" : motions[square] ?? "idle";
            const squareGhosts = ghosts.filter((ghost) => ghost.square === square);
            const kingPlayer =
              playMode === "multi" && piece?.type === "k"
                ? playersByColor.get(piece.color)
                : null;

            return (
              <button
                key={square}
                type="button"
                className={[
                  "square",
                  `square-${squareColor}`,
                  isSelected ? "is-selected" : "",
                  isLegal ? "is-legal" : "",
                  isAttackTarget ? "is-attack-target" : "",
                  lastMove?.from === square ? "is-last-from" : "",
                  lastMove?.to === square ? "is-last-to" : "",
                  checkedKingSquare === square ? "is-check" : "",
                ].join(" ")}
                aria-label={square}
                onClick={() => onSquarePress(square)}
              >
                <span className="coord">{square}</span>
                {kingPlayer?.chatText ? (
                  <span className="king-chat-bubble">{kingPlayer.chatText}</span>
                ) : null}
                {piece ? (
                  <PieceSprite
                    key={`${square}-${piece.color}-${piece.type}`}
                    piece={piece}
                    state={state}
                    squareIndex={index}
                  />
                ) : null}
                {kingPlayer ? (
                  <span className="king-name-label">{kingPlayer.name}</span>
                ) : null}
                {isAttackTarget ? (
                  <img
                    className="attack-marker"
                    src={attackMarkerPath}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                  />
                ) : null}
                {squareGhosts.map((ghost) => (
                  <span className="ghost-layer" key={ghost.id}>
                    <PieceSprite
                      key={`${ghost.id}-${ghost.piece.color}-${ghost.piece.type}-${ghost.state}`}
                      piece={ghost.piece}
                      state={ghost.state}
                      squareIndex={index}
                    />
                  </span>
                ))}
              </button>
            );
          })}
        </div>

        {pendingPromotion ? (
          <div className="promotion-panel" role="dialog" aria-label="승급 선택">
            <span>승급</span>
            {pendingPromotion.choices.map((choice, index) => (
              <button
                key={choice}
                type="button"
                title={pieceNames[choice]}
                aria-label={`${pieceNames[choice]}으로 승급`}
                onClick={() => submitMove(pendingPromotion.from, pendingPromotion.to, choice)}
              >
                <PieceSprite
                  piece={{ type: choice, color: pendingPromotion.color }}
                  state="selected"
                  squareIndex={index}
                  compact
                />
              </button>
            ))}
            <button
              type="button"
              className="promotion-close"
              title="닫기"
              aria-label="승급 선택 닫기"
              onClick={() => setPendingPromotion(null)}
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
      </section>

      <CapturedTray title="화이트 포획" pieces={captured.w} />
      {playMode === "multi" ? (
        <MultiplayerDock
          multiplayer={multiplayer}
          chatDraft={chatDraft}
          onChatDraftChange={setChatDraft}
          onSendChat={sendChat}
        />
      ) : null}
        </>
      )}
    </main>
  );
}
