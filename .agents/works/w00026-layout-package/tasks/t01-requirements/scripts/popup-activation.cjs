// 在 packages/neuro-book 目录里运行：node <本文件路径>（要用那里的 Playwright 与本机 Chrome）。
// 实测：指针拖动松手时，页面还有没有“用户激活”，window.open 会不会被拦。
// Playwright 默认带 --disable-popup-blocking，这里去掉，否则测不出拦截。
const {createRequire} = require("node:module");
const req = createRequire(`${process.cwd()}/package.json`);
const {chromium} = req("@playwright/test");
const HTML = `<!doctype html><body style="margin:0"><div id="src" style="width:200px;height:200px;background:#88f"></div><script>
window.results=[];
const s=document.getElementById('src');
s.addEventListener('pointerdown',e=>{s.setPointerCapture(e.pointerId);window.t0=performance.now();window.downActive=navigator.userActivation.isActive;});
s.addEventListener('pointerup',e=>{
  const before=navigator.userActivation.isActive;
  const w=window.open('about:blank','_blank','popup,width=400,height=300');
  window.results.push({heldMs:Math.round(performance.now()-window.t0),downActive:window.downActive,activeAtUp:before,opened:w!==null,clientX:Math.round(e.clientX),clientY:Math.round(e.clientY),outside:e.clientX<0||e.clientY<0||e.clientX>innerWidth||e.clientY>innerHeight});
  if(w)w.close();
});
</script></body>`;
const CASES = [["内部快松手", 300, {x: 150, y: 150}], ["内部按住 4 秒", 4000, {x: 150, y: 150}], ["内部按住 6 秒", 6000, {x: 150, y: 150}], ["内部按住 20 秒", 20000, {x: 150, y: 150}], ["窗口外快松手", 300, {x: 1600, y: 300}], ["窗口外按住 6 秒", 6000, {x: 1600, y: 300}]];
(async () => {
  const browser = await chromium.launch({channel: "chrome", headless: true, ignoreDefaultArgs: ["--disable-popup-blocking"]});
  for (const [name, hold, to] of CASES) {
    const page = await (await browser.newContext({viewport: {width: 1280, height: 800}})).newPage();
    await page.setContent(HTML);
    await page.mouse.move(50, 50);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, {steps: 5});
    await page.waitForTimeout(hold);
    await page.mouse.up();
    await page.waitForTimeout(200);
    console.log(name, JSON.stringify(await page.evaluate(() => window.results)));
    await page.context().close();
  }
  await browser.close();
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
