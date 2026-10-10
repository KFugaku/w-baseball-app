import { isSupabaseConfigured, supabase } from './supabase'
import { RoomViewSessionError, startRoomViewSessionFromInvitation } from './roomViewSession'

const invitationParam = 'invite'

export function readRoomInvitationToken(url = window.location.href): string | null {
  const token = new URL(url).searchParams.get(invitationParam)
  return token && /^[0-9a-f]{64}$/.test(token) ? token : null
}

/** 招待トークンを履歴に残さず、既存の共有試合URLなど他の検索条件は維持する。 */
export function clearRoomInvitationToken(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(invitationParam)
  window.history.replaceState({}, '', url)
}

export function createRoomInvitationUrl(token: string): string {
  const url = new URL(window.location.origin)
  url.searchParams.set(invitationParam, token)
  return url.toString()
}

/** 所有者だけが呼べるRPC。発行のたびに以前の招待リンクを無効化する。 */
export async function createRoomInvitationLink(roomId: string): Promise<string> {
  if (!isSupabaseConfigured || !supabase) throw new RoomViewSessionError('unavailable')

  const { data, error } = await supabase.rpc('create_room_invitation_link', {
    target_room_id: roomId,
  })
  if (error) throw error

  const result = Array.isArray(data) ? data[0] : data
  if (!result?.invitation_token || !/^[0-9a-f]{64}$/.test(result.invitation_token)) {
    throw new Error('招待リンクを発行できませんでした。')
  }
  return result.invitation_token
}

export async function copyRoomInvitationLink(
  roomId: string,
): Promise<'copied' | 'manual-copy'> {
  const token = await createRoomInvitationLink(roomId)
  const url = createRoomInvitationUrl(token)

  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable')
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    // 非HTTPS環境やブラウザ権限でClipboard APIが使えない場合も、発行したURLを失わせない。
    window.prompt('招待リンクをコピーしてください。以前の招待リンクは無効になりました。', url)
    return 'manual-copy'
  }
}

export function roomInvitationErrorMessage(error: unknown): string {
  if (error instanceof RoomViewSessionError && error.code === 'unavailable') {
    return '招待リンクを発行できませんでした。Supabaseの設定を確認してください。'
  }
  if (error instanceof Error) {
    if (/ログインが必要|招待リンクを発行する権限/.test(error.message)) return error.message
    if (/create_room_invitation_link|schema cache|could not find the function/i.test(error.message)) {
      return '招待リンク用SQLが未反映です。最新のSQLマイグレーションをSupabase SQL Editorで実行してください。'
    }
  }
  return '招待リンクを発行できませんでした。時間をおいてもう一度試してください。'
}

export { startRoomViewSessionFromInvitation }
