/**
 * Supabase の public スキーマと 1 対 1 に対応する共有型です。
 * マイグレーションを変更したら、このファイルも同じ変更で更新します。
 */

export type GameStatus = 'before' | 'live' | 'finished'
export type TeamSide = 'away' | 'home'
export type LineupRole = 'starter' | 'bench'
export type InningHalf = 'top' | 'bottom'

export type ProfileRow = {
  id: string
  display_name: string | null
  last_room_id: string | null
  created_at: string
  updated_at: string
}

/**
 * ブラウザへ返してよいルーム情報。
 * room_password_hash はサーバー側の照合専用であり、この型には含めない。
 */
export type RoomRow = {
  id: string
  owner_id: string | null
  name: string
  room_number: string
  created_at: string
  updated_at: string
}

/**
 * ルームパスワード照合の成功時だけ、限定RPCから返される情報。
 * パスワードやハッシュ、閲覧者の識別子は含めない。
 */
export type RoomViewSessionRow = {
  room_id: string
  room_name: string
  expires_at: string
}

export type TeamRow = {
  id: string
  room_id: string
  name: string
  color: string | null
  created_at: string
  updated_at: string
}

export type PlayerRow = {
  id: string
  team_id: string | null
  last_name: string
  first_name: string
  icon_url: string | null
  batting_average: number | null
  created_at: string
  updated_at: string
}

export type GameRow = {
  id: string
  room_id: string
  title: string
  status: GameStatus
  scheduled_at: string | null
  created_at: string
  updated_at: string
}

export type GameTeamRow = {
  id: string
  game_id: string
  team_id: string
  side: TeamSide
  score: number
  created_at: string
  updated_at: string
}

export type LineupRow = {
  id: string
  game_team_id: string
  player_id: string
  batting_order: number | null
  field_position: string | null
  role: LineupRole
  created_at: string
  updated_at: string
}

export type GameStateRow = {
  game_id: string
  inning: number
  half: InningHalf
  balls: number
  strikes: number
  outs: number
  batter_order: number
  away_score: number
  home_score: number
  snapshot: Record<string, unknown>
  updated_at: string
}

export type GameRunnerRow = {
  id: string
  game_id: string
  base: 1 | 2 | 3
  player_id: string
  created_at: string
  updated_at: string
}

export type GameEventRow = {
  id: string
  game_id: string
  sequence: number
  inning: number
  half: InningHalf
  event_type: string
  description: string
  batter_id: string | null
  payload: Record<string, unknown>
  occurred_at: string
  created_at: string
}

export type AppSnapshotRow<TPayload = Record<string, unknown>> = {
  scope: string
  payload: TPayload
  updated_at: string
}
