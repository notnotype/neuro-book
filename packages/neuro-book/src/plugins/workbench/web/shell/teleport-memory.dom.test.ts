/**
 * 三层 Teleport 共用的滚动与焦点记忆（docs/specs/ui/workbench-shell.md 外壳一输出 6、外壳二输出 18）：真实 DOM 节点的
 * 搬动（`appendChild` 与 Teleport 做的是同一件事）。
 */

import {afterEach, describe, expect, it} from "vitest";

import {TeleportMemory} from "./teleport-memory";

function scroller(name: string): HTMLDivElement {
    const element = document.createElement("div");
    element.dataset.name = name;
    element.tabIndex = -1;
    return element;
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("TeleportMemory", () => {
    function world() {
        const root = document.createElement("div");
        const visible = document.createElement("div");
        const parking = document.createElement("div");
        root.append(visible, parking);
        document.body.append(root);
        const memory = new TeleportMemory();
        memory.parking(parking);
        return {root, visible, parking, memory};
    }

    it("停放着的元素不覆盖之前的记录；回到可见处时还原", () => {
        const {root, visible, parking, memory} = world();
        const content = scroller("content");
        visible.append(content);
        content.scrollTop = 300;
        memory.capture(root);
        parking.append(content);
        // 停放区里读出的滚动位置不可信：这次记录要跳过它。
        content.scrollTop = 0;
        memory.capture(root);
        visible.append(content);
        memory.restore(null, root);
        expect(content.scrollTop).toBe(300);
    });

    it("焦点：原节点仍可见时拿回；被停放时报告丢失；焦点已在外壳之外时不抢", () => {
        const {root, visible, parking, memory} = world();
        const content = scroller("content");
        visible.append(content);
        content.focus();
        let focus = memory.capture(root);
        expect(focus).toBe(content);
        parking.append(content);
        content.blur();
        expect(memory.restore(focus, root)).toBe("lost");

        visible.append(content);
        content.focus();
        focus = memory.capture(root);
        content.blur();
        expect(memory.restore(focus, root)).toBe("restored");
        expect(document.activeElement).toBe(content);

        const outside = scroller("menu");
        document.body.append(outside);
        focus = memory.capture(root);
        outside.focus();
        expect(memory.restore(focus, root)).toBe("none");
        expect(document.activeElement).toBe(outside);
    });

    it("停放区注销后不再算停放；不在文档里的元素被忘掉", () => {
        const {root, visible, parking, memory} = world();
        const content = scroller("content");
        parking.append(content);
        expect(memory.parked(content)).toBe(true);
        memory.parking(null, parking);
        expect(memory.parked(content)).toBe(false);
        visible.append(content);
        content.scrollTop = 120;
        memory.capture(root);
        content.remove();
        memory.restore(null, root);
        visible.append(content);
        content.scrollTop = 0;
        memory.restore(null, root);
        expect(content.scrollTop).toBe(0);
    });

    it("track：旧落点先带着内容离开文档时，滚动位置与焦点仍按事件里记下的还原", () => {
        const {root, visible, memory} = world();
        const dispose = memory.track(root);
        const oldTarget = document.createElement("div");
        visible.append(oldTarget);
        const content = scroller("content");
        oldTarget.append(content);
        content.scrollTop = 200;
        content.dispatchEvent(new Event("scroll"));
        content.focus();
        // 旧落点被卸下：内容随它离开文档，焦点落到 body。
        oldTarget.remove();
        expect(document.activeElement).toBe(document.body);
        const newTarget = document.createElement("div");
        visible.append(newTarget);
        newTarget.append(content);
        content.scrollTop = 0;
        expect(memory.restore(null, root)).toBe("restored");
        expect(content.scrollTop).toBe(200);
        expect(document.activeElement).toBe(content);
        dispose();
    });
});
