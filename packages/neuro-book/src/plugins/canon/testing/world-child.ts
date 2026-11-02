/**
 * 两进程测试的子进程（docs/specs/canon/project.md 输出 8、17、22，场景 4）：在一个项目目录上用产品的世界宿主（真实的
 * `holdLock`、`./node` 存储与目录监视）打开世界，按标准输入一行一条 JSON 命令操作，结果与世界的事件一行一条 JSON
 * 写到标准输出。只由测试启动。
 *
 * 命令：`{id, op: "publish", request}`、`{id, op: "status"}`、`{id, op: "object", ref}`、`{id, op: "hold-lock"}`
 * （另取一把世界日志的锁、一直不放，用来造“锁被占着”与“持锁的进程崩溃”）、`{id, op: "stop"}`。
 */

import {join} from "node:path";

import type {ObjectRef, WriteRequest} from "@notnotype/nb-canon";

import {holdLock} from "nbook/backend/locked-replace";

import {createWorldHost, WORLD_LOCK} from "../backend/world-host";

type Command =
    | {readonly id: number; readonly op: "publish"; readonly request: WriteRequest}
    | {readonly id: number; readonly op: "status"}
    | {readonly id: number; readonly op: "object"; readonly ref: ObjectRef}
    | {readonly id: number; readonly op: "hold-lock"}
    | {readonly id: number; readonly op: "stop"};

const root = process.argv[2];
if (root === undefined) throw new Error("用法：world-child.ts <项目目录>");

const out = (value: unknown): void => void process.stdout.write(`${JSON.stringify(value)}\n`);
const host = createWorldHost(root, (input) => void process.stderr.write(`${JSON.stringify({event: input.event, message: input.message})}\n`));
const service = await host.ready();
if ("code" in service) {
    out({ready: false, code: service.code});
    process.exit(1);
}
service.subscribe((event) => out({event}));
out({ready: true, version: service.status().version});

for await (const line of console) {
    if (line.trim() === "") continue;
    const command = JSON.parse(line) as Command;
    switch (command.op) {
        case "publish": {
            const result = await service.publish(command.request);
            out({id: command.id, result: result.ok ? {ok: true, version: result.revision.version, ids: result.ids} : result});
            break;
        }
        case "status":
            out({id: command.id, result: service.status()});
            break;
        case "object":
            out({id: command.id, result: service.world.object(command.ref) ?? null});
            break;
        case "hold-lock": {
            const held = await holdLock(join(root, ".nbook", "locks", WORLD_LOCK), () => undefined);
            out({id: command.id, result: held.ok});
            break;
        }
        case "stop":
            await host.stop();
            out({id: command.id, result: true});
            process.exit(0);
    }
}
