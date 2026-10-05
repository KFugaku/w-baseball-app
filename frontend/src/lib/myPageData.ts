import type { RoomRow } from '@w-baseball/shared'
import { loadViewerGames, type ViewerGame } from './roomViewData'
import { getCurrentUser, isSupabaseConfigured, supabase } from './supabase'

export type OwnedRoom = {
  id: string
  name: string
  roomNumber: string
  games: ViewerGame[]
}

/** RLSを通過する、現在ログインしている利用者自身のルームだけを取得する。 */
export async function loadOwnedRooms(): Promise<OwnedRoom[]> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase接続が未設定です。')

  const user = await getCurrentUser()
  if (!user || user.app_metadata?.provider === 'anonymous') {
    throw new Error('ログイン情報を確認できませんでした。')
  }

  const { data, error } = await supabase
    .from('rooms')
    .select('id, owner_id, name, room_number, created_at, updated_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
  if (error) throw error

  return Promise.all(((data ?? []) as RoomRow[]).map(async (room) => ({
    id: room.id,
    name: room.name,
    roomNumber: room.room_number,
    games: await loadViewerGames(room.id),
  })))
}
