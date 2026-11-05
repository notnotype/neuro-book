/**
 * 测试用的世界服务：真实的分段日志（`nodeFiles`）放在调用方给的临时根里，正文由一张表给出，测试改表以后像宿主一样
 * 调 `textChanged`。时钟固定在 0。
 */

import {createHash} from "node:crypto";
import {join} from "node:path";

import type {ComponentRegistry, MarkRegistry} from "../../src/index";
import {nodeFiles, WorldService, type ServicePorts} from "../../src/node/index";
import {memoryLock} from "./faulty-files";

export async function openTestService(root: string, input: {readonly texts: ReadonlyMap<string, string>; readonly chapters: readonly string[]; readonly registry: ComponentRegistry; readonly marks?: MarkRegistry}): Promise<WorldService> {
    const ports: ServicePorts = {
        files: nodeFiles,
        lock: memoryLock(),
        logDir: join(root, ".nbook", "world", "log"),
        sideDir: join(root, ".nbook", "world"),
        cachePath: join(root, ".nbook", "cache", "reductions.jsonl"),
        chapterText: (chapter) => input.texts.get(chapter),
        digest: (text) => createHash("sha256").update(text).digest("hex"),
        clock: () => 0,
        now: () => new Date(0).toISOString(),
    };
    const service = await WorldService.open(ports, {chapters: input.chapters, registry: input.registry, ...(input.marks === undefined ? {} : {marks: input.marks})});
    if ("code" in service) throw new Error(service.code);
    return service;
}
