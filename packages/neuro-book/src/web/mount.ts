/**
 * 挂载窗口界面（runtime.browser-host 启动序列第 5 步）：窗口 ready 时按页面表建立路由、等首次导航完成（页面模块
 * 已加载）再挂载；还没 ready 时先挂宿主页，重试成功后换成页面。任何时刻屏幕上要么是宿主页，要么是完整的页面。
 */

import {createApp} from "vue";
import type {RouterHistory} from "vue-router";

import FailurePage from "./FailurePage.vue";
import HostPage from "./HostPage.vue";
import PageOutlet from "./PageOutlet.vue";
import type {BrowserWindow, ReadyWindowState} from "./host/window";
import {createPageRouter} from "./router";

export interface WindowUiOptions {
    readonly browserWindow: BrowserWindow;
    readonly container: Element;
    readonly history: RouterHistory;
    /** 整页加载到 `href`；生产是 `location.assign`。 */
    readonly navigateDocument: (href: string) => void;
    /** 重新加载当前文档；生产是 `location.reload`。 */
    readonly reloadDocument: () => void;
}

export async function mountWindowUi(options: WindowUiOptions): Promise<void> {
    const current = options.browserWindow.state;
    if (current.status === "ready") {
        await mountPages(options, current);
        return;
    }
    const host = createApp(HostPage, {
        browserWindow: options.browserWindow,
        onReady: (ready: ReadyWindowState) => {
            host.unmount();
            void mountPages(options, ready);
        },
        onReload: options.reloadDocument,
    });
    host.mount(options.container);
}

async function mountPages(options: WindowUiOptions, ready: ReadyWindowState): Promise<void> {
    const router = createPageRouter({pages: ready.root.pages(), history: options.history, navigateDocument: options.navigateDocument});
    const app = createApp(PageOutlet, {browserWindow: options.browserWindow, onReload: options.reloadDocument});
    app.use(router);
    try {
        await router.isReady();
    } catch (error) {
        // 首次导航失败（页面模块加载失败）：不挂半个页面，显示只能刷新的启动失败页。
        const reason = error instanceof Error ? error.message : String(error);
        createApp(FailurePage, {state: {status: "startup-failed", reason}, onReload: options.reloadDocument}).mount(options.container);
        return;
    }
    app.mount(options.container);
}
