export type CitySave = {
  version: 1
  money: number
  health: number
  completed: string[]
  upgrade: number
  muted: boolean
  weather: 'day' | 'sunset' | 'rain' | 'night'
  robbedStores: string[]
}

const KEY = 'vicebay-nights.progress.v1'
const defaults = (): CitySave => ({ version: 1, money: 1500, health: 100, completed: [], upgrade: 0, muted: false, weather: 'sunset', robbedStores: [] })

export function loadCitySave(): CitySave {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    const value = JSON.parse(raw) as Partial<CitySave>
    if (value.version !== 1) return defaults()
    return {
      version: 1,
      money: Number.isFinite(value.money) ? Math.max(0, Math.floor(value.money!)) : 1500,
      health: Number.isFinite(value.health) ? Math.min(100, Math.max(0, value.health!)) : 100,
      completed: Array.isArray(value.completed) ? value.completed.filter((v): v is string => typeof v === 'string').slice(0, 100) : [],
      upgrade: Number.isFinite(value.upgrade) ? Math.min(3, Math.max(0, Math.floor(value.upgrade!))) : 0,
      muted: value.muted === true,
      weather: value.weather === 'day' || value.weather === 'sunset' || value.weather === 'rain' || value.weather === 'night' ? value.weather : 'sunset',
      robbedStores: Array.isArray(value.robbedStores) ? value.robbedStores.filter((v): v is string => typeof v === 'string').slice(0, 5) : [],
    }
  } catch { return defaults() }
}

export function saveCityProgress(save: CitySave): void {
  try { localStorage.setItem(KEY, JSON.stringify(save)) } catch { /* Play remains available when storage is unavailable. */ }
}
