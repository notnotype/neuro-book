/**
 * nbook 交给 nb-markdown 组件的宿主（docs/specs/ui/markdown-display.md、ui/prompt-editor.md 的宿主接口）：作品文件的目标分类、
 * 按文件名取的文件图标、诊断出口与“不在作品里”的图片说明。语言另由用语言的组件包装给（`components/MarkdownHosted.vue`、
 * `MarkdownControl.vue`），本模块不引语言，按需加载的小块不因它变重。
 *
 * 只由浏览器一侧的组件与 Lab 引用，不进插件入口的引用链（后端类型检查不带 DOM）。
 */

import type {MarkdownTargets} from "@notnotype/nb-markdown";
import type {MarkdownLocale, MarkdownText} from "@notnotype/nb-markdown";
import type {ChipEnv} from "@notnotype/nb-markdown/chip";
import type {MarkdownHost} from "@notnotype/nb-markdown/host";
import type {MarkdownLanguage} from "@notnotype/nb-markdown/language";

import type {DisplayLocale} from "nbook/shared/localized-text";
import {fileIconForName} from "nbook/ui/file-icons/file-icons";
import {renderFileIcon} from "nbook/ui/file-icons/render";

import {classifyTarget, encodeFileTarget} from "../shared/targets";
import type {MarkdownReport} from "./parts/report";
import {markdownText} from "./text";

/** 两边的界面语言是同一组值；改了一边这里报错。 */
const sameLocale: [DisplayLocale, MarkdownLocale] extends [MarkdownLocale, DisplayLocale] ? true : never = true;
void sameLocale;

/** 作品里的文件与用户资产归为文件（细分 work、user：`data-reference-link` 与色调类照旧），`session://attachments/` 是附件。 */
export const nbookTargets: MarkdownTargets = {
    classify(target, base) {
        const classified = classifyTarget(target, base);
        if (classified.kind === "work" || classified.kind === "user") return {kind: "file", variant: classified.kind, name: classified.name};
        return {kind: classified.kind, name: classified.name};
    },
    encodeFile: encodeFileTarget,
};

export const nbookChips: ChipEnv = {
    targets: nbookTargets,
    fileIcon: (name) => ({render: (document) => renderFileIcon(document, fileIconForName(name))}),
};

/**
 * 图片不显示时的说明：作品里的图片才显示（docs/specs/workspace/markdown-dialect.md 输出 18）。是本插件目录里的键，nb-markdown 的
 * 组件补上 `name` 后经注入的端口翻译，所以端口要登记 `nbook.markdown` 的目录（窗口按 `builtinPluginCatalogs` 登记）。
 */
export const NBOOK_IMAGE_MISSING: MarkdownText = markdownText("image.missing");

export function nbookMarkdownHost(options: {readonly language?: () => MarkdownLanguage; readonly report?: MarkdownReport}): MarkdownHost {
    return {
        ...(options.language === undefined ? {} : {language: options.language}),
        chips: nbookChips,
        report: options.report ?? (() => undefined),
        imageMissing: NBOOK_IMAGE_MISSING,
    };
}
