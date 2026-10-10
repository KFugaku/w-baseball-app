import { isSupabaseConfigured, supabase } from './supabase'

export type ExistingRoomForGame = {
  id: string
  name: string
  roomNumber: string
}

export type GameCreationInput = {
  room: ExistingRoomForGame
  awayName: string
  awayAbbreviation: string
  awayColor: string
  homeName: string
  homeAbbreviation: string
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
    away: { name: string; abbreviation: string; color: string; score: number }
    home: { name: string; abbreviation: string; color: string; score: number }
  }
}

type SupabaseErrorLike = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

function client() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase接続が未設定です。')
  }
  return supabase
}

export function gameCreationErrorMessage(error: unknown): string {
  const supabaseError =
      error && typeof error === 'object' ? (error as SupabaseErrorLike) : null,
    message =
      error instanceof Error
        ? error.message
        : typeof supabaseError?.message === 'string'
          ? supabaseError.message
          : '',
    details =
      typeof supabaseError?.details === 'string' ? supabaseError.details : '',
    hint = typeof supabaseError?.hint === 'string' ? supabaseError.hint : '',
    code = typeof supabaseError?.code === 'string' ? supabaseError.code : '',
    diagnostic = `${code} ${message} ${details} ${hint}`

  if (/チーム名を|異なるチーム名|試合名は|カラー|権限がありません|ログインが必要/i.test(message)) {
    return message
  }
  if (
    /PGRST202|create_owned_game|schema cache|could not find the function/i.test(
      diagnostic,
    )
  ) {
    return '試合作成用SQLが旧版です。202610060010_player_statistics.sql をSupabase SQL Editorで実行し、画面を再読み込みしてください。'
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

  // 同名チームをルーム内で再利用する既存の作成RPCと整合させるため、
  // 表示用の略称とカラーは作成後にチーム本体へ保存する。
  const teamConfigurations = [
    {
      name: input.awayName.trim(),
      abbreviation: input.awayAbbreviation.trim(),
      color: input.awayColor,
    },
    {
      name: input.homeName.trim(),
      abbreviation: input.homeAbbreviation.trim(),
      color: input.homeColor,
    },
  ]
  for (const team of teamConfigurations) {
    const { data: updatedTeams, error: teamError } = await client()
      .from('teams')
      .update({ abbreviation: team.abbreviation, color: team.color })
      .eq('room_id', created.room_id)
      .eq('name', team.name)
      .select('id')
    if (teamError) throw teamError
    if (!updatedTeams?.length) throw new Error('作成したチームを更新できませんでした。')
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
      away: {
        name: created.away_team_name,
        abbreviation: input.awayAbbreviation.trim(),
        color: input.awayColor,
        score: 0,
      },
      home: {
        name: created.home_team_name,
        abbreviation: input.homeAbbreviation.trim(),
        color: input.homeColor,
        score: 0,
      },
    },
  }
}

export async function updateOwnedTeamConfiguration(input: {
  roomId: string
  currentName: string
  name: string
  abbreviation: string
  color: string
}): Promise<void> {
  const { data, error } = await client()
    .from('teams')
    .update({
      name: input.name.trim(),
      abbreviation: input.abbreviation.trim(),
      color: input.color,
    })
    .eq('room_id', input.roomId)
    .eq('name', input.currentName)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('対象のチームを更新できませんでした。画面を再読み込みしてからもう一度お試しください。')
}
