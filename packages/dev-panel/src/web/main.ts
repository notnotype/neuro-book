import "./app.css";
import {createApp} from "vue";
import App from "./App.vue";
import {installLayoutText} from "./host/layout-text.js";
import {readAppearance} from "./host/prefs.js";
import {applyAppearance} from "./host/theme.js";
import {router} from "./router.js";

applyAppearance(readAppearance());
installLayoutText(createApp(App)).use(router).mount("#app");
