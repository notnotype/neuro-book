/* 心情差分的轮播录屏：按虚拟时间逐帧截图，帧间隔严格均匀，不受机器快慢影响。produce.py 调用它，再用 ffmpeg 合成 WebM、GIF。
 *
 *   node tools/capture_moods.cjs <neurobook-mood.js> <帧输出目录> <状态顺序，逗号分隔> [每秒帧数] [边长 px]
 *
 * 做法：组件切到手动模式（NeuroBookMood.manual），时钟指向 window.__t；每一帧先推进虚拟时间、按时换状态、画一帧，
 * 再把组件里所有 CSS 动画和切换动画暂停、拨到同一个虚拟时间，然后截图。
 * 需要仓库根目录的 playwright（node_modules）和本机的 Chrome（环境变量 CHROME 可改路径）。 */
const fs = require("fs");
const path = require("path");

const [jsPath, outDir, orderArg, fpsArg = "24", sizeArg = "360"] = process.argv.slice(2);
const fps = +fpsArg, size = +sizeArg, order = orderArg.split(",");
const HOLD = 2.6;            // 每个状态停留的秒数
const TAIL = 1.2;            // 最后回到第一个状态再停一会儿，循环播放时首尾接得上

function findPlaywright() {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    const p = path.join(dir, "node_modules", "playwright");
    if (fs.existsSync(p)) return require(p);
    dir = path.dirname(dir);
  }
  throw new Error("找不到 playwright（仓库根目录的 node_modules）");
}

(async () => {
  const { chromium } = findPlaywright();
  fs.mkdirSync(outDir, { recursive: true });
  const html = path.join(outDir, "_capture.html");
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;background:#F7F2EC">
<script src="file://${path.resolve(jsPath)}"></script>
<script>
NeuroBookMood.manual = true;
window.__t = 0;
NeuroBookMood.clock = () => window.__t;
const el = document.createElement("neurobook-mood");
el.setAttribute("state", ${JSON.stringify(order[0])});
el.style.width = "${size}px";
el.style.margin = "0";
document.body.appendChild(el);
window.__frame = (t, state) => {
  window.__t = t;
  if (state && el.state !== state) el.state = state;
  el.tick(t);
  for (const a of el.shadowRoot.getAnimations()) {
    a.pause();
    a.currentTime = "startVirtual" in a ? Math.max(0, t - a.startVirtual) : t;
  }
};
</script></body></html>`);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome-stable" });
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.goto("file://" + html);
  const seq = [...order.map((k) => [k, HOLD]), [order[0], TAIL]];
  let frame = 0, t0 = 0;
  for (const [state, hold] of seq) {
    const n = Math.round(hold * fps);
    for (let i = 0; i < n; i++) {
      const t = (t0 + i / fps) * 1000;
      await page.evaluate(([t, s]) => window.__frame(t, s), [t, state]);
      await page.screenshot({ path: path.join(outDir, `f_${String(frame++).padStart(5, "0")}.png`), clip: { x: 0, y: 0, width: size, height: size } });
    }
    t0 += n / fps;
  }
  await browser.close();
  fs.unlinkSync(html);
  console.log(`captured ${frame} frames`);
})().catch((e) => { console.error(e.message); process.exit(1); });
