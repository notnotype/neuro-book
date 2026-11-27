/**
 * 复原工作台上第二幕要用的编辑器动作（w00056 t06 第 13 轮）：斜杠菜单、注音与链接卡片、属性面板、粘贴图片、换编辑器打开，
 * 以及演示要瞄、要照亮的地方（正在写的那一段、菜单与卡片、提示块、注音、属性面板、链接、图、作品树的一行、源码编辑器里的一段字）。
 * 都走产品自己的入口：按键与打字是浏览器的合成事件、
 * 点按由演示指针发（`demo-pointer.ts`），编辑器、菜单与卡片照常收到；快进与少动效时用同一个编辑动作直接改（`editNow`）。
 *
 * 合成的指针按下不会让输入框拿到焦点（浏览器只对真的按下做默认动作），所以属性面板的输入框由这里聚焦（`focusProperty`）。
 */
import {CODE_EDITOR, MARKDOWN_EDITOR} from "nbook/plugins/editor/shared/contracts";
import type {EditingActionId} from "nbook/plugins/editor/shared/contracts";
import type {EditorArea} from "nbook/plugins/editor/web/area";

export interface DeskEditingSources {
    /** 工作台的根（演示只认它里面的东西；菜单与卡片传送在 body 下，另外找）。 */
    readonly host: () => HTMLElement | null;
    readonly area: EditorArea;
}

/** 浮层：斜杠菜单、注音与链接卡片、批注卡片，都传送在 body 下。 */
const PROMPT = "[data-markdown-text-prompt]";
const FIELDS = `[data-markdown-comment-card], ${PROMPT}, [data-markdown-properties]`;
/** 正文里算作“一段”的块：照亮正在写的那一段时取最近的一个。 */
const BLOCKS = "p, h1, h2, h3, h4, li, blockquote, pre";

const rectOf = (element: Element | null | undefined): DOMRectReadOnly | null => {
    const rect = element?.getBoundingClientRect() ?? null;
    return rect === null || rect.width < 2 || rect.height < 2 ? null : rect;
};

export function createDeskEditing({host, area}: DeskEditingSources) {
    /** 正文那一块（Markdown 控件的可编辑区）。 */
    const editorRoot = (): HTMLElement | null => host()?.querySelector<HTMLElement>(".ProseMirror[contenteditable='true']") ?? null;
    const propertiesRoot = (): HTMLElement | null => host()?.querySelector<HTMLElement>("[data-markdown-properties]") ?? null;

    /**
     * 往焦点处按一个键（合成的 keydown 与 keyup）：回车、Esc、Ctrl+K、Ctrl+B。编辑器的快捷键、斜杠菜单（它在滚动容器上捕获按键）、
     * 注音与链接卡片、属性面板的回车都认合成的按键。焦点不在这台工作台或它的浮层里时不按，返回 false。
     */
    function press(key: string, modifiers: {readonly ctrl?: boolean} = {}): boolean {
        const target = document.activeElement;
        if (!(target instanceof HTMLElement)) return false;
        if (host()?.contains(target) !== true && target.closest(FIELDS) === null) return false;
        const init: KeyboardEventInit = {key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ctrlKey: modifiers.ctrl === true, bubbles: true, cancelable: true, composed: true};
        target.dispatchEvent(new KeyboardEvent("keydown", init));
        target.dispatchEvent(new KeyboardEvent("keyup", init));
        return true;
    }

    /** 斜杠菜单此刻选中的那一项的名字；菜单没开（或筛不出项、没显示）时为 null。 */
    function slashActive(): string | null {
        return document.querySelector<HTMLElement>('[data-suggestion-menu] [role="option"][aria-selected="true"]')?.textContent?.trim() ?? null;
    }

    /** 注音或链接卡片开着、焦点在它的输入框里。 */
    function promptOpen(): boolean {
        return document.activeElement?.closest(PROMPT) != null;
    }

    // ── 演示要照亮、标记的地方（视口坐标；不在、没画出来时为 null） ──

    /** 光标所在的那一段（刚另起的空段也算）：照亮“正在写的这一段”。 */
    function caretBlock(): DOMRectReadOnly | null {
        const editor = editorRoot();
        const node = document.getSelection()?.anchorNode ?? null;
        if (editor === null || node === null || !editor.contains(node)) return null;
        const block = (node instanceof Element ? node : node.parentElement)?.closest(BLOCKS) ?? null;
        return block !== null && editor.contains(block) ? rectOf(block) : null;
    }

    /** 含这句话的那一段（这句话被注音、链接拆开以后也找得到：按段里的整段字找）。 */
    function blockRect(text: string): DOMRectReadOnly | null {
        const block = [...(editorRoot()?.querySelectorAll<HTMLElement>(BLOCKS) ?? [])].find((element) => element.textContent?.includes(text) === true && element.querySelector(BLOCKS) === null);
        return rectOf(block);
    }

    const slashMenuRect = (): DOMRectReadOnly | null => rectOf(document.querySelector("[data-suggestion-menu]"));
    const selectionMenuRect = (): DOMRectReadOnly | null => rectOf(document.querySelector("[data-markdown-selection-menu]"));
    /** 注音或链接卡片。 */
    const promptRect = (): DOMRectReadOnly | null => rectOf(document.querySelector(PROMPT));
    /** 正文里最后一个提示块。 */
    const calloutRect = (): DOMRectReadOnly | null => rectOf([...(editorRoot()?.querySelectorAll(".nb-callout") ?? [])].at(-1));
    /** 注着 `base` 的那个注音（连上面的读音一起）。 */
    const rubyRect = (base: string): DOMRectReadOnly | null => rectOf([...(editorRoot()?.querySelectorAll<HTMLElement>("ruby") ?? [])].find((ruby) => ruby.firstElementChild?.textContent?.trim() === base));
    /** 属性面板：展开时是整张卡片，收起时是那一行摘要。 */
    const propertiesRect = (): DOMRectReadOnly | null => rectOf(propertiesRoot());
    /** 贴图上传的那一会儿，正文里“正在上传 1 张图片”的那一块。 */
    const uploadingRect = (): DOMRectReadOnly | null => rectOf(editorRoot()?.querySelector("[data-image-uploading]"));

    /** 属性面板顶上那一行（点它展开、收起）；面板不在时为 null。 */
    function propertiesToggle(): DOMRectReadOnly | null {
        return rectOf(propertiesRoot()?.querySelector(".markdown-properties__toggle"));
    }

    function propertiesOpen(): boolean {
        return propertiesRoot()?.querySelector(".markdown-properties__toggle")?.getAttribute("aria-expanded") === "true";
    }

    /** 收起时的摘要（“视角 艾莉丝 · 状态 初稿 · …”）。 */
    function propertiesSummary(): DOMRectReadOnly | null {
        return rectOf(propertiesRoot()?.querySelector("[data-property-summary]"));
    }

    const propertyInput = (name: string): HTMLInputElement | null =>
        propertiesRoot()?.querySelector<HTMLInputElement>(`[data-property-name="${CSS.escape(name)}"] .markdown-properties__value input`) ?? null;

    /** 展开或收起属性面板（快进时不经指针，直接点那个按钮）。 */
    function setPropertiesOpen(open: boolean): void {
        if (propertiesOpen() !== open) propertiesRoot()?.querySelector<HTMLButtonElement>(".markdown-properties__toggle")?.click();
    }

    /** 把属性面板滚进视口（正文前几拍滚到了末尾）；面板不在时返回 false。 */
    function revealProperties(): boolean {
        const root = propertiesRoot();
        root?.scrollIntoView({block: "nearest", behavior: "smooth"});
        return root !== null;
    }

    /** 某个属性的值那一格（演示的指针点它）。 */
    function propertyField(name: string): DOMRectReadOnly | null {
        return rectOf(propertyInput(name)?.closest(".markdown-properties__value"));
    }

    /** 让这个属性的输入框拿到焦点（文字的全选，接着打字就换掉）；没有这个属性、面板收着时返回 false。 */
    function focusProperty(name: string): boolean {
        const input = propertyInput(name);
        if (input === null) return false;
        input.focus({preventScroll: true});
        if (input.type === "text") input.select();
        return document.activeElement === input;
    }

    /** 正文里这几个字带没带注音。 */
    function rubied(base: string): boolean {
        return [...(editorRoot()?.querySelectorAll<HTMLElement>("ruby") ?? [])].some((ruby) => ruby.firstElementChild?.textContent?.trim() === base);
    }

    /** 正文里文字正好是 `text` 的链接。 */
    function linkRect(text: string): DOMRectReadOnly | null {
        const link = [...(editorRoot()?.querySelectorAll<HTMLAnchorElement>("a") ?? [])].find((element) => element.textContent?.trim() === text);
        return rectOf(link);
    }

    /**
     * 把一张图当作粘贴发给正文（光标处）：浏览器的粘贴事件带着这张图，编辑器的粘贴插件照常上传、插入。光标要先放好，
     * 而且要等编辑器读过选区（`selectionchange` 是异步的，调用方先等一会儿）。焦点不在正文里时不粘，返回 false。
     */
    function pasteImage(image: Blob, name = "image.png"): boolean {
        const editor = editorRoot();
        if (editor === null || document.activeElement !== editor) return false;
        const data = new DataTransfer();
        data.items.add(new File([image], name, {type: image.type}));
        editor.dispatchEvent(new ClipboardEvent("paste", {clipboardData: data, bubbles: true, cancelable: true}));
        return true;
    }

    const shownImages = (): HTMLImageElement[] => [...(editorRoot()?.querySelectorAll<HTMLImageElement>("img") ?? [])].filter((image) => image.complete && image.naturalWidth > 0);

    /** 正文里最后一张已经显示出来的图。 */
    function imageRect(): DOMRectReadOnly | null {
        return rectOf(shownImages().at(-1));
    }

    /** 把最后那张图整张滚进正文的视口（贴进来时光标在图的前面，编辑器只滚到光标）；没有图时返回 false。 */
    function revealImage(): boolean {
        const image = shownImages().at(-1);
        image?.scrollIntoView({block: "nearest", behavior: "smooth"});
        return image !== undefined;
    }

    /** 作品树里名字是 `name` 的那一行。 */
    function explorerRow(name: string): DOMRectReadOnly | null {
        // 作品树是平铺的一列行（子项不嵌在父项里），一行的字就是它自己的名字。
        const row = [...(host()?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find((item) => item.textContent?.trim() === name);
        return rectOf(row);
    }

    /** 标签条上名字是 `name` 的那一个标签。 */
    function tabRect(name: string): DOMRectReadOnly | null {
        const tab = [...(host()?.querySelectorAll<HTMLElement>("[data-editor-tab]") ?? [])].find((item) => item.textContent?.trim().startsWith(name) === true);
        return rectOf(tab);
    }

    /** 打开作品里的一份（快进时代替 Ctrl 点链接）。 */
    function openPath(path: string): boolean {
        return area.open(`project://${path}`, {mode: "permanent"}).ok;
    }

    /** 用源码编辑器（Monaco）或 Markdown 编辑器重新打开活动的那一份（产品的“用……重新打开”）。 */
    function reopen(editor: "source" | "markdown"): boolean {
        return area.reopenWith(editor === "source" ? CODE_EDITOR : MARKDOWN_EDITOR).ok;
    }

    /** 源码编辑器挂上、画出来了没有（它是异步加载的）。 */
    function sourceReady(): boolean {
        return host()?.querySelector(".monaco-editor .view-lines .view-line") != null;
    }

    /**
     * 源码编辑器里含 `text` 的那几行的矩形（视口坐标）：描金用。Monaco 一行一个 `.view-line`，字在里面的几个 span 里，
     * 按整行的字找（空格画成了不换行空格，比之前换回来）；只量看得见的行（Monaco 只画视口里的行），行的先后不按 DOM 的顺序
     * （Monaco 复用行元素，按 `top` 摆），调用方要先后时按矩形排。
     */
    function sourceRects(text: string): DOMRect[] {
        const lines = [...(host()?.querySelectorAll<HTMLElement>(".monaco-editor .view-lines .view-line") ?? [])];
        return lines.filter((line) => line.textContent?.replace(/\u00a0/gu, " ").includes(text) === true).map((line) => {
            const spans = [...line.querySelectorAll<HTMLElement>("span span")];
            const first = spans[0]?.getBoundingClientRect();
            const last = spans.at(-1)?.getBoundingClientRect();
            const box = line.getBoundingClientRect();
            return first === undefined || last === undefined ? box : new DOMRect(first.left, box.top, last.right - first.left, box.height);
        });
    }

    /** 不演、直接执行一个编辑动作（快进与少动效时）：作用在活动的那一份的选区上；做不了时返回 false。 */
    function editNow(action: EditingActionId, params?: Readonly<Record<string, unknown>>): boolean {
        return area.activeHandle.value?.editing?.run(action, params) ?? false;
    }

    return {
        press, slashActive, promptOpen,
        caretBlock, blockRect, slashMenuRect, selectionMenuRect, promptRect, calloutRect, rubyRect, propertiesRect, uploadingRect,
        propertiesToggle, propertiesOpen, propertiesSummary, setPropertiesOpen, revealProperties, propertyField, focusProperty,
        rubied, linkRect, pasteImage, imageRect, revealImage, explorerRow, tabRect, openPath, reopen, sourceReady, sourceRects, editNow,
    };
}
