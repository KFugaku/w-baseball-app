import type { RoomViewSessionRow } from '@w-baseball/shared'
import { isSupabaseConfigured, supabase } from './supabase'

const storageKey = 'w-baseball:room-view-session:v1'

export type RoomViewSession = {
  roomId: string
  roomName: string
  roomNumber?: string
  expiresAt: string
  handoffToken?: string
}

type RoomViewSessionWithHandoff = RoomViewSessionRow & {
  handoff_token?: string
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

function storeSession(row: RoomViewSessionWithHandoff, roomNumber?: string): RoomViewSession {
  const session: RoomViewSession = {
    roomId: row.room_id,
    roomName: row.room_name,
    roomNumber,
    expiresAt: row.expires_at,
    handoffToken: row.handoff_token,
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
  const { data, error } = await supabase!.rpc('start_room_view_session_with_handoff', {
    requested_room_number: roomNumber,
    requested_password: password,
  })

  if (error) {
    // 認証失敗だけは意図的に詳細を伏せ、設定・通信エラーは利用者が直せる形で伝える。
    if (/閲覧認証に失敗しました|閲覧権限を引き継げませんでした/i.test(error.message)) {
      throw new RoomViewSessionError('invalid')
    }
    throw error
  }

  if (!Array.isArray(data) || !data[0]) {
    throw new RoomViewSessionError('invalid')
  }

  return storeSession(data[0] as RoomViewSessionWithHandoff, roomNumber)
}

/**
 * メールログインなどで Auth の利用者IDが切り替わったあと、同じタブの閲覧権限を復元する。
 * トークンはパスワードではなく、認証時にサーバーが発行した短命のランダム値である。
 */
export async function claimRoomViewSession(): Promise<RoomViewSession | null> {
  const current = readSession()
  if (!current?.handoffToken || !supabase) return null

  const { data, error } = await supabase.rpc('claim_room_view_session', {
    target_room_id: current.roomId,
    provided_handoff_token: current.handoffToken,
  })
  if (error || !Array.isArray(data) || !data[0]) throw new RoomViewSessionError('expired')

  return storeSession(
    { ...(data[0] as RoomViewSessionRow), handoff_token: current.handoffToken },
    current.roomNumber,
  )
}

/** ログアウト後は匿名Authを発行してから、同じタブの閲覧へ戻す。 */
export async function restoreRoomViewSessionAfterLogout(): Promise<RoomViewSession | null> {
  await ensureViewerIdentity()
  return claimRoomViewSession()
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
  if (error instanceof Error) {
    if (/start_room_view_session_with_handoff|schema cache|could not find the function/i.test(error.message)) {
      return '閲覧認証機能の準備を反映中です。最新のSQLを実行してから、画面を再読み込みしてください。'
    }
    if (/permission denied/i.test(error.message)) {
      return '閲覧認証の権限設定を確認してください。最新のSQLを実行すると修復できます。'
    }
    if (/gen_random_bytes|gen_salt|crypt\(/i.test(error.message)) {
      return '閲覧認証用のデータベース設定を更新する必要があります。最新のSQLを実行してください。'
    }
  }
  return 'ルーム番号またはパスワードが違います。もう一度入力してください。'
}
