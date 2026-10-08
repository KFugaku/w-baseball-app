import { isSupabaseConfigured, supabase } from './supabase'

export type RoomMember = {
  id: string
  roomId: string
  last: string
  first: string
}

type RoomMemberRow = {
  id: string
  room_id: string
  last_name: string
  first_name: string
}

function client() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase接続が未設定です。')
  }
  return supabase
}

function toMember(row: RoomMemberRow): RoomMember {
  return {
    id: row.id,
    roomId: row.room_id,
    last: row.last_name,
    first: row.first_name,
  }
}

export function roomMemberErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : ''
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : ''
  if (/room_members|schema cache|relation .* does not exist/i.test(message)) {
    return 'ルームメンバー用SQLが未反映です。202610090002_room_members.sql をSupabase SQL Editorで実行し、画面を再読み込みしてください。'
  }
  if (code === '23505' || /duplicate key|unique/i.test(message)) {
    return 'このメンバーは既に追加されています。'
  }
  return 'メンバーを更新できませんでした。ログイン状態とSupabaseの設定を確認してください。'
}

export async function loadRoomMembers(roomId: string): Promise<RoomMember[]> {
  const { data, error } = await client()
    .from('room_members')
    .select('id, room_id, last_name, first_name')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as RoomMemberRow[]).map(toMember)
}

export async function loadOtherRoomMemberNames(roomId: string): Promise<string[]> {
  const { data, error } = await client()
    .from('room_members')
    .select('room_id, last_name, first_name')
    .neq('room_id', roomId)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
  if (error) throw error

  return Array.from(
    new Set(
      ((data ?? []) as Pick<RoomMemberRow, 'last_name' | 'first_name'>[]).map(
        (member) => `${member.last_name} ${member.first_name}`.trim(),
      ),
    ),
  )
}

export async function addRoomMember(
  roomId: string,
  last: string,
  first: string,
): Promise<RoomMember> {
  const { data, error } = await client()
    .from('room_members')
    .insert({ room_id: roomId, last_name: last, first_name: first })
    .select('id, room_id, last_name, first_name')
    .single()
  if (error) throw error
  return toMember(data as RoomMemberRow)
}

export async function updateRoomMember(
  memberId: string,
  last: string,
  first: string,
): Promise<RoomMember> {
  const { data, error } = await client()
    .from('room_members')
    .update({ last_name: last, first_name: first })
    .eq('id', memberId)
    .select('id, room_id, last_name, first_name')
    .single()
  if (error) throw error
  return toMember(data as RoomMemberRow)
}

export async function removeRoomMember(memberId: string): Promise<void> {
  const { error } = await client().from('room_members').delete().eq('id', memberId)
  if (error) throw error
}
