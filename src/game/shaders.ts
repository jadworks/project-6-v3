import * as THREE from 'three'

export type FloatUniform = { value: number }
export type FacadeControls = { time: FloatUniform; night: FloatUniform; rain: FloatUniform }

/** Standard lighting and shadows are retained; windows are drawn in world-sized facade cells. */
export function createFacadeMaterial(): { material: THREE.MeshStandardMaterial; controls: FacadeControls } {
  const controls: FacadeControls = { time: { value: 0 }, night: { value: 0 }, rain: { value: 0 } }
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.02 })
  material.onBeforeCompile = shader => {
    shader.uniforms.uViceTime = controls.time
    shader.uniforms.uViceNight = controls.night
    shader.uniforms.uViceRain = controls.rain
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVicePosition;\nvarying vec3 vViceNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 vicePosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          vicePosition = instanceMatrix * vicePosition;
        #endif
        vVicePosition = vicePosition.xyz;
        vViceNormal = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vVicePosition;
        varying vec3 vViceNormal;
        uniform float uViceTime;
        uniform float uViceNight;
        uniform float uViceRain;
        float viceHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float viceSide = 1.0 - step(0.5, abs(vViceNormal.y));
        float viceAlong = abs(vViceNormal.x) > 0.5 ? vVicePosition.z : vVicePosition.x;
        vec2 viceGrid = vec2(viceAlong / 2.4, vVicePosition.y / 2.8);
        vec2 viceCell = fract(viceGrid);
        float viceWindow = viceSide * step(0.19, viceCell.x) * step(viceCell.x, 0.79)
          * step(0.24, viceCell.y) * step(viceCell.y, 0.78) * step(3.0, vVicePosition.y);
        float viceLit = step(0.34, viceHash(floor(viceGrid) + floor(vVicePosition.xz * 0.07)));
        vec3 viceGlass = mix(vec3(0.12, 0.27, 0.30), vec3(0.25, 0.43, 0.46), viceCell.y);
        viceGlass = mix(viceGlass, vec3(0.89, 0.60, 0.34), uViceNight * viceLit * 0.72);
        diffuseColor.rgb = mix(diffuseColor.rgb, viceGlass, viceWindow * 0.82);
        diffuseColor.rgb *= 1.0 - uViceRain * 0.12;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float viceFlicker = 0.94 + 0.06 * sin(uViceTime * 0.7 + viceHash(floor(viceGrid)) * 6.28318);
        totalEmissiveRadiance += vec3(1.0, 0.58, 0.26) * viceWindow * viceLit * uViceNight * 0.65 * viceFlicker;`)
  }
  material.customProgramCacheKey = () => 'vice-facades-v2'
  return { material, controls }
}

/** Horizontal, gently animated water; all functions are bounded for every input. */
export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uNight: { value: 0 }, uRain: { value: 0 },
      uDeep: { value: new THREE.Color('#168b98') }, uLight: { value: new THREE.Color('#67d9c9') },
    }]),
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vWater;
      varying float vWave;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        float wave = sin(wp.x * 0.10 + uTime * 0.65) * 0.09
          + sin(wp.z * 0.14 - uTime * 0.45 + wp.x * 0.035) * 0.065;
        p.y += wave;
        vWave = wave;
        vWater = wp.xz;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uNight; uniform float uRain;
      uniform vec3 uDeep; uniform vec3 uLight;
      varying vec2 vWater; varying float vWave;
      #include <fog_pars_fragment>
      void main() {
        float wave = sin(vWater.x * 0.21 + uTime * 0.8) * sin(vWater.y * 0.17 - uTime * 0.55);
        float ripple = sin(vWater.x * 0.72 + vWater.y * 0.41 + uTime * 1.5);
        float glint = smoothstep(0.82, 0.97, wave) * (0.20 + 0.08 * (1.0 - uRain));
        float blend = clamp(0.43 + wave * 0.13 + vWave * 0.5 + ripple * uRain * 0.04, 0.0, 1.0);
        vec3 color = mix(uDeep, uLight, blend) + vec3(0.38, 0.43, 0.38) * glint;
        color = mix(color, color * vec3(0.28, 0.45, 0.62), uNight * 0.72);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  })
}

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#70c8e1') },
      uHorizon: { value: new THREE.Color('#ffd1b4') },
      uSun: { value: new THREE.Color('#fff0bd') },
      uSunDirection: { value: new THREE.Vector3(-0.45, 0.68, -0.45).normalize() },
      uSunStrength: { value: 0.8 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // Put the skydome at the far depth regardless of the camera's far clipping distance.
        gl_Position.z = gl_Position.w * 0.9999;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDirection;
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDirection;
      uniform float uSunStrength;
      void main() {
        vec3 direction = normalize(vDirection);
        float height = clamp(direction.y, 0.0, 1.0);
        vec3 color = mix(uHorizon, uTop, pow(height, 0.65));
        float sun = max(dot(direction, normalize(uSunDirection)), 0.0);
        color += uSun * uSunStrength * (pow(sun, 256.0) * 0.65 + pow(sun, 10.0) * 0.16);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  })
}

export function createRainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime; attribute float aTip;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * 24.0, 42.0) + 2.0 - aTip * 1.5;
        p.x += aTip * 0.20;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      void main() {
        gl_FragColor = vec4(0.75, 0.88, 1.0, 0.42);
        #include <colorspace_fragment>
      }`,
  })
}
