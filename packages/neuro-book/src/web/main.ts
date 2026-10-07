/**
 * 前端入口（runtime.browser-host 启动序列）：先建立窗口运行实例、激活 `nbook.workbench`，再挂载界面。
 * 挂载时窗口要么已经 ready，要么已经落在某种失败状态，所以首屏不会出现半个工作台。
 */

// 样式顺序：reset 在最前（nb-ui 不带 reset，由消费方负责）；UnoCSS 在 nb-ui 之后，否则 nb-ui 对 `i-lucide-*` 的同特异性
// 规则会盖掉 UnoCSS 的图标遮罩；宿主样式最后。
import "the-new-css-reset/css/reset.css";
import "@notnotype/nb-ui/styles.css";
import "virtual:uno.css";
import "./styles.css";

import {createWebHistory} from "vue-router";

import {readClientIdentity} from "./host/client-identity";
import {createConnection} from "./host/connection";
import {createBrowserWindow} from "./host/window";
import {mountWindowUi} from "./mount";
import {browserPluginFactories, builtinBrowserPlugins} from "./plugins";

const container = document.querySelector("#app");
if (container === null) throw new Error("index.html 缺少 #app");
// 开发清单里的插件（Lab）只在开发模式加载；生产构建把这个分支连同它动态加载的模块一起去掉。
const development = import.meta.env.DEV ? await import("./development-plugins") : null;
const clientIdentity = readClientIdentity(() => window.localStorage);
if (clientIdentity.problem !== null) console.warn(`[nbook] ${clientIdentity.problem}；客户端身份只在本页有效`);
const browserWindow = createBrowserWindow({
    connection: createConnection(location.origin),
    page: window,
    console,
    clientIdentity: clientIdentity.id,
    builtin: [...builtinBrowserPlugins, ...(development?.developmentBrowserPlugins ?? [])],
    factories: {...browserPluginFactories, ...development?.developmentBrowserPluginFactories},
});
await browserWindow.start();
await mountWindowUi({
    browserWindow,
    container,
    history: createWebHistory(),
    navigateDocument: (href) => location.assign(href),
    reloadDocument: () => location.reload(),
});
