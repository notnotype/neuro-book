// @vitest-environment jsdom
import {mount, flushPromises, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, onMounted} from "vue";
import {describe, expect, it, vi} from "vitest";
import EditorViewHost from "./EditorViewHost.vue";
import {createEditorRegistry} from "nbook/app/utils/editor-workbench/registry";
import type {EditorRegistry} from "nbook/app/utils/editor-workbench/registry";
import type {
    EditorChangeRequest,
    EditorChangeResult,
    EditorConflictChoice,
    EditorContribution,
    EditorDocumentSnapshot,
    EditorFlushResult,
    EditorViewEvents,
    EditorViewHandle,
} from "./editor-view.types";

const target = {workspaceKey: "novel:a", generation: 1, documentId: "1", path: "a.md"};
const document: EditorDocumentSnapshot = {target, content: "unmodified **source**\n", contentRevision: 4, languageId: "markdown", readonly: false};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type Harness = {
    events: Record<string, EditorViewEvents>;
    handles: Record<string, EditorViewHandle>;
    mounts: string[];
};

/** 替身视图：把宿主交付的快照原样渲染出来，句柄与事件交给测试直接驱动。 */
function harness(): {registry: EditorRegistry; state: Harness} {
    const state: Harness = {events: {}, handles: {}, mounts: []};
    state.handles.code = flushable();
    state.handles.markdown = flushable();
    function contribution(id: string): EditorContribution {
        const View = defineComponent({
            props: {document: {type: Object, required: true}, viewInstanceId: {type: String, required: true}},
            emits: ["ready"],
            setup(viewProps, {emit}) {
                onMounted(() => {
                    state.mounts.push(id);
                    emit("ready", state.handles[id]!);
                });
                return () => h("textarea", {"data-view": id, "data-instance": viewProps.viewInstanceId, value: (viewProps.document as EditorDocumentSnapshot).content});
            },
        });
        return {
            id, titleKey: id, iconClass: "", supports: () => true,
            render: (props, callbacks, bind) => {
                state.events[id] = callbacks;
                return h(View, {document: props.document, viewInstanceId: props.viewInstanceId, onReady: bind});
            },
        };
    }
    const registry = createEditorRegistry([contribution("code"), contribution("markdown")]);
    if (!registry.ok) throw new Error(registry.reason);
    return {registry: registry.value, state};
}

function flushable(result: EditorFlushResult = "settled", calls?: {count: number}): EditorViewHandle {
    return {
        flushPendingChange: () => {
            if (calls) calls.count += 1;
            return result;
        },
        focus: vi.fn(),
    };
}

const read = (wrapper: VueWrapper, view: string): string =>
    (wrapper.get(`[data-view="${view}"]`).element as HTMLTextAreaElement).value;
const exposedFlush = (wrapper: VueWrapper): (() => EditorFlushResult) =>
    (wrapper.vm as unknown as {flushPendingChange: () => EditorFlushResult}).flushPendingChange;

/** 旧视图替身：结算时先跑调用方给的 flush，再按回执决定是否算已结算。 */
const OldView = defineComponent({
    props: {flush: {type: Function, required: true}},
    emits: ["ready"],
    setup(viewProps, {emit}) {
        onMounted(() => emit("ready", {
            focus() {},
            flushPendingChange: viewProps.flush as () => EditorFlushResult,
        } as EditorViewHandle));
        return () => h("div", "old");
    },
});

describe("EditorViewHost", () => {
    it("token 每次新建都不同，事件带 token；accepted 才推进确认快照，conflict 不外传候选", async () => {
        const built = harness();
        const commits: EditorChangeRequest[] = [];
        let reply: (request: EditorChangeRequest) => EditorChangeResult = () => ({status: "conflict", snapshot: document});
        const wrapper = mount(EditorViewHost, {
            props: {
                document, editorId: "code", registry: built.registry,
                commitChange: (request) => {
                    commits.push(request);
                    return reply(request);
                },
            },
        });
        await flushPromises();
        const handleReady = wrapper.emitted("handle-ready")!;
        const token = handleReady.at(-1)![1] as string;
        expect(handleReady.at(-1)![0]).toEqual(target);
        expect(token).toMatch(uuid);

        built.state.events.code!.save(target);
        built.state.events.code!.focus(target, true);
        expect(wrapper.emitted("save-request")).toEqual([[target, token]]);
        expect(wrapper.emitted("focus-change")).toEqual([[target, token, true]]);

        // conflict：回执原样返回，确认快照不动，候选不推给其它视图。
        const before = built.state.events.code!.change(target, 4, "typed but rejected");
        expect(before.status).toBe("conflict");
        expect(commits[0]).toEqual({target, token, baseRevision: 4, content: "typed but rejected"});
        expect(read(wrapper, "code")).toBe(document.content);

        // accepted：确认快照按回执推进，渲染出的正文随之更新。
        const accepted: EditorDocumentSnapshot = {...document, content: "typed but rejected", contentRevision: 5};
        reply = () => ({status: "accepted", snapshot: accepted});
        await nextTick();
        const after = built.state.events.code!.change(target, 5, "typed but rejected");
        expect(after).toEqual({status: "accepted", snapshot: accepted});
        await nextTick();
        expect(read(wrapper, "code")).toBe("typed but rejected");
        wrapper.unmount();
    });

    it("解析暂时缺失时存活实例仍跟随权威正文，不会停在旧快照上", async () => {
        const built = harness();
        const wrapper = mount(EditorViewHost, {
            props: {
                document, editorId: "markdown", registry: built.registry,
                commitChange: () => ({status: "accepted", snapshot: document}),
            },
        });
        await flushPromises();
        expect(read(wrapper, "markdown")).toBe(document.content);

        // 兄弟组写入后解析一度不可用：实例必须跟着权威快照走，否则下一次输入会拿旧修订提交。
        const sibling: EditorDocumentSnapshot = {...document, content: "兄弟组写入\n", contentRevision: 5};
        await wrapper.setProps({document: sibling, editorId: null});
        await nextTick();
        expect(read(wrapper, "markdown")).toBe("兄弟组写入\n");
        wrapper.unmount();
    });

    it("旧 token 的迟到回调不能覆盖重挂后的实例", async () => {
        const built = harness();
        const commits: EditorChangeRequest[] = [];
        const wrapper = mount(EditorViewHost, {
            props: {
                document, editorId: "code", registry: built.registry,
                commitChange: (request) => {
                    commits.push(request);
                    return {status: "accepted", snapshot: document};
                },
            },
        });
        await flushPromises();
        const staleEvents = built.state.events.code!;
        const staleToken = wrapper.emitted("handle-ready")!.at(-1)![1] as string;

        const nextTarget = {...target, generation: 2, documentId: "2"};
        await wrapper.setProps({document: {...document, target: nextTarget, content: "# 第二代\n", contentRevision: 0}});
        await flushPromises();
        const freshToken = wrapper.emitted("handle-ready")!.at(-1)![1] as string;
        expect(freshToken).not.toBe(staleToken);
        expect(freshToken).toMatch(uuid);
        expect(read(wrapper, "code")).toBe("# 第二代\n");

        const actionsBefore = wrapper.emitted("view-actions")?.length ?? 0;
        expect(staleEvents.change(target, 4, "late previous document")).toEqual({status: "stale"});
        staleEvents.save(target);
        staleEvents.focus(target, true);
        staleEvents.actions(target, [{id: "stale", label: "stale", disabled: false}]);
        expect(commits).toEqual([]);
        expect(wrapper.emitted("save-request")).toBeUndefined();
        expect(wrapper.emitted("focus-change")).toBeUndefined();
        expect(wrapper.emitted("view-actions")?.length ?? 0).toBe(actionsBefore);
        wrapper.unmount();
    });

    it("隐藏实例仍能结算自己的输入，隐藏前先 flush 再交给新目标同步", async () => {
        const commits: EditorChangeRequest[] = [];
        let complete!: (handle: EditorViewHandle | null) => void;
        const flush = vi.fn(() => "settled" as EditorFlushResult);
        const registry = createEditorRegistry([{
            id: "code", titleKey: "code", iconClass: "", supports: () => true,
            render: (_props, events, bind) => h(OldView, {
                onReady: bind,
                flush: () => {
                    flush();
                    return events.change(target, 4, "typed while loading").status === "accepted" ? "settled" : "conflict";
                },
            }),
        }, {
            id: "delayed", titleKey: "delayed", iconClass: "", supports: () => true,
            render: (props, _events, bind) => {
                complete = bind;
                return h("textarea", {"data-view": "delayed", value: props.document.content});
            },
        }]);
        if (!registry.ok) throw new Error(registry.reason);
        const wrapper = mount(EditorViewHost, {
            props: {
                document, editorId: "code", registry: registry.value,
                commitChange: (request) => {
                    commits.push(request);
                    return {status: "accepted", snapshot: {...document, content: request.content, contentRevision: request.baseRevision + 1}};
                },
            },
        });
        await flushPromises();
        await wrapper.setProps({editorId: "delayed"});
        // 目标尚未就绪：旧视图仍可见，宿主不提前结算也不提前隐藏。
        expect(flush).not.toHaveBeenCalled();
        complete(flushable());
        await nextTick();
        expect(flush).toHaveBeenCalledTimes(1);
        expect(commits.at(-1)).toMatchObject({baseRevision: 4, content: "typed while loading"});
        await wrapper.setProps({document: {...document, content: "typed while loading", contentRevision: 5}});
        await nextTick();
        expect((wrapper.get('[data-view="delayed"]').element as HTMLTextAreaElement).value).toBe("typed while loading");
        wrapper.unmount();
    });

    it("flushPendingChange 结算本宿主全部实例，任一 conflict 即 conflict", async () => {
        const built = harness();
        const codeCalls = {count: 0};
        const markdownCalls = {count: 0};
        built.state.handles.code = flushable("settled", codeCalls);
        built.state.handles.markdown = flushable("conflict", markdownCalls);
        const wrapper = mount(EditorViewHost, {
            props: {document, editorId: "code", registry: built.registry, commitChange: () => ({status: "stale"})},
        });
        await flushPromises();
        expect(exposedFlush(wrapper)()).toBe("settled");
        expect(codeCalls.count).toBe(1);
        expect(markdownCalls.count).toBe(0);

        // 切到 markdown：code 实例被隐藏但保留，两个实例都在宿主登记里。
        // 切换活动视图会先结算被隐藏的实例，所以 code 的结算次数在聚合之外多一次。
        await wrapper.setProps({editorId: "markdown"});
        await flushPromises();
        expect(codeCalls.count).toBe(2);
        expect(exposedFlush(wrapper)()).toBe("conflict");
        expect(codeCalls.count).toBe(3);
        expect(markdownCalls.count).toBe(1);
        wrapper.unmount();
    });

    it("冲突裁决请求按 token 交给持有候选的实例，并把结果回报出去", async () => {
        const built = harness();
        built.state.handles.code = {...flushable(), resolveConflict: () => "settled"};
        const resolve = vi.fn<(choice: EditorConflictChoice) => EditorFlushResult>(() => "conflict");
        built.state.handles.markdown = {...flushable(), resolveConflict: (choice) => resolve(choice)};
        const wrapper = mount(EditorViewHost, {
            props: {document, editorId: "markdown", registry: built.registry, commitChange: () => ({status: "stale"})},
        });
        await flushPromises();
        const token = wrapper.emitted("handle-ready")!.at(-1)![1] as string;

        await wrapper.setProps({conflictResolution: {token: "不存在的实例", choice: "keep-view"}});
        expect(resolve).not.toHaveBeenCalled();
        expect(wrapper.emitted("conflict-resolved")).toBeUndefined();

        await wrapper.setProps({conflictResolution: {token, choice: "keep-view"}});
        expect(resolve).toHaveBeenCalledWith("keep-view");
        expect(wrapper.emitted("conflict-resolved")).toEqual([[token, "conflict"]]);
        wrapper.unmount();
    });

    it("子视图抛错时收敛成带 token 的 view-error，不重复渲染失败实例", async () => {
        const built = harness();
        const registry = createEditorRegistry([{
            id: "code", titleKey: "code", iconClass: "", supports: () => true,
            render: () => {
                throw new Error("替身视图渲染失败");
            },
        }]);
        if (!registry.ok) throw new Error(registry.reason);
        const wrapper = mount(EditorViewHost, {
            props: {document, editorId: "code", registry: registry.value, commitChange: () => ({status: "stale"})},
        });
        await nextTick();
        const emitted = wrapper.emitted("view-error");
        expect(emitted).toHaveLength(1);
        expect(emitted![0]![0]).toEqual(target);
        expect(emitted![0]![1]).toMatch(uuid);
        expect(emitted![0]![2]).toBe("替身视图渲染失败");
        expect(wrapper.find("textarea").exists()).toBe(false);
        wrapper.unmount();
    });
});
