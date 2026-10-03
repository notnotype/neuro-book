import {describe, expect, it, vi} from "vitest";
import {Type} from "typebox";
import {createCommandRegistry, type CommandRegistry} from "nbook/app/utils/workbench/commands";
import {SHELL_PANEL_DEFAULTS, type WorkbenchPanelState} from "nbook/app/utils/workbench/panel-state";
import {
    PANEL_ACTION_KEYS,
    SHELL_CONTAINER_COMMAND_IDS,
    SHELL_FILES_REFRESH_COMMAND,
    SHELL_PANEL_COMMAND_IDS,
    SHELL_VIEW_COMMAND_IDS,
    VIEW_ACTION_ARGS_SCHEMA,
    evaluatePanelAction,
    executePanelActionItem,
    panelActionItemId,
    registerViewTitleCommands,
    registerWorkbenchShellCommands,
    resolvePanelActionItem,
    resolvePanelTitleActions,
    type ShellCommandOutcome,
    type WorkbenchShellCommandPort,
    type ViewTitleCommandContribution,
} from "nbook/app/utils/workbench/workbench-shell-commands";

/**
 * 外壳命令目录：Panel 框架动作的语义、菜单求值，以及 View 标题命令的路由。
 *
 * 断言的判据是**调用方看得见的结果**：落盘回执怎么转成命令结果、同值有没有写、菜单项何时禁用，
 * 而不是内部调了哪个分支。
 */

function registryOf(): CommandRegistry {
    return createCommandRegistry({
        context: () => ({}),
        agentMode: () => "normal",
        development: false,
        report: () => undefined,
    });
}

type PortSpy = WorkbenchShellCommandPort & {
    patches: Partial<WorkbenchPanelState>[];
    maximized: boolean[];
    moves: unknown[];
    containerMoves: unknown[];
    merges: unknown[];
    reopened: string[];
    selections: {partId: string; containerId: string}[];
    restores: string[];
    visibilities: {partId: string; hidden?: boolean; dragCollapsed?: boolean}[];
    reveals: string[];
};

function portOf(options: {
    panel?: Partial<WorkbenchPanelState>;
    mode?: "split" | "compact";
    ready?: boolean;
    outcome?: ShellCommandOutcome;
    moveOutcome?: ShellCommandOutcome;
} = {}): PortSpy {
    let state: WorkbenchPanelState = {...SHELL_PANEL_DEFAULTS, maximized: false, ...options.panel};
    const patches: Partial<WorkbenchPanelState>[] = [];
    const maximized: boolean[] = [];
    const moves: unknown[] = [];
    const containerMoves: unknown[] = [];
    const merges: unknown[] = [];
    const reopened: string[] = [];
    const selections: {partId: string; containerId: string}[] = [];
    const restores: string[] = [];
    const visibilities: {partId: string; hidden?: boolean; dragCollapsed?: boolean}[] = [];
    const reveals: string[] = [];
    const outcome = options.outcome ?? {status: "saved", diagnosis: ""};
    return {
        patches,
        maximized,
        moves,
        containerMoves,
        merges,
        reopened,
        selections,
        restores,
        visibilities,
        reveals,
        state: () => ({panel: state, mode: options.mode ?? "split", ready: options.ready ?? true}),
        setPanelState: async (patch) => {
            patches.push(patch);
            Object.assign(state, patch);
            return outcome;
        },
        setMaximized: (value) => {
            maximized.push(value);
            state = {...state, maximized: value};
        },
        moveView: async (request) => {
            moves.push(request);
            return options.moveOutcome ?? {status: "saved", diagnosis: ""};
        },
        moveContainer: async (request) => {
            containerMoves.push(request);
            return options.moveOutcome ?? {status: "saved", diagnosis: ""};
        },
        mergeContainer: async (request) => {
            merges.push(request);
            return options.moveOutcome ?? {status: "saved", diagnosis: ""};
        },
        reopenContainer: async (containerId) => {
            reopened.push(containerId);
            return options.moveOutcome ?? {status: "saved", diagnosis: ""};
        },
        selectContainer: async (partId, containerId) => {
            selections.push({partId, containerId});
            return options.moveOutcome ?? {status: "saved", diagnosis: ""};
        },
        restoreContainerPlacement: async (containerId) => {
            restores.push(`container:${containerId}`);
            return outcome;
        },
        restoreViewPlacement: async (viewId) => {
            restores.push(`view:${viewId}`);
            return outcome;
        },
        setPartVisibility: async (input) => {
            visibilities.push(input);
            return outcome;
        },
        revealView: async (viewId) => {
            reveals.push(viewId);
            return outcome;
        },
    };
}

function boot(port: WorkbenchShellCommandPort): CommandRegistry {
    const registry = registryOf();
    const registered = registerWorkbenchShellCommands(registry, port);
    if (!registered.ok) {
        throw new Error(registered.reason);
    }
    return registry;
}

describe("registerWorkbenchShellCommands", () => {
    it("框架层与容器层命令都注册成写命令、对 agent 永不暴露、没有默认键位", () => {
        const registry = boot(portOf());
        const ids = [...Object.values(SHELL_PANEL_COMMAND_IDS), ...Object.values(SHELL_CONTAINER_COMMAND_IDS)];

        for (const id of ids) {
            const command = registry.getCommand(id);
            expect(command.ok, id).toBe(true);
            if (!command.ok) {
                continue;
            }
            expect(command.value.effect).toBe("write");
            expect(command.value.expose?.agent).toBe("never");
            expect(command.value.defaultKeybinding).toBeUndefined();
        }
        expect(registry.getAllCommands()).toHaveLength(ids.length);
    });

    it("注册结果可幂等释放（再注册一次仍然成功）", async () => {
        const registry = registryOf();
        const first = registerWorkbenchShellCommands(registry, portOf());
        expect(first.ok).toBe(true);
        if (!first.ok) {
            return;
        }
        first.value();
        first.value();
        expect(registry.getCommand(SHELL_PANEL_COMMAND_IDS.setHidden).ok).toBe(false);
        expect(registerWorkbenchShellCommands(registry, portOf()).ok).toBe(true);
    });

    it("位置：同值不写，返回 unchanged", async () => {
        const port = portOf({panel: {position: "bottom"}});
        const registry = boot(port);

        const result = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setPosition, {position: "bottom"});

        expect(result).toEqual({ok: true, value: {status: "unchanged", diagnosis: "面板已经在底部"}});
        expect(port.patches).toEqual([]);
    });

    it("位置：切到侧向位置时同一次补丁清掉 collapsed", async () => {
        const port = portOf({panel: {position: "bottom", collapsed: true}});
        const registry = boot(port);

        const result = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setPosition, {position: "left"});

        expect(result.ok).toBe(true);
        expect(port.patches).toEqual([{position: "left", collapsed: false}]);
    });

    it("pending 是已接纳但未保存：作为成功值返回原诊断，绝不冒充 saved", async () => {
        const port = portOf({outcome: {status: "pending", diagnosis: "Storage 暂不可达，本次调整未确认"}});
        const registry = boot(port);

        const result = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setPosition, {position: "top"});

        expect(result).toEqual({ok: true, value: {status: "pending", diagnosis: "Storage 暂不可达，本次调整未确认"}});
    });

    it("rejected 转成 unavailable，并保留会话给的诊断", async () => {
        const port = portOf({outcome: {status: "rejected", diagnosis: "工具位置记录还没完成首次读取，本次调整没有保存"}});
        const registry = boot(port);

        const result = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setAlignment, {alignment: "left"});

        expect(result).toEqual({ok: false, code: "unavailable", reason: "工具位置记录还没完成首次读取，本次调整没有保存"});
    });

    it("对齐：左右位置不适用，命令被拒且不写", async () => {
        const port = portOf({panel: {position: "left"}});
        const registry = boot(port);

        const result = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setAlignment, {alignment: "center"});

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("unavailable");
            expect(result.reason).toContain("切回底部或顶部");
        }
        expect(port.patches).toEqual([]);
    });

    it("隐藏：清最大化；显示：同一次补丁清 hidden 与 collapsed", async () => {
        const hidden = boot(portOf({panel: {maximized: true}}));
        const hidePort = portOf({panel: {maximized: true}});
        const hiding = boot(hidePort);

        const hideResult = await hiding.executeCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: true});
        expect(hideResult.ok).toBe(true);
        expect(hidePort.maximized).toEqual([false]);
        expect(hidePort.patches).toEqual([{hidden: true}]);

        const showing = await hidden.executeCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: false});
        expect(showing.ok).toBe(true);
        expect(hidden.getAllCommands().length).toBeGreaterThan(0);
    });

    it("显示：hidden 或 collapsed 任一为真才写，两个都清", async () => {
        const port = portOf({panel: {hidden: true, collapsed: true}});
        const registry = boot(port);

        const result = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: false});

        expect(result.ok).toBe(true);
        expect(port.patches).toEqual([{hidden: false, collapsed: false}]);
    });

    it("已经显示且没收起：显示是 no-op，不产生写入", async () => {
        const port = portOf();
        const registry = boot(port);

        const result = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: false});

        expect(result).toEqual({ok: true, value: {status: "unchanged", diagnosis: "面板已经显示"}});
        expect(port.patches).toEqual([]);
    });

    it("收起：先还原最大化再写 collapsed；侧向位置不可用", async () => {
        const port = portOf({panel: {maximized: true}});
        const registry = boot(port);

        const collapsed = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setCollapsed, {collapsed: true});
        expect(collapsed.ok).toBe(true);
        expect(port.maximized).toEqual([false]);
        expect(port.patches).toEqual([{collapsed: true}]);

        const side = portOf({panel: {position: "right"}});
        const sideRegistry = boot(side);
        const rejected = await sideRegistry.executeCommand(SHELL_PANEL_COMMAND_IDS.setCollapsed, {collapsed: true});
        expect(rejected.ok).toBe(false);
        expect(side.patches).toEqual([]);
    });

    it("最大化：只在左右位置或水平居中可用，切换是瞬时状态（不写盘）", async () => {
        const port = portOf();
        const registry = boot(port);

        const result = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.toggleMaximized);
        expect(result).toEqual({ok: true, value: {status: "unchanged", diagnosis: ""}});
        expect(port.maximized).toEqual([true]);
        expect(port.patches).toEqual([]);

        const notCentered = portOf({panel: {position: "bottom", alignment: "left"}});
        const guarded = boot(notCentered);
        const rejected = await guarded.executeCommand(SHELL_PANEL_COMMAND_IDS.toggleMaximized);
        expect(rejected.ok).toBe(false);
        if (!rejected.ok) {
            expect(rejected.reason).toContain("居中");
        }
        expect(notCentered.maximized).toEqual([]);
    });

    it("紧凑呈现：位置 / 对齐 / 最大化不可用，隐藏仍可用", async () => {
        const port = portOf({mode: "compact"});
        const registry = boot(port);

        for (const [id, args] of [
            [SHELL_PANEL_COMMAND_IDS.setPosition, {position: "top"}],
            [SHELL_PANEL_COMMAND_IDS.setAlignment, {alignment: "left"}],
            [SHELL_PANEL_COMMAND_IDS.toggleMaximized, undefined],
        ] as const) {
            const result = await registry.executeCommand(id, args);
            expect(result.ok, id).toBe(false);
        }
        expect(port.patches).toEqual([]);

        const hidden = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: true});
        expect(hidden.ok).toBe(true);
    });

    it("首读门禁：记录没读完时框架命令拒绝执行", async () => {
        const port = portOf({ready: false});
        const registry = boot(port);

        const result = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setPosition, {position: "top"});

        expect(result.ok).toBe(false);
        expect(port.patches).toEqual([]);
    });

    it("参数严格：多余字段与非法枚举都被拒，不落到端口", async () => {
        const port = portOf();
        const registry = boot(port);

        expect((await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setPosition, {position: "middle"})).ok).toBe(false);
        expect((await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.setHidden, {hidden: true, extra: 1})).ok).toBe(false);
        expect(port.patches).toEqual([]);
    });

    it("移动视图：请求原样转交，rejected 转 unavailable", async () => {
        const okPort = portOf();
        const registry = boot(okPort);
        const request = {viewId: "nbook.files", sourceContainerId: "nbook.tools", targetContainerId: "nbook.panel"};

        const moved = await registry.executeCommand(SHELL_PANEL_COMMAND_IDS.moveView, request);
        expect(moved).toEqual({ok: true, value: {status: "saved", diagnosis: ""}});
        expect(okPort.moves).toEqual([request]);

        const rejectedPort = portOf({moveOutcome: {status: "rejected", diagnosis: "来源容器与当前容器不一致，拒绝移动"}});
        const rejectedRegistry = boot(rejectedPort);
        const rejected = await rejectedRegistry.executeCommand(SHELL_PANEL_COMMAND_IDS.moveView, request);
        expect(rejected).toEqual({ok: false, code: "unavailable", reason: "来源容器与当前容器不一致，拒绝移动"});
    });
});

describe("容器层命令", () => {
    it("选择 / 移动 / 恢复 / 显隐 / 揭示都原样转交端口，参数不缺字段", async () => {
        const port = portOf();
        const registry = boot(port);

        const moved = await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.move, {
            containerId: "nbook.tools",
            sourceLocation: "sidebar-left",
            targetLocation: "panel",
        });
        expect(moved).toEqual({ok: true, value: {status: "saved", diagnosis: ""}});
        expect(port.containerMoves).toEqual([{containerId: "nbook.tools", sourceLocation: "sidebar-left", targetLocation: "panel"}]);

        await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.select, {partId: "panel", containerId: "nbook.panel"});
        expect(port.selections).toEqual([{partId: "panel", containerId: "nbook.panel"}]);

        // 整组并入：成员快照与工作面代际原样转交，端口自己再核对一遍。
        const mergeRequest = {
            sourceContainerId: "nbook.tools",
            sourceLocation: "sidebar-left",
            targetContainerId: "nbook.panel",
            targetLocation: "panel",
            sourceViewIds: ["nbook.files", "nbook.outline"],
            contextKey: "project|demo",
        };
        await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.merge, mergeRequest);
        expect(port.merges).toEqual([mergeRequest]);

        await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.reopen, {containerId: "nbook.tools"});
        expect(port.reopened).toEqual(["nbook.tools"]);

        await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.restore, {containerId: "nbook.tools"});
        await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.restoreView, {viewId: "nbook.files"});
        expect(port.restores).toEqual(["container:nbook.tools", "view:nbook.files"]);

        // 两个字段都可缺席（只有拖收起、只有显隐都是合法调用），端口拿到的是原样形状。
        await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.setPartVisibility, {partId: "left", dragCollapsed: true});
        await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.setPartVisibility, {partId: "right", hidden: true});
        expect(port.visibilities).toEqual([
            {partId: "left", dragCollapsed: true},
            {partId: "right", hidden: true},
        ]);

        await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.revealView, {viewId: "nbook.files"});
        expect(port.reveals).toEqual(["nbook.files"]);
    });

    it("首读门禁：记录没读完时容器命令拒绝执行且不落到端口", async () => {
        const port = portOf({ready: false});
        const registry = boot(port);

        for (const [id, args] of [
            [SHELL_CONTAINER_COMMAND_IDS.move, {containerId: "nbook.tools", sourceLocation: "sidebar-left", targetLocation: "panel"}],
            [SHELL_CONTAINER_COMMAND_IDS.merge, {
                sourceContainerId: "nbook.tools",
                sourceLocation: "sidebar-left",
                targetContainerId: "nbook.panel",
                targetLocation: "panel",
                sourceViewIds: ["nbook.files"],
                contextKey: "ctx",
            }],
            [SHELL_CONTAINER_COMMAND_IDS.reopen, {containerId: "nbook.tools"}],
            [SHELL_CONTAINER_COMMAND_IDS.select, {partId: "left", containerId: "nbook.tools"}],
            [SHELL_CONTAINER_COMMAND_IDS.restore, {containerId: "nbook.tools"}],
            [SHELL_CONTAINER_COMMAND_IDS.restoreView, {viewId: "nbook.files"}],
            [SHELL_CONTAINER_COMMAND_IDS.setPartVisibility, {partId: "left", hidden: true}],
            [SHELL_CONTAINER_COMMAND_IDS.revealView, {viewId: "nbook.files"}],
        ] as const) {
            const result = await registry.executeCommand(id, args);
            expect(result.ok, id).toBe(false);
            if (!result.ok) {
                expect(result.code).toBe("unavailable");
                expect(result.reason).toContain("首次读取");
            }
        }
        expect(port.containerMoves).toEqual([]);
        expect(port.merges).toEqual([]);
        expect(port.reopened).toEqual([]);
        expect(port.selections).toEqual([]);
        expect(port.restores).toEqual([]);
        expect(port.visibilities).toEqual([]);
        expect(port.reveals).toEqual([]);
    });

    it("参数严格：非法落位、空字段与多余字段都在命令边界被拒", async () => {
        const port = portOf();
        const registry = boot(port);

        expect((await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.move, {
            containerId: "nbook.tools",
            sourceLocation: "sidebar-left",
            targetLocation: "window",
        })).ok).toBe(false);
        expect((await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.select, {partId: "titlebar", containerId: "nbook.tools"})).ok).toBe(false);
        expect((await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.setPartVisibility, {partId: "left", hidden: true, extra: 1})).ok).toBe(false);
        // 整组并入的成员快照是必填数组；多一个键、少一个 sourceViewIds 都不许通过。
        expect((await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.merge, {
            sourceContainerId: "nbook.tools",
            sourceLocation: "sidebar-left",
            targetContainerId: "nbook.panel",
            targetLocation: "panel",
        })).ok).toBe(false);
        expect((await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.merge, {
            sourceContainerId: "nbook.tools",
            sourceLocation: "sidebar-left",
            targetContainerId: "nbook.panel",
            targetLocation: "panel",
            sourceViewIds: ["nbook.files"],
            contextKey: "ctx",
            extra: 1,
        })).ok).toBe(false);
        expect((await registry.executeCommand(SHELL_CONTAINER_COMMAND_IDS.reopen, {containerId: "nbook.tools", extra: 1})).ok).toBe(false);
        expect(port.containerMoves).toEqual([]);
        expect(port.merges).toEqual([]);
        expect(port.reopened).toEqual([]);
        expect(port.selections).toEqual([]);
        expect(port.visibilities).toEqual([]);
    });
});

describe("覆盖的可用性求值", () => {
    it("同一份判据给菜单与命令：紧凑、非居中、侧向位置", () => {
        const base = {...SHELL_PANEL_DEFAULTS, maximized: false};

        expect(evaluatePanelAction({commandId: SHELL_PANEL_COMMAND_IDS.setPosition, state: base, mode: "compact", ready: true}))
            .toEqual({available: false, reasonKey: PANEL_ACTION_KEYS.reasonCompact, reason: expect.any(String)});
        expect(evaluatePanelAction({
            commandId: SHELL_PANEL_COMMAND_IDS.toggleMaximized,
            state: {...base, alignment: "justify"},
            mode: "split",
            ready: true,
        })).toEqual({available: false, reasonKey: PANEL_ACTION_KEYS.reasonNeedsCenter, reason: expect.any(String)});
        expect(evaluatePanelAction({
            commandId: SHELL_PANEL_COMMAND_IDS.toggleMaximized,
            state: {...base, position: "left", alignment: "justify"},
            mode: "split",
            ready: true,
        })).toEqual({available: true});
    });
});

describe("菜单项 id ⇄ 命令调用", () => {
    it("拼 id 与解 id 是同一份映射", () => {
        expect(resolvePanelActionItem(panelActionItemId(SHELL_PANEL_COMMAND_IDS.setPosition, "left")))
            .toEqual({commandId: SHELL_PANEL_COMMAND_IDS.setPosition, args: {position: "left"}});
        expect(resolvePanelActionItem(panelActionItemId(SHELL_PANEL_COMMAND_IDS.setHidden, true)))
            .toEqual({commandId: SHELL_PANEL_COMMAND_IDS.setHidden, args: {hidden: true}});
        expect(resolvePanelActionItem(panelActionItemId(SHELL_PANEL_COMMAND_IDS.toggleMaximized)))
            .toEqual({commandId: SHELL_PANEL_COMMAND_IDS.toggleMaximized, args: {}});
    });

    it("非法 id 与非法取值都不放行", async () => {
        expect(resolvePanelActionItem("nbook.view.set-panel-position:middle")).toBeNull();
        expect(resolvePanelActionItem("nbook.view.unknown-action")).toBeNull();
        expect(resolvePanelActionItem(`${SHELL_PANEL_COMMAND_IDS.toggleMaximized}:true`)).toBeNull();

        const registry = boot(portOf());
        const result = await executePanelActionItem(registry, "nbook.view.set-panel-position:middle");
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe("unknown-command");
        }
    });

    it("经注册表执行：菜单 id 走的是真实命令", async () => {
        const port = portOf();
        const registry = boot(port);

        const result = await executePanelActionItem(registry, panelActionItemId(SHELL_PANEL_COMMAND_IDS.setPosition, "right"));

        expect(result.ok).toBe(true);
        expect(port.patches).toEqual([{position: "right", collapsed: false}]);
    });
});

describe("resolvePanelTitleActions", () => {
    const titleOf = (key: string): string => key;

    it("空 Panel 也有框架动作：两枚固定按钮 + 完整菜单，位置与对齐是 radio 子菜单", () => {
        const actions = resolvePanelTitleActions({
            state: {...SHELL_PANEL_DEFAULTS, maximized: false},
            mode: "split",
            ready: true,
            titleOf,
        });

        expect(actions.primary.map((item) => item.id)).toEqual([
            panelActionItemId(SHELL_PANEL_COMMAND_IDS.toggleMaximized),
            panelActionItemId(SHELL_PANEL_COMMAND_IDS.setHidden, true),
        ]);
        expect(actions.primary[0]).toMatchObject({icon: "i-lucide-maximize-2", label: PANEL_ACTION_KEYS.maximize});
        expect(actions.primary[1]).toMatchObject({label: PANEL_ACTION_KEYS.hide});

        const position = actions.secondary.find((item) => item.id === SHELL_PANEL_COMMAND_IDS.setPosition);
        expect(position?.children?.map((child) => child.id)).toEqual([
            panelActionItemId(SHELL_PANEL_COMMAND_IDS.setPosition, "bottom"),
            panelActionItemId(SHELL_PANEL_COMMAND_IDS.setPosition, "top"),
            panelActionItemId(SHELL_PANEL_COMMAND_IDS.setPosition, "left"),
            panelActionItemId(SHELL_PANEL_COMMAND_IDS.setPosition, "right"),
        ]);
        expect(position?.children?.[0]).toMatchObject({type: "radio", group: "panel-position", checked: true});
        expect(position?.children?.[2]).toMatchObject({checked: false});
    });

    it("状态变化反映在 label 与 checked 上：最大化后可还原、隐藏后可显示", () => {
        const actions = resolvePanelTitleActions({
            state: {position: "left", alignment: "left", hidden: true, collapsed: false, maximized: true},
            mode: "split",
            ready: true,
            titleOf,
        });

        expect(actions.primary[0]).toMatchObject({label: PANEL_ACTION_KEYS.restore, icon: "i-lucide-minimize-2"});
        expect(actions.primary[1]).toMatchObject({label: PANEL_ACTION_KEYS.show, icon: "i-lucide-eye"});
        const position = actions.secondary.find((item) => item.id === SHELL_PANEL_COMMAND_IDS.setPosition);
        expect(position?.children?.find((child) => child.checked)?.id)
            .toBe(panelActionItemId(SHELL_PANEL_COMMAND_IDS.setPosition, "left"));
        // 左右位置：对齐子菜单与收起项禁用，原因是解析后的文案（不是 key）。
        const alignment = actions.secondary.find((item) => item.id === SHELL_PANEL_COMMAND_IDS.setAlignment);
        expect(alignment).toMatchObject({disabled: true, reason: PANEL_ACTION_KEYS.reasonSideAlignment});
        const collapse = actions.secondary.find((item) => item.id === panelActionItemId(SHELL_PANEL_COMMAND_IDS.setCollapsed, true));
        expect(collapse).toMatchObject({disabled: true, reason: PANEL_ACTION_KEYS.reasonSideCollapse});
    });

    it("不可最大化时禁用并给原因，不从菜单里消失", () => {
        const actions = resolvePanelTitleActions({
            state: {position: "bottom", alignment: "left", hidden: false, collapsed: false, maximized: false},
            mode: "split",
            ready: true,
            titleOf,
        });

        expect(actions.primary[0]).toMatchObject({disabled: true, reason: PANEL_ACTION_KEYS.reasonNeedsCenter});
        expect(actions.primary[0]?.id).toBe(panelActionItemId(SHELL_PANEL_COMMAND_IDS.toggleMaximized));
    });

    it("紧凑呈现：位置 / 对齐 / 最大化禁用，隐藏仍可用", () => {
        const actions = resolvePanelTitleActions({
            state: {...SHELL_PANEL_DEFAULTS, maximized: false},
            mode: "compact",
            ready: true,
            titleOf,
        });

        const position = actions.secondary.find((item) => item.id === SHELL_PANEL_COMMAND_IDS.setPosition);
        const alignment = actions.secondary.find((item) => item.id === SHELL_PANEL_COMMAND_IDS.setAlignment);
        expect(position).toMatchObject({disabled: true, reason: PANEL_ACTION_KEYS.reasonCompact});
        expect(alignment).toMatchObject({disabled: true, reason: PANEL_ACTION_KEYS.reasonCompact});
        expect(actions.primary[0]).toMatchObject({disabled: true, reason: PANEL_ACTION_KEYS.reasonCompact});
        expect(actions.primary[1]?.disabled).toBeUndefined();
    });
});

describe("registerViewTitleCommands", () => {
    it("参数原样交给端口，viewId/generation 一个都不丢", async () => {
        const registry = registryOf();
        const runAction = vi.fn(async () => ({ok: true, value: {rows: 3}} as const));
        const registered = registerViewTitleCommands(registry, [SHELL_FILES_REFRESH_COMMAND], {runAction});
        expect(registered.ok).toBe(true);

        const result = await registry.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: "nbook.files", generation: 7});

        expect(result).toEqual({ok: true, value: {rows: 3}});
        expect(runAction).toHaveBeenCalledWith({viewId: "nbook.files", generation: 7}, "refresh");
    });

    it("句柄的失败原因原样传出（不在命令层重写）", async () => {
        const registry = registryOf();
        registerViewTitleCommands(registry, [SHELL_FILES_REFRESH_COMMAND], {
            runAction: async () => ({ok: false, code: "unavailable", reason: "文件树正在加载"}),
        });

        const result = await registry.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: "nbook.files", generation: 1});

        expect(result).toEqual({ok: false, code: "unavailable", reason: "文件树正在加载"});
    });

    it("参数严格：缺 generation、代际为 0 或多带字段都被拒", async () => {
        const registry = registryOf();
        const runAction = vi.fn(async () => ({ok: true, value: null} as const));
        registerViewTitleCommands(registry, [SHELL_FILES_REFRESH_COMMAND], {runAction});

        expect((await registry.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: "nbook.files"})).ok).toBe(false);
        expect((await registry.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: "nbook.files", generation: 0})).ok).toBe(false);
        expect((await registry.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: "nbook.files", generation: 1, extra: 1})).ok).toBe(false);
        expect(runAction).not.toHaveBeenCalled();
    });

    it("释放后命令消失（第二次注册同一份白名单仍然成功）", async () => {
        const registry = registryOf();
        const port = {runAction: async () => ({ok: true, value: null} as const)};
        const first = registerViewTitleCommands(registry, [SHELL_FILES_REFRESH_COMMAND], port);
        expect(first.ok).toBe(true);
        if (!first.ok) {
            return;
        }
        first.value();
        expect((await registry.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: "nbook.files", generation: 1})).ok).toBe(false);
        expect(registerViewTitleCommands(registry, [SHELL_FILES_REFRESH_COMMAND], port).ok).toBe(true);
    });

    it("白名单描述符的 schema 就是共享的 View 动作参数 schema", () => {
        const contributions: readonly ViewTitleCommandContribution[] = [SHELL_FILES_REFRESH_COMMAND];

        expect(contributions[0]!.command.argsSchema).toBe(VIEW_ACTION_ARGS_SCHEMA);
        expect(Type.Object({}).type).toBe("object");
    });
});
