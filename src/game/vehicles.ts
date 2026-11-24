import * as THREE from 'three'

/**
 * The root position is the authoritative world position, at ground/water level.
 * Heading zero points down -Z; positive steering turns right. Health is 0–100.
 * Velocity is in world units per second and is exposed for camera/audio/gameplay.
 */
export type Vehicle = {
  root: THREE.Group
  type: string
  name: string
  speed: number
  health: number
  heading: number
  velocity: THREE.Vector3
}

export type VehicleSurface = 'asphalt' | 'wet' | 'sand' | 'dirt' | 'water'
export type VehicleInput = { throttle: number; steer: number; handbrake: boolean }

type Wheel = { spin: THREE.Group; steering: THREE.Group | null; radius: number }
type Handling = { acceleration: number; brake: number; maxSpeed: number; reverse: number; turn: number; grip: number; width: number; length: number; radius: number }
type VehicleParts = {
  model: THREE.Group
  wheels: Wheel[]
  rotor: THREE.Group | null
  tailRotor: THREE.Group | null
  panels: THREE.Object3D[]
  paint: THREE.MeshStandardMaterial
  paintColor: THREE.Color
  brakeLight: THREE.MeshStandardMaterial
  handling: Handling
  wheelAngle: number
  steerAngle: number
  previousSpeed: number
  smokeTimer: number
  fireTimer: number
  impactCooldown: number
  damageStage: number
  phase: number
}
type Particle = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  age: number
  life: number
  baseSize: number
  gravity: number
  spin: THREE.Vector3
  disposableMaterial: boolean
}

const clamp = THREE.MathUtils.clamp
const damp = THREE.MathUtils.damp
const UP = new THREE.Vector3(0, 1, 0)
const PARTICLE_LIMIT = 100
const NO_INPUT: VehicleInput = { throttle: 0, steer: 0, handbrake: false }
const GROUND_Y = 0
const HELICOPTER_CEILING = 32

const CAR: Handling = { acceleration: 12, brake: 22, maxSpeed: 31, reverse: 9, turn: 1.55, grip: 7.5, width: 1.02, length: 2.1, radius: 1.35 }
const SPORT: Handling = { acceleration: 17, brake: 26, maxSpeed: 38, reverse: 10, turn: 1.75, grip: 8.1, width: 1.06, length: 2.12, radius: 1.4 }
const MUSCLE: Handling = { acceleration: 15, brake: 20, maxSpeed: 34, reverse: 9, turn: 1.4, grip: 5.4, width: 1.09, length: 2.2, radius: 1.45 }
const BIKE: Handling = { acceleration: 16, brake: 20, maxSpeed: 35, reverse: 6, turn: 2.0, grip: 8.5, width: 0.45, length: 1.4, radius: 0.8 }
const TRUCK: Handling = { acceleration: 8.5, brake: 18, maxSpeed: 25, reverse: 7, turn: 1.05, grip: 6.0, width: 1.2, length: 2.8, radius: 1.8 }
const BOAT: Handling = { acceleration: 10, brake: 8, maxSpeed: 27, reverse: 7, turn: 1.15, grip: 2.4, width: 1.05, length: 2.35, radius: 1.4 }
const HELI: Handling = { acceleration: 9, brake: 10, maxSpeed: 25, reverse: 7, turn: 1.2, grip: 2.0, width: 1.25, length: 2.35, radius: 1.7 }

/**
 * Standalone arcade simulation. Construct once, call update once per simulation frame,
 * use nearest/enter/exit for interaction and hide the player while `active` is set.
 *
 * The surface callback supplies traction only, not height: road and water level are y=0.
 * Dismount positions are at the vehicle's current base height; adjust for the player
 * controller's capsule/origin and validate safe landing as appropriate. Helicopters use
 * throttle both for forward power and lift (positive climbs, negative descends, neutral
 * hovers); lift is bounded to y=0..32. A boat is automatically placed on nearby water
 * on the first update if its original spawn is on land.
 *
 * The scene is queried for visible obstacle meshes. Mark visual-only geometry or an
 * ancestor `userData.noVehicleCollision = true` to exclude it. Obstacles added after
 * construction are picked up automatically; moving vehicle impacts are handled separately.
 */
export class VehicleSystem {
  readonly vehicles: Vehicle[] = []
  active: Vehicle | null = null
  private readonly parts = new Map<Vehicle, VehicleParts>()
  private readonly particles: Particle[] = []
  private readonly particleGeometry = new THREE.IcosahedronGeometry(1, 0)
  private readonly raycaster = new THREE.Raycaster()
  private readonly scratchForward = new THREE.Vector3()
  private readonly scratchRight = new THREE.Vector3()
  private readonly scratchDirection = new THREE.Vector3()
  private readonly scratchOrigin = new THREE.Vector3()
  private obstacles: THREE.Object3D[] = []
  private obstacleRefresh = 0
  private placedBoat = false
  private boatSpawn: THREE.Vector3 | null = null
  private time = 0

  constructor(private readonly scene: THREE.Scene) {
    this.addVehicle('car', 'Coastline Sedan', '#f5c84c', 4.6, 16.5, -0.1, CAR)
    this.addVehicle('sport', 'Neon Sport', '#ee518d', -4.8, 17.5, 0.15, SPORT)
    this.addVehicle('motorbike', 'Street Bike', '#45d5e4', 0.0, 23.5, 0, BIKE)
    this.addVehicle('truck', 'Utility Truck', '#e59243', 10.5, 20.0, 0, TRUCK)
    this.addVehicle('muscle', 'Night Cruiser', '#b76bea', -70, -15, 0, MUSCLE)
    this.addVehicle('car', 'Palm Sedan', '#61d8c2', 32, -24, -Math.PI / 2, CAR)
    this.addVehicle('sport', 'Sunset Sport', '#f16c52', 44, 18, Math.PI, SPORT)
    this.addVehicle('motorbike', 'Dock Bike', '#f4c545', -34, 34, Math.PI / 2, BIKE)
    this.addVehicle('boat', 'Bay Runner', '#4bbad3', 95, 0, Math.PI, BOAT)
    this.addVehicle('helicopter', 'Bay Helicopter', '#d9e3df', 16, 29, 0, HELI)
  }

  /** Only usable vehicles are offered for entry; an occupied wreck can still be exited. */
  nearest(position: THREE.Vector3, maxDistance = 6): Vehicle | null {
    if (Number.isNaN(maxDistance) || maxDistance < 0) return null
    let best: Vehicle | null = null
    let bestDistance = maxDistance * maxDistance
    for (const vehicle of this.vehicles) {
      if (vehicle.health <= 0) continue
      const distance = vehicle.root.position.distanceToSquared(position)
      if (distance <= bestDistance) {
        bestDistance = distance
        best = vehicle
      }
    }
    return best
  }

  /** Wrecks cannot be entered. Switching vehicles leaves the old one to coast to a stop. */
  enter(vehicle: Vehicle): void {
    if (this.parts.has(vehicle) && vehicle.health > 0) this.active = vehicle
  }

  /** Exit on the right-hand side. The caller owns player visibility and teleportation. */
  exit(): THREE.Vector3 | null {
    const vehicle = this.active
    if (!vehicle) return null
    const data = this.parts.get(vehicle)!
    this.active = null
    const right = new THREE.Vector3(Math.cos(vehicle.heading), 0, -Math.sin(vehicle.heading))
    return vehicle.root.position.clone().addScaledVector(right, data.handling.width + 1.0)
  }

  update(dt: number, input: VehicleInput, surfaceAt: (x: number, z: number) => VehicleSurface): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    // Large tab-resume deltas are deliberately capped; substeps prevent tunnelling and
    // keep steering, drag, particles and impacts consistent at different frame rates.
    let remaining = Math.min(dt, 0.25)
    if (!this.placedBoat) {
      this.placeBoat(surfaceAt)
      this.placedBoat = true
    }
    this.obstacleRefresh -= remaining
    if (this.obstacleRefresh <= 0) {
      this.refreshObstacles()
      this.obstacleRefresh = 1
    }
    this.scene.updateMatrixWorld(true)
    const control: VehicleInput = {
      throttle: clamp(Number.isFinite(input.throttle) ? input.throttle : 0, -1, 1),
      steer: clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1),
      handbrake: Boolean(input.handbrake),
    }
    while (remaining > 1e-7) {
      const step = Math.min(remaining, 1 / 30)
      this.time += step
      for (const vehicle of this.vehicles) {
        const data = this.parts.get(vehicle)
        if (!data) continue
        data.impactCooldown = Math.max(0, data.impactCooldown - step)
        const surface = surfaceAt(vehicle.root.position.x, vehicle.root.position.z)
        this.stepVehicle(vehicle, data, step, vehicle === this.active ? control : NO_INPUT, surface)
        this.animateVehicle(vehicle, data, step, surface, vehicle === this.active ? control : NO_INPUT)
        this.emitDamage(vehicle, data, step)
      }
      this.stepParticles(step)
      remaining -= step
    }
  }

  damage(vehicle: Vehicle, amount: number): void {
    const data = this.parts.get(vehicle)
    if (!data || !Number.isFinite(amount) || amount <= 0) return
    vehicle.health = clamp(vehicle.health - amount, 0, 100)
    data.paint.color.copy(data.paintColor).multiplyScalar(0.46 + 0.54 * vehicle.health / 100)
    // Components genuinely detach and tumble away rather than just changing color.
    const stage = vehicle.health <= 25 ? 2 : vehicle.health <= 55 ? 1 : 0
    while (data.damageStage < stage) {
      const panel = data.panels[data.damageStage]
      if (panel) this.breakOff(vehicle, panel)
      data.damageStage += 1
    }
  }

  private addVehicle(type: string, name: string, color: string, x: number, z: number, heading: number, handling: Handling): void {
    const root = new THREE.Group()
    root.name = `vehicle:${name}`
    root.userData.vehicleRoot = true
    root.position.set(x, GROUND_Y, z)
    root.rotation.y = heading
    const model = new THREE.Group()
    model.rotation.order = 'YXZ'
    root.add(model)
    const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.38 })
    const brakeLight = new THREE.MeshStandardMaterial({ color: '#ef273b', emissive: '#ef273b', emissiveIntensity: 1.4, roughness: 0.25 })
    const parts: VehicleParts = {
      model, paint, paintColor: paint.color.clone(), brakeLight, handling,
      wheels: [], rotor: null, tailRotor: null, panels: [], wheelAngle: 0, steerAngle: 0,
      previousSpeed: 0, smokeTimer: 0, fireTimer: 0, impactCooldown: 0, damageStage: 0,
      phase: Math.random() * Math.PI * 2,
    }
    const vehicle: Vehicle = { root, type, name, speed: 0, health: 100, heading, velocity: new THREE.Vector3() }
    if (type === 'motorbike') this.buildBike(parts)
    else if (type === 'truck') this.buildTruck(parts)
    else if (type === 'boat') this.buildBoat(parts)
    else if (type === 'helicopter') this.buildHelicopter(parts)
    else this.buildCar(parts, type)
    root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    this.vehicles.push(vehicle)
    this.parts.set(vehicle, parts)
    this.scene.add(root)
    if (type === 'boat') this.boatSpawn = root.position.clone()
  }

  private stepVehicle(v: Vehicle, data: VehicleParts, dt: number, input: VehicleInput, surface: VehicleSurface): void {
    const h = data.handling
    const helicopter = v.type === 'helicopter'
    const boat = v.type === 'boat'
    const inWater = surface === 'water'
    let power = 1
    let speedLimit = h.maxSpeed
    let grip = h.grip
    if (boat) {
      if (!inWater) { power = 0.18; speedLimit = 3; grip = 4 }
    } else if (!helicopter) {
      if (surface === 'wet') grip *= 0.48
      else if (surface === 'sand') { grip *= 0.57; power *= 0.66; speedLimit *= 0.65 }
      else if (surface === 'dirt') { grip *= 0.7; power *= 0.82; speedLimit *= 0.82 }
      else if (inWater) { grip *= 0.28; power *= 0.2; speedLimit = 4 }
    }
    if (input.handbrake && !helicopter) grip *= 0.19
    if (v.health <= 0) power = 0
    else if (v.health < 25) power *= 0.55

    this.scratchForward.set(-Math.sin(v.heading), 0, -Math.cos(v.heading))
    let longitudinal = v.velocity.dot(this.scratchForward)
    const forwardSign = longitudinal < -0.15 ? -1 : 1
    const turnSpeed = helicopter
      ? h.turn * (0.65 + 0.35 * Math.min(1, Math.abs(longitudinal) / 10))
      : h.turn * Math.min(1, Math.abs(longitudinal) / 5) / (1 + Math.abs(longitudinal) * 0.035)
    const driftTurn = input.handbrake && !helicopter ? 1.25 : 1
    v.heading -= input.steer * turnSpeed * (helicopter ? 1 : forwardSign) * driftTurn * dt
    v.heading = Math.atan2(Math.sin(v.heading), Math.cos(v.heading))
    v.root.rotation.y = v.heading
    this.scratchForward.set(-Math.sin(v.heading), 0, -Math.cos(v.heading))
    this.scratchRight.set(Math.cos(v.heading), 0, -Math.sin(v.heading))
    longitudinal = v.velocity.dot(this.scratchForward)
    let lateral = v.velocity.dot(this.scratchRight)

    const throttle = v.health > 0 ? input.throttle : 0
    const braking = (throttle > 0.02 && longitudinal < -0.4) || (throttle < -0.02 && longitudinal > 0.4)
    const acceleration = braking ? h.brake : h.acceleration * power
    longitudinal += throttle * acceleration * dt
    // Rolling and air drag, with extra resistance in soft ground / on land for boats.
    const drag = boat && !inWater ? 1.5 : !boat && !helicopter && inWater ? 1.05 : helicopter ? 0.18 : boat ? 0.2 : 0.14
    longitudinal *= Math.exp(-drag * dt)
    if (Math.abs(throttle) < 0.01 && !helicopter) {
      const resistance = (boat ? 0.8 : 1.4) * dt
      longitudinal = Math.sign(longitudinal) * Math.max(0, Math.abs(longitudinal) - resistance)
    }
    if (input.handbrake && !helicopter) longitudinal *= Math.exp(-1.5 * dt)
    longitudinal = clamp(longitudinal, -Math.min(h.reverse, speedLimit), speedLimit)
    lateral *= Math.exp(-grip * dt)
    v.velocity.x = this.scratchForward.x * longitudinal + this.scratchRight.x * lateral
    v.velocity.z = this.scratchForward.z * longitudinal + this.scratchRight.z * lateral

    if (helicopter) {
      const desiredLift = v === this.active && v.health > 0 ? throttle * 6 : -3
      v.velocity.y = damp(v.velocity.y, desiredLift, 3, dt)
      v.root.position.y = clamp(v.root.position.y + v.velocity.y * dt, GROUND_Y, HELICOPTER_CEILING)
      if ((v.root.position.y <= GROUND_Y && v.velocity.y < 0) || (v.root.position.y >= HELICOPTER_CEILING && v.velocity.y > 0)) v.velocity.y = 0
    } else if (v.root.position.y > GROUND_Y || v.velocity.y > 0) {
      v.velocity.y -= 16 * dt
      v.root.position.y = Math.max(GROUND_Y, v.root.position.y + v.velocity.y * dt)
      if (v.root.position.y <= GROUND_Y && v.velocity.y < 0) v.velocity.y = 0
    } else {
      v.root.position.y = GROUND_Y
      v.velocity.y = 0
    }

    const dx = v.velocity.x * dt
    const dz = v.velocity.z * dt
    const distance = Math.hypot(dx, dz)
    if (distance > 1e-5) {
      this.scratchDirection.set(dx / distance, 0, dz / distance)
      const allowed = this.sweepWorld(v, h, this.scratchDirection, distance)
      v.root.position.x += this.scratchDirection.x * allowed
      v.root.position.z += this.scratchDirection.z * allowed
      if (allowed < distance - 1e-4) {
        const impact = Math.hypot(v.velocity.x, v.velocity.z)
        v.velocity.x *= -0.12
        v.velocity.z *= -0.12
        if (impact > 3 && data.impactCooldown <= 0) {
          this.damage(v, (impact - 3) * 1.8)
          data.impactCooldown = 0.6
        }
      }
      this.collideVehicles(v, data)
    }
    v.speed = v.velocity.x * this.scratchForward.x + v.velocity.z * this.scratchForward.z
  }

  private sweepWorld(v: Vehicle, h: Handling, direction: THREE.Vector3, distance: number): number {
    if (!this.obstacles.length) return distance
    const forward = this.scratchForward
    const right = this.scratchRight
    const nose = Math.abs(direction.dot(forward)) * h.length + Math.abs(direction.dot(right)) * h.width
    const sideX = -direction.z
    const sideZ = direction.x
    const sideExtent = (Math.abs(sideX * forward.x + sideZ * forward.z) * h.length + Math.abs(sideX * right.x + sideZ * right.z) * h.width) * 0.72
    let allowed = distance
    this.raycaster.near = 0
    this.raycaster.far = distance + nose + 0.08
    // A horizontal sweep from three points detects thin buildings and posts without
    // treating the road or water plane as a wall.
    for (const side of [-1, 0, 1]) {
      this.scratchOrigin.set(v.root.position.x + sideX * sideExtent * side, v.root.position.y + (v.type === 'helicopter' ? 1.2 : 0.65), v.root.position.z + sideZ * sideExtent * side)
      this.raycaster.set(this.scratchOrigin, direction)
      const hits = this.raycaster.intersectObjects(this.obstacles, false)
      const hit = hits.find(intersection => this.isObstacle(intersection.object))
      if (hit) allowed = Math.min(allowed, Math.max(0, hit.distance - nose - 0.05))
    }
    return allowed
  }

  private collideVehicles(v: Vehicle, data: VehicleParts): void {
    for (const other of this.vehicles) {
      if (other === v || Math.abs(v.root.position.y - other.root.position.y) > 2.5) continue
      const otherData = this.parts.get(other)
      if (!otherData) continue
      let dx = v.root.position.x - other.root.position.x
      let dz = v.root.position.z - other.root.position.z
      let distance = Math.hypot(dx, dz)
      const min = data.handling.radius + otherData.handling.radius
      if (distance >= min) continue
      if (distance < 0.0001) { dx = 1; dz = 0; distance = 1 }
      const nx = dx / distance
      const nz = dz / distance
      const closing = (other.velocity.x - v.velocity.x) * nx + (other.velocity.z - v.velocity.z) * nz
      const penetration = Math.max(0, min - distance)
      v.root.position.x += nx * penetration
      v.root.position.z += nz * penetration
      if (closing > 0) {
        const impulse = closing * 0.58
        v.velocity.x += nx * impulse
        v.velocity.z += nz * impulse
        other.velocity.x -= nx * impulse * 0.45
        other.velocity.z -= nz * impulse * 0.45
        if (closing > 3 && data.impactCooldown <= 0 && otherData.impactCooldown <= 0) {
          this.damage(v, (closing - 3) * 1.5)
          this.damage(other, (closing - 3) * 1.2)
          data.impactCooldown = otherData.impactCooldown = 0.6
        }
      }
    }
  }

  private animateVehicle(v: Vehicle, data: VehicleParts, dt: number, surface: VehicleSurface, input: VehicleInput): void {
    const speedRatio = clamp(Math.abs(v.speed) / data.handling.maxSpeed, 0, 1)
    const accel = clamp((v.speed - data.previousSpeed) / Math.max(dt, 0.001), -25, 25)
    data.previousSpeed = v.speed
    data.steerAngle = damp(data.steerAngle, input.steer * 0.48, 7, dt)
    const lean = v.type === 'motorbike' ? -input.steer * speedRatio * 0.42 : -input.steer * speedRatio * 0.10
    const pitch = clamp(accel * 0.007, -0.12, 0.12)
    data.model.rotation.z = damp(data.model.rotation.z, lean, 5, dt)
    data.model.rotation.x = damp(data.model.rotation.x, pitch + (v.type === 'helicopter' ? -speedRatio * 0.14 : 0), 5, dt)
    const rough = surface === 'dirt' || surface === 'sand' ? 0.035 : 0.012
    const bob = v.type === 'boat' && surface === 'water' ? Math.sin(this.time * 2 + data.phase) * 0.08 : Math.sin(this.time * 12 + data.phase) * rough * speedRatio
    data.model.position.y = damp(data.model.position.y, bob, 8, dt)
    for (const wheel of data.wheels) {
      wheel.spin.rotation.x -= v.speed * dt / wheel.radius
      if (wheel.steering) wheel.steering.rotation.y = -data.steerAngle
    }
    if (data.rotor) data.rotor.rotation.y += dt * (v === this.active ? 26 : v.root.position.y > 0.1 ? 16 : 3)
    if (data.tailRotor) data.tailRotor.rotation.x += dt * (v === this.active ? 38 : 5)
    const braking = input.handbrake || (input.throttle < -0.05 && v.speed > 0.5) || (input.throttle > 0.05 && v.speed < -0.5)
    data.brakeLight.emissiveIntensity = braking ? 3.5 : 1.4
  }

  private refreshObstacles(): void {
    const objects: THREE.Object3D[] = []
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh && this.isObstacle(object)) objects.push(object)
    })
    this.obstacles = objects
  }

  private isObstacle(object: THREE.Object3D): boolean {
    let node: THREE.Object3D | null = object
    while (node && node !== this.scene) {
      if (!node.visible || node.userData.vehicleRoot || node.userData.noVehicleCollision || node.userData.vehicleEffect) return false
      node = node.parent
    }
    if (!(object instanceof THREE.Mesh)) return false
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    return materials.some(material => material.visible && (!material.transparent || material.opacity > 0.35))
  }

  private placeBoat(surfaceAt: (x: number, z: number) => VehicleSurface): void {
    const boat = this.vehicles.find(v => v.type === 'boat')
    // Respect a caller's explicit repositioning before the first update.
    if (boat && this.boatSpawn && boat.root.position.distanceToSquared(this.boatSpawn) > 0.0001) return
    if (!boat || surfaceAt(boat.root.position.x, boat.root.position.z) === 'water') return
    // Find a nearby water sample without assuming which side of the map is the bay.
    const x = boat.root.position.x
    const z = boat.root.position.z
    for (let radius = 8; radius <= 160; radius += 8) {
      for (let i = 0; i < 24; i += 1) {
        const angle = i * Math.PI / 12
        const px = x + Math.cos(angle) * radius
        const pz = z + Math.sin(angle) * radius
        if (surfaceAt(px, pz) === 'water') {
          boat.root.position.set(px, GROUND_Y, pz)
          return
        }
      }
    }
  }

  private emitDamage(v: Vehicle, data: VehicleParts, dt: number): void {
    if (v.health < 65) {
      data.smokeTimer += dt * (v.health < 25 ? 8 : 4)
      while (data.smokeTimer >= 1) { data.smokeTimer -= 1; this.emitParticle(v, false) }
    }
    if (v.health < 25) {
      data.fireTimer += dt * 9
      while (data.fireTimer >= 1) { data.fireTimer -= 1; this.emitParticle(v, true) }
    }
  }

  private emitParticle(v: Vehicle, fire: boolean): void {
    if (this.particles.length >= PARTICLE_LIMIT) return
    const material = new THREE.MeshBasicMaterial({ color: fire ? (Math.random() < 0.5 ? '#ffbb33' : '#ff5422') : '#393d44', transparent: true, opacity: fire ? 0.88 : 0.58, depthWrite: false })
    const mesh = new THREE.Mesh(this.particleGeometry, material)
    mesh.userData.vehicleEffect = true
    const forward = new THREE.Vector3(-Math.sin(v.heading), 0, -Math.cos(v.heading))
    const offset = v.type === 'boat' ? 0.2 : 1
    mesh.position.copy(v.root.position).addScaledVector(forward, offset)
    mesh.position.y += v.type === 'helicopter' ? 1.7 : 1.05
    mesh.position.x += (Math.random() - 0.5) * 0.45
    mesh.position.z += (Math.random() - 0.5) * 0.45
    const size = fire ? 0.22 : 0.28
    mesh.scale.setScalar(size)
    this.scene.add(mesh)
    this.particles.push({ mesh, velocity: new THREE.Vector3(v.velocity.x * 0.15 + (Math.random() - 0.5) * 0.5, fire ? 1.5 : 1.0, v.velocity.z * 0.15 + (Math.random() - 0.5) * 0.5), age: 0, life: fire ? 0.55 : 1.8, baseSize: size, gravity: fire ? 0.5 : 0.2, spin: new THREE.Vector3(), disposableMaterial: true })
  }

  private breakOff(v: Vehicle, panel: THREE.Object3D): void {
    if (!panel.visible) return
    v.root.updateWorldMatrix(true, true)
    const debris = panel.clone() as THREE.Mesh
    panel.getWorldPosition(debris.position)
    panel.getWorldQuaternion(debris.quaternion)
    panel.getWorldScale(debris.scale)
    panel.visible = false
    debris.userData.vehicleEffect = true
    this.scene.add(debris)
    if (this.particles.length >= PARTICLE_LIMIT) { this.scene.remove(debris); return }
    const side = Math.random() < 0.5 ? -1 : 1
    this.particles.push({ mesh: debris, velocity: new THREE.Vector3(v.velocity.x * 0.5 + side * 2, 3 + Math.random() * 2, v.velocity.z * 0.5 + (Math.random() - 0.5) * 3), age: 0, life: 3.5, baseSize: 1, gravity: -9.8, spin: new THREE.Vector3(2 + Math.random() * 3, 3, side * 3), disposableMaterial: false })
  }

  private stepParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i]
      p.age += dt
      if (p.age >= p.life) {
        this.scene.remove(p.mesh)
        if (p.disposableMaterial) (p.mesh.material as THREE.Material).dispose()
        this.particles.splice(i, 1)
        continue
      }
      p.velocity.y += p.gravity * dt
      p.mesh.position.addScaledVector(p.velocity, dt)
      p.mesh.rotation.x += p.spin.x * dt
      p.mesh.rotation.y += p.spin.y * dt
      p.mesh.rotation.z += p.spin.z * dt
      if (p.disposableMaterial) {
        const t = p.age / p.life
        p.mesh.scale.setScalar(p.baseSize * (1 + t * 2.4))
        ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.65
      } else {
        if (p.mesh.position.y < 0.12) {
          p.mesh.position.y = 0.12
          p.velocity.y = Math.abs(p.velocity.y) * 0.28
          p.velocity.x *= 0.88
          p.velocity.z *= 0.88
        }
        if (p.age > p.life - 0.5) p.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 2))
      }
    }
  }

  private buildCar(data: VehicleParts, variant: string): void {
    const body = data.model
    const dark = standard('#202636', 0.55, 0.35)
    const glass = standard('#4d899c', 0.25, 0.35)
    const chrome = standard('#c9d7da', 0.28, 0.8)
    const low = variant === 'sport'
    const wide = variant === 'muscle'
    const length = wide ? 4.35 : 4.15
    const width = wide ? 2.08 : 2.0
    box(body, width, low ? 0.52 : 0.65, length, 0, low ? 0.66 : 0.73, 0, data.paint)
    box(body, width * 0.92, 0.18, length * 0.97, 0, 0.42, 0, dark)
    const hood = box(body, width * 0.92, 0.12, 1.10, 0, low ? 0.99 : 1.11, -1.38, data.paint)
    data.panels.push(hood)
    const roofY = low ? 1.30 : 1.48
    box(body, width * 0.78, low ? 0.48 : 0.62, 1.93, 0, roofY, 0.17, glass)
    box(body, width * 0.81, 0.12, 1.75, 0, roofY + (low ? 0.26 : 0.33), 0.2, data.paint)
    box(body, 0.08, low ? 0.5 : 0.62, 1.92, -width * 0.34, roofY, 0.17, dark)
    box(body, 0.08, low ? 0.5 : 0.62, 1.92, width * 0.34, roofY, 0.17, dark)
    const panel = box(body, 0.06, 0.38, 1.35, width / 2 + 0.01, 0.77, 0.25, data.paint)
    data.panels.push(panel)
    box(body, width, 0.16, 0.12, 0, 0.48, -length / 2 - 0.01, chrome)
    box(body, width, 0.16, 0.12, 0, 0.48, length / 2 + 0.01, chrome)
    this.lights(body, width, length / 2, 0.83, data.brakeLight)
    for (const x of [-width / 2, width / 2]) for (const z of [-1.27, 1.3]) this.addWheel(data, x, 0.42, z, 0.42, z < 0)
    if (low) {
      box(body, width * 0.95, 0.09, 0.33, 0, 1.32, 1.84, dark)
      box(body, 0.12, 0.34, 0.18, -0.72, 1.15, 1.84, dark)
      box(body, 0.12, 0.34, 0.18, 0.72, 1.15, 1.84, dark)
    }
    if (wide) {
      box(body, 0.18, 0.025, 1.22, -0.3, 1.19, -1.35, chrome)
      box(body, 0.18, 0.025, 1.22, 0.3, 1.19, -1.35, chrome)
    }
  }

  private buildTruck(data: VehicleParts): void {
    const body = data.model
    const dark = standard('#262a31', 0.7, 0.2)
    const glass = standard('#56889a', 0.25, 0.3)
    const chrome = standard('#b6c3c8', 0.35, 0.7)
    box(body, 2.28, 0.5, 5.4, 0, 0.67, 0, dark)
    box(body, 2.22, 1.0, 2.16, 0, 1.05, -1.53, data.paint)
    box(body, 2.04, 0.85, 1.28, 0, 1.82, -1.47, glass)
    box(body, 2.16, 0.14, 1.5, 0, 2.27, -1.47, data.paint)
    box(body, 2.2, 0.22, 2.7, 0, 0.91, 1.20, data.paint)
    const left = box(body, 0.18, 0.9, 2.7, -1.02, 1.42, 1.2, data.paint)
    const right = box(body, 0.18, 0.9, 2.7, 1.02, 1.42, 1.2, data.paint)
    box(body, 2.04, 0.8, 0.16, 0, 1.37, 2.5, data.paint)
    data.panels.push(right, left)
    box(body, 2.34, 0.2, 0.13, 0, 0.55, -2.75, chrome)
    box(body, 1.05, 0.35, 0.09, 0, 1.02, -2.65, dark)
    this.lights(body, 2.16, 2.7, 1.16, data.brakeLight)
    for (const x of [-1.12, 1.12]) for (const z of [-1.75, 1.65]) this.addWheel(data, x, 0.51, z, 0.51, z < 0)
  }

  private buildBike(data: VehicleParts): void {
    const body = data.model
    const dark = standard('#242732', 0.65, 0.2)
    const metal = standard('#becbd0', 0.3, 0.75)
    for (const z of [-1.05, 1.05]) this.addWheel(data, 0, 0.43, z, 0.43, z < 0)
    bar(body, new THREE.Vector3(0, 0.55, 1.05), new THREE.Vector3(0, 1.05, 0), 0.07, metal)
    bar(body, new THREE.Vector3(0, 1.05, 0), new THREE.Vector3(0, 0.58, -1.05), 0.07, metal)
    bar(body, new THREE.Vector3(0, 0.55, 1.05), new THREE.Vector3(0, 0.58, -1.05), 0.07, metal)
    box(body, 0.5, 0.4, 0.6, 0, 0.76, 0.05, metal)
    const tank = box(body, 0.56, 0.38, 0.8, 0, 1.18, -0.27, data.paint)
    data.panels.push(tank)
    const seat = box(body, 0.45, 0.16, 0.75, 0, 1.19, 0.58, dark)
    data.panels.push(seat)
    bar(body, new THREE.Vector3(0, 0.5, -1.05), new THREE.Vector3(0, 1.42, -0.75), 0.065, metal)
    box(body, 1.05, 0.07, 0.07, 0, 1.43, -0.75, metal)
    box(body, 0.43, 0.24, 0.12, 0, 1.12, -1.11, lamp('#fff2b2'))
    box(body, 0.34, 0.12, 0.1, 0, 1.03, 1.14, data.brakeLight)
  }

  private buildBoat(data: VehicleParts): void {
    const body = data.model
    const dark = standard('#253746', 0.55, 0.3)
    const white = standard('#f1ece0', 0.55, 0.05)
    const glass = standard('#77c3d6', 0.2, 0.25)
    const outline = [[-1, 1.75], [1, 1.75], [1, -0.85], [0.7, -1.65], [0, -2.35], [-0.7, -1.65], [-1, -0.85]]
    const vertices: number[] = []
    for (const [x, z] of outline) vertices.push(x, 0.72, z)
    for (const [x, z] of outline) vertices.push(x * 0.68, 0.13, z * 0.83)
    const indices: number[] = []
    for (let i = 1; i < outline.length - 1; i += 1) indices.push(0, i, i + 1, outline.length, outline.length + i + 1, outline.length + i)
    for (let i = 0; i < outline.length; i += 1) {
      const j = (i + 1) % outline.length
      indices.push(i, outline.length + j, j, i, outline.length + i, outline.length + j)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const hull = new THREE.Mesh(geometry, data.paint)
    body.add(hull)
    box(body, 1.65, 0.12, 2.75, 0, 0.75, 0.18, white)
    box(body, 1.32, 0.38, 0.15, 0, 1.05, -0.55, glass)
    box(body, 1.3, 0.35, 0.65, 0, 1.02, 0.55, dark)
    const seat = box(body, 1.35, 0.22, 0.45, 0, 1.25, 0.85, white)
    data.panels.push(seat)
    const motor = box(body, 0.55, 0.7, 0.48, 0, 0.65, 1.95, dark)
    data.panels.push(motor)
    box(body, 0.18, 0.12, 0.13, -0.85, 0.82, -1.3, lamp('#ff3b58'))
    box(body, 0.18, 0.12, 0.13, 0.85, 0.82, -1.3, lamp('#7dffb8'))
    box(body, 0.4, 0.12, 0.1, 0, 0.95, 1.76, data.brakeLight)
  }

  private buildHelicopter(data: VehicleParts): void {
    const body = data.model
    const dark = standard('#253743', 0.45, 0.35)
    const glass = standard('#4b9fb6', 0.19, 0.4)
    const metal = standard('#bdc9c8', 0.35, 0.75)
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), data.paint)
    shell.scale.set(1.12, 0.95, 1.76)
    shell.position.set(0, 1.65, 0)
    body.add(shell)
    const windshield = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glass)
    windshield.scale.set(0.94, 0.65, 0.82)
    windshield.position.set(0, 1.83, -1.07)
    body.add(windshield)
    const door = box(body, 0.06, 1.0, 1.05, 1.09, 1.6, 0.22, glass)
    data.panels.push(door)
    const tail = bar(body, new THREE.Vector3(0, 1.75, 1.15), new THREE.Vector3(0, 2.1, 4.45), 0.18, data.paint)
    data.panels.push(tail)
    box(body, 0.14, 0.9, 0.6, 0, 2.34, 4.2, data.paint)
    for (const x of [-0.95, 0.95]) {
      bar(body, new THREE.Vector3(x, 0.18, -1.48), new THREE.Vector3(x, 0.18, 1.55), 0.07, metal)
      bar(body, new THREE.Vector3(x, 0.18, -0.65), new THREE.Vector3(x * 0.7, 0.92, -0.5), 0.055, metal)
      bar(body, new THREE.Vector3(x, 0.18, 0.9), new THREE.Vector3(x * 0.7, 0.92, 0.7), 0.055, metal)
    }
    bar(body, new THREE.Vector3(0, 2.45, 0), new THREE.Vector3(0, 2.95, 0), 0.09, metal)
    const rotor = new THREE.Group()
    rotor.position.set(0, 2.97, 0)
    box(rotor, 6.5, 0.055, 0.22, 0, 0, 0, dark)
    box(rotor, 0.22, 0.055, 6.5, 0, 0.025, 0, dark)
    body.add(rotor)
    data.rotor = rotor
    const tailRotor = new THREE.Group()
    tailRotor.position.set(0.22, 2.2, 4.2)
    box(tailRotor, 0.06, 1.5, 0.14, 0, 0, 0, dark)
    box(tailRotor, 0.06, 0.14, 1.5, 0, 0, 0, dark)
    body.add(tailRotor)
    data.tailRotor = tailRotor
    box(body, 0.24, 0.17, 0.1, 0, 1.25, -1.73, lamp('#fff2be'))
    box(body, 0.3, 0.12, 0.1, 0, 2.4, 4.45, data.brakeLight)
  }

  private addWheel(data: VehicleParts, x: number, y: number, z: number, radius: number, front: boolean): void {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, z)
    const spin = new THREE.Group()
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.30, 14), standard('#171b22', 0.92, 0.05))
    tire.rotation.z = Math.PI / 2
    spin.add(tire)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.53, radius * 0.53, 0.32, 10), standard('#bbc7cd', 0.32, 0.75))
    hub.rotation.z = Math.PI / 2
    spin.add(hub)
    // A small dark spoke makes rotation apparent even at low speed.
    const spoke = box(spin, 0.34, radius * 0.12, radius * 0.75, 0, 0, 0, standard('#323b43', 0.5, 0.6))
    spoke.position.x = 0.17
    pivot.add(spin)
    data.model.add(pivot)
    data.wheels.push({ spin, steering: front ? pivot : null, radius })
  }

  private lights(body: THREE.Group, width: number, halfLength: number, y: number, brake: THREE.MeshStandardMaterial): void {
    const head = lamp('#fff1bc')
    for (const x of [-width * 0.33, width * 0.33]) {
      box(body, width * 0.22, 0.16, 0.08, x, y, -halfLength - 0.045, head)
      box(body, width * 0.22, 0.14, 0.08, x, y, halfLength + 0.045, brake)
    }
  }
}

function standard(color: string, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function lamp(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, roughness: 0.25 })
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

function bar(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const delta = to.clone().sub(from)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material)
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(UP, delta.normalize())
  parent.add(mesh)
  return mesh
}
