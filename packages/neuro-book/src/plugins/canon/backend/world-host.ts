/**
 * 项目实例里的世界：把 nb-canon 的 `WorldService` 要的外部能力接到这个项目上，并在后台打开它
 * （docs/specs/canon/project.md 输出 1、9、13、17、21、22、23）。
 *
 * - 打开在后台进行，入口激活不等它（世界打开最长 2 秒，不能推迟项目实例就绪）；方法经 `ready()` 等打开完成。
 *   打开时锁一直被占（`world-locked`）不缓存：下一次调用再试。
 * - 日志在 `.nbook/world/log/`，锁在 `.nbook/locks/`，都由这里直接读写，不经 nbook.files（输出 13）；目录在打开时建好，
 *   监视要求目录存在（输出 21 只要求第一次写入前建好）。
 * - 监视只是提示：日志目录有变化就让服务持锁读进别的进程写的行（输出 17）；项目根下的活页夹目录或其中的清单有变化
 *   就重读清单、交出新章序（输出 9、23）。几个变化在 50 毫秒内合并成一次。
 * - Component 登记的变化（插件启停）在同一个微任务里合并，换上新登记整本重算一次。
 */

import {createHash} from "node:crypto";
import {watch} from "node:fs";
import type {FSWatcher} from "node:fs";
import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import {buildRegistry} from "@notnotype/nb-canon";
import type {ComponentDeclaration} from "@notnotype/nb-canon";
import {nodeFiles, WorldService} from "@notnotype/nb-canon/node";
import type {LogLock} from "@notnotype/nb-canon/node";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";

import {holdLock} from "nbook/backend/locked-replace";

import {descriptor} from "../plugin";
import {BINDER_DIR, chapterOfFile, chapterText, readBinder} from "./binder";

const SETTLE_MS = 50;
/** 世界日志的跨进程锁在 `.nbook/locks/` 下的名字。 */
export const WORLD_LOCK = "world.lock";

export interface WorldHost {
    /** 打开完成的世界服务；锁一直被占时为 `world-locked`，入口已停止时为 `stopping`。 */
    ready(): Promise<WorldService | {readonly code: "world-locked" | "stopping"}>;
    /** 登记的 Component 类型变了（贡献点接收者调用）。 */
    setComponents(declarations: readonly ComponentDeclaration[]): void;
    stop(): Promise<void>;
}

/** `report` 写一条诊断（入口传诊断服务的 `record`）。 */
export function createWorldHost(root: string, report: (input: DiagnosticInput) => void): WorldHost {
    const nbook = join(root, ".nbook");
    const logDir = join(nbook, "world", "log");
    const locks = join(nbook, "locks");
    const record = (level: "info" | "warn" | "error", event: string, message: string, error?: unknown, data?: unknown): void => {
        report({level, event, message, ...(error === undefined ? {} : {error}), ...(data === undefined ? {} : {data}), source: {plugin: descriptor.id}});
    };

    // 与项目里别的跨进程写入同一把锁的等法（输出 22）；锁目录本身拿不到（权限等）也按拿不到锁处理，原因记诊断。
    const lock: LogLock = {
        acquire: async () => {
            const held = await holdLock(join(locks, WORLD_LOCK), (event, error) => record("warn", `canon.${event}`, "世界日志的锁出了问题", error));
            if (held.ok) return {release: () => held.lock.release()};
            if (held.reason === "failed") record("warn", "canon.lock.failed", `取不到世界日志的锁：${held.detail}`);
            return "locked";
        },
    };

    let components: readonly ComponentDeclaration[] = [];
    let service: WorldService | null = null;
    let opening: Promise<WorldService | {readonly code: "world-locked" | "stopping"}> | null = null;
    let stopped = false;
    const watchers: FSWatcher[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();

    /** 合并 50 毫秒内的变化；上一次还没做完时，做完再补一次。 */
    const settled = (run: (current: WorldService) => Promise<unknown>) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        let running: Promise<unknown> | null = null;
        let again = false;
        const fire = () => {
            timer = null;
            const current = service;
            if (current === null || stopped) return;
            if (running !== null) {
                again = true;
                return;
            }
            running = run(current).catch((error: unknown) => record("warn", "canon.watch.failed", "处理目录变化时出错", error)).finally(() => {
                running = null;
                if (again) {
                    again = false;
                    schedule();
                }
            });
        };
        const schedule = () => {
            if (timer !== null || stopped) return;
            timer = setTimeout(() => {
                if (timer !== null) timers.delete(timer);
                fire();
            }, SETTLE_MS);
            timers.add(timer);
        };
        return schedule;
    };

    const reloadBinder = settled(async (current) => {
        const read = await readBinder(root);
        if (!read.ok) record("warn", "canon.binder.invalid", `活页夹清单坏了，保持原来的章序：${read.detail}`);
        await current.setChapters(read.ok ? read.chapters : "invalid");
    });
    const absorb = settled((current) => current.externalChanged());

    // 章节文件变了：通知世界服务重读那一章的正文（canon.project 输出 25）。文件名认不出章（或平台不给文件名）时重读全部。
    const changedTexts = new Set<string>();
    let allTextsChanged = false;
    const flushTexts = settled(async (current) => {
        const chapters = [...changedTexts];
        const all = allTextsChanged;
        changedTexts.clear();
        allTextsChanged = false;
        if (all) current.textChanged();
        else for (const chapter of chapters) current.textChanged(chapter);
    });
    const onBinderChange = (name: string | null) => {
        reloadBinder();
        if (name === null) allTextsChanged = true;
        else {
            const chapter = chapterOfFile(name);
            if (chapter === null) return;
            changedTexts.add(chapter);
        }
        flushTexts();
    };

    const watchDir = (path: string, onChange: (name: string | null) => void): FSWatcher | null => {
        try {
            const watcher = watch(path, {persistent: false}, (_event, name) => onChange(name));
            watcher.on("error", (error) => record("warn", "canon.watch.error", `监视 ${path} 出错`, error));
            watchers.push(watcher);
            return watcher;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") record("warn", "canon.watch.error", `无法监视 ${path}`, error);
            return null;
        }
    };

    // 活页夹目录可能还不存在、也可能被删掉重建：监视项目根，看到它出现就（重新）监视它。
    let binderWatcher: FSWatcher | null = null;
    const watchBinder = () => {
        binderWatcher?.close();
        binderWatcher = watchDir(join(root, BINDER_DIR), onBinderChange);
    };

    const open = async (): Promise<WorldService | {readonly code: "world-locked" | "stopping"}> => {
        const began = performance.now();
        await mkdir(logDir, {recursive: true});
        await mkdir(locks, {recursive: true});
        const binder = await readBinder(root);
        if (!binder.ok) record("warn", "canon.binder.invalid", `活页夹清单坏了，按日志里记下的章序打开：${binder.detail}`);
        const opened = await WorldService.open(
            {
                files: nodeFiles,
                lock,
                logDir,
                sideDir: join(nbook, "world"),
                cachePath: join(nbook, "cache", "reductions.jsonl"),
                chapterText: (chapter) => chapterText(root, chapter),
                digest: (text) => createHash("sha256").update(text).digest("hex"),
                clock: () => Date.now(),
                now: () => new Date().toISOString(),
                // 独占到期的定时不拖住进程退出。
                timer: {
                    set: (ms, run) => {
                        const handle = setTimeout(run, ms);
                        handle.unref?.();
                        return handle;
                    },
                    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
                },
            },
            {chapters: binder.ok ? binder.chapters : "invalid", registry: buildRegistry(components)},
        );
        if ("code" in opened) {
            record("warn", "canon.open.locked", "打开世界时世界日志的锁一直被占着，下一次调用再试");
            return opened;
        }
        if (stopped) {
            await opened.stop();
            return {code: "stopping"};
        }
        service = opened;
        const status = opened.status();
        // 打开的耗时与规模（Spec project 输出 14 的“打开到可以读”；measure-project.ts 等这一条再量常驻内存）。
        record("info", "canon.world.opened", "世界已打开", undefined, {durationMs: Math.round(performance.now() - began), version: status.version, entries: opened.world.data.entries.size});
        if (status.state === "read-only") record("error", "canon.open.read-only", `世界只读：${status.reason ?? ""}`, undefined, {diagnostics: status.diagnostics});
        watchDir(logDir, () => absorb());
        watchDir(root, (name) => {
            if (name === BINDER_DIR) {
                watchBinder();
                reloadBinder();
            }
        });
        watchBinder();
        return opened;
    };

    const ready = (): Promise<WorldService | {readonly code: "world-locked" | "stopping"}> => {
        if (stopped) return Promise.resolve({code: "stopping"});
        if (opening === null) {
            opening = open().then((result) => {
                if ("code" in result) opening = null;
                return result;
            });
        }
        return opening;
    };

    let registryQueued = false;
    return {
        ready,
        setComponents: (declarations) => {
            components = declarations;
            if (registryQueued) return;
            registryQueued = true;
            queueMicrotask(() => {
                registryQueued = false;
                service?.setRegistry(buildRegistry(components));
            });
        },
        stop: async () => {
            stopped = true;
            for (const timer of timers) clearTimeout(timer);
            timers.clear();
            for (const watcher of watchers) watcher.close();
            const pending = opening;
            if (service !== null) await service.stop();
            else if (pending !== null) await pending;
        },
    };
}
