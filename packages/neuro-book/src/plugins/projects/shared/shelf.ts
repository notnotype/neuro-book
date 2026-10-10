/**
 * 书架上一部作品的界面类型（docs/specs/workbench/bookshelf.md）：schema 在 `contracts.ts`（远程合同 `shelf` 的输出），这里
 * 只把类型与显示名的规则交给组件。统计只读缓存，`freshness` 说明它是不是最新的，界面不把旧快照当实时值。
 */

export type {ShelfFreshness, ShelfItem, ShelfLastEdit, ShelfStats} from "./contracts";

/** 作品的显示名：书名优先，没有时用短名。书架与“打开项目”的列表都经它；已打开窗口的标题栏仍显示短名（窗口绑定不带书名）。 */
export function projectDisplayName(project: {readonly name: string; readonly title: string | null}): string {
    return project.title ?? project.name;
}
