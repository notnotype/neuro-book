<script setup lang="ts">
// 设置页（docs/specs/story/viewer.md 输出 48；w00024 t13 决定 10、t16 决定 7）：整份问答与抽取的配置，与 `nbstory config`
// 是同一份文件。“模型”一节手写（候选、默认与推理档、服务商，选模型用 nb-agent-ui 的模型目录）；问答的限额与抽取按配置
// 的 schema 画表单（nb-form）。密钥本身不显示、不能填，只写服务启动时那个环境变量有没有值。保存带上读到时的摘要，别处
// 改过就报冲突、提示重新载入。
import {computed, ref, shallowRef} from "vue";
import {useRouter} from "vue-router";
import {AlertDialog, Badge, Banner, Button, IconButton, Select, type BannerTone} from "@notnotype/nb-ui/components";
import {SchemaForm} from "@notnotype/nb-form/vue";
import type {FormIssue} from "@notnotype/nb-form";
import {AgentModelCatalog} from "@notnotype/nb-agent-ui/vue";
import type {CatalogProviderView} from "@notnotype/nb-agent-ui";
import {Type} from "typebox";

import {ConfigSchema, type ProviderConfig, type QaConfig} from "../../contract/config-schema";
import type {ViewerResult} from "../../contract/contract";
import {StoryCallError, useStoryClient} from "../host/client";
import {candidateInfos, clampThinking, formatTokenCount, providerNote, type CatalogProvider} from "../qa/models";
import ProviderDialog from "./ProviderDialog.vue";
import ThemeMenu from "../parts/ThemeMenu.vue";
import SkillInstall from "./SkillInstall.vue";

const client = useStoryClient();
const router = useRouter();

/** 编辑中的配置：形状同第 2 版，但可以暂时不合格（例如还没有候选）。 */
type Draft = Omit<QaConfig, "providers"> & {providers?: Record<string, ProviderConfig>};

/** 文件不在或读不成时的起点：第 2 版的空配置，先添加一个模型才能保存。 */
const STARTER: Draft = {models: [], model: {use: ""}};
/** 表单只画问答的限额与抽取；“模型”一节在上面手写。 */
const FORM_SCHEMA = Type.Object({qa: ConfigSchema.properties.qa, ingest: ConfigSchema.properties.ingest}, {additionalProperties: false});
const LAYOUT = {
    type: "column",
    items: [
        {type: "group", label: "问答（可选）", collapsed: true, items: [{type: "field", path: "/qa"}]},
        {type: "group", label: "抽取（可选）", collapsed: true, items: [{type: "field", path: "/ingest"}]},
    ],
} as const;
/** 表单里两处密钥环境变量的路径（问题按路径挂到字段上）。 */
const KEY_PATHS: ReadonlyArray<ReadonlyArray<string>> = [["ingest", "model", "apiKeyEnv"], ["ingest", "recall", "model", "apiKeyEnv"]];
const THINKING_LABEL: Record<string, string> = {minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大"};

type Loaded = ViewerResult<"config.get">;
const loaded = shallowRef<Loaded | null>(null);
const loadError = ref<string | null>(null);
const value = shallowRef<Draft>(STARTER);
/** 目录（只取 OMP 目录的服务商）与服务器补过参数的已保存自定义模型。 */
const catalog = shallowRef<readonly CatalogProvider[]>([]);
/** 最近一次读到或存下的内容，判断有没有没保存的改动。 */
const savedText = ref("");
const revision = ref(0);
/** 各字段没提交的草稿（正在输入的文字、数字），按字段路径记：一个字段变干净不代表别的也干净。 */
const drafts = ref<ReadonlyMap<string, "dirty" | "unparseable">>(new Map());
const drafting = computed(() => drafts.value.size > 0);
const saving = ref(false);
const notice = ref<{tone: BannerTone; text: string; conflict?: boolean} | null>(null);
const testing = ref(false);
const tested = shallowRef<ViewerResult<"config.test"> | null>(null);

async function load(): Promise<void> {
    loadError.value = null;
    try {
        const [result, models] = await Promise.all([client.call("config.get", {}), client.call("models.catalog", {})]);
        loaded.value = result;
        catalog.value = models.providers;
        value.value = result.state === "valid" ? (result.config as Draft) : result.state === "absent" ? (result.config as Draft) : STARTER;
        savedText.value = result.state === "valid" ? JSON.stringify(result.config) : "";
        revision.value += 1;
        drafts.value = new Map();
        notice.value = null;
        tested.value = null;
    } catch (error) {
        loadError.value = error instanceof Error ? error.message : String(error);
    }
}
void load();

const dirty = computed(() => drafting.value || JSON.stringify(value.value) !== savedText.value);
const keys = computed<Readonly<Record<string, boolean>>>(() => loaded.value?.keys ?? {});

function update(patch: Partial<Draft>): void {
    value.value = {...value.value, ...patch};
}

// ---- 服务商与候选 ----

/**
 * 模型目录用的服务商：编辑中的自定义服务商在前，再是 OMP 目录。自定义模型以表单里写的为准，写成“自动”的字段取服务端
 * 上次补的值（保存过才有）；推理档只有服务端知道，没保存过的推理模型档未知（见 `effortsPending`）。
 */
const savedCustom = computed(() => new Map(catalog.value.filter(provider => provider.source === "custom").map(provider => [provider.id, provider])));
const providers = computed<CatalogProvider[]>(() => {
    const custom = Object.entries(value.value.providers ?? {}).map(([id, provider]): CatalogProvider => ({
        id,
        name: provider.name ?? id,
        source: "custom",
        access: "key",
        keyEnvs: [provider.apiKeyEnv],
        keySet: keys.value[provider.apiKeyEnv] ?? false,
        models: provider.models.map(model => {
            const known = savedCustom.value.get(id)?.models.find(item => item.id === model.id);
            const reasoning = model.reasoning ?? known?.reasoning ?? false;
            return {
                id: model.id, name: model.name ?? known?.name ?? model.id, api: provider.api,
                contextWindow: model.contextWindow ?? known?.contextWindow ?? null, maxTokens: model.maxTokens ?? known?.maxTokens ?? null,
                reasoning, efforts: reasoning ? (known?.efforts ?? []) : [], images: model.images ?? known?.images ?? false, price: model.price ?? known?.price ?? null,
            };
        }),
    }));
    return [...custom, ...catalog.value.filter(provider => provider.source === "catalog")];
});
/** 这个候选的推理档要等保存后才知道：本地新加、可能会推理的自定义模型。 */
function effortsPending(ref: string): boolean {
    const slash = ref.indexOf("/");
    const model = value.value.providers?.[ref.slice(0, slash)]?.models.find(item => item.id === ref.slice(slash + 1));
    if (model === undefined || model.reasoning === false) return false;
    return savedCustom.value.get(ref.slice(0, slash))?.models.some(item => item.id === model.id) !== true;
}
const catalogIds = computed(() => catalog.value.filter(provider => provider.source === "catalog").map(provider => provider.id));
const infos = computed(() => candidateInfos(value.value, providers.value));
const defaultRef = computed(() => value.value.model.use);
const defaultEfforts = computed(() => infos.value.get(defaultRef.value)?.efforts ?? []);
const thinkingOptions = computed(() => [{label: "推理档：不写", value: "none"}, ...defaultEfforts.value.map(effort => ({label: `推理档：${THINKING_LABEL[effort] ?? effort}`, value: effort}))]);
const thinking = computed({
    get: () => value.value.model.thinking ?? "none",
    set: (next: string) => update({model: {use: value.value.model.use, ...(next === "none" ? {} : {thinking: next as NonNullable<Draft["model"]["thinking"]>})}}),
});

/** 设为默认：推理档夹到新默认支持的档，不支持推理就去掉；档还不知道（见 `effortsPending`）时留着，保存后再夹。 */
function setDefault(ref: string): void {
    const current = value.value.model.thinking ?? null;
    const kept = effortsPending(ref) ? current : clampThinking(infos.value.get(ref)?.efforts ?? [], current);
    update({model: {use: ref, ...(kept === null ? {} : {thinking: kept as NonNullable<Draft["model"]["thinking"]>})}});
}

/** 去掉候选；去掉的是默认模型时改用第一个。`lead` 是调用方要先说的话，与默认模型的变化写进同一条提示。 */
function removeCandidates(refs: readonly string[], lead: string | null = null): void {
    const models = value.value.models.filter(ref => !refs.includes(ref));
    update({models});
    let change: string | null = null;
    if (refs.includes(value.value.model.use)) {
        const next = models[0] ?? "";
        if (next === "") update({model: {use: ""}});
        else setDefault(next);
        change = next === "" ? "去掉了默认模型；先添加一个模型才能保存。" : `去掉了默认模型，默认改成了 ${infos.value.get(next)?.view.label ?? next}。`;
    }
    const text = [lead, change].filter(part => part !== null).join("");
    if (text !== "") notice.value = {tone: "info", text};
}

function addCandidates(refs: readonly string[]): void {
    const models = [...value.value.models, ...refs.filter(ref => !value.value.models.includes(ref))];
    update({models});
    if (value.value.model.use === "" && models.length > 0) setDefault(models[0]!);
}

/** 服务商一节：候选用到的目录服务商与全部自定义服务商。 */
const usedProviders = computed(() => {
    const ids = new Set([...Object.keys(value.value.providers ?? {}), ...value.value.models.map(ref => ref.slice(0, ref.indexOf("/")))]);
    return providers.value.filter(provider => ids.has(provider.id));
});

function keyText(provider: CatalogProvider): {text: string; tone: "success" | "warning" | "neutral"} {
    // 改了名的密钥变量，服务启动时有没有值要保存后才知道。
    if (provider.source === "custom" && !(provider.keyEnvs[0]! in keys.value)) return {text: `${provider.keyEnvs.join(" 或 ")}：保存后才知道`, tone: "neutral"};
    const note = providerNote(provider);
    return {text: note.text, tone: !note.usable ? "warning" : provider.keySet ? "success" : "neutral"};
}

// ---- 对话框 ----
const catalogOpen = ref(false);
const providerOpen = ref(false);
const editing = shallowRef<{id: string; config: ProviderConfig} | null>(null);
/** 删服务商的确认框：开着与要删哪个分开记。AlertDialog 先发出关闭再发出确认，关闭时清掉 id，确认时就找不到要删的了。 */
const removeOpen = ref(false);
const removing = shallowRef<string | null>(null);
function askRemove(id: string): void {
    removing.value = id;
    removeOpen.value = true;
}
const removingCount = computed(() => (removing.value === null ? 0 : value.value.models.filter(ref => ref.startsWith(`${removing.value}/`)).length));

function openProvider(id: string | null): void {
    editing.value = id === null ? null : {id, config: value.value.providers![id]!};
    catalogOpen.value = false;
    providerOpen.value = true;
}

function saveProvider(saved: {id: string; config: ProviderConfig}): void {
    update({providers: {...value.value.providers, [saved.id]: saved.config}});
    // 服务商里去掉的模型，候选里也去掉。
    const gone = value.value.models.filter(ref => ref.startsWith(`${saved.id}/`) && !saved.config.models.some(model => ref === `${saved.id}/${model.id}`));
    removeCandidates(gone, editing.value === null ? `已添加服务商 ${saved.id}：用“添加模型…”把它的模型加进候选，然后保存。` : `已改服务商 ${saved.id}，保存后生效。`);
}

function removeProvider(): void {
    const id = removing.value;
    if (id === null) return;
    const {[id]: _gone, ...rest} = value.value.providers ?? {};
    update(Object.keys(rest).length === 0 ? {providers: undefined} : {providers: rest});
    removeCandidates(value.value.models.filter(ref => ref.startsWith(`${id}/`)));
}

/** 读 `/models` 的能力交给服务商表单（表单本身不发请求）。 */
const discover = (input: {api: "openai-completions" | "openai-responses"; baseUrl: string; apiKeyEnv: string}) => client.call("models.discover", input);
/** 按模型名在目录里找参照：只认精确同名（服务端运行时的补参数还认代理常见的前后缀，这里只是提示）。 */
function suggest(modelId: string) {
    if (modelId === "") return null;
    for (const provider of catalog.value) {
        if (provider.source !== "catalog") continue;
        const model = provider.models.find(item => item.id === modelId);
        if (model !== undefined) return {from: `${provider.id}/${model.id}`, contextWindow: model.contextWindow, maxTokens: model.maxTokens, reasoning: model.reasoning, images: model.images};
    }
    return null;
}

// ---- 表单（问答的限额与抽取） ----
const formValue = computed({
    get: () => ({...(value.value.qa === undefined ? {} : {qa: value.value.qa}), ...(value.value.ingest === undefined ? {} : {ingest: value.value.ingest})}),
    set: (next: {qa?: Draft["qa"]; ingest?: Draft["ingest"]}) => update({qa: next.qa, ingest: next.ingest}),
});

function at(root: unknown, path: ReadonlyArray<string>): unknown {
    let current = root;
    for (const key of path) current = typeof current === "object" && current !== null ? (current as Record<string, unknown>)[key] : undefined;
    return current;
}
/** 密钥变量名旁的提示：服务启动时它没有值，或改了名、保存后才知道。 */
const issues = computed<FormIssue[]>(() => KEY_PATHS.flatMap(path => {
    const name = at(formValue.value, path);
    if (typeof name !== "string" || name === "") return [];
    if (!(name in keys.value)) return [{path, code: "key-unknown", params: {}, severity: "warning" as const, source: "caller" as const, message: "保存后才知道这个环境变量有没有值"}];
    if (keys.value[name] === false) return [{path, code: "key-unset", params: {}, severity: "warning" as const, source: "caller" as const, message: `服务启动时环境变量 ${name} 没有值：先在启动服务的终端里设好它，再重启服务`}];
    return [];
}));

/** 没写抽取模型时，问答的默认模型能不能给抽取用（qa.md 输出 23；规则同 src/qa/config.ts 的 defaultIngestFallback）。 */
const ingestNote = computed(() => {
    if (value.value.ingest?.model !== undefined || defaultRef.value === "") return null;
    const providerId = defaultRef.value.slice(0, defaultRef.value.indexOf("/"));
    const provider = value.value.providers?.[providerId];
    if (provider === undefined) return `抽取要单独写模型：问答的默认模型 ${defaultRef.value} 是 OMP 目录里的模型，抽取只用自定义服务商的 OpenAI Chat 接口。在下面“抽取”里写抽取模型。`;
    if (provider.api !== "openai-completions") return `抽取要单独写模型：问答的默认模型用的接口是 ${provider.api}，抽取只会 OpenAI Chat 接口。在下面“抽取”里写抽取模型。`;
    return null;
});

const form = ref<InstanceType<typeof SchemaForm> | null>(null);
async function save(): Promise<void> {
    if (loaded.value === null || saving.value) return;
    // 先把正在输入的草稿提交进值；解析不了的留在表单上显示。
    if (form.value !== null && !form.value.commit()) return;
    if (value.value.models.length === 0) {
        notice.value = {tone: "danger", text: "没有保存：先用“添加模型…”添加至少一个候选模型。"};
        return;
    }
    saving.value = true;
    notice.value = null;
    let saved = false;
    try {
        const result = await client.call("config.set", {config: value.value, expect: loaded.value.digest});
        loaded.value = {state: "valid", config: value.value as never, digest: result.digest, path: result.path, keys: result.keys};
        savedText.value = JSON.stringify(value.value);
        tested.value = null;
        saved = true;
        notice.value = {tone: "success", text: "已保存。下一轮问答与下一次抽取开始时用新的配置。"};
    } catch (error) {
        if (error instanceof StoryCallError && error.code === "config_conflict") notice.value = {tone: "warning", text: "配置在别处（命令行或另一个页面）改过了。重新载入会丢掉这里没保存的改动。", conflict: true};
        else notice.value = {tone: "danger", text: `没有保存：${error instanceof Error ? error.message : String(error)}`};
    } finally {
        saving.value = false;
    }
    if (saved) await refreshCatalog();
}

/** 保存后刷新目录：服务端补过参数的自定义模型（上下文、推理档）跟着变。刷新失败不改“已保存”的结论。 */
async function refreshCatalog(): Promise<void> {
    try {
        catalog.value = (await client.call("models.catalog", {})).providers;
    } catch (error) {
        notice.value = {tone: "warning", text: `已保存，但没能刷新模型目录（${error instanceof Error ? error.message : String(error)}）：重新载入页面后再看上下文与推理档。`};
    }
}

async function test(): Promise<void> {
    testing.value = true;
    tested.value = null;
    try {
        tested.value = await client.call("config.test", {});
    } catch (error) {
        notice.value = {tone: "danger", text: `测试连接失败：${error instanceof Error ? error.message : String(error)}`};
    } finally {
        testing.value = false;
    }
}

function onDraftState(state: {path: ReadonlyArray<string | number>; state: "clean" | "dirty" | "unparseable"}): void {
    const next = new Map(drafts.value);
    const key = JSON.stringify(state.path);
    if (state.state === "clean") next.delete(key);
    else next.set(key, state.state);
    drafts.value = next;
}

/** 从别的页面进来的回到那里；直接打开地址的（没有上一页）回书架。 */
function back(): void {
    if ((window.history.state as {back?: unknown} | null)?.back) router.back();
    else void router.push("/");
}

function contextText(window: number | null): string {
    return window === null ? "上下文未知" : `上下文 ${formatTokenCount(window)}`;
}
</script>

<template>
    <main class="story-scroll-y h-full" data-testid="settings-page">
        <div class="settings-page">
            <div class="settings-head">
                <Button size="sm" variant="ghost" icon-class="i-lucide-arrow-left" @click="back()">返回</Button>
                <h1 class="settings-title"><span class="i-lucide-settings" />设置</h1>
                <ThemeMenu class="ml-auto" />
            </div>
            <p v-if="loaded" class="settings-path">配置文件 <code>{{ loaded.path }}</code>，与命令行 <code>nbstory config</code> 改的是同一份。</p>

            <Banner v-if="loadError" tone="danger" :message="`读不到配置：${loadError}`" />
            <Banner v-if="loaded?.state === 'absent'" tone="info" message="还没有配置文件：先添加一个模型，保存后会新建它。" data-testid="settings-absent" />
            <Banner v-if="loaded?.state === 'invalid'" tone="danger" :message="`配置文件有问题：${loaded.problem}。下面从一份空的配置开始，保存会整份覆盖它。`" data-testid="settings-invalid" />

            <section v-if="loaded" class="models" data-settings-models>
                <header>
                    <h2 class="models-title">模型</h2>
                    <p class="models-note">问答用打勾的默认模型；问答页的输入框里可以在这几个之间换。</p>
                </header>
                <ul v-if="value.models.length > 0" class="models-list">
                    <li v-for="ref in value.models" :key="ref" class="models-row" :class="{'is-default': ref === defaultRef}" :data-settings-candidate="ref">
                        <button type="button" class="models-check" :class="ref === defaultRef ? 'i-lucide-circle-check-big' : 'i-lucide-circle'" :aria-label="ref === defaultRef ? '默认模型' : '设为默认'" :aria-pressed="ref === defaultRef" data-settings-default @click="setDefault(ref)" />
                        <div class="models-main">
                            <div class="models-name">{{ infos.get(ref)?.view.label ?? ref }}<Badge v-if="ref === defaultRef" size="sm" variant="soft" tone="accent">默认</Badge></div>
                            <div class="models-meta">
                                {{ infos.get(ref)?.view.group }} · {{ contextText(infos.get(ref)?.contextWindow ?? null) }}<template v-if="(infos.get(ref)?.efforts.length ?? 0) > 0"> · 推理</template><template v-else-if="effortsPending(ref)"> · 推理档保存后才知道</template>
                                <template v-if="infos.get(ref)?.view.unavailable"> · <span class="models-warn">{{ infos.get(ref)?.view.unavailable }}</span></template>
                            </div>
                        </div>
                        <div v-if="ref === defaultRef && defaultEfforts.length > 0" class="models-thinking"><Select v-model="thinking" size="sm" :options="thinkingOptions" data-settings-thinking /></div>
                        <IconButton size="sm" icon-class="i-lucide-x" aria-label="从候选里去掉" data-settings-remove-candidate @click="removeCandidates([ref])" />
                    </li>
                </ul>
                <p v-else class="models-note">还没有候选模型。</p>
                <div class="models-actions">
                    <Button size="sm" variant="secondary" icon-class="i-lucide-plus" data-settings-add-model @click="catalogOpen = true">添加模型…</Button>
                </div>

                <h3 class="models-subtitle">服务商</h3>
                <ul v-if="usedProviders.length > 0" class="models-list">
                    <li v-for="provider in usedProviders" :key="provider.id" class="models-row" :data-settings-provider="provider.id">
                        <span class="models-icon" :class="provider.source === 'custom' ? 'i-lucide-server-cog' : 'i-lucide-cloud'" />
                        <div class="models-main">
                            <div class="models-name">{{ provider.name }}<Badge size="sm" variant="outline">{{ provider.source === "custom" ? "自定义" : "OMP 目录" }}</Badge></div>
                            <div class="models-meta">
                                <template v-if="provider.source === 'custom'">{{ value.providers?.[provider.id]?.api }} · {{ value.providers?.[provider.id]?.baseUrl }} · </template>
                                <span :class="`models-key is-${keyText(provider).tone}`">{{ keyText(provider).text }}</span>
                            </div>
                        </div>
                        <template v-if="provider.source === 'custom'">
                            <IconButton size="sm" icon-class="i-lucide-pencil" aria-label="编辑服务商" data-settings-edit-provider @click="openProvider(provider.id)" />
                            <IconButton size="sm" icon-class="i-lucide-trash-2" aria-label="删除服务商" data-settings-remove-provider @click="askRemove(provider.id)" />
                        </template>
                    </li>
                </ul>
                <div class="models-actions">
                    <Button size="sm" variant="secondary" icon-class="i-lucide-plus" data-settings-add-provider @click="openProvider(null)">添加自定义服务商…</Button>
                    <span class="models-note">OMP 目录里的服务商不用添加：选了它的模型就会出现在这里。</span>
                </div>
            </section>

            <Banner v-if="loaded && ingestNote" tone="info" :message="ingestNote" data-testid="settings-ingest-note" />

            <SchemaForm
                v-if="loaded"
                ref="form"
                v-model="formValue"
                :schema="FORM_SCHEMA"
                :layout="LAYOUT"
                locale="zh-CN"
                :issues="issues"
                :revision="revision"
                @draft-state="onDraftState"
            />

            <Banner v-if="notice" :tone="notice.tone" :message="notice.text" data-testid="settings-notice">
                <template v-if="notice.conflict" #actions><Button size="sm" @click="load()">重新载入</Button></template>
            </Banner>
            <div v-if="loaded" class="settings-actions">
                <Button :disabled="!dirty || saving" data-testid="settings-save" @click="save()">{{ saving ? "保存中…" : "保存" }}</Button>
                <Button variant="secondary" :disabled="dirty || testing || loaded.state !== 'valid'" :title="dirty ? '先保存，测试的是保存下来的配置' : undefined" data-testid="settings-test" @click="test()">{{ testing ? "测试中…" : "测试连接" }}</Button>
                <span v-if="dirty" class="settings-hint">有没保存的改动；测试连接测的是保存下来的默认模型</span>
            </div>
            <div v-if="tested" class="settings-tested" :class="tested.ok ? 'is-ok' : 'is-failed'" data-testid="settings-tested">
                <template v-if="tested.ok">通过：{{ tested.model }} 正常回话（{{ (tested.ms / 1000).toFixed(1) }} 秒）。推理档：{{ tested.thinking ?? "未设" }}，一个小请求证明不了服务端是否按这个档思考。</template>
                <template v-else>没通过（{{ tested.model }}）：{{ tested.error?.message }}</template>
            </div>
        </div>

        <div class="settings-page"><SkillInstall /></div>

        <AgentModelCatalog v-model:open="catalogOpen" :providers="providers as readonly CatalogProviderView[]" :chosen="value.models" locale="zh-CN" @pick="addCandidates" @add-provider="openProvider(null)" />
        <ProviderDialog v-model:open="providerOpen" :provider="editing" :taken-ids="[...catalogIds, ...Object.keys(value.providers ?? {}).filter(id => id !== editing?.id)]" :keys="keys" :discover="discover" :suggest="suggest" @save="saveProvider" />
        <AlertDialog
            v-model:open="removeOpen"
            :title="`删除服务商 ${removing ?? ''}`"
            :description="removingCount > 0 ? `候选里有 ${removingCount} 个模型来自它，会一起去掉。保存后生效。` : '保存后生效。'"
            confirm-label="删除"
            tone="danger"
            @confirm="removeProvider"
        />
    </main>
</template>

<style scoped>
.settings-page { max-width: 760px; margin: 0 auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.settings-head { display: flex; align-items: center; gap: 8px; }
.settings-title { display: flex; align-items: center; gap: 8px; font-size: var(--text-lg); font-weight: var(--weight-strong); }
.settings-path { color: var(--text-muted); font-size: var(--text-xs); }
.settings-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.settings-hint { color: var(--text-muted); font-size: var(--text-xs); }
.settings-tested { border-radius: var(--radius-control); padding: 8px 10px; font-size: var(--text-sm); }
.settings-tested.is-ok { background: var(--status-success-bg); color: var(--status-success); }
.settings-tested.is-failed { background: var(--status-danger-bg); color: var(--status-danger); }
.models { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border-color); border-radius: var(--radius-card, 10px); padding: 14px 16px; background: var(--panel-surface); }
.models-title { font-size: var(--text-md, 15px); font-weight: var(--weight-strong); }
.models-subtitle { margin-top: 8px; font-size: var(--text-sm); font-weight: var(--weight-strong); }
.models-note { color: var(--text-muted); font-size: var(--text-xs); line-height: 1.5; }
.models-list { display: flex; flex-direction: column; border: 1px solid var(--divider); border-radius: var(--radius-control); }
/* 窄了推理档换到下一行：模型名至少留 12em，不被挤成几行。 */
.models-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 10px; min-width: 0; }
.models-row + .models-row { border-top: 1px solid var(--divider); }
.models-row.is-default { background: color-mix(in srgb, var(--accent-bg) 50%, transparent); }
.models-check { width: 16px; height: 16px; flex: none; color: var(--text-muted); }
.models-row.is-default .models-check { color: var(--accent-text); }
.models-icon { width: 16px; height: 16px; flex: none; color: var(--text-secondary); }
.models-main { flex: 1 1 12em; min-width: 0; }
.models-name { display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); color: var(--text-main); }
.models-meta { color: var(--text-muted); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.models-warn, .models-key.is-warning { color: var(--status-warning); }
.models-key.is-success { color: var(--status-success); }
.models-thinking { width: 140px; flex: none; }
.models-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
</style>
