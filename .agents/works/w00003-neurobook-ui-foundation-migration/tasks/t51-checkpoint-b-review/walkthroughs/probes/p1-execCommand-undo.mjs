#!/usr/bin/env node
/**
 * 探针 P1（真机 Chromium，无产品服务）：`document.execCommand("undo"/"redo")` 能不能真的撤销输入框 / 可编辑区。
 *
 * 试图证伪的声明（t50）：
 *   1. `app/pages/index.vue` 给 `edit.undo` / `edit.redo` 选的原生去处是 `document.execCommand("undo"|"redo")`；
 *   2. t50 实施记录 §4.0「点『撤销』把输入框 `新小长名字XYZ` 改回 `新小长名字XY`（原生撤销，不是 Studio 会话）」。
 *
 * 运行（cwd 任意，脚本用绝对路径解析浏览器）：
 *   node .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t51-checkpoint-b-review/walkthroughs/probes/p1-execCommand-undo.mjs
 * 或显式指定浏览器：
 *   PROBE_BROWSER="C:/.../chrome.exe" node <同上路径>
 * 退出码：0 = 探针执行完成（结论在 stdout）；1 = 探针自身失败（找不到浏览器等）。
 */
import {existsSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright-core";

const candidates = [
    process.env.PROBE_BROWSER,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1228", "chrome-win64", "chrome.exe") : null,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe") : null,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter((value) => typeof value === "string" && value.length > 0);
const executablePath = candidates.find((candidate) => existsSync(candidate));
if (!executablePath) {
    console.error(`找不到可用的浏览器；候选：${candidates.join(", ")}`);
    process.exit(1);
}

const MARK = "新小长名字XY";
const browser = await chromium.launch({executablePath, headless: true});
const page = await browser.newPage();
await page.setContent(`<!doctype html><meta charset="utf-8">
<input id="field" type="text">
<div id="ce" contenteditable="true"></div>`);

async function record(selector, label) {
    const result = await page.evaluate(({selector, mark}) => {
        const element = document.querySelector(selector);
        const before = element.value ?? element.textContent ?? "";
        const supported = document.queryCommandSupported("undo");
        const enabled = document.queryCommandEnabled("undo");
        const returned = document.execCommand("undo");
        const afterUndo = element.value ?? element.textContent ?? "";
        // 再放一次被撤销的内容，用 Ctrl+Z 做对照：原生撤销键是否真的能撤销同一段输入。
        return {before, supported, enabled, returned, afterUndo, mark};
    }, {selector, mark: MARK});
    console.log(`[${label}] 撤销前=${JSON.stringify(result.before)}`);
    console.log(`[${label}] queryCommandSupported("undo")=${result.supported} queryCommandEnabled("undo")=${result.enabled}`);
    console.log(`[${label}] execCommand("undo") 返回=${result.returned}；撤销后=${JSON.stringify(result.afterUndo)}`);
    console.log(`[${label}] execCommand 生效？${result.afterUndo !== result.before}`);
}

// 输入框：先键入一段，停顿后再键入一段（形成可撤销的输入单元），分别用 execCommand 与 Ctrl+Z 撤销。
await page.click("#field");
await page.keyboard.type(MARK);
await page.waitForTimeout(700);
await page.keyboard.type("XYZ");
console.log(`[input] 键入完成，当前值=${JSON.stringify(await page.inputValue("#field"))}`);
await record("#field", "input/execCommand");

await page.fill("#field", "");
await page.click("#field");
await page.keyboard.type(MARK);
await page.waitForTimeout(700);
await page.keyboard.type("XYZ");
await page.keyboard.press("Control+z");
await page.waitForTimeout(100);
console.log(`[input] Ctrl+Z 之后的值=${JSON.stringify(await page.inputValue("#field"))}`);

// 可编辑区：同一套对照。
await page.click("#ce");
await page.keyboard.type(MARK);
await page.waitForTimeout(700);
await page.keyboard.type("XYZ");
console.log(`[contenteditable] 键入完成，当前内容=${JSON.stringify(await page.textContent("#ce"))}`);
await record("#ce", "contenteditable/execCommand");

await browser.close();
