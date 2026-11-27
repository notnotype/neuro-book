<script setup lang="ts">
/**
 * SettingsRow 的 Lab 场景：配置服务来自设置场景的局部宿主（`settings/web/lab/`），各层的内容按场景给出；行拿到的是声明者
 * 插件自己的配置服务，与 page 页面一样。场景输入是行的数据属性，配置服务由这里补上。
 */
import {SchemaField} from "@notnotype/nb-form/vue";
import {computed, onBeforeUnmount} from "vue";

import {settingForm} from "nbook/plugins/settings/web/setting-form";
import {resolverFor} from "nbook/shared/localized-text";
import type {SettingLayer} from "nbook/shared/settings";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {useLabEventSink} from "../lab-event-sink";
import {useLabSubject} from "../lab-subject";
import type {LabFixtureProps} from "../lab-subject";
import {createSettingsHost} from "nbook/plugins/settings/web/lab/settings-host";
import {provideSettingsText, settingsSceneLocale} from "./settings-scene/settings-text";
import type {HostLayer} from "nbook/plugins/settings/web/lab/settings-host";
import {SCENE_SETTINGS} from "nbook/plugins/settings/web/lab/scene-data";
import {rowDemoSettings} from "nbook/plugins/settings/web/lab/scene-settings";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const subject = useLabSubject<typeof SettingsRow>(() => props.input, ["write-failed"]);

/** 行自己的场景用的项：设置窗口的场景不收它们（`settings/web/lab/scene-settings.ts`）。 */
const ROW_SETTINGS = Object.values(rowDemoSettings).map((definition) => ({plugin: "example.rows", definition}));
const SETTINGS = [...SCENE_SETTINGS, ...ROW_SETTINGS] as typeof SCENE_SETTINGS;

/** 场景 → 各层的初始内容。 */
const LAYERS: Readonly<Record<string, {readonly user?: HostLayer; readonly project?: HostLayer}>> = {
    "modified": {user: {values: {"nbook.workbench/appearance": "dark"}}},
    "overridden": {user: {values: {"nbook.workbench/appearance": "system"}}, project: {values: {"nbook.workbench/appearance": "light"}}},
    "inherit": {user: {values: {"nbook.workbench/theme": "macos"}}, project: {}},
    "project-set": {project: {values: {"nbook.workbench/appearance": "light"}}},
    "invalid": {user: {values: {"nbook.workbench/appearance": "dark"}, invalid: "第 3 行：缺少逗号"}},
    "unreachable": {user: {unreachable: true}},
    "wide": {user: {values: {"example.snippets/items": [{name: "旁白", text: "雾从港口漫上来。"}, {name: "落款", text: "——写于雾港"}]}}},
    "not-allowed": {project: {}},
    "multi-reason": {user: {values: {"example.rows/workers": 12}}},
    "read-only": {user: {}},
    "project-wide-inherit": {user: {values: {"example.snippets/items": [{name: "旁白", text: "雾从港口漫上来。"}]}}, project: {}},
    "narrow": {user: {values: {"example.rows/mode": "volume"}}},
};

const layers = LAYERS[props.scene] ?? {};
const host = createSettingsHost({
    settings: SETTINGS,
    sections: [],
    ...(layers.user === undefined ? {} : {user: layers.user}),
    ...(layers.project === undefined ? {} : {project: layers.project}),
    projectTitle: "雾港",
    notify: (input) => record("notify", input),
    report: (message) => record("report", message),
});
onBeforeUnmount(() => host.dispose());

const bindings = computed(() => subject.bindings.value);
const setting = computed(() => bindings.value.setting);
/** 声明者自己的配置服务：恢复默认、移除本作品的设置与控件改值都只写它声明的这一项。 */
const settings = computed(() => host.service(SETTINGS.find((entry) => entry.definition.key === setting.value.key)?.plugin ?? "nbook.workbench"));
// 行没有 `locale` 属性：语言由场景决定，文字来自注入的端口；选项名与表单文字取同一个语言。
const locale = settingsSceneLocale(props.scene);
const text = resolverFor(() => locale, provideSettingsText(props.scene));
/** 选项名取配置服务里接受的声明（登记时补全过），与设置窗口一致；场景的项都在局部宿主里，总有接受的声明。 */
const form = computed(() => {
    const accepted = settings.value.declaration(setting.value);
    return accepted === null ? null : settingForm(accepted, locale, text);
});

async function write(value: unknown, layer: SettingLayer): Promise<void> {
    const result = await settings.value.update(setting.value, value, {layer});
    if (!result.ok) record("write-failed", result);
}
</script>

<template>
    <SettingsRow v-slot="row" v-bind="bindings" :settings="settings" class="settings-row-fixture" :class="{'settings-row-fixture--narrow': scene === 'narrow'}" data-lab-subject>
        <SchemaField
            :id="row.id"
            :schema="setting.declaration.schema"
            :hints="form?.hints"
            :model-value="row.value"
            :disabled="row.disabled"
            :labelledby="row.labelId"
            :describedby="row.describedby"
            bare
            @update:model-value="(value: unknown) => write(value, bindings.layer)"
        />
    </SettingsRow>
</template>

<style scoped>
/* 窄窗口的场景：560px 宽（设置窗口缩到下限附近时内容列的宽度），看放不下的控件换到标题下面。 */
.settings-row-fixture--narrow {
    width: 560px;
    max-width: 100%;
}
</style>
