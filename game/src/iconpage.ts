// Dev-only page that renders the launcher icon artwork (1024x1024) with the real game models.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getAssets } from './render/assets';
import { createPartView } from './render/partViews';
import type { PartInst, PartKind } from './core/types';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.setSize(1024, 1024, false);
r.outputColorSpace = THREE.SRGBColorSpace;
r.toneMapping = THREE.NeutralToneMapping;
r.shadowMap.enabled = true;
r.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const pm = new THREE.PMREMGenerator(r);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
scene.add(new THREE.HemisphereLight(0xfff6e6, 0x8f6f4d, 1.3));
const sun = new THREE.DirectionalLight(0xfff0d4, 2.4);
sun.position.set(-3, 5, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 30 });
sun.shadow.bias = -0.0006;
scene.add(sun);
const A = getAssets();
const wall = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.06), new THREE.MeshLambertMaterial({ map: A.wall }));
wall.receiveShadow = true;
wall.scale.setScalar(1.6);
scene.add(wall);
const cam = new THREE.OrthographicCamera(-2.6, 2.6, 2.6, -2.6, 0.1, 50);
cam.position.set(0.5, 1.2, 12);
cam.lookAt(0, 0, 0);
const P = (kind: PartKind, x: number, y: number, a = 0, scale = 1, extra: Partial<PartInst> = {}) => {
  const v = createPartView({ id: kind + x, kind, x, y, a, fixed: true, ...extra });
  v.update({ t: 0, dt: 1, alpha: 1, running: false, simTime: 0 });
  v.root.scale.setScalar(scale);
  v.root.position.set(x, y, 0.42);
  scene.add(v.root);
  return v;
};
P('plank', 0, -0.72, -14, 1.5, { len: 2.2, fixed: false, id: 'p' });
P('ball', -0.55, 0.12, 0, 2.0);
P('balloon', 0.95, 1.0, 0, 1.25, { id: 'ballon1' });
// player-part halo is not wanted on the icon
scene.traverse((o) => { if (o.userData.fx) o.visible = false; });
r.render(scene, cam);
(window as any).__done = true;
