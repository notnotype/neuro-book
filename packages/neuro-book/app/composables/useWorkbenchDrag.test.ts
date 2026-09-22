// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from "vitest";

/** dnd-kit 的 DOM 包在**模块初始化**时就要 `ResizeObserver`；抢在导入之前补上替身。 */
vi.hoisted(() => {
    if (typeof (globalThis as {ResizeObserver?: unknown}).ResizeObserver === "undefined") {
        Object.assign(globalThis, {
            ResizeObserver: class {
                observe(): void {}
                unobserve(): void {}
                disconnect(): void {}
            },
        });
    }
});

import type {Draggable} from "@dnd-kit/dom";
import {ActivationController} from "@dnd-kit/abstract";
import {
    workbenchDragBlocksTarget,
    workbenchDragSensor,
    workbenchActivationConstraints,
} from "nbook/app/composables/useWorkbenchDrag";

/**
 * 拖动源的**激活门槛与交互排除**：整标题可拖，标题里的动作组 / 菜单 / 表单控件不参与拖动。
 *
 * 使用库的公开激活控制器验证位移、长按与取消；页面中的完整指针手势仍由浏览器验收。
 */

function pointerEvent(type: string, pointerType: string, clientX = 0): PointerEvent {
    return new PointerEvent(type, {pointerType, clientX, clientY: 0});
}

afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
});

describe("workbenchDragBlocksTarget", () => {
    it("标题自身的按钮不排除：整标题拖动正是本次合同", () => {
        const head = document.createElement("div");
        const toggle = document.createElement("button");
        toggle.textContent = "标题";
        head.append(toggle);

        expect(workbenchDragBlocksTarget(toggle)).toBe(false);
        expect(workbenchDragBlocksTarget(head)).toBe(false);
    });

    it("动作组、菜单、表单控件与可编辑区排除", () => {
        document.body.innerHTML = [
            "<div data-no-drag><button id=\"action\">动作</button></div>",
            "<input id=\"input\">",
            "<textarea id=\"textarea\"></textarea>",
            "<a id=\"link\" href=\"/x\">链接</a>",
            "<div id=\"editable\" contenteditable=\"true\"><span id=\"editable-child\"></span></div>",
            "<div role=\"menu\"><div id=\"menu-item\" role=\"menuitem\">项</div></div>",
        ].join("");

        for (const id of ["action", "input", "textarea", "link", "editable", "editable-child", "menu-item"]) {
            expect(workbenchDragBlocksTarget(document.getElementById(id)), id).toBe(true);
        }
        // 非元素目标（合成事件、文本节点）不阻挡：判据只认元素。
        expect(workbenchDragBlocksTarget(null)).toBe(false);
    });

    it("传感器用同一条判据：动作组里的按下不激活拖动", () => {
        document.body.innerHTML = "<div data-no-drag><button id=\"action\">动作</button></div><button id=\"plain\">标题</button>";
        const preventActivation = workbenchDragSensor.options?.preventActivation;
        expect(preventActivation).toBeTypeOf("function");
        expect(preventActivation!({target: document.getElementById("action")} as unknown as PointerEvent, {} as Draggable)).toBe(true);
        expect(preventActivation!({target: document.getElementById("plain")} as unknown as PointerEvent, {} as Draggable)).toBe(false);
    });
});

describe("workbenchDragSensor 的激活门槛", () => {
    it("鼠标 / 笔：不超过 6px 不激活，超过后只激活一次", () => {
        for (const pointerType of ["mouse", "pen"]) {
            const activate = vi.fn();
            const down = pointerEvent("pointerdown", pointerType);
            const controller = new ActivationController(workbenchActivationConstraints(down), activate);
            try {
                controller.onEvent(down);
                controller.onEvent(pointerEvent("pointermove", pointerType, 6));
                expect(activate).not.toHaveBeenCalled();
                controller.onEvent(pointerEvent("pointermove", pointerType, 7));
                controller.onEvent(pointerEvent("pointermove", pointerType, 12));
                expect(activate).toHaveBeenCalledTimes(1);
            } finally {
                controller.abort();
            }
        }
    });

    it("触摸：容差内按住 200ms 后激活", () => {
        vi.useFakeTimers();
        const activate = vi.fn();
        const down = pointerEvent("pointerdown", "touch");
        const controller = new ActivationController(workbenchActivationConstraints(down), activate);
        try {
            controller.onEvent(down);
            controller.onEvent(pointerEvent("pointermove", "touch", 6));
            vi.advanceTimersByTime(199);
            expect(activate).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1);
            expect(activate).toHaveBeenCalledTimes(1);
        } finally {
            controller.abort();
        }
    });

    it("触摸：长按前滚动超出容差或松手均不激活", () => {
        vi.useFakeTimers();
        for (const type of ["pointermove", "pointerup"]) {
            const activate = vi.fn();
            const down = pointerEvent("pointerdown", "touch");
            const controller = new ActivationController(workbenchActivationConstraints(down), activate);
            try {
                controller.onEvent(down);
                vi.advanceTimersByTime(100);
                controller.onEvent(pointerEvent(type, "touch", type === "pointermove" ? 7 : 0));
                vi.advanceTimersByTime(200);
                expect(activate).not.toHaveBeenCalled();
            } finally {
                controller.abort();
            }
        }
    });
});
