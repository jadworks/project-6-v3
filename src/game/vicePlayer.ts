import * as THREE from 'three'
import { CONFIG } from './config'
import { tuning } from './tuning'

const material = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.88 })

export class VicePlayer {
  readonly root = new THREE.Group()
  readonly velocity = new THREE.Vector3()
  private readonly torso = new THREE.Group()
  private readonly leftArm: THREE.Mesh
  private readonly rightArm: THREE.Mesh
  private readonly leftLeg: THREE.Mesh
  private readonly rightLeg: THREE.Mesh
  private vertical = 0
  private gait = 0
  private hitTime = 0
  private grounded = true
  upgrade = 0

  constructor(spawn: THREE.Vector3) {
    this.root.position.copy(spawn)
    const skin = material(0xb8795d), shirt = material(0x49b9be), trousers = material(0x222944), hair = material(0x211916)
    const jacket = material(0x17263d), sidearm = material(0x16191f)
    const mesh = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      part.position.set(x, y, z); part.castShadow = true; return part
    }
    this.root.add(this.torso)
    this.torso.add(mesh(.74, .83, .4, shirt, 0, 1.48, 0))
    this.torso.add(mesh(.84, .12, .44, jacket, 0, 1.88, 0))
    this.torso.add(mesh(.48, .53, .43, skin, 0, 2.2, 0))
    this.torso.add(mesh(.5, .16, .45, hair, 0, 2.49, .02))
    this.torso.add(mesh(.33, .1, .045, material(0x1b1722), 0, 2.23, -.238))
    this.leftArm = mesh(.2, .78, .23, skin, -.49, 1.47, 0)
    this.rightArm = mesh(.2, .78, .23, skin, .49, 1.47, 0)
    this.leftLeg = mesh(.28, .82, .3, trousers, -.19, .47, 0)
    this.rightLeg = mesh(.28, .82, .3, trousers, .19, .47, 0)
    const pistol = new THREE.Group()
    pistol.position.set(.52, 1.23, -.13)
    pistol.rotation.set(-.2, 0, -.08)
    pistol.add(mesh(.11, .16, .42, sidearm, 0, 0, -.16))
    pistol.add(mesh(.12, .25, .12, sidearm, 0, -.17, -.02))
    this.torso.add(this.leftArm, this.rightArm, pistol)
    this.root.add(this.leftLeg, this.rightLeg)
  }

  update(dt: number, moveX: number, moveY: number, yaw: number, sprint: boolean, crouch: boolean, jump: boolean, swimming: boolean): void {
    const sx = Math.sin(yaw), cz = Math.cos(yaw)
    const dx = moveX * cz - moveY * sx
    const dz = -moveX * sx - moveY * cz
    const length = Math.hypot(dx, dz)
    const speed = swimming ? 3.2 : crouch ? 2.6 : sprint ? CONFIG.player.sprintSpeed + this.upgrade : CONFIG.player.walkSpeed
    const desiredX = length > .01 ? dx / Math.max(1, length) * speed : 0
    const desiredZ = length > .01 ? dz / Math.max(1, length) * speed : 0
    const blend = 1 - Math.exp(-Math.max(4, CONFIG.player.acceleration / 5) * (this.grounded ? 1 : CONFIG.player.airControl) * dt)
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, desiredX, blend)
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, desiredZ, blend)
    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x + this.velocity.x * dt, -378, 368)
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z + this.velocity.z * dt, -378, 378)
    if (length > .05 && this.hitTime <= 0) {
      const target = Math.atan2(-dx, -dz)
      this.root.rotation.y += Math.atan2(Math.sin(target - this.root.rotation.y), Math.cos(target - this.root.rotation.y)) * Math.min(1, dt * 12)
    }
    if (jump && this.grounded && !swimming) { tuning.activate('jump'); this.vertical = CONFIG.player.jumpSpeed * .65; this.grounded = false }
    this.vertical -= 18 * dt
    const floor = swimming ? -.75 : 0
    this.root.position.y += this.vertical * dt
    if (this.root.position.y <= floor) { this.root.position.y = floor; this.vertical = 0; this.grounded = true }
    this.gait += dt * (sprint ? 12 : 8) * Math.min(1, length)
    const swing = Math.sin(this.gait) * Math.min(.6, length * .6)
    this.leftLeg.rotation.x = swing; this.rightLeg.rotation.x = -swing
    this.leftArm.rotation.x = -swing * .7; this.rightArm.rotation.x = swing * .7
    this.torso.scale.y = crouch ? .72 : 1
    this.hitTime = Math.max(0, this.hitTime - dt)
    this.torso.rotation.z = this.hitTime > 0 ? Math.sin(this.hitTime * 18) * .18 : THREE.MathUtils.lerp(this.torso.rotation.z, 0, dt * 8)
  }

  stagger(direction: THREE.Vector3, force: number): void {
    this.hitTime = .6
    this.velocity.addScaledVector(direction, force)
    this.vertical = Math.min(5, force * .3)
    this.grounded = false
  }
}
