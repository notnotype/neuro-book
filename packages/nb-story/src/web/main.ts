import "./app.css";
import {LAYOUT_TEXT_KEY, layoutCatalogTranslate} from "@notnotype/nb-layout/text";
import {createApp} from "vue";

import App from "./App.vue";
import {installAppearance} from "./host/theme";
import {router} from "./router";

installAppearance();
// 界面只有中文：分栏的读屏文字取 nb-layout 自带的中文目录（它没有注入时是英文，docs/specs/ui/i18n.md 输出 8）。
createApp(App).provide(LAYOUT_TEXT_KEY, layoutCatalogTranslate("zh-CN")).use(router).mount("#app");
