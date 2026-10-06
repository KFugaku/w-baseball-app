/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";
import { loadSnapshot, saveSnapshot } from "./lib/persistence";
import {
  createOwnedGame,
  gameCreationErrorMessage,
  type ExistingRoomForGame,
  type GameCreationInput,
} from "./lib/gameCreationData";
import {
  createOwnedRoom,
  loadOwnedRooms,
  roomCreationErrorMessage,
  type OwnedRoom,
} from "./lib/myPageData";
import {
  getGameAccess,
  loadPlayerStatistics,
  loadViewerGameDetail,
  loadViewerGames,
  applyGameEvent,
  subscribeToGameChanges,
  type GameAccess,
  type PlateResult,
  type PlayerStatistics,
  type ViewerGame,
} from "./lib/roomViewData";
import {
  claimRoomViewSession,
  endRoomViewSession,
  getRoomViewSession,
  isRoomViewSessionExpired,
  restoreRoomViewSessionAfterLogout,
  roomViewSessionErrorMessage,
  startRoomViewSession,
  type RoomViewSession,
} from "./lib/roomViewSession";
import {
  clearSharedGameRoute,
  readSharedGameRoute,
  setSharedGameRoute,
  type SharedGameRoute,
} from "./lib/gameRoute";
import {
  authErrorMessage,
  getCurrentUser,
  isInviteCallback,
  resendSignUpConfirmation,
  signInWithEmail,
  signOut,
  signUpWithEmail,
  subscribeToAuthState,
  updatePassword,
} from "./lib/supabase";
import "./App.css";
import "./Extra.css";
import "./Home.css";
import "./Field.css";
import "./FieldRefine.css";
import "./FieldScale.css";
import "./Typography.css";
import "./ColorTheme.css";
import "./FieldPlayers.css";
import "./RoomAccess.css";

type Base = 1 | 2 | 3;
type Member = { id: string; last: string; first: string };
type Player = Member & { pos: string; avg: string };
type PlayerProfile = { player: Player; teamName: string };
type PlayerProfileTab = "batting" | "pitching" | "plate-appearances";
type Team = { name: string; color: string; players: Player[]; bench: Player[] };
type Game = {
  id: string;
  title: string;
  status: "試合終了" | "速報中" | "試合前";
  scheduledInnings: number;
  away: string;
  home: string;
  awayScore: number | null;
  homeScore: number | null;
  awayColor?: string;
  homeColor?: string;
};
type TeamSide = "away" | "home";
type Batters = Record<TeamSide, number>;
type InningScores = Record<TeamSide, number[]>;
type Snapshot = {
  balls: number;
  strikes: number;
  outs: number;
  batter: number;
  batters?: Batters;
  awayScore: number;
  homeScore: number;
  inningScores?: InningScores;
  runners: Partial<Record<Base, string>>;
  runnerPitchers: Partial<Record<Base, string>>;
  result: string;
  plays: string[];
  completedPlateAppearance?: boolean;
};
type GameProgressSnapshot = {
  version: 1;
  teams: Record<TeamSide, Team>;
  batters: Batters;
  inningScores: InningScores;
  runners: Partial<Record<Base, string>>;
  runnerPitchers?: Partial<Record<Base, string>>;
  result: string;
  plays: string[];
};
type PersistedAppState = {
  version: 1;
  members: Member[];
  games: Game[];
  game: Game | null;
  away: Team;
  home: Team;
  gameTeams?: Record<string, { away: Team; home: Team }>;
  inning: number;
  half: "表" | "裏";
  balls: number;
  strikes: number;
  outs: number;
  batter: number;
  batters?: Batters;
  awayScore: number;
  homeScore: number;
  inningScores?: InningScores;
  runners: Partial<Record<Base, string>>;
  runnerPitchers?: Partial<Record<Base, string>>;
  result: string;
  plays: string[];
  history: Snapshot[];
};
const positions = ["投", "捕", "一", "二", "三", "遊", "左", "中", "右", "打"];
const slots = ["左", "中", "右", "三", "遊", "二", "一", "投", "捕"];
const initialMembers: Member[] = [
  ["田中", "太郎"],
  ["佐藤", "健"],
  ["鈴木", "蓮"],
  ["高橋", "陸"],
  ["伊藤", "翔"],
  ["山本", "悠"],
  ["木村", "陽"],
  ["吉田", "大輝"],
  ["清水", "亮"],
  ["渡辺", "優"],
  ["小林", "海斗"],
  ["加藤", "航"],
  ["中村", "龍"],
  ["森", "拓也"],
  ["石井", "駿"],
  ["井上", "直人"],
  ["山田", "誠"],
  ["岡田", "蒼"],
  ["斎藤", "颯"],
  ["松本", "晴"],
].map(([last, first], i) => ({ id: `m${i}`, last, first }));
const pastelColors = [
  "#f7d6d0",
  "#d9eafa",
  "#d9efdf",
  "#f8e5bd",
  "#eadcf7",
  "#f9dce7",
];
const makeTeam = (name: string, start: number, color: string): Team => ({
  name,
  color,
  players: positions.slice(0, 9).map((pos, i) => ({
    ...initialMembers[start + i],
    pos,
    avg: `.${250 + i * 5}`,
  })),
  bench: initialMembers
    .slice(start + 9, start + 11)
    .map((member) => ({ ...member, pos: "打", avg: ".250" })),
});
const emptyTeam = (name: string, color: string): Team => ({
  name,
  color,
  players: [],
  bench: [],
});
const emptyInningScores = (): InningScores => ({ away: [], home: [] });

type PendingPlateAppearance = {
  eventType: "plate_appearance";
  description: string;
  batter: Player;
  pitcher: Player;
  result: PlateResult;
  runsBattedIn: number;
  outsRecorded: number;
  responsiblePitcherKeys: string[];
  baseRunnersBefore: number;
  inning: number;
  half: "top" | "bottom";
};
type PendingGameEvent = {
  eventType: "player_substitution" | "defensive_position_change";
  description: string;
};
type DragState = {
  team: "away" | "home";
  area: "players" | "bench";
  index: number;
} | null;
const validTeam = (value: unknown): value is Team =>
  value !== null &&
  typeof value === "object" &&
  "name" in value &&
  "color" in value &&
  "players" in value &&
  "bench" in value &&
  Array.isArray((value as Team).players) &&
  Array.isArray((value as Team).bench);
const readProgressSnapshot = (
  value: Record<string, unknown> | undefined | null,
): Partial<GameProgressSnapshot> => {
  if (!value || typeof value !== "object") return {};
  const snapshot = value as Partial<GameProgressSnapshot>;
  const teams =
    snapshot.teams &&
    validTeam(snapshot.teams.away) &&
    validTeam(snapshot.teams.home)
      ? snapshot.teams
      : undefined;
  const batters =
    snapshot.batters &&
    Number.isInteger(snapshot.batters.away) &&
    Number.isInteger(snapshot.batters.home)
      ? snapshot.batters
      : undefined;
  const inningScores =
    snapshot.inningScores &&
    Array.isArray(snapshot.inningScores.away) &&
    Array.isArray(snapshot.inningScores.home)
      ? snapshot.inningScores
      : undefined;
  return {
    teams,
    batters,
    inningScores,
    runners: snapshot.runners,
    runnerPitchers: snapshot.runnerPitchers,
    result: typeof snapshot.result === "string" ? snapshot.result : undefined,
    plays: Array.isArray(snapshot.plays)
      ? snapshot.plays.filter(
          (play): play is string => typeof play === "string",
        )
      : undefined,
  };
};

function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`avatar ${small ? "small" : ""}`}>{name.slice(0, 1)}</span>
  );
}
function App() {
  const [admin, setAdminState] = useState(false),
    [authReady, setAuthReady] = useState(false),
    [passwordOpen, setPasswordOpen] = useState(false),
    [passwordSetupOpen, setPasswordSetupOpen] = useState(isInviteCallback),
    [logoutOpen, setLogoutOpen] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const hadAdminSession = useRef(false);
  const [roomCreateOpen, setRoomCreateOpen] = useState(false);
  const initialSharedGameRoute = readSharedGameRoute();
  const [view, setView] = useState<
      | "entry"
      | "room-access"
      | "mypage"
      | "room-games"
      | "home"
      | "game"
      | "player-profile"
      | "viewer-list"
      | "shared-game"
    >(initialSharedGameRoute ? "shared-game" : "entry"),
    [rosterOpen, setRosterOpen] = useState(true),
    [newMember, setNewMember] = useState({ last: "", first: "" });
  const [sharedGameRoute, setSharedGameRouteState] =
    useState<SharedGameRoute | null>(initialSharedGameRoute);
  const [localPlayerProfile, setLocalPlayerProfile] =
    useState<PlayerProfile | null>(null);
  const [sharedAccessRevision, setSharedAccessRevision] = useState(0);
  const [sharedGameAccess, setSharedGameAccess] = useState<GameAccess | null>(
      null,
    ),
    [sharedGameLoading, setSharedGameLoading] = useState(
      Boolean(initialSharedGameRoute),
    ),
    [sharedGameError, setSharedGameError] = useState("");
  const [gameRevision, setGameRevision] = useState(0);
  const [gameSyncError, setGameSyncError] = useState("");
  const [gameSyncTick, setGameSyncTick] = useState(0);
  const lastGameSyncSignature = useRef<string | null>(null);
  const gameSyncInFlight = useRef(false);
  const skipNextGameSync = useRef(false);
  const pendingPlateAppearance = useRef<PendingPlateAppearance | null>(null);
  const pendingGameEvents = useRef<PendingGameEvent[]>([]);
  const pendingPlateAppearanceUndo = useRef(false);
  const inningStartTimer = useRef<number | null>(null);
  const pendingInningStart = useRef<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<OwnedRoom | null>(null);
  const [viewerSession, setViewerSession] = useState<RoomViewSession | null>(
      null,
    ),
    [viewerGames, setViewerGames] = useState<ViewerGame[]>([]),
    [viewerLoading, setViewerLoading] = useState(false),
    [viewerError, setViewerError] = useState("");
  const [members, setMembers] = useState<Member[]>(initialMembers),
    [games, setGames] = useState<Game[]>([
      {
        id: "g1",
        title: "第一試合",
        status: "試合終了",
        scheduledInnings: 9,
        away: "チームA",
        home: "チームB",
        awayScore: 1,
        homeScore: 2,
      },
      {
        id: "g2",
        title: "第二試合",
        status: "速報中",
        scheduledInnings: 9,
        away: "多摩リバース",
        home: "府中フェニックス",
        awayScore: 1,
        homeScore: 3,
      },
      {
        id: "g3",
        title: "第三試合",
        status: "試合前",
        scheduledInnings: 9,
        away: "チームA",
        home: "チームB",
        awayScore: null,
        homeScore: null,
      },
    ]);
  const [game, setGame] = useState<Game | null>(null),
    [creating, setCreating] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false),
    [setup, setSetup] = useState({
      away: "チームA",
      home: "チームB",
      awayColor: pastelColors[0],
      homeColor: pastelColors[1],
      scheduledInnings: 9,
    });
  const [away, setAway] = useState<Team>(() =>
      makeTeam("多摩リバース", 0, pastelColors[0]),
    ),
    [home, setHome] = useState<Team>(() =>
      makeTeam("府中フェニックス", 9, pastelColors[1]),
    ),
    [gameTeams, setGameTeams] = useState<
      Record<string, { away: Team; home: Team }>
    >({}),
    [drag, setDragState] = useState<DragState>(null),
    [pick, setPick] = useState<{
      team: "away" | "home";
      area: "players" | "bench";
      slotId: string;
    } | null>(null);
  const [inning, setInning] = useState(3),
    [half, setHalf] = useState<"表" | "裏">("表"),
    [balls, setBalls] = useState(2),
    [strikes, setStrikes] = useState(1),
    [outs, setOuts] = useState(1),
    [batter, setBatter] = useState(0),
    [batters, setBatters] = useState<Batters>({ away: 0, home: 0 }),
    [awayScore, setAwayScore] = useState(1),
    [homeScore, setHomeScore] = useState(3),
    [inningScores, setInningScores] = useState<InningScores>(() => ({
      away: [1, 0, 0],
      home: [0, 0, 3],
    })),
    [runners, setRunners] = useState<Partial<Record<Base, string>>>({
      1: "佐藤",
      2: "鈴木",
    }),
    [runnerPitchers, setRunnerPitchers] = useState<
      Partial<Record<Base, string>>
    >({ 1: "m9", 2: "m9" }),
    [result, setResult] = useState(""),
    [plays, setPlays] = useState([
      "3回表",
      "3回表 佐藤 四球",
      "3回表 田中 中安打",
      "2回裏",
      "2回裏 山田 三振",
    ]),
    [resultType, setResultType] = useState<string | null>(null),
    [history, setHistory] = useState<Snapshot[]>([]);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const dragRef = useRef<DragState>(null);
  const setDrag = (value: DragState) => {
    dragRef.current = value;
    setDragState(value);
  };

  useEffect(
    () => () => {
      if (inningStartTimer.current !== null)
        window.clearTimeout(inningStartTimer.current);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const applyUser = (user: Awaited<ReturnType<typeof getCurrentUser>>) => {
      if (active) {
        const isAnonymous = user?.app_metadata?.provider === "anonymous";
        const isAdmin = Boolean(user) && !isAnonymous;
        setAdminState(isAdmin);
        if (isAdmin) {
          hadAdminSession.current = true;
          setView((current) => (current === "entry" ? "mypage" : current));
        } else if (hadAdminSession.current) {
          hadAdminSession.current = false;
          setAuthNotice(
            "ログインの有効期限が切れました。もう一度ログインしてください。",
          );
          setView((current) =>
            ["mypage", "home", "game"].includes(current) ? "entry" : current,
          );
        }
        setAuthReady(true);
      }
    };
    void getCurrentUser().then(applyUser);
    const unsubscribe = subscribeToAuthState(applyUser);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authReady || passwordOpen) return;
    void getCurrentUser().then((user) =>
      setAdminState(
        Boolean(user) && user?.app_metadata?.provider !== "anonymous",
      ),
    );
  }, [authReady, passwordOpen]);

  useEffect(() => {
    if (!authReady) return;
    if (admin) return;
    if (view !== "entry" || viewerSession) return;
    const restoreViewer = async () => {
      if (isRoomViewSessionExpired()) {
        await endRoomViewSession();
        return;
      }
      const saved = getRoomViewSession();
      if (!saved) return;
      setViewerSession(saved);
      setViewerLoading(true);
      setViewerError("");
      setView("viewer-list");
      try {
        setViewerGames(await loadViewerGames(saved.roomId));
      } catch {
        setViewerError(
          "試合一覧を取得できませんでした。閲覧期限が切れた場合は、もう一度認証してください。",
        );
      } finally {
        setViewerLoading(false);
      }
    };
    void restoreViewer();
  }, [admin, authReady, view, viewerSession]);

  useEffect(() => {
    const onPopState = () => {
      const route = readSharedGameRoute();
      setSharedGameRouteState(route);
      setSharedGameAccess(null);
      setSharedGameError("");
      if (route) {
        setSharedGameLoading(true);
        setView("shared-game");
      } else
        setView(
          viewerSession
            ? "viewer-list"
            : selectedRoom
              ? "room-games"
              : admin
                ? "mypage"
                : "entry",
        );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [admin, selectedRoom, viewerSession]);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    const restore = async () => {
      const saved = await loadSnapshot<PersistedAppState>();
      if (!cancelled && saved?.version === 1) {
        setMembers(saved.members);
        setGames(
          saved.games.map((savedGame) => ({
            ...savedGame,
            scheduledInnings: savedGame.scheduledInnings ?? 9,
          })),
        );
        setGame(
          saved.game
            ? {
                ...saved.game,
                scheduledInnings: saved.game.scheduledInnings ?? 9,
              }
            : null,
        );
        setAway(saved.away);
        setHome(saved.home);
        setGameTeams(saved.gameTeams ?? {});
        setInning(saved.inning);
        setHalf(saved.half);
        setBalls(saved.balls);
        setStrikes(saved.strikes);
        setOuts(saved.outs);
        setBatter(saved.batter);
        setBatters(saved.batters ?? { away: saved.batter, home: 0 });
        setAwayScore(saved.awayScore);
        setHomeScore(saved.homeScore);
        setInningScores(saved.inningScores ?? emptyInningScores());
        setRunners(saved.runners);
        setRunnerPitchers(saved.runnerPitchers ?? {});
        setResult(saved.result);
        setPlays(saved.plays);
        setHistory(saved.history);
      }
      if (!cancelled) setPersistenceReady(true);
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  useEffect(() => {
    if (!persistenceReady) return;
    const timer = window.setTimeout(() => {
      void saveSnapshot<PersistedAppState>({
        version: 1,
        members,
        games,
        game,
        away,
        home,
        gameTeams,
        inning,
        half,
        balls,
        strikes,
        outs,
        batter,
        batters,
        awayScore,
        homeScore,
        inningScores,
        runners,
        runnerPitchers,
        result,
        plays,
        history,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    persistenceReady,
    members,
    games,
    game,
    away,
    home,
    gameTeams,
    inning,
    half,
    balls,
    strikes,
    outs,
    batter,
    batters,
    awayScore,
    homeScore,
    inningScores,
    runners,
    runnerPitchers,
    result,
    plays,
    history,
  ]);

  useEffect(() => {
    if (!authReady || !persistenceReady || !sharedGameRoute) return;
    let cancelled = false;
    void Promise.all([
      getGameAccess(sharedGameRoute.roomId, sharedGameRoute.gameId),
      loadViewerGameDetail(sharedGameRoute.roomId, sharedGameRoute.gameId),
    ])
      .then(([access, detail]) => {
        if (cancelled) return;
        if (!access || !detail)
          throw new Error("試合を表示する権限がありません。");
        const selected: Game = {
          id: detail.id,
          title: detail.title,
          status: detail.status,
          scheduledInnings: detail.scheduledInnings,
          away: detail.away.name,
          home: detail.home.name,
          awayScore: detail.state?.away_score ?? detail.away.score,
          homeScore: detail.state?.home_score ?? detail.home.score,
          awayColor: detail.away.color,
          homeColor: detail.home.color,
        };
        const progress = readProgressSnapshot(detail.state?.snapshot);
        const nextAway =
            progress.teams?.away ??
            emptyTeam(detail.away.name, detail.away.color),
          nextHome =
            progress.teams?.home ??
            emptyTeam(detail.home.name, detail.home.color);
        skipNextGameSync.current = true;
        lastGameSyncSignature.current = null;
        setGameRevision(detail.state?.revision ?? 0);
        setGameSyncError("");
        setSharedGameAccess(access);
        setGame(selected);
        setAway(nextAway);
        setHome(nextHome);
        setGameTeams((cache) => ({
          ...cache,
          [detail.id]: { away: nextAway, home: nextHome },
        }));
        setInning(detail.state?.inning ?? 1);
        setHalf(detail.state?.half === "bottom" ? "裏" : "表");
        setBalls(detail.state?.balls ?? 0);
        setStrikes(detail.state?.strikes ?? 0);
        setOuts(detail.state?.outs ?? 0);
        setAwayScore(detail.state?.away_score ?? detail.away.score);
        setHomeScore(detail.state?.home_score ?? detail.home.score);
        setBatter(
          progress.batters?.[
            detail.state?.half === "bottom" ? "home" : "away"
          ] ?? 0,
        );
        setBatters(progress.batters ?? { away: 0, home: 0 });
        setInningScores(progress.inningScores ?? emptyInningScores());
        setRunners(progress.runners ?? {});
        setRunnerPitchers(progress.runnerPitchers ?? {});
        setResult(progress.result ?? "");
        setResultType(null);
        setHistory([]);
        setPlays(
          progress.plays?.length
            ? progress.plays
            : detail.events.length
              ? detail.events.map(
                  (event) =>
                    `${event.inning}回${event.half === "top" ? "表" : "裏"} ${event.event_type === "player_substitution" ? `選手交代: ${event.description}` : event.event_type === "defensive_position_change" ? `守備変更: ${event.description}` : event.description}`,
                )
              : [
                  `${detail.state?.inning ?? 1}回${detail.state?.half === "bottom" ? "裏" : "表"}`,
                ],
        );
        setSharedGameLoading(false);
        const playerExists = [
          ...nextAway.players,
          ...nextAway.bench,
          ...nextHome.players,
          ...nextHome.bench,
        ].some((player) => player.id === sharedGameRoute.playerId);
        setView(
          sharedGameRoute.playerId && playerExists ? "player-profile" : "game",
        );
      })
      .catch((reason) => {
        if (!cancelled) {
          setSharedGameAccess(null);
          setSharedGameLoading(false);
          setSharedGameError(
            reason instanceof Error
              ? reason.message
              : "試合を読み込めませんでした。",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, persistenceReady, sharedAccessRevision, sharedGameRoute]);

  useEffect(() => {
    // 管理者はローカルの最新状態を先に表示して保存する。自分の保存通知で
    // 画面全体を再取得すると、続けて編集中の変更を古い状態で上書きしてしまう。
    if (
      !authReady ||
      !sharedGameRoute ||
      sharedGameAccess === "owner"
    )
      return;
    let timer: number | undefined;
    const unsubscribe = subscribeToGameChanges(sharedGameRoute.gameId, () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setSharedAccessRevision((value) => value + 1);
      }, 120);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [authReady, sharedGameAccess, sharedGameRoute]);

  const canEditGame = sharedGameRoute ? sharedGameAccess === "owner" : admin;
  const isBeforeGame = game?.status === "試合前";
  const isLiveGame = game?.status === "速報中";
  const canEditDefense = (side: TeamSide) =>
    canEditGame && (!isLiveGame || side === fieldingSide);
  const canManageRoster = canEditGame;
  const startDisabledReason = !game
    ? "試合情報を読み込み中です。"
    : !canEditGame
      ? "閲覧モードでは試合を開始できません。"
      : !isBeforeGame
        ? game.status === "試合終了"
          ? "終了した試合は開始できません。"
          : "この試合はすでに開始されています。"
        : "";
  useEffect(() => {
    if (
      !sharedGameRoute ||
      sharedGameAccess !== "owner" ||
      !game ||
      game.id !== sharedGameRoute.gameId
    )
      return;
    const state = {
      inning,
      half: half === "表" ? ("top" as const) : ("bottom" as const),
      balls,
      strikes,
      outs,
      batter_order: batters[half === "表" ? "away" : "home"],
      away_score: awayScore,
      home_score: homeScore,
      snapshot: {
        version: 1,
        teams: { away, home },
        batters,
        inningScores,
        runners,
        runnerPitchers,
        result,
        plays,
      },
    };
    const signature = `${game.id}:${JSON.stringify(state)}`;
    if (skipNextGameSync.current) {
      skipNextGameSync.current = false;
      lastGameSyncSignature.current = signature;
      return;
    }
    const hasPendingEvent =
      pendingGameEvents.current.length > 0 ||
      pendingPlateAppearance.current !== null ||
      pendingPlateAppearanceUndo.current;
    if (
      gameSyncInFlight.current ||
      (!hasPendingEvent && lastGameSyncSignature.current === signature)
    )
      return;
    const timer = window.setTimeout(() => {
      const pending = pendingPlateAppearance.current;
      const pendingGameEvent = pendingGameEvents.current[0];
      const revertsPlateAppearance = pendingPlateAppearanceUndo.current;
      gameSyncInFlight.current = true;
      void applyGameEvent(game.id, {
        expectedRevision: gameRevision,
        clientEventId: crypto.randomUUID(),
        eventType:
          pending?.eventType ?? pendingGameEvent?.eventType ?? "state_changed",
        description:
          pending?.description ??
          pendingGameEvent?.description ??
          plays[0] ??
          "試合状況を更新",
        state,
        status:
          game.status === "試合終了"
            ? "finished"
            : game.status === "試合前"
              ? "before"
              : "live",
        plateAppearance: pending
          ? {
              batter: {
                key: pending.batter.id,
                lastName: pending.batter.last,
                firstName: pending.batter.first,
              },
              pitcher: {
                key: pending.pitcher.id,
                lastName: pending.pitcher.last,
                firstName: pending.pitcher.first,
              },
              result: pending.result,
              runsBattedIn: pending.runsBattedIn,
              outsRecorded: pending.outsRecorded,
              responsiblePitcherKeys: pending.responsiblePitcherKeys,
              baseRunnersBefore: pending.baseRunnersBefore,
              inning: pending.inning,
              half: pending.half,
            }
          : undefined,
        revertLastPlateAppearance: revertsPlateAppearance,
      })
        .then((saved) => {
          lastGameSyncSignature.current = signature;
          setGameRevision(saved.revision);
          setGameSyncError("");
        })
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : "試合を保存できませんでした。";
          lastGameSyncSignature.current = signature;
          setGameSyncError(message);
          console.warn("試合の進行を保存できませんでした。", error);
        })
        .finally(() => {
          if (pendingPlateAppearance.current === pending) {
            pendingPlateAppearance.current = null;
          }
          if (pendingGameEvents.current[0] === pendingGameEvent) {
            pendingGameEvents.current.shift();
          }
          if (revertsPlateAppearance) pendingPlateAppearanceUndo.current = false;
          gameSyncInFlight.current = false;
          // 通信中に続けて操作された場合は、次のrenderで最新状態を送信する。
          setGameSyncTick((tick) => tick + 1);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    away,
    awayScore,
    balls,
    batters,
    game,
    half,
    home,
    homeScore,
    inning,
    inningScores,
    outs,
    plays,
    result,
    runners,
    runnerPitchers,
    sharedGameAccess,
    sharedGameRoute,
    strikes,
    gameRevision,
    gameSyncTick,
  ]);
  const battingSide: TeamSide = half === "表" ? "away" : "home",
    fieldingSide: TeamSide = battingSide === "away" ? "home" : "away",
    battingTeam = battingSide === "away" ? away : home,
    fieldingTeam = fieldingSide === "away" ? away : home;
  const fallbackPlayer: Player = {
    id: "empty",
    last: "未設定",
    first: "",
    pos: "打",
    avg: "---",
  };
  const currentBatter = battingTeam.players.length
      ? battingTeam.players[batters[battingSide] % battingTeam.players.length]
      : fallbackPlayer,
    pitcher =
      fieldingTeam.players.find((p) => p.pos === "投") ??
      fieldingTeam.players[0] ??
      fallbackPlayer;
  const snapshot = (completedPlateAppearance = false) => {
    setHistory((h) =>
      [
        {
          balls,
          strikes,
          outs,
          batter,
          batters,
          awayScore,
          homeScore,
          inningScores,
          runners: { ...runners },
          runnerPitchers: { ...runnerPitchers },
          result,
          plays: [...plays],
          completedPlateAppearance,
        },
        ...h,
      ].slice(0, 50),
    );
  };
  const startGame = () => {
    if (!canEditGame || !game || !isBeforeGame) return;
    setGame((current) =>
      current ? { ...current, status: "速報中" } : current,
    );
    setSelectedRoom((room) =>
      room
        ? {
            ...room,
            games: room.games.map((item) =>
              item.id === game.id ? { ...item, status: "速報中" } : item,
            ),
          }
        : room,
    );
    setResult("");
    setResultType(null);
    setPlays((items) => {
      const started = `${inning}回${half} 試合開始`;
      return items[0] === started ? items : [started, ...items];
    });
  };
  const finishGame = () => {
    if (!canEditGame || !game || !isLiveGame) return;
    pendingInningStart.current = null;
    if (inningStartTimer.current !== null) {
      window.clearTimeout(inningStartTimer.current);
      inningStartTimer.current = null;
    }
    pendingPlateAppearance.current = null;
    setGame((current) =>
      current ? { ...current, status: "試合終了" } : current,
    );
    setSelectedRoom((room) =>
      room
        ? {
            ...room,
            games: room.games.map((item) =>
              item.id === game.id ? { ...item, status: "試合終了" } : item,
            ),
          }
        : room,
    );
    setPlays((items) => [`${inning}回${half} 試合終了`, ...items]);
  };
  const undo = () => {
    const [previous, ...rest] = history;
    if (!previous) return;
    pendingInningStart.current = null;
    if (inningStartTimer.current !== null) {
      window.clearTimeout(inningStartTimer.current);
      inningStartTimer.current = null;
    }
    pendingPlateAppearance.current = null;
    pendingPlateAppearanceUndo.current = Boolean(
      previous.completedPlateAppearance,
    );
    setBalls(previous.balls);
    setStrikes(previous.strikes);
    setOuts(previous.outs);
    setBatter(previous.batter);
    setBatters(previous.batters ?? { away: previous.batter, home: 0 });
    setAwayScore(previous.awayScore);
    setHomeScore(previous.homeScore);
    setInningScores(previous.inningScores ?? emptyInningScores());
    setRunners(previous.runners);
    setRunnerPitchers(previous.runnerPitchers ?? {});
    setResult(previous.result);
    setPlays(previous.plays);
    setHistory(rest);
    setResultType(null);
  };
  const log = (text: string) => {
    pendingInningStart.current = null;
    setResult(text);
    setPlays((p) => [`${inning}回${half} ${currentBatter.last} ${text}`, ...p]);
  };
  const resetCount = () => {
    setBalls(0);
    setStrikes(0);
  };
  const queuePlateAppearance = (
    plateResult: PlateResult,
    text: string,
    runsBattedIn: number,
    outsRecorded: number,
    responsiblePitcherKeys: string[],
  ) => {
    if (
      currentBatter.id === "empty" ||
      currentBatter.id.startsWith("slot-") ||
      pitcher.id === "empty" ||
      pitcher.id.startsWith("slot-")
    )
      return;
    pendingPlateAppearance.current = {
      eventType: "plate_appearance",
      description: `${currentBatter.last} ${text}`,
      batter: currentBatter,
      pitcher,
      result: plateResult,
      runsBattedIn,
      outsRecorded,
      responsiblePitcherKeys,
      baseRunnersBefore: Object.keys(runners).length,
      inning,
      half: half === "表" ? "top" : "bottom",
    };
  };
  const next = () =>
    setBatters((current) => {
      const nextBatter = battingTeam.players.length
        ? (current[battingSide] + 1) % battingTeam.players.length
        : 0;
      setBatter(nextBatter);
      return { ...current, [battingSide]: nextBatter };
    });
  const changeHalf = (showStartAfterDelay = false) => {
    if (!isLiveGame) return;
    const nextHalf = half === "表" ? "裏" : "表",
      nextInning = half === "裏" ? inning + 1 : inning;
    setInningScores((current) => {
      const scores = [...current[battingSide]];
      scores[inning - 1] ??= 0;
      return { ...current, [battingSide]: scores };
    });
    if (half === "裏") setInning(nextInning);
    setHalf(nextHalf);
    setOuts(0);
    resetCount();
    setRunners({});
    setRunnerPitchers({});
    setPlays((items) => [`${nextInning}回${nextHalf}`, ...items]);
    if (!showStartAfterDelay) return;
    const token = crypto.randomUUID();
    pendingInningStart.current = token;
    if (inningStartTimer.current !== null)
      window.clearTimeout(inningStartTimer.current);
    inningStartTimer.current = window.setTimeout(() => {
      if (pendingInningStart.current !== token) return;
      const startText = `${nextInning}回${nextHalf}開始`;
      pendingInningStart.current = null;
      inningStartTimer.current = null;
      setResult(startText);
      setPlays((items) => [startText, ...items]);
    }, 3000);
  };
  const out = (text: string, plateResult: PlateResult) => {
    if (!isLiveGame) return;
    snapshot(true);
    queuePlateAppearance(plateResult, text, 0, 1, []);
    log(text);
    resetCount();
    next();
    if (outs === 2) changeHalf(true);
    else setOuts((o) => o + 1);
    setResultType(null);
  };
  const score = (runs: number) => {
    if (!isLiveGame || !runs) return;
    const side: TeamSide = half === "表" ? "away" : "home";
    if (side === "away") setAwayScore((v) => v + runs);
    else setHomeScore((v) => v + runs);
    if (game) {
      setSelectedRoom((room) =>
        room
          ? {
              ...room,
              games: room.games.map((item) =>
                item.id === game.id
                  ? {
                      ...item,
                      status: "速報中",
                      away: {
                        ...item.away,
                        score: item.away.score + (side === "away" ? runs : 0),
                      },
                      home: {
                        ...item.home,
                        score: item.home.score + (side === "home" ? runs : 0),
                      },
                    }
                  : item,
              ),
            }
          : room,
      );
    }
    setInningScores((current) => {
      const scores = [...current[side]];
      scores[inning - 1] = (scores[inning - 1] ?? 0) + runs;
      return { ...current, [side]: scores };
    });
  };
  const hit = (bases: number, text: string) => {
    if (!isLiveGame) return;
    snapshot(true);
    let runs = 0;
    const nextRunners: Partial<Record<Base, string>> = {};
    const nextRunnerPitchers: Partial<Record<Base, string>> = {};
    const responsiblePitcherKeys: string[] = [];
    ([3, 2, 1] as Base[]).forEach((base) => {
      const runner = runners[base];
      if (!runner) return;
      if (base + bases > 3) {
        runs++;
        responsiblePitcherKeys.push(runnerPitchers[base] ?? pitcher.id);
      } else {
        nextRunners[(base + bases) as Base] = runner;
        nextRunnerPitchers[(base + bases) as Base] =
          runnerPitchers[base] ?? pitcher.id;
      }
    });
    if (bases === 4) {
      runs++;
      responsiblePitcherKeys.push(pitcher.id);
    } else {
      nextRunners[bases as Base] = currentBatter.last;
      nextRunnerPitchers[bases as Base] = pitcher.id;
    }
    const plateResult: PlateResult =
      bases === 1
        ? "single"
        : bases === 2
          ? "double"
          : bases === 3
            ? "triple"
            : "home_run";
    queuePlateAppearance(plateResult, text, runs, 0, responsiblePitcherKeys);
    score(runs);
    setRunners(nextRunners);
    setRunnerPitchers(nextRunnerPitchers);
    log(text);
    resetCount();
    next();
    setResultType(null);
  };
  const freeBase = (text: string) => {
    if (!isLiveGame) return;
    snapshot(true);
    const n = { ...runners };
    const nextRunnerPitchers = { ...runnerPitchers };
    let runs = 0;
    const responsiblePitcherKeys: string[] = [];
    if (n[1]) {
      if (n[2]) {
        if (n[3]) {
          runs = 1;
          responsiblePitcherKeys.push(runnerPitchers[3] ?? pitcher.id);
        }
        n[3] = n[2];
        nextRunnerPitchers[3] = runnerPitchers[2] ?? pitcher.id;
      }
      n[2] = n[1];
      nextRunnerPitchers[2] = runnerPitchers[1] ?? pitcher.id;
    }
    n[1] = currentBatter.last;
    nextRunnerPitchers[1] = pitcher.id;
    queuePlateAppearance(
      text === "死球" ? "hit_by_pitch" : "walk",
      text,
      runs,
      0,
      responsiblePitcherKeys,
    );
    score(runs);
    setRunners(n);
    setRunnerPitchers(nextRunnerPitchers);
    log(text);
    resetCount();
    next();
    setResultType(null);
  };
  const sacrificeFly = () => {
    if (!isLiveGame) return;
    snapshot(true);
    const scoresRunner = Boolean(runners[3]);
    const responsiblePitcherKeys = scoresRunner
      ? [runnerPitchers[3] ?? pitcher.id]
      : [];
    const nextRunners = { ...runners };
    const nextRunnerPitchers = { ...runnerPitchers };
    delete nextRunners[3];
    delete nextRunnerPitchers[3];
    queuePlateAppearance(
      "sacrifice_fly",
      "犠牲フライ",
      scoresRunner ? 1 : 0,
      1,
      responsiblePitcherKeys,
    );
    if (scoresRunner) score(1);
    setRunners(nextRunners);
    setRunnerPitchers(nextRunnerPitchers);
    log("犠牲フライ");
    resetCount();
    next();
    if (outs === 2) changeHalf(true);
    else setOuts((current) => current + 1);
    setResultType(null);
  };
  const pitch = (kind: "ball" | "strike" | "foul") => {
    if (!isLiveGame) return;
    snapshot();
    if (kind === "ball") {
      if (balls === 3) {
        setHistory((h) => h.slice(1));
        freeBase("四球");
      } else setBalls((v) => v + 1);
      return;
    }
    if (kind === "foul" && strikes === 2) {
      setHistory((h) => h.slice(1));
      return;
    }
    if (strikes === 2) {
      setHistory((h) => h.slice(1));
      out("三振", "strikeout");
    } else setStrikes((v) => v + 1);
  };
  const chooseResult = (kind: string) => {
    if (!isLiveGame) return;
    if (["安打", "2塁打", "3塁打", "ゴロ", "飛", "直"].includes(kind))
      setResultType(kind);
    else if (kind === "HR") hit(4, "ホームラン");
    else if (kind === "四球" || kind === "死球") freeBase(kind);
    else if (kind === "犠飛") sacrificeFly();
    else out("三振", "strikeout");
  };
  const detail = (pos: string) => {
    if (!isLiveGame) return;
    const text = `${pos}${resultType}`;
    if (resultType === "安打") hit(1, text);
    else if (resultType === "2塁打") hit(2, text);
    else if (resultType === "3塁打") hit(3, text);
    else
      out(
        text,
        resultType === "ゴロ"
          ? "groundout"
          : resultType === "飛"
            ? "flyout"
            : "lineout",
      );
  };
  const updateTeam = (which: "away" | "home", value: Team) => {
    if (which === "away") setAway(value);
    else setHome(value);
    if (game)
      setGameTeams((cache) => ({
        ...cache,
        [game.id]: {
          away: which === "away" ? value : (cache[game.id]?.away ?? away),
          home: which === "home" ? value : (cache[game.id]?.home ?? home),
        },
      }));
  };
  const team = (which: "away" | "home") => (which === "away" ? away : home);
  const recordSubstitution = (outgoing: Player, incoming: Player) => {
    if (
      !isLiveGame ||
      outgoing.id === incoming.id ||
      outgoing.id.startsWith("slot-") ||
      incoming.id.startsWith("slot-")
    )
      return;
    const position = incoming.pos || outgoing.pos || "打";
    const description = `${outgoing.last} ${outgoing.first} → ${incoming.last} ${incoming.first}（${position}）`;
    const display = `選手交代: ${description}`;
    pendingGameEvents.current.push({
      eventType: "player_substitution",
      description,
    });
    setResult(display);
    setResultType(null);
    setPlays((items) => [`${inning}回${half} ${display}`, ...items]);
  };
  const recordDefensivePositionChange = (
    changes: { player: Player; from: string; to: string }[],
  ) => {
    if (!isLiveGame || changes.length === 0) return;
    const description = changes
      .filter(({ from, to }) => from !== to)
      .map(({ player, from, to }) => `${player.last} ${player.first}（${from}→${to}）`)
      .join(" / ");
    if (!description) return;
    const display = `守備変更: ${description}`;
    pendingGameEvents.current.push({
      eventType: "defensive_position_change",
      description,
    });
    setResult(display);
    setResultType(null);
    setPlays((items) => [`${inning}回${half} ${display}`, ...items]);
  };
  const move = (
    to: "away" | "home",
    area: "players" | "bench",
    index: number,
  ) => {
    const activeDrag = dragRef.current ?? drag;
    if (!activeDrag) return;
    const from = team(activeDrag.team),
      dest = team(to),
      fromKey = activeDrag.area,
      destKey = area;
    if (activeDrag.team === to && fromKey === "bench" && destKey === "players") {
      const bench = [...from.bench],
        [incoming] = bench.splice(activeDrag.index, 1),
        players = [...from.players],
        outgoing = players[index];
      if (!incoming) return;
      if (outgoing) {
        const replacement = { ...incoming, pos: outgoing.pos, avg: outgoing.avg };
        players[index] = replacement;
        bench.push(outgoing);
        recordSubstitution(outgoing, replacement);
      } else {
        players.splice(index, 0, { ...incoming, pos: "打" });
      }
      updateTeam(to, { ...from, players, bench });
      setDrag(null);
      return;
    }
    const fromList = [...from[fromKey]],
      [player] = fromList.splice(activeDrag.index, 1);
    const destList =
      activeDrag.team === to && fromKey === destKey
        ? fromList
        : [...dest[destKey]];
    destList.splice(index, 0, player);
    if (activeDrag.team === to)
      updateTeam(to, { ...from, [fromKey]: fromList, [destKey]: destList });
    else {
      updateTeam(activeDrag.team, { ...from, [fromKey]: fromList });
      updateTeam(to, { ...dest, [destKey]: destList });
    }
    setDrag(null);
  };
  const selectMember = (member: Member) => {
    if (!pick) return;
    const target = team(pick.team),
      key = pick.area,
      list = [...target[key]],
      slotIndex = list.findIndex((player) => player.id === pick.slotId),
      old = list[slotIndex],
      players = [...target.players],
      bench = [...target.bench],
      sourcePlayers = players.findIndex((player) => player.id === member.id),
      sourceBench = bench.findIndex((player) => player.id === member.id);
    if (slotIndex < 0 || !old) {
      setPick(null);
      return;
    }
    if (sourcePlayers >= 0)
      players[sourcePlayers] = {
        id: `slot-${Date.now()}`,
        last: "未設定",
        first: "",
        pos: players[sourcePlayers].pos,
        avg: "---",
      };
    if (sourceBench >= 0) bench.splice(sourceBench, 1);
    if (key === "players") {
      const replacement = { ...member, pos: old.pos, avg: old.avg };
      players[slotIndex] = replacement;
      recordSubstitution(old, replacement);
    } else bench[slotIndex] = { ...member, pos: old.pos, avg: old.avg };
    updateTeam(pick.team, { ...target, players, bench });
    setPick(null);
  };
  const changePosition = (
    which: "away" | "home",
    area: "players" | "bench",
    i: number,
    pos: string,
  ) => {
    if (!canEditDefense(which)) return;
    const t = team(which),
      list = [...t[area]];
    const player = list[i];
    if (!player || player.pos === pos) return;
    if (area === "players" && positions.slice(0, 9).includes(pos)) {
      const swappedIndex = list.findIndex(
        (candidate, index) => index !== i && candidate.pos === pos,
      );
      if (swappedIndex >= 0) {
        const swapped = list[swappedIndex],
          previousPosition = player.pos;
        list[i] = { ...player, pos };
        list[swappedIndex] = { ...swapped, pos: previousPosition };
        recordDefensivePositionChange([
          { player, from: previousPosition, to: pos },
          { player: swapped, from: pos, to: previousPosition },
        ]);
      } else {
        list[i] = { ...player, pos };
        recordDefensivePositionChange([{ player, from: player.pos, to: pos }]);
      }
    } else list[i] = { ...player, pos };
    updateTeam(which, { ...t, [area]: list });
  };
  const addPlayer = (which: "away" | "home") => {
    const t = team(which),
      slotId = `slot-${crypto.randomUUID()}`,
      player: Player = {
        id: slotId,
        last: "選択してください",
        first: "",
        pos: "打",
        avg: "---",
      };
    updateTeam(which, { ...t, players: [...t.players, player] });
    setPick({ team: which, area: "players", slotId });
  };
  const dropOnField = (
    which: TeamSide,
    pos: string,
    dragOverride?: DragState,
  ) => {
    const activeDrag = dragOverride ?? dragRef.current ?? drag;
    if (!activeDrag || activeDrag.team !== which || !canEditDefense(which))
      return;
    const defending = team(which);
    if (activeDrag.area === "players") {
      const players = [...defending.players],
        target = players.findIndex((player) => player.pos === pos),
        dragged = players[activeDrag.index];
      if (!dragged) return;
      if (target >= 0) {
        const displaced = players[target],
          draggedPosition = dragged.pos;
        [players[activeDrag.index].pos, players[target].pos] = [
          players[target].pos,
          players[activeDrag.index].pos,
        ];
        recordDefensivePositionChange([
          { player: dragged, from: draggedPosition, to: displaced.pos },
          { player: displaced, from: displaced.pos, to: draggedPosition },
        ]);
        updateTeam(which, { ...defending, players });
      } else {
        players[activeDrag.index] = { ...dragged, pos };
        recordDefensivePositionChange([
          { player: dragged, from: dragged.pos, to: pos },
        ]);
        updateTeam(which, { ...defending, players });
      }
    } else {
      const bench = [...defending.bench],
        [incoming] = bench.splice(activeDrag.index, 1);
      if (!incoming) return;
      const players = [...defending.players],
        target = players.findIndex((player) => player.pos === pos);
      if (target >= 0) {
        const outgoing = players[target];
        const replacement = { ...incoming, pos, avg: outgoing.avg };
        players[target] = replacement;
        bench.push(outgoing);
        recordSubstitution(outgoing, replacement);
      } else players.push({ ...incoming, pos });
      updateTeam(which, { ...defending, players, bench });
    }
    setDrag(null);
  };
  const openSharedGame = (route: SharedGameRoute) => {
    setSharedGameRoute(route);
    setSharedGameRouteState(route);
    setSharedGameAccess(null);
    setSharedGameError("");
    setSharedGameLoading(true);
    setView("shared-game");
  };
  const closeSharedGame = () => {
    clearSharedGameRoute();
    setSharedGameRouteState(null);
    setSharedGameAccess(null);
    setSharedGameError("");
    setView(
      viewerSession
        ? "viewer-list"
        : selectedRoom
          ? "room-games"
          : admin
            ? "mypage"
            : "entry",
    );
  };
  const findPlayerProfile = (playerId: string): PlayerProfile | null => {
    const awayPlayer = [...away.players, ...away.bench].find(
      (player) => player.id === playerId,
    );
    if (awayPlayer) return { player: awayPlayer, teamName: away.name };
    const homePlayer = [...home.players, ...home.bench].find(
      (player) => player.id === playerId,
    );
    return homePlayer ? { player: homePlayer, teamName: home.name } : null;
  };
  const findPlayerByName = (name: string): PlayerProfile | null =>
    [...away.players, ...away.bench, ...home.players, ...home.bench]
      .map((player) => ({
        player,
        teamName: [...away.players, ...away.bench].some(
          (awayPlayer) => awayPlayer.id === player.id,
        )
          ? away.name
          : home.name,
      }))
      .find(({ player }) => player.last === name) ?? null;
  const openPlayerProfile = (profile: PlayerProfile) => {
    if (sharedGameRoute) {
      const route = { ...sharedGameRoute, playerId: profile.player.id };
      setSharedGameRoute(route);
      setSharedGameRouteState(route);
    } else setLocalPlayerProfile(profile);
    setView("player-profile");
  };
  const closePlayerProfile = () => {
    if (sharedGameRoute?.playerId) {
      window.history.back();
      return;
    }
    setLocalPlayerProfile(null);
    setView("game");
  };
  const openGame = (selected: Game) => {
    if (selectedRoom) {
      openSharedGame({ roomId: selectedRoom.id, gameId: selected.id });
      return;
    }
    const saved = gameTeams[selected.id],
      nextAway =
        saved?.away ??
        makeTeam(selected.away, 0, selected.awayColor ?? pastelColors[0]),
      nextHome =
        saved?.home ??
        makeTeam(selected.home, 9, selected.homeColor ?? pastelColors[1]);
    setGame(selected);
    setAway(nextAway);
    setHome(nextHome);
    setGameTeams((cache) =>
      cache[selected.id]
        ? cache
        : { ...cache, [selected.id]: { away: nextAway, home: nextHome } },
    );
    setAwayScore(selected.awayScore ?? 0);
    setHomeScore(selected.homeScore ?? 0);
    setView("game");
  };
  const createGame = async (input: GameCreationInput) => {
    const created = await createOwnedGame(input),
      added: Game = {
        id: created.game.id,
        title: created.game.title,
        status: created.game.status,
        scheduledInnings: created.game.scheduledInnings,
        away: created.game.away.name,
        home: created.game.home.name,
        awayScore: 0,
        homeScore: 0,
        awayColor: created.game.away.color,
        homeColor: created.game.home.color,
      },
      nextAway = emptyTeam(added.away, created.game.away.color),
      nextHome = emptyTeam(added.home, created.game.home.color);
    setGames((g) => [...g, added]);
    setSelectedRoom((current) => ({
      id: created.room.id,
      name: created.room.name,
      roomNumber: created.room.roomNumber,
      teams: current?.id === created.room.id ? current.teams : [],
      games: [
        ...(current?.id === created.room.id ? current.games : []),
        created.game,
      ],
    }));
    setAway(nextAway);
    setHome(nextHome);
    setGameTeams((cache) => ({
      ...cache,
      [added.id]: { away: nextAway, home: nextHome },
    }));
    setInning(1);
    setHalf("表");
    setBalls(0);
    setStrikes(0);
    setOuts(0);
    setAwayScore(0);
    setHomeScore(0);
    setInningScores(emptyInningScores());
    setRunners({});
    setRunnerPitchers({});
    setResult("");
    setResultType(null);
    setHistory([]);
    setPlays(["1回表"]);
    setBatter(0);
    setBatters({ away: 0, home: 0 });
    setCreating(false);
    setGame(added);
    openSharedGame({ roomId: created.room.id, gameId: created.game.id });
  };
  const deleteGame = () => {
    if (!game) return;
    setGames((g) => g.filter((item) => item.id !== game.id));
    setSelectedRoom((current) =>
      current
        ? {
            ...current,
            games: current.games.filter((item) => item.id !== game.id),
          }
        : current,
    );
    setDeleteOpen(false);
    setView(selectedRoom ? "room-games" : "home");
    setGame(null);
  };
  const handleSharedAuthentication = async () => {
    try {
      const restored = await claimRoomViewSession();
      if (restored) setViewerSession(restored);
    } catch {
      /* 所有者は閲覧セッションがなくても続行できる */
    } finally {
      setSharedGameLoading(true);
      setSharedGameError("");
      setSharedAccessRevision((value) => value + 1);
    }
  };
  const handleViewerRoomAuthentication = async () => {
    const ownedRooms = await loadOwnedRooms();
    const ownedRoom = ownedRooms.find(
      (room) => room.id === viewerSession?.roomId,
    );
    if (ownedRoom) {
      setSelectedRoom(ownedRoom);
      setView("room-games");
      return;
    }
    setView("mypage");
  };
  const logout = async () => {
    const restoreViewer = Boolean(sharedGameRoute && viewerSession);
    hadAdminSession.current = false;
    try {
      await signOut();
      if (restoreViewer) {
        const restored = await restoreRoomViewSessionAfterLogout();
        if (restored) {
          setViewerSession(restored);
          setSharedAccessRevision((value) => value + 1);
        }
      }
    } finally {
      setAdminState(false);
      setLogoutOpen(false);
      setView(restoreViewer ? "shared-game" : "entry");
    }
  };
  if (passwordSetupOpen)
    return (
      <PasswordSetupModal open close={() => setPasswordSetupOpen(false)} />
    );
  if (!authReady)
    return (
      <main className="entry-layout">
        <div className="entry-card">
          <div className="entry-brand">
            <div className="brand">
              <span className="brand-ball">●</span>草野球速報
            </div>
          </div>
          <div className="entry-panel">読み込み中…</div>
        </div>
      </main>
    );
  if (view === "entry")
    return (
      <EntryScreen
        notice={authNotice}
        onViewer={() => setView("room-access")}
        onAdmin={() => {
          setAuthNotice("");
          setPasswordOpen(true);
        }}
      >
        <AuthModal
          open={passwordOpen}
          onAuthenticated={() => setView("mypage")}
          close={() => setPasswordOpen(false)}
        />
      </EntryScreen>
    );
  if (view === "room-access")
    return (
      <RoomAccessScreen
        onBack={() => setView("entry")}
        onSuccess={(session, games) => {
          setViewerSession(session);
          setViewerGames(games);
          setViewerError("");
          setView("viewer-list");
        }}
      />
    );
  if (view === "shared-game" && sharedGameRoute)
    return (
      <main className="entry-layout">
        <div className="entry-card">
          <header className="entry-brand">
            <div className="brand">
              <span className="brand-ball">●</span>草野球速報
            </div>
          </header>
          <section className="entry-panel">
            <span className="section-eyebrow">GAME</span>
            <h1>
              {sharedGameLoading
                ? "試合を読み込んでいます…"
                : "試合を表示できません"}
            </h1>
            {sharedGameError && (
              <>
                <p className="error">{sharedGameError}</p>
                <button
                  onClick={() => {
                    setSharedGameLoading(true);
                    setSharedGameError("");
                    setSharedAccessRevision((value) => value + 1);
                  }}
                >
                  もう一度読み込む
                </button>
                <button className="cancel" onClick={closeSharedGame}>
                  試合一覧へ戻る
                </button>
              </>
            )}
          </section>
        </div>
      </main>
    );
  if (view === "viewer-list" && viewerSession) {
    const openViewerGame = (id: string) => {
        if (isRoomViewSessionExpired()) {
          void endRoomViewSession();
          setViewerSession(null);
          setView("room-access");
          return;
        }
        openSharedGame({ roomId: viewerSession.roomId, gameId: id });
      },
      refreshViewerGames = () => {
        setViewerLoading(true);
        setViewerError("");
        void loadViewerGames(viewerSession.roomId)
          .then(setViewerGames)
          .catch(() => setViewerError("試合一覧を取得できませんでした。"))
          .finally(() => setViewerLoading(false));
      },
      exitViewer = () => {
        void endRoomViewSession();
        setViewerSession(null);
        setViewerGames([]);
        setView("entry");
      };
    if (viewerLoading || viewerError)
      return (
        <ViewerGameList
          roomName={viewerSession.roomName}
          games={viewerGames}
          loading={viewerLoading}
          error={viewerError}
          onOpen={openViewerGame}
          onRefresh={refreshViewerGames}
          onExit={exitViewer}
          onAdmin={() => setPasswordOpen(true)}
        >
          <AuthModal
            open={passwordOpen}
            onAuthenticated={handleViewerRoomAuthentication}
            close={() => setPasswordOpen(false)}
          />
        </ViewerGameList>
      );
    const roomGames: Game[] = viewerGames.map((selected) => ({
      id: selected.id,
      title: selected.title,
      status: selected.status,
      scheduledInnings: selected.scheduledInnings,
      away: selected.away.name,
      home: selected.home.name,
      awayScore: selected.away.score,
      homeScore: selected.home.score,
      awayColor: selected.away.color,
      homeColor: selected.home.color,
    }));
    return (
      <div className="viewer-room-mode">
        <Home
          games={roomGames}
          admin={false}
          members={members}
          rosterOpen={rosterOpen}
          newMember={newMember}
          roomName={viewerSession.roomName}
          roomNumber={viewerSession.roomNumber}
          onBack={exitViewer}
          onRoster={() => setRosterOpen((v) => !v)}
          onNewMember={() => undefined}
          onAddMember={() => undefined}
          onEditMember={() => undefined}
          onRemoveMember={() => undefined}
          onOpen={(selected: Game) => openViewerGame(selected.id)}
          onAdd={() => undefined}
          onAdmin={() => setPasswordOpen(true)}
          onAuthenticated={handleViewerRoomAuthentication}
          onLogout={() => undefined}
          creating={false}
          setup={setup}
          setSetup={setSetup}
          onCreate={createGame}
          onCancel={() => undefined}
          passwordOpen={passwordOpen}
          onClosePassword={() => setPasswordOpen(false)}
          logoutOpen={false}
          onLogoutConfirm={() => undefined}
          onCloseLogout={() => undefined}
        />
      </div>
    );
  }
  if (view === "mypage")
    return (
      <>
        <MyPage
          onCreateRoom={() => setRoomCreateOpen(true)}
          onOpenRoom={(room) => {
            setSelectedRoom(room);
            setView("room-games");
          }}
          onLogout={() => setLogoutOpen(true)}
        />
        <RoomCreateModal
          open={roomCreateOpen}
          close={() => setRoomCreateOpen(false)}
          onCreated={(room) => {
            setSelectedRoom(room);
            setRoomCreateOpen(false);
            setView("room-games");
          }}
        />
        <Confirm
          open={logoutOpen}
          text="ログアウトしますか？"
          confirm={() => void logout()}
          close={() => setLogoutOpen(false)}
        />
      </>
    );
  if (view === "room-games" && selectedRoom) {
    const roomGames: Game[] = selectedRoom.games.map((selected) => ({
      id: selected.id,
      title: selected.title,
      status: selected.status,
      scheduledInnings: selected.scheduledInnings,
      away: selected.away.name,
      home: selected.home.name,
      awayScore: selected.away.score,
      homeScore: selected.home.score,
      awayColor: selected.away.color,
      homeColor: selected.home.color,
    }));
    return (
      <Home
        games={roomGames}
        room={selectedRoom}
        admin={admin}
        members={members}
        rosterOpen={rosterOpen}
        newMember={newMember}
        roomName={selectedRoom.name}
        roomNumber={selectedRoom.roomNumber}
        onBack={() => setView("mypage")}
        onRoster={() => setRosterOpen((v) => !v)}
        onNewMember={(value: { last: string; first: string }) =>
          setNewMember(value)
        }
        onAddMember={() => {
          if (newMember.last) {
            setMembers((m) => [
              ...m,
              {
                id: `m${Date.now()}`,
                last: newMember.last,
                first: newMember.first,
              },
            ]);
            setNewMember({ last: "", first: "" });
          }
        }}
        onEditMember={(id: string) => {
          const member = members.find((item) => item.id === id);
          if (!member) return;
          const value = window.prompt(
            "苗字 名前を入力",
            `${member.last} ${member.first}`,
          );
          if (value) {
            const [last, first = ""] = value.split(/\s+/);
            setMembers((list) =>
              list.map((item) =>
                item.id === id ? { ...item, last, first } : item,
              ),
            );
          }
        }}
        onRemoveMember={(id: string) =>
          setMembers((list) => list.filter((item) => item.id !== id))
        }
        onOpen={openGame}
        onAdd={() => setCreating(true)}
        onLogout={() => setLogoutOpen(true)}
        creating={creating}
        setup={setup}
        setSetup={setSetup}
        onCreate={createGame}
        onCancel={() => setCreating(false)}
        passwordOpen={false}
        onClosePassword={() => setPasswordOpen(false)}
        logoutOpen={logoutOpen}
        onLogoutConfirm={() => void logout()}
        onCloseLogout={() => setLogoutOpen(false)}
      />
    );
  }
  if (view === "home")
    return (
      <Home
        games={games}
        admin={admin}
        members={members}
        rosterOpen={rosterOpen}
        newMember={newMember}
        onRoster={() => setRosterOpen((v) => !v)}
        onNewMember={(value: { last: string; first: string }) =>
          setNewMember(value)
        }
        onAddMember={() => {
          if (newMember.last) {
            setMembers((m) => [
              ...m,
              {
                id: `m${Date.now()}`,
                last: newMember.last,
                first: newMember.first,
              },
            ]);
            setNewMember({ last: "", first: "" });
          }
        }}
        onEditMember={(id: string) => {
          const member = members.find((item) => item.id === id);
          if (!member) return;
          const value = window.prompt(
            "苗字 名前を入力",
            `${member.last} ${member.first}`,
          );
          if (value) {
            const [last, first = ""] = value.split(/\s+/);
            setMembers((list) =>
              list.map((item) =>
                item.id === id ? { ...item, last, first } : item,
              ),
            );
          }
        }}
        onRemoveMember={(id: string) =>
          setMembers((list) => list.filter((item) => item.id !== id))
        }
        onOpen={openGame}
        onAdd={() => setCreating(true)}
        onAdmin={() => setPasswordOpen(true)}
        onAuthenticated={() => setView("mypage")}
        onLogout={() => setLogoutOpen(true)}
        creating={creating}
        setup={setup}
        setSetup={setSetup}
        onCreate={createGame}
        onCancel={() => setCreating(false)}
        passwordOpen={passwordOpen}
        onClosePassword={() => setPasswordOpen(false)}
        logoutOpen={logoutOpen}
        onLogoutConfirm={() => void logout()}
        onCloseLogout={() => setLogoutOpen(false)}
      />
    );
  const playerProfile = sharedGameRoute?.playerId
    ? findPlayerProfile(sharedGameRoute.playerId)
    : localPlayerProfile;
  if (view === "player-profile" && playerProfile)
    return (
      <PlayerProfileScreen
        profile={playerProfile}
        roomId={sharedGameRoute?.roomId ?? selectedRoom?.id ?? null}
        refreshKey={gameRevision}
        onBack={closePlayerProfile}
      />
    );
  return (
    <main className="app-shell">
      <header className="topbar">
        <button
          className="back"
          onClick={() =>
            sharedGameRoute
              ? closeSharedGame()
              : setView(selectedRoom ? "room-games" : "home")
          }
        >
          ‹ 試合一覧
        </button>
        <div className="brand">草野球速報</div>
        {canEditGame ? (
          <button className="admin-badge" onClick={() => setLogoutOpen(true)}>
            管理者モード
          </button>
        ) : (
          <button className="admin-open" onClick={() => setPasswordOpen(true)}>
            管理者ログイン
          </button>
        )}
      </header>
      <div className="game-meta">
        <span>{game?.title}</span>
        <span>
          第{inning}回{half}
        </span>
      </div>
      {gameSyncError && <p className="error">{gameSyncError}</p>}
      <section className="scoreboard card">
        <div className="score-head">
          <span>
            {game?.status === "試合前" ? "試合前" : `第${inning}回${half}`}
          </span>
          <strong>{game?.status}</strong>
        </div>
        <div className="score-grid score-label">
          <span>TEAM</span>
          {[1, 2, 3, 4, 5].map((v) => (
            <span key={v}>{v}</span>
          ))}
          <span>R</span>
        </div>
        <Score
          name={away.name}
          color={away.color}
          total={awayScore}
          scores={inningScores.away}
          blank={game?.status === "試合前"}
        />
        <Score
          name={home.name}
          color={home.color}
          total={homeScore}
          scores={inningScores.home}
          blank={game?.status === "試合前"}
        />
      </section>
      <section className="at-bat card">
        <div className="section-eyebrow">NOW BATTING</div>
        {isBeforeGame && (
          <p className="pre-game-note">
            試合開始前に、選手・守備位置・打順を設定できます。
          </p>
        )}
        <div className="players-row">
          <PlayerCard
            player={currentBatter}
            label={`${batters[battingSide] + 1}番`}
            onOpen={() =>
              openPlayerProfile({
                player: currentBatter,
                teamName: battingTeam.name,
              })
            }
          />
          <div className="versus">
            <span>VS</span>
            <small>対戦成績</small>
            <b>2打数 1安打</b>
          </div>
          <PlayerCard
            player={pitcher}
            label="投手"
            reverse
            onOpen={() =>
              openPlayerProfile({ player: pitcher, teamName: fieldingTeam.name })
            }
          />
        </div>
        <div className="count-row">
          <Count label="B" active={balls} max={3} tone="ball" />
          <Count label="S" active={strikes} max={2} tone="strike" />
          <Count label="O" active={outs} max={3} tone="out" />
        </div>
        {result && <ResultBanner result={result} />}
      </section>
      <Field
        team={fieldingTeam}
        teamSide={fieldingSide}
        runners={runners}
        admin={canEditDefense(fieldingSide)}
        setDrag={setDrag}
        dropOnField={dropOnField}
        findPlayerByName={findPlayerByName}
        onOpenPlayer={openPlayerProfile}
      />
      <Lineups
        away={away}
        home={home}
        admin={canEditGame}
        canEditDefense={{
          away: canEditDefense("away"),
          home: canEditDefense("home"),
        }}
        allowMemberChanges={canManageRoster}
        drag={drag}
        setDrag={setDrag}
        move={move}
        setPick={setPick}
        changePosition={changePosition}
        addPlayer={addPlayer}
        onOpenPlayer={openPlayerProfile}
      />
      <section className="history card">
        <div className="section-title">
          <span>試合経過</span>
          <small>新しい順</small>
        </div>
        {plays.map((p, i) => (
          <Play
            key={`${p}-${i}`}
            value={p}
            awayColor={away.color}
            homeColor={home.color}
          />
        ))}
      </section>
      {canEditGame && (
        <section className="admin card">
          <div className="admin-heading">
            <div>
              <span className="section-eyebrow">ADMIN CONTROLS</span>
              <h2>試合を更新</h2>
            </div>
            <button className="delete" onClick={() => setDeleteOpen(true)}>
              試合を削除
            </button>
          </div>
          {!isLiveGame && (
            <p className="admin-lock-note">
              {isBeforeGame
                ? "試合開始前はカウント・打席結果・攻守交代を入力できません。選手・守備位置・打順は上の一覧から編集できます。"
                : "試合終了後は試合の操作を入力できません。"}
            </p>
          )}
          <div className="controls">
            <div className="control-group">
              <span>カウント</span>
              <div>
                <button
                  className="pitch-yellow"
                  onClick={() => pitch("strike")}
                  disabled={!isLiveGame}
                >
                  ストライク
                </button>
                <button
                  className="pitch-lime"
                  onClick={() => pitch("ball")}
                  disabled={!isLiveGame}
                >
                  ボール
                </button>
                <button
                  className="pitch-yellow"
                  onClick={() => pitch("foul")}
                  disabled={!isLiveGame}
                >
                  ファウル
                </button>
              </div>
            </div>
            <div className="control-group">
              <span>打席結果</span>
              <div>
                {[
                  "安打",
                  "2塁打",
                  "3塁打",
                  "HR",
                  "四球",
                  "死球",
                  "犠飛",
                  "三振",
                  "ゴロ",
                  "飛",
                  "直",
                ].map((item) => (
                  <button
                    key={item}
                    className={
                      [
                        "安打",
                        "2塁打",
                        "3塁打",
                        "HR",
                        "四球",
                        "死球",
                        "犠飛",
                      ].includes(
                        item,
                      )
                        ? "result-positive"
                        : "result-negative"
                    }
                    onClick={() => chooseResult(item)}
                    disabled={!isLiveGame}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            {isLiveGame && resultType && (
              <div className="detail-picker">
                <span>{resultType}の打球位置</span>
                {positions.slice(0, 9).map((pos) => (
                  <button onClick={() => detail(pos)} key={pos}>
                    {pos}
                  </button>
                ))}
              </div>
            )}
            <div className="side-control">
              <button
                onClick={() => {
                  snapshot();
                  changeHalf();
                }}
                disabled={!isLiveGame}
              >
                攻守交代
              </button>
              <button onClick={undo} disabled={!isLiveGame || !history.length}>
                ひとつ前に戻す
              </button>
              <button
                className="start-game"
                onClick={startGame}
                disabled={Boolean(startDisabledReason)}
                title={startDisabledReason}
              >
                {isBeforeGame ? "試合を開始" : "試合開始済み"}
              </button>
              <button
                className="finish-game"
                onClick={finishGame}
                disabled={!isLiveGame}
              >
                試合終了
              </button>
            </div>
          </div>
        </section>
      )}
      <AuthModal
        open={passwordOpen}
        onAuthenticated={
          sharedGameRoute ? handleSharedAuthentication : () => setView("mypage")
        }
        close={() => setPasswordOpen(false)}
      />
      <Confirm
        open={logoutOpen}
        text="ログアウトしますか？"
        confirm={() => void logout()}
        close={() => setLogoutOpen(false)}
      />
      <Confirm
        open={deleteOpen}
        text="この試合を削除しますか？ この操作は取り消せません。"
        confirm={deleteGame}
        close={() => setDeleteOpen(false)}
      />
      {pick && (
        <MemberPicker
          members={members}
          selectedIds={
            pick
              ? [
                  ...away.players,
                  ...away.bench,
                  ...home.players,
                  ...home.bench,
                ].map((player) => player.id)
              : []
          }
          close={() => setPick(null)}
          select={selectMember}
        />
      )}
    </main>
  );
}
function EntryScreen({
  notice,
  onViewer,
  onAdmin,
  children,
}: {
  notice: string;
  onViewer: () => void;
  onAdmin: () => void;
  children?: React.ReactNode;
}) {
  return (
    <main className="entry-layout">
      <div className="entry-card">
        <header className="entry-brand">
          <div className="brand">
            <span className="brand-ball">●</span>草野球速報
          </div>
          <p>試合の進行を、みんなで見やすく。</p>
        </header>
        <section className="entry-panel">
          <span className="section-eyebrow">WELCOME</span>
          <h1>利用方法を選んでください</h1>
          <p>試合を見るだけなら、メールアドレスの登録は必要ありません。</p>
          {notice && <p className="notice">{notice}</p>}
          <div className="entry-actions">
            <button className="entry-action" onClick={onViewer}>
              <span>
                <b>閲覧のみ</b>
                <small>ルーム番号とパスワードで試合を見る</small>
              </span>
              <span>›</span>
            </button>
            <button className="entry-action admin-entry" onClick={onAdmin}>
              <span>
                <b>管理者ログイン</b>
                <small>試合の作成・編集を行う</small>
              </span>
              <span>›</span>
            </button>
          </div>
        </section>
      </div>
      {children}
    </main>
  );
}
function RoomAccessScreen({
  onBack,
  onSuccess,
}: {
  onBack: () => void;
  onSuccess: (session: RoomViewSession, games: ViewerGame[]) => void;
}) {
  const [roomNumber, setRoomNumber] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const session = await startRoomViewSession(roomNumber, password);
      const games = await loadViewerGames(session.roomId);
      setPassword("");
      onSuccess(session, games);
    } catch (reason) {
      setError(roomViewSessionErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="entry-layout">
      <div className="entry-card">
        <header className="entry-brand">
          <div className="brand">
            <span className="brand-ball">●</span>草野球速報
          </div>
        </header>
        <section className="entry-panel">
          <header className="room-access-header">
            <div>
              <span className="section-eyebrow">VIEWER ACCESS</span>
              <h1>ルームに入る</h1>
              <p>共有されたルーム情報を入力してください。</p>
            </div>
            <button className="back" type="button" onClick={onBack}>
              ‹ 戻る
            </button>
          </header>
          <form className="room-access-form" onSubmit={(e) => void submit(e)}>
            <label>
              ルーム番号
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={roomNumber}
                onChange={(e) =>
                  setRoomNumber(e.target.value.replace(/\D/g, "").slice(0, 8))
                }
                placeholder="8桁の数字"
              />
            </label>
            <label>
              ルームパスワード
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワード"
              />
            </label>
            {error && <small className="error">{error}</small>}
            <button className="primary-action" disabled={busy}>
              {busy ? "認証中…" : "試合一覧を見る"}
            </button>
          </form>
          <p className="room-access-note">
            パスワードはこの画面でのみ使用し、端末やURLには保存されません。
          </p>
        </section>
      </div>
    </main>
  );
}
function ViewerGameList({
  roomName,
  games,
  loading,
  error,
  onOpen,
  onRefresh,
  onExit,
  onAdmin,
  children,
}: {
  roomName: string;
  games: ViewerGame[];
  loading: boolean;
  error: string;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  onExit: () => void;
  onAdmin: () => void;
  children?: React.ReactNode;
}) {
  return (
    <main className="viewer-layout">
      <div className="viewer-shell">
        <header className="viewer-header">
          <div>
            <div className="brand">
              <span className="brand-ball">●</span>草野球速報
            </div>
            <div className="viewer-room-name">{roomName}</div>
          </div>
          <button className="admin-open" onClick={onAdmin}>
            管理者ログイン
          </button>
        </header>
        <section className="viewer-list-card">
          <div className="viewer-list-title">
            <span className="section-eyebrow">ROOM GAMES</span>
            <h2>試合一覧</h2>
          </div>
          {loading ? (
            <div className="viewer-empty">試合を読み込んでいます…</div>
          ) : error ? (
            <div className="viewer-empty">
              <p>{error}</p>
              <button className="secondary-action" onClick={onRefresh}>
                再読み込み
              </button>
            </div>
          ) : games.length === 0 ? (
            <div className="viewer-empty">
              このルームには表示できる試合がありません。
            </div>
          ) : (
            games.map((game) => (
              <button
                className="viewer-game-card"
                key={game.id}
                onClick={() => onOpen(game.id)}
              >
                <div className="viewer-game-card-top">
                  <strong>{game.title}</strong>
                  <span
                    className={`viewer-status ${game.status === "速報中" ? "live" : ""}`}
                  >
                    {game.status}
                  </span>
                </div>
                <div className="viewer-game-score">
                  <span>{game.away.name}</span>
                  <b>
                    {game.status === "試合前" ? "－" : game.away.score}
                    <i>–</i>
                    {game.status === "試合前" ? "－" : game.home.score}
                  </b>
                  <span>{game.home.name}</span>
                </div>
              </button>
            ))
          )}
        </section>
        <p className="viewer-session-notice">
          この閲覧権限は1時間で自動的に終了します。
        </p>
        <p className="viewer-session-notice">
          <button className="viewer-signout" onClick={onExit}>
            閲覧を終了する
          </button>
        </p>
      </div>
      {children}
    </main>
  );
}
function MyPage({
  onCreateRoom,
  onOpenRoom,
  onLogout,
}: {
  onCreateRoom: () => void;
  onOpenRoom: (room: OwnedRoom) => void;
  onLogout: () => void;
}) {
  const [rooms, setRooms] = useState<OwnedRoom[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reloadToken, setReloadToken] = useState(0),
    [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  const refresh = () => {
    setLoading(true);
    setReloadToken((value) => value + 1);
  };
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const next = await loadOwnedRooms();
        if (active) {
          setRooms(next);
          setError("");
        }
      } catch {
        if (active)
          setError(
            "マイページを読み込めませんでした。ログインが切れている場合は、ログアウトしてもう一度ログインしてください。",
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [reloadToken]);
  return (
    <main className="viewer-layout">
      <div className="viewer-shell">
        <header className="viewer-header">
          <div>
            <div className="brand">
              <span className="brand-ball">●</span>草野球速報
            </div>
            <div className="viewer-room-name">マイページ</div>
          </div>
          <button className="admin-badge" onClick={onLogout}>
            ログアウト
          </button>
        </header>
        <section className="viewer-list-card">
          <div className="viewer-list-title">
            <span className="section-eyebrow">MY ROOMS</span>
            <h2>自分のルーム</h2>
            <p className="mypage-help">
              ルームを選ぶと、そのルームの試合一覧を開きます。
            </p>
            <button
              className="primary-action mypage-create-room"
              onClick={onCreateRoom}
            >
              ＋ ルームを新規作成
            </button>
          </div>
          {loading ? (
            <div className="viewer-empty">ルームを読み込んでいます…</div>
          ) : error ? (
            <div className="viewer-empty">
              <p>{error}</p>
              <button className="secondary-action" onClick={refresh}>
                再読み込み
              </button>
            </div>
          ) : rooms.length === 0 ? (
            <div className="viewer-empty">
              <p>まだ所有しているルームがありません。</p>
              <button className="primary-action" onClick={onCreateRoom}>
                ＋ ルームを新規作成
              </button>
            </div>
          ) : (
            rooms.map((room) => {
              const expanded = expandedRoomId === room.id;
              const memberNames = room.teams.flatMap((team) => team.members);
              return (
                <section className="mypage-room" key={room.id}>
                  <div
                    className="mypage-room-summary"
                    onClick={() => onOpenRoom(room)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenRoom(room);
                      }
                    }}
                  >
                    <div>
                      <b>{room.name}</b>
                      <small>ルーム番号 {room.roomNumber}</small>
                    </div>
                    <button
                      className="room-expand"
                      type="button"
                      aria-label={
                        expanded ? "試合一覧を閉じる" : "試合一覧を展開"
                      }
                      aria-expanded={expanded}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpandedRoomId((current) =>
                          current === room.id ? null : room.id,
                        );
                      }}
                    >
                      {expanded ? "⌃" : "⌄"}
                    </button>
                  </div>
                  <div
                    className="mypage-room-info"
                    onClick={() => onOpenRoom(room)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenRoom(room);
                      }
                    }}
                  >
                    <span>
                      登録チーム:{" "}
                      {room.teams.length
                        ? room.teams.map((team) => team.name).join("・")
                        : "未登録"}
                    </span>
                    <span>
                      登録メンバー:{" "}
                      {memberNames.length ? memberNames.join("、") : "未登録"}
                    </span>
                  </div>
                  {expanded && (
                    <div
                      className="mypage-game-preview"
                      onClick={() => onOpenRoom(room)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenRoom(room);
                        }
                      }}
                    >
                      {room.games.length ? (
                        room.games.map((game) => (
                          <div className="mypage-game-row" key={game.id}>
                            <strong>{game.title}</strong>
                            <span>
                              {game.away.name} {game.away.score} –{" "}
                              {game.home.score} {game.home.name}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="mypage-empty">
                          このルームにはまだ試合がありません。
                        </p>
                      )}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
function Home(props: any) {
  return (
    <main className="home-layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-ball">●</span>草野球速報
        </div>
        <button className="member-button" onClick={props.onRoster}>
          今日のメンバー
        </button>
        {props.rosterOpen && (
          <div className="member-panel">
            <b>メンバーを追加</b>
            <input
              disabled={!props.admin}
              placeholder="苗字"
              value={props.newMember.last}
              onChange={(e: any) =>
                props.onNewMember({ ...props.newMember, last: e.target.value })
              }
            />
            <input
              disabled={!props.admin}
              placeholder="名前"
              value={props.newMember.first}
              onChange={(e: any) =>
                props.onNewMember({ ...props.newMember, first: e.target.value })
              }
            />
            <button disabled={!props.admin} onClick={props.onAddMember}>
              追加
            </button>
            <small>名前を押すと変更できます</small>
            <div className="member-list">
              {props.members.map((m: Member) => (
                <div className="member-entry" key={m.id}>
                  <button
                    disabled={!props.admin}
                    onClick={() => props.onEditMember(m.id)}
                  >
                    {m.last} {m.first}
                  </button>
                  {props.admin && (
                    <button
                      className="member-remove"
                      onClick={() => props.onRemoveMember(m.id)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
      <section className="home-main">
        <header className="home-header">
          <div>
            {props.onBack && (
              <button className="back room-list-back" onClick={props.onBack}>
                ‹ マイページ
              </button>
            )}
            <span className="section-eyebrow">
              {props.roomName ? "ROOM GAMES" : "TODAY'S GAMES"}
            </span>
            <h1>{props.roomName ? `${props.roomName} の試合` : "試合一覧"}</h1>
            {props.roomNumber && (
              <small className="room-number">
                ルーム番号 {props.roomNumber}
              </small>
            )}
          </div>
          {props.admin ? (
            <button className="admin-badge" onClick={props.onLogout}>
              管理者モード
            </button>
          ) : (
            <button className="admin-open" onClick={props.onAdmin}>
              管理者
            </button>
          )}
        </header>
        <div className="game-list">
          {props.games.map((g: Game) => (
            <button
              className="game-card"
              key={g.id}
              onClick={() => props.onOpen(g)}
            >
              <span
                className={`status ${g.status === "速報中" ? "live-status" : ""}`}
              >
                {g.status}
              </span>
              <div>
                <b>{g.awayScore ?? "－"}</b>
                <strong>{g.title}</strong>
                <b>{g.homeScore ?? "－"}</b>
              </div>
              <p>
                {g.away}
                <span>vs</span>
                {g.home}
              </p>
            </button>
          ))}
          {props.admin && (
            <button className="add-game" onClick={props.onAdd}>
              ＋<span>試合を追加</span>
            </button>
          )}
        </div>
      </section>
      <GameCreateModal
        open={props.creating}
        room={props.room ?? null}
        setup={props.setup}
        setSetup={props.setSetup}
        onCreate={props.onCreate}
        close={props.onCancel}
      />
      <AuthModal
        open={props.passwordOpen}
        onAuthenticated={props.onAuthenticated}
        close={props.onClosePassword}
      />
      <Confirm
        open={props.logoutOpen}
        text="管理者モードからログアウトしますか？"
        confirm={props.onLogoutConfirm}
        close={props.onCloseLogout}
      />
    </main>
  );
}
function GameCreateModal({
  open,
  room,
  setup,
  setSetup,
  onCreate,
  close,
}: {
  open: boolean;
  room: ExistingRoomForGame | null;
  setup: {
    away: string;
    home: string;
    awayColor: string;
    homeColor: string;
    scheduledInnings: number;
  };
  setSetup: (value: {
    away: string;
    home: string;
    awayColor: string;
    homeColor: string;
    scheduledInnings: number;
  }) => void;
  onCreate: (input: GameCreationInput) => Promise<void>;
  close: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!room) {
      setError("試合を追加するには、マイページからルームを開いてください。");
      return;
    }
    if (!setup.away.trim() || !setup.home.trim()) {
      setError("先攻・後攻のチーム名を入力してください。");
      return;
    }
    setBusy(true);
    try {
      await onCreate({
        room,
        awayName: setup.away,
        awayColor: setup.awayColor,
        homeName: setup.home,
        homeColor: setup.homeColor,
        scheduledInnings: setup.scheduledInnings,
      });
    } catch (reason) {
      setError(gameCreationErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <form
        className="setup-modal game-create-modal"
        onSubmit={(event) => void submit(event)}
      >
        <span className="section-eyebrow">NEW GAME</span>
        <h2>試合を追加</h2>
        <p>
          このルームに追加する試合の設定を入力します。作成後、打順を「今日のメンバー」から選んで配置できます。
        </p>
        <input
          autoFocus
          value={setup.away}
          onChange={(event) => setSetup({ ...setup, away: event.target.value })}
          maxLength={80}
          placeholder="先攻チーム名"
        />
        <input
          value={setup.home}
          onChange={(event) => setSetup({ ...setup, home: event.target.value })}
          maxLength={80}
          placeholder="後攻チーム名"
        />
        <label className="scheduled-innings-field">
          予定回数
          <select
            value={setup.scheduledInnings}
            onChange={(event) =>
              setSetup({
                ...setup,
                scheduledInnings: Number(event.target.value),
              })
            }
          >
            {Array.from({ length: 9 }, (_, index) => index + 1).map(
              (innings) => (
                <option value={innings} key={innings}>
                  {innings}回
                </option>
              ),
            )}
          </select>
        </label>
        <div className="color-choices">
          <label>
            先攻カラー
            <select
              value={setup.awayColor}
              onChange={(event) =>
                setSetup({ ...setup, awayColor: event.target.value })
              }
            >
              {pastelColors.map((color) => (
                <option value={color} key={color}>
                  {color}
                </option>
              ))}
            </select>
          </label>
          <label>
            後攻カラー
            <select
              value={setup.homeColor}
              onChange={(event) =>
                setSetup({ ...setup, homeColor: event.target.value })
              }
            >
              {pastelColors.map((color) => (
                <option value={color} key={color}>
                  {color}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <small className="error">{error}</small>}
        <button disabled={busy}>{busy ? "作成中…" : "試合を作成"}</button>
        <button
          type="button"
          className="cancel"
          disabled={busy}
          onClick={close}
        >
          キャンセル
        </button>
      </form>
    </div>
  );
}
function Score({
  name,
  color,
  total,
  scores,
  blank = false,
}: {
  name: string;
  color: string;
  total: number;
  scores: number[];
  blank?: boolean;
}) {
  return (
    <div className="score-grid">
      <b className="team-name">
        <span className="team-dot" style={{ backgroundColor: color }} />
        {name}
      </b>
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index}>{blank ? "－" : (scores[index] ?? "－")}</span>
      ))}
      <strong>{blank ? "－" : total}</strong>
    </div>
  );
}
function Play({
  value,
  awayColor,
  homeColor,
}: {
  value: string;
  awayColor: string;
  homeColor: string;
}) {
  const parts = value.split(" "),
    inning = parts[0],
    name = parts[1] ?? "",
    result = parts.slice(2).join(" "),
    out = ["三振", "ゴロ", "飛", "直"].some((word) => result.includes(word)),
    substitution = parseSubstitution(`${name} ${result}`.trim());
  if (substitution)
    return (
      <div className="play substitution-play">
        <span>{inning}</span>
        <div className="substitution-play-detail">
          <small>選手交代・{substitution.position}</small>
          <div>
            <Avatar name={substitution.outgoing} small />
            <b>{substitution.outgoing}</b>
            <strong className="substitution-arrow">→</strong>
            <Avatar name={substitution.incoming} small />
            <b>{substitution.incoming}</b>
          </div>
        </div>
      </div>
    );
  return (
    <div
      className="play"
      style={{ backgroundColor: inning.includes("表") ? awayColor : homeColor }}
    >
      <span>{inning}</span>
      <b>
        {name} <em className={out ? "play-out" : "play-hit"}>{result}</em>
      </b>
    </div>
  );
}
type SubstitutionDetails = {
  outgoing: string;
  incoming: string;
  position: string;
};
const parseSubstitution = (value: string): SubstitutionDetails | null => {
  const match = value.match(/^選手交代:\s*(.+?)\s*→\s*(.+?)（(.+?)）$/);
  return match
    ? { outgoing: match[1], incoming: match[2], position: match[3] }
    : null;
};
function ResultBanner({ result }: { result: string }) {
  const substitution = parseSubstitution(result);
  const defensiveChange = result.startsWith("守備変更:");
  const inningStart = /^\d+回[表裏]開始$/.test(result);
  if (substitution)
    return (
      <div className="result-banner substitution-banner">
        <span>選手交代</span>
        <strong>
          <Avatar name={substitution.outgoing} small />
          {substitution.outgoing}
          <b className="substitution-arrow">→</b>
          <Avatar name={substitution.incoming} small />
          {substitution.incoming}
        </strong>
        <small>{substitution.position}</small>
      </div>
    );
  return (
    <div
      className={`result-banner ${defensiveChange ? "defensive-change-banner" : ""} ${["三振", "ゴロ", "飛", "直"].some((word) => result.includes(word)) ? "outcome-out" : ""}`}
    >
      <span>
        {defensiveChange ? "守備変更" : inningStart ? "イニング開始" : "打席結果"}
      </span>
      <strong>{result}</strong>
    </div>
  );
}
function PlayerCard({
  player,
  label,
  reverse = false,
  onOpen,
}: {
  player: Player;
  label: string;
  reverse?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      className={`player player-profile-link ${reverse ? "pitcher" : ""}`}
      onClick={onOpen}
    >
      <Avatar name={player.last} />
      <div>
        <small>
          {label} {player.pos}
        </small>
        <h2>
          {player.last} {player.first}
        </h2>
        <p>
          打率 <b>{player.avg}</b>
        </p>
        <p>5打数 2安打</p>
      </div>
    </button>
  );
}
function PlayerProfileScreen({
  profile,
  roomId,
  refreshKey,
  onBack,
}: {
  profile: PlayerProfile;
  roomId: string | null;
  refreshKey: number;
  onBack: () => void;
}) {
  const { player, teamName } = profile;
  const [selectedTab, setSelectedTab] = useState<PlayerProfileTab>("batting");
  const [showAllPlateAppearances, setShowAllPlateAppearances] = useState(false);
  const [statistics, setStatistics] = useState<PlayerStatistics | null>(null);
  const [statisticsError, setStatisticsError] = useState("");
  const [statisticsLoading, setStatisticsLoading] = useState(Boolean(roomId));

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    void loadPlayerStatistics(roomId, player.id)
      .then((loaded) => {
        if (!cancelled) setStatistics(loaded);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatisticsError(
          error instanceof Error
            ? error.message
            : "選手成績を読み込めませんでした。",
        );
      })
      .finally(() => {
        if (!cancelled) setStatisticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [player.id, refreshKey, roomId]);

  const rate = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "—";
    const formatted = value.toFixed(3);
    return value < 1 ? formatted.replace(/^0/, "") : formatted;
  };
  const count = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : String(value);
  const innings = (recordedOuts: number | undefined) => {
    if (recordedOuts === undefined) return "—";
    const whole = Math.floor(recordedOuts / 3);
    const remainder = recordedOuts % 3;
    return `${whole}${remainder ? ` ${remainder}/3` : ""}`;
  };
  const batting = statistics?.batting;
  const pitching = statistics?.pitching;

  const battingStats = [
    ["打率", batting ? rate(batting.batting_average) : player.avg],
    ["打点", count(batting?.runs_batted_in)],
    ["本塁打", count(batting?.home_runs)],
    ["安打", count(batting?.hits)],
    ["四球", count(batting?.walks)],
    ["死球", count(batting?.hit_by_pitch)],
    ["三振", count(batting?.strikeouts)],
    ["打数", count(batting?.at_bats)],
    ["試合数", count(batting?.games)],
    ["出塁率", rate(batting?.on_base_percentage)],
    ["長打率", rate(batting?.slugging_percentage)],
    ["OPS", rate(batting?.ops)],
  ];
  const pitchingStats = [
    [
      "防御率",
      pitching?.earned_run_average === null ||
      pitching?.earned_run_average === undefined
        ? "—"
        : pitching.earned_run_average.toFixed(2),
    ],
    ["投球回", innings(pitching?.outs_recorded)],
    ["勝利", count(pitching?.wins)],
    ["敗北", count(pitching?.losses)],
    ["登板数", count(pitching?.appearances)],
    ["セーブ", count(pitching?.saves)],
    ["ホールド", count(pitching?.holds)],
    ["与四球", count(pitching?.walks)],
    ["奪三振", count(pitching?.strikeouts)],
    ["被安打", count(pitching?.hits_allowed)],
    ["自責点", count(pitching?.earned_runs)],
  ];
  const isPitcher = (pitching?.appearances ?? 0) > 0 || player.pos === "投";
  const plateAppearanceGames = statistics?.plate_appearances ?? [];
  const visiblePlateAppearanceGames = showAllPlateAppearances
    ? plateAppearanceGames
    : plateAppearanceGames.slice(0, 3);

  return (
    <main className="app-shell player-profile-screen">
      <header className="topbar">
        <button className="back" onClick={onBack}>
          ‹ 試合画面へ戻る
        </button>
        <div className="brand">草野球速報</div>
        <span className="profile-spacer" />
      </header>
      <section className="player-profile-card card">
        <span className="section-eyebrow">PLAYER PROFILE</span>
        <div className="player-profile-identity">
          <Avatar name={player.last} />
          <div>
            <h1>
              {player.last} {player.first}
            </h1>
            <p>{teamName}</p>
          </div>
        </div>
        <div className="player-profile-tabs" role="tablist" aria-label="選手成績">
          <button
            className={selectedTab === "batting" ? "active" : ""}
            onClick={() => setSelectedTab("batting")}
            role="tab"
            aria-selected={selectedTab === "batting"}
          >
            打者成績
          </button>
          <button
            className={selectedTab === "pitching" ? "active" : ""}
            onClick={() => setSelectedTab("pitching")}
            role="tab"
            aria-selected={selectedTab === "pitching"}
          >
            投球成績
          </button>
          <button
            className={selectedTab === "plate-appearances" ? "active" : ""}
            onClick={() => setSelectedTab("plate-appearances")}
            role="tab"
            aria-selected={selectedTab === "plate-appearances"}
          >
            打席結果
          </button>
        </div>
        {statisticsLoading && <p className="profile-empty">成績を集計中…</p>}
        {statisticsError && <p className="error">{statisticsError}</p>}
        {selectedTab === "batting" && (
          <ProfileStatGrid stats={battingStats} />
        )}
        {selectedTab === "pitching" &&
          (isPitcher ? (
            <ProfileStatGrid stats={pitchingStats} />
          ) : (
            <p className="profile-empty">投手経験なし</p>
          ))}
        {selectedTab === "plate-appearances" && (
          <section className="plate-appearance-list">
            {!statisticsLoading && !plateAppearanceGames.length && (
              <p className="profile-empty">
                打席結果はまだ記録されていません。
              </p>
            )}
            {visiblePlateAppearanceGames.map((gameResult) => (
              <article className="plate-appearance-game" key={gameResult.game_id}>
                <header>
                  <h2>{gameResult.game_title}</h2>
                  <time dateTime={gameResult.played_at}>
                    {new Intl.DateTimeFormat("ja-JP", {
                      year: "numeric",
                      month: "numeric",
                      day: "numeric",
                    }).format(new Date(gameResult.played_at))}
                  </time>
                </header>
                <ul>
                  {gameResult.results.map((appearance, index) => (
                    <li key={`${appearance.occurred_at}-${index}`}>
                      <span>
                        {appearance.inning}回
                        {appearance.half === "top" ? "表" : "裏"}
                      </span>
                      <b>{plateResultLabel(appearance.result)}</b>
                      <small>{appearance.description}</small>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {plateAppearanceGames.length > 3 && (
              <button
                className="show-more-plate-appearances"
                onClick={() => setShowAllPlateAppearances((current) => !current)}
              >
                {showAllPlateAppearances ? "閉じる" : "もっと見る"}
              </button>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

function plateResultLabel(result: PlateResult): string {
  return {
    single: "安打",
    double: "二塁打",
    triple: "三塁打",
    home_run: "本塁打",
    walk: "四球",
    hit_by_pitch: "死球",
    strikeout: "三振",
    groundout: "ゴロ",
    flyout: "フライ",
    lineout: "ライナー",
    sacrifice_fly: "犠牲フライ",
    sacrifice_bunt: "犠打",
  }[result];
}

function ProfileStatGrid({ stats }: { stats: string[][] }) {
  return (
    <dl className="player-profile-stats">
      {stats.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Count({
  label,
  active,
  max,
  tone,
}: {
  label: string;
  active: number;
  max: number;
  tone: string;
}) {
  return (
    <div className="count">
      <b>{label}</b>
      <span>
        {Array.from({ length: max }, (_, i) => (
          <i className={i < active ? tone : ""} key={i} />
        ))}
      </span>
    </div>
  );
}
function Field({
  team,
  teamSide,
  runners,
  admin,
  setDrag,
  dropOnField,
  findPlayerByName,
  onOpenPlayer,
}: any) {
  return (
    <section className="field-card card">
      <div className="section-title">
        <span>守備・出塁状況</span>
        <small>
          {admin ? "ドラッグで守備位置を交換" : "守備：" + team.name}
        </small>
      </div>
      <div className="field">
        <svg
          className="infield"
          viewBox="0 0 400 300"
          preserveAspectRatio="none"
        >
          <path d="M200 280 L60 140 Q200 8 340 140 Z" />
        </svg>
        <div className="bases">
          {([1, 2, 3] as Base[]).map((base) => (
            <i className={`base base-${base}`} key={base} />
          ))}
        </div>
        {([1, 2, 3] as Base[]).map(
          (base) =>
            runners[base] && (
              <button
                className={`runner runner-base-${base}`}
                key={`runner-${base}`}
                onClick={() => {
                  const profile = findPlayerByName(runners[base]);
                  if (profile) onOpenPlayer(profile);
                }}
              >
                <Avatar name={runners[base]} small />
                <b>{runners[base]}</b>
              </button>
            ),
        )}
        {slots.map((pos) => {
          const p = team.players.find((v: Player) => v.pos === pos);
          return (
            <div
              key={pos}
              className={`fielder ${slotClass(pos)}`}
              draggable={admin && !!p}
              onDragStart={(event: any) => {
                if (!p) return;
                const payload = {
                  team: teamSide,
                  area: "players",
                  index: team.players.indexOf(p),
                };
                event.dataTransfer?.setData(
                  "application/x-w-baseball-player",
                  JSON.stringify(payload),
                );
                if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                setDrag(payload);
              }}
              onDragOver={(event: any) => {
                if (!admin) return;
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event: any) => {
                event.preventDefault();
                let payload: DragState | undefined;
                try {
                  const saved = event.dataTransfer?.getData(
                    "application/x-w-baseball-player",
                  );
                  if (saved) payload = JSON.parse(saved) as DragState;
                } catch {
                  payload = undefined;
                }
                dropOnField(teamSide, pos, payload);
              }}
              onClick={() =>
                p && onOpenPlayer({ player: p, teamName: team.name })
              }
            >
              {p ? (
                <>
                  <Avatar name={p.last} small />
                  <span>{p.last}</span>
                  <em>{p.pos}</em>
                </>
              ) : (
                <span>{pos}</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
function Lineups({
  away,
  home,
  admin,
  canEditDefense,
  allowMemberChanges,
  drag,
  setDrag,
  move,
  setPick,
  changePosition,
  addPlayer,
  onOpenPlayer,
}: any) {
  return (
    <section className="lineups card">
      <div className="section-title">
        <span>メンバー・打順</span>
        <small>
          {admin ? "追加・ドラッグで編集できます" : "両チームの打順"}
        </small>
      </div>
      <div className="lineup-head">
        <b>{away.name}</b>
        <b>{home.name}</b>
      </div>
      <div className="lineup-columns">
        <Lineup
          team={away}
          id="away"
          {...{
            admin,
            canEditPositions: canEditDefense.away,
            allowMemberChanges,
            drag,
            setDrag,
            move,
            setPick,
            changePosition,
            addPlayer,
            onOpenPlayer,
          }}
        />
        <Lineup
          team={home}
          id="home"
          {...{
            admin,
            canEditPositions: canEditDefense.home,
            allowMemberChanges,
            drag,
            setDrag,
            move,
            setPick,
            changePosition,
            addPlayer,
            onOpenPlayer,
          }}
        />
      </div>
    </section>
  );
}
function Lineup({
  team,
  id,
  admin,
  canEditPositions,
  allowMemberChanges,
  drag,
  setDrag,
  move,
  setPick,
  changePosition,
  addPlayer,
  onOpenPlayer,
}: any) {
  const [lockedPositionIndex, setLockedPositionIndex] = useState<number | null>(
    null,
  );
  const lockedPositionTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (lockedPositionTimer.current !== null)
        window.clearTimeout(lockedPositionTimer.current);
    },
    [],
  );
  const showDefenseLockNotice = (index: number) => {
    setLockedPositionIndex(index);
    if (lockedPositionTimer.current !== null)
      window.clearTimeout(lockedPositionTimer.current);
    lockedPositionTimer.current = window.setTimeout(() => {
      setLockedPositionIndex(null);
      lockedPositionTimer.current = null;
    }, 3000);
  };
  const row = (p: Player, i: number, area: "players" | "bench") => (
    <div
      className={`lineup-row ${drag?.team === id && drag.index === i ? "dragging" : ""}`}
      key={p.id}
      draggable={admin}
      onDragStart={() => setDrag({ team: id, area, index: i })}
      onDragOver={(e: any) => admin && e.preventDefault()}
      onDrop={() => move(id, area, i)}
    >
      <span>{area === "players" ? i + 1 : "・"}</span>
      {admin ? (
        canEditPositions ? (
          <select
            value={p.pos}
            onChange={(e) => changePosition(id, area, i, e.target.value)}
          >
            {positions.map((pos) => (
              <option key={pos}>{pos}</option>
            ))}
          </select>
        ) : (
          <div className="locked-position-wrap">
            <button
              type="button"
              className="locked-position"
              onClick={() => showDefenseLockNotice(i)}
              aria-label={`${p.last} ${p.first}の守備位置は攻撃中は変更できません`}
            >
              {p.pos}
            </button>
            {lockedPositionIndex === i && (
              <span className="defense-locked-popover" role="status">
                攻撃中：守備変更はできません
              </span>
            )}
          </div>
        )
      ) : (
        <b>{p.pos}</b>
      )}
      <div className="lineup-player-actions">
        <button
          className="profile-player"
          onClick={() => onOpenPlayer({ player: p, teamName: team.name })}
        >
          {p.last} {p.first}
        </button>
        {allowMemberChanges && (
          <button
            className="choose-player"
            onClick={() => setPick({ team: id, area, slotId: p.id })}
          >
            変更
          </button>
        )}
      </div>
      <em>{p.avg}</em>
    </div>
  );
  return (
    <div className="team-lineup">
      {team.players.map((p: Player, i: number) => row(p, i, "players"))}
      {allowMemberChanges && (
        <button className="add-lineup-player" onClick={() => addPlayer(id)}>
          ＋ 選手を追加
        </button>
      )}
      <div className="bench-label">ベンチ</div>
      <div
        className="bench"
        onDragOver={(e: any) => admin && e.preventDefault()}
        onDrop={() => move(id, "bench", team.bench.length)}
      >
        {team.bench.map((p: Player, i: number) => row(p, i, "bench"))}
        {admin && <small>ここへドロップ</small>}
      </div>
    </div>
  );
}
function AuthModal({
  open,
  onAuthenticated,
  close,
}: {
  open: boolean;
  onAuthenticated?: () => void | Promise<void>;
  close: () => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmationEmail, setConfirmationEmail] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  if (!open) return null;
  const submit = async () => {
    setError("");
    setNotice("");
    if (!email.trim() || !password) {
      setError("メールアドレスとパスワードを入力してください。");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("パスワードは8文字以上で入力してください。");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email.trim(), password);
        await onAuthenticated?.();
        close();
        return;
      }
      const result = await signUpWithEmail(email.trim(), password);
      if (result.confirmationRequired) {
        setConfirmationEmail(email.trim());
        setPassword("");
        return;
      }
      await onAuthenticated?.();
      close();
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  const resend = async () => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await resendSignUpConfirmation(confirmationEmail);
      setNotice("確認メールを再送しました。メール内のリンクを開いてください。");
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  if (confirmationEmail)
    return (
      <div className="modal-backdrop">
        <div className="password-modal">
          <span className="section-eyebrow">CHECK YOUR EMAIL</span>
          <h2>確認メールを送信しました</h2>
          <p>
            {confirmationEmail}{" "}
            宛てのメールにあるリンクを開くと、ログインできるようになります。
          </p>
          {notice && <small className="notice">{notice}</small>}
          {error && <small className="error">{error}</small>}
          <button disabled={busy} onClick={() => void resend()}>
            {busy ? "送信中…" : "確認メールを再送する"}
          </button>
          <button
            className="cancel"
            onClick={() => {
              setConfirmationEmail("");
              setMode("login");
            }}
            disabled={busy}
          >
            ログインへ戻る
          </button>
        </div>
      </div>
    );
  return (
    <div className="modal-backdrop">
      <form
        className="password-modal"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "selected" : ""}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            ログイン
          </button>
          <button
            type="button"
            className={mode === "signup" ? "selected" : ""}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
            新規登録
          </button>
        </div>
        <span className="section-eyebrow">
          {mode === "login" ? "ADMIN LOGIN" : "CREATE ACCOUNT"}
        </span>
        <h2>{mode === "login" ? "管理者ログイン" : "メールアドレスで登録"}</h2>
        <p>
          {mode === "login"
            ? "登録済みのメールアドレスでログインします。"
            : "確認メールを受け取れるメールアドレスを入力してください。"}
        </p>
        <input
          autoFocus
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス"
        />
        <input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={
            mode === "login" ? "パスワード" : "パスワード（8文字以上）"
          }
        />
        {error && <small className="error">{error}</small>}
        <button disabled={busy}>
          {busy
            ? mode === "login"
              ? "ログイン中…"
              : "登録中…"
            : mode === "login"
              ? "ログインする"
              : "確認メールを送る"}
        </button>
        <button
          type="button"
          className="cancel"
          onClick={close}
          disabled={busy}
        >
          キャンセル
        </button>
      </form>
    </div>
  );
}
function PasswordSetupModal({
  open,
  close,
}: {
  open: boolean;
  close: () => void;
}) {
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [complete, setComplete] = useState(false);
  if (!open) return null;
  const submit = async () => {
    setError("");
    if (password.length < 8) {
      setError("パスワードは8文字以上にしてください。");
      return;
    }
    if (password !== confirmation) {
      setError("確認用パスワードが一致しません。");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setComplete(true);
      setPassword("");
      setConfirmation("");
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <form
        className="password-modal"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <span className="section-eyebrow">ACCOUNT SETUP</span>
        <h2>パスワードを設定</h2>
        {complete ? (
          <>
            <p>
              設定しました。次回からメールアドレスとこのパスワードでログインできます。
            </p>
            <button type="button" onClick={close}>
              閉じる
            </button>
          </>
        ) : (
          <>
            <p>
              招待の承認が完了しました。8文字以上のパスワードを設定してください。
            </p>
            <input
              autoFocus
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="新しいパスワード（8文字以上）"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="確認用パスワード"
            />
            {error && <small className="error">{error}</small>}
            <button disabled={busy}>
              {busy ? "設定中…" : "パスワードを設定"}
            </button>
            <button
              type="button"
              className="cancel"
              onClick={close}
              disabled={busy}
            >
              あとで設定する
            </button>
          </>
        )}
      </form>
    </div>
  );
}
function Confirm({ open, text, confirm, close }: any) {
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="password-modal">
        <h2>確認</h2>
        <p>{text}</p>
        <button onClick={confirm}>はい</button>
        <button className="cancel" onClick={close}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
function MemberPicker({
  members,
  selectedIds,
  select,
  close,
}: {
  members: Member[];
  selectedIds: string[];
  select: (m: Member) => void;
  close: () => void;
}) {
  const selected = new Set(selectedIds);
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <h2>今日のメンバーから選択</h2>
        {members.map((m) => (
          <button
            className={selected.has(m.id) ? "already-selected" : ""}
            disabled={selected.has(m.id)}
            key={m.id}
            onClick={() => select(m)}
          >
            {m.last} {m.first}
          </button>
        ))}
        <button className="cancel" onClick={close}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
function slotClass(pos: string) {
  return (
    {
      左: "lf",
      中: "cf",
      右: "rf",
      三: "third",
      遊: "ss",
      二: "second",
      一: "first",
      投: "pitcher",
      捕: "catcher",
    } as Record<string, string>
  )[pos];
}
export default App;
function RoomCreateModal({
  open,
  close,
  onCreated,
}: {
  open: boolean;
  close: () => void;
  onCreated: (room: OwnedRoom) => void;
}) {
  const [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!open) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("ルーム名を入力してください。");
      return;
    }
    if (password.length < 8) {
      setError("ルームパスワードは8文字以上で入力してください。");
      return;
    }
    if (password !== confirmation) {
      setError("確認用パスワードが一致しません。");
      return;
    }
    setBusy(true);
    try {
      const room = await createOwnedRoom(name, password);
      setName("");
      setPassword("");
      setConfirmation("");
      onCreated(room);
    } catch (reason) {
      setError(roomCreationErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <form className="password-modal" onSubmit={(event) => void submit(event)}>
        <span className="section-eyebrow">NEW ROOM</span>
        <h2>ルームを新規作成</h2>
        <p>
          ルーム番号は自動で発行されます。閲覧する人に、作成後にルーム番号とパスワードを共有してください。
        </p>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="ルーム名"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="ルームパスワード（8文字以上）"
        />
        <input
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="ルームパスワード（確認用）"
        />
        {error && <small className="error">{error}</small>}
        <button disabled={busy}>{busy ? "作成中…" : "ルームを作成する"}</button>
        <button
          type="button"
          className="cancel"
          disabled={busy}
          onClick={close}
        >
          キャンセル
        </button>
      </form>
    </div>
  );
}
