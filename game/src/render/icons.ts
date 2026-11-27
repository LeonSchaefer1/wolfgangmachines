// Renders small pictures of parts for the toolbox with the real 3D models.
import * as THREE from 'three';
import { halfExtents } from '../core/parts';
import type { PartKind } from '../core/types';
import { createPartView } from './partViews';
import type { Stage } from './stage';

const cache = new Map<string, string>();
const BG = 0xf3e3c0;

export function partIcon(stage: Stage, kind: PartKind, len?: number): string {
  const key = kind + (len ?? '');
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 224;
  const r = stage.renderer;
  const scene = new THREE.Scene();
  scene.environment = stage.scene.environment;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight(0xfff6e6, 0x9a7a55, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.2);
  sun.position.set(-3, 6, 9);
  scene.add(sun);
  const inst = { id: 'icon-' + key, kind, x: 0, y: 0, a: kind === 'plank' ? -14 : 0, fixed: false, len };
  const view = createPartView(inst);
  const kill: THREE.Object3D[] = [];
  view.root.traverse((o) => {
    if (o.userData.fx) kill.push(o);
  });
  for (const o of kill) o.removeFromParent();
  view.root.position.set(0, 0, 0);
  scene.add(view.root);
  const { hw, hh } = halfExtents(inst);
  const half = Math.max(hw * 1.02, hh * 1.25, 0.45) + 0.08;
  const cam = new THREE.OrthographicCamera(-half, half, half * 0.72, -half * 0.72, 0.1, 50);
  cam.position.set(half * 0.25, half * 0.55 + (kind === 'balloon' ? -0.3 : 0), 10);
  cam.lookAt(0, kind === 'balloon' ? -0.3 : 0, 0);

  const prevColor = r.getClearColor(new THREE.Color()).getHex();
  r.setPixelRatio(1);
  r.setSize(S, Math.round(S * 0.72), false);
  r.setClearColor(BG);
  const shadows = r.shadowMap.enabled;
  r.shadowMap.enabled = false;
  r.render(scene, cam);
  const c = document.createElement('canvas');
  c.width = S;
  c.height = Math.round(S * 0.72);
  c.getContext('2d')!.drawImage(r.domElement, 0, 0);
  const url = c.toDataURL('image/png');
  r.shadowMap.enabled = shadows;
  r.setClearColor(prevColor);
  view.dispose();
  stage.applyQuality();
  cache.set(key, url);
  return url;
}
