import type { RoomViewSessionRow } from '@w-baseball/shared'
import { isSupabaseConfigured, supabase } from './supabase'

const storageKey = 'w-baseball:room-view-session:v1'

export type RoomViewSession = {
  roomId: string
  roomName: string
  expiresAt: string
}

export class RoomViewSessionError extends Error {
  readonly code: 'invalid' | 'expired' | 'unavailable'

  constructor(code: 'invalid' | 'expired' | 'unavailable') {
    super(code)
    this.code = code
  }
}

function readSession(): RoomViewSession | null {
  try {
    const stored = window.sessionStorage.getItem(storageKey)
    if (!stored) return null

    const value = JSON.parse(stored) as RoomViewSession
    if (!value.roomId || !value.roomName || !value.expiresAt || Date.parse(value.expiresAt) <= Date.now()) {
      window.sessionStorage.removeItem(storageKey)
      return null
    }
    return value
  } catch {
    return null
  }
}

function storeSession(row: RoomViewSessionRow): RoomViewSession {
  const session: RoomViewSession = {
    roomId: row.room_id,
    roomName: row.room_name,
    expiresAt: row.expires_at,
  }
  window.sessionStorage.setItem(storageKey, JSON.stringify(session))
  return session
}

/** パスワードを保存せず、現在のブラウザタブ内の閲覧権限だけを返す。 */
export function getRoomViewSession(): RoomViewSession | null {
  return readSession()
}

export function isRoomViewSessionExpired(): boolean {
  try {
    const stored = window.sessionStorage.getItem(storageKey)
    if (!stored) return false
    const value = JSON.parse(stored) as Partial<RoomViewSession>
    return !value.expiresAt || Date.parse(value.expiresAt) <= Date.now()
  } catch {
    return true
  }
}

async function ensureViewerIdentity(): Promise<void> {
  if (!supabase || !isSupabaseConfigured) throw new RoomViewSessionError('unavailable')

  const { data: current } = await supabase.auth.getSession()
  if (current.session) return

  const { error } = await supabase.auth.signInAnonymously()
  if (error) throw new RoomViewSessionError('unavailable')
}

/**
 * ルーム番号とパスワードを限定RPCへ一度だけ送る。
 * 成否の詳細は返さないため、番号・パスワードのどちらが違うかは判別できない。
 */
export async function startRoomViewSession(
  roomNumber: string,
  password: string,
): Promise<RoomViewSession> {
  if (!/^[0-9]{8}$/.test(roomNumber) || !password) {
    throw new RoomViewSessionError('invalid')
  }

  await ensureViewerIdentity()
  const { data, error } = await supabase!.rpc('start_room_view_session', {
    requested_room_number: roomNumber,
    requested_password: password,
  })

  if (error || !Array.isArray(data) || !data[0]) {
    throw new RoomViewSessionError('invalid')
  }

  return storeSession(data[0] as RoomViewSessionRow)
}

/** 閲覧終了時はサーバー側の権限と、このタブ内の表示情報を両方消す。 */
export async function endRoomViewSession(): Promise<void> {
  const current = readSession()
  window.sessionStorage.removeItem(storageKey)
  if (!current || !supabase) return

  await supabase.rpc('end_room_view_session', { target_room_id: current.roomId })
}

export function roomViewSessionErrorMessage(error: unknown): string {
  if (error instanceof RoomViewSessionError) {
    if (error.code === 'expired') return '閲覧期限が切れました。ルーム番号とパスワードをもう一度入力してください。'
    if (error.code === 'unavailable') return '閲覧機能を開始できません。Supabaseの設定を確認してください。'
  }
  return 'ルーム番号またはパスワードが違います。もう一度入力してください。'
}
