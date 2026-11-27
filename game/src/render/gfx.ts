// Detects software-only WebGL (emulators, broken drivers) and switches to a very cheap render path.
// A real phone GPU never takes this path; it only keeps the game usable where no GPU is available.

let safe: boolean | null = null;
let rendererName = '';

export function gpuName(): string {
  return rendererName;
}

export function isSafeGfx(): boolean {
  if (safe !== null) return safe;
  const forced = new URLSearchParams(location.search).get('gfx');
  safe = false;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      rendererName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      safe = /swiftshader|llvmpipe|softpipe|software|emulator|ranchu|goldfish/i.test(rendererName);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    safe = false;
  }
  if (forced === 'full') safe = false;
  if (forced === 'safe') safe = true;
  return safe;
}
