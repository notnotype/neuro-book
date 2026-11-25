<script setup lang="ts">
/**
 * 设置窗口“作品”分区的页面（同名 .md）：作品目录一行，“更改…”打开书架同一个目录选择器，选定后写进用户层；没设时显示
 * 服务端实际会用的缺省目录（docs/specs/workbench/bookshelf.md 输出 21）。下面一行“启动时打开”，上次的作品或书架
 * （docs/specs/runtime/projects.md 的“启动时打开”）。
 */
import {Button, SegmentedControl} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import type {SettingLayer, SettingsService} from "nbook/shared/settings";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {librarySetting, startupOpenSetting} from "../../shared/contracts";
import {useProjectsText} from "../text";
import type {LibraryInfo} from "../shelf-page";
import type {WorksWriteFailure} from "../works-section";
import PathPickerDialog from "./PathPickerDialog.vue";
import type {PathPickerSource} from "./PathPickerDialog.vue";

defineOptions({name: "WorksSettingsPage"});

const props = defineProps<{
    /** 设置窗口当前的标签（`context.layer`）：这个分区只在“用户”标签下可用。 */
    layer: SettingLayer;
    settings: SettingsService;
    source: PathPickerSource;
    /** 当前有效的作品目录（产品里是 `nbook.projects/projects` 的 `library()`）；取不到为 null。 */
    readLibrary: () => Promise<LibraryInfo | null>;
}>();

const emit = defineEmits<{
    (event: "write-failed", failure: WorksWriteFailure): void;
}>();

const text = useProjectsText();

const picking = ref(false);
/** 这次选定、还在写的目录：写入结算之前显示它，结算后回到层里的值。 */
const pending = ref<string | null>(null);

/** 路径文字；空串为没设。空白同样算没设：服务端按 trim 之后判断（`backend/library.ts`）。 */
function shown(value: unknown): string {
    return pending.value ?? (typeof value === "string" ? value.trim() : "");
}

/** 没设时显示的缺省目录。取到之前不显示；再取时保留上一次的结果，免得恢复默认时闪一下。 */
type Fallback = {readonly status: "loading"} | {readonly status: "ready"; readonly path: string} | {readonly status: "failed"};
const fallback = ref<Fallback>({status: "loading"});
let reads = 0;

async function readFallback(): Promise<void> {
    const token = (reads += 1);
    const library = await props.readLibrary();
    if (token !== reads) return;
    if (library === null) fallback.value = {status: "failed"};
    // source 是 setting：服务端已读到一个设置值、本页还没收到。收到后就不再是没设，这次结果不显示。
    else if (library.source === "default") fallback.value = {status: "ready", path: library.path};
}

// 每次进入没设（打开分区时、恢复默认之后）都向服务端取一次：缺省目录由服务端按它的主目录算出。
watch(() => shown(props.settings.get(librarySetting)) === "", (unset) => {
    if (unset) void readFallback();
}, {immediate: true});

const startupOptions = computed(() => (["last-work", "shelf"] as const).map((value) => ({value, label: text(`settings.startupOpen.choices.${value}.title`)})));

/** “启动时打开”的写入进行中：控件停用，不并发写第二次；结算后控件显示层里的值（写不进去就回到原来的）。 */
const writingStartup = ref(false);

async function chooseStartup(value: "last-work" | "shelf"): Promise<void> {
    writingStartup.value = true;
    try {
        const result = await props.settings.update(startupOpenSetting, value, {layer: "user"});
        if (!result.ok) emit("write-failed", {setting: "startupOpen", code: result.code, detail: result.detail});
    } finally {
        writingStartup.value = false;
    }
}

async function pick(path: string): Promise<void> {
    picking.value = false;
    pending.value = path;
    try {
        // 作品目录只允许用户层（分区声明 layers: ["user"]）：写用户层，不跟随别的标签。
        const result = await props.settings.update(librarySetting, path, {layer: "user"});
        if (!result.ok) emit("write-failed", {setting: "library", code: result.code, detail: result.detail});
    } finally {
        pending.value = null;
    }
}
</script>

<template>
    <div class="works-settings" data-works-settings>
        <SettingsRow
            v-slot="row"
            :settings="settings"
            :setting="librarySetting"
            :layer="layer"
            @write-failed="(failure) => emit('write-failed', {setting: 'library', code: failure.code, detail: failure.detail})"
        >
            <span v-if="shown(row.value) !== ''" class="works-settings__path" data-works-library>{{ shown(row.value) }}</span>
            <span v-else-if="fallback.status === 'ready'" class="works-settings__path" data-works-library data-works-library-default>{{ fallback.path }}<span class="works-settings__mark">{{ text('worksSettings.defaultMark') }}</span></span>
            <span v-else-if="fallback.status === 'failed'" class="works-settings__unknown" data-works-library data-works-library-default-unknown>{{ text('worksSettings.defaultUnknown') }}</span>
            <Button
                :id="row.id"
                variant="secondary"
                size="sm"
                :disabled="row.disabled || pending !== null"
                data-works-library-change
                @click="picking = true"
            >{{ text('worksSettings.change') }}</Button>
            <!-- 选择器在行的插槽里：模态对话框叠在设置窗口之上，关闭时焦点回到“更改…”。 -->
            <PathPickerDialog
                :open="picking"
                mode="directory"
                :source="source"
                :initial-path="shown(row.value) === '' ? null : shown(row.value)"
                @pick="pick"
                @cancel="picking = false"
            />
        </SettingsRow>
        <SettingsRow
            v-slot="row"
            :settings="settings"
            :setting="startupOpenSetting"
            :layer="layer"
            @write-failed="(failure) => emit('write-failed', {setting: 'startupOpen', code: failure.code, detail: failure.detail})"
        >
            <SegmentedControl
                :model-value="row.value as string"
                :options="startupOptions"
                size="sm"
                :aria-label="row.label"
                :disabled="row.disabled || writingStartup"
                data-works-startup
                @update:model-value="(value) => chooseStartup(value as 'last-work' | 'shelf')"
            />
        </SettingsRow>
    </div>
</template>

<style scoped>
.works-settings {
    display: flex;
    flex-direction: column;
}

/* 与单行输入同宽（settings-window.md 输出 9）：长路径在任意处折行，不撑破行。 */
.works-settings__path,
.works-settings__unknown {
    max-width: 320px;
    min-width: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    overflow-wrap: anywhere;
}

.works-settings__path {
    /* 路径要能复制（nb-ui 规范的“文字能否选中”）。 */
    user-select: text;
    font-family: var(--font-mono);
    color: var(--text-secondary);
}

/* “（缺省）”是说明，不是路径的一部分：界面字体、淡色。 */
.works-settings__mark {
    font-family: var(--font-ui);
    color: var(--text-muted);
}

.works-settings__unknown {
    color: var(--text-muted);
}
</style>
