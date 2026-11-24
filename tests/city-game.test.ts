import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { MissionDirector } from '../src/game/missionLogic'
import { loadCitySave, saveCityProgress } from '../src/game/saveSystem'
import { worldRayDistance } from '../src/game/worldCollision'

afterEach(() => vi.unstubAllGlobals())
describe('Vice Bay contracts', () => {
  it('completes the introduction only after both checkpoints and grants the configured reward', () => {
    const director = new MissionDirector(new THREE.Scene())
    expect(director.start('intro')).toBe('WELCOME TO VICE BAY')
    expect(director.update(2, new THREE.Vector3(0, 0, -65), false, 0)).toBeNull()
    const result = director.update(3, new THREE.Vector3(-55, 0, -125), false, 0)
    expect(result).toMatchObject({ id: 'intro', reward: 2500, seconds: 5 })
    expect(director.current).toBeNull()
  })
  it('requires an actual vehicle and speed for the stunt', () => {
    const director = new MissionDirector(new THREE.Scene())
    director.start('stunt')
    const point = new THREE.Vector3(28, 0, 100)
    expect(director.update(1, point, false, 20)).toBeNull()
    expect(director.update(1, point, true, 2)).toBeNull()
    expect(director.update(1, point, true, 12)).toBeNull()
    expect(director.update(1, point, true, 12, true)?.reward).toBe(1500)
  })
  it('persists progress and safely rejects corrupt saves', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
    const save = loadCitySave(); save.money = 4800; save.completed.push('race'); save.upgrade = 2; saveCityProgress(save)
    expect(loadCitySave()).toMatchObject({ money: 4800, completed: ['race'], upgrade: 2 })
    store.set('vicebay-nights.progress.v1', '{broken')
    expect(loadCitySave().money).toBe(1500)
  })
  it('stops shots at solid world geometry', () => {
    const colliders = [{ center: new THREE.Vector3(0, 2, -10), halfExtents: new THREE.Vector3(3, 2, 2), rotationY: 0, kind: 'building' as const }]
    const start = new THREE.Vector3(0, 1, 0)
    expect(worldRayDistance(start, new THREE.Vector3(0, 0, -1), colliders, 60)).toBeCloseTo(8)
    expect(worldRayDistance(start, new THREE.Vector3(1, 0, 0), colliders, 60)).toBe(60)
  })
})
