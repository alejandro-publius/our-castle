import * as THREE from "three";
import { PALETTE, PALETTE_LAB } from "./palette.js";

const vertexShader = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const fragmentShader = `
precision highp float;
varying vec2 vUv;
uniform sampler2D colourTexture;
uniform sampler2D depthTexture;
uniform vec2 resolution;
uniform vec3 palette[90];
uniform vec3 paletteLab[90];
uniform bool pixelMode;
uniform bool outlines;
uniform bool dither;
uniform float exposure;
uniform float cameraNear;
uniform float cameraFar;
uniform float pixelWorld;
vec3 filmic(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
vec3 encode(vec3 x){return mix(12.92*x,1.055*pow(max(x,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),x));}
vec3 toLab(vec3 c){
  vec3 rgb=mix(c/12.92,pow((c+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),c));
  vec3 lms=pow(max(vec3(dot(rgb,vec3(0.4122214708,0.5363325363,0.0514459929)),dot(rgb,vec3(0.2119034982,0.6806995451,0.1073969566)),dot(rgb,vec3(0.0883024619,0.2817188376,0.6299787005))),vec3(0.0)),vec3(1.0/3.0));
  return vec3(dot(lms,vec3(0.2104542553,0.793617785,-0.0040720468)),dot(lms,vec3(1.9779984951,-2.428592205,0.4505937099)),dot(lms,vec3(0.0259040371,0.7827717662,-0.808675766)));
}
float bayer(vec2 p){
  vec2 a=mod(p,2.0),b=mod(floor(p/2.0),2.0);
  float lo=2.0*a.x+3.0*a.y-4.0*a.x*a.y;
  float hi=2.0*b.x+3.0*b.y-4.0*b.x*b.y;
  return (4.0*lo+hi+0.5)/16.0-0.5;
}
float distanceAt(vec2 uv){return cameraNear+texture2D(depthTexture,uv).r*(cameraFar-cameraNear);}
void main(){
  vec2 cell=floor(vUv*resolution);
  vec2 uv=(cell+0.5)/resolution;
  vec3 rgb=encode(filmic(texture2D(colourTexture,uv).rgb*exposure));
  if(!pixelMode){gl_FragColor=vec4(rgb,1.0);return;}
  vec3 lab=toLab(rgb);
  if(dither && texture2D(depthTexture,uv).r<0.99999)lab.x+=bayer(cell)*0.045;
  float best=1.0e5;vec3 chosen=palette[0];
  for(int i=0;i<90;i++){vec3 delta=lab-paletteLab[i];float score=dot(delta,delta);if(score<best){best=score;chosen=palette[i];}}
  if(outlines){
    vec2 stepUV=1.0/resolution;
    float z=distanceAt(uv);
    float l=distanceAt(uv-vec2(stepUV.x,0.0)),r=distanceAt(uv+vec2(stepUV.x,0.0));
    float u=distanceAt(uv+vec2(0.0,stepUV.y)),d=distanceAt(uv-vec2(0.0,stepUV.y));
    float bend=max(abs(l+r-2.0*z),abs(u+d-2.0*z));
    if(bend>max(pixelWorld*3.5,z*0.0025))chosen=palette[0];
  }
  gl_FragColor=vec4(chosen,1.0);
}`;

/** Orthographic, demand-rendered pixel pipeline. Does not own the scene or renderer. */
export class PixelRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.pixelSize = 2;
    this.pixelMode = true;
    this.width = 1;
    this.height = 1;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: renderer.extensions.has("EXT_color_buffer_float")
        ? THREE.HalfFloatType
        : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.target.depthTexture = new THREE.DepthTexture(
      1,
      1,
      THREE.UnsignedIntType,
    );
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        colourTexture: { value: this.target.texture },
        depthTexture: { value: this.target.depthTexture },
        resolution: { value: new THREE.Vector2(1, 1) },
        palette: { value: PALETTE.map((c) => new THREE.Vector3(...c)) },
        paletteLab: { value: PALETTE_LAB.map((c) => new THREE.Vector3(...c)) },
        pixelMode: { value: true },
        outlines: { value: true },
        dither: { value: true },
        exposure: { value: 1 },
        cameraNear: { value: 0.01 },
        cameraFar: { value: 10 },
        pixelWorld: { value: 0.001 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
    this.savedPosition = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
  }
  setSize(width, height) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    const ratio = this.pixelMode
      ? this.pixelSize
      : 1 / this.renderer.getPixelRatio();
    const w = Math.max(1, Math.floor(this.width / ratio)),
      h = Math.max(1, Math.floor(this.height / ratio));
    this.target.setSize(w, h);
    this.material.uniforms.resolution.value.set(w, h);
  }
  configure({
    pixelSize = this.pixelSize,
    pixelMode = this.pixelMode,
    outlines,
    dither,
    exposure,
  } = {}) {
    this.pixelSize = Math.min(
      6,
      Math.max(1, Math.round(Number(pixelSize) || 2)),
    );
    this.pixelMode = Boolean(pixelMode);
    this.material.uniforms.pixelMode.value = this.pixelMode;
    if (outlines !== undefined)
      this.material.uniforms.outlines.value = Boolean(outlines);
    if (dither !== undefined)
      this.material.uniforms.dither.value = Boolean(dither);
    if (exposure !== undefined)
      this.material.uniforms.exposure.value = Math.min(
        3,
        Math.max(0.1, Number(exposure) || 1),
      );
    this.setSize(this.width, this.height);
  }
  render(scene, camera) {
    if (!camera.isOrthographicCamera)
      throw new TypeError("PixelRenderer requires an orthographic camera");
    const previous = this.renderer.getRenderTarget();
    const pixelWorld =
      (camera.top - camera.bottom) / camera.zoom / this.target.height;
    this.material.uniforms.cameraNear.value = camera.near;
    this.material.uniforms.cameraFar.value = camera.far;
    this.material.uniforms.pixelWorld.value = pixelWorld;
    this.savedPosition.copy(camera.position);
    if (this.pixelMode) {
      camera.updateMatrixWorld();
      this.right.setFromMatrixColumn(camera.matrixWorld, 0);
      this.up.setFromMatrixColumn(camera.matrixWorld, 1);
      const x = camera.position.dot(this.right),
        y = camera.position.dot(this.up);
      camera.position.addScaledVector(
        this.right,
        Math.round(x / pixelWorld) * pixelWorld - x,
      );
      camera.position.addScaledVector(
        this.up,
        Math.round(y / pixelWorld) * pixelWorld - y,
      );
      camera.updateMatrixWorld();
    }
    try {
      this.renderer.setRenderTarget(this.target);
      this.renderer.render(scene, camera);
      this.renderer.setRenderTarget(previous);
      this.renderer.render(this.scene, this.camera);
    } finally {
      camera.position.copy(this.savedPosition);
      camera.updateMatrixWorld();
      this.renderer.setRenderTarget(previous);
    }
  }
  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
