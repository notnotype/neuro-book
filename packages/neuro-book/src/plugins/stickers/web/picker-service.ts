/**
 * 选择器服务（`StickerPicker`，docs/specs/agent/stickers.md 输出 39 到 43）：把浏览器目录、拼音库与最近用过的记录接成响应式状态，
 * 交给 Markdown 编辑器与 Agent 输入框。面板组件按需加载，绑上本服务交出去，宿主只管插在哪里。
 */

import {defineComponent, h, shallowRef} from "vue";
import type {Component} from "vue";

import type {StickerDirectoryService, StickerPicker} from "../shared/contracts";
import {knownWriting, pickerGroups, pinyinInitials, recentItems, searchStickers} from "./picker";
import type {Initials} from "./picker";
import type {RecentStickers} from "./recent";

export interface StickerPickerOptions {
    readonly directory: StickerDirectoryService;
    readonly recent: RecentStickers;
    readonly openPacksPage: () => void;
    readonly report: (message: string, error: unknown) => void;
    /** 停止信号：撤掉对目录的订阅。 */
    readonly signal: AbortSignal;
}

export function createStickerPicker(options: StickerPickerOptions): StickerPicker {
    const packs = shallowRef(options.directory.current());
    const unsubscribe = options.directory.subscribe(() => {
        packs.value = options.directory.current();
    });
    options.signal.addEventListener("abort", unsubscribe, {once: true});

    // 拼音库第一次搜索时才加载：加载完之前只按名字与包筛，加载好后读 `initials` 的计算自然重算（同斜杠菜单）。
    const initials = shallowRef<Initials>(null);
    let pinyinRequested = false;
    const loadPinyin = (): void => {
        if (pinyinRequested) return;
        pinyinRequested = true;
        import("pinyin-pro").then(({pinyin}) => {
            initials.value = pinyinInitials(pinyin);
        }).catch((error: unknown) => options.report("pinyin library failed to load; sticker search matches names only", error));
    };

    let groupsFor: readonly unknown[] | null = null;
    let groupsCache: ReturnType<typeof pickerGroups> = [];
    const groups = (): ReturnType<typeof pickerGroups> => {
        const current = packs.value ?? [];
        if (groupsFor !== current) {
            groupsFor = current;
            groupsCache = pickerGroups(current);
        }
        return groupsCache;
    };

    let panel: Component | null = null;
    const picker: StickerPicker = {
        groups,
        search(query, limit) {
            loadPinyin();
            return searchStickers(groups(), packs.value ?? [], query, limit, initials.value);
        },
        known: (raw) => (packs.value === null ? undefined : knownWriting(packs.value, raw)),
        recent: () => recentItems(groups(), options.recent.entries()),
        used: (item) => options.recent.use({pack: item.pack, name: item.name}),
        async loadPanel() {
            if (panel !== null) return panel;
            const {default: Panel} = await import("./components/StickerPickerPanel.vue");
            // 透传宿主给的属性与 `onPick`、`onClose` 监听，只补上本服务。
            panel = defineComponent({name: "BoundStickerPickerPanel", inheritAttrs: false, setup: (_props, {attrs}) => () => h(Panel, {...attrs, picker})});
            return panel;
        },
        openPacksPage: options.openPacksPage,
    };
    return picker;
}
