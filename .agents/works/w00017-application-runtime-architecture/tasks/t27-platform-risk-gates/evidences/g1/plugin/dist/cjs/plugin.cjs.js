window.__NB_MODULES__.register("example.g1", function(require, module, exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	let vue = require("vue");
	let _notnotype_nb_ui_components = require("@notnotype/nb-ui/components");
	let _neurobook_plugin_sdk = require("@neurobook/plugin-sdk");
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
	var G1Widget_vue_vue_type_script_setup_true_lang_default = /*@__PURE__*/ (0, vue.defineComponent)({
		__name: "G1Widget",
		props: { variant: {} },
		setup(__props) {
			const props = __props;
			const count = (0, vue.ref)(0);
			const host = (0, vue.inject)(_neurobook_plugin_sdk.PLUGIN_HOST_CONTEXT, null);
			const { t, locale } = (0, _neurobook_plugin_sdk.useHostI18n)();
			const colorMode = (0, _neurobook_plugin_sdk.useHostColorMode)();
			const popoverOpen = (0, vue.ref)(false);
			const renderBoom = (0, vue.ref)(false);
			const resizeEvents = (0, vue.ref)(0);
			function onResize() {
				resizeEvents.value += 1;
			}
			(0, vue.onMounted)(() => window.addEventListener("resize", onResize));
			(0, vue.onBeforeUnmount)(() => window.removeEventListener("resize", onResize));
			const renderProbe = (0, vue.computed)(() => {
				if (renderBoom.value) throw new Error(`G1 plugin render error (${props.variant})`);
				return "render-ok";
			});
			function throwInHandler() {
				throw new Error(`G1 plugin handler error (${props.variant})`);
			}
			return (_ctx, _cache) => {
				return (0, vue.openBlock)(), (0, vue.createElementBlock)("div", {
					class: "g1-plugin",
					"data-g1-plugin": props.variant
				}, [
					(0, vue.createElementVNode)("div", _hoisted_2, [
						_cache[5] || (_cache[5] = (0, vue.createElementVNode)("span", { class: "g1-plugin__label" }, "count", -1)),
						(0, vue.createElementVNode)("span", _hoisted_3, (0, vue.toDisplayString)(count.value), 1),
						(0, vue.createElementVNode)("button", {
							"data-testid": "plain-inc",
							class: "g1-plugin__plain",
							type: "button",
							onClick: _cache[0] || (_cache[0] = ($event) => count.value++)
						}, "plain +1"),
						(0, vue.createVNode)((0, vue.unref)(_notnotype_nb_ui_components.Button), {
							"data-testid": "nb-inc",
							size: "sm",
							onClick: _cache[1] || (_cache[1] = ($event) => count.value++)
						}, {
							default: (0, vue.withCtx)(() => [..._cache[4] || (_cache[4] = [(0, vue.createTextVNode)("nb-ui +1", -1)])]),
							_: 1
						})
					]),
					(0, vue.createElementVNode)("div", _hoisted_4, [
						_cache[6] || (_cache[6] = (0, vue.createElementVNode)("span", { class: "g1-plugin__label" }, "i18n", -1)),
						(0, vue.createElementVNode)("span", _hoisted_5, (0, vue.toDisplayString)((0, vue.unref)(t)("common.cancel")), 1),
						(0, vue.createElementVNode)("span", _hoisted_6, (0, vue.toDisplayString)((0, vue.unref)(locale)), 1),
						_cache[7] || (_cache[7] = (0, vue.createElementVNode)("span", { class: "g1-plugin__label" }, "theme", -1)),
						(0, vue.createElementVNode)("span", _hoisted_7, (0, vue.toDisplayString)((0, vue.unref)(colorMode)), 1),
						_cache[8] || (_cache[8] = (0, vue.createElementVNode)("span", { class: "g1-plugin__label" }, "inject", -1)),
						(0, vue.createElementVNode)("span", _hoisted_8, (0, vue.toDisplayString)((0, vue.unref)(host)?.hostName ?? "missing"), 1)
					]),
					(0, vue.createElementVNode)("div", _hoisted_9, [(0, vue.createVNode)((0, vue.unref)(_notnotype_nb_ui_components.Tooltip), {
						text: `tooltip-${props.variant}`,
						delay: 0,
						placement: "top"
					}, {
						default: (0, vue.withCtx)(() => [(0, vue.createVNode)((0, vue.unref)(_notnotype_nb_ui_components.Button), {
							"data-testid": "tooltip-trigger",
							variant: "secondary",
							size: "sm"
						}, {
							default: (0, vue.withCtx)(() => [..._cache[9] || (_cache[9] = [(0, vue.createTextVNode)("tooltip", -1)])]),
							_: 1
						})]),
						_: 1
					}, 8, ["text"]), (0, vue.createVNode)((0, vue.unref)(_notnotype_nb_ui_components.Popover), {
						open: popoverOpen.value,
						"onUpdate:open": _cache[2] || (_cache[2] = ($event) => popoverOpen.value = $event),
						side: "bottom"
					}, {
						trigger: (0, vue.withCtx)(() => [(0, vue.createVNode)((0, vue.unref)(_notnotype_nb_ui_components.Button), {
							"data-testid": "popover-trigger",
							variant: "secondary",
							size: "sm"
						}, {
							default: (0, vue.withCtx)(() => [..._cache[10] || (_cache[10] = [(0, vue.createTextVNode)("popover", -1)])]),
							_: 1
						})]),
						default: (0, vue.withCtx)(() => [(0, vue.createElementVNode)("div", {
							"data-testid": `popover-body-${props.variant}`,
							class: "g1-plugin__popover"
						}, " popover " + (0, vue.toDisplayString)(props.variant) + " · " + (0, vue.toDisplayString)((0, vue.unref)(t)("common.confirm")) + " · " + (0, vue.toDisplayString)(count.value), 9, _hoisted_10)]),
						_: 1
					}, 8, ["open"])]),
					(0, vue.createElementVNode)("div", _hoisted_11, [
						(0, vue.createElementVNode)("span", _hoisted_12, (0, vue.toDisplayString)(renderProbe.value), 1),
						(0, vue.createElementVNode)("button", {
							"data-testid": "throw-render",
							class: "g1-plugin__plain",
							type: "button",
							onClick: _cache[3] || (_cache[3] = ($event) => renderBoom.value = true)
						}, "throw in render"),
						(0, vue.createElementVNode)("button", {
							"data-testid": "throw-handler",
							class: "g1-plugin__plain",
							type: "button",
							onClick: throwInHandler
						}, "throw in handler"),
						(0, vue.createElementVNode)("span", _hoisted_13, (0, vue.toDisplayString)(resizeEvents.value), 1)
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
	//#endregion
	exports.component = G1Widget_default;
	exports.pluginId = pluginId;
	Object.defineProperty(exports, "probeNbButton", {
		enumerable: true,
		get: function() {
			return _notnotype_nb_ui_components.Button;
		}
	});
	Object.defineProperty(exports, "probeSdkKey", {
		enumerable: true,
		get: function() {
			return _neurobook_plugin_sdk.PLUGIN_HOST_CONTEXT;
		}
	});
	Object.defineProperty(exports, "probeVueRef", {
		enumerable: true,
		get: function() {
			return vue.ref;
		}
	});
});
