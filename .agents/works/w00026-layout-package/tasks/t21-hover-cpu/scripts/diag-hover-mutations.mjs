// 临时诊断：不按键划过时，DOM 上哪些属性在变（按元素选择器与属性名计数）。
import {createRequire} from "node:module";
const require = createRequire("/home/notnotype/CodeRepository/neuro-book/package.json");
const {chromium} = require("playwright");
const URL_ = process.env.DIAG_URL ?? "http://127.0.0.1:4417/?project=sample";
const browser = await chromium.launch({headless: true, channel: "chrome"});
const page = await (await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: "no-preference", colorScheme: "light"})).newPage();
await page.goto(URL_);
await page.waitForSelector("[data-workbench-root][data-rpc-state='online']", {timeout: 60000});
await page.waitForTimeout(3000);
await page.evaluate(() => {
    window.__muts = new Map();
    const name = (el) => el.nodeType !== 1 ? el.nodeName : `${el.tagName.toLowerCase()}${el.classList[0] ? "." + el.classList[0] : ""}`;
    new MutationObserver((list) => {
        for (const m of list) {
            const key = m.type === "attributes" ? `${name(m.target)} @${m.attributeName}` : m.type === "childList" ? `${name(m.target)} 子节点` : `${name(m.target.parentNode ?? m.target)} 文字`;
            window.__muts.set(key, (window.__muts.get(key) ?? 0) + 1);
            if (m.type === "childList" && m.target === document.head) for (const n of [...m.addedNodes, ...m.removedNodes]) window.__head = [...(window.__head ?? []), `${m.addedNodes.length ? "+" : "-"}${n.nodeName} ${(n.textContent ?? "").slice(0, 160).replace(/\s+/g, " ")}`];
        }
    }).observe(document.documentElement, {subtree: true, attributes: true, childList: true, characterData: true});
});
const across = [{x: 700, y: 400}, {x: 1300, y: 300}, {x: 1000, y: 600}, {x: 300, y: 300}, {x: 900, y: 200}];
for (let round = 0; round < 2; round += 1) for (const p of across) await page.mouse.move(p.x, p.y, {steps: 40});
await page.waitForTimeout(300);
const out = await page.evaluate(() => [...window.__muts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25));
for (const [k, n] of out) console.log(String(n).padStart(5), k);
console.log((await page.evaluate(() => window.__head ?? [])).slice(0, 8).join("\n"));
console.log(await page.evaluate(() => { const hits = []; for (const sheet of document.styleSheets) { try { for (const r of sheet.cssRules) { const t = r.cssText; if (t.includes("sash-cursor") || t.includes(":has(")) hits.push(t.slice(0, 200)); } } catch {} } return hits.join("\n"); }));
// 哪些 :hover 规则命中多：数一下页面里元素个数与样式表规则里带 :hover 的
console.log(await page.evaluate(() => {
    let hover = 0, has = 0;
    for (const sheet of document.styleSheets) { try { for (const r of sheet.cssRules) { const t = r.cssText; if (t.includes(":hover")) hover += 1; if (t.includes(":has(")) has += 1; } } catch {} }
    return {elements: document.querySelectorAll("*").length, hoverRules: hover, hasRules: has};
}));
await browser.close();
