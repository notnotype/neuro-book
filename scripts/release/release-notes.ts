import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

/**
 * 从 RELEASE.md 文本中提取当前版本段落：第一个 `## <版本> - <日期>` 二级标题之后到文末的正文。
 *
 * RELEASE.md 只保留当前版本，因此第一个二级标题即当前版本；标题行本身不进入 note
 * （GitHub Release 标题已含版本号）。无二级标题或正文为空时返回空字符串，由调用方回退。
 */
export function extractReleaseNotes(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    const headingIndex = lines.findIndex((line) => /^##\s/u.test(line));
    if (headingIndex < 0) {
        return "";
    }
    return lines.slice(headingIndex + 1).join("\n").trim();
}

/** 读取仓库根 RELEASE.md 并提取当前版本段落；文件缺失或读取失败返回空字符串。 */
export async function readReleaseNotesBody(repoRoot: string): Promise<string> {
    const markdown = await readFile(resolve(repoRoot, "RELEASE.md"), "utf8").catch(() => "");
    return extractReleaseNotes(markdown);
}
