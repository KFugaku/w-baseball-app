import { isSupabaseConfigured, supabase } from './supabase'

export type ExistingRoomForGame = {
  id: string
  name: string
  roomNumber: string
}

export type GameCreationInput = {
  room: ExistingRoomForGame
  awayName: string
  awayColor: string
  homeName: string
  homeColor: string
  scheduledInnings: number
}

export type CreatedOwnedGame = {
  room: ExistingRoomForGame
  game: {
    id: string
    title: string
    status: '試合前'
    scheduledInnings: number
    away: { name: string; color: string; score: number }
    home: { name: string; color: string; score: number }
  }
}

function client() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase接続が未設定です。')
  }
  return supabase
}

export function gameCreationErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/チーム名を|異なるチーム名|試合名は|カラー|権限がありません|ログインが必要/i.test(error.message)) {
      return error.message
    }
    if (/create_owned_game|schema cache|could not find the function/i.test(error.message)) {
      return '試合作成機能の準備を反映中です。最新のSQLマイグレーションを実行してから、画面を再読み込みしてください。'
    }
  }
  return '試合を作成できませんでした。入力内容とSupabaseの設定を確認してください。'
}

export async function createOwnedGame(input: GameCreationInput): Promise<CreatedOwnedGame> {
  const { data, error } = await client().rpc('create_owned_game', {
    target_room_id: input.room.id,
    target_title: null,
    target_away_name: input.awayName.trim(),
    target_away_color: input.awayColor,
    target_home_name: input.homeName.trim(),
    target_home_color: input.homeColor,
    target_scheduled_innings: input.scheduledInnings,
  })
  if (error) throw error

  const created = Array.isArray(data) ? data[0] : data
  if (!created?.room_id || !created?.game_id) {
    throw new Error('試合作成結果を確認できませんでした。')
  }

  return {
    room: {
      id: created.room_id,
      name: created.room_name,
      roomNumber: created.room_number,
    },
    game: {
      id: created.game_id,
      title: created.game_title,
      status: '試合前',
      scheduledInnings: created.scheduled_innings,
      away: { name: created.away_team_name, color: created.away_team_color, score: 0 },
      home: { name: created.home_team_name, color: created.home_team_color, score: 0 },
    },
  }
}
