// Shared textures, materials and a small geometry-merging helper.
// Few materials + merged geometry = few shader programs and few draw calls (important on phones).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as T from './textures';

export type MatKey = 'matte' | 'gloss' | 'metal' | 'wood' | 'woodLight';

export interface Assets {
  mats: Record<MatKey, THREE.MeshStandardMaterial>;
  wall: THREE.Texture;
  steel: THREE.MeshStandardMaterial;
  basketball: THREE.MeshStandardMaterial;
  beachball: THREE.MeshStandardMaterial;
  crate: THREE.MeshStandardMaterial;
  bucket: THREE.MeshStandardMaterial;
  belt: THREE.Texture;
  glow: THREE.Texture;
  halo: THREE.Texture;
  wind: THREE.Texture;
  puff: THREE.Texture;
  star: THREE.Texture;
  ghost: THREE.MeshBasicMaterial;
}

let cached: Assets | null = null;

export function getAssets(): Assets {
  if (cached) return cached;
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  cached = {
    mats: {
      matte: std({ vertexColors: true, roughness: 0.86, metalness: 0 }),
      gloss: std({ vertexColors: true, roughness: 0.3, metalness: 0 }),
      metal: std({ vertexColors: true, roughness: 0.3, metalness: 1 }),
      wood: std({ vertexColors: true, roughness: 0.72, metalness: 0, map: T.plankTexture(24, 55, 42, 3) }),
      woodLight: std({ vertexColors: true, roughness: 0.7, metalness: 0, map: T.plankTexture(34, 58, 60, 8) }),
    },
    wall: T.wallTexture(),
    steel: std({ map: T.steelTexture(), roughness: 0.2, metalness: 1 }),
    basketball: std({ map: T.basketballTexture(), roughness: 0.75 }),
    beachball: std({ map: T.beachballTexture(), roughness: 0.22 }),
    crate: std({ map: T.crateTexture(), roughness: 0.8 }),
    bucket: std({ color: 0xc3ccd3, roughness: 0.42, metalness: 1, side: THREE.DoubleSide }),
    belt: T.beltTexture(),
    glow: T.glowTexture(),
    halo: T.haloTexture(),
    wind: T.windTexture(),
    puff: T.puffTexture(),
    star: T.starTexture(),
    ghost: new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.45, depthWrite: false }),
  };
  return cached;
}

export const rbox = (w: number, h: number, d: number, r = 0.035, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));

const tmpColor = new THREE.Color();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/** Collects coloured primitive geometries and merges them into one mesh per material. */
export class Builder {
  private buckets = new Map<MatKey, THREE.BufferGeometry[]>();

  add(mat: MatKey, geo: THREE.BufferGeometry, color: number, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): this {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    tmpE.set(rot[0], rot[1], rot[2]);
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(...pos), tmpQ, new THREE.Vector3(...scale));
    g.applyMatrix4(tmpM);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    tmpColor.set(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = tmpColor.r;
      col[i * 3 + 1] = tmpColor.g;
      col[i * 3 + 2] = tmpColor.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // keep only the attributes all primitives share
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, (arr = []));
    arr.push(g);
    return this;
  }

  build(parent: THREE.Object3D, shadow = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const A = getAssets();
    for (const [key, geos] of this.buckets) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) for (const g of geos) g.dispose();
      const m = new THREE.Mesh(merged, A.mats[key]);
      m.castShadow = shadow;
      m.receiveShadow = false;
      parent.add(m);
      out.push(m);
    }
    this.buckets.clear();
    return out;
  }
}

/** multiplies the u coordinate so wood grain keeps its scale on long boards */
export function scaleU(geo: THREE.BufferGeometry, su: number, offU = 0, offV = 0): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + offU, uv.getY(i) + offV);
  return geo;
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
