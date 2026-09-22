/**
 * 主题宿主 class。
 *
 * 宿主元素是页面根节点（`index.vue` / `login.vue` / `admin/users.vue` / profile 编辑器）。
 * 它今天不再承载任何主题变量——变量写在 `<html>` 上（见 theme-session.ts），
 * 留这个 class 是因为 Dialog / Tooltip / ContextMenu 等浮层靠它决定 Teleport 落点：
 * 落进页面根节点（而不是 body）才能继承页面的尺寸与层叠上下文。
 *
 * 值仍是 `novel-ide-theme`：改名要连带改几十个 `teleport-target=".novel-ide-theme"`，
 * 而这个名字在消费者眼里是「IDE 页面宿主」，不是主题实现的细节。
 */
export const THEME_HOST_CLASS = "novel-ide-theme";

export const THEME_HOST_SELECTOR = `.${THEME_HOST_CLASS}`;

/**
 * 给页面根节点补上宿主 class。
 *
 * 已经在某个宿主内部时**不动**：嵌套宿主会让 fixed 浮层（Tooltip / Dialog）以 transform 容器
 * 为定位基准，profile 编辑器内嵌进工作台 Dialog 时实测过这条。
 */
export function ensureThemeHost(root: HTMLElement | null): void {
    if (root === null || root.closest(THEME_HOST_SELECTOR) !== null) {
        return;
    }
    root.classList.add(THEME_HOST_CLASS);
}
