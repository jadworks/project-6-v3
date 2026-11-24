import * as THREE from 'three'

/** Small deterministic textures keep the world independent of downloaded assets and the DOM. */
export function createSurfaceTexture(kind: 'asphalt' | 'sand' | 'wood'): THREE.DataTexture {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  let seed = kind === 'asphalt' ? 9187 : kind === 'sand' ? 4111 : 7193
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const n = random()
      let v = 225 + Math.floor(n * 28)
      if (kind === 'asphalt') v = 195 + Math.floor(n * 42) - (n > 0.985 ? 40 : 0)
      if (kind === 'sand') v = 222 + Math.floor(n * 30) - (n > 0.99 ? 24 : 0)
      if (kind === 'wood') {
        const plank = y % 32
        v = 219 + Math.floor(n * 18) - (plank < 2 ? 35 : 0) - (x % 64 < 2 && plank > 2 ? 15 : 0)
      }
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, v))
      data[i + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/** Canvas is only used for lettering; a solid fallback allows headless construction in tests. */
export function createSignTexture(text: string, background: string, foreground: string): THREE.Texture {
  if (typeof document === 'undefined') {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat)
    texture.needsUpdate = true
    return texture
  }
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = background
    context.fillRect(0, 0, 512, 128)
    context.strokeStyle = foreground
    context.lineWidth = 4
    context.strokeRect(6, 6, 500, 116)
    context.fillStyle = foreground
    context.font = 'bold 54px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, 256, 67, 475)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}
