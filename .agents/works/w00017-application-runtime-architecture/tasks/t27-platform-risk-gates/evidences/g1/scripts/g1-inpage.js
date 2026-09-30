// G1 页内验证：没有 Playwright/CDP 的宿主（WebKitGTK，即 Tauri 在 Linux 上的引擎）用它跑同一组检查。
// 只用 DOM API 与合成事件；结果写到 window.__G1_RESULT__，由外部驱动程序读取。
(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (fn, timeout = 10000) => {
        const started = performance.now();
        while (performance.now() - started < timeout) {
            const value = fn();
            if (value) return value;
            await sleep(50);
        }
        throw new Error(`timeout waiting for ${fn.toString().slice(0, 160)}`);
    };
    const $ = (selector, root = document) => root.querySelector(selector);
    const checks = {};
    const check = (name, pass, detail) => { checks[name] = {pass: Boolean(pass), detail}; };
    const rect = (el) => { const r = el.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right}; };
    const visible = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
    const snapshot = () => ({
        listeners: window.__G1_LISTENERS__(),
        bodyChildren: [...document.body.children].map((el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "")),
        pluginNodes: document.querySelectorAll("[data-g1-plugin]").length,
        tooltipSurfaces: document.querySelectorAll(".nb-ui-tooltip-surface").length,
        popoverSurfaces: document.querySelectorAll(".nb-ui-popover-surface").length,
        pluginCss: document.querySelectorAll("link[data-g1-plugin-css]").length,
        pluginScripts: document.querySelectorAll("script[src*='g1-plugins']").length,
        bodyStyle: document.body.getAttribute("style"),
    });
    const diff = (before, after) => {
        const out = {};
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
            const delta = (after[key] ?? 0) - (before[key] ?? 0);
            if (delta !== 0) out[key] = delta;
        }
        return out;
    };
    const pointer = (el, type) => {
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new PointerEvent(type, {bubbles: type !== "pointerenter" && type !== "pointerleave", cancelable: true, composed: true, pointerType: "mouse", clientX: r.left + r.width / 2, clientY: r.top + r.height / 2}));
    };
    const pick = (el) => { const cs = getComputedStyle(el); return {bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, height: el.getBoundingClientRect().height}; };

    async function verifyApproach(a) {
        const baseline = snapshot();
        $(`[data-testid=load-${a}]`).click();
        const root = await waitFor(() => $(`[data-g1-plugin=${a}]`), 30000);
        const mounted = snapshot();
        const identity = window.__G1__.identity[a];
        check(`${a}.identity-shared`, identity?.vueRef && identity?.nbButton && identity?.sdkKey, identity);

        $("[data-testid=plain-inc]", root).click();
        $("[data-testid=nb-inc]", root).click();
        await sleep(50);
        const count = $("[data-testid=count]", root).textContent;
        check(`${a}.reactivity`, count === "2", {count});
        check(`${a}.plugin-css`, getComputedStyle(root).borderTopStyle === "dashed", {border: getComputedStyle(root).borderTopStyle});

        const text = (id) => $(`[data-testid=${id}]`, root).textContent;
        const i18nInitial = {text: text("i18n"), locale: text("locale")};
        $("[data-testid=locale-en]").click();
        await waitFor(() => text("i18n") === "Cancel").catch(() => {});
        const i18nEn = {text: text("i18n"), locale: text("locale")};
        $("[data-testid=locale-zh]").click();
        await waitFor(() => text("i18n") === "取消").catch(() => {});
        check(`${a}.i18n`, i18nInitial.text === "取消" && i18nEn.text === "Cancel" && i18nEn.locale === "en-US" && text("i18n") === "取消", {i18nInitial, i18nEn});

        const styles = () => ({
            text: text("theme"),
            plugin: pick($("[data-testid=nb-inc]", root)), host: pick($("[data-testid=host-nb-button]")),
            pluginSecondary: pick($("[data-testid=tooltip-trigger]", root)), hostSecondary: pick($("[data-testid=host-nb-secondary]")),
        });
        const same = (s) => JSON.stringify(s.plugin) === JSON.stringify(s.host) && JSON.stringify(s.pluginSecondary) === JSON.stringify(s.hostSecondary);
        await sleep(800);
        const themeInitial = styles();
        $("[data-testid=theme-light]").click();
        await waitFor(() => text("theme") === "light").catch(() => {});
        await sleep(800);
        const themeLight = styles();
        $("[data-testid=theme-dark]").click();
        await waitFor(() => text("theme") === "dark").catch(() => {});
        await sleep(800);
        const themeBack = styles();
        check(`${a}.theme`, themeInitial.text === "dark" && themeLight.text === "light" && themeBack.text === "dark" && same(themeInitial) && same(themeLight) && same(themeBack), {themeInitial, themeLight, themeBack});
        check(`${a}.inject-host-context`, text("inject") === `g1-host:${a}`, {inject: text("inject")});

        const tooltipTrigger = $("[data-testid=tooltip-trigger]", root);
        pointer(tooltipTrigger, "pointerenter");
        pointer(tooltipTrigger, "pointermove");
        const tooltip = await waitFor(() => [...document.querySelectorAll(".nb-ui-tooltip-surface")].find((el) => el.textContent.includes(`tooltip-${a}`) && visible(el)));
        await sleep(300);
        const tt = {trigger: rect(tooltipTrigger), surface: rect(tooltip)};
        const tooltipGap = tt.trigger.top - tt.surface.bottom;
        const tooltipCenterDelta = Math.abs((tt.trigger.left + tt.trigger.right) / 2 - (tt.surface.left + tt.surface.right) / 2);
        check(`${a}.tooltip`, tooltipGap >= 4 && tooltipGap <= 8 && tooltipCenterDelta <= 2 && tooltip.style.zIndex === "4321" && !tooltip.closest("[data-g1-slot]"), {tooltipGap, tooltipCenterDelta, zIndex: tooltip.style.zIndex, tt});
        pointer(tooltipTrigger, "pointerleave");
        await waitFor(() => !document.querySelector(".nb-ui-tooltip-surface")).catch(() => {});

        const popoverTrigger = $("[data-testid=popover-trigger]", root);
        popoverTrigger.click();
        const body = await waitFor(() => { const el = $(`[data-testid=popover-body-${a}]`); return visible(el) ? el : null; });
        await sleep(400);
        const surface = body.closest(".nb-ui-popover-surface");
        const pg = {trigger: rect(popoverTrigger), surface: rect(surface)};
        const hit = document.elementFromPoint((pg.surface.left + pg.surface.right) / 2, (pg.surface.top + pg.surface.bottom) / 2);
        const popoverGap = pg.surface.top - pg.trigger.bottom;
        check(`${a}.popover`, popoverGap >= 4 && popoverGap <= 8 && surface.style.zIndex === "4321" && Boolean(hit && surface.contains(hit)) && !surface.closest("[data-g1-slot]") && surface.textContent.includes("确定"), {popoverGap, zIndex: surface.style.zIndex, topmostAtCenter: Boolean(hit && surface.contains(hit)), text: surface.textContent.trim(), pg});
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        await waitFor(() => !$(`[data-testid=popover-body-${a}]`)).catch(() => {});

        $(`[data-testid=unload-${a}]`).click();
        await waitFor(() => document.querySelectorAll(`[data-g1-plugin=${a}]`).length === 0);
        await sleep(600);
        const after = snapshot();
        const domClean = after.pluginNodes === 0 && after.tooltipSurfaces === 0 && after.popoverSurfaces === 0 && after.pluginCss === 0 && after.pluginScripts === 0
            && JSON.stringify(after.bodyChildren) === JSON.stringify(baseline.bodyChildren) && after.bodyStyle === baseline.bodyStyle;
        check(`${a}.unload-dom`, domClean, {after: {...after, listeners: undefined, bodyStyle: undefined}, baselineBodyChildren: baseline.bodyChildren});
        const leak = diff(baseline.listeners, after.listeners);
        check(`${a}.unload-listeners`, Object.keys(leak).length === 0, {leak, mountedDiff: diff(baseline.listeners, mounted.listeners)});
        if (a === "cjs") {
            check("cjs.table-entry-removed", !window.__NB_MODULES__.has("example.g1"), {ids: window.__NB_MODULES__.ids()});
        }
    }

    async function verifyErrors() {
        $("[data-testid=load-esm]").click();
        $("[data-testid=load-cjs]").click();
        await waitFor(() => $("[data-g1-plugin=esm]") && $("[data-g1-plugin=cjs]"));
        const hostBefore = Number($("[data-testid=host-count]").textContent);
        $("[data-g1-plugin=esm] [data-testid=throw-render]").click();
        const esmError = (await waitFor(() => $("[data-testid=slot-error-esm]"))).textContent;
        $("[data-g1-plugin=cjs] [data-testid=plain-inc]").click();
        $("[data-testid=host-inc]").click();
        await sleep(50);
        const cjsCount = $("[data-g1-plugin=cjs] [data-testid=count]").textContent;
        const hostAfter = Number($("[data-testid=host-count]").textContent);
        check("error.render-isolated", esmError.includes("G1 plugin render error (esm)") && cjsCount === "1" && hostAfter === hostBefore + 1, {esmError, cjsCount, hostBefore, hostAfter});
        $("[data-g1-plugin=cjs] [data-testid=throw-handler]").click();
        const cjsError = (await waitFor(() => $("[data-testid=slot-error-cjs]"))).textContent;
        $("[data-testid=host-inc]").click();
        await sleep(50);
        check("error.handler-isolated", cjsError.includes("G1 plugin handler error (cjs)") && Number($("[data-testid=host-count]").textContent) === hostAfter + 1, {cjsError});
        $("[data-testid=unload-esm]").click();
        $("[data-testid=unload-cjs]").click();
        await sleep(300);
        $("[data-testid=load-esm]").click();
        $("[data-testid=load-cjs]").click();
        await waitFor(() => $("[data-g1-plugin=esm]") && $("[data-g1-plugin=cjs]"));
        $("[data-g1-plugin=esm] [data-testid=plain-inc]").click();
        $("[data-g1-plugin=cjs] [data-testid=plain-inc]").click();
        await sleep(50);
        const recovered = {esm: $("[data-g1-plugin=esm] [data-testid=count]").textContent, cjs: $("[data-g1-plugin=cjs] [data-testid=count]").textContent, sameModuleOnReload: window.__G1__.sameModuleOnReload};
        check("error.recover-after-reload", recovered.esm === "1" && recovered.cjs === "1", recovered);
        $("[data-testid=unload-esm]").click();
        $("[data-testid=unload-cjs]").click();
        await sleep(300);
    }

    async function negativeControl() {
        $("[data-testid=load-selfvue]").click();
        const root = await waitFor(() => $("[data-g1-plugin=selfvue]"), 30000);
        $("[data-testid=plain-inc]", root).click();
        await sleep(300);
        const result = {identity: window.__G1__.identity.selfvue, countAfterClick: $("[data-testid=count]", root).textContent, inject: $("[data-testid=inject]", root).textContent};
        $("[data-testid=unload-selfvue]").click();
        await sleep(300);
        return result;
    }

    await waitFor(() => window.__G1__?.ready === true, 60000);
    await sleep(500);
    if (new URLSearchParams(location.search).has("g1-late-importmap")) {
        // 迟到 import map：HTML 里没有，启动完成后再插入，然后加载 ESM 插件。
        const hadImportMap = Boolean(document.querySelector("script[type=importmap]"));
        const script = document.createElement("script");
        script.type = "importmap";
        script.textContent = JSON.stringify({imports: {"vue": "/g1-shared/vue.js", "@notnotype/nb-ui/components": "/g1-shared/nb-ui-components.js", "@neurobook/plugin-sdk": "/g1-shared/plugin-sdk.js"}});
        document.head.appendChild(script);
        $("[data-testid=load-esm]").click();
        await waitFor(() => ["mounted", "load-failed", "failed"].includes($("[data-testid=slot-status-esm]")?.textContent ?? ""), 20000).catch(() => {});
        window.__G1_RESULT__ = {lateImportMap: {hadImportMap, status: $("[data-testid=slot-status-esm]").textContent, error: $("[data-testid=slot-error-esm]")?.textContent ?? null, userAgent: navigator.userAgent}};
        return;
    }
    const first = document.head.firstElementChild;
    const bootstrap = {
        importMapFirstInHead: first?.tagName === "SCRIPT" && first.type === "importmap",
        supportsImportMap: typeof HTMLScriptElement.supports === "function" ? HTMLScriptElement.supports("importmap") : "no-supports-api",
        userAgent: navigator.userAgent,
    };
    check("esm.importmap-bootstrap", bootstrap.importMapFirstInHead && bootstrap.supportsImportMap === true, bootstrap);
    const errors = [];
    window.addEventListener("error", (event) => errors.push(String(event.message)));
    window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
    await verifyApproach("esm");
    await verifyApproach("cjs");
    await verifyErrors();
    const negative = await negativeControl();
    window.__G1_RESULT__ = {checks, negative, pageErrors: errors, capturedErrors: window.__G1__.errors};
})().catch((error) => {
    window.__G1_RESULT__ = {fatal: String(error?.stack ?? error)};
});
