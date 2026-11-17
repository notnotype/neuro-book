/**
 * 链接卡片里输入的地址换成要写进正文的链接（docs/specs/workbench/markdown-editing.md 输出 52、57）：地址原样写下，只有
 * `project://` 开头的作品地址改写成相对当前文件的写法；光标处没有链接要插入一段时，文字取地址指向的文件名（去掉扩展名），外部网址
 * 取网址本身。
 */

import {isSafeHref} from "@notnotype/nb-markdown/editor";
import {pathPart, relativeTarget} from "@notnotype/nb-markdown";

import {classifyTarget} from "../../../shared/targets";
import {nbookTargets} from "../../host";

export interface LinkRequest {
    readonly href: string;
    /** 光标处插入链接时的文字；改已有的链接、给选中的字加链接时不用。 */
    readonly label: string;
}

const PROJECT_ADDRESS = /^project:\/\//iu;

/** 去掉最后一个扩展名；名字就是 `.gitignore` 这样以点开头的、或没有扩展名的原样。 */
const withoutExtension = (name: string): string => name.replace(/(?<=.)\.[^./]+$/u, "");

/** 空的、不安全的（`javascript:` 等）为 null：卡片不让确认。 */
export function linkRequest(input: string, base: string | null): LinkRequest | null {
    const text = input.trim();
    if (text === "" || !isSafeHref(text)) return null;
    let href = text;
    if (PROJECT_ADDRESS.test(text)) {
        // `?查询` 与 `#片段` 不是文件的一部分：只改写路径，后缀原样接回去（读回时 `classifyTarget` 同样先去掉它们）。
        const path = pathPart(text);
        const relative = relativeTarget(base, path, nbookTargets);
        if (relative !== null) href = `${relative}${text.slice(path.length)}`;
    }
    const target = classifyTarget(text, base);
    const named = (target.kind === "work" || target.kind === "user") && target.name !== "" ? withoutExtension(target.name) : "";
    return {href, label: named === "" ? text : named};
}
