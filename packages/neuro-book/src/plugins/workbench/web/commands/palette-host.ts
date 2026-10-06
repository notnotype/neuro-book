/**
 * 命令面板的宿主状态：开合、查询、捕获的行号目标、会话 MRU，以及活动编辑器的接入口（workbench.quick-open）。
 *
 * 一个页面上的宿主一份：产品页的命令宿主建一份，Lab 的命令场景建一份，随宿主组件卸载释放。
 * 命令从注入的命令服务取，面板不知道命令来自插件的命令表还是 Lab 场景的本地命令表。
 */

import {ref, shallowRef} from "vue";
import type {Ref, ShallowRef} from "vue";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";

/** 文档身份：行号跳转把它原样交给 `nbook.editor.go-to-line`；面板只判断是不是同一份文档的同一代。 */
export type DocumentTarget = Readonly<Record<string, string | number>>;

/** 两个文档身份逐字段相同才算同一份；任一侧为 null 都不算。 */
export function sameDocument(left: DocumentTarget | null, right: DocumentTarget | null): boolean {
    if (left === null || right === null) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key]);
}

/** 行号模式需要的活动编辑器信息。产品里随编辑器插件接入；Lab 里由命令场景的样板编辑器给出。 */
export interface PaletteEditor {
    readonly target: DocumentTarget;
    /** 不支持行号跳转时为 null；函数返回 null 表示编辑器还没就绪。 */
    readonly lineCount: (() => number | null) | null;
}

export interface PaletteHost {
    readonly commands: CommandService;
    /** 命令表每次增减加一：面板据此重算候选，不轮询。 */
    readonly revision: Readonly<Ref<number>>;
    /** 活动编辑器，由持有编辑器的一方写入。 */
    readonly editor: ShallowRef<PaletteEditor | null>;
    /** 正文每次变化加一，由持有编辑器的一方写入：行号模式据此重读行数。 */
    readonly editorRevision: Ref<number>;
    /** 会话 MRU：成功执行的面板选中命令，去重前插，最多 30 条；与宿主同寿，不持久化。 */
    readonly recent: Readonly<ShallowRef<readonly string[]>>;
    readonly open: Readonly<Ref<boolean>>;
    readonly query: Ref<string>;
    /** 第一次打开时捕获的活动文档：面板打开期间切换文档不改变它。 */
    readonly target: Readonly<ShallowRef<DocumentTarget | null>>;
    /** 已打开时再次请求命令模式：只把焦点交回输入框，不重置输入。 */
    readonly focusRequest: Readonly<Ref<number>>;
    openPalette(mode: "commands" | "line"): void;
    closePalette(): void;
    remember(id: string): void;
    /** 停止跟踪命令表并关闭面板。 */
    dispose(): void;
}

export interface PaletteHostOptions {
    readonly commands: CommandService;
    /** 面板开合时通知；Lab 用它填上下文键 `quick-open-visible`。 */
    readonly onVisibleChange?: (visible: boolean) => void;
}

const RECENT_LIMIT = 30;

export function createPaletteHost(options: PaletteHostOptions): PaletteHost {
    const revision = ref(0);
    const editor = shallowRef<PaletteEditor | null>(null);
    const editorRevision = ref(0);
    const recent = shallowRef<readonly string[]>([]);
    const open = ref(false);
    const query = ref("");
    const target = shallowRef<DocumentTarget | null>(null);
    const focusRequest = ref(0);
    const unsubscribe = options.commands.onDidChange(() => {
        revision.value += 1;
    });

    const closePalette = (): void => {
        const wasOpen = open.value;
        open.value = false;
        query.value = "";
        target.value = null;
        if (wasOpen) options.onVisibleChange?.(false);
    };

    return {
        commands: options.commands,
        revision,
        editor,
        editorRevision,
        recent,
        open,
        query,
        target,
        focusRequest,
        openPalette(mode) {
            if (!open.value) {
                target.value = editor.value === null ? null : {...editor.value.target};
                query.value = mode === "line" ? ":" : ">";
                open.value = true;
                options.onVisibleChange?.(true);
            } else if (mode === "line") {
                query.value = ":";
            } else {
                focusRequest.value += 1;
            }
        },
        closePalette,
        remember(id) {
            recent.value = [id, ...recent.value.filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
        },
        dispose() {
            unsubscribe();
            closePalette();
        },
    };
}
