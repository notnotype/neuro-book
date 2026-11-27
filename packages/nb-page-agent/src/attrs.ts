/**
 * 控件的稳定名（docs/specs/agent/page-agent.md 输出 6）：控件的拥有者在控件上写 `data-nb-target` 与可选的 `data-nb-key`，
 * Agent 的快照与定位按它认控件。Vue 模板里写 `v-bind="nbTarget('workbench.view', view.id)"`。
 *
 * 这个入口不碰 DOM、没有依赖：前后端与共用代码都能引用。
 */

/** `nbTarget` 交回的属性，原样铺到元素上。 */
export interface NbTargetAttributes {
    readonly "data-nb-target": string;
    readonly "data-nb-key"?: string;
}

/** 点分的小写段，第一段是拥有它的插件或区域，例如 `workbench.view`、`settings.row`、`command`。 */
const STABLE_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/u;

/**
 * 写稳定名用的属性。`name` 是写在代码里的字面量，写错了在第一次渲染时就抛出；`key` 是业务身份（视图 id、设置键），不要用列表下标：
 * 列表重排后下标会指到另一行。
 */
export function nbTarget(name: string, key?: string): NbTargetAttributes {
    if (!STABLE_NAME.test(name)) throw new TypeError(`稳定名要写成点分的小写段，收到 ${JSON.stringify(name)}`);
    if (key === undefined) return {"data-nb-target": name};
    if (key === "") throw new TypeError(`稳定名 ${name} 的 key 不能是空串`);
    return {"data-nb-target": name, "data-nb-key": key};
}
