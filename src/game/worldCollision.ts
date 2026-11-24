import * as THREE from 'three'
import type { WorldCollider } from './viceWorld'

/** Resolve the player against the world's simple collision footprints. */
export function resolvePlayerCollision(position: THREE.Vector3, previous: THREE.Vector3, colliders: WorldCollider[]): boolean {
  let hit = false
  for (const collider of colliders) {
    if (position.y > collider.center.y + collider.halfExtents.y) continue
    const dx = position.x - collider.center.x, dz = position.z - collider.center.z
    const limit = Math.max(collider.halfExtents.x, collider.halfExtents.z) + 1
    if (Math.abs(dx) > limit || Math.abs(dz) > limit) continue
    const c = Math.cos(collider.rotationY), s = Math.sin(collider.rotationY)
    const lx = dx * c - dz * s, lz = dx * s + dz * c
    if (Math.abs(lx) < collider.halfExtents.x + .42 && Math.abs(lz) < collider.halfExtents.z + .42) {
      position.x = previous.x; position.z = previous.z; hit = true
    }
  }
  return hit
}

/** Distance to the first solid world footprint along a shot ray. */
export function worldRayDistance(origin: THREE.Vector3, direction: THREE.Vector3, colliders: WorldCollider[], range: number): number {
  let nearest = range
  const ray = new THREE.Ray()
  const box = new THREE.Box3()
  const hit = new THREE.Vector3()
  for (const collider of colliders) {
    const dx = origin.x - collider.center.x, dz = origin.z - collider.center.z
    const c = Math.cos(collider.rotationY), s = Math.sin(collider.rotationY)
    ray.origin.set(dx * c - dz * s, origin.y - collider.center.y, dx * s + dz * c)
    ray.direction.set(direction.x * c - direction.z * s, direction.y, direction.x * s + direction.z * c)
    box.min.copy(collider.halfExtents).negate(); box.max.copy(collider.halfExtents)
    if (box.containsPoint(ray.origin)) return 0
    if (ray.intersectBox(box, hit)) nearest = Math.min(nearest, hit.distanceTo(ray.origin))
  }
  return nearest
}
