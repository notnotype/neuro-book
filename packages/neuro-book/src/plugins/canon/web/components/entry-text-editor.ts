/**
 * `EntryTextEditor` 的数据。放在单独的模块里：宿主（`EntryPageHost.vue`）与它的测试也用，而后端的类型检查看不懂 `.vue`。
 */

/** “插入”菜单里的一项：选了在光标处写入 `snippet`。 */
export interface InsertItem {
    readonly label: string;
    /** 写进源文字的写法，例如 `<V of="panel.魔力" />`；同一个菜单里不重复。 */
    readonly snippet: string;
}
