/**
 * 窗口启动（runtime.browser-host 启动序列）：先建立窗口运行实例、连上服务端、激活 `nbook.workbench`，再挂载界面。
 * 挂载时窗口要么已经 ready，要么已经落在某种失败状态，所以首屏不会出现半个工作台。产品入口与 e2e 的测试外壳都经这里，
 * 两者只差构建进去的插件。
 */

// 样式入口先导入（`nbook-tailwind.css`，由 vite.config.ts 按开发或生产选文件）：层的先后由最先出现的 `@layer` 声明定，styles.css 里也有 `@layer base`，在前会打乱 theme、base、components、utilities 的顺序。
import "nbook-tailwind.css";
import "./styles.css";

import {createApp, watchEffect} from "vue";
import {createWebHistory} from "vue-router";

import {readClientIdentity} from "@notnotype/nb-host/web";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";

import type {PluginDescriptor} from "nbook/manifest";
import {createDesktopBridge} from "nbook/shared/desktop-bridge";
import type {WindowNavigation} from "nbook/shared/host";

import CloseLayer from "./CloseLayer.vue";

import {rememberDocumentAppearance} from "./host/appearance-hint";
import {CLIENT_IDENTITY_KEY} from "./host/client-identity";
import {createCloseQuery} from "./host/close-query";
import {createCloseUi, installCloseKeyGuard} from "./host/close-ui";
import {createConnection} from "./host/connection";
import {createDesktopUpdates} from "./host/desktop-updates";
import {readLocaleHint, writeLocaleHint} from "./host/locale-hint";
import {createHostTextEngine} from "./host/text-engine";
import {createBrowserWindow} from "./host/window";
import {hostText} from "./host-text";
import {mountWindowUi} from "./mount";

export interface WindowUiBoot {
    /** 本外壳构建进去的浏览器插件及其定义（宿主适配器固定在 `plugins.ts`）。 */
    readonly builtin: ReadonlyArray<PluginDescriptor>;
    readonly definitions: Readonly<Record<string, PluginDefinition>>;
}

export async function bootWindowUi(options: WindowUiBoot): Promise<void> {
    const container = document.querySelector("#app");
    if (container === null) throw new Error("index.html 缺少 #app");
    const clientIdentity = readClientIdentity(CLIENT_IDENTITY_KEY, () => window.localStorage);
    if (clientIdentity.problem !== null) console.warn(`[nbook] ${clientIdentity.problem}；客户端身份只在本页有效`);
    // 页面存活期间一直记录，不停止：下一次打开时加载页的第一帧用这里记下的明暗与颜色。
    rememberDocumentAppearance({root: document.documentElement, storage: () => window.localStorage, warn: (message) => console.warn(`[nbook] ${message}`)});
    // 设置插件激活前用上次记下的界面语言；激活后由它推当前值（docs/specs/runtime/browser-host.md）。
    const text = createHostTextEngine({
        locale: readLocaleHint(() => window.localStorage) ?? "zh-CN",
        remember: (tag) => writeLocaleHint(() => window.localStorage, tag, (message) => console.warn(`[nbook] ${message}`)),
        report: (problem) => console.warn(`[nbook] text ${problem.kind}: ${problem.ns ?? ""} ${problem.key}${problem.param === undefined ? "" : ` (${problem.param})`}`),
    });
    // <html lang> 跟随当前界面语言（屏幕阅读器按它选发音）；加载页在脚本运行前已按本地记录设过一次（index.html）。
    watchEffect(() => {
        document.documentElement.lang = text.port.locale.value;
    });
    const navigation: WindowNavigation = {
        navigateDocument: (href) => location.assign(href),
        reloadDocument: () => location.reload(),
        openExternal: (href) => {
            // 不用 `noopener` 特性：带上它时 window.open 总是返回 null，分不出是否被拦截；打开后再切断 opener。
            const opened = window.open(href, "_blank");
            if (opened === null) return "blocked";
            opened.opener = null;
            return "opened";
        },
        currentUrl: () => location.href,
        replaceUrl: (href) => history.replaceState(history.state, "", href),
    };
    const connection = createConnection(location.origin);
    const browserWindow = createBrowserWindow({
        connection,
        page: window,
        console,
        navigation,
        project: new URLSearchParams(location.search).get("project"),
        clientIdentity: clientIdentity.id,
        text,
        builtin: options.builtin,
        definitions: options.definitions,
        // 第三方插件浏览器入口的共享模块；第一个第三方入口激活时才加载。
        pluginModules: async () => (await import("./host/plugin-modules")).hostModules(),
    });
    // 关闭前询问（docs/specs/runtime/browser-host.md 输出 9、10）：在启动之前建好，启动中桌面壳来问也能立即接下。普通浏览器里
    // 不会有壳的事件，这些只是空等。键盘拦截要早于工作台键位注册，所以也在挂载界面之前。层是独立的 Vue 根，挂在 `body`
    // 下、不随宿主页与工作台切换卸载。
    const closeRoot = document.createElement("div");
    closeRoot.dataset.closeRoot = "";
    document.body.append(closeRoot);
    const closeUi = createCloseUi({document, ownRoot: () => closeRoot});
    const bridge = createDesktopBridge(window);
    const closeQuery = createCloseQuery({
        bridge,
        window: browserWindow,
        fetchWork: (signal) => connection.work(signal),
        prompts: closeUi.prompts,
        layer: closeUi.layer,
        report: (input) => browserWindow.record(input),
        clock: systemClock,
    });
    browserWindow.setCloseAgreed(() => closeQuery.agreed);
    installCloseKeyGuard(window, () => closeQuery.active);
    createApp(CloseLayer, {ui: closeUi}).provide(TEXT_PORT_KEY, text.port).mount(closeRoot);
    // 更新提示（docs/specs/runtime/browser-host.md 输出 11）：与关闭前询问同时建立，启动中壳交来的提示先存着，页面挂好后再显示。
    const desktopUpdates = createDesktopUpdates({bridge, window: browserWindow, page: window, report: (input) => browserWindow.record(input)});
    // 启动期间屏幕上只有 index.html 的静态加载页（界面在 start 之后才挂载）：引导给出书名后写进它预留的位置。
    const stopTitle = browserWindow.onChange((state) => {
        if (state.status !== "starting" || state.projectTitle === null) return;
        const title = container.querySelector("[data-host-loading-title]");
        const hint = container.querySelector("[data-host-loading-hint]");
        if (title !== null) title.textContent = state.projectTitle;
        if (hint !== null) hint.textContent = text.port.t(hostText("loading.opening"));
    });
    await browserWindow.start();
    stopTitle();
    await mountWindowUi({
        browserWindow,
        container,
        history: createWebHistory(),
        navigateDocument: navigation.navigateDocument,
        reloadDocument: navigation.reloadDocument,
        onPagesMounted: () => desktopUpdates.pagesMounted(),
    });
}
