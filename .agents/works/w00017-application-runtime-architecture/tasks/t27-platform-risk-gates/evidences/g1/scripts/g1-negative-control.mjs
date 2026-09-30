// G1 对照组：插件包自带一份 Vue（只共享 nb-ui 与 SDK）时，确认同一套检查会失败，
// 证明 g1-verify.mjs 的通过不是检查本身不敏感。
// 用法：node g1-negative-control.mjs --url <url> --browser chromium|webkit --label <label> --out <dir>
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
const page = await browser.newPage({viewport: {width: 1280, height: 900}});
const pageErrors = [];
const consoleMessages = [];
page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") consoleMessages.push(`${message.type()}: ${message.text()}`.slice(0, 300));
});

const result = {label: args.label, url: args.url};
try {
    await page.goto(args.url, {waitUntil: "load"});
    await page.waitForFunction(() => window.__G1__?.ready === true);
    await page.click("[data-testid=load-selfvue]");
    await page.waitForFunction(() => {
        const status = document.querySelector("[data-testid=slot-status-selfvue]")?.textContent;
        return status === "mounted" || status === "failed" || status === "load-failed";
    }, null, {timeout: 20_000});
    await page.waitForTimeout(500);
    result.status = await page.textContent("[data-testid=slot-status-selfvue]");
    result.identity = await page.evaluate(() => window.__G1__.identity.selfvue);
    result.slotError = await page.locator("[data-testid=slot-error-selfvue]").textContent({timeout: 1000}).catch(() => null);
    const root = page.locator("[data-g1-plugin=selfvue]");
    result.rendered = await root.count() > 0;
    if (result.rendered) {
        result.injectText = await root.locator("[data-testid=inject]").textContent();
        await root.locator("[data-testid=plain-inc]").click({timeout: 5000}).catch((error) => { result.clickError = String(error.message).slice(0, 200); });
        await page.waitForTimeout(300);
        result.countAfterClick = await root.locator("[data-testid=count]").textContent().catch(() => null);
    }
    result.capturedErrors = await page.evaluate(() => window.__G1__.errors);
} catch (error) {
    result.fatal = String(error?.message ?? error).slice(0, 500);
}
result.pageErrors = pageErrors;
result.consoleMessages = consoleMessages.slice(0, 20);
await page.screenshot({path: resolve(args.out, `${args.label}-selfvue.png`)}).catch(() => {});
await writeFile(resolve(args.out, `${args.label}-selfvue.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
