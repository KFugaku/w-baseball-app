import { loadRemoteSnapshot, saveRemoteSnapshot } from './supabaseRest'

const storageKey = 'w-baseball:app-snapshot:v1'

export function loadLocalSnapshot<T>(): T | null {
  try {
    const value = window.localStorage.getItem(storageKey)
    return value ? JSON.parse(value) as T : null
  } catch {
    return null
  }
}

export function saveLocalSnapshot<T>(snapshot: T): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot))
  } catch {
    // プライベートブラウジング等で保存できない場合も、画面操作は継続する。
  }
}

export async function loadSnapshot<T>(): Promise<T | null> {
  const local = loadLocalSnapshot<T>()
  try {
    return (await loadRemoteSnapshot<T>()) ?? local
  } catch (error) {
    console.warn('Supabaseからの復元に失敗したため、ローカル保存を使用します。', error)
    return local
  }
}

export async function saveSnapshot<T>(snapshot: T): Promise<void> {
  saveLocalSnapshot(snapshot)
  try {
    await saveRemoteSnapshot(snapshot)
  } catch (error) {
    console.warn('Supabaseへの保存に失敗しました。ローカルには保存済みです。', error)
  }
}
