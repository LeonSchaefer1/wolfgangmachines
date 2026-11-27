// Renderer, camera, light and the wooden workshop wall.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FIELD_H, FIELD_W } from '../core/types';
import { Builder, getAssets, rbox, scaleU } from './assets';
import { PLANE_Z } from './partViews';

export type Quality = 0 | 1 | 2; // low, medium, high

const EYE_DIST = 17;

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();
  /** everything that belongs to the current level */
  world = new THREE.Group();
  sun: THREE.DirectionalLight;
  /** css px per world unit */
  scale = 60;
  private fx0 = 0;
  private fy0 = 0;
  private vw = 1;
  private vh = 1;
  quality: Quality = 2;
  shadowsDirty = true;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    r.setClearColor(0x3a2616);

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xfff6e6, 0x8f6f4d, 1.25));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0d4, 2.4));
    sun.position.set(FIELD_W / 2 - 4.5, FIELD_H / 2 + 7, 13);
    sun.target.position.set(FIELD_W / 2, FIELD_H / 2, 0);
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -8.2;
    sc.right = 8.2;
    sc.top = 5.6;
    sc.bottom = -5.6;
    sc.near = 2;
    sc.far = 30;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);

    this.buildRoom();
    this.scene.add(this.world);
    this.camera.matrixAutoUpdate = true;
    this.applyQuality();
  }

  private buildRoom() {
    const A = getAssets();
    // wall
    const wallGeo = new THREE.PlaneGeometry(FIELD_W, FIELD_H);
    const wall = new THREE.Mesh(wallGeo, new THREE.MeshLambertMaterial({ map: A.wall }));
    wall.position.set(FIELD_W / 2, FIELD_H / 2, 0);
    wall.receiveShadow = true;
    this.scene.add(wall);
    // darker surrounding wall outside of the frame
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W + 16, FIELD_H + 10), new THREE.MeshLambertMaterial({ map: A.wall, color: 0x7a5a3e }));
    outer.position.set(FIELD_W / 2, FIELD_H / 2, -0.02);
    this.scene.add(outer);
    // frame: the physical border of the play field
    const b = new Builder();
    const t = 0.34;
    const d = PLANE_Z + 0.5;
    const col = 0xb08a68;
    b.add('wood', scaleU(rbox(FIELD_W + 2 * t, t, d, 0.06), 5), col, [FIELD_W / 2, -t / 2, d / 2]);
    b.add('wood', scaleU(rbox(FIELD_W + 2 * t, t, d, 0.06), 5, 0.3), col, [FIELD_W / 2, FIELD_H + t / 2, d / 2]);
    b.add('wood', scaleU(rbox(FIELD_H, t, d, 0.06), 3, 0.6), col, [-t / 2, FIELD_H / 2, d / 2], [0, 0, Math.PI / 2]);
    b.add('wood', scaleU(rbox(FIELD_H, t, d, 0.06), 3, 0.8), col, [FIELD_W + t / 2, FIELD_H / 2, d / 2], [0, 0, Math.PI / 2]);
    for (const [x, y] of [
      [-t / 2, -t / 2],
      [FIELD_W + t / 2, -t / 2],
      [-t / 2, FIELD_H + t / 2],
      [FIELD_W + t / 2, FIELD_H + t / 2],
    ]) {
      b.add('metal', new THREE.CylinderGeometry(0.1, 0.1, 0.04, 14), 0xd8a53c, [x, y, d + 0.01], [Math.PI / 2, 0, 0]);
    }
    // the frame casts no shadow: a dark band along the top and left edge would only hide parts
    b.build(this.scene, false);
  }

  /** fits the camera so that the field exactly covers the given screen rectangle (css px) */
  layout(field: { x: number; y: number; width: number; height: number }, vw: number, vh: number) {
    this.vw = vw;
    this.vh = vh;
    const s = (this.scale = field.width / FIELD_W);
    this.fx0 = field.x;
    this.fy0 = field.y;
    const X0 = -field.x / s;
    const X1 = (vw - field.x) / s;
    const Y1 = FIELD_H + field.y / s;
    const Y0 = Y1 - vh / s;
    const ex = FIELD_W / 2;
    const ey = FIELD_H * 0.6;
    const near = 2;
    const far = 60;
    const d = EYE_DIST - PLANE_Z;
    const k = near / d;
    this.camera.position.set(ex, ey, EYE_DIST);
    this.camera.rotation.set(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    this.camera.projectionMatrix.makePerspective((X0 - ex) * k, (X1 - ex) * k, (Y1 - ey) * k, (Y0 - ey) * k, near, far);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.renderer.setSize(vw, vh, false);
    this.applyQuality();
  }

  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const cap = this.quality === 2 ? 2 : this.quality === 1 ? 1.5 : 1.1;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.renderer.setSize(this.vw, this.vh, false);
    const size = this.quality === 2 ? 2048 : 1024;
    this.renderer.shadowMap.enabled = true;
    this.sun.castShadow = this.quality > 0 || true;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.type = this.quality === 0 ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.shadowsDirty = true;
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }

  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    return { x: (clientX - this.fx0) / this.scale, y: FIELD_H - (clientY - this.fy0) / this.scale };
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.fx0 + x * this.scale, y: this.fy0 + (FIELD_H - y) * this.scale };
  }

  render() {
    if (this.shadowsDirty) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowsDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
