/**
 * 展示器的渲染（docs/specs/ui/markdown-display.md 输出 1、2、3、6、8）：编解码器读入原文，按 schema 的 `renderHTML` 逐个顶层块
 * 生成页面元素，需要专门样子的节点用 `static-views.ts`；不建编辑器。
 *
 * 流式更新时每次全文重新读入，再按块比较：头尾相同的块保留原来的元素与交互状态（折叠、已渲染的 HTML），只替换中间变了的块。
 * 比较不看每次读入都重新生成的内存身份（批注的 `key`，语言的 `identityAttrs`），否则前面有一条批注，后面每次追加都会把它判成
 * 变了。
 */

import {getSchema} from "@tiptap/core";
import type {Node as PMNode, Schema} from "@tiptap/pm/model";
import {DOMSerializer} from "@tiptap/pm/model";

import {chipView, renderChipIcon} from "../chip/chip";
import {codecFor} from "../language/codec/codec";
import type {MarkdownLanguage} from "../language/language";
import {isLargeStickerBlock, LARGE_STICKER_CLASS, STICKER_NODE, stickerGapClasses} from "../language/syntax/sticker";
import {showsAsChip} from "../targets";
import {STATIC_VIEWS} from "./static-views";
import type {StaticView, StaticViewHost} from "./static-views";

interface Block {
    readonly key: string;
    readonly dom: globalThis.Node;
    readonly views: ReadonlyArray<StaticView>;
}

/** 每份语言一份 schema：同一份语言的消息共用，编解码器按 schema 缓存，所以读入也共用。 */
const schemas = new WeakMap<MarkdownLanguage, Schema>();

export function schemaFor(language: MarkdownLanguage): Schema {
    let schema = schemas.get(language);
    if (schema === undefined) {
        schema = getSchema([...language.extensions]);
        schemas.set(language, schema);
    }
    return schema;
}

/** 文本块的元素名：图标不越过它往外放，流式光标放在最后一个里面。 */
const TEXTBLOCK = /^(?:P|H[1-6]|LI|TD|TH|PRE)$/u;

/** 比较用的形状：节点的 JSON 去掉只在内存里用的身份属性。 */
function keyOf(node: PMNode, identity: ReadonlyMap<string, string>, cache: WeakMap<PMNode, string>): string {
    const cached = cache.get(node);
    if (cached !== undefined) return cached;
    const strip = (json: Record<string, unknown>): Record<string, unknown> => {
        const marks = (json.marks as Array<{type: string; attrs?: Record<string, unknown>}> | undefined)?.map((mark) => {
            const attr = identity.get(mark.type);
            if (attr === undefined || mark.attrs === undefined) return mark;
            const {[attr]: _identity, ...rest} = mark.attrs;
            return {...mark, attrs: rest};
        });
        const content = (json.content as Array<Record<string, unknown>> | undefined)?.map(strip);
        return {...json, ...(marks === undefined ? {} : {marks}), ...(content === undefined ? {} : {content})};
    };
    const key = JSON.stringify(strip(node.toJSON() as Record<string, unknown>));
    cache.set(node, key);
    return key;
}

/**
 * 正文里外部链接以外的链接画成引用小块（与编辑器的 `../editor/reference-links.ts` 同一份外观）：同一个地址的几段相邻的链接元素
 * （批注只盖住一部分时会拆开）算一个，首段前面放图标，末段带收口的类名。
 */
function decorateLinks(root: HTMLElement, host: StaticViewHost): void {
    const document = host.document;
    const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const groups: HTMLAnchorElement[][] = [];
    /** 上一段文字所在的链接元素；文字不在链接里时为 null（相邻才算同一个）。 */
    let previous: HTMLAnchorElement | null = null;
    for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
        const anchor = (text.parentElement?.closest("a[href]") ?? null) as HTMLAnchorElement | null;
        const inside = anchor !== null && root.contains(anchor);
        if (!inside) {
            previous = null;
            continue;
        }
        if (previous === anchor) continue;
        const group = groups.at(-1);
        if (previous !== null && group !== undefined && previous.getAttribute("href") === anchor.getAttribute("href")) group.push(anchor);
        else groups.push([anchor]);
        previous = anchor;
    }
    for (const group of groups) {
        const first = group[0] as HTMLAnchorElement;
        const href = first.getAttribute("href") ?? "";
        const target = host.chips.targets.classify(href, null);
        if (!showsAsChip(target)) continue;
        const chip = chipView({kind: "reference", label: group.map((anchor) => anchor.textContent ?? "").join(""), target: href, base: null, number: null, state: "ready", error: "", translate: (text) => host.text.port.t(text)}, host.chips);
        // 与编辑器的装饰同一个结构：小块的样子画在链接里面的一层 span 上，链接本身的样式按 `:has(.nb-chip-link)` 去掉。
        const spans = group.map((anchor) => {
            const span = document.createElement("span");
            span.className = "nb-chip-link";
            span.dataset.referenceLink = target.variant ?? target.kind;
            span.title = chip.title;
            span.append(...anchor.childNodes);
            anchor.append(span);
            return span;
        });
        (spans.at(-1) as HTMLSpanElement).classList.add("nb-chip-link--end");
        const icon = document.createElement("span");
        icon.className = "nb-chip-link__icon";
        icon.append(renderChipIcon(document, chip.icon));
        // 编辑器的图标是不带标记的 widget，画在链接开头所有外层标记之外；这里沿着“是第一个子节点”的外层往上找到同一个位置。
        let before: globalThis.Node = first;
        while (before.parentNode !== null && before.parentNode !== root && before.parentNode.firstChild === before && !TEXTBLOCK.test(before.parentNode.nodeName)) before = before.parentNode;
        before.parentNode?.insertBefore(icon, before);
    }
}

function hasSticker(block: PMNode): boolean {
    let found = false;
    block.forEach((child) => (found ||= child.type.name === STICKER_NODE));
    return found;
}

/** 文本块的元素里的表情元素按出现顺序就是节点里的表情（文本块里没有别的文本块）。 */
function decorateStickers(block: PMNode, dom: HTMLElement): void {
    if (isLargeStickerBlock(block)) dom.classList.add(LARGE_STICKER_CLASS);
    const gaps = stickerGapClasses(block);
    dom.querySelectorAll<HTMLElement>(".nb-sticker").forEach((element, index) => {
        for (const name of (gaps[index] ?? "").split(" ")) if (name !== "") element.classList.add(name);
    });
}

export class DisplayRenderer {
    readonly #root: HTMLElement;
    readonly #language: MarkdownLanguage;
    readonly #schema: Schema;
    readonly #host: StaticViewHost;
    readonly #serializer: DOMSerializer;
    readonly #keys = new WeakMap<PMNode, string>();
    #blocks: Block[] = [];
    /** 正在生成的块里建出的静态视图：替换或卸载这一块时逐个释放。 */
    #collecting: StaticView[] = [];
    /** 正在生成的块里有表情的文本块与它的元素。 */
    #stickerBlocks: Array<{readonly node: PMNode; readonly dom: HTMLElement}> = [];

    constructor(root: HTMLElement, language: MarkdownLanguage, schema: Schema, host: StaticViewHost) {
        this.#root = root;
        this.#language = language;
        this.#schema = schema;
        this.#host = host;
        const base = DOMSerializer.fromSchema(schema);
        const nodes = {...base.nodes};
        for (const [name, factory] of Object.entries(STATIC_VIEWS)) {
            if (schema.nodes[name] === undefined) continue;
            nodes[name] = (node: PMNode) => {
                const view = factory(node, this.#host);
                this.#collecting.push(view);
                return view.contentDOM === undefined ? view.dom : {dom: view.dom, contentDOM: view.contentDOM};
            };
        }
        // 有表情的文本块记下来，整块生成完再给表情加大小与间隙的类名（stickers.md 输出 11），判断与编辑器的装饰是同一组函数。
        // 生成文本块元素时它的内容还没填进去，所以不能在这里直接加。
        for (const [name, type] of Object.entries(schema.nodes)) {
            const original = nodes[name];
            if (!type.isTextblock || original === undefined) continue;
            nodes[name] = (node: PMNode) => {
                if (!hasSticker(node)) return original(node);
                const rendered = DOMSerializer.renderSpec(this.#host.document, original(node));
                this.#stickerBlocks.push({node, dom: rendered.dom as HTMLElement});
                return rendered.contentDOM === undefined ? rendered.dom : {dom: rendered.dom, contentDOM: rendered.contentDOM};
            };
        }
        this.#serializer = new DOMSerializer(nodes, base.marks);
    }

    /** 按新的原文更新：头尾相同的块不动，中间的替换。 */
    update(text: string): void {
        const doc = codecFor(this.#schema, this.#language).read(text).doc;
        const next: PMNode[] = [];
        doc.forEach((child) => next.push(child));
        const keys = next.map((node) => keyOf(node, this.#language.identityAttrs, this.#keys));
        const old = this.#blocks;
        let head = 0;
        while (head < old.length && head < keys.length && old[head]?.key === keys[head]) head += 1;
        let tail = 0;
        while (tail < old.length - head && tail < keys.length - head && old[old.length - 1 - tail]?.key === keys[keys.length - 1 - tail]) tail += 1;
        // 先生成新块，再换下旧块：生成到一半抛错时页面与 `#blocks` 仍对得上，下一次更新照常比较。
        const added = next.slice(head, next.length - tail).map((node, index): Block => ({key: keys[head + index] as string, ...this.#render(node)}));
        const removed = old.slice(head, old.length - tail);
        const anchor = old[old.length - tail]?.dom ?? null;
        for (const block of removed) {
            for (const view of block.views) view.destroy?.();
            this.#root.removeChild(block.dom);
        }
        for (const block of added) this.#root.insertBefore(block.dom, anchor);
        this.#blocks = [...old.slice(0, head), ...added, ...old.slice(old.length - tail)];
    }

    /** 生成一块。画不出来（外来方言的 `renderHTML` 抛错之类）时按它的文字显示，只影响这一块（输出 1）。 */
    #render(node: PMNode): Omit<Block, "key"> {
        this.#collecting = [];
        this.#stickerBlocks = [];
        try {
            const dom = this.#serializer.serializeNode(node, {document: this.#host.document});
            if (dom.nodeType === 1) decorateLinks(dom as HTMLElement, this.#host);
            for (const block of this.#stickerBlocks) decorateStickers(block.node, block.dom);
            return {dom, views: this.#collecting};
        } catch (error) {
            for (const view of this.#collecting) view.destroy?.();
            this.#host.report(`展示器画不出一块 ${node.type.name}，按文字显示`, error);
            const pre = this.#host.document.createElement("pre");
            pre.className = "nb-markdown-display__plain";
            pre.textContent = node.textContent;
            return {dom: pre, views: []};
        } finally {
            this.#collecting = [];
            this.#stickerBlocks = [];
        }
    }

    /** 最后一块里最后一个文本块的元素（放流式光标）。 */
    lastTextblock(): HTMLElement | null {
        const last = this.#blocks.at(-1)?.dom;
        if (last === undefined || last.nodeType !== 1) return null;
        const element = last as HTMLElement;
        return [...element.querySelectorAll<HTMLElement>("*")].filter((child) => TEXTBLOCK.test(child.nodeName)).at(-1) ?? element;
    }

    destroy(): void {
        for (const block of this.#blocks) for (const view of block.views) view.destroy?.();
        this.#blocks = [];
        this.#root.replaceChildren();
    }
}
