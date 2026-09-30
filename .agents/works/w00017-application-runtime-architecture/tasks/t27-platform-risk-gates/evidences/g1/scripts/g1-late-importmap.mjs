// G1 坑位验证：服务端 HTML 不带 import map，改由页面启动后的脚本动态插入，再加载 ESM 插件。
// 用来确认“import map 必须早于首个模块脚本”在各引擎上的实际行为。
// 用法：node g1-late-importmap.mjs --url <url> --browser chromium|webkit --label <label> --out <dir>
import {mkdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createRequire} from "node:module";

const require = createRequire(process.env.G1_PLAYWRIGHT_FROM ?? import.meta.url);
const {chromium, webkit} = require("playwright-core");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), list[index + 1]]);
    return pairs;
}, []));
await mkdir(resolve(args.out), {recursive: true});
const browser = args.browser === "webkit"
    ? await webkit.launch({headless: true})
    : await chromium.launch({executablePath: "/usr/bin/google-chrome-stable", headless: true});
const page = await browser.newPage();
const consoleMessages = [];
page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`.slice(0, 300)));
let importMap = null;
await page.route((url) => url.pathname === "/g1", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    importMap = html.match(/<script type="importmap">(.*?)<\/script>/u)?.[1] ?? null;
    await route.fulfill({response, body: html.replace(/<script type="importmap">.*?<\/script>/u, "")});
});
await page.goto(args.url, {waitUntil: "load"});
await page.waitForFunction(() => window.__G1__?.ready === true);
const inserted = await page.evaluate((json) => {
    const script = document.createElement("script");
    script.type = "importmap";
    script.textContent = json;
    document.head.appendChild(script);
    return {hasImportMapInHtml: false, inserted: true, supportsMultiple: typeof HTMLScriptElement.supports === "function" ? HTMLScriptElement.supports("importmap") : null};
}, importMap);
await page.click("[data-testid=load-esm]");
await page.waitForFunction(() => ["mounted", "load-failed", "failed"].includes(document.querySelector("[data-testid=slot-status-esm]")?.textContent ?? ""), null, {timeout: 20_000}).catch(() => {});
const result = {
    label: args.label,
    browserVersion: browser.version(),
    inserted,
    status: await page.textContent("[data-testid=slot-status-esm]"),
    error: await page.locator("[data-testid=slot-error-esm]").textContent({timeout: 500}).catch(() => null),
    consoleMessages: consoleMessages.filter((m) => /import|map|specifier|resolve/iu.test(m)).slice(0, 10),
};
await writeFile(resolve(args.out, `${args.label}-late-importmap.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
