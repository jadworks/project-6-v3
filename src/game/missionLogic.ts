import * as THREE from 'three'

export type ContractId = 'intro' | 'race' | 'delivery' | 'stunt'
type Contract = { title: string; reward: number; instructions: string[]; points: [number, number][]; drive?: boolean; speed?: number }
const CONTRACTS: Record<ContractId, Contract> = {
  intro: { title: 'WELCOME TO VICE BAY', reward: 2500, instructions: ['Head north to the neon strip', 'Reach the downtown plaza'], points: [[0, -65], [-55, -125]] },
  race: { title: 'MIDNIGHT RUN', reward: 1800, instructions: ['Drive through the first checkpoint', 'Race to the waterfront', 'Finish at the strip'], points: [[0, -70], [0, 110], [0, 5]], drive: true },
  delivery: { title: 'DOCKSIDE DELIVERY', reward: 1200, instructions: ['Collect the package at the port', 'Deliver it to Palm House'], points: [[-30, 140], [-105, 85]] },
  stunt: { title: 'STUNT DRIVER', reward: 1500, instructions: ['Hit the waterfront ramp at speed'], points: [[28, 100]], drive: true, speed: 8 },
}

export class MissionDirector {
  current: ContractId | null = null
  objective = 'Explore Vice Bay or press ESC to choose a contract'
  private stage = 0
  private readonly marker: THREE.Group
  private elapsed = 0
  constructor(private readonly scene: THREE.Scene) {
    this.marker = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3, .17, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffe35e }))
    ring.rotation.x = Math.PI / 2; ring.position.y = .13
    const column = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.1, 5, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd943, transparent: true, opacity: .17, side: THREE.DoubleSide, depthWrite: false }))
    column.position.y = 2.5
    this.marker.add(ring, column); this.marker.visible = false; this.scene.add(this.marker)
  }
  start(id: string): string | null {
    if (!(id in CONTRACTS)) return null
    this.current = id as ContractId; this.stage = 0; this.elapsed = 0
    this.setTarget()
    return CONTRACTS[this.current].title
  }
  private setTarget(): void {
    if (!this.current) return
    const mission = CONTRACTS[this.current], point = mission.points[this.stage]
    this.marker.position.set(point[0], 0, point[1]); this.marker.visible = true
    this.objective = mission.instructions[this.stage]
  }
  update(dt: number, position: THREE.Vector3, inVehicle: boolean, speed: number, stuntJump = false): { title: string; reward: number; id: ContractId; seconds: number } | null {
    if (!this.current) return null
    this.elapsed += dt
    this.marker.rotation.y += dt * .6
    const mission = CONTRACTS[this.current], target = mission.points[this.stage]
    if (Math.hypot(position.x - target[0], position.z - target[1]) > 6 || (mission.drive && !inVehicle) || (mission.speed && (Math.abs(speed) < mission.speed || !stuntJump))) return null
    this.stage++
    if (this.stage < mission.points.length) { this.setTarget(); return null }
    const result = { title: mission.title, reward: mission.reward, id: this.current, seconds: this.elapsed }
    this.current = null; this.marker.visible = false; this.objective = 'Contract complete. Choose another in the pause menu.'
    return result
  }
  get target(): THREE.Vector3 | null { return this.current ? this.marker.position : null }
}
