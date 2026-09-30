import G1Widget from "./G1Widget.vue";

// 身份探针：宿主用这些重新导出的绑定判断插件拿到的是不是宿主那一份 Vue、nb-ui 与 SDK。
export {ref as probeVueRef} from "vue";
export {Button as probeNbButton} from "@notnotype/nb-ui/components";
export {PLUGIN_HOST_CONTEXT as probeSdkKey} from "@neurobook/plugin-sdk";

export const pluginId = "example.g1";
export const component = G1Widget;
