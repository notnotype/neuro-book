<script setup lang="ts">
/**
 * 插图卡片的 Lab 场景（docs/specs/workbench/markdown-editing.md 输出 54、58，同名 `MarkdownImageCard.md`）：真实的卡片组件与真实的
 * `createMarkdownMedia`，文件服务是内存里的一份假数据（不经服务端）。场景决定数据与宿主状态：有图的列表、读取中、没有图、读不了、
 * 查到的比显示的多、宿主没有提供插图能力、提供了但没有绑定作品、上传要两秒；`english` 用英文界面。选定图片只记事件（`insert`），
 * 不真的往哪里写。
 */
import {computed, shallowRef} from "vue";

import type {EditorMenus} from "nbook/plugins/editor/shared/contracts";
import {editorText} from "nbook/plugins/editor/shared/text";
import {createMarkdownMedia} from "nbook/plugins/markdown/web/media";
import type {MarkdownMedia} from "nbook/plugins/markdown/web/media";
import MarkdownImageCard from "nbook/plugins/markdown/web/components/menus/MarkdownImageCard.vue";

import {type LabFixtureProps, useLabEventSink, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideEditorText} from "nbook/plugins/editor/web/lab/editor-text";

const props = defineProps<LabFixtureProps>();
/** 场景输入里的 `open`、`session`、`current` 传给卡片；`anchor`、`menus`、`media` 是运行期的东西，由夹具按场景给（登记里的 `anchor`、`media` 占位为 null）。 */
const subject = useLabSubject<typeof MarkdownImageCard>(() => props.input);
const text = provideEditorText(props.scene);
const record = useLabEventSink();

/** 画出来的缩略图：色块加名字第一个字；名字里带“坏”的加载失败，卡片画占位图标。 */
const COLORS = ["#7287fd", "#e78284", "#a6d189", "#ef9f76", "#ca9ee6", "#81c8be"];
const thumbnail = (address: string): string => {
    if (address.includes("坏")) return "data:image/png;base64,broken";
    const name = address.slice(address.lastIndexOf("/") + 1);
    const color = COLORS[[...name].reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0) % COLORS.length] ?? COLORS[0];
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="white">${[...name][0] ?? ""}</text></svg>`)}`;
};

const NAMES = ["粘贴的图片 20261117-140533.png", "粘贴的图片 20261117-133012.png", "林雪的设定图.webp", "码头与灯塔的夜景，雾很大的时候从海上拍到的一张很长很长名字的图.jpg", "封面.png", "坏掉的图.png", "地图.gif", "角色立绘.png"];

function sceneMedia(): MarkdownMedia | null {
    const scene = props.scene.replace(/^english$/u, "list");
    if (scene === "no-library") return null;
    const entries = scene === "empty" || scene === "loading" || scene === "error" ? [] : scene === "truncated" ? Array.from({length: 15}, (_, index) => `图片 ${String(index + 1).padStart(2, "0")}.png`) : NAMES;
    return createMarkdownMedia({
        files: {
            list: () => {
                if (scene === "loading") return new Promise(() => undefined);
                if (scene === "error") return Promise.resolve({ok: false, code: "permission-denied", detail: "没有权限读取插图目录"});
                return Promise.resolve({ok: true, value: {folder: "plain", contentRoot: null, entries: entries.map((name) => ({name, kind: "file" as const}))}});
            },
            upload: (address) => new Promise((resolve) => setTimeout(() => resolve({ok: true, address, renamed: false}), 2000)),
            rawUrl: thumbnail,
        },
        find: (input) => Promise.resolve({ok: true, value: {items: NAMES.filter((name) => name.includes(input.query)).map((name) => ({path: `卷一/图/${name}`, name})), truncated: false}}),
        bound: scene !== "unbound",
        settings: {location: () => "folder", folder: () => "插图"},
    });
}
const media = sceneMedia();

/** 卡片只用到文字与通知。 */
const menus = {
    label: (key: string, params?: Readonly<Record<string, string | number>>) => text.t(editorText(`menus.${key}` as never, params)),
    notify: (key: string, params?: Readonly<Record<string, string | number>>) => record("notify", {key, params}),
} as unknown as EditorMenus;

const anchorElement = shallowRef<HTMLElement | null>(null);
const anchor = computed(() => anchorElement.value);
</script>

<template>
    <div class="h-full w-full">
        <div ref="anchorElement" class="ml-6 mt-6 inline-block h-6 w-0.5 bg-[var(--accent)]" aria-hidden="true" />
        <MarkdownImageCard
            data-lab-subject
            v-bind="subject.bindings.value"
            :anchor="anchor"
            :menus="menus"
            :media="media"
            @insert="(image) => record('insert', image)"
            @cancel="record('cancel')"
            @dismiss="record('dismiss')"
        />
    </div>
</template>
