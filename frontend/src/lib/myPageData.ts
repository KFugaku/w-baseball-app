import type { PlayerRow, RoomRow, TeamRow } from '@w-baseball/shared'
import { loadViewerGames, type ViewerGame } from './roomViewData'
import { getCurrentUser, isSupabaseConfigured, supabase } from './supabase'

export type OwnedRoom = {
  id: string
  name: string
  roomNumber: string
  teams: { id: string; name: string; members: string[] }[]
  games: ViewerGame[]
}

export function roomCreationErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/create_owned_room|schema cache|could not find the function/i.test(error.message)) {
      return 'ルーム作成機能の準備を反映中です。画面を再読み込みして、もう一度試してください。'
    }
    if (/gen_random_bytes|gen_salt|crypt\(/i.test(error.message)) {
      return 'ルーム作成用のデータベース設定を更新する必要があります。最新のSQLマイグレーションを実行してください。'
    }
    if (/ログインが必要|ルーム名は|ルームパスワードは/i.test(error.message)) return error.message
  }
  return 'ルームを作成できませんでした。ログイン状態とSupabaseの設定を確認してください。'
}

export function roomManagementErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/ログインが必要|ルーム名は|権限がありません/.test(error.message)) {
      return error.message
    }
    if (/rename_owned_room|delete_owned_room|schema cache|could not find the function/i.test(error.message)) {
      return 'ルーム管理用SQLが未反映です。202610090001_room_management.sql をSupabase SQL Editorで実行し、画面を再読み込みしてください。'
    }
  }
  return 'ルームを更新できませんでした。ログイン状態とSupabaseの設定を確認してください。'
}

export async function createOwnedRoom(name: string, password: string): Promise<OwnedRoom> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase接続が未設定です。')

  const { data, error } = await supabase.rpc('create_owned_room', {
    target_name: name.trim(),
    target_password: password,
  })
  if (error) throw error

  const created = Array.isArray(data) ? data[0] : data
  if (!created?.id || !created.name || !created.room_number) {
    throw new Error('ルームの作成結果を確認できませんでした。')
  }

  return {
    id: created.id,
    name: created.name,
    roomNumber: created.room_number,
    teams: [],
    games: [],
  }
}

/** 所有者確認はサーバー側RPCでも行う。ルーム番号・パスワードは変更しない。 */
export async function renameOwnedRoom(roomId: string, name: string): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase接続が未設定です。')

  const { data, error } = await supabase.rpc('rename_owned_room', {
    target_room_id: roomId,
    target_name: name.trim(),
  })
  if (error) throw error

  const renamed = Array.isArray(data) ? data[0] : data
  if (!renamed?.name) throw new Error('ルーム名の更新結果を確認できませんでした。')
  return renamed.name
}

/**
 * 関連する試合・チーム・選手・イベントを含めて、所有者のルームだけを削除する。
 * 閲覧セッションとパスワードハッシュは外部キーの CASCADE で同時に無効化される。
 */
export async function deleteOwnedRoom(roomId: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase接続が未設定です。')

  const { error } = await supabase.rpc('delete_owned_room', {
    target_room_id: roomId,
  })
  if (error) throw error
}

/** RLSを通過する、現在ログインしている利用者自身のルームだけを取得する。 */
export async function loadOwnedRooms(): Promise<OwnedRoom[]> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase接続が未設定です。')
  const client = supabase

  const user = await getCurrentUser()
  if (!user || user.app_metadata?.provider === 'anonymous') {
    throw new Error('ログイン情報を確認できませんでした。')
  }

  const { data, error } = await client
    .from('rooms')
    .select('id, owner_id, name, room_number, created_at, updated_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
  if (error) throw error

  return Promise.all(((data ?? []) as RoomRow[]).map(async (room) => {
    const { data: teamRows, error: teamsError } = await client
      .from('teams')
      .select('id, room_id, name, color, created_at, updated_at')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
    if (teamsError) throw teamsError

    const teams = (teamRows ?? []) as TeamRow[]
    const teamIds = teams.map((team) => team.id)
    let players: Pick<PlayerRow, 'team_id' | 'last_name' | 'first_name'>[] = []
    if (teamIds.length) {
      const { data: playerRows, error: playersError } = await client
        .from('players')
        .select('team_id, last_name, first_name')
        .in('team_id', teamIds)
        .order('created_at', { ascending: true })
      if (playersError) throw playersError
      players = (playerRows ?? []) as Pick<PlayerRow, 'team_id' | 'last_name' | 'first_name'>[]
    }

    return {
      id: room.id,
      name: room.name,
      roomNumber: room.room_number,
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        members: players
          .filter((player) => player.team_id === team.id)
          .map((player) => `${player.last_name} ${player.first_name}`.trim()),
      })),
      games: await loadViewerGames(room.id),
    }
  }))
}
