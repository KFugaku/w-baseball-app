import { createClient, type User } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/**
 * ブラウザに置けるのは Publishable key だけ。service_role は絶対に使わない。
 * 未設定でも閲覧用の画面自体は動かせるよう、クライアントは null を許容する。
 */
export const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

export const isSupabaseConfigured = supabase !== null

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase接続が未設定です。.env.local を設定して開発サーバーを再起動してください。')
  }
  return supabase
}

export async function getCurrentUser(): Promise<User | null> {
  if (!supabase) return null

  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user
}

export async function getAccessToken(): Promise<{ accessToken: string; userId: string } | null> {
  if (!supabase) return null

  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) return null
  return { accessToken: data.session.access_token, userId: data.session.user.id }
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password })
  if (error) throw error
  if (!data.user) throw new Error('ログイン情報を取得できませんでした。')
  return data.user
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export function subscribeToAuthState(onChange: (user: User | null) => void): () => void {
  if (!supabase) return () => undefined

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onChange(session?.user ?? null)
  })
  return () => data.subscription.unsubscribe()
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/invalid login credentials/i.test(error.message)) return 'メールアドレスまたはパスワードが違います。'
    if (/email not confirmed/i.test(error.message)) return '確認メールのリンクを開いてからログインしてください。'
    return error.message
  }
  return 'ログインに失敗しました。時間をおいて再試行してください。'
}
