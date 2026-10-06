export type SharedGameRoute = {
  roomId: string
  gameId: string
  playerId?: string
}

const roomParam = 'room'
const gameParam = 'game'
const playerParam = 'player'

export function readSharedGameRoute(url = window.location.href): SharedGameRoute | null {
  const parsed = new URL(url)
  const roomId = parsed.searchParams.get(roomParam)
  const gameId = parsed.searchParams.get(gameParam)
  const playerId = parsed.searchParams.get(playerParam)
  return roomId && gameId ? { roomId, gameId, ...(playerId ? { playerId } : {}) } : null
}

export function setSharedGameRoute(route: SharedGameRoute): void {
  const url = new URL(window.location.href)
  url.searchParams.set(roomParam, route.roomId)
  url.searchParams.set(gameParam, route.gameId)
  if (route.playerId) url.searchParams.set(playerParam, route.playerId)
  else url.searchParams.delete(playerParam)
  window.history.pushState({}, '', url)
}

export function clearSharedGameRoute(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(roomParam)
  url.searchParams.delete(gameParam)
  url.searchParams.delete(playerParam)
  window.history.pushState({}, '', url)
}
