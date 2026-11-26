import "./app.css";
import {createWebHistory} from "vue-router";

import {browserClock} from "./host/clock";
import {startSite} from "./site";

// 浏览器的真东西都在这里交给 `startSite`；装法本身在 `site.ts`，由组件测试守着。
const target = document.getElementById("app");
if (target === null) throw new Error("index.html 里没有 #app");
startSite({
    target,
    window,
    fetch: globalThis.fetch.bind(globalThis),
    history: createWebHistory(),
    clock: browserClock(window),
    leave: (url) => window.location.assign(url),
});
