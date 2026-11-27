module.exports = async (page, shot, h) => {
  await h.clickText('Spielen');
  await h.wait(3000);
  const r = await page.evaluate(() => { const a = window.__audio; return { state: a.ctx && a.ctx.state, buffers: a.buffers.size, names: [...a.buffers.keys()].length, music: a.music && a.music.name, durations: [...a.buffers.entries()].filter(([k]) => k.startsWith('music') || k === 'bell' || k === 'ui_tap').map(([k, b]) => k + ':' + b.duration.toFixed(2) + 's/' + b.numberOfChannels + 'ch') }; });
  console.log(JSON.stringify(r));
};
