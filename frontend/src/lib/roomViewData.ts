import type { GameEventRow, GameRow, GameStateRow, GameTeamRow, TeamRow } from '@w-baseball/shared'
import { isSupabaseConfigured, supabase } from './supabase'

export type ViewerGame = {
  id: string
  title: string
  status: '試合前' | '速報中' | '試合終了'
  away: { name: string; color: string; score: number }
  home: { name: string; color: string; score: number }
}

export type ViewerGameDetail = ViewerGame & {
  state: Pick<GameStateRow, 'inning' | 'half' | 'balls' | 'strikes' | 'outs' | 'away_score' | 'home_score'> | null
  events: Pick<GameEventRow, 'id' | 'sequence' | 'inning' | 'half' | 'description' | 'occurred_at'>[]
}

export type GameAccess = 'owner' | 'viewer'
export type GameStateUpdate = Partial<Pick<GameStateRow, 'inning' | 'half' | 'balls' | 'strikes' | 'outs' | 'away_score' | 'home_score'>>

type RemoteGameTeam = Pick<GameTeamRow, 'game_id' | 'team_id' | 'side' | 'score'>

const statusLabels: Record<GameRow['status'], ViewerGame['status']> = {
  before: '試合前',
  live: '速報中',
  finished: '試合終了',
}

function requireClient() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase接続が未設定です。')
  }
  return supabase
}

async function getGameSummaries(roomId: string, gameId?: string): Promise<ViewerGame[]> {
  const client = requireClient()
  let gameRequest = client
    .from('games')
    .select('id, room_id, title, status, scheduled_at, created_at, updated_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })

  if (gameId) gameRequest = gameRequest.eq('id', gameId)

  const { data: gameRows, error: gamesError } = await gameRequest
  if (gamesError) throw gamesError

  const games = (gameRows ?? []) as GameRow[]
  if (!games.length) return []

  const ids = games.map((game) => game.id)
  const { data: gameTeamRows, error: gameTeamsError } = await client
    .from('game_teams')
    .select('game_id, team_id, side, score')
    .in('game_id', ids)
  if (gameTeamsError) throw gameTeamsError

  const gameTeams = (gameTeamRows ?? []) as RemoteGameTeam[]
  const teamIds = [...new Set(gameTeams.map((team) => team.team_id))]
  const teamsById = new Map<string, Pick<TeamRow, 'id' | 'name' | 'color'>>()

  if (teamIds.length) {
    const { data: teamRows, error: teamsError } = await client
      .from('teams')
      .select('id, name, color')
      .in('id', teamIds)
    if (teamsError) throw teamsError

    for (const team of (teamRows ?? []) as Pick<TeamRow, 'id' | 'name' | 'color'>[]) {
      teamsById.set(team.id, team)
    }
  }

  return games.map((game) => {
    const sides = new Map(gameTeams.filter((team) => team.game_id === game.id).map((team) => [team.side, team]))
    const formatTeam = (side: 'away' | 'home') => {
      const gameTeam = sides.get(side)
      const team = gameTeam ? teamsById.get(gameTeam.team_id) : undefined
      return {
        name: team?.name ?? '未設定',
        color: team?.color ?? '#708078',
        score: gameTeam?.score ?? 0,
      }
    }

    return {
      id: game.id,
      title: game.title,
      status: statusLabels[game.status],
      away: formatTeam('away'),
      home: formatTeam('home'),
    }
  })
}

/** RLSにより、開始済みの閲覧セッションがあるルームの試合だけを返す。 */
export async function loadViewerGames(roomId: string): Promise<ViewerGame[]> {
  return getGameSummaries(roomId)
}

/** 閲覧画面に必要な、試合のスコア・現在状況・経過を読み取る。 */
export async function loadViewerGameDetail(roomId: string, gameId: string): Promise<ViewerGameDetail | null> {
  const [game] = await getGameSummaries(roomId, gameId)
  if (!game) return null

  const client = requireClient()
  const [{ data: stateRow, error: stateError }, { data: eventRows, error: eventsError }] = await Promise.all([
    client
      .from('game_states')
      .select('inning, half, balls, strikes, outs, away_score, home_score')
      .eq('game_id', gameId)
      .maybeSingle(),
    client
      .from('game_events')
      .select('id, sequence, inning, half, description, occurred_at')
      .eq('game_id', gameId)
      .order('sequence', { ascending: false }),
  ])

  if (stateError) throw stateError
  if (eventsError) throw eventsError

  return {
    ...game,
    state: stateRow as ViewerGameDetail['state'],
    events: (eventRows ?? []) as ViewerGameDetail['events'],
  }
}

/**
 * 編集可否は画面のログイン状態ではなく、Supabase上の所有者・閲覧セッションで判定する。
 * null は、対象のルーム／試合を表示する権限がない状態を表す。
 */
export async function getGameAccess(roomId: string, gameId: string): Promise<GameAccess | null> {
  const { data, error } = await requireClient().rpc('get_game_access', {
    target_room_id: roomId,
    target_game_id: gameId,
  })
  if (error) throw error
  return data === 'owner' || data === 'viewer' ? data : null
}

/** 所有者だけがRLSを通過できる、共通詳細画面からの試合状況更新。 */
export async function updateGameState(gameId: string, update: GameStateUpdate): Promise<void> {
  const { error } = await requireClient()
    .from('game_states')
    .update(update)
    .eq('game_id', gameId)
  if (error) throw error
}
