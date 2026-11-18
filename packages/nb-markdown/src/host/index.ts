/**
 * `@notnotype/nb-markdown/host`：组件从宿主拿的东西（docs/specs/ui/markdown-display.md、ui/prompt-editor.md 的“宿主接口”）。
 * 宿主在组件的祖先上 `provideMarkdownHost`；没有提供时 `useMarkdownHost()` 给缺省宿主，组件单独挂也能用。界面文字不在宿主里，
 * 读 nb-ui 的翻译端口（`./text.ts`）。
 *
 * 本模块不引语言与编辑内核（只有类型），按需加载的小组件（InlineChip）带上它不变重。它带 DOM 类型，neuro-book 的插件入口
 * 不能静态引它（后端类型检查），见它的 `plugins/markdown/web/components/MarkdownHosted.vue`。
 */

import {inject, provide} from "vue";
import type {InjectionKey} from "vue";

import {defaultChipEnv} from "../chip/chip";
import type {ChipEnv} from "../chip/chip";
import type {MarkdownLanguage} from "../language/language";
import type {MarkdownText} from "../locale";
import type {StickerResolver} from "../stickers";

export interface MarkdownHost {
    /**
     * 组件挂上时取一次，之后不换（视图建立时取定语言，docs/specs/workspace/markdown-syntaxes.md 输出 7）。没有时用内置方言加
     * 核心语法（`defaultMarkdownLanguage()`）：缺省值由用语言的组件自己取，这样本模块不带着语言。
     */
    language?(): MarkdownLanguage;
    /** 小块的目标分类与文件图标。 */
    readonly chips: ChipEnv;
    /** 记一条诊断：某一块画不出来、组不成语言等（组件照常按文字显示）。 */
    report(event: string, message: string, error: unknown): void;
    /**
     * 图片不显示时的说明，参数 `name` 是说明文字或地址；没有时用 `MarkdownImage` 的缺省“{name}（不显示）”。目录里的键
     * （`TextRef`）由组件补上 `name` 经翻译端口翻译；字符串与语言映射照旧写单花括号 `{name}`。
     */
    readonly imageMissing?: MarkdownText;
    /** 表情目录（docs/specs/agent/stickers.md 输出 10）：按写法查表情；没有时表情写法显示原文。 */
    readonly stickers?: StickerResolver;
    /**
     * 同步地认一条表情写法（输出 44）：提示词编辑器与已发送的文字里，认得出的写法才成为表情，认不出的就是文字。目录还没取到时交回
     * undefined；背后是响应式状态，在 computed 与渲染里读会跟着变。没有时提示词里的表情写法都是文字。
     */
    readonly stickerKnown?: (raw: string) => boolean | undefined;
}

export const markdownHostKey: InjectionKey<MarkdownHost> = Symbol("nb-markdown/host");

/** 缺省宿主：内置方言加核心语法、只认外部链接的目标分类、诊断丢掉。 */
export const defaultMarkdownHost: MarkdownHost = {
    chips: defaultChipEnv,
    report: () => undefined,
};

/** 在当前组件的 setup 里调用，给子树里的 nb-markdown 组件。没给的项用缺省值；嵌套提供时里层不继承外层的宿主。 */
export function provideMarkdownHost(host: Partial<MarkdownHost>): MarkdownHost {
    const full: MarkdownHost = {...defaultMarkdownHost, ...host};
    provide(markdownHostKey, full);
    return full;
}

/** 在组件的 setup 里调用。 */
export const useMarkdownHost = (): MarkdownHost => inject(markdownHostKey, defaultMarkdownHost);

export {markdownTextIn, markdownViewContext, provideMarkdownText, useMarkdownText} from "./text";
export type {MarkdownTextApi} from "./text";
