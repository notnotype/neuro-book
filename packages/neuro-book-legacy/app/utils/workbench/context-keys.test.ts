import {describe, expect, it} from "vitest";
import {
    evaluateContextWhen,
    validateWhen,
    type ContextKey,
    type ContextValues,
} from "nbook/app/utils/workbench/context-keys";
import {evaluateWhen, type WorkbenchContext} from "nbook/app/utils/workbench/descriptors";

const values: ContextValues = {"editor-active": true, "editor-writable": true, "editor-focus": false};

function untyped(when: {requires: readonly string[]}): {requires: readonly ContextKey[]} {
    return when as unknown as {requires: readonly ContextKey[]};
}

describe("validateWhen", () => {
    it("没有谓词与空数组都合法；登记过的键放行", () => {
        expect(validateWhen(undefined).ok).toBe(true);
        expect(validateWhen({requires: []}).ok).toBe(true);
        expect(validateWhen({requires: ["editor-active", "quick-open-visible", "agent-panel-open"]}).ok).toBe(true);
    });

    it("未登记键拒绝，且原型属性不算登记", () => {
        const offline = validateWhen(untyped({requires: ["offline"]}));
        expect(offline.ok).toBe(false);
        if (!offline.ok) {
            expect(offline.reason).toContain("offline");
        }
        expect(validateWhen(untyped({requires: ["constructor"]})).ok).toBe(false);
        expect(validateWhen(untyped({requires: ["toString"]})).ok).toBe(false);
    });
});

describe("evaluateContextWhen", () => {
    it("requires 是 all-of：缺失的已登记键按 false 求值并各产生一条原因", () => {
        expect(evaluateContextWhen({requires: ["editor-active", "editor-writable"]}, values)).toEqual({
            ok: true,
            value: {matches: true, reasons: []},
        });

        const missing = evaluateContextWhen({requires: ["editor-active", "editor-focus", "agent-panel-open"]}, values);
        expect(missing.ok).toBe(true);
        if (missing.ok) {
            expect(missing.value.matches).toBe(false);
            expect(missing.value.reasons).toHaveLength(2);
        }
    });

    it("空数组与缺省谓词恒真；未登记键求值失败而不是当可见", () => {
        expect(evaluateContextWhen(undefined, {})).toEqual({ok: true, value: {matches: true, reasons: []}});
        expect(evaluateContextWhen({requires: []}, {})).toEqual({ok: true, value: {matches: true, reasons: []}});

        const unknown = evaluateContextWhen(untyped({requires: ["offline"]}), values);
        expect(unknown.ok).toBe(false);
    });

    it("同一份 context 下视图与命令的求值结果一致", () => {
        const context: WorkbenchContext = {
            project: true,
            selection: false,
            "user-assets": false,
            desktop: true,
            authorities: {project: true, session: false, job: false, files: true},
            projectRoot: "/workspace/novel",
            "editor-focus": true,
            "editor-active": true,
        };

        for (const when of [
            undefined,
            {requires: [] as const},
            {requires: ["project"] as const},
            {requires: ["project", "selection"] as const},
            {requires: ["desktop", "editor-focus"] as const},
            {requires: ["editor-writable"] as const},
        ]) {
            const shared = evaluateContextWhen(when, context);
            const view = evaluateWhen(when, context);
            expect(shared.ok).toBe(true);
            expect(view).toEqual({
                ok: true,
                value: {visible: shared.ok ? shared.value.matches : false, reasons: shared.ok ? shared.value.reasons : []},
            });
        }
    });
});
