/**
 * 资源管理器控制器的测试场地：真实内核实例与真实目录（`files/testing/scene.ts`），窗口链路包上观察器（`tap.ts`），控制器
 * 经窗口里的文件客户端工作。变化的合并用场地的手动时钟推进。只由测试使用。
 */

import {lstat, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import type {DocumentCoordinator} from "nbook/plugins/editor/shared/contracts";
import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import type {FilesService} from "nbook/plugins/files/shared/contracts";
import {files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Layout, Probe, Scene} from "nbook/plugins/files/testing/scene";
import {createLinkTap} from "nbook/plugins/files/testing/tap";
import type {LinkTap} from "nbook/plugins/files/testing/tap";

import {createExplorerController} from "../web/controller";
import type {ExplorerController} from "../web/controller";
import type {EntryRow} from "../web/tree/rows";

export interface ExplorerWorld {
    readonly scene: Scene;
    readonly tap: LinkTap;
    readonly controller: ExplorerController;
}

export interface WorldOptions {
    /** 给控制器接上编辑器的文档协调（用同一个窗口的文件客户端建）；不给时与编辑器没有加载一样。 */
    readonly documents?: (files: FilesService) => DocumentCoordinator;
}

export interface ExplorerWorlds {
    /** 写好项目目录（与可选的用户资产根）、起场地与控制器，等 `ready` 里的行都列出。 */
    world(layout: Layout, expanded: ReadonlyArray<string>, ready: ReadonlyArray<string>, user?: Layout, options?: WorldOptions): Promise<ExplorerWorld>;
    /** 在某个窗口（例如 `extraWindow` 起的第二个窗口）上再建一个控制器。 */
    controller(window: Probe, expanded: ReadonlyArray<string>): ExplorerController;
    /** 释放控制器、关场地、删目录；`beforeRemove` 在删目录之前（例如恢复权限）。 */
    close(beforeRemove?: (scene: Scene) => Promise<void>): Promise<void>;
}

export function explorerWorlds(root: () => string): ExplorerWorlds {
    let counter = 0;
    const scenes: Scene[] = [];
    const controllers: ExplorerController[] = [];
    const controllerOf = (window: Probe, expanded: ReadonlyArray<string>, options: WorldOptions = {}): ExplorerController => {
        const client = files(window);
        const documents = options.documents?.(client);
        const controller = createExplorerController({
            files: client,
            ...(documents === undefined ? {} : {documents}),
            commands: createCommandRegistry({contextKeys: contextTable({}), report: (error) => {
                throw error;
            }}),
            bound: true,
            expanded,
            report: (error) => {
                throw error;
            },
        });
        controllers.push(controller);
        return controller;
    };
    return {
        world: async (layout, expanded, ready, user = {}, options = {}) => {
            counter += 1;
            const tap = createLinkTap();
            const scene = await filesScene(join(root(), `world-${String(counter)}`), {project: layout, user}, {wrapLink: tap.wrap});
            scenes.push(scene);
            const controller = controllerOf(scene.window, expanded, options);
            const at = {scene, tap, controller};
            await until(at, "目录列出", () => ready.every((id) => row(controller, id) !== undefined));
            return at;
        },
        controller: controllerOf,
        close: async (beforeRemove) => {
            for (const controller of controllers.splice(0)) controller.dispose();
            const results = [];
            for (const created of scenes.splice(0)) {
                results.push(...(await created.world.close()));
                await beforeRemove?.(created);
                await rm(created.root, {recursive: true, force: true});
            }
            const unclosed = results.filter((result) => result.status !== "closed");
            if (unclosed.length > 0) throw new Error(`场地没有正常关闭：${JSON.stringify(unclosed)}`);
        },
    };
}

export const row = (controller: ExplorerController, id: string) => controller.rows.value.find((candidate) => candidate.id === id);

export function entry(controller: ExplorerController, id: string): EntryRow {
    const found = row(controller, id);
    if (found?.kind !== "entry") throw new Error(`没有资源行 ${id}`);
    return found;
}

/** 等条件成立，每轮推进一次变化的合并时钟。 */
export async function until(at: {readonly scene: Scene}, description: string, check: () => boolean): Promise<void> {
    await waitUntil(description, () => {
        at.scene.world.clock.advance(BATCH_DELAY_MS);
        return check();
    });
}

/** 选中这些行（第一项单选，其余 Ctrl 加选）：修饰点击不打开、不展开。 */
export function select(controller: ExplorerController, first: string, ...rest: string[]): void {
    controller.contextSelect(first);
    if (!controller.selection.value.selected.includes(first) || controller.selection.value.selected.length !== 1) controller.click(first, {toggle: false, range: false}, "row");
    for (const id of rest) controller.click(id, {toggle: true, range: false}, "row");
}

export const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);

let barriers = 0;

/**
 * “期间没有写入”的观察窗口终点（t70 计划的验收映射）：动作结算之后，在项目根外部写一个屏障文件，等它的变化经同一个
 * 窗口的订阅到达。之后再断言窗口链路上记下的写请求：屏障之前发出的请求都已经记下，字节相同的写入也看得到。
 */
export async function barrier(at: {readonly scene: Scene}, scheme: "project" | "user" = "project"): Promise<void> {
    barriers += 1;
    const name = `barrier-${String(barriers)}.md`;
    let ready = false;
    let seen = false;
    // 项目已经结束的用例用用户资产根：那条订阅还在，同一个窗口链路照样把它送到。
    const release = files(at.scene.window).watch(scheme, (message) => {
        if (message.kind === "ready") ready = true;
        if (message.kind === "batch" && message.events.some((event) => event.path === name)) seen = true;
    });
    try {
        // 断线重连后订阅要重新建立：建立之前的变化只以 resync 补报，屏障要等订阅就绪再写。
        await until(at, "屏障的订阅就绪", () => ready);
        await writeFile(join(scheme === "project" ? at.scene.project : at.scene.user, name), "B");
        await until(at, `屏障 ${name} 的事件`, () => seen);
    } finally {
        release();
    }
}
