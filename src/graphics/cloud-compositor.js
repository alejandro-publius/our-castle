import * as THREE from 'three';
import { PixelRenderer } from './pixel-renderer.js';
import { CLOUD_SURROUND_GLSL, cloudColours } from './cloud-surround.js';

// The preserved pixel renderer still owns the world pass. Only this playable-world instance
// gets a cloud compositor; soft cloud alpha is applied after the world's fixed palette.
class CloudSurround {
  constructor(pipeline) {
    if (!(pipeline instanceof PixelRenderer)) throw new TypeError("Clouds require the original PixelRenderer.");
    this.material = pipeline.material;
    this.quad = pipeline.quad;
    this.baseRender = pipeline.render.bind(pipeline);
    this.cloudAppearance = { period: 'day', weather: 'clear' };
    this.cloudLastTime = null;
    this.worldCamera = null;
    Object.assign(this.material.uniforms, {
      cloudSurroundEnabled: { value: true },
      cloudTime: { value: 0 },
      cloudCenter: { value: new THREE.Vector2(0, 0) },
      cloudBounds: { value: new THREE.Vector2(82, 57) },
      cloudWorldFromClip: { value: new THREE.Matrix4() },
      cloudLight: { value: new THREE.Vector3(1, 1, 1) },
      cloudShade: { value: new THREE.Vector3(.7, .75, .7) },
      cloudBase: { value: new THREE.Vector3(.85, .87, .83) },
      cloudRight: { value: new THREE.Vector3(1, 0, 0) },
      cloudUp: { value: new THREE.Vector3(0, 1, 0) },
    });
    let fragment = this.material.fragmentShader;
    const replace = (needle, replacement) => {
      if (!fragment.includes(needle) || fragment.indexOf(needle) !== fragment.lastIndexOf(needle))
        throw new Error('Cloud compositor hook no longer matches the preserved renderer.');
      fragment = fragment.replace(needle, replacement);
    };
    replace('uniform float pixelWorld;', 'uniform float pixelWorld;\n' + CLOUD_SURROUND_GLSL);
    replace('  vec3 rgb=encode(filmic(texture2D(colourTexture,uv).rgb*exposure));',
      '  float depth=texture2D(depthTexture,uv).r;\n' +
      '  vec4 cloud=cloudSurroundAt(uv,depth);\n' +
      '  if(cloudSurroundEnabled && depth>=.99999){gl_FragColor=vec4(cloud.rgb,1.0);return;}\n' +
      '  vec3 rgb=encode(filmic(texture2D(colourTexture,uv).rgb*exposure));');
    replace('gl_FragColor=vec4(rgb,1.0);return;', 'gl_FragColor=vec4(mix(rgb,cloud.rgb,cloud.a),1.0);return;');
    replace('gl_FragColor=vec4(chosen,1.0);', 'gl_FragColor=vec4(mix(chosen,cloud.rgb,cloud.a),1.0);');
    this.material.fragmentShader = fragment;
    this.material.needsUpdate = true;
    // This runs while the base renderer's world camera is still snapped to whole art pixels.
    this.quad.onBeforeRender = () => {
      if (!this.worldCamera) return;
      const u = this.material.uniforms, matrix = this.worldCamera.matrixWorld;
      u.cloudWorldFromClip.value.multiplyMatrices(matrix, this.worldCamera.projectionMatrixInverse);
      u.cloudRight.value.setFromMatrixColumn(matrix, 0);
      u.cloudUp.value.setFromMatrixColumn(matrix, 1);
    };
    this.setCloudSurround();
    for (const name of ['setCloudSurround', 'stepCloudSurround', 'cloudSurroundDebug', 'render'])
      pipeline[name] = this[name].bind(this);
  }
  setCloudSurround({ enabled = true, period = this.cloudAppearance.period, weather = this.cloudAppearance.weather, bounds, center } = {}) {
    const u = this.material.uniforms;
    u.cloudSurroundEnabled.value = Boolean(enabled);
    this.cloudAppearance = { period, weather };
    if (bounds) u.cloudBounds.value.set(...bounds);
    if (center) u.cloudCenter.value.set(...center);
    for (const [i, name] of ['cloudLight', 'cloudShade', 'cloudBase'].entries()) {
      const hex = cloudColours(period, weather)[i];
      u[name].value.set(((hex >>> 16) & 255) / 255, ((hex >>> 8) & 255) / 255, (hex & 255) / 255);
    }
  }
  stepCloudSurround(seconds) {
    if (!this.material.uniforms.cloudSurroundEnabled.value || !Number.isFinite(seconds)) return;
    if (this.cloudLastTime !== null)
      this.material.uniforms.cloudTime.value += Math.min(.25, Math.max(0, seconds - this.cloudLastTime));
    this.cloudLastTime = seconds;
  }
  cloudSurroundDebug() {
    return { enabled: this.material.uniforms.cloudSurroundEnabled.value, seconds: this.material.uniforms.cloudTime.value, ...this.cloudAppearance };
  }
  render(scene, camera) {
    this.worldCamera = camera;
    try { return this.baseRender(scene, camera); } finally { this.worldCamera = null; }
  }
}

export function addCloudSurround(pipeline) {
  new CloudSurround(pipeline);
  return pipeline;
}
