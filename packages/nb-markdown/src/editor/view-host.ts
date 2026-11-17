/**
 * 编辑器里方言外观要的宿主信息：所在文件的地址（解析相对地址）、挂组件与取文字的上下文、图片地址服务与链接小块的分类。
 * 编辑器控件建实例时给出，地址按函数取：换文档不重建扩展。
 */

import type {AppContext} from "vue";

import type {ChipEnv} from "../chip/chip";
import type {MarkdownText} from "../locale";

/** 图片地址服务：宿主按所在文件解析地址，并告诉编辑器磁盘上的图片变了（重新取 URL）。 */
export interface MarkdownViewAssets {
    /** `base` 是图片所在文件的地址；返回可显示的 URL 与它对应的资源地址（外部图片为 null），不显示为 null。 */
    resolve(base: string | null, src: string): {readonly url: string; readonly address: string | null} | null;
    /** 资源地址的文件在磁盘上变了时调用；返回取消订阅。 */
    onChange(address: string, listener: () => void): () => void;
}

/**
 * 一张图传完的结果：`address` 是存进作品里的资源地址（`project://插图/a.png`），`alt` 是说明。失败带宿主的码与说明；`stored`
 * 为真说明图可能已经在作品里（结果未知、取消、断开），由宿主按它自己的码表判，插件只转交。
 */
export type ImageUploadResult =
    | {readonly ok: true; readonly address: string; readonly alt: string}
    | {readonly ok: false; readonly code: string; readonly detail: string; readonly stored?: boolean};

/** 粘贴时一张图没有传成、或传成了没有插入。`stored`：图可能已经在作品里（结果未知、取消、传完了没有插入）。 */
export interface ImageFailure {
    readonly file: string;
    readonly code: string;
    readonly detail: string;
    readonly stored: boolean;
}

/**
 * 粘贴图片要的宿主能力（docs/specs/workbench/markdown-editing.md 输出 55）：把一张图存进作品，失败时告诉用户。没有它（提示词编辑器、
 * Lab 的场景）的编辑器不接手图片的粘贴，照原来的粘贴。
 */
export interface MarkdownViewImages {
    /** 存一张图：宿主按设置算目录与名字、按浏览器给的类型预检（不是允许的格式不上传）、调文件服务；`signal` 取消时尽快放弃。 */
    upload(file: File, signal: AbortSignal): Promise<ImageUploadResult>;
    /** 一张图的失败（含传完了却没能插入的）：宿主给用户一条通知。 */
    failed(failure: ImageFailure): void;
}

export interface MarkdownViewHost {
    base(): string | null;
    /**
     * 建编辑器的组件在 `setup` 里用 `markdownViewContext()`（`@notnotype/nb-markdown/host`）取得：节点视图里的图片挂在它上面，
     * 链接小块的悬停提示在算装饰时从它带着的翻译端口取文字。没有时用缺省端口（中文）。
     */
    readonly context?: AppContext | null | undefined;
    /** 没有图片地址服务时（例如 Lab 的场景）图片一律不显示，只有说明。 */
    readonly assets: MarkdownViewAssets | null;
    /** 链接小块的目标分类与文件图标（与展示器、PromptEditor 同一份）。 */
    readonly chips: ChipEnv;
    /** 图片不显示时的说明。 */
    readonly imageMissing?: MarkdownText | undefined;
    /** 按住 Ctrl（⌘）点链接时调用，`href` 是链接的地址：宿主按分类打开（输出 53）。没有时 Ctrl 点链接不做什么。事件发生时才读，换挂载不重建扩展。 */
    readonly openLink?: ((href: string) => void) | undefined;
    /** 粘贴图片的能力；事件发生时才读。 */
    readonly images?: MarkdownViewImages | undefined;
}
