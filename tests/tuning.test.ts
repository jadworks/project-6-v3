import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CONFIG, DEFAULT_CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'
import { VicePlayer } from '../src/game/vicePlayer'

const defaults = Object.fromEntries(tuning.controls.map(control => [control.id, control.default]))
afterEach(() => { tuning.apply(defaults); tuning.activate('jump'); tuning.activate('run') })

describe('city game tuning', () => {
  it('validates a complete patch and keeps source defaults immutable', () => {
    const before = tuning.read()
    expect(() => tuning.apply({ 'player.walkSpeed': 8, 'camera.fov': 999 })).toThrow()
    expect(tuning.read()).toEqual(before)
    tuning.apply({ 'player.walkSpeed': 10 })
    expect(CONFIG.player.walkSpeed).toBe(10)
    expect(DEFAULT_CONFIG.player.walkSpeed).toBe(7)
  })
  it('changes actual player speed and applies jump tuning on the next jump', () => {
    const player = new VicePlayer(new THREE.Vector3())
    player.update(1 / 60, 0, 1, 0, false, false, false, false)
    const before = player.velocity.length()
    tuning.apply({ 'player.walkSpeed': 10, 'player.jumpSpeed': 14 })
    expect(tuning.read().active['player.jumpSpeed']).toBe(DEFAULT_CONFIG.player.jumpSpeed)
    const faster = new VicePlayer(new THREE.Vector3())
    faster.update(1 / 60, 0, 1, 0, false, false, true, false)
    expect(faster.velocity.length()).toBeGreaterThan(before)
    expect(tuning.read().active['player.jumpSpeed']).toBe(14)
  })
  it('latches an unranked run when gameplay tuning is changed', () => {
    tuning.activate('run')
    tuning.apply({ 'camera.fov': 90 })
    expect(tuning.unranked).toBe(false)
    tuning.apply({ 'player.walkSpeed': 8 })
    expect(tuning.unranked).toBe(true)
    tuning.apply(defaults)
    expect(tuning.unranked).toBe(true)
    tuning.activate('run')
    expect(tuning.unranked).toBe(false)
  })
})
