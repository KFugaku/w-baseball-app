import type {
  GameEventRow,
  GameRow,
  GameStateRow,
  GameTeamRow,
  TeamRow,
} from "@w-baseball/shared";
import { isSupabaseConfigured, supabase } from "./supabase";

export type ViewerGame = {
  id: string;
  title: string;
  status: "試合前" | "速報中" | "試合終了";
  scheduledInnings: number;
  away: { name: string; color: string; score: number };
  home: { name: string; color: string; score: number };
};

export type ViewerGameDetail = ViewerGame & {
  state: Pick<
    GameStateRow,
    | "inning"
    | "half"
    | "balls"
    | "strikes"
    | "outs"
    | "batter_order"
    | "away_score"
    | "home_score"
    | "snapshot"
    | "revision"
  > | null;
  events: Pick<
    GameEventRow,
    | "id"
    | "sequence"
    | "inning"
    | "half"
    | "event_type"
    | "description"
    | "occurred_at"
  >[];
};

export type GameAccess = "owner" | "viewer";
export type GameStateUpdate = Partial<
  Pick<
    GameStateRow,
    | "inning"
    | "half"
    | "balls"
    | "strikes"
    | "outs"
    | "batter_order"
    | "away_score"
    | "home_score"
    | "snapshot"
  >
>;

export type GameEventUpdate = {
  expectedRevision: number;
  clientEventId: string;
  eventType: string;
  description: string;
  state: Required<GameStateUpdate>;
  status: GameRow["status"];
  plateAppearance?: {
    batter: { key: string; lastName: string; firstName: string };
    pitcher: { key: string; lastName: string; firstName: string };
    result: PlateResult;
    runsBattedIn: number;
    outsRecorded: number;
    responsiblePitcherKeys: string[];
    baseRunnersBefore: number;
    inning: number;
    half: "top" | "bottom";
  };
};

export type PlateResult =
  | "single"
  | "double"
  | "triple"
  | "home_run"
  | "walk"
  | "hit_by_pitch"
  | "strikeout"
  | "groundout"
  | "flyout"
  | "lineout"
  | "sacrifice_fly"
  | "sacrifice_bunt";

export type PlayerStatistics = {
  batting: {
    games: number;
    at_bats: number;
    hits: number;
    home_runs: number;
    walks: number;
    hit_by_pitch: number;
    strikeouts: number;
    runs_batted_in: number;
    batting_average: number | null;
    on_base_percentage: number | null;
    slugging_percentage: number | null;
    ops: number | null;
  };
  pitching: {
    appearances: number;
    outs_recorded: number;
    wins: number;
    losses: number;
    saves: number;
    holds: number;
    walks: number;
    strikeouts: number;
    hits_allowed: number;
    earned_runs: number;
    earned_run_average: number | null;
  };
  plate_appearances: {
    game_id: string;
    game_title: string;
    played_at: string;
    results: {
      inning: number;
      half: "top" | "bottom";
      result: PlateResult;
      description: string;
      occurred_at: string;
    }[];
  }[];
};

/** 試合中の打順・NOW BATTINGで使う、軽量な成績サマリー。 */
export type PlayerStatisticSummary = Pick<
  PlayerStatistics["batting"],
  "games" | "at_bats" | "hits" | "home_runs" | "runs_batted_in" | "batting_average"
> & {
  appearances: number;
  outs_recorded: number;
  earned_runs: number;
  earned_run_average: number | null;
};

export type GameEventUpdateResult = {
  revision: number;
  updatedAt: string;
};

type RemoteGameTeam = Pick<
  GameTeamRow,
  "game_id" | "team_id" | "side" | "score"
>;

const statusLabels: Record<GameRow["status"], ViewerGame["status"]> = {
  before: "試合前",
  live: "速報中",
  finished: "試合終了",
};

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase接続が未設定です。");
  }
  return supabase;
}

async function getGameSummaries(
  roomId: string,
  gameId?: string,
): Promise<ViewerGame[]> {
  const client = requireClient();
  let gameRequest = client
    .from("games")
    .select("id, room_id, title, status, scheduled_innings, scheduled_at, created_at, updated_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });

  if (gameId) gameRequest = gameRequest.eq("id", gameId);

  const { data: gameRows, error: gamesError } = await gameRequest;
  if (gamesError) throw gamesError;

  const games = (gameRows ?? []) as GameRow[];
  if (!games.length) return [];

  const ids = games.map((game) => game.id);
  const { data: gameTeamRows, error: gameTeamsError } = await client
    .from("game_teams")
    .select("game_id, team_id, side, score")
    .in("game_id", ids);
  if (gameTeamsError) throw gameTeamsError;

  const gameTeams = (gameTeamRows ?? []) as RemoteGameTeam[];
  const teamIds = [...new Set(gameTeams.map((team) => team.team_id))];
  const teamsById = new Map<string, Pick<TeamRow, "id" | "name" | "color">>();

  if (teamIds.length) {
    const { data: teamRows, error: teamsError } = await client
      .from("teams")
      .select("id, name, color")
      .in("id", teamIds);
    if (teamsError) throw teamsError;

    for (const team of (teamRows ?? []) as Pick<
      TeamRow,
      "id" | "name" | "color"
    >[]) {
      teamsById.set(team.id, team);
    }
  }

  return games.map((game) => {
    const sides = new Map(
      gameTeams
        .filter((team) => team.game_id === game.id)
        .map((team) => [team.side, team]),
    );
    const formatTeam = (side: "away" | "home") => {
      const gameTeam = sides.get(side);
      const team = gameTeam ? teamsById.get(gameTeam.team_id) : undefined;
      return {
        name: team?.name ?? "未設定",
        color: team?.color ?? "#708078",
        score: gameTeam?.score ?? 0,
      };
    };

    return {
      id: game.id,
      title: game.title,
      status: statusLabels[game.status],
      scheduledInnings: game.scheduled_innings,
      away: formatTeam("away"),
      home: formatTeam("home"),
    };
  });
}

/** RLSにより、開始済みの閲覧セッションがあるルームの試合だけを返す。 */
export async function loadViewerGames(roomId: string): Promise<ViewerGame[]> {
  return getGameSummaries(roomId);
}

/** 閲覧画面に必要な、試合のスコア・現在状況・経過を読み取る。 */
export async function loadViewerGameDetail(
  roomId: string,
  gameId: string,
): Promise<ViewerGameDetail | null> {
  const [game] = await getGameSummaries(roomId, gameId);
  if (!game) return null;

  const client = requireClient();
  const [
    { data: stateRow, error: stateError },
    { data: eventRows, error: eventsError },
  ] = await Promise.all([
    client
      .from("game_states")
      .select(
        "inning, half, balls, strikes, outs, batter_order, away_score, home_score, snapshot, revision",
      )
      .eq("game_id", gameId)
      .maybeSingle(),
    client
      .from("game_events")
      .select("id, sequence, inning, half, event_type, description, occurred_at")
      .eq("game_id", gameId)
      .is("reverted_at", null)
      .neq("event_type", "state_reverted")
      .order("sequence", { ascending: false }),
  ]);

  if (stateError) throw stateError;
  if (eventsError) throw eventsError;

  return {
    ...game,
    state: stateRow as ViewerGameDetail["state"],
    events: (eventRows ?? []) as ViewerGameDetail["events"],
  };
}

/**
 * 編集可否は画面のログイン状態ではなく、Supabase上の所有者・閲覧セッションで判定する。
 * null は、対象のルーム／試合を表示する権限がない状態を表す。
 */
export async function getGameAccess(
  roomId: string,
  gameId: string,
): Promise<GameAccess | null> {
  const { data, error } = await requireClient().rpc("get_game_access", {
    target_room_id: roomId,
    target_game_id: gameId,
  });
  if (error) throw error;
  return data === "owner" || data === "viewer" ? data : null;
}

/**
 * 進行状態・一覧用スコア・イベントをPostgreSQLの1トランザクションで記録する。
 * revision が一致しない場合はサーバーが更新を拒否するため、別端末との競合で上書きしない。
 */
export async function applyGameEvent(
  gameId: string,
  event: GameEventUpdate,
): Promise<GameEventUpdateResult> {
  const client = requireClient();
  const { data, error } = await client.rpc("apply_game_event", {
    target_game_id: gameId,
    expected_revision: event.expectedRevision,
    target_client_event_id: event.clientEventId,
    target_event_type: event.eventType,
    target_description: event.description,
    target_inning: event.state.inning,
    target_half: event.state.half,
    target_balls: event.state.balls,
    target_strikes: event.state.strikes,
    target_outs: event.state.outs,
    target_batter_order: event.state.batter_order,
    target_away_score: event.state.away_score,
    target_home_score: event.state.home_score,
    target_snapshot: event.state.snapshot,
    target_status: event.status,
    target_batter: event.plateAppearance
      ? {
          key: event.plateAppearance.batter.key,
          last_name: event.plateAppearance.batter.lastName,
          first_name: event.plateAppearance.batter.firstName,
        }
      : null,
    target_pitcher: event.plateAppearance
      ? {
          key: event.plateAppearance.pitcher.key,
          last_name: event.plateAppearance.pitcher.lastName,
          first_name: event.plateAppearance.pitcher.firstName,
        }
      : null,
    target_plate_result: event.plateAppearance?.result ?? null,
    target_runs_batted_in: event.plateAppearance?.runsBattedIn ?? 0,
    target_outs_recorded: event.plateAppearance?.outsRecorded ?? 0,
    target_run_responsible_pitcher_keys:
      event.plateAppearance?.responsiblePitcherKeys ?? [],
    target_base_runners_before:
      event.plateAppearance?.baseRunnersBefore ?? 0,
    target_revert_last_plate_appearance: false,
    target_plate_inning: event.plateAppearance?.inning ?? null,
    target_plate_half: event.plateAppearance?.half ?? null,
  });
  if (error) throw error;
  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved || typeof saved.revision !== "number" || !saved.updated_at) {
    throw new Error("試合更新結果を確認できませんでした。");
  }
  return { revision: saved.revision, updatedAt: saved.updated_at };
}

/**
 * 直近の有効な試合操作を取り消し、指定された完全な試合状態を同一トランザクションで保存する。
 * 打席結果を無効化する場合も、成績集計は reverted_at を参照するため自動的に更新される。
 */
export async function revertGameEvent(
  gameId: string,
  event: Pick<
    GameEventUpdate,
    "expectedRevision" | "clientEventId" | "state" | "status"
  >,
): Promise<GameEventUpdateResult> {
  const { data, error } = await requireClient().rpc("revert_game_event", {
    target_game_id: gameId,
    expected_revision: event.expectedRevision,
    target_client_event_id: event.clientEventId,
    target_inning: event.state.inning,
    target_half: event.state.half,
    target_balls: event.state.balls,
    target_strikes: event.state.strikes,
    target_outs: event.state.outs,
    target_batter_order: event.state.batter_order,
    target_away_score: event.state.away_score,
    target_home_score: event.state.home_score,
    target_snapshot: event.state.snapshot,
    target_status: event.status,
  });
  if (error) throw error;
  const saved = Array.isArray(data) ? data[0] : data;
  if (!saved || typeof saved.revision !== "number" || !saved.updated_at) {
    throw new Error("試合の復元結果を確認できませんでした。");
  }
  return { revision: saved.revision, updatedAt: saved.updated_at };
}

/** NPB公式の計算式に沿ってDB側で集計した、ルーム内の選手成績を取得する。 */
export async function loadPlayerStatistics(
  roomId: string,
  playerKey: string,
): Promise<PlayerStatistics> {
  const { data, error } = await requireClient().rpc("get_player_statistics", {
    target_room_id: roomId,
    target_player_key: playerKey,
  });
  if (error) throw error;
  return data as PlayerStatistics;
}

/**
 * 表示中の打順を一度に取得する。氏名ではなく、試合イベントに保存された player key で対応付ける。
 */
export async function loadRoomPlayerStatisticSummaries(
  roomId: string,
  playerKeys: string[],
): Promise<Record<string, PlayerStatisticSummary>> {
  const uniqueKeys = Array.from(new Set(playerKeys.filter(Boolean)));
  if (!uniqueKeys.length) return {};

  const { data, error } = await requireClient().rpc(
    "get_room_player_stat_summaries",
    {
      target_room_id: roomId,
      target_player_keys: uniqueKeys,
    },
  );
  if (error) throw error;

  return Object.fromEntries(
    ((data ?? []) as {
      player_key: string;
      batting: Pick<
        PlayerStatistics["batting"],
        | "games"
        | "at_bats"
        | "hits"
        | "home_runs"
        | "runs_batted_in"
        | "batting_average"
      >;
      pitching: Pick<
        PlayerStatistics["pitching"],
        "appearances" | "outs_recorded" | "earned_runs" | "earned_run_average"
      >;
    }[]).map(({ player_key, batting, pitching }) => [
      player_key,
      { ...batting, ...pitching },
    ]),
  );
}

/** Realtimeで試合に関係する行が更新されたら、表示を再取得する。 */
export function subscribeToGameChanges(
  gameId: string,
  onChange: () => void,
): () => void {
  if (!isSupabaseConfigured || !supabase) return () => undefined;
  const client = supabase;
  const channel = client
    .channel(`game:${gameId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "games",
        filter: `id=eq.${gameId}`,
      },
      onChange,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "game_states",
        filter: `game_id=eq.${gameId}`,
      },
      onChange,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "game_teams",
        filter: `game_id=eq.${gameId}`,
      },
      onChange,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "game_events",
        filter: `game_id=eq.${gameId}`,
      },
      onChange,
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
