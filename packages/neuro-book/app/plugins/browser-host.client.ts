import {createBrowserWindowHost, routeNeedsBrowserRuntime, type BrowserWindowHost} from "nbook/app/runtime/browser-window";
import {workbenchBrowserPlugin} from "nbook/app/features/workbench/browser-plugin";
import {filesBrowserPlugin} from "nbook/app/features/files/browser-plugin";
import {BROWSER_BOOTSTRAP_PATH} from "nbook/shared/browser-bootstrap";

export default defineNuxtPlugin<{browserWindow: BrowserWindowHost}>({
    name: "browser-host",
    dependsOn: ["product-host"],
    async setup(): Promise<{provide: {browserWindow: BrowserWindowHost}}> {
        const browserWindow = createBrowserWindowHost({
            instanceId: crypto.randomUUID(),
            page: window,
            fetchBootstrap: () => $fetch<unknown>(BROWSER_BOOTSTRAP_PATH, {method: "GET", retry: 0}),
            plugins: [workbenchBrowserPlugin(import.meta.dev), filesBrowserPlugin()],
            report: (error) => console.error("[browser-host] 窗口启动失败", error),
        });
        if (routeNeedsBrowserRuntime(useRouter().currentRoute.value)) await browserWindow.start();
        return {provide: {browserWindow}};
    },
});
