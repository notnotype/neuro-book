<script setup lang="ts">
/** Markdown 富文本控件（同名 .md）：一个 Tiptap 编辑器实例，按编辑器控件合同（`nbook/plugins/editor/web/control.ts`）绑定文档。 */
import {Editor} from "@tiptap/core";
import {EditorState, Selection, TextSelection} from "@tiptap/pm/state";
import type {Transaction} from "@tiptap/pm/state";
import {computed, inject, markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch} from "vue";

import "@notnotype/nb-markdown/markdown.css";

import {createMarkdownEditorExtensions, FRONTMATTER_REQUEST, listComments, markdownEditingActions, MarkdownProperties, markShownComment, REFRESH_REFERENCE_LINKS, releaseSelection, setFrontmatterEol} from "@notnotype/nb-markdown/editor";
import type {MarkdownViewHost} from "@notnotype/nb-markdown/editor";
import {markdownViewContext, useMarkdownText} from "@notnotype/nb-markdown/host";
import {STICKER_PREVIEW_MIN_SIZE} from "@notnotype/nb-markdown";
import type {StickerPreview} from "@notnotype/nb-markdown";
import {ImagePreviewDialog} from "@notnotype/nb-ui/components";
import {codecFor, frontmatterOf, isWholeFrontmatter} from "@notnotype/nb-markdown/language";
import type {MarkdownCodec, MarkdownLanguage, SourceMap} from "@notnotype/nb-markdown/language";

import {editorMenusKey, editorToolbarSlotKey, markdownEditorOptionsKey} from "nbook/plugins/editor/shared/contracts";
import type {EditorControlHandle, EditorEditing, EditorOutline, TextEditorBinding, ViewStateSlot} from "nbook/plugins/editor/shared/contracts";
import type {EditorControlEmits} from "nbook/plugins/editor/web/control";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {NBOOK_IMAGE_MISSING, nbookChips} from "../host";
import {markdownMediaKey} from "../media";
import {markdownPropertiesDescribeKey} from "../properties-catalog";
import {createViewImages} from "../view-images";
import {classifyTarget} from "../../shared/targets";
import {MARGIN_GAP, MARGIN_WIDTH} from "./menus/comments/margin-layout";
import {languageFor} from "../language-registry";
import {usePropertiesOpen} from "../properties-open";
import MarkdownMenus from "./menus/MarkdownMenus.vue";
import MarkdownToolbar from "./menus/MarkdownToolbar.vue";
import {markdownAssetsKey} from "../parts/asset-urls";
import {markdownReportKey} from "../parts/report";
import {markdownStickersKey} from "../parts/stickers";
import {syntaxCatalogKey} from "../syntax-catalog";

// `locale`：控件合同的一员。本控件不按它取文字：引用小块的悬停提示与图片的说明经窗口注入的翻译端口（下面的 `context`），
// 编辑器区传的 `locale` 就是那个端口的语言。
const props = defineProps<{binding: TextEditorBinding | null; host: ViewStateSlot; readonly: boolean; visible: boolean; label: string; placeholder?: string; locale?: DisplayLocale}>();
const emit = defineEmits<EditorControlEmits>();

/** 编辑器区给的菜单；Lab 与组件测试不经插件挂控件时没有，就没有工具栏与菜单。 */
const menus = inject(editorMenusKey, null);
/** 工具栏并入面包屑那一行时传送到这里；传送出去后它不在控件里，这个控件不可见时要自己不画。 */
const toolbarSlot = inject(editorToolbarSlotKey, null);
/** 纸面排版（设置“Markdown 正文”）；没有注入时（Lab）用样式里的缺省。 */
const paperOptions = inject(markdownEditorOptionsKey, null);
/** 变量只写在本控件的根上：更外层的 `--markdown-font-size` 会被对话里的 Markdown 展示器继承。字体留空不写，走皮肤与界面字体。 */
const paperStyle = computed(() => {
    const options = paperOptions?.value;
    if (options === undefined) return undefined;
    return {
        "--markdown-font-size": `${String(options.fontSize)}px`,
        "--markdown-line-height": String(options.lineHeight),
        ...(options.fontFamily === "" ? {} : {"--markdown-user-font": options.fontFamily}),
    };
});
const toolbarTarget = computed(() => (menus?.toolbarPlacement.value === "merged" ? (toolbarSlot?.value as HTMLElement | null | undefined) ?? null : null));
const catalog = inject(syntaxCatalogKey, null);
if (catalog === null) throw new Error("MarkdownControl 要由 nbook.markdown 交出的组件挂上：缺少方言目录（syntaxCatalogKey）");

/** 停止输入这么久才把正文交给文档；保存、切换与离开之前会立即结算。 */
const COMMIT_DELAY_MS = 150;

/** 光标停下这么久才记到标签上（随会话记录保存，输出 30）；换文档与失焦时立即记。 */
const CURSOR_REMEMBER_MS = 1000;

/**
 * 每个标签一份，存在绑定的槽里：编辑状态（含撤销历史与选区）、原文对照（编解码器写回用，随每次被接受的写出累积）、
 * 确认过的修订、`held`（这个视图的输入没有进入正文：未裁决或写不出，别处的修改不重载它）与滚动位置。
 */
interface MarkdownViewState {
    state: EditorState;
    map: SourceMap;
    confirmed: number;
    held: boolean;
    scroll: number;
}

const text = useMarkdownText();

/** 属性的图标、显示名与类型（输出 59 到 61）：插件入口按贡献点建好，没有注入（Lab、组件测试）时面板照旧。 */
const describeProperty = inject(markdownPropertiesDescribeKey, undefined);

/** 插图能力（输出 54 到 58）：没有提供时（Lab、不带编辑器区的场景）粘贴照原来的粘贴、插图卡片只能插网址。 */
const media = inject(markdownMediaKey, null);
const report = inject(markdownReportKey, null);

/**
 * 打开链接（输出 53）：作品里的文件与用户资产在编辑器区打开；外部网址在新标签页打开（用临时的 `<a>`：`window.open` 打开
 * `mailto:` 会留下空白标签页）；文件内的片段（`#标题`）与别的方案不处理。“外部”只有 `http`、`https`、`mailto`（`classifyTarget`
 * 的缺省规则），所以写在文件里的 `javascript:` 一类不会被执行。没有编辑器区（`menus` 为 null）时没有这个能力。
 */
function openLink(href: string): void {
    const target = href.trim();
    if (target === "" || target.startsWith("#")) return;
    const classified = classifyTarget(target, bound?.address.value ?? null);
    if (classified.kind === "external") {
        const anchor = document.createElement("a");
        anchor.href = target;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
        return;
    }
    if ((classified.kind === "work" || classified.kind === "user") && classified.address !== null) menus?.execute("nbook.editor.open", {address: classified.address, mode: "permanent"});
}

/**
 * 单击正文里表情的图打开的大图（docs/specs/agent/stickers.md 输出 46）。对话框关上时保留 `stickerPreview`，关闭动画期间图不消失；
 * 焦点由 Dialog 还给打开前的正文。
 */
const stickerPreview = shallowRef<StickerPreview | null>(null);
const stickerPreviewOpen = ref(false);
function previewSticker(sticker: StickerPreview): void {
    stickerPreview.value = sticker;
    stickerPreviewOpen.value = true;
}

/**
 * 方言外观（引用小块、图片）要的宿主信息：地址按函数取，换文档不重建扩展；`context` 带着注入的翻译端口，节点视图挂的图片
 * 跟着端口换语言。引用小块的悬停提示是算装饰时取的字符串，不跟着端口，换语言时由下面的 `watch` 重算。
 */
const viewHost: MarkdownViewHost = {
    base: () => bound?.address.value ?? null,
    context: markdownViewContext(text),
    assets: inject(markdownAssetsKey, null),
    stickers: inject(markdownStickersKey, null) ?? undefined,
    previewSticker,
    report: (message, error) => report?.("markdown.view.failed", message, error),
    chips: nbookChips,
    imageMissing: NBOOK_IMAGE_MISSING,
    ...(menus === null ? {} : {openLink}),
    ...(media === null ? {} : {images: createViewImages(media, () => bound?.address.value ?? null, (key, params) => menus?.notify(key, params))}),
};

/**
 * 扩展里放的宿主：读“当前这次挂载”的 `viewHost`。编辑器实例存在标签的实例槽里，控件卸载（拆分、移动标签）后在新位置重挂
 * 时复用它，扩展不重建，所以扩展里不能直接放某一次挂载的 `viewHost`（它的 `base()` 读的 `bound` 在那次卸载后是 null）。
 * 事件发生时才读：粘贴、点链接与点表情的处理都在事件里取 `host.images`、`host.openLink`、`host.previewSticker`。
 */
interface HostTarget {
    current: MarkdownViewHost | null;
}
const indirectHost = (target: HostTarget): MarkdownViewHost => ({
    base: () => target.current?.base() ?? null,
    get context(): MarkdownViewHost["context"] {
        return target.current?.context;
    },
    get assets(): MarkdownViewHost["assets"] {
        return target.current?.assets ?? null;
    },
    get chips(): MarkdownViewHost["chips"] {
        return target.current?.chips ?? nbookChips;
    },
    get imageMissing(): MarkdownViewHost["imageMissing"] {
        return target.current?.imageMissing;
    },
    get openLink(): MarkdownViewHost["openLink"] {
        return target.current?.openLink;
    },
    get images(): MarkdownViewHost["images"] {
        return target.current?.images;
    },
    get stickers(): MarkdownViewHost["stickers"] {
        return target.current?.stickers;
    },
    get previewSticker(): MarkdownViewHost["previewSticker"] {
        return target.current?.previewSticker;
    },
    get report(): MarkdownViewHost["report"] {
        return target.current?.report;
    },
});

/** 编辑器挂在这里：稿纸（`.markdown-control`）里排在属性面板之后。 */
const root = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
let editor: Editor | null = null;
/** 菜单层要的实例：响应式，随挂载与卸载变。这个文件里的逻辑直接用 `editor`。 */
const currentEditor = shallowRef<Editor | null>(null);
const menuLayer = useTemplateRef<InstanceType<typeof MarkdownMenus>>("menuLayer");
/** 这个实例建好时取定的语言（docs/specs/workspace/markdown-syntaxes.md 输出 7）：与 `editor` 同时设上、同时清空。 */
let language: MarkdownLanguage | null = null;
let hostTarget: HostTarget | null = null;
let bound: TextEditorBinding | null = null;
let detach: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let cursorTimer: ReturnType<typeof setTimeout> | null = null;
/** 程序换内容时不当成用户输入。 */
let loading = false;

const stateOf = (binding: TextEditorBinding): MarkdownViewState | null => binding.slot.state as MarkdownViewState | null;

/**
 * 编解码器按编辑器自己的 schema 建（每个编辑器实例一份 schema），缓存在 `codecFor` 里。schema 从编辑状态的文档上取：标签关闭时
 * 编辑器区先释放实例，Tiptap 销毁后 `editor.schema` 不再可用，而卸载前的结算还要写出这个视图的输入。
 */
const codec = (current: Editor): MarkdownCodec => {
    if (language === null) throw new Error("MarkdownControl：编辑器实例没有记下语言");
    return codecFor(current.state.doc.type.schema, language);
};

/** 写不出的那一块给人看的样子：第几块（顶层块，从 1 起）与开头几个字（组顶部的提示用）。 */
const EXCERPT_LENGTH = 16;
const blockAt = (doc: EditorState["doc"], from: number, to: number): {index: number; excerpt: string} => {
    let index = 0;
    doc.forEach((_node, offset, at) => {
        if (offset <= from) index = at;
    });
    const text = doc.textBetween(from, Math.min(to, doc.content.size), " ", " ").replace(/\s+/gu, " ").trim();
    return {index: index + 1, excerpt: text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text};
};

/** 程序做的、不算用户输入的改动（重载、写法回填）：不进撤销历史，不让自动链接插件给内容加链接。 */
const quietly = (current: Editor, change: (tr: Transaction) => void): void => {
    const tr = current.state.tr;
    change(tr);
    if (!tr.docChanged) return;
    loading = true;
    try {
        current.view.dispatch(tr.setMeta("addToHistory", false).setMeta("preventAutolink", true));
    } finally {
        loading = false;
    }
};

/** 标签的实例槽里存的编辑器实例。 */
interface KeptEditor {
    readonly editor: Editor;
    readonly language: MarkdownLanguage;
    /** 扩展里的宿主读它：每次挂载换成这次的 `viewHost`，卸载时清空。 */
    readonly target: HostTarget;
}

// `nb-markdown`：正文的样子与展示器共用（nb-markdown 的 `display/markdown.css`）。
const attributes = (): Record<string, string> => ({"aria-label": props.label, "class": "markdown-control__prose nb-markdown", "data-editor-prose": ""});

/**
 * 编辑器里的正文交给文档（docs/specs/workspace/markdown-dialect.md 输出 1–3）：没编辑的块写原文，编辑过的块重新写出并读回校验。
 * 写不出时这次输入不交，文档记下这个视图写不出（editor 输出 61）；被接受时把写出的写法回填进编辑器。
 */
const commitNow = (): void => {
    // 结算（保存、换文档、失焦之前）：属性面板里还没写回的输入也是这个视图的输入（输出 49），先写回成一次编辑，再按正文的规则交出。
    properties.value?.flush();
    commitBody();
};

/**
 * 只交出编辑器里已有的编辑，不碰属性面板手里的输入。停手的计时到点走这里：面板自己的写回也会起这个计时，到点时用户可能已经在面板的
 * 另一个输入里打字，那一半的字不能当成写回（面板按回车、失焦写回，输出 42）。
 */
const commitBody = (): void => {
    const buffered = timer !== null;
    if (timer !== null) {
        clearTimeout(timer);
        timer = null;
    }
    const binding = bound;
    // 只读时编辑区本来就不接受输入；只读之前敲下的输入仍要交出（例如订阅刚结束、要抢救）。
    const current = editor;
    if (binding === null || current === null) return;
    const view = stateOf(binding);
    if (view === null) return;
    // 没有待交的输入、又还没跟上别处的修订：重载要到下一轮才跑，这时编辑器与文档不同不是输入，交出去就是假冲突（同一文档的几个控件在
    // 同一次结算里先后被调，隐藏的控件也在其中）。
    if (!buffered && !view.held && view.confirmed !== binding.revision.value) return;
    const written = codec(current).write(current.state.doc, view.map);
    if (!written.ok) {
        view.held = true;
        binding.block({reason: written.reason, from: written.from, to: written.to, ...blockAt(current.state.doc, written.from, written.to), fallback: written.fallback()});
        return;
    }
    if (written.text === binding.text.value && !view.held) return;
    const result = binding.commit(view.confirmed, written.text);
    if (result.status === "accepted") {
        view.confirmed = result.revision;
        view.held = false;
        // 回填改了文档，ProseMirror 会随之清掉接着打字要用的格式（stored marks）；停手的交出常落在用户刚按下快捷键切换格式、
        // 还没打下一个字的时候，不带过去就丢了这次切换。回填只改属性、不动选区，原样带过去仍对得上光标。带过去的是回填前的
        // mark（还没记下写法），接着打的字是新内容，按缺省写法写出，下一次交出时再回填。
        const stored = current.state.storedMarks;
        quietly(current, (tr) => {
            written.accept(tr);
            if (stored !== null) tr.setStoredMarks(stored);
        });
        view.state = current.state;
    } else if (result.status === "conflict") {
        view.held = true;
    }
};

/** 按文档的正文新建编辑状态：新的撤销历史，原文对照取这次读入的。 */
const load = (binding: TextEditorBinding): MarkdownViewState | null => {
    if (editor === null) return null;
    const read = codec(editor).read(binding.text.value);
    editor.view.updateState(EditorState.create({doc: read.doc, plugins: editor.state.plugins}));
    setFrontmatterEol(editor, read.map.eol);
    // 标签记着上次的光标：放回去，正文变短时夹到末尾（输出 30）。
    const cursor = binding.cursor;
    if (cursor !== null && "offset" in cursor) {
        const doc = editor.state.doc;
        loading = true;
        try {
            editor.view.dispatch(editor.state.tr.setSelection(Selection.near(doc.resolve(Math.min(cursor.offset, doc.content.size)))));
        } finally {
            loading = false;
        }
    }
    const view: MarkdownViewState = {state: editor.state, map: read.map, confirmed: binding.revision.value, held: false, scroll: 0};
    binding.slot.state = view;
    return view;
};

/**
 * 正文被别处改了（另一组的输入、磁盘的新内容、裁决）：只把不同的那一段换掉，这次替换不进撤销历史（输出 12），本组已有
 * 的撤销步骤映射过这次替换后仍可用。原文对照换成按新正文读入的（`codec.reload`）。
 */
const reload = (binding: TextEditorBinding, view: MarkdownViewState): void => {
    const current = editor;
    if (current === null) return;
    let map = view.map;
    quietly(current, (tr) => {
        map = codec(current).reload(tr, binding.text.value);
    });
    view.map = map;
    setFrontmatterEol(current, map.eol);
    view.state = current.state;
    view.confirmed = binding.revision.value;
    view.held = false;
};

const enter = (binding: TextEditorBinding): void => {
    if (editor === null) return;
    bound = binding;
    let view = stateOf(binding);
    // 同一个编辑器实例（存在标签的实例槽里）的编辑状态才能直接换回；其余情况按正文新建。
    const fresh = view === null || view.state.schema !== editor.schema;
    if (fresh) {
        view = load(binding);
    } else if (view !== null) {
        editor.view.updateState(view.state);
        setFrontmatterEol(editor, view.map.eol);
        if (!view.held && !binding.blocked() && view.confirmed !== binding.revision.value) reload(binding, view);
        // 留着的编辑状态里，引用小块是按当时的地址算的：文件可能改过名。
        editor.view.dispatch(editor.state.tr.setMeta(REFRESH_REFERENCE_LINKS, true).setMeta("addToHistory", false));
    }
    editor.setEditable(!props.readonly);
    if (scroller.value !== null) scroller.value.scrollTop = view?.scroll ?? 0;
    // 按记下的光标新建的视图：滚到光标处。
    if (fresh && binding.cursor !== null) editor.commands.scrollIntoView();
    // 第二个参数：停手的计时还没到，或输入法在组字，或属性面板里有还没写回的输入，手里就有没交出的输入（自动保存的“停手后”据此顺延）。
    detach = binding.attach(commitNow, () => timer !== null || editor?.view.composing === true || properties.value?.pending === true);
    refreshOutline(true);
    // 换编辑状态走 `updateState`，不产生事务。
    editingVersion.value += 1;
};

/** 把光标记到当前绑定的标签上。 */
const rememberCursor = (): void => {
    if (cursorTimer !== null) {
        clearTimeout(cursorTimer);
        cursorTimer = null;
    }
    if (bound !== null && editor !== null) bound.remember({offset: editor.state.selection.head});
};

const leave = (binding: TextEditorBinding): void => {
    if (bound === binding) {
        commitNow();
        rememberCursor();
    }
    const view = stateOf(binding);
    if (view !== null && editor !== null && bound === binding) {
        // 注音卡片开着时画的选区高亮、批注卡片开着时标出的那条批注不随状态存下：卡片随换文档关上（`MarkdownMenus`），换回来时不该还亮着。
        // 控件卸载（拆分、移动标签）时批注层来不及清：编辑器卸载后它已经读不了 `editor.view`，所以在这里一并清。
        releaseSelection(editor);
        markShownComment(editor, null);
        view.state = editor.state;
        view.scroll = scroller.value?.scrollTop ?? 0;
    }
    detach?.();
    detach = null;
    if (bound === binding) bound = null;
    refreshOutline(true);
};

watch(() => props.binding, (next, previous) => {
    if (previous !== undefined && previous !== null) leave(previous);
    if (next !== null) enter(next);
}, {flush: "sync"});

// 正文被别处改了，或自己的未裁决输入被裁决了、写不出被“采用当前正文”解除了：按文档的正文更新。写不出期间不更新（输出 61）。
watch(() => [props.binding?.revision.value, props.binding?.unresolved(), props.binding?.blocked()] as const, () => {
    const binding = props.binding;
    if (binding === null || binding !== bound) return;
    const view = stateOf(binding);
    if (view === null) return;
    if (view.held && (binding.unresolved() || binding.blocked())) return;
    if (!view.held && view.confirmed === binding.revision.value) return;
    reload(binding, view);
});

// 变成只读（例如文件被外部删除）之前敲下、还在延迟里的输入照常由计时器交出：文档在已删除时仍接受输入回执。
watch(() => props.readonly, (readonly) => editor?.setEditable(!readonly));

// 换语言：引用小块的悬停提示重算一次。留在槽里的别的文档的编辑状态不用管，换回来时 `enter` 会重算。
watch(() => text.locale.value, () => {
    editor?.view.dispatch(editor.state.tr.setMeta(REFRESH_REFERENCE_LINKS, true).setMeta("addToHistory", false));
});

/**
 * 大纲（面包屑用，docs/specs/workbench/editor.md 输出 60）：跟着当前绑定。正文变了重算、`version` 加一；光标动了只换
 * `current`。标题的位置只在这里记，面包屑拿到的是 id，跳转时按 `binding` 与 `version` 核对，对不上不跳。
 */
const outline = shallowRef<EditorOutline | null>(null);
let outlineVersion = 0;
let headingPositions: ReadonlyMap<string, number> = new Map();
const currentHeading = (): string | null => {
    if (editor === null) return null;
    const at = editor.state.selection.from;
    let current: string | null = null;
    for (const [id, position] of headingPositions) if (position <= at) current = id;
    return current;
};
const refreshOutline = (contentChanged: boolean): void => {
    const binding = bound;
    if (binding === null || editor === null) {
        outline.value = null;
        headingPositions = new Map();
        return;
    }
    const previous = outline.value;
    if (!contentChanged && previous !== null && previous.binding === binding.token) {
        const current = currentHeading();
        if (current !== previous.current) outline.value = {...previous, current};
        return;
    }
    outlineVersion += 1;
    const items: Array<{id: string; level: number; text: string}> = [];
    const positions = new Map<string, number>();
    editor.state.doc.descendants((node, position) => {
        if (node.type.name !== "heading") return true;
        const id = `h${String(items.length)}`;
        items.push({id, level: Number(node.attrs.level), text: node.textContent});
        positions.set(id, position);
        return false;
    });
    headingPositions = positions;
    outline.value = {binding: binding.token, version: outlineVersion, items, current: currentHeading()};
};
const revealHeading = (binding: string, version: number, id: string): "ok" | "stale" => {
    const position = headingPositions.get(id);
    if (editor === null || outline.value?.binding !== binding || outline.value.version !== version || position === undefined) return "stale";
    editor.chain().focus().setTextSelection(position + 1).scrollIntoView().run();
    return "ok";
};

/**
 * 编辑动作（docs/specs/workbench/markdown-editing.md）：`active`、`enabled` 依赖版本号，选区或文档变化、换文档时加一，放进
 * computed 里读会跟着变；没人读就不算（`enabled` 要在事务副本上试跑命令）。
 */
const editingVersion = ref(0);
const editing: EditorEditing = {
    run: (action, args = {}) => {
        const implementation = markdownEditingActions[action];
        return editor !== null && !props.readonly && implementation !== undefined && implementation.enabled(editor, args) && implementation.run(editor, args);
    },
    active: (action) => {
        void editingVersion.value;
        return editor !== null && markdownEditingActions[action]?.active?.(editor) === true;
    },
    enabled: (action, args = {}) => {
        void editingVersion.value;
        return editor !== null && !props.readonly && markdownEditingActions[action]?.enabled(editor, args) === true;
    },
    hasSelection: computed(() => {
        void editingVersion.value;
        return editor !== null && !editor.state.selection.empty;
    }),
};

/**
 * 文档的 frontmatter 原文（在文档的属性上，随编辑、撤销与重载变）：有就在正文上方画属性面板。属性里不是完整的一段时（不该发生：
 * 面板与新建都只放完整的）不画面板，写回按编解码器的关卡写不出（editor 输出 61）。
 */
const frontmatter = computed(() => {
    void editingVersion.value;
    return editor === null ? null : frontmatterOf(editor.state.doc);
});

/**
 * 属性面板（docs/specs/workbench/markdown-editing.md 输出 39–51）：面板只认 frontmatter 的原文，交回的新原文在这里作为一次编辑提交
 * （进撤销历史，之后照正文的输入交出）。展开状态按文件地址记（`markdown.properties-open`）；面板按绑定换实例，空值选过的类型这类
 * 面板自己记的不串到别的文档。
 */
const properties = useTemplateRef<InstanceType<typeof MarkdownProperties>>("properties");
const propertiesOpen = usePropertiesOpen();
const propertiesShown = computed(() => {
    const address = props.binding?.address.value;
    return address !== undefined && propertiesOpen.isOpen(address);
});
const setPropertiesOpen = (open: boolean): void => {
    const address = props.binding?.address.value;
    if (address !== undefined) propertiesOpen.set(address, open);
};
const commitFrontmatter = (raw: string): void => {
    if (editor === null) return;
    editor.view.dispatch(editor.state.tr.setDocAttribute("frontmatter", raw));
};
/**
 * 面板交回焦点：回到正文刚才的选区（Tiptap 的 `focus()` 不带位置时不动选区）。刚打 `---` 新建、还没有属性就在新属性名上
 * 退格：撤回那次输入规则，正文里还原成 `---`（输出 48）；不是刚由输入规则新建的（例如用命令建的），`undoInputRule` 什么也不做。
 */
const leaveProperties = (reason?: "backspace"): void => {
    if (editor === null) return;
    if (reason === "backspace") editor.commands.undoInputRule();
    editor.commands.focus();
};
/** 新建了 frontmatter，或“添加属性”：展开并记下，面板挂上（或已在）之后把焦点放到新属性的名字上。 */
const requestNewProperty = (): void => {
    setPropertiesOpen(true);
    void nextTick(() => properties.value?.focusNewName());
};
/** 正文第一块的开头按上方向键：进面板的最后一个输入（输出 50）。在 ProseMirror 之后收到（冒泡）：它自己处理了的不管。 */
const onBodyKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowUp" || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const current = editor;
    if (current === null || properties.value === null || !current.state.selection.empty) return;
    if (current.state.selection.from !== Selection.atStart(current.state.doc).from) return;
    event.preventDefault();
    properties.value.focusLast();
};

/**
 * 批注页边（docs/specs/workbench/markdown-editing.md 输出 33）：开关开着、控件够宽才画。宽度量 `.markdown-control-root`（已是
 * `container-type: inline-size`，不含滚动条：页边的卡片把短文档撑出滚动条时宽度不会因此少一截而来回闪）；出现与消失用两个阈值
 * （迟滞），临界宽度附近不闪。阈值是稿纸的版心加页边加两侧最小留白：版心取 `--markdown-measure`，页边宽与空见 `MarkdownCommentMargin`。
 */
const MARGIN_SPACE = MARGIN_WIDTH + MARGIN_GAP;
const MARGIN_SIDE_MIN = 32;
const MARGIN_HIDE_SLACK = 32;
const shell = ref<HTMLElement | null>(null);

/**
 * 排版变了（桌面里 Ctrl+滚轮连改字号）正文高度跟着变，滚动位置是像素，不处理视野会漂到别处：改之前记下视野顶端那一块与它
 * 离滚动容器顶边的距离，样式生效后把滚动位置补回去。`pre` 的监听先于组件重画，此时 DOM 还是旧样式；没滚动过（在顶端）不处理。
 */
watch(() => paperOptions?.value, async () => {
    const box = scroller.value;
    const body = root.value?.querySelector(".markdown-control__prose");
    if (box === null || body === null || body === undefined || box.scrollTop === 0) return;
    const top = box.getBoundingClientRect().top;
    const anchor = [...body.children].find((block) => block.getBoundingClientRect().bottom > top + 1);
    if (anchor === undefined) return;
    const offset = anchor.getBoundingClientRect().top - top;
    await nextTick();
    if (!anchor.isConnected) return;
    box.scrollTop += anchor.getBoundingClientRect().top - box.getBoundingClientRect().top - offset;
}, {flush: "pre"});
const wide = ref(false);
let measure = 720;
let shellObserver: ResizeObserver | null = null;
function updateWide(width: number): void {
    const appear = measure + MARGIN_SPACE + MARGIN_SIDE_MIN;
    wide.value = wide.value ? width >= appear - MARGIN_HIDE_SLACK : width >= appear;
}
const marginDrawn = computed(() => menus !== null && props.visible && menus.commentMargin.value && wide.value);
watch(shell, (element) => {
    shellObserver?.disconnect();
    shellObserver = null;
    if (element === null || typeof ResizeObserver !== "function") return;
    const parsed = Number.parseFloat(getComputedStyle(element).getPropertyValue("--markdown-measure"));
    if (Number.isFinite(parsed)) measure = parsed;
    shellObserver = new ResizeObserver((entries) => updateWide(entries[0]?.contentRect.width ?? element.clientWidth));
    shellObserver.observe(element);
    updateWide(element.clientWidth);
}, {flush: "post"});
onBeforeUnmount(() => shellObserver?.disconnect());

const handle: EditorControlHandle = {
    editing,
    // 没有菜单层（Lab、组件测试不经插件挂控件）就没有页边，也不交出批注条数（编辑区标题的“批注 N”据此出现）。
    ...(menus === null ? {} : {comments: {count: computed(() => {
        void editingVersion.value;
        return editor === null ? 0 : listComments(editor.state.doc).length;
    })}}),
    outline,
    revealHeading,
    focus: () => editor?.commands.focus(),
    undo: () => editor?.commands.undo(),
    redo: () => editor?.commands.redo(),
    flushPendingChange: commitNow,
    rememberCursor,
    revealEnd: () => editor?.commands.focus("end"),
    revealRange: (from, to) => {
        if (editor === null) return;
        const doc = editor.state.doc;
        const clamp = (position: number): number => Math.max(0, Math.min(position, doc.content.size));
        // 位置是块的边界（写不出的那几块的起止）：选中其中的全部文字与行内节点。
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.between(doc.resolve(clamp(from)), doc.resolve(clamp(to)))).scrollIntoView());
        editor.view.focus();
    },
};

/**
 * 停手的结算：输入法还在组字时不交（交出被接受后的写法回填会重画这一块，打断组字），组字结束后的下一次停手再交。失焦、换文档
 * 与保存之前的结算照常立即进行。
 */
const commitWhenSettled = (): void => {
    if (editor?.view.composing === true) {
        timer = setTimeout(commitWhenSettled, COMMIT_DELAY_MS);
        return;
    }
    commitBody();
};

const onUpdate = ({transaction}: {transaction: {docChanged: boolean}}): void => {
    // 程序换的内容（按文档的正文重载）也改大纲。
    if (transaction.docChanged) refreshOutline(true);
    if (loading || !transaction.docChanged) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(commitWhenSettled, COMMIT_DELAY_MS);
};
const onSelection = (): void => {
    refreshOutline(false);
    if (loading) return;
    if (cursorTimer !== null) clearTimeout(cursorTimer);
    cursorTimer = setTimeout(rememberCursor, CURSOR_REMEMBER_MS);
};
const onTransaction = ({transaction}: {transaction: Transaction}): void => {
    if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet) editingVersion.value += 1;
    if (transaction.getMeta(FRONTMATTER_REQUEST) === true) requestNewProperty();
};
const onFocus = (): void => emit("focus", true);
const onBlur = (): void => {
    commitNow();
    rememberCursor();
    emit("focus", false);
    // 焦点进自己的菜单与输入框也走到这里，从事件上分不出来：一律算离开（Spec 输出 63 写明）。
    emit("leave");
};

onMounted(() => {
    if (root.value === null) return;
    // 标签的实例槽里已有编辑器（控件卸载过）：挂到新的位置接着用，撤销历史还在。实例的寿命归槽：`unmount` 之后
    // Tiptap 的 `isDestroyed` 也为真，不能用它判断实例还能不能用。
    const kept = props.host.state as KeptEditor | null;
    if (kept !== null) {
        editor = kept.editor;
        language = kept.language;
        hostTarget = kept.target;
        hostTarget.current = viewHost;
        editor.mount(root.value);
        editor.setOptions({editorProps: {attributes: attributes()}});
    } else {
        const current = languageFor(catalog);
        const target: HostTarget = {current: viewHost};
        const created = new Editor({
            element: root.value,
            extensions: createMarkdownEditorExtensions({language: current, placeholder: props.placeholder ?? "", host: indirectHost(target), commentMarkerLabel: menus === null ? null : menus.label("commentMarker")}),
            editable: !props.readonly,
            editorProps: {attributes: attributes()},
        });
        // 标记为原始对象：槽被包进响应式（测试工具把属性深度代理）时，编辑器实例不能被代理，否则它内部的原生对象（MutationObserver）方法调用失败。
        props.host.state = markRaw({editor: created, language: current, target} satisfies KeptEditor);
        props.host.dispose = () => created.destroy();
        editor = created;
        language = current;
        hostTarget = target;
    }
    // 事件处理器属于这一次挂载的组件，卸载时摘掉；实例本身留在槽里。
    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onSelection);
    editor.on("transaction", onTransaction);
    editor.on("focus", onFocus);
    editor.on("blur", onBlur);
    currentEditor.value = editor;
    if (props.binding !== null) enter(props.binding);
    editingVersion.value += 1;
    emit("ready", handle);
});

watch(() => props.label, () => editor?.setOptions({editorProps: {attributes: attributes()}}));

onBeforeUnmount(() => {
    if (props.binding !== null) leave(props.binding);
    if (editor !== null) {
        editor.off("update", onUpdate);
        editor.off("selectionUpdate", onSelection);
        editor.off("transaction", onTransaction);
        editor.off("focus", onFocus);
        editor.off("blur", onBlur);
        // 只从 DOM 上拿下：实例由标签的实例槽保留，标签关闭或换编辑器时编辑器区释放它。
        editor.unmount();
    }
    // Vue 先卸载旧控件、再挂新的，所以这里 `current` 正常还是我们的；防御一下：已经不是我们的（别的挂载先接手了）就不清。
    // 这只管宿主的指向：重叠挂载时上面的 `editor.unmount()` 仍会销毁新挂载刚建好的视图，所以先挂后卸的顺序本来就不受支持。
    if (hostTarget !== null && hostTarget.current === viewHost) hostTarget.current = null;
    hostTarget = null;
    editor = null;
    currentEditor.value = null;
    language = null;
    refreshOutline(true);
    emit("ready", null);
});
</script>

<template>
    <div ref="shell" class="markdown-control-root relative flex h-full w-full flex-col" :style="paperStyle" :data-comment-margin="marginDrawn ? '' : undefined">
        <Teleport :to="toolbarTarget" :disabled="toolbarTarget === null">
            <MarkdownToolbar v-if="menus !== null && menus.toolbarVisible.value && (toolbarTarget === null || props.visible)" :editing="editing" :menus="menus" :readonly="props.readonly" @prompt="(action) => menuLayer?.prompt(action)" @refocus="currentEditor?.commands.focus()" />
        </Teleport>
        <div class="markdown-control__margin markdown-control__margin--left" aria-hidden="true" data-markdown-margin="left"></div>
        <div class="markdown-control__margin markdown-control__margin--right" aria-hidden="true" data-markdown-margin="right"></div>
        <div ref="scroller" class="markdown-control__scroller relative min-h-0 w-full flex-1 overflow-auto" :style="marginDrawn ? {paddingInlineEnd: `${MARGIN_WIDTH + MARGIN_GAP}px`} : undefined" data-editor-control="markdown">
            <div class="markdown-control">
                <MarkdownProperties v-if="frontmatter !== null && isWholeFrontmatter(frontmatter)" :key="props.binding?.token" ref="properties" class="markdown-control__properties" :raw="frontmatter" :open="propertiesShown" :readonly="props.readonly" :describe="describeProperty" @commit="commitFrontmatter" @update:open="setPropertiesOpen" @leave="leaveProperties" />
                <div ref="root" @keydown="onBodyKeydown"></div>
            </div>
        </div>
        <MarkdownMenus v-if="menus !== null" ref="menuLayer" :editor="currentEditor" :scroller="scroller" :editing="editing" :menus="menus" :readonly="props.readonly" :binding="props.visible ? props.binding?.token ?? null : null" :margin-drawn="marginDrawn" :base="viewHost.base" :media="media" />
        <ImagePreviewDialog
            v-if="stickerPreview !== null"
            v-model:open="stickerPreviewOpen"
            :src="stickerPreview.url"
            :alt="stickerPreview.packTitle === undefined ? stickerPreview.name : text.t('sticker.previewTitle', {name: stickerPreview.name, pack: stickerPreview.packTitle})"
            :copy-text="stickerPreview.raw"
            :copy-label="text.t('sticker.copy')"
            :min-size="STICKER_PREVIEW_MIN_SIZE"
        />
    </div>
</template>

<style scoped>
/*
 * 纸面（docs/specs/workbench/editor.md 输出 32）：界面字体，版心、留白、字号、行距与段距是这个控件自己的变量，以后做成
 * 偏好（例如宋体与更宽的版心）时只换这几个值。版心含左右留白。
 */
.markdown-control-root {
    --markdown-measure: 720px;
    --markdown-padding-top: 64px;
    --markdown-padding-bottom: 120px;
    --markdown-padding-inline: 48px;
    --markdown-font-size: 17px;
    --markdown-line-height: 1.95;
    --markdown-block-gap: 1.1em;
}

/*
 * 正文两侧的场景图（docs/specs/theme/skins.md 输出 5）：和滚动容器同级，所以不随正文滚；工具栏传送到外面，所以从工具栏以下开始。
 * 一侧不足 120px 不画，靠容器查询：拆分后每组各自判断。变量名见 src/ui/theme/skin-vars.ts。
 */
.markdown-control-root {
    container-type: inline-size;
}

/*
 * 开关批注页边时稿纸平移：滚动容器的右内边距过渡，稿纸（宽度被版心上限卡住，居中）跟着挪，中途不会重新折行。页边的卡片在这段
 * 时间里每帧重排，跟着稿纸走（`MarkdownCommentMargin`）。
 */
.markdown-control__scroller {
    transition: padding-inline-end var(--motion-layout) var(--ease-layout);
}

.markdown-control__margin {
    display: none;
}

:global([data-nb-skin-scene] .markdown-control__margin) {
    position: absolute;
    top: 0;
    bottom: 0;
    display: block;
    width: calc((100% - var(--markdown-measure)) / 2);
    background-image: var(--skin-scene);
    background-repeat: no-repeat;
    pointer-events: none;
}

:global([data-nb-skin-scene] .markdown-control__margin--left) {
    left: 0;
    background-position: var(--skin-margin-left-position, 0 0);
    background-size: var(--skin-margin-left-size, 0 0);
    mask-image: linear-gradient(to right, #000 55%, transparent);
}

:global([data-nb-skin-scene] .markdown-control__margin--right) {
    right: 0;
    background-position: var(--skin-margin-right-position, 0 0);
    background-size: var(--skin-margin-right-size, 0 0);
    mask-image: linear-gradient(to left, #000 55%, transparent);
}

@container (max-width: 959px) {
    :global([data-nb-skin-scene] .markdown-control__margin) {
        display: none;
    }
}

/* 页边画出来时版心左移、右边是批注卡片：场景图会压在正文与卡片底下，不画（正文底下始终是干净的面，theme/skins.md 输出 5）。 */
:global([data-nb-skin-scene] .markdown-control-root[data-comment-margin] .markdown-control__margin) {
    display: none;
}

/* 页边画出来时批注末尾的小符号不画（docs/specs/workbench/markdown-editing.md 输出 38）：页边就是总览。 */
:global(.markdown-control-root[data-comment-margin] .nb-comment-marker) {
    display: none;
}

@media (prefers-contrast: more), (forced-colors: active) {
    :global([data-nb-skin-scene] .markdown-control__margin) {
        display: none;
    }
}

.markdown-control {
    box-sizing: border-box;
    max-width: var(--markdown-measure);
    margin-inline: auto;
    padding: var(--markdown-padding-top) var(--markdown-padding-inline) var(--markdown-padding-bottom);
}

/* 属性面板与正文第一块之间比段距宽一些：面板是关于这一章的资料，不是正文（第 2 轮评审稿）。 */
.markdown-control__properties {
    margin: 0 0 28px;
}

.markdown-control :deep(.markdown-control__prose) {
    font-family: var(--markdown-user-font, var(--font-prose, inherit));
    min-height: 60vh;
    outline: none;
    color: var(--text-main);
    font-size: var(--markdown-font-size);
    line-height: var(--markdown-line-height);
    letter-spacing: 0.01em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.markdown-control :deep(p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--text-muted);
    pointer-events: none;
}

/* 可写时点注音小字打开修改（`menus/MarkdownMenus.md`）。 */
.markdown-control :deep(.ProseMirror[contenteditable="true"] .nb-ruby-text) {
    cursor: pointer;
}
</style>
