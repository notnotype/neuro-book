import "./app.css";
import {createApp} from "vue";

import App from "./App.vue";
import {installLayoutText} from "./host/layout-text";
import {installAppearance} from "./host/theme";
import {router} from "./router";

installAppearance();
installLayoutText(createApp(App)).use(router).mount("#app");
