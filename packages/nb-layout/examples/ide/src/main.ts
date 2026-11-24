// 入口：样式导入一次、开发时打开接线检查、挂载。
//
// 样式：组件的样式在 style.css 里，不导入时分隔线没有光标、落点反馈没有颜色，但不报错，很难发现。
import "@notnotype/nb-layout/style.css";

import {createApp} from "vue";
import {setLayoutDevChecks} from "@notnotype/nb-layout";

import App from "./App.vue";

// 接线检查：网格挂载之前打开。它在手势开始时核对 NestedGrid 拿到的上下文与版本是不是 useGridHost 给的，
// 绑错了会在控制台说出来，而不是“拖不动、没有提示”。库不读构建环境，开不开由宿主定；发布构建里关掉。
setLayoutDevChecks(import.meta.env.DEV);

// 文字：这里没有注入翻译函数，库的读屏文字用自带的英文。要换语言，provide 库的 LAYOUT_TEXT_KEY（见包的 README“文字”）。
createApp(App).mount("#app");
