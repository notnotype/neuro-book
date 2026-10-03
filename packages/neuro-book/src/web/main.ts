/**
 * 前端入口（runtime.browser-host 启动序列）：先建立窗口运行实例、激活 `nbook.workbench`，再挂载界面。
 * 挂载时窗口要么已经 ready，要么已经落在某种失败状态，所以首屏不会出现半个工作台。
 */

import {createApp} from "vue";

import App from "./App.vue";
import {createConnection} from "./host/connection";
import {createBrowserWindow} from "./host/window";
import "./styles.css";

const browserWindow = createBrowserWindow({connection: createConnection(location.origin), page: window, console});
await browserWindow.start();
createApp(App, {browserWindow}).mount("#app");
