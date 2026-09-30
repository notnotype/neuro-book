import { computed, createElementBlock, createElementVNode, createTextVNode, createVNode, defineComponent, inject, onBeforeUnmount, onMounted, openBlock, ref, ref as probeVueRef, toDisplayString, unref, withCtx } from "vue";
import { Button, Button as probeNbButton, Popover, Tooltip } from "@notnotype/nb-ui/components";
import { PLUGIN_HOST_CONTEXT, PLUGIN_HOST_CONTEXT as probeSdkKey, useHostColorMode, useHostI18n } from "@neurobook/plugin-sdk";
//#region src/G1Widget.vue?vue&type=script&setup=true&lang.ts
var _hoisted_1 = ["data-g1-plugin"];
var _hoisted_2 = { class: "g1-plugin__row" };
var _hoisted_3 = { "data-testid": "count" };
var _hoisted_4 = { class: "g1-plugin__row" };
var _hoisted_5 = { "data-testid": "i18n" };
var _hoisted_6 = { "data-testid": "locale" };
var _hoisted_7 = { "data-testid": "theme" };
var _hoisted_8 = { "data-testid": "inject" };
var _hoisted_9 = { class: "g1-plugin__row" };
var _hoisted_10 = ["data-testid"];
var _hoisted_11 = { class: "g1-plugin__row" };
var _hoisted_12 = { "data-testid": "render-probe" };
var _hoisted_13 = { "data-testid": "resize-events" };
var G1Widget_vue_vue_type_script_setup_true_lang_default = /*@__PURE__*/ defineComponent({
	__name: "G1Widget",
	props: { variant: {} },
	setup(__props) {
		const props = __props;
		const count = ref(0);
		const host = inject(PLUGIN_HOST_CONTEXT, null);
		const { t, locale } = useHostI18n();
		const colorMode = useHostColorMode();
		const popoverOpen = ref(false);
		const renderBoom = ref(false);
		const resizeEvents = ref(0);
		function onResize() {
			resizeEvents.value += 1;
		}
		onMounted(() => window.addEventListener("resize", onResize));
		onBeforeUnmount(() => window.removeEventListener("resize", onResize));
		const renderProbe = computed(() => {
			if (renderBoom.value) throw new Error(`G1 plugin render error (${props.variant})`);
			return "render-ok";
		});
		function throwInHandler() {
			throw new Error(`G1 plugin handler error (${props.variant})`);
		}
		return (_ctx, _cache) => {
			return openBlock(), createElementBlock("div", {
				class: "g1-plugin",
				"data-g1-plugin": props.variant
			}, [
				createElementVNode("div", _hoisted_2, [
					_cache[5] || (_cache[5] = createElementVNode("span", { class: "g1-plugin__label" }, "count", -1)),
					createElementVNode("span", _hoisted_3, toDisplayString(count.value), 1),
					createElementVNode("button", {
						"data-testid": "plain-inc",
						class: "g1-plugin__plain",
						type: "button",
						onClick: _cache[0] || (_cache[0] = ($event) => count.value++)
					}, "plain +1"),
					createVNode(unref(Button), {
						"data-testid": "nb-inc",
						size: "sm",
						onClick: _cache[1] || (_cache[1] = ($event) => count.value++)
					}, {
						default: withCtx(() => [..._cache[4] || (_cache[4] = [createTextVNode("nb-ui +1", -1)])]),
						_: 1
					})
				]),
				createElementVNode("div", _hoisted_4, [
					_cache[6] || (_cache[6] = createElementVNode("span", { class: "g1-plugin__label" }, "i18n", -1)),
					createElementVNode("span", _hoisted_5, toDisplayString(unref(t)("common.cancel")), 1),
					createElementVNode("span", _hoisted_6, toDisplayString(unref(locale)), 1),
					_cache[7] || (_cache[7] = createElementVNode("span", { class: "g1-plugin__label" }, "theme", -1)),
					createElementVNode("span", _hoisted_7, toDisplayString(unref(colorMode)), 1),
					_cache[8] || (_cache[8] = createElementVNode("span", { class: "g1-plugin__label" }, "inject", -1)),
					createElementVNode("span", _hoisted_8, toDisplayString(unref(host)?.hostName ?? "missing"), 1)
				]),
				createElementVNode("div", _hoisted_9, [createVNode(unref(Tooltip), {
					text: `tooltip-${props.variant}`,
					delay: 0,
					placement: "top"
				}, {
					default: withCtx(() => [createVNode(unref(Button), {
						"data-testid": "tooltip-trigger",
						variant: "secondary",
						size: "sm"
					}, {
						default: withCtx(() => [..._cache[9] || (_cache[9] = [createTextVNode("tooltip", -1)])]),
						_: 1
					})]),
					_: 1
				}, 8, ["text"]), createVNode(unref(Popover), {
					open: popoverOpen.value,
					"onUpdate:open": _cache[2] || (_cache[2] = ($event) => popoverOpen.value = $event),
					side: "bottom"
				}, {
					trigger: withCtx(() => [createVNode(unref(Button), {
						"data-testid": "popover-trigger",
						variant: "secondary",
						size: "sm"
					}, {
						default: withCtx(() => [..._cache[10] || (_cache[10] = [createTextVNode("popover", -1)])]),
						_: 1
					})]),
					default: withCtx(() => [createElementVNode("div", {
						"data-testid": `popover-body-${props.variant}`,
						class: "g1-plugin__popover"
					}, " popover " + toDisplayString(props.variant) + " · " + toDisplayString(unref(t)("common.confirm")) + " · " + toDisplayString(count.value), 9, _hoisted_10)]),
					_: 1
				}, 8, ["open"])]),
				createElementVNode("div", _hoisted_11, [
					createElementVNode("span", _hoisted_12, toDisplayString(renderProbe.value), 1),
					createElementVNode("button", {
						"data-testid": "throw-render",
						class: "g1-plugin__plain",
						type: "button",
						onClick: _cache[3] || (_cache[3] = ($event) => renderBoom.value = true)
					}, "throw in render"),
					createElementVNode("button", {
						"data-testid": "throw-handler",
						class: "g1-plugin__plain",
						type: "button",
						onClick: throwInHandler
					}, "throw in handler"),
					createElementVNode("span", _hoisted_13, toDisplayString(resizeEvents.value), 1)
				])
			], 8, _hoisted_1);
		};
	}
});
//#endregion
//#region \0plugin-vue:export-helper
var _plugin_vue_export_helper_default = (sfc, props) => {
	const target = sfc.__vccOpts || sfc;
	for (const [key, val] of props) target[key] = val;
	return target;
};
//#endregion
//#region src/G1Widget.vue
var G1Widget_default = /*#__PURE__*/ _plugin_vue_export_helper_default(G1Widget_vue_vue_type_script_setup_true_lang_default, [["__scopeId", "data-v-162316f4"]]);
//#endregion
//#region src/index.ts
var pluginId = "example.g1";
var component = G1Widget_default;
//#endregion
export { component, pluginId, probeNbButton, probeSdkKey, probeVueRef };
