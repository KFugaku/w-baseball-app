import { createClient, type User } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const authCallbackParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))

// 招待リンクを開いた直後だけ、パスワード設定画面を自動表示するために保持する。
// Supabase client がURLハッシュを消す前に読み取る必要がある。
export const isInviteCallback = authCallbackParams.get('type') === 'invite'

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

/**
 * 匿名閲覧のために作成した Auth ユーザーは、メールで登録した管理者とは区別する。
 * Supabase の公式な識別子 is_anonymous を優先し、以前のセッションとの互換用に
 * provider も確認する。
 */
export function isAnonymousUser(user: User | null | undefined): boolean {
  return user?.is_anonymous === true || user?.app_metadata?.provider === 'anonymous'
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

export type SignUpResult = {
  user: User | null
  confirmationRequired: boolean
}

/** メール確認を有効にしている場合でも、確認後にこのアプリへ戻れるURLを渡す。 */
export async function signUpWithEmail(email: string, password: string): Promise<SignUpResult> {
  const { data, error } = await requireSupabase().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) throw error

  return { user: data.user, confirmationRequired: !data.session }
}

export async function resendSignUpConfirmation(email: string): Promise<void> {
  const { error } = await requireSupabase().auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) throw error
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await requireSupabase().auth.updateUser({ password })
  if (error) throw error
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
    if (/user already registered/i.test(error.message)) return 'このメールアドレスはすでに登録されています。ログインしてください。'
    if (/password.*should be at least/i.test(error.message)) return 'パスワードは8文字以上で入力してください。'
    if (/email rate limit exceeded|too many requests/i.test(error.message)) return 'メールの送信回数が上限に達しました。しばらく待ってから再試行してください。'
    if (/not configured/i.test(error.message)) return error.message
  }
  return '認証に失敗しました。入力内容を確認して、時間をおいて再試行してください。'
}
