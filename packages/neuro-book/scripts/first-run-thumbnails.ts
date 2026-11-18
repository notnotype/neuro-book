#!/usr/bin/env node
/**
 * 首次启动向导的主题缩略图（docs/specs/runtime/desktop-shell.md 输出 34 第二步）：用生产构建起一个产品服务端，书架上放三部作品，
 * 按每个内置主题的亮、暗各截一张书架页，裁出左上角、转成 WebP，写进 `src/plugins/desktop/web/assets/first-run/<主题>-<明暗>.webp`。
 * 产品外观变了（主题配色、书架版式）时重跑；`first-run-assets.test.ts` 只核对文件齐全，不核对外观。
 *
 *   bun run build            # 先有 dist/server 与 dist/web
 *   node scripts/first-run-thumbnails.ts
 *
 * 由 Node 运行（与 lab-shot 相同：Bun 下 Playwright 连接浏览器的握手会超时）。
 */

import {randomUUID} from "node:crypto";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {chromium} from "@playwright/test";
import sharp from "sharp";

import {startProductServer} from "../e2e/fixtures.ts";

/** 内置主题（`src/plugins/workbench/shared/themes.ts` 的 `BUILTIN_THEME_CONTRIBUTIONS`）。 */
const THEMES = ["nbook", "macos", "eye-green", "eye-sepia"] as const;
const APPEARANCES = ["light", "dark"] as const;
const WORKS = ["长夜行", "北方以北", "雾中城"];
const OUT = resolve(import.meta.dirname, "../src/plugins/desktop/web/assets/first-run");
/** 截书架页的左上角：标志、看板娘与第一行作品卡片都在里面，四张一行时每张约 130 像素宽也认得出主题。 */
const VIEWPORT = {width: 1400, height: 860};
const CLIP = {x: 160, y: 0, width: 880, height: 550};
const WIDTH = 320;

const tmp = await mkdtemp(join(tmpdir(), "nbook-first-run-thumbnails-"));
const stateRoot = join(tmp, "state");
await mkdir(join(stateRoot, "user"), {recursive: true});
const projects = [];
for (const name of WORKS) {
    const id = randomUUID();
    const path = join(tmp, name);
    await mkdir(join(path, ".nbook"), {recursive: true});
    await writeFile(join(path, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    projects.push({id, name, path});
}
await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects}));

const server = await startProductServer(stateRoot, {env: {HOME: tmp}});
const browser = await chromium.launch({channel: "chrome", headless: true});
try {
    await mkdir(OUT, {recursive: true});
    for (const theme of THEMES) {
        for (const appearance of APPEARANCES) {
            await writeFile(join(stateRoot, "settings.json"), JSON.stringify({"nbook.workbench/theme": theme, "nbook.workbench/appearance": appearance}));
            const page = await browser.newPage({viewport: VIEWPORT, locale: "zh-CN"});
            await page.goto(server.url);
            await page.locator("[data-bookshelf-page]").waitFor();
            await page.waitForFunction((wanted) => document.documentElement.dataset.nbAppearance === wanted, appearance);
            // 主题的配色由设置插件就绪后推到文档根上：等窗体底色连续两次读数相同再截。
            let previous = "";
            for (;;) {
                const current = await page.evaluate(() => `${getComputedStyle(document.body).backgroundColor} ${document.documentElement.getAttribute("style") ?? ""}`);
                if (current === previous) break;
                previous = current;
                await page.waitForTimeout(250);
            }
            const png = await page.screenshot({clip: CLIP});
            await sharp(png).resize({width: WIDTH}).webp({quality: 82}).toFile(join(OUT, `${theme}-${appearance}.webp`));
            await page.close();
            console.log(`${theme}-${appearance}.webp`);
        }
    }
} finally {
    await browser.close();
    await server.stop();
    await rm(tmp, {recursive: true, force: true});
}
