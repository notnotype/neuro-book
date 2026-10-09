/**
 * 资源管理器控制器的测试场地：真实内核实例与真实目录（`files/testing/scene.ts`），窗口链路包上观察器（`tap.ts`），控制器
 * 经窗口里的文件客户端工作。变化的合并用场地的手动时钟推进。只由测试使用。
 */

import {lstat, rm} from "node:fs/promises";
import {join} from "node:path";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
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

export interface ExplorerWorlds {
    /** 写好项目目录（与可选的用户资产根）、起场地与控制器，等 `ready` 里的行都列出。 */
    world(layout: Layout, expanded: ReadonlyArray<string>, ready: ReadonlyArray<string>, user?: Layout): Promise<ExplorerWorld>;
    /** 在某个窗口（例如 `extraWindow` 起的第二个窗口）上再建一个控制器。 */
    controller(window: Probe, expanded: ReadonlyArray<string>): ExplorerController;
    /** 释放控制器、关场地、删目录；`beforeRemove` 在删目录之前（例如恢复权限）。 */
    close(beforeRemove?: (scene: Scene) => Promise<void>): Promise<void>;
}

export function explorerWorlds(root: () => string): ExplorerWorlds {
    let counter = 0;
    const scenes: Scene[] = [];
    const controllers: ExplorerController[] = [];
    const controllerOf = (window: Probe, expanded: ReadonlyArray<string>): ExplorerController => {
        const controller = createExplorerController({
            files: files(window),
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
        world: async (layout, expanded, ready, user = {}) => {
            counter += 1;
            const tap = createLinkTap();
            const scene = await filesScene(join(root(), `world-${String(counter)}`), {project: layout, user}, {wrapLink: tap.wrap});
            scenes.push(scene);
            const controller = controllerOf(scene.window, expanded);
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
