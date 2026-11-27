<script setup lang="ts">
/**
 * 设置场景里的 fill 页面（示例插件“模型服务”，docs/specs/settings/settings-window.md 输出 19、20、22）：page 分区用草稿、
 * 未保存保护与动态选项的样板，第三方的设置页面可以照着写。
 *
 * - 版式：一张列表加下一级页面。首屏上面是“常规”（“默认模型”“推理强度”，每项即时写入，同通用列表），下面是服务商列表
 *   `SettingsPageList`；点一家服务商整页换成它的详情，窗口标题区同时换成“‹ 模型服务”与服务商的名字。“添加服务商”（列表
 *   状态）与“测试连接”、删除（详情状态）经 `SettingsPageActions` 放在标题区右侧，层不能写时由窗口整体停用。
 * - 详情里每个字段一行，标签在左、控件在右，控件宽度按类型分档（同设置窗口的通用列表，输出 9）；列表这类宽控件另起一行。
 * - 服务商是一个对象数组配置项。改动先进草稿，点底部保存栏（`SettingsSaveBar`）的“保存”才整组写进配置；草稿与开始编辑时的
 *   已保存值比较，不同就报 `context.dirty(true)`，窗口在离开前先确认。草稿里每家服务商配一个只在页面里用的键：打开的是哪家、
 *   字段的重建与“解析不了的输入”的记号都按它认，不按下标（别处增删、删掉中间一家时下标会对上另一家）。标识可能还没填或重复，
 *   不能当键。
 * - 别处改了已保存的值（另一个窗口、设置文件视图）：没有改动时跟上，键按标识认回来，打开的那家还在就仍开着它；有改动时
 *   提示，保存前要用户选“重新读取”或“仍然保存”，不悄悄盖掉别人的改动。
 * - 这一层不能写（设置文件有错误、连不上）时表单只读、保存停用，不用等保存被拒；标题区的操作由窗口停用。
 * - 保存栏在详情里一直在；列表状态下只在有没保存的改动时出现（改了又返回到列表时，仍有地方保存或放弃）。保存成功或放弃之后，
 *   焦点放回详情里的第一个输入框：保存栏的按钮此时停用、留不住焦点。
 * - 服务商的页内列表不支持排序。“测试连接”是个替身：不发请求，按接口地址是不是 http(s) 开头给出“已连接”或“连接失败”。
 * - 默认模型的选项来自同一插件的选项提供者（已保存的服务商的模型），经 `context.options` 交给字段。
 */
import {resolveForm, resolveText, validateForm} from "@notnotype/nb-form";
import type {FormHints, FormText} from "@notnotype/nb-form";
import {describeIssues, SchemaField, useFormText, widgetLayout} from "@notnotype/nb-form/vue";
import type {DraftState} from "@notnotype/nb-form/vue";
import {Button, IconButton, Tooltip} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, reactive, ref, shallowRef, useId, watch} from "vue";

import {canonical} from "nbook/plugins/settings/shared/layers";
import {settingHints} from "nbook/plugins/settings/web/setting-form";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {resolverFor} from "nbook/shared/localized-text";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";
import {settingsFailureText} from "nbook/ui/settings/setting-text";
import SettingsPageActions from "nbook/ui/settings/SettingsPageActions.vue";
import SettingsPageList from "nbook/ui/settings/SettingsPageList.vue";
import type {SettingsPageListItem} from "nbook/ui/settings/SettingsPageList.vue";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";
import SettingsSaveBar from "nbook/ui/settings/SettingsSaveBar.vue";

import {modelsSettings, ProviderSchema} from "./scene-settings";

const props = defineProps<{
    context: SettingsPageContext;
    settings: SettingsService;
}>();

/** 页面拿着的是自己写下的定义；选项名取配置服务里接受的声明（登记时补全过），与设置窗口一致。 */
const declaredText = resolverFor(() => "zh-CN", useText());
/** 表单的文字（字段名、问题的写法）经窗口注入的端口取，与页面里的表单同一个语言。 */
const formText = useFormText();
const hintsOf = (setting: SettingDefinition<unknown>): FormHints => {
    const accepted = props.settings.declaration(setting);
    return accepted === null ? {} : settingHints(accepted, declaredText);
};

type Providers = typeof modelsSettings.providers extends SettingDefinition<infer T> ? T : never;
type Provider = Providers[number];
/** 草稿里的一家服务商与它在页面里的键。 */
interface Entry {
    readonly key: string;
    readonly provider: Provider;
}

const TEXT = {
    list: "模型服务",
    general: "常规",
    providers: "服务商",
    untitled: "未命名的服务商",
    add: "添加服务商",
    test: "测试连接",
    remove: "删除服务商",
    removeLabel: "删除：{name}",
    connected: "已连接",
    failed: "连接失败",
    reread: "重新读取",
    saveAnyway: "仍然保存",
    changedElsewhere: "服务商在别处改过了：“重新读取”丢掉这里的改动，“仍然保存”盖掉别处的改动",
    notSaved: "还没保存：{reason}",
    notWritten: "没有保存：{reason}",
    readonly: "这一层现在不能保存（设置文件有错误或连不上）",
};

const providers = modelsSettings.providers;
const model = resolveForm(providers.declaration.schema);
const uid = useId();

/** 详情的字段：按 schema 的属性顺序一行一个。 */
const FIELDS = Object.entries(ProviderSchema.properties).map(([name, schema]) => {
    const hints = (schema as {"x-form"?: {label?: FormText; help?: FormText}})["x-form"] ?? {};
    return {name, schema, label: hints.label ?? name, help: hints.help, layout: widgetLayout(schema)};
});
const text = (value: FormText | undefined): string => resolveText(value, "zh-CN");

const saved = computed(() => props.settings.get(providers));
let nextKey = 0;
/**
 * 把一份已保存的服务商变成草稿：配置服务给的值是深冻结的只读值，草稿要能改，拿一份深拷贝；键按标识从原来的草稿里认回来
 * （没有或重复的给新键），别处改动之后选中的那家还能选着。
 */
function adopt(value: typeof saved.value, previous: ReadonlyArray<Entry>): Entry[] {
    const unused = [...previous];
    return (structuredClone(value) as Providers).map((provider) => {
        const at = provider.id === "" ? -1 : unused.findIndex((entry) => entry.provider.id === provider.id);
        const key = at < 0 ? `p${String(nextKey++)}` : unused.splice(at, 1)[0]!.key;
        return {key, provider};
    });
}
/** 每次改都换一个新数组、不在原值上改，所以草稿用浅层的 ref：写配置时交出去的是普通对象，不是 Vue 的代理（代理不能结构化复制）。 */
const entries = shallowRef<Entry[]>(adopt(saved.value, []));
/** 开始编辑时的已保存值：保存前和它比，知道别处有没有改过；按键记一份，列表据此标出改过的服务商。 */
const base = shallowRef(saved.value);
const baseByKey = shallowRef(new Map(entries.value.map((entry) => [entry.key, canonical(entry.provider)])));
/** 解析不了的草稿（数字框里的 `abc`），按“服务商的键/字段/路径”。 */
const unparseable = reactive(new Set<string>());
const failure = ref<string | null>(null);
const saving = ref(false);
/** 打开的服务商的键；`null` 是列表。 */
const selected = ref<string | null>(null);
/** 每家服务商最近一次“测试连接”的结果，按键；没测过的没有。 */
const connection = reactive(new Map<string, boolean>());
const fields = ref<Array<InstanceType<typeof SchemaField>>>([]);
const root = ref<HTMLElement | null>(null);

const draft = computed((): Providers => entries.value.map((entry) => entry.provider));
// 键序不同的同一个值不算改动：按规范化的文本比。
const dirty = computed(() => canonical(draft.value) !== canonical(base.value) || unparseable.size > 0);
const changedElsewhere = computed(() => canonical(saved.value) !== canonical(base.value));
// 这一层不能写（设置文件有错误、连不上）时由窗口告知；表单只读、保存停用，不用等保存被拒。
const writable = computed(() => props.context.writable.value);
watch(dirty, (value) => props.context.dirty(value), {immediate: true});
watch(saved, (next) => {
    if (!dirty.value) reset(next);
});

function reset(value: typeof saved.value): void {
    entries.value = adopt(value, entries.value);
    base.value = value;
    baseByKey.value = new Map(entries.value.map((entry) => [entry.key, canonical(entry.provider)]));
    unparseable.clear();
    failure.value = null;
}

const edited = (entry: Entry): boolean => baseByKey.value.get(entry.key) !== canonical(entry.provider) || [...unparseable].some((key) => key.startsWith(`${entry.key}/`));
const titleOf = (provider: Provider): string => (provider.name === "" ? TEXT.untitled : provider.name);
const items = computed((): SettingsPageListItem[] => entries.value.map((entry) => {
    const tested = connection.get(entry.key);
    return {
        id: entry.key,
        title: titleOf(entry.provider),
        icon: "i-lucide-server",
        ...(entry.provider.baseUrl === "" ? {} : {description: entry.provider.baseUrl}),
        ...(tested === undefined ? {} : {status: tested ? TEXT.connected : TEXT.failed, tone: tested ? "success" as const : "error" as const}),
        modified: edited(entry),
    };
}));
const current = computed((): Entry | null => entries.value.find((entry) => entry.key === selected.value) ?? null);
// 打开的服务商被删掉、或别处的改动让它不在了，回到列表。
watch(current, (entry) => {
    if (entry === null && selected.value !== null) selected.value = null;
});
/** 详情里一直有保存栏；列表里只在有没保存的改动时出现。 */
const showBar = computed(() => current.value !== null || dirty.value);

const issues = computed(() => validateForm(model, draft.value).filter((issue) => issue.severity === "error"));

/*
 * 字段的事件处理按“键/字段”缓存、在渲染时交给字段：切换服务商时旧字段在新的渲染之后才卸载，卸载时补发的 `draft-state`
 * 要记回它自己那家；`@…` 的内联语句在调用时才读当前选中项，会记到新选中的那家。所以写成 `:onUpdate:modelValue` 这样的
 * 属性绑定（Vue 按驼峰的 `on…` 键找监听器，写成连字符的找不到）。
 */
const handlers = new Map<string, {update: (value: unknown) => void; draft: (state: DraftState) => void}>();
function handlersFor(key: string, name: string) {
    const id = `${key}/${name}`;
    let found = handlers.get(id);
    if (found === undefined) {
        found = {
            update: (value) => updateField(key, name, value),
            draft: (state) => {
                const mark = [id, ...state.path].join("/");
                if (state.state === "unparseable") unparseable.add(mark);
                else unparseable.delete(mark);
            },
        };
        handlers.set(id, found);
    }
    return found;
}

function updateField(key: string, name: string, value: unknown): void {
    entries.value = entries.value.map((entry) => {
        if (entry.key !== key) return entry;
        const next: Record<string, unknown> = {...entry.provider};
        if (value === undefined) delete next[name];
        else next[name] = value;
        return {key, provider: next as Provider};
    });
}

function addProvider(): void {
    const key = `p${String(nextKey++)}`;
    entries.value = [...entries.value, {key, provider: {id: "", name: "", baseUrl: "", timeout: 30}}];
    selected.value = key;
}

/** 替身：不发请求，接口地址是 http(s) 开头就算连上。 */
function testConnection(key: string): void {
    const entry = entries.value.find((candidate) => candidate.key === key);
    if (entry !== undefined) connection.set(key, /^https?:\/\//u.test(entry.provider.baseUrl));
}

function removeProvider(key: string): void {
    entries.value = entries.value.filter((entry) => entry.key !== key);
    for (const mark of [...unparseable]) if (mark.startsWith(`${key}/`)) unparseable.delete(mark);
    connection.delete(key);
    selected.value = null;
}

async function save(anyway = false): Promise<void> {
    if (saving.value || !writable.value) return;
    if (changedElsewhere.value && !anyway) return;
    // 先把输入框里还没提交的草稿交出来（点按钮时它们已经失焦提交，键盘触发时不一定）。
    for (const field of fields.value) field.commit();
    const [first] = describeIssues(providers.declaration.schema, draft.value, issues.value, formText, hintsOf(providers));
    if (first !== undefined || unparseable.size > 0) {
        failure.value = TEXT.notSaved.replace("{reason}", first ?? "有解析不了的输入");
        return;
    }
    saving.value = true;
    try {
        const result = await props.settings.update(providers, draft.value, {layer: props.context.layer.value});
        if (result.ok) {
            reset(saved.value);
            await restoreFocus();
        } else failure.value = TEXT.notWritten.replace("{reason}", settingsFailureText(result.code, result.detail, declaredText));
    } finally {
        saving.value = false;
    }
}

function discard(): void {
    for (const field of fields.value) field.reset();
    reset(saved.value);
    void restoreFocus();
}

/** 保存与放弃之后保存栏的按钮停用、留不住焦点：放回详情里的第一个输入框（页面负责，见 SettingsSaveBar.md）。列表里没有编辑处。 */
async function restoreFocus(): Promise<void> {
    await nextTick();
    root.value?.querySelector<HTMLElement>("[data-sample-models-detail] input")?.focus();
}

async function writeNow(setting: SettingDefinition<unknown>, value: unknown): Promise<void> {
    await props.settings.update(setting, value, {layer: props.context.layer.value});
}
</script>

<template>
    <div ref="root" class="sample-models" data-sample-models>
        <!-- 页面级操作画在窗口标题区的右侧：列表里是“添加服务商”，详情里是“测试连接”与删除。 -->
        <SettingsPageActions>
            <Button v-if="current === null" size="sm" variant="secondary" icon-class="i-lucide-plus" data-sample-models-add @click="addProvider">{{ TEXT.add }}</Button>
            <template v-else>
                <Button size="sm" variant="secondary" icon-class="i-lucide-plug-zap" data-sample-models-test @click="testConnection(current.key)">{{ TEXT.test }}</Button>
                <Tooltip :text="TEXT.remove">
                    <IconButton size="sm" variant="danger" icon-class="i-lucide-trash-2" :aria-label="TEXT.removeLabel.replace('{name}', titleOf(current.provider))" data-sample-models-remove @click="removeProvider(current.key)" />
                </Tooltip>
            </template>
        </SettingsPageActions>
        <div class="sample-models__body">
            <section v-if="current === null" class="sample-models__group" data-sample-models-general>
                <h3 class="sample-models__group-title">{{ TEXT.general }}</h3>
                <SettingsRow v-for="setting in [modelsSettings.defaultModel, modelsSettings.effort]" :key="setting.key" v-slot="row" :settings="settings" :setting="setting" :layer="context.layer.value" :project-title="context.projectTitle.value">
                    <div class="sample-models__control">
                        <SchemaField
                            :id="row.id"
                            :schema="setting.declaration.schema"
                            :hints="hintsOf(setting)"
                            :options="context.options"
                            :model-value="row.value"
                            :disabled="row.disabled"
                            :labelledby="row.labelId"
                            :describedby="row.describedby"
                            bare
                            commit="change"
                            @update:model-value="(value: unknown) => writeNow(setting as SettingDefinition<unknown>, value)"
                        />
                    </div>
                </SettingsRow>
            </section>
            <section class="sample-models__group">
                <h3 v-if="current === null" class="sample-models__group-title">{{ TEXT.providers }}</h3>
                <SettingsPageList v-model="selected" :items="items" :label="TEXT.list">
                    <template v-if="current !== null">
                        <div :key="current.key" class="sample-models__fields" data-sample-models-detail>
                            <div v-for="field in FIELDS" :key="field.name" class="sample-models__row" :class="{'sample-models__row--block': field.layout.block}">
                                <div class="sample-models__label">
                                    <label :id="`${uid}-${current.key}-${field.name}-label`" :for="`${uid}-${current.key}-${field.name}`">{{ text(field.label) }}</label>
                                    <p v-if="field.help !== undefined" :id="`${uid}-${current.key}-${field.name}-help`" class="sample-models__help">{{ text(field.help) }}</p>
                                </div>
                                <div class="sample-models__control" :data-sample-models-width="field.layout.block ? undefined : field.layout.width">
                                    <SchemaField
                                        :id="`${uid}-${current.key}-${field.name}`"
                                        ref="fields"
                                        :schema="field.schema"
                                        :model-value="(current.provider as Record<string, unknown>)[field.name]"
                                        :options="context.options"
                                        :readonly="!writable"
                                        :labelledby="`${uid}-${current.key}-${field.name}-label`"
                                        :describedby="field.help === undefined ? undefined : `${uid}-${current.key}-${field.name}-help`"
                                        bare
                                        commit="change"
                                        :onUpdate:modelValue="handlersFor(current.key, field.name).update"
                                        @draft-state="handlersFor(current.key, field.name).draft"
                                    />
                                </div>
                            </div>
                        </div>
                    </template>
                </SettingsPageList>
            </section>
        </div>
        <!-- 保存栏不随详情滚走：详情会滚动，放在下面滚动区之外才一直看得到。 -->
        <div v-if="showBar" class="sample-models__bar" data-sample-models-bar>
            <p v-if="!writable" class="sample-models__status" role="status">{{ TEXT.readonly }}</p>
            <p v-else-if="dirty && changedElsewhere" class="sample-models__status" role="status" data-sample-models-changed>
                <span>{{ TEXT.changedElsewhere }}</span>
                <Button size="sm" variant="secondary" @click="discard">{{ TEXT.reread }}</Button>
                <Button size="sm" variant="secondary" :disabled="saving" @click="save(true)">{{ TEXT.saveAnyway }}</Button>
            </p>
            <SettingsSaveBar :dirty="dirty" :busy="saving" :can-save="writable && !changedElsewhere" :message="failure ?? undefined" @save="save()" @discard="discard" />
        </div>
    </div>
</template>

<style scoped>
/* fill 页面：滚动区加底部的保存栏，只有滚动区滚。 */
.sample-models {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
}

/*
 * 内容的左右边与窗口标题区对齐（fill 页面的外边距同内容列）。滚动区会裁掉越出它的部分：列表行向两侧伸出 --space-4，
 * 再加焦点环，所以两侧各留 --space-5 的内边距，再用同样大小的负外边距把内容退回标题的边上。
 */
.sample-models__body {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    margin: 0 calc(-1 * var(--space-5));
    padding: var(--space-1) var(--space-5) var(--space-5);
}

.sample-models__group + .sample-models__group {
    margin-top: var(--space-7);
}

/* 分组标题下一条线，行之间不画框（同设置窗口的通用列表）。 */
.sample-models__group-title {
    margin: 0 0 var(--space-3);
    padding-bottom: var(--space-4);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

/* 详情的一行：同 SettingsRow 的标签列加控件列，标签列窄一些。 */
.sample-models__fields {
    display: flex;
    flex-direction: column;
}

.sample-models__row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-6);
    padding-block: var(--space-4);
}

.sample-models__row--block {
    flex-direction: column;
    align-items: stretch;
}

.sample-models__label {
    width: 120px;
    flex-shrink: 0;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

.sample-models__row--block .sample-models__label {
    width: auto;
}

.sample-models__help {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    font-weight: var(--weight-normal);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

.sample-models__control {
    min-width: 0;
    max-width: 100%;
}

.sample-models__control[data-sample-models-width="narrow"] {
    width: 120px;
}

.sample-models__control[data-sample-models-width="medium"] {
    width: 220px;
}

.sample-models__control[data-sample-models-width="wide"] {
    min-width: 200px;
    max-width: 320px;
    flex: 1;
}

/* 保存栏自己有上边线与内边距；这里只让它与滚动区的内容左对齐。 */
.sample-models__bar {
    flex-shrink: 0;
    padding: 0;
    background: var(--bg-panel);
}

.sample-models__status {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    margin: var(--space-3) 0 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-warning);
}

/*
 * 窄的窗口（窗口拖到最窄、手机宽度的画布）：窗口的左栏与内容改成上下、由外层一起滚动（SettingsWindow 的同一档），页面也不再
 * 自己滚；保存栏粘在可视区底部，长详情里改了也看得到“保存”。
 */
@container (max-width: 600px) {
    .sample-models {
        height: auto;
    }

    .sample-models__body {
        overflow: visible;
        padding-top: var(--space-5);
    }

    .sample-models__bar {
        position: sticky;
        bottom: 0;
        z-index: 1;
    }
}
</style>
