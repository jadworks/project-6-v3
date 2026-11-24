import * as THREE from 'three'

type Prop = { root: THREE.Group; health: number; broken: boolean; radius: number; kind: 'crate' | 'hydrant' | 'barrier' }
type Fragment = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }

export class WorldProps {
  private readonly props: Prop[] = []
  private readonly fragments: Fragment[] = []
  constructor(private readonly scene: THREE.Scene) {
    const placements: Array<[number, number, Prop['kind']]> = [[-12, 8, 'hydrant'], [13, -13, 'hydrant'], [-16, -36, 'crate'], [-18, -39, 'crate'], [11, 58, 'barrier'], [-10, 62, 'barrier'], [-40, 130, 'crate'], [-43, 133, 'crate'], [-105, 40, 'barrier']]
    for (const [x, z, kind] of placements) {
      const root = new THREE.Group()
      root.userData.noVehicleCollision = true
      const color = kind === 'hydrant' ? 0xe54e56 : kind === 'crate' ? 0xb88d57 : 0xf5e6bf
      const geom = kind === 'hydrant' ? new THREE.CylinderGeometry(.35, .43, 1.15, 8) : new THREE.BoxGeometry(kind === 'barrier' ? 2.5 : 1.2, kind === 'barrier' ? .85 : 1.2, .8)
      const object = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color, roughness: .85 }))
      object.position.y = kind === 'barrier' ? .45 : .6; object.castShadow = true; root.add(object)
      if (kind === 'barrier') {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.54, .18, .82), new THREE.MeshBasicMaterial({ color: 0xff794f }))
        stripe.position.y = .48; root.add(stripe)
      }
      root.position.set(x, 0, z); this.scene.add(root)
      this.props.push({ root, health: 35, broken: false, radius: kind === 'barrier' ? 1.4 : .8, kind })
    }
  }
  shoot(origin: THREE.Vector3, direction: THREE.Vector3, range = 60): boolean {
    let closest: Prop | undefined, distance = range
    for (const prop of this.props) {
      if (prop.broken) continue
      const delta = prop.root.position.clone().add(new THREE.Vector3(0, .6, 0)).sub(origin)
      const along = delta.dot(direction)
      if (along <= 0 || along >= distance) continue
      const off = delta.addScaledVector(direction, -along).length()
      if (off < prop.radius + .5) { closest = prop; distance = along }
    }
    if (!closest) return false
    this.hurt(closest, 20, direction); return true
  }
  impact(position: THREE.Vector3, speed: number): boolean {
    if (Math.abs(speed) < 4) return false
    let hit = false
    for (const prop of this.props) {
      if (!prop.broken && Math.hypot(position.x - prop.root.position.x, position.z - prop.root.position.z) < prop.radius + 1.4) {
        this.hurt(prop, Math.abs(speed) * 4, new THREE.Vector3(position.x - prop.root.position.x, 0, position.z - prop.root.position.z).normalize().negate()); hit = true
      }
    }
    return hit
  }
  private hurt(prop: Prop, amount: number, direction: THREE.Vector3): void {
    prop.health -= amount
    if (prop.health > 0) { prop.root.rotation.z = .2; return }
    prop.broken = true; prop.root.visible = false
    const count = prop.kind === 'hydrant' ? 10 : 7
    for (let i = 0; i < count; i++) {
      const color = prop.kind === 'hydrant' ? 0xa3e7f3 : prop.kind === 'barrier' ? 0xf6b77e : 0xc49861
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(.18, .18, .18), new THREE.MeshBasicMaterial({ color }))
      mesh.position.copy(prop.root.position).add(new THREE.Vector3(0, .7, 0)); this.scene.add(mesh)
      this.fragments.push({ mesh, velocity: new THREE.Vector3(direction.x * 2 + (Math.random() - .5) * 4, 2 + Math.random() * 5, direction.z * 2 + (Math.random() - .5) * 4), life: 1.2 + Math.random() })
    }
  }
  update(dt: number): void {
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i]; f.life -= dt; f.velocity.y -= 9 * dt; f.mesh.position.addScaledVector(f.velocity, dt); f.mesh.rotation.x += dt * 7
      if (f.life <= 0 || f.mesh.position.y < 0) { this.scene.remove(f.mesh); f.mesh.geometry.dispose(); (f.mesh.material as THREE.Material).dispose(); this.fragments.splice(i, 1) }
    }
  }
}
