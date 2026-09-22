// @vitest-environment jsdom
import {mount, flushPromises} from "@vue/test-utils";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {beforeEach, describe, expect, it, vi} from "vitest";
import MonacoCodeEditor from "./MonacoCodeEditor.vue";

/**
 * 假 Monaco：只实现内核真正用到的 API。
 * 模型按 URI 归档，因此「两个实例是否共用模型」在这里是可观察事实，而不是字符串断言。
 */
const monaco = vi.hoisted(() => {
    type FakeModel = {
        uri: string;
        value: string;
        disposed: boolean;
        listeners: Array<() => void>;
        getValue(): string;
        setValue(next: string): void;
        getLineCount(): number;
        getLineMaxColumn(line: number): number;
        getFullModelRange(): {startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number};
        onDidChangeContent(listener: () => void): {dispose(): void};
        updateOptions(): void;
        pushEditOperations(): void;
        dispose(): void;
    };
    const state = {
        models: new Map<string, FakeModel>(),
        created: [] as string[],
        disposed: [] as string[],
        setValues: [] as Array<{uri: string; value: string}>,
        pushEdits: 0,
        selections: [] as unknown[],
        scrollTops: [] as number[],
    };
    let scrollTop = 24;
    const model = (uri: string, value: string): FakeModel => {
        const listeners: Array<() => void> = [];
        const created: FakeModel = {
            uri,
            value,
            disposed: false,
            listeners,
            getValue: () => created.value,
            setValue: (next) => {
                created.value = next;
                state.setValues.push({uri, value: next});
                for (const listener of [...listeners]) listener();
            },
            getLineCount: () => created.value.split("\n").length,
            getLineMaxColumn: (line) => (created.value.split("\n")[line - 1]?.length ?? 0) + 1,
            getFullModelRange: () => ({startLineNumber: 1, startColumn: 1, endLineNumber: created.getLineCount(), endColumn: 1}),
            onDidChangeContent: (listener) => {
                listeners.push(listener);
                return {dispose: () => undefined};
            },
            updateOptions: () => undefined,
            pushEditOperations: () => {
                state.pushEdits += 1;
            },
            dispose: () => {
                created.disposed = true;
                state.disposed.push(uri);
                state.models.delete(uri);
            },
        };
        state.models.set(uri, created);
        state.created.push(uri);
        return created;
    };
    const disposable = () => ({dispose: () => undefined});
    const api = {
        Uri: {parse: (text: string) => ({toString: () => text})},
        editor: {
            defineTheme: () => undefined,
            setTheme: () => undefined,
            getModel: (uri: {toString(): string}) => state.models.get(uri.toString()),
            createModel: (value: string, _language: string, uri?: {toString(): string}) => model(uri?.toString() ?? "", value),
            create: (_root: HTMLElement, options: {model: FakeModel}) => ({
                model: options.model,
                getSelection: () => ({selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 1}),
                setSelection: (selection: unknown) => {
                    state.selections.push(selection);
                },
                getScrollTop: () => scrollTop,
                setScrollTop: (next: number) => {
                    scrollTop = next;
                    state.scrollTops.push(next);
                },
                getScrollLeft: () => 0,
                setScrollLeft: () => undefined,
                layout: () => undefined,
                focus: () => undefined,
                trigger: () => undefined,
                executeEdits: () => undefined,
                setPosition: () => undefined,
                revealLineInCenter: () => undefined,
                updateOptions: () => undefined,
                addCommand: () => undefined,
                onDidFocusEditorText: disposable,
                onDidBlurEditorText: disposable,
                onKeyDown: disposable,
                dispose: () => undefined,
            }),
        },
        KeyMod: {CtrlCmd: 0},
        KeyCode: {KeyS: 0},
    };
    return {
        api,
        state,
        reset: () => {
            state.models.clear();
            state.created.length = 0;
            state.disposed.length = 0;
            state.setValues.length = 0;
            state.pushEdits = 0;
            state.selections.length = 0;
            state.scrollTops.length = 0;
            scrollTop = 24;
        },
    };
});

vi.mock("nbook/app/components/markdown-studio/load-monaco-editor", () => ({
    loadMonacoEditor: async () => monaco.api,
}));

// Nuxt 自动导入在测试环境里由全局补齐；内核本身不 import 这些名字。
Object.assign(globalThis, {useI18n: () => ({t: (key: string) => key}), ref, computed, watch, nextTick, onMounted, onBeforeUnmount});

type Handle = {update(text: string): void};

async function mounted(modelPath: string, initialValue: string) {
    const wrapper = mount(MonacoCodeEditor, {props: {modelPath, initialValue, language: "markdown"}});
    await flushPromises();
    return {wrapper, handle: wrapper.vm as unknown as Handle};
}

describe("MonacoCodeEditor 模型归属与撤销基线", () => {
    beforeEach(() => {
        monaco.reset();
    });

    it("同文档两个实例各持有自己的模型，卸载一个不影响另一个", async () => {
        const first = await mounted("novel%3Aa/1/1/a.md/instance-a", "正文");
        const second = await mounted("novel%3Aa/1/1/a.md/instance-b", "正文");
        const [uriA, uriB] = monaco.state.created;
        expect(monaco.state.created).toHaveLength(2);
        expect(uriA).toContain("instance-a");
        expect(uriB).toContain("instance-b");
        expect(uriA).not.toBe(uriB);

        first.wrapper.unmount();
        expect(monaco.state.disposed).toEqual([uriA]);
        expect(monaco.state.models.get(uriB!)?.disposed).toBe(false);

        second.handle.update("第二份视图继续输入");
        expect(monaco.state.setValues.at(-1)).toEqual({uri: uriB, value: "第二份视图继续输入"});
        second.wrapper.unmount();
    });

    it("外部回灌整体重设缓冲区并清空撤销栈，同时保留选区与滚动", async () => {
        const {wrapper, handle} = await mounted("novel%3Aa/1/1/a.md/instance-a", "旧正文");
        handle.update("外部权威正文");

        expect(monaco.state.setValues).toHaveLength(1);
        expect(monaco.state.setValues[0]!.uri).toContain("instance-a");
        expect(monaco.state.setValues[0]!.value).toBe("外部权威正文");
        // 整篇回灌不走 pushEditOperations：它不制造撤销项，旧历史也不会被重放到新正文上。
        expect(monaco.state.pushEdits).toBe(0);
        expect(monaco.state.selections).toEqual([{
            selectionStartLineNumber: 1,
            selectionStartColumn: 1,
            positionLineNumber: 1,
            positionColumn: 1,
        }]);
        expect(monaco.state.scrollTops).toEqual([24]);
        wrapper.unmount();
    });
});
