<script setup lang="ts">
/**
 * ThemeEditor 的 Lab 场景：模型建在内存里的“我的主题”上（`theme-editor-scene/lab-user-themes.ts`），主题目录是真的 `ThemeCatalog`，
 * 预览覆盖照常写进目录但 Lab 的文档根不读它（Lab 不受主题影响），所以这里看的是编辑器自己：分区、配色行、对比度、取景框。
 * 场景名决定库里有什么与打开哪个分区；场景名带 `-english` 的是英文界面。
 */
import {effectScope, onBeforeUnmount} from "vue";

import {baseColors} from "nbook/ui/theme/product-themes";
import {ThemeCatalog} from "nbook/plugins/workbench/web/themes";
import ThemeEditor from "nbook/plugins/workbench/web/components/theme-editor/ThemeEditor.vue";
import {ThemeEditorModel} from "nbook/plugins/workbench/web/components/theme-editor/theme-editor-model";
import type {EditorSection} from "nbook/plugins/workbench/web/components/theme-editor/theme-editor-model";
import type {UserTheme} from "nbook/plugins/workbench/shared/user-themes";

import type {ThemeTransfer} from "nbook/plugins/workbench/web/components/theme-editor/transfer";

import type {LabFixtureProps} from "../lab-subject";
import {createLabUserThemes} from "./theme-editor-scene/lab-user-themes";

const props = defineProps<LabFixtureProps>();

const base = props.scene.replace(/-english$/u, "");

/** 一套已经做出来的主题：书房风格的亮暗配色，没有场景图。 */
const THEME: UserTheme = {
    id: "user:00000000-0000-4000-8000-000000000001",
    declaration: {
        title: {"zh-CN": "夜读", "en-US": "Night reading"},
        base: "nbook",
        light: {colors: {"--bg-main": "#f3ead8", "--bg-panel": "#fbf2e0", "--bg-sidebar": "#e9e0ce", "--bg-hover": "#e1d8c6", "--text-main": "#2e261c", "--text-secondary": "#595145", "--text-muted": "#60584b", "--accent-main": "#8a5a24", "--accent-bg": "rgba(138, 90, 36, 0.14)", "--accent-text": "#82531c"}, frame: {line: "#8a5a24"}},
        dark: {colors: {"--bg-main": "#241c15", "--bg-panel": "#2d241d", "--bg-sidebar": "#1f1711", "--bg-hover": "#372e27", "--text-main": "#efe4d0", "--text-secondary": "#c2b8a7", "--text-muted": "#a69c8d", "--accent-main": "#e0ac62"}},
    },
};

/** 对比度有不合格项的一套：弱化文字太淡。 */
const FAILING: UserTheme = {...THEME, declaration: {...THEME.declaration, light: {...THEME.declaration.light, colors: {...THEME.declaration.light.colors, "--text-muted": "#dcd2bd"}}}};

const SECTIONS: Readonly<Record<string, EditorSection>> = {basic: "basic", colors: "colors", fonts: "fonts", chrome: "chrome", scene: "scene", contrast: "contrast", failing: "contrast"};

const themes = base === "empty" || base === "loading" ? [] : [base === "failing" ? FAILING : THEME];
const catalog = new ThemeCatalog([], () => null, () => undefined);
const store = createLabUserThemes(themes, base !== "loading");

const scope = effectScope();
const model = scope.run(() => new ThemeEditorModel({store, catalog, baseColors, newId: () => crypto.randomUUID(), currentAppearance: () => "light"})) as ThemeEditorModel;
model.section.value = SECTIONS[base] ?? "basic";
if (base === "dark") model.appearance.value = "dark";
onBeforeUnmount(() => scope.stop());

/** 场景里没有真实的请求：导出什么都不做，导入总是说读不了。 */
const transfer: ThemeTransfer = {
    exportTheme: async () => null,
    importArchive: async () => ({ok: false, message: {key: "importFailed", params: {reason: "Lab"}}}),
    uploadScene: async () => ({ok: false, reason: "Lab"}),
    copyScenes: async () => ({ok: true, scenes: {}}),
};
</script>

<template>
    <ThemeEditor data-lab-subject class="h-full w-full" :model="model" :themes="catalog.list" :transfer="transfer" />
</template>
