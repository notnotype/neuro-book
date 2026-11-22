import "./app.css";
// nb-layout 组件的样式：构建时是编译产物的 style.css，走源码时是它的 global.css（scoped 样式随组件编译）。
import "@notnotype/nb-layout/style.css";
import {createApp} from "vue";

import App from "./App.vue";
import {installLayoutText} from "./host/layout-text";
import {installAppearance} from "./host/theme";
import {router} from "./router";

installAppearance();
installLayoutText(createApp(App)).use(router).mount("#app");
