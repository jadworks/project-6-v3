import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Lightweight city-life simulation for a flat, y=0 city. Integration:
 *   const life = new CityLife(scene)
 *   life.update(fixedDt, playerWorldPosition, wantedLevel) // wanted is 0..5
 *   life.startle(noisePosition)                           // gunshots, crashes, etc.
 *   const hitPerson = life.shoot(muzzle, aimDirection, range)
 *   const peopleHit = life.impact(crashPosition, radius, force)
 *   health -= life.getDamage(playerWorldPosition, fixedDt, wantedLevel)
 * Call update and getDamage once per simulation step; each clamps dt to 0.1 seconds.
 * getDamage returns health points (tuned for roughly 100 maximum HP), not a boolean.
 * shoot also startles bystanders.
 * Impact counts people, not vehicles; vehicles in the blast still brake and smoke.
 *
 * This is deliberately a bounded, visual/kinematic system: it creates no Rapier
 * bodies, performs no building/terrain/line-of-sight tests, and does not itself
 * change wanted level, HP, ammunition, player velocity, or play audio. The host must
 * call impact for player/vehicle collisions and feed hit results into its own rules.
 * Streets are assumed to run along Z around x=0 and x=-70, with a cross street
 * at z=24; the player spawns nearby at z=16. Pavement is approximately y=0.
 * The caller owns pausing by not advancing the simulation.
 */

type Pedestrian = {
  root: THREE.Group
  model: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
  police: boolean
  active: boolean
  side: number
  streetX: number
  direction: number
  speed: number
  phase: number
  flee: number
  danger: THREE.Vector3
  impulse: THREE.Vector3
  stagger: number
  down: number
  hitLock: number
  fire: number
}

type Vehicle = {
  root: THREE.Group
  body: THREE.Group
  wheels: THREE.Mesh[]
  red?: THREE.Mesh
  blue?: THREE.Mesh
  axis: 'x' | 'z'
  direction: number
  lane: number
  cruise: number
  speed: number
  patrol: boolean
  crash: number
  smoke: number
  fire: number
}

type Bird = { root: THREE.Group; left: THREE.Group; right: THREE.Group; phase: number; scared: number }
type Particle = { position: THREE.Vector3; velocity: THREE.Vector3; life: number; total: number; size: number; smoke: boolean }
type Trace = { mesh: THREE.Mesh; life: number }
type Part = [shape: 'box' | 'ball', color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number]

const UP = new THREE.Vector3(0, 1, 0)
const MAX_PEDESTRIANS = 36
const MAX_OFFICERS = 4
const PARTICLE_COUNT = 48
const TRACE_COUNT = 10
const TAU = Math.PI * 2

function safeStep(dt: number): number {
  return Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0
}

function levelOf(wanted: number): number {
  return Number.isFinite(wanted) ? Math.floor(THREE.MathUtils.clamp(wanted, 0, 5)) : 0
}

function angleDamp(from: number, to: number, speed: number, dt: number): number {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + difference * (1 - Math.exp(-speed * dt))
}

/** Street population and escalating wanted response, all in world-space metres. */
export class CityLife {
  private readonly group = new THREE.Group()
  private readonly people: Pedestrian[] = []
  private readonly officers: Pedestrian[] = []
  private readonly vehicles: Vehicle[] = []
  private readonly birds: Bird[] = []
  private readonly barriers: THREE.Group[] = []
  private readonly barrierLights: THREE.Mesh[] = []
  private readonly particles: Particle[] = []
  private readonly particleMesh: THREE.InstancedMesh
  private readonly traces: Trace[] = []
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly sphereGeometry = new THREE.SphereGeometry(1, 10, 7)
  private readonly wheelGeometry = new THREE.CylinderGeometry(0.43, 0.43, 0.25, 10)
  private readonly traceGeometry = new THREE.CylinderGeometry(0.025, 0.025, 1, 5)
  private readonly coneGeometry = new THREE.ConeGeometry(1, 1, 7)
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>()
  private readonly compoundGeometries = new Map<string, THREE.BufferGeometry>()
  private readonly compoundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true })
  private readonly compoundLightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true })
  private readonly tracePlayer = new THREE.MeshBasicMaterial({ color: '#fff0a8' })
  private readonly tracePolice = new THREE.MeshBasicMaterial({ color: '#ffb26e' })
  private readonly particleDummy = new THREE.Object3D()
  private readonly helicopter = new THREE.Group()
  private readonly rotor = new THREE.Group()
  private readonly tailRotor = new THREE.Group()
  private readonly heliLight: THREE.Mesh
  private particleCursor = 0
  private traceCursor = 0
  private time = 0
  private lastWanted = 0
  private heliFire = 1.8
  private randomState = 0x765ba9
  private readonly color = new THREE.Color()

  constructor(scene: THREE.Scene) {
    this.group.name = 'City life'
    scene.add(this.group)
    for (let i = 0; i < MAX_PEDESTRIANS; i += 1) this.people.push(this.makePerson(false, i))
    for (let i = 0; i < MAX_OFFICERS; i += 1) this.officers.push(this.makePerson(true, i))
    this.makeTraffic()
    this.makeRoadblocks()
    this.heliLight = this.makeHelicopter()
    this.makeBirds()

    this.particleMesh = new THREE.InstancedMesh(
      this.sphereGeometry,
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.76, depthWrite: false }),
      PARTICLE_COUNT,
    )
    this.particleMesh.name = 'Pooled city impact particles'
    this.particleMesh.frustumCulled = false
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      this.particles.push({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), life: 0, total: 1, size: 0, smoke: false })
      this.particleDummy.scale.setScalar(0)
      this.particleDummy.updateMatrix()
      this.particleMesh.setMatrixAt(i, this.particleDummy.matrix)
      this.particleMesh.setColorAt(i, this.color.set('#ffffff'))
    }
    this.particleMesh.instanceMatrix.needsUpdate = true
    this.group.add(this.particleMesh)
    for (let i = 0; i < TRACE_COUNT; i += 1) {
      const mesh = new THREE.Mesh(this.traceGeometry, this.tracePlayer)
      mesh.visible = false
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.traces.push({ mesh, life: 0 })
    }
  }

  /** Advance movements and visible effects. Player is a world-space position. */
  update(dt: number, player: THREE.Vector3, wanted: number): void {
    dt = safeStep(dt)
    if (dt === 0) return
    const level = levelOf(wanted)
    this.time += dt
    const activeOfficers = Math.min(MAX_OFFICERS, Math.max(1, level))
    for (let i = 0; i < this.officers.length; i += 1) {
      const officer = this.officers[i]
      const active = i < activeOfficers
      if (active && (!officer.active || (this.lastWanted === 0 && level > 0 && officer.root.position.distanceToSquared(player) > 45 * 45))) {
        const angle = i * 2.2 + 0.7
        officer.root.position.set(THREE.MathUtils.clamp(player.x + Math.cos(angle) * (18 + i * 2), -375, 365), 0.04, THREE.MathUtils.clamp(player.z + Math.sin(angle) * (18 + i * 2), -375, 375))
        officer.down = 0
        officer.impulse.set(0, 0, 0)
        officer.fire = 0.7 + i * 0.35
      }
      officer.active = active
      officer.root.visible = active
    }
    for (const person of this.people) this.updatePerson(person, dt, player, level)
    for (const officer of this.officers) if (officer.active) this.updatePerson(officer, dt, player, level)
    for (const vehicle of this.vehicles) this.updateVehicle(vehicle, dt, player, level)
    this.updateRoadblocks(player, level)
    this.updateHelicopter(dt, player, level)
    this.updateBirds(dt, player)
    this.updateEffects(dt)
    this.lastWanted = level
  }

  /** Frighten nearby bystanders and birds without changing game rules. */
  startle(position: THREE.Vector3): void {
    for (const person of this.people) {
      const dx = person.root.position.x - position.x
      const dz = person.root.position.z - position.z
      if (dx * dx + dz * dz < 23 * 23 && Math.abs(position.y - 1) < 12) {
        person.danger.copy(position)
        person.flee = Math.max(person.flee, 5 + this.random() * 2)
      }
    }
    for (const bird of this.birds) {
      const dx = bird.root.position.x - position.x
      const dz = bird.root.position.z - position.z
      if (dx * dx + dz * dz < 24 * 24) bird.scared = 3
    }
  }

  /** Nearest person struck by a ray, with a visible tracer. Does not raycast walls. */
  shoot(origin: THREE.Vector3, direction: THREE.Vector3, range: number): boolean {
    this.startle(origin)
    const length = direction.length()
    if (!Number.isFinite(range) || range <= 0 || !Number.isFinite(length) || length < 1e-6) return false
    const dir = direction.clone().multiplyScalar(1 / length)
    let nearest = range
    let target: Pedestrian | undefined
    for (const person of [...this.people, ...this.officers]) {
      if (!person.active) continue
      for (const [height, radius] of [[0.45, 0.32], [1.08, 0.48], [1.75, 0.31]]) {
        const x = person.root.position.x - origin.x
        const y = person.root.position.y + height - origin.y
        const z = person.root.position.z - origin.z
        const projected = x * dir.x + y * dir.y + z * dir.z
        const perpendicularSq = x * x + y * y + z * z - projected * projected
        if (perpendicularSq > radius * radius) continue
        const halfChord = Math.sqrt(Math.max(0, radius * radius - perpendicularSq))
        const entry = Math.max(0, projected - halfChord)
        if (projected + halfChord >= 0 && entry <= nearest) {
          nearest = entry
          target = person
        }
      }
    }
    const end = origin.clone().addScaledVector(dir, nearest)
    this.addTrace(origin, end, false)
    if (!target) return false
    this.hitPerson(target, origin, 5.8)
    this.emit(end, '#ffd37b', 6, false)
    this.startle(end)
    return true
  }

  /** Knock down nearby people and damage/brake nearby visual traffic. Returns people hit. */
  impact(position: THREE.Vector3, radius: number, force: number): number {
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(force) || force <= 0) return 0
    this.startle(position)
    let hit = 0
    const strength = THREE.MathUtils.clamp(force, 1, 16)
    for (const person of [...this.people, ...this.officers]) {
      if (!person.active || person.hitLock > 0 || person.down > 0) continue
      const dx = person.root.position.x - position.x
      const dy = person.root.position.y + 1 - position.y
      const dz = person.root.position.z - position.z
      if (dx * dx + dy * dy + dz * dz <= (radius + 0.45) ** 2) {
        this.hitPerson(person, position, strength)
        hit += 1
      }
    }
    for (const car of this.vehicles) {
      const dx = car.root.position.x - position.x
      const dz = car.root.position.z - position.z
      if (Math.abs(position.y - car.root.position.y) < radius + 2 && dx * dx + dz * dz < (radius + 2) ** 2) {
        if (car.crash <= 0) this.emit(car.root.position.clone().add(new THREE.Vector3(0, 1.1, 0)), '#ffb25f', 4, false)
        car.crash = Math.max(car.crash, 2.5 + strength * 0.16)
        car.speed *= 0.35
      }
    }
    if (hit > 0) this.emit(position, '#eadac2', 5, true)
    return hit
  }

  /** A moving traffic vehicle can knock a pedestrian player down. */
  hitPlayer(player: THREE.Vector3): { direction: THREE.Vector3; force: number } | null {
    if (player.y > 2) return null
    for (const car of this.vehicles) {
      if (car.crash > 0 || Math.abs(car.speed) < 4) continue
      const dx = player.x - car.root.position.x, dz = player.z - car.root.position.z
      if (dx * dx + dz * dz > 4.8) continue
      const force = Math.abs(car.speed)
      const direction = new THREE.Vector3(dx || .1, 0, dz || .1).normalize()
      car.crash = 1.5; car.speed *= .3; this.startle(player)
      return { direction, force }
    }
    return null
  }
  /** Incoming police HP damage this step; projectiles are cosmetic and ignore walls. */
  getDamage(player: THREE.Vector3, dt: number, wanted: number): number {
    dt = safeStep(dt)
    const level = levelOf(wanted)
    if (dt === 0 || level === 0) return 0
    let damage = 0
    const target = new THREE.Vector3(player.x, player.y + 1.2, player.z)
    for (const officer of this.officers) {
      if (!officer.active || officer.down > 0) continue
      officer.fire -= dt
      const dx = officer.root.position.x - player.x
      const dz = officer.root.position.z - player.z
      if (officer.fire <= 0 && dx * dx + dz * dz < (19 + level * 2) ** 2 && Math.abs(player.y) < 9) {
        const muzzle = officer.root.position.clone().add(new THREE.Vector3(0, 1.38, 0))
        this.addTrace(muzzle, target, true)
        this.emit(muzzle, '#ffd17a', 2, false)
        damage += 3 + level * 0.35
        officer.fire = 1.3 + this.random() * 0.7
      }
    }
    for (const car of this.vehicles) {
      if (!car.patrol || car.crash > 0) continue
      car.fire -= dt
      const dx = car.root.position.x - player.x
      const dz = car.root.position.z - player.z
      if (car.fire <= 0 && dx * dx + dz * dz < 16 * 16 && Math.abs(player.y) < 8) {
        this.addTrace(car.root.position.clone().add(new THREE.Vector3(0, 1.45, 0)), target, true)
        damage += 2.5 + level * 0.25
        car.fire = 2.1 + this.random()
      }
    }
    if (level >= 4 && this.helicopter.visible) {
      this.heliFire -= dt
      const dx = this.helicopter.position.x - player.x
      const dz = this.helicopter.position.z - player.z
      if (this.heliFire <= 0 && dx * dx + dz * dz < 30 * 30) {
        this.addTrace(this.helicopter.position.clone().add(new THREE.Vector3(0, -0.5, 0)), target, true)
        damage += 4 + (level - 4)
        this.heliFire = 2.4
      }
    }
    return damage
  }

  private random(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0
    return this.randomState / 4294967296
  }

  private material(color: string, emissive = false): THREE.MeshStandardMaterial {
    const key = `${color}:${emissive}`
    let result = this.materials.get(key)
    if (!result) {
      result = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, emissive: emissive ? color : '#000000', emissiveIntensity: emissive ? 1.5 : 0 })
      this.materials.set(key, result)
    }
    return result
  }

  private box(parent: THREE.Object3D, color: string, x: number, y: number, z: number, width: number, height: number, depth: number, emissive = false): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, this.material(color, emissive))
    mesh.position.set(x, y, z)
    mesh.scale.set(width, height, depth)
    parent.add(mesh)
    return mesh
  }

  private ball(parent: THREE.Object3D, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.sphereGeometry, this.material(color))
    mesh.position.set(x, y, z)
    mesh.scale.set(sx, sy, sz)
    parent.add(mesh)
    return mesh
  }

  /** Bake rigid, differently colored pieces together while retaining animated joints. */
  private compound(parent: THREE.Object3D, parts: Part[], light = false): THREE.Mesh {
    const key = JSON.stringify(parts)
    let geometry = this.compoundGeometries.get(key)
    if (!geometry) {
      const components = parts.map(([shape, color, x, y, z, sx, sy, sz]) => {
        const component = (shape === 'box' ? this.boxGeometry : this.sphereGeometry).clone()
        const transform = new THREE.Matrix4().makeScale(sx, sy, sz)
        transform.setPosition(x, y, z)
        component.applyMatrix4(transform)
        const col = new THREE.Color(color)
        const colors = new Float32Array(component.getAttribute('position').count * 3)
        for (let i = 0; i < colors.length; i += 3) {
          colors[i] = col.r
          colors[i + 1] = col.g
          colors[i + 2] = col.b
        }
        component.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        return component
      })
      geometry = mergeGeometries(components)
      for (const component of components) component.dispose()
      this.compoundGeometries.set(key, geometry)
    }
    const mesh = new THREE.Mesh(geometry, light ? this.compoundLightMaterial : this.compoundMaterial)
    parent.add(mesh)
    return mesh
  }

  private makePerson(police: boolean, index: number): Pedestrian {
    const root = new THREE.Group()
    const model = new THREE.Group()
    root.name = police ? 'Police officer' : 'Pedestrian'
    root.add(model)
    const shirts = ['#ed785e', '#47b6bd', '#f3c66d', '#ba7db4', '#e8d9c4', '#7aa0c7', '#e75f87', '#83bd98']
    const skins = ['#e9b28d', '#9c664b', '#c6855b', '#f1c7a8', '#704936']
    const shirt = police ? '#203c60' : shirts[index % shirts.length]
    const pants = police ? '#18283d' : ['#263a50', '#e3d2ae', '#405464', '#6c4b54'][index % 4]
    const skin = skins[index % skins.length]
    const bodyParts: Part[] = [
      ['box', shirt, 0, 1.16, 0, 0.54, 0.7, 0.28],
      ['ball', skin, 0, 1.76, 0, 0.23, 0.26, 0.23],
    ]
    if (police) {
      bodyParts.push(['box', '#142538', 0, 1.99, 0, 0.51, 0.12, 0.43])
      bodyParts.push(['box', '#d5b956', -0.14, 1.27, 0.155, 0.09, 0.12, 0.025])
    } else {
      bodyParts.push(['box', ['#3f302d', '#322b31', '#916249', '#24242b'][index % 4], 0, 1.97, -0.015, 0.42, 0.12, 0.38])
    }
    this.compound(model, bodyParts)
    const limb = (x: number, y: number, color: string, length: number, width: number, leg: boolean): THREE.Group => {
      const joint = new THREE.Group()
      joint.position.set(x, y, 0)
      const parts: Part[] = [['box', color, 0, -length / 2, 0, width, length, width]]
      if (leg) parts.push(['box', '#232936', 0, -0.76, 0.07, 0.23, 0.14, 0.33])
      else parts.push(['ball', skin, 0, -0.67, 0, 0.1, 0.12, 0.1])
      this.compound(joint, parts)
      model.add(joint)
      return joint
    }
    const leftLeg = limb(-0.15, 0.83, pants, 0.78, 0.2, true)
    const rightLeg = limb(0.15, 0.83, pants, 0.78, 0.2, true)
    const leftArm = limb(-0.36, 1.44, shirt, 0.65, 0.18, false)
    const rightArm = limb(0.36, 1.44, shirt, 0.65, 0.18, false)
    const side = index % 2 === 0 ? -1 : 1
    const streetX = !police && index >= 30 ? -205 : !police && index >= 18 ? -70 : 0
    const z = police ? -18 + index * 13 : -88 + index * 8 + this.random() * 4
    const sidewalk = streetX === 0 ? 11.5 + (index % 3) * 0.8 : 8.5 + (index % 3) * 0.6
    root.position.set(streetX + side * sidewalk, streetX === 0 ? 0.14 : 0.04, z)
    const active = !police || index === 0
    root.visible = active
    this.group.add(root)
    return { root, model, leftLeg, rightLeg, leftArm, rightArm, police, active, side, streetX, direction: index % 4 < 2 ? 1 : -1, speed: 0.95 + this.random() * 0.42, phase: this.random() * TAU, flee: 0, danger: new THREE.Vector3(), impulse: new THREE.Vector3(), stagger: 0, down: 0, hitLock: 0, fire: 0.8 + index * 0.3 }
  }

  private updatePerson(person: Pedestrian, dt: number, player: THREE.Vector3, wanted: number): void {
    person.flee = Math.max(0, person.flee - dt)
    person.stagger = Math.max(0, person.stagger - dt)
    person.down = Math.max(0, person.down - dt)
    person.hitLock = Math.max(0, person.hitLock - dt)
    const pos = person.root.position
    pos.addScaledVector(person.impulse, dt)
    person.impulse.multiplyScalar(Math.exp(-4.5 * dt))
    let dx = 0
    let dz = 0
    let speed = person.speed
    if (person.down <= 0) {
      if (person.police && wanted > 0) {
        dx = player.x - pos.x
        dz = player.z - pos.z
        const distance = Math.hypot(dx, dz)
        if (distance > 6) {
          dx /= distance
          dz /= distance
          speed = 2.45 + wanted * 0.18
        } else {
          dx = 0
          dz = 0
        }
      } else if (!person.police && person.flee > 0) {
        dx = pos.x - person.danger.x
        dz = pos.z - person.danger.z
        if (Math.abs(dz) < 1.5) dz = person.direction * 3
        const distance = Math.hypot(dx, dz) || 1
        dx /= distance
        dz /= distance
        speed = 3.8
      } else {
        dz = person.direction
      }
      pos.x += dx * speed * dt
      pos.z += dz * speed * dt
      if (dx !== 0 || dz !== 0) person.root.rotation.y = angleDamp(person.root.rotation.y, Math.atan2(dx, dz), 8, dt)
    }
    if (!person.police || wanted === 0) {
      // Stay near the sidewalks; recycle only after leaving the player's vicinity.
      const inner = person.streetX === 0 ? 10.6 : 7.8
      const outer = person.streetX === 0 ? 14.7 : 10.8
      pos.x = person.streetX + person.side * THREE.MathUtils.clamp(Math.abs(pos.x - person.streetX), inner, outer)
      pos.y = person.streetX === 0 ? 0.14 : 0.04
      if (pos.z - player.z > 115) pos.z = THREE.MathUtils.clamp(player.z - 105, -370, 370)
      else if (pos.z - player.z < -115) pos.z = THREE.MathUtils.clamp(player.z + 105, -370, 370)
      pos.z = THREE.MathUtils.clamp(pos.z, -375, 375)
    } else if (Math.hypot(pos.x - player.x, pos.z - player.z) > 110) {
      const angle = person.phase + this.time * 0.2
      pos.set(THREE.MathUtils.clamp(player.x + Math.cos(angle) * 28, -375, 365), 0.04, THREE.MathUtils.clamp(player.z + Math.sin(angle) * 28, -375, 375))
    }
    const moving = person.down <= 0 && (dx !== 0 || dz !== 0)
    person.phase += dt * (moving ? speed * 3.3 : 1)
    const swing = moving ? Math.sin(person.phase) * (person.flee > 0 ? 0.9 : 0.55) : 0
    person.leftLeg.rotation.x = swing
    person.rightLeg.rotation.x = -swing
    person.leftArm.rotation.x = -swing * 0.7
    person.rightArm.rotation.x = swing * 0.7
    const fallen = person.down > 0 ? 1.3 : person.stagger > 0 ? 0.35 : 0
    person.model.rotation.z = THREE.MathUtils.damp(person.model.rotation.z, fallen * person.side, 9, dt)
    person.model.position.y = moving ? Math.abs(Math.sin(person.phase)) * 0.035 : 0
  }

  private hitPerson(person: Pedestrian, from: THREE.Vector3, force: number): void {
    let dx = person.root.position.x - from.x
    let dz = person.root.position.z - from.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.01) {
      dx = person.side
      dz = person.direction * 0.5
    } else {
      dx /= distance
      dz /= distance
    }
    person.impulse.set(dx * Math.min(10, force), 0, dz * Math.min(10, force))
    person.down = Math.max(person.down, 1.6 + Math.min(2.4, force * 0.18))
    person.stagger = 1
    person.hitLock = 0.6
    person.danger.copy(from)
    person.flee = person.police ? 0 : 7
    this.emit(person.root.position.clone().add(new THREE.Vector3(0, 1.2, 0)), '#ffddaa', 5, false)
  }

  private makeTraffic(): void {
    const colors = ['#f2a45e', '#69c9c6', '#e56b85', '#cfc5aa', '#6093ba', '#ebd369', '#e9e0d0', '#b682aa']
    const lanes = [-7.5, -2.5, 2.5, 7.5]
    for (let i = 0; i < 8; i += 1) {
      const lane = lanes[i % 4]
      const direction = lane < 0 ? -1 : 1
      this.makeVehicle('z', lane, direction, -63 + Math.floor(i / 4) * 68 + (i % 4) * 11, colors[i], false)
    }
    this.makeVehicle('x', 21.5, 1, -38, '#e8c16a', false)
    this.makeVehicle('x', 26.5, -1, 40, '#61b8b7', false)
    this.makeVehicle('z', -73.5, -1, 20, '#cbb9db', false)
    this.makeVehicle('z', -66.5, 1, -30, '#d39e73', false)
    this.makeVehicle('z', -133.5, 1, 82, '#8cb7c2', false)
    this.makeVehicle('z', -126.5, -1, -118, '#d7aa7c', false)
    this.makeVehicle('z', -208.5, 1, 48, '#b8c0c8', false)
    this.makeVehicle('z', -203.5, -1, -176, '#d8bc82', false)
    this.makeVehicle('z', -2.5, -1, 36, '#dce4e3', true)
    this.makeVehicle('z', 2.5, 1, -45, '#dce4e3', true)
    this.makeVehicle('x', -160, 1, -110, '#e2e5d9', false)
    this.makeVehicle('x', 240, -1, 155, '#c5d4d6', false)
  }

  private makeVehicle(axis: 'x' | 'z', lane: number, direction: number, along: number, color: string, patrol: boolean): void {
    const root = new THREE.Group()
    const body = new THREE.Group()
    root.name = patrol ? 'Police patrol car' : 'Traffic car'
    root.add(body)
    const parts: Part[] = [
      ['box', patrol ? '#ebede5' : color, 0, 0.68, 0, 2.05, 0.72, 4.1],
      ['box', patrol ? '#24354a' : color, 0, 1.22, -0.2, 1.7, 0.62, 2.05],
      ['box', '#8cb7c2', 0, 1.23, 0.84, 1.42, 0.42, 0.035],
      ['box', '#8cb7c2', 0, 1.23, -1.25, 1.42, 0.42, 0.035],
      ['box', '#8cb7c2', -0.86, 1.23, -0.18, 0.035, 0.42, 1.65],
      ['box', '#8cb7c2', 0.86, 1.23, -0.18, 0.035, 0.42, 1.65],
      ['box', '#353a42', 0, 0.42, 2.07, 1.8, 0.17, 0.16],
      ['box', '#353a42', 0, 0.42, -2.07, 1.8, 0.17, 0.16],
    ]
    if (patrol) {
      parts.push(['box', '#172c45', -1.03, 0.73, 0, 0.04, 0.31, 2.8])
      parts.push(['box', '#172c45', 1.03, 0.73, 0, 0.04, 0.31, 2.8])
    }
    this.compound(body, parts)
    const lights: Part[] = []
    for (const x of [-0.7, 0.7]) {
      lights.push(['box', '#fff0bf', x, 0.77, 2.07, 0.42, 0.19, 0.04])
      lights.push(['box', '#fa4851', x, 0.73, -2.07, 0.38, 0.17, 0.04])
    }
    this.compound(body, lights, true)
    let red: THREE.Mesh | undefined
    let blue: THREE.Mesh | undefined
    if (patrol) {
      this.box(body, '#202b3d', 0, 1.59, -0.2, 1.0, 0.12, 0.36)
      red = this.box(body, '#ff3f58', -0.28, 1.7, -0.2, 0.42, 0.2, 0.3, true)
      blue = this.box(body, '#3e9fff', 0.28, 1.7, -0.2, 0.42, 0.2, 0.3, true)
    }
    const wheels: THREE.Mesh[] = []
    for (const x of [-1.02, 1.02]) for (const z of [-1.35, 1.35]) {
      const wheel = new THREE.Mesh(this.wheelGeometry, this.material('#20252c'))
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.44, z)
      body.add(wheel)
      wheels.push(wheel)
    }
    if (axis === 'z') root.position.set(lane, 0.04, along)
    else root.position.set(along, 0.04, lane)
    root.rotation.y = axis === 'z' ? (direction > 0 ? 0 : Math.PI) : direction > 0 ? Math.PI / 2 : -Math.PI / 2
    this.group.add(root)
    const cruise = patrol ? 6.0 : 6.6 + this.random() * 2.4
    this.vehicles.push({ root, body, wheels, red, blue, axis, lane, direction, cruise, speed: cruise, patrol, crash: 0, smoke: 0, fire: 1 + this.random() * 2 })
  }

  private updateVehicle(car: Vehicle, dt: number, player: THREE.Vector3, wanted: number): void {
    const pos = car.root.position
    car.crash = Math.max(0, car.crash - dt)
    car.smoke -= dt
    const pursuing = car.patrol && wanted > 0
    let targetSpeed = car.cruise
    let moveX = car.axis === 'x' ? car.direction : 0
    let moveZ = car.axis === 'z' ? car.direction : 0
    if (pursuing) {
      const dx = player.x - pos.x
      const dz = player.z - pos.z
      const distance = Math.hypot(dx, dz)
      if (distance > 7) {
        moveX = dx / distance
        moveZ = dz / distance
        targetSpeed = Math.min(9.5, distance * 0.48)
      } else targetSpeed = 0
      if (distance > 115) {
        pos.set(player.x + (car.direction > 0 ? -24 : 24), 0.04, player.z - 24 * car.direction)
      }
    } else {
      // A patrol car that has left its lane during pursuit smoothly rejoins it.
      if (car.axis === 'z') moveX = THREE.MathUtils.clamp((car.lane - pos.x) * 0.2, -0.65, 0.65)
      else moveZ = THREE.MathUtils.clamp((car.lane - pos.z) * 0.2, -0.65, 0.65)
      const moveLength = Math.hypot(moveX, moveZ) || 1
      moveX /= moveLength
      moveZ /= moveLength
      // Brake for the player or slower traffic ahead on this lane.
      const ahead = car.axis === 'z' ? (player.z - pos.z) * car.direction : (player.x - pos.x) * car.direction
      const lateral = car.axis === 'z' ? Math.abs(player.x - pos.x) : Math.abs(player.z - pos.z)
      if (Math.abs(player.y) < 4 && ahead > -1 && ahead < 14 && lateral < 2.3) targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - 3.5) * 0.7))
      for (const other of this.vehicles) {
        if (other === car) continue
        const forward = car.axis === 'z' ? (other.root.position.z - pos.z) * car.direction : (other.root.position.x - pos.x) * car.direction
        const across = car.axis === 'z' ? Math.abs(other.root.position.x - pos.x) : Math.abs(other.root.position.z - pos.z)
        if (forward > 0 && forward < 10 && across < 2.3) targetSpeed = Math.min(targetSpeed, Math.max(0, (forward - 4.8) * 1.2))
      }
      const playerAlong = car.axis === 'z' ? player.z : player.x
      const along = car.axis === 'z' ? pos.z : pos.x
      if ((along - playerAlong) * car.direction > 115 || (along - playerAlong) * car.direction < -125) {
        const replacement = THREE.MathUtils.clamp(playerAlong - car.direction * (105 + this.random() * 12), -250, car.axis === 'z' ? 250 : 45)
        if (car.axis === 'z') pos.set(car.lane, 0.04, replacement)
        else pos.set(replacement, 0.04, car.lane)
      }
    }
    if (car.crash > 0) {
      targetSpeed = 0
      if (car.smoke <= 0) {
        this.emit(pos.clone().add(new THREE.Vector3(0, 1.3, 0)), '#a69d91', 2, true)
        car.smoke = 0.24
      }
    }
    car.speed = THREE.MathUtils.damp(car.speed, targetSpeed, targetSpeed < car.speed ? 5.2 : 1.05, dt)
    pos.x += moveX * car.speed * dt
    pos.z += moveZ * car.speed * dt
    if (car.speed > 0.1) car.root.rotation.y = angleDamp(car.root.rotation.y, Math.atan2(moveX, moveZ), pursuing ? 2.5 : 6, dt)
    car.body.rotation.z = THREE.MathUtils.damp(car.body.rotation.z, car.crash > 0 ? Math.sin(this.time * 14) * 0.04 : 0, 6, dt)
    for (const wheel of car.wheels) wheel.rotation.y += car.speed * dt / 0.43
    if (car.red && car.blue) {
      const flash = Math.floor(this.time * 7) % 2 === 0
      car.red.visible = !pursuing || flash
      car.blue.visible = !pursuing || !flash
    }
  }

  private makeRoadblocks(): void {
    for (let i = 0; i < 2; i += 1) {
      const block = new THREE.Group()
      block.name = 'Police roadblock'
      for (const x of [-4.5, 4.5]) {
        this.box(block, '#e5e8e0', x, 1, 0, 8.7, 0.62, 0.32)
        for (let j = -3; j <= 3; j += 1) {
          const stripe = this.box(block, '#ef8752', x + j * 1.15, 1, 0.18, 0.3, 0.72, 0.035)
          stripe.rotation.z = -0.4
        }
        for (const footX of [-3.7, 3.7]) this.box(block, '#53616a', x + footX, 0.45, 0, 0.15, 0.9, 0.9)
      }
      const light = this.box(block, '#ffba52', 0, 1.55, 0, 0.4, 0.22, 0.4, true)
      this.barrierLights.push(light)
      block.position.set(0, 0.04, i === 0 ? 45 : -45)
      block.visible = false
      this.group.add(block)
      this.barriers.push(block)
    }
  }

  private updateRoadblocks(player: THREE.Vector3, wanted: number): void {
    for (let i = 0; i < this.barriers.length; i += 1) {
      const block = this.barriers[i]
      const active = wanted >= (i === 0 ? 3 : 4)
      if (active && (!block.visible || Math.abs(block.position.z - player.z) > 90)) {
        block.position.z = THREE.MathUtils.clamp(player.z + (i === 0 ? 32 : -32), -245, 245)
      }
      block.visible = active
      this.barrierLights[i].visible = Math.floor(this.time * 4 + i) % 2 === 0
    }
  }

  private makeHelicopter(): THREE.Mesh {
    this.helicopter.name = 'Police helicopter'
    this.ball(this.helicopter, '#dbe6df', 0, 0, 0, 1.25, 0.82, 2.1)
    this.ball(this.helicopter, '#6495a5', 0, 0.1, 1.32, 0.95, 0.58, 0.83)
    this.box(this.helicopter, '#283e55', 0, 0.06, -2.65, 0.43, 0.4, 2.6)
    this.box(this.helicopter, '#dbe6df', 0, 0.7, -3.75, 0.13, 1.25, 0.85)
    for (const x of [-0.85, 0.85]) {
      this.box(this.helicopter, '#344657', x, -1.03, 0, 0.11, 0.1, 3.6)
      this.box(this.helicopter, '#344657', x, -0.68, -1, 0.1, 0.7, 0.1)
      this.box(this.helicopter, '#344657', x, -0.68, 0.9, 0.1, 0.7, 0.1)
    }
    this.rotor.position.y = 0.98
    this.box(this.rotor, '#293b48', 0, 0, 0, 7.2, 0.08, 0.19)
    this.box(this.rotor, '#293b48', 0, 0, 0, 0.19, 0.08, 7.2)
    this.helicopter.add(this.rotor)
    this.tailRotor.position.set(0.3, 0.35, -3.8)
    this.box(this.tailRotor, '#293b48', 0, 0, 0, 0.1, 1.5, 0.13)
    this.box(this.tailRotor, '#293b48', 0, 0, 0, 0.1, 0.13, 1.5)
    this.helicopter.add(this.tailRotor)
    this.box(this.helicopter, '#ff4055', -0.9, 0.35, -1, 0.18, 0.18, 0.18, true)
    this.box(this.helicopter, '#47aaff', 0.9, 0.35, -1, 0.18, 0.18, 0.18, true)
    const light = new THREE.Mesh(this.coneGeometry, new THREE.MeshBasicMaterial({ color: '#fff6c9', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }))
    light.position.set(0, -7.7, 0)
    light.scale.set(4.5, 14, 4.5)
    this.helicopter.add(light)
    this.helicopter.position.set(20, 15, -20)
    this.helicopter.visible = false
    this.group.add(this.helicopter)
    return light
  }

  private updateHelicopter(dt: number, player: THREE.Vector3, wanted: number): void {
    const active = wanted >= 4
    if (active && !this.helicopter.visible) {
      this.helicopter.position.set(player.x + 24, Math.max(15, player.y + 14), player.z - 24)
      this.heliFire = 2
    }
    this.helicopter.visible = active
    if (!active) return
    const angle = this.time * 0.32
    const tx = player.x + Math.cos(angle) * 11
    const tz = player.z + Math.sin(angle) * 11
    const pos = this.helicopter.position
    const dx = tx - pos.x
    const dz = tz - pos.z
    const distance = Math.hypot(dx, dz)
    if (distance > 0.01) {
      const travel = Math.min(distance, 11 * dt)
      pos.x += dx / distance * travel
      pos.z += dz / distance * travel
      this.helicopter.rotation.y = angleDamp(this.helicopter.rotation.y, Math.atan2(player.x - pos.x, player.z - pos.z), 2, dt)
    }
    pos.y = THREE.MathUtils.damp(pos.y, Math.max(15, player.y + 14) + Math.sin(this.time * 2) * 0.4, 2, dt)
    this.rotor.rotation.y += dt * 28
    this.tailRotor.rotation.x += dt * 35
    this.heliLight.rotation.z = Math.sin(this.time) * 0.06
  }

  private makeBirds(): void {
    for (let i = 0; i < 5; i += 1) {
      const root = new THREE.Group()
      root.name = 'Gull'
      this.ball(root, '#ece9db', 0, 0, 0, 0.22, 0.13, 0.35)
      const left = new THREE.Group()
      const right = new THREE.Group()
      left.position.x = -0.16
      right.position.x = 0.16
      this.box(left, '#e6e9e8', -0.32, 0, 0, 0.7, 0.07, 0.22)
      this.box(right, '#e6e9e8', 0.32, 0, 0, 0.7, 0.07, 0.22)
      root.add(left, right)
      root.position.set(12 + i * 3.8, 5 + i * 0.65, -36 + i * 22)
      this.group.add(root)
      this.birds.push({ root, left, right, phase: i * 1.8, scared: 0 })
    }
  }

  private updateBirds(dt: number, player: THREE.Vector3): void {
    for (const bird of this.birds) {
      bird.scared = Math.max(0, bird.scared - dt)
      bird.phase += dt * (bird.scared > 0 ? 8 : 4)
      bird.left.rotation.z = Math.sin(bird.phase) * 0.5
      bird.right.rotation.z = -bird.left.rotation.z
      bird.root.position.z += dt * (bird.scared > 0 ? 5 : 2)
      bird.root.position.y = THREE.MathUtils.damp(bird.root.position.y, (bird.scared > 0 ? 10 : 6) + Math.sin(bird.phase * 0.3) * 0.8, 1, dt)
      if (bird.root.position.z - player.z > 100) bird.root.position.z = THREE.MathUtils.clamp(player.z - 95, -370, 370)
      if (bird.root.position.z - player.z < -110) bird.root.position.z = THREE.MathUtils.clamp(player.z + 90, -370, 370)
    }
  }

  private emit(position: THREE.Vector3, color: string, count: number, smoke: boolean): void {
    for (let i = 0; i < count; i += 1) {
      const index = this.particleCursor++ % PARTICLE_COUNT
      const particle = this.particles[index]
      particle.position.copy(position)
      particle.velocity.set((this.random() - 0.5) * (smoke ? 1.2 : 5), (smoke ? 1 : 2) + this.random() * (smoke ? 1.3 : 3), (this.random() - 0.5) * (smoke ? 1.2 : 5))
      particle.total = smoke ? 0.8 + this.random() * 0.5 : 0.24 + this.random() * 0.24
      particle.life = particle.total
      particle.size = smoke ? 0.18 + this.random() * 0.2 : 0.08 + this.random() * 0.1
      particle.smoke = smoke
      this.particleMesh.setColorAt(index, this.color.set(color))
    }
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true
  }

  private addTrace(start: THREE.Vector3, end: THREE.Vector3, police: boolean): void {
    const trace = this.traces[this.traceCursor++ % TRACE_COUNT]
    const delta = end.clone().sub(start)
    const length = delta.length()
    if (length < 0.01) return
    trace.mesh.position.copy(start).addScaledVector(delta, 0.5)
    trace.mesh.quaternion.setFromUnitVectors(UP, delta.multiplyScalar(1 / length))
    trace.mesh.scale.set(1, length, 1)
    trace.mesh.material = police ? this.tracePolice : this.tracePlayer
    trace.mesh.visible = true
    trace.life = 0.09
  }

  private updateEffects(dt: number): void {
    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i]
      if (particle.life > 0) {
        particle.life = Math.max(0, particle.life - dt)
        particle.position.addScaledVector(particle.velocity, dt)
        particle.velocity.y += (particle.smoke ? 0.3 : -7) * dt
        const progress = 1 - particle.life / particle.total
        const size = particle.size * (particle.smoke ? 1 + progress * 1.4 : 1 - progress)
        this.particleDummy.position.copy(particle.position)
        this.particleDummy.scale.setScalar(particle.life > 0 ? size : 0)
      } else this.particleDummy.scale.setScalar(0)
      this.particleDummy.updateMatrix()
      this.particleMesh.setMatrixAt(i, this.particleDummy.matrix)
    }
    this.particleMesh.instanceMatrix.needsUpdate = true
    for (const trace of this.traces) {
      trace.life -= dt
      if (trace.life <= 0) trace.mesh.visible = false
    }
  }
}
