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
 * - 登记的变化（插件启停）在同一个微任务里合并：Component 类型变了整本重算一次，标注种类与诊断变了只换登记。
 * - 别的插件登记的诊断计算记在这里：世界还没打开时先记下，打开后接上（model.md “诊断的计算”）。
 */

import {createHash} from "node:crypto";
import {watch} from "node:fs";
import type {FSWatcher} from "node:fs";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {buildDiagnosticRegistry, buildMarkRegistry, buildRegistry} from "@notnotype/nb-canon";
import type {ComponentDeclaration, DiagnosticDeclaration, MarkDeclaration, PluginContribution} from "@notnotype/nb-canon";
import {nodeFiles, WorldService} from "@notnotype/nb-canon/node";
import type {Calendar} from "@notnotype/nb-time";
import type {DiagnosticCompute, LogLock} from "@notnotype/nb-canon/node";
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
    /** 登记的标注种类与诊断变了（贡献点接收者调用，带声明它的插件 id）。 */
    setMarks(contributions: readonly PluginContribution<MarkDeclaration>[]): void;
    setDiagnostics(contributions: readonly PluginContribution<DiagnosticDeclaration>[]): void;
    /** 一个插件登记它的诊断计算；返回的函数撤销这次登记（调用方的入口停止时）。 */
    registerDiagnostics(plugin: string, registration: {readonly compute: Readonly<Record<string, DiagnosticCompute>>; readonly dataVersion: string}): () => void;
    reportDataVersion(plugin: string, dataVersion: string): void;
    /** 作品设置里的历法与模糊词表变了（canon.time 输出 4、16）：交给世界服务；合法的历法记成最近一次合法的，存进 `.nbook`。 */
    setTime(raw: {readonly calendar: unknown; readonly fuzzy: unknown}): void;
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
    let marks: readonly PluginContribution<MarkDeclaration>[] = [];
    let diagnostics: readonly PluginContribution<DiagnosticDeclaration>[] = [];
    /** 作品设置里的历法与词表（原样）；打开前送来的先记下，打开后交给服务。 */
    let timeSettings: {readonly calendar: unknown; readonly fuzzy: unknown} | null = null;
    /**
     * 最近一次合法的历法存在这里（canon.time 输出 16）：重启与别的进程里，设置不合法时照样用它。打开以后第一次交设置时读一次，
     * 之后由宿主自己记着；设置里清空历法时删掉（不填时用公历）。
     */
    const calendarFile = join(nbook, "world", "calendar.json");
    let remembered: Calendar | undefined;
    let rememberedRead = false;
    let calendarWrites = 0;
    const applyOnce = async (target: WorldService) => {
        if (timeSettings === null) return;
        const sent = timeSettings;
        if (!rememberedRead) {
            rememberedRead = true;
            try {
                remembered = JSON.parse(await readFile(calendarFile, "utf8")) as Calendar;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") record("warn", "canon.time.calendar-file", "读不了存下的历法，当作没有", error);
            }
        }
        const calendar = sent.calendar ?? undefined;
        const result = await target.setTime({calendar, fuzzy: sent.fuzzy ?? undefined, ...(remembered === undefined ? {} : {previous: remembered})});
        if (calendar === undefined) {
            remembered = undefined;
            try {
                await rm(calendarFile, {force: true});
            } catch (error) {
                record("warn", "canon.time.calendar-file", "删不掉存下的历法", error);
            }
            return;
        }
        if (!result.valid) return;
        remembered = result.calendar;
        // 先写临时文件再改名：写到一半中断时留下的是旧的那份。临时文件名带序号，前后两次不共用。
        const temporary = `${calendarFile}.${String(process.pid)}.${String(++calendarWrites)}.tmp`;
        try {
            await writeFile(temporary, JSON.stringify(result.calendar));
            await rename(temporary, calendarFile);
        } catch (error) {
            record("warn", "canon.time.calendar-file", "存不下最近一次合法的历法", error);
        }
    };
    /**
     * 把作品设置交给服务。几次设置变化接连到来时排成一条链、每次执行时才取当前的设置：交给服务的先后与到来的先后相同，最后交的是
     * 最新的一份（不排队时，读文件快慢不同会让旧的一份后交）。
     */
    let timeChain: Promise<void> = Promise.resolve();
    const applyTime = (target: WorldService): Promise<void> => {
        timeChain = timeChain.then(() => applyOnce(target), () => applyOnce(target));
        return timeChain;
    };
    /** 各插件登记的诊断计算，连同接到世界服务上以后的撤销函数（世界还没打开时为 null）。 */
    const computers = new Map<string, {registration: {readonly compute: Readonly<Record<string, DiagnosticCompute>>; readonly dataVersion: string}; detach: (() => void) | null}>();
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
        // 打开要等日志重放（规模上一两秒）；这期间贡献点送来的登记变化排进的微任务看不到 `service`，打开后按这份比对补上。
        const usedAtOpen = {components, marks, diagnostics};
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
            {chapters: binder.ok ? binder.chapters : "invalid", registry: buildRegistry(components), marks: buildMarkRegistry(marks), diagnostics: buildDiagnosticRegistry(diagnostics)},
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
        const missed = {
            ...(components !== usedAtOpen.components ? {registry: buildRegistry(components)} : {}),
            ...(marks !== usedAtOpen.marks ? {marks: buildMarkRegistry(marks)} : {}),
            ...(diagnostics !== usedAtOpen.diagnostics ? {diagnostics: buildDiagnosticRegistry(diagnostics)} : {}),
        };
        if (Object.keys(missed).length > 0) opened.setRegistries(missed);
        // 打开前与打开期间送来的作品设置：打开后交给服务（交的是最新的那一份）。
        await applyTime(opened);
        for (const [plugin, item] of computers) item.detach = opened.registerDiagnostics(plugin, item.registration);
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

    // 同一个微任务里的几次变化合并成一次；只换变了的那几张登记（Component 的变了才整本重算）。
    const dirty = new Set<"components" | "marks" | "diagnostics">();
    const queueRegistries = (which: "components" | "marks" | "diagnostics") => {
        const first = dirty.size === 0;
        dirty.add(which);
        if (!first) return;
        queueMicrotask(() => {
            const changed = new Set(dirty);
            dirty.clear();
            service?.setRegistries({
                ...(changed.has("components") ? {registry: buildRegistry(components)} : {}),
                ...(changed.has("marks") ? {marks: buildMarkRegistry(marks)} : {}),
                ...(changed.has("diagnostics") ? {diagnostics: buildDiagnosticRegistry(diagnostics)} : {}),
            });
        });
    };
    return {
        ready,
        setComponents: (declarations) => {
            components = declarations;
            queueRegistries("components");
        },
        setMarks: (contributions) => {
            marks = contributions;
            queueRegistries("marks");
        },
        setDiagnostics: (contributions) => {
            diagnostics = contributions;
            queueRegistries("diagnostics");
        },
        registerDiagnostics: (plugin, registration) => {
            computers.get(plugin)?.detach?.();
            const item = {registration, detach: service === null ? null : service.registerDiagnostics(plugin, registration)};
            computers.set(plugin, item);
            return () => {
                if (computers.get(plugin) !== item) return;
                computers.delete(plugin);
                item.detach?.();
            };
        },
        setTime: (raw) => {
            timeSettings = raw;
            if (service !== null) void applyTime(service);
        },
        reportDataVersion: (plugin, dataVersion) => {
            const item = computers.get(plugin);
            if (item === undefined) return;
            item.registration = {...item.registration, dataVersion};
            service?.reportDataVersion(plugin, dataVersion);
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
