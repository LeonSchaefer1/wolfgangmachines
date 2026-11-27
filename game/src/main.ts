// Entry point: boot the renderer, the game and the browser/Android glue.
import { audio } from './audio';
import { Game } from './game';
import { Stage, type Quality } from './render/stage';
import { save } from './save';

function boot() {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const stage = new Stage(canvas, Math.max(0, Math.min(2, save.quality)) as Quality);
  const game = new Game(stage, document.getElementById('app')!);
  (window as any).__game = game;
  (window as any).__audio = audio;

  const relayout = () => game.layout();
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => setTimeout(relayout, 250));
  relayout();

  const loop = (t: number) => {
    game.tick(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // pause everything when the app is not visible
  const setPaused = (p: boolean) => {
    game.paused = p;
    audio.setSuspended(p);
  };
  document.addEventListener('visibilitychange', () => setPaused(document.hidden));
  (window as any).onAppPause = () => setPaused(true);
  (window as any).onAppResume = () => setPaused(document.hidden);
  (window as any).onAndroidBack = () => game.back();
  // the Android shell reports the camera cut-out (css px) in case the WebView does not expose env(safe-area-inset-*)
  (window as any).__setInsets = (left: number, right: number) => {
    document.documentElement.style.setProperty('--cut-l', Math.max(0, left) + 'px');
    document.documentElement.style.setProperty('--cut-r', Math.max(0, right) + 'px');
    relayout();
  };

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  // first frames compile shaders; fade the boot screen out once things are on screen
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('boot')?.classList.add('done')));
  setTimeout(() => document.getElementById('boot')?.remove(), 1200);
}

if (document.fonts && document.fonts.load) {
  Promise.race([Promise.all([document.fonts.load('900 16px Nunito'), document.fonts.load('700 16px Nunito')]), new Promise((r) => setTimeout(r, 1500))]).then(boot, boot);
} else boot();
