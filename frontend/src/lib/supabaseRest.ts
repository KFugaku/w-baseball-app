import type { AppSnapshotRow } from '@w-baseball/shared'
import { getAccessToken, isSupabaseConfigured } from './supabase'

type SupabaseError = {
  message?: string
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured')
  }

  const auth = await getAccessToken()
  if (!auth) {
    throw new Error('クラウド保存には管理者ログインが必要です。')
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabasePublishableKey,
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as SupabaseError
    throw new Error(error.message ?? `Supabase request failed (${response.status})`)
  }

  return response.status === 204 ? (undefined as T) : (await response.json()) as T
}

export async function loadRemoteSnapshot<T>(): Promise<T | null> {
  if (!isSupabaseConfigured) return null

  const auth = await getAccessToken()
  if (!auth) return null
  const snapshotScope = `user:${auth.userId}`

  const rows = await request<Array<AppSnapshotRow<T>>>(
    `app_snapshots?scope=eq.${snapshotScope}&select=scope,payload,updated_at&limit=1`,
  )
  return rows[0]?.payload ?? null
}

export async function saveRemoteSnapshot<T>(payload: T): Promise<void> {
  if (!isSupabaseConfigured) return

  const auth = await getAccessToken()
  if (!auth) return
  const snapshotScope = `user:${auth.userId}`

  await request('app_snapshots?on_conflict=scope', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ scope: snapshotScope, payload }),
  })
}
