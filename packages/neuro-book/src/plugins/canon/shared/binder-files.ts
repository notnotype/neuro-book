/**
 * 活页夹里章节文件的名字（docs/specs/workspace/folder-kinds.md 的活页夹清单）：活页夹目录下 `<五位编号>-<章名>.md`。项目实例读
 * 正文（`backend/binder.ts`）与浏览器里“打开这一章”（变更详情页）认同一个文件，规则只写在这里；纯函数，前后端都能用。
 */

export const BINDER_DIR = "manuscripts.binder";
export const BINDER_MANIFEST = "binder.xml";

/** 章节文件名（`00012-标题.md`）对应的章 id（`12`）；不是章节文件时为 null。 */
export function chapterOfFile(name: string): string | null {
    const match = /^(\d+)-.*\.md$/u.exec(name);
    return match === null ? null : String(Number(match[1]));
}

/** 一章的章节文件：编号补零到五位的那种写法；同一章有几个文件时取列表里的第一个。没有时为 undefined。 */
export function chapterFileName(names: readonly string[], chapter: string): string | undefined {
    const prefix = `${chapter.padStart(5, "0")}-`;
    return names.find((name) => name.startsWith(prefix) && name.endsWith(".md"));
}
