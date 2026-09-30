// G1 风险门验证脚本：在 Chromium / WebKit / Electron(CDP) 中逐项检查两种插件加载做法。
// 用法：node g1-verify.mjs --url http://127.0.0.1:3431/g1 --browser chromium|webkit|cdp --label dev-chromium --out <dir>
//       [--cdp http://127.0.0.1:9431]
import {mkdir, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {createRequire} from "node:module";

const require = createRequire(process.env.G1_PLAYWRIGHT_FROM ?? import.meta.url);
const {chromium, webkit} = require("playwright-core");

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), list[index + 1]]);
    return pairs;
}, []));
const url = args.url;
const browserKind = args.browser;
const label = args.label;
const outDir = resolve(args.out);
await mkdir(outDir, {recursive: true});

// 在页面脚本之前记账全局目标（window/document/html/body）上的监听器，卸载前后对比。
const LISTENER_PROBE = `(() => {
  const active = new Map();
  const ids = new WeakMap();
  let next = 0;
  const idOf = (o) => { if (!ids.has(o)) ids.set(o, ++next); return ids.get(o); };
  const label = (t) => t === window ? "window" : t === document ? "document" : t === document.documentElement ? "html" : (document.body && t === document.body) ? "body" : null;
  const capture = (o) => typeof o === "boolean" ? o : Boolean(o && o.capture);
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const l = label(this);
    if (l && listener) {
      const key = l + "|" + type + "|" + capture(options) + "|" + idOf(listener);
      active.set(key, {l, type});
      if (options && typeof options === "object" && options.signal) options.signal.addEventListener("abort", () => active.delete(key));
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    const l = label(this);
    if (l && listener) active.delete(l + "|" + type + "|" + capture(options) + "|" + idOf(listener));
    return remove.call(this, type, listener, options);
  };
  window.__G1_LISTENERS__ = () => {
    const out = {};
    for (const {l, type} of active.values()) { const k = l + ":" + type; out[k] = (out[k] || 0) + 1; }
    return out;
  };
})();`;

const report = {label, url, browserKind, startedAt: new Date().toISOString(), checks: {}, pageErrors: [], consoleErrors: []};

function check(name, pass, detail) {
    report.checks[name] = {pass: Boolean(pass), detail};
    console.log(`${pass ? "PASS" : "FAIL"} ${name} ${detail === undefined ? "" : JSON.stringify(detail)}`);
}

let browser;
let page;
let cdp = null;
if (browserKind === "cdp") {
    browser = await chromium.connectOverCDP(args.cdp);
    const context = browser.contexts()[0];
    page = context.pages()[0] ?? await context.newPage();
    await context.addInitScript(LISTENER_PROBE);
} else {
    const type = browserKind === "webkit" ? webkit : chromium;
    browser = await type.launch(browserKind === "chromium"
        ? {executablePath: "/usr/bin/google-chrome-stable", headless: true}
        : {headless: true});
    const context = await browser.newContext({viewport: {width: 1280, height: 900}});
    await context.addInitScript(LISTENER_PROBE);
    page = await context.newPage();
}
if (browserKind !== "webkit") {
    cdp = await page.context().newCDPSession(page);
}
report.browserVersion = browser.version();

page.on("pageerror", (error) => report.pageErrors.push(String(error?.message ?? error)));
page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
        report.consoleErrors.push(`${message.type()}: ${message.text()}`.slice(0, 500));
    }
});

async function snapshot() {
    return await page.evaluate(() => ({
        listeners: window.__G1_LISTENERS__(),
        bodyChildren: [...document.body.children].map((el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (el.hasAttribute("data-reka-popper-content-wrapper") ? "[popper]" : "")),
        teleports: document.getElementById("teleports")?.childElementCount ?? null,
        pluginNodes: document.querySelectorAll("[data-g1-plugin]").length,
        tooltipSurfaces: document.querySelectorAll(".nb-ui-tooltip-surface").length,
        popoverSurfaces: document.querySelectorAll(".nb-ui-popover-surface").length,
        pluginCss: document.querySelectorAll("link[data-g1-plugin-css]").length,
        pluginScripts: document.querySelectorAll("script[src*='g1-plugins']").length,
        bodyStyle: document.body.getAttribute("style"),
    }));
}

function diffListeners(before, after) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const diff = {};
    for (const key of keys) {
        const delta = (after[key] ?? 0) - (before[key] ?? 0);
        if (delta !== 0) diff[key] = delta;
    }
    return diff;
}

async function collectGarbage() {
    if (!cdp) return false;
    await cdp.send("Runtime.discardConsoleEntries").catch(() => {});
    for (let i = 0; i < 4; i += 1) {
        await cdp.send("HeapProfiler.collectGarbage");
        await page.waitForTimeout(150);
    }
    return true;
}

async function rect(locator) {
    return await locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height};
    });
}

async function openPage() {
    await page.goto(url, {waitUntil: "load", timeout: 120_000});
    await page.waitForFunction(() => window.__G1__?.ready === true, null, {timeout: 120_000});
    await page.waitForTimeout(300);
}

async function verifyApproach(approach) {
    const prefix = approach;
    const baseline = await snapshot();
    await page.click(`[data-testid=load-${approach}]`);
    await page.locator(`[data-g1-plugin=${approach}]`).waitFor({timeout: 30_000});
    const root = page.locator(`[data-g1-plugin=${approach}]`);
    const mounted = await snapshot();

    const identity = await page.evaluate((a) => window.__G1__.identity[a], approach);
    check(`${prefix}.identity-shared`, identity?.vueRef && identity?.nbButton && identity?.sdkKey, identity);

    // 1 响应式
    await root.locator("[data-testid=plain-inc]").click();
    await root.locator("[data-testid=nb-inc]").click();
    const count = await root.locator("[data-testid=count]").textContent();
    check(`${prefix}.reactivity`, count === "2", {count});

    // 插件自己的 CSS（scoped）是否生效
    const pluginBorder = await root.evaluate((el) => getComputedStyle(el).borderTopStyle);
    check(`${prefix}.plugin-css`, pluginBorder === "dashed", {pluginBorder});

    // 2 i18n / 主题 / inject
    const i18nInitial = {text: await root.locator("[data-testid=i18n]").textContent(), locale: await root.locator("[data-testid=locale]").textContent()};
    await page.click("[data-testid=locale-en]");
    await page.waitForFunction((a) => document.querySelector(`[data-g1-plugin=${a}] [data-testid=i18n]`)?.textContent === "Cancel", approach, {timeout: 10_000}).catch(() => {});
    const i18nEn = {text: await root.locator("[data-testid=i18n]").textContent(), locale: await root.locator("[data-testid=locale]").textContent()};
    await page.click("[data-testid=locale-zh]");
    await page.waitForFunction((a) => document.querySelector(`[data-g1-plugin=${a}] [data-testid=i18n]`)?.textContent === "取消", approach, {timeout: 10_000}).catch(() => {});
    const i18nBack = await root.locator("[data-testid=i18n]").textContent();
    check(`${prefix}.i18n`, i18nInitial.text === "取消" && i18nInitial.locale === "zh-CN" && i18nEn.text === "Cancel" && i18nEn.locale === "en-US" && i18nBack === "取消", {i18nInitial, i18nEn, i18nBack});

    // 主题：插件内 nb-ui 按钮与宿主页面上的 nb-ui 按钮在两种主题下计算样式一致，且随主题切换变化。
    const nbStyle = async () => await page.evaluate((a) => {
        const pick = (el) => { const cs = getComputedStyle(el); return {bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, height: el.getBoundingClientRect().height}; };
        return {
            plugin: pick(document.querySelector(`[data-g1-plugin=${a}] [data-testid=nb-inc]`)),
            host: pick(document.querySelector("[data-testid=host-nb-button]")),
            pluginSecondary: pick(document.querySelector(`[data-g1-plugin=${a}] [data-testid=tooltip-trigger]`)),
            hostSecondary: pick(document.querySelector("[data-testid=host-nb-secondary]")),
            html: document.documentElement.className,
        };
    }, approach);
    const themeText = async () => await root.locator("[data-testid=theme]").textContent();
    // 刚被点击的插件按钮仍在 hover/active 过渡中，先移开指针并等过渡结束再比对计算样式。
    await page.mouse.move(2, 2);
    await page.waitForTimeout(800);
    const themeInitial = {text: await themeText(), ...(await nbStyle())};
    await page.click("[data-testid=theme-light]");
    await page.waitForFunction((a) => document.querySelector(`[data-g1-plugin=${a}] [data-testid=theme]`)?.textContent === "light", approach, {timeout: 10_000}).catch(() => {});
    await page.waitForTimeout(800);
    const themeLight = {text: await themeText(), ...(await nbStyle())};
    await page.click("[data-testid=theme-dark]");
    await page.waitForFunction((a) => document.querySelector(`[data-g1-plugin=${a}] [data-testid=theme]`)?.textContent === "dark", approach, {timeout: 10_000}).catch(() => {});
    await page.waitForTimeout(800);
    const themeBack = {text: await themeText(), ...(await nbStyle())};
    const same = (s) => JSON.stringify(s.plugin) === JSON.stringify(s.host) && JSON.stringify(s.pluginSecondary) === JSON.stringify(s.hostSecondary);
    check(`${prefix}.theme`, themeInitial.text === "dark" && themeLight.text === "light" && themeBack.text === "dark" && same(themeInitial) && same(themeLight) && same(themeBack), {themeInitial, themeLight, themeBack, pluginSecondaryChangedWithTheme: themeInitial.pluginSecondary.bg !== themeLight.pluginSecondary.bg || themeInitial.pluginSecondary.color !== themeLight.pluginSecondary.color});

    const injected = await root.locator("[data-testid=inject]").textContent();
    check(`${prefix}.inject-host-context`, injected === `g1-host:${approach}`, {injected});

    // 3 nb-ui 浮层：Tooltip（top，间距 6）与 Popover（bottom，间距 6），并验证宿主 provide 的 z-index 被 nb-ui 取到。
    const tooltipTrigger = root.locator("[data-testid=tooltip-trigger]");
    await tooltipTrigger.hover();
    const tooltip = page.locator(".nb-ui-tooltip-surface").filter({hasText: `tooltip-${approach}`});
    await tooltip.waitFor({state: "visible", timeout: 10_000});
    await page.waitForTimeout(300);
    const tooltipGeom = {trigger: await rect(tooltipTrigger), surface: await rect(tooltip)};
    const tooltipInfo = await tooltip.evaluate((el) => ({
        zIndex: el.style.zIndex,
        inSlot: Boolean(el.closest("[data-g1-slot]")),
        portalParent: el.closest("[data-reka-popper-content-wrapper]")?.parentElement?.tagName ?? null,
    }));
    const tooltipGap = tooltipGeom.trigger.top - tooltipGeom.surface.bottom;
    const tooltipCenterDelta = Math.abs((tooltipGeom.trigger.left + tooltipGeom.trigger.right) / 2 - (tooltipGeom.surface.left + tooltipGeom.surface.right) / 2);
    check(`${prefix}.tooltip`, tooltipGap >= 4 && tooltipGap <= 8 && tooltipCenterDelta <= 2 && tooltipInfo.zIndex === "4321" && !tooltipInfo.inSlot, {tooltipGap, tooltipCenterDelta, ...tooltipInfo, tooltipGeom});
    await page.mouse.move(5, 5);
    await tooltip.waitFor({state: "hidden", timeout: 10_000}).catch(() => {});

    const popoverTrigger = root.locator("[data-testid=popover-trigger]");
    await popoverTrigger.click();
    const popoverBody = page.locator(`[data-testid=popover-body-${approach}]`);
    await popoverBody.waitFor({state: "visible", timeout: 10_000});
    await page.waitForTimeout(400);
    const popover = page.locator(".nb-ui-popover-surface").filter({has: popoverBody});
    const popoverGeom = {trigger: await rect(popoverTrigger), surface: await rect(popover)};
    const popoverInfo = await popover.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return {zIndex: el.style.zIndex, inSlot: Boolean(el.closest("[data-g1-slot]")), topmostAtCenter: Boolean(hit && el.contains(hit)), text: el.textContent.trim()};
    });
    const popoverGap = popoverGeom.surface.top - popoverGeom.trigger.bottom;
    check(`${prefix}.popover`, popoverGap >= 4 && popoverGap <= 8 && popoverInfo.zIndex === "4321" && popoverInfo.topmostAtCenter && !popoverInfo.inSlot && popoverInfo.text.includes("确定") && popoverInfo.text.includes("2"), {popoverGap, ...popoverInfo, popoverGeom});
    await page.screenshot({path: resolve(outDir, `${label}-${approach}-popover.png`)});
    await page.keyboard.press("Escape");
    await popoverBody.waitFor({state: "hidden", timeout: 10_000}).catch(() => {});

    // 插件自己的全局监听器（resize）在挂载期间应存在
    const resizeListenerDuringMount = (await page.evaluate(() => window.__G1_LISTENERS__()))["window:resize"] ?? 0;

    // 4 卸载
    await page.click(`[data-testid=unload-${approach}]`);
    await page.waitForFunction((a) => document.querySelectorAll(`[data-g1-plugin=${a}]`).length === 0, approach, {timeout: 10_000});
    await page.waitForTimeout(600);
    const after = await snapshot();
    const listenerLeak = diffListeners(baseline.listeners, after.listeners);
    const tableState = await page.evaluate(() => ({has: window.__NB_MODULES__.has("example.g1"), ids: window.__NB_MODULES__.ids()}));
    const domClean = after.pluginNodes === 0 && after.tooltipSurfaces === 0 && after.popoverSurfaces === 0 && after.pluginCss === 0
        && after.pluginScripts === 0 && JSON.stringify(after.bodyChildren) === JSON.stringify(baseline.bodyChildren) && after.bodyStyle === baseline.bodyStyle;
    check(`${prefix}.unload-dom`, domClean, {baseline: {...baseline, listeners: undefined}, mounted: {...mounted, listeners: undefined}, after: {...after, listeners: undefined}});
    check(`${prefix}.unload-listeners`, Object.keys(listenerLeak).length === 0, {listenerLeakVsBaseline: listenerLeak, resizeListenerDuringMount, mountedDiff: diffListeners(baseline.listeners, mounted.listeners)});
    if (approach === "cjs") {
        check("cjs.table-entry-removed", !tableState.has && tableState.ids.length === 0, tableState);
    }
}

async function verifyErrorIsolation() {
    await page.click("[data-testid=load-esm]");
    await page.click("[data-testid=load-cjs]");
    await page.locator("[data-g1-plugin=esm]").waitFor();
    await page.locator("[data-g1-plugin=cjs]").waitFor();
    const hostBefore = Number(await page.textContent("[data-testid=host-count]"));

    // ESM 视图渲染期抛错
    await page.click("[data-g1-plugin=esm] [data-testid=throw-render]");
    await page.locator("[data-testid=slot-error-esm]").waitFor({timeout: 10_000});
    const esmError = await page.textContent("[data-testid=slot-error-esm]");
    await page.click("[data-g1-plugin=cjs] [data-testid=plain-inc]");
    const cjsCountAfterEsmError = await page.textContent("[data-g1-plugin=cjs] [data-testid=count]");
    await page.click("[data-testid=host-inc]");
    const hostAfter = Number(await page.textContent("[data-testid=host-count]"));
    check("error.render-isolated", esmError.includes("G1 plugin render error (esm)") && cjsCountAfterEsmError === "1" && hostAfter === hostBefore + 1, {esmError, cjsCountAfterEsmError, hostBefore, hostAfter});

    // CJS 视图事件处理函数抛错
    await page.click("[data-g1-plugin=cjs] [data-testid=throw-handler]");
    await page.locator("[data-testid=slot-error-cjs]").waitFor({timeout: 10_000});
    const cjsError = await page.textContent("[data-testid=slot-error-cjs]");
    await page.click("[data-testid=host-inc]");
    const hostAfter2 = Number(await page.textContent("[data-testid=host-count]"));
    check("error.handler-isolated", cjsError.includes("G1 plugin handler error (cjs)") && hostAfter2 === hostAfter + 1, {cjsError, hostAfter2});

    // 出错后重新加载可恢复；记录重新加载时是否拿到同一个模块对象
    await page.click("[data-testid=unload-esm]");
    await page.click("[data-testid=unload-cjs]");
    await page.waitForTimeout(300);
    await page.click("[data-testid=load-esm]");
    await page.click("[data-testid=load-cjs]");
    await page.locator("[data-g1-plugin=esm]").waitFor();
    await page.locator("[data-g1-plugin=cjs]").waitFor();
    await page.click("[data-g1-plugin=esm] [data-testid=plain-inc]");
    await page.click("[data-g1-plugin=cjs] [data-testid=plain-inc]");
    const recovered = {
        esm: await page.textContent("[data-g1-plugin=esm] [data-testid=count]"),
        cjs: await page.textContent("[data-g1-plugin=cjs] [data-testid=count]"),
        sameModuleOnReload: await page.evaluate(() => window.__G1__.sameModuleOnReload),
        capturedErrors: await page.evaluate(() => window.__G1__.errors),
    };
    check("error.recover-after-reload", recovered.esm === "1" && recovered.cjs === "1", recovered);
    await page.click("[data-testid=unload-esm]");
    await page.click("[data-testid=unload-cjs]");
    await page.waitForTimeout(300);
}

async function verifyCollectable(approach) {
    // 独立页面：加载、交互、卸载后强制 GC，看组件对象（与 CJS 工厂）是否可被回收。
    await openPage();
    // Vue 开发构建在没有 devtools 时会缓冲前 3 秒的组件事件（含组件对象）；等它清空，避免把开发期缓冲当成泄漏。
    await page.waitForTimeout(3500);
    await page.click(`[data-testid=load-${approach}]`);
    await page.locator(`[data-g1-plugin=${approach}]`).waitFor();
    await page.click(`[data-g1-plugin=${approach}] [data-testid=plain-inc]`);
    await page.click(`[data-g1-plugin=${approach}] [data-testid=popover-trigger]`);
    await page.locator(`[data-testid=popover-body-${approach}]`).waitFor({state: "visible"});
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.click(`[data-testid=unload-${approach}]`);
    await page.waitForFunction((a) => document.querySelectorAll(`[data-g1-plugin=${a}]`).length === 0, approach);
    await page.waitForTimeout(500);
    const collected = await collectGarbage();
    const result = await page.evaluate((a) => {
        const weak = window.__G1__.weak[a] ?? {};
        return {
            componentCollected: weak.component ? weak.component.deref() === undefined : null,
            factoryCollected: weak.factory ? weak.factory.deref() === undefined : null,
        };
    }, approach);
    report.checks[`${approach}.gc-after-unload`] = {pass: null, detail: {forcedGc: collected, ...result}};
    console.log(`INFO ${approach}.gc-after-unload ${JSON.stringify({forcedGc: collected, ...result})}`);
}

try {
    await openPage();
    const bootstrap = await page.evaluate(async () => {
        const first = document.head.firstElementChild;
        const scripts = [...document.head.querySelectorAll("script, link[rel=modulepreload]")].map((el) => el.tagName === "LINK" ? "modulepreload" : (el.type || "classic"));
        const drift = {};
        for (const [file, spec] of [["vue.js", "vue"], ["nb-ui-components.js", "@notnotype/nb-ui/components"], ["plugin-sdk.js", "@neurobook/plugin-sdk"]]) {
            const text = await (await fetch(`/g1-shared/${file}`)).text();
            const names = new Set(text.match(/export const \{([^}]*)\}/u)[1].split(",").map((s) => s.trim()).filter(Boolean));
            const runtime = new Set(Object.keys(window.__NB_SHARED__[spec]).filter((n) => n !== "default"));
            drift[spec] = {forwarderOnly: [...names].filter((n) => !runtime.has(n)), runtimeOnly: [...runtime].filter((n) => !names.has(n)), count: names.size};
        }
        return {
            importMapFirstInHead: first?.tagName === "SCRIPT" && first.type === "importmap",
            supportsImportMap: typeof HTMLScriptElement.supports === "function" ? HTMLScriptElement.supports("importmap") : "no-supports-api",
            headScriptOrder: scripts.slice(0, 6),
            forwarderDrift: drift,
            userAgent: navigator.userAgent,
        };
    });
    const driftFree = Object.values(bootstrap.forwarderDrift).every((d) => d.forwarderOnly.length === 0 && d.runtimeOnly.length === 0);
    check("esm.importmap-bootstrap", bootstrap.importMapFirstInHead && bootstrap.supportsImportMap === true, bootstrap);
    check("esm.forwarder-export-list-matches-runtime", driftFree, bootstrap.forwarderDrift);

    await verifyApproach("esm");
    await verifyApproach("cjs");
    await verifyErrorIsolation();
    report.pageErrorsAfterFunctional = [...report.pageErrors];
    await page.screenshot({path: resolve(outDir, `${label}-final.png`)});
    await verifyCollectable("cjs");
    await verifyCollectable("esm");
} catch (error) {
    report.fatal = String(error?.stack ?? error);
    console.error("FATAL", error);
    await page.screenshot({path: resolve(outDir, `${label}-fatal.png`)}).catch(() => {});
} finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(resolve(outDir, `${label}.json`), JSON.stringify(report, null, 2));
    // CDP 接入的 Electron 由外部启动器负责停止；这里只断开，不关闭窗口。
    if (browserKind !== "cdp") {
        await browser.close();
    }
}
const failed = Object.entries(report.checks).filter(([, v]) => v.pass === false).map(([k]) => k);
const summaryLine = `SUMMARY ${label}: ${failed.length === 0 && !report.fatal ? "ALL PASS" : `FAILED ${failed.join(", ")}${report.fatal ? " FATAL" : ""}`}; pageErrors=${report.pageErrors.length}`;
console.log(summaryLine);
process.exit(0);
