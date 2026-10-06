export type SharedGameRoute = {
  roomId: string
  gameId: string
}

const roomParam = 'room'
const gameParam = 'game'

export function readSharedGameRoute(url = window.location.href): SharedGameRoute | null {
  const parsed = new URL(url)
  const roomId = parsed.searchParams.get(roomParam)
  const gameId = parsed.searchParams.get(gameParam)
  return roomId && gameId ? { roomId, gameId } : null
}

export function setSharedGameRoute(route: SharedGameRoute): void {
  const url = new URL(window.location.href)
  url.searchParams.set(roomParam, route.roomId)
  url.searchParams.set(gameParam, route.gameId)
  window.history.pushState({}, '', url)
}

export function clearSharedGameRoute(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(roomParam)
  url.searchParams.delete(gameParam)
  window.history.pushState({}, '', url)
}
