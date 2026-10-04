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

import {createConnection} from "./host/connection";
import {createBrowserWindow} from "./host/window";
import {mountWindowUi} from "./mount";

const container = document.querySelector("#app");
if (container === null) throw new Error("index.html 缺少 #app");
const browserWindow = createBrowserWindow({connection: createConnection(location.origin), page: window, console});
await browserWindow.start();
await mountWindowUi({
    browserWindow,
    container,
    history: createWebHistory(),
    navigateDocument: (href) => location.assign(href),
    reloadDocument: () => location.reload(),
});
