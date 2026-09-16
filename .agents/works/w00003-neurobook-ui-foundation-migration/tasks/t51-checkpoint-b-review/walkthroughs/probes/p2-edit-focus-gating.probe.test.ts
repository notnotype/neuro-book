// @vitest-environment jsdom
/**
 * 探针 P2（jsdom + 产品纯函数，不启动任何产品服务）：复刻 `app/pages/index.vue` 的编辑目标口径，
 * 试图证伪这组声明（t50 实现要求 2 / 实施记录 §4.0、§六）：
 *
 *   A. 「编辑动作按真实焦点判断」——菜单里的 enabled 与执行去处同一份判定；
 *   B. 「键盘与焦点行为可用」——键盘打开 Edit 菜单后编辑动作仍能点。
 *
 * 复刻依据（逐行对照，不是自创口径）：
 *   index.vue:282-284  `titleBarEditTarget = resolveTitleBarEditTarget(activeElement, studio.activeEditor !== null)`
 *   index.vue:  88-96  `executeEditCommand` 用 `resolveTitleBarEditRoute` 选去处（unavailable 只提示不执行）
 *   DesktopTitleBarChrome.vue:191-196  `focusableMenuItems` 过滤 `disabled` 的 menuitem（键盘遍历看不见禁用项）
 *
 * 运行（cwd = worktree 根）：
 *   bunx vitest run --config .agents/works/w00003-neurobook-ui-foundation-migration/tasks/t51-checkpoint-b-review/walkthroughs/probes/vitest.probe.config.ts
 */
import {describe, expect, it} from "vitest";
import {
    resolveTitleBarEditRoute,
    resolveTitleBarEditTarget,
    resolveTitleBarMenuGroups,
    type TitleBarEditTarget,
    type TitleBarMenuItemModel,
} from "nbook/app/utils/workbench-chrome";

/** 页面口径原样复刻：焦点事实 + Studio「当前有焦点编辑器」布尔值。 */
function pageEditTarget(activeElement: Element | null, studioActiveEditor: "source" | "preview" | null): TitleBarEditTarget {
    return resolveTitleBarEditTarget(activeElement, studioActiveEditor !== null);
}

function editItems(target: TitleBarEditTarget, desktop = false): readonly TitleBarMenuItemModel[] {
    return resolveTitleBarMenuGroups({desktop, surfaceActive: true, editTarget: target})
        .find((group) => group.label === "Edit")!.items;
}

/** 组件的键盘遍历口径：禁用项不进焦点环。 */
function focusableCount(items: readonly TitleBarMenuItemModel[]): number {
    return items.filter((item) => !item.disabled).length;
}

function describeItems(items: readonly TitleBarMenuItemModel[]): string {
    return items.map((item) => `${item.label}=${item.disabled ? "禁用" : "可用"}`).join(" ");
}

function element(tag: string, attributes: Record<string, string> = {}): HTMLElement {
    const created = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) created.setAttribute(name, value);
    document.body.append(created);
    return created;
}

describe("P2 编辑动作的焦点口径", () => {
    it("A. 焦点事实 → 编辑目标：逐个元素类别的分类结果", () => {
        const input = element("input");
        const textarea = element("textarea");
        const select = element("select");
        const button = element("button");
        const editable = element("div", {contenteditable: "true"});
        const plainDiv = element("div");

        const rows: [string, Element | null, boolean, TitleBarEditTarget][] = [
            ["<input>", input, false, "native"],
            ["<textarea>", textarea, false, "native"],
            ["<select>", select, false, "native"],
            ["<button>（标题栏触发按钮就是这一类）", button, false, "none"],
            ["<div>", plainDiv, false, "none"],
            ["document.body", document.body, false, "none"],
            ["null（无焦点）", null, false, "none"],
            ["null + Studio 编辑器持有焦点", null, true, "editor"],
            ["<input> + Studio 编辑器持有焦点（Studio 优先）", input, true, "editor"],
        ];
        for (const [label, active, editorFocused, expected] of rows) {
            const actual = pageEditTarget(active, editorFocused ? "source" : null);
            console.log(`[P2/A] ${label} → ${actual}（期望 ${expected}）`);
            expect(actual).toBe(expected);
        }

        // jsdom 的限制要如实记下：真机里 `contenteditable` 的 isContentEditable 为 true，jsdom 不实现。
        console.log(`[P2/A] jsdom 对 contenteditable 的读数：${String(editable.isContentEditable)}；jsdom 不实现该属性，本探针对此不作真机结论`);
    });

    it("B. 同一份判定下，鼠标路径可用而键盘路径整组禁用", () => {
        // 鼠标路径：触发按钮与菜单项都 @mousedown.prevent，焦点留在原输入框（index.vue 的真实焦点仍是输入框）。
        const input = element("input");
        input.focus();
        const mouseTarget = pageEditTarget(document.activeElement, null);
        const mouseItems = editItems(mouseTarget);
        console.log(`[P2/B] 鼠标打开菜单（焦点仍在输入框）：editTarget=${mouseTarget}；${describeItems(mouseItems)}；可点项=${String(focusableCount(mouseItems))}`);
        expect(mouseTarget).toBe("native");
        expect(focusableCount(mouseItems)).toBe(5);

        // 键盘路径：要把菜单打开，焦点必须先落到标题栏触发按钮上（Tab 或 ArrowRight 换组）。
        const trigger = element("button", {"data-menu-button": "Edit"});
        trigger.focus();
        const keyboardTarget = pageEditTarget(document.activeElement, null);
        const keyboardItems = editItems(keyboardTarget);
        console.log(`[P2/B] 键盘打开菜单（焦点在触发按钮）：editTarget=${keyboardTarget}；${describeItems(keyboardItems)}；可点项=${String(focusableCount(keyboardItems))}`);
        expect(document.activeElement).toBe(trigger);
        expect(keyboardTarget).toBe("none");
        expect(keyboardItems.every((item) => item.disabled)).toBe(true);
        expect(focusableCount(keyboardItems)).toBe(0);
    });

    it("C. 焦点在 Studio 编辑器时的去处：undo/redo 走会话，其余走原生（浏览器无粘贴）", () => {
        const editable = element("div", {contenteditable: "true"});
        editable.focus();
        const target = pageEditTarget(document.activeElement, "source");
        const routes = editItems(target).map((item) => `${item.command}=${resolveTitleBarEditRoute(item.command as never, {desktop: false, surfaceActive: true, editTarget: target})}`);
        console.log(`[P2/C] Studio 持焦点（浏览器）：${routes.join(" ")}`);
        expect(target).toBe("editor");
        expect(routes).toEqual([
            "edit.undo=studio",
            "edit.redo=studio",
            "edit.cut=native",
            "edit.copy=native",
            "edit.paste=unavailable",
            "edit.select-all=native",
        ]);
    });
});
