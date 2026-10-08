/**
 * `partition.test.ts` 起的子进程：另一个进程打开同一个分区库。按行与测试对话（stdout 一行一个事件，stdin
 * 一行一个指令），不按时间等待。
 *
 * - `race <库> <owner>`：打开分区、登记描述后打印 `ready`；收到 `go` 打印 `attempting`，以 `expect: null` 保存一次，
 *   打印结果 JSON 后退出。
 * - `hold <库>`：直接用 SQLite 取写锁（`BEGIN IMMEDIATE`）后打印 `locked`；收到 `release` 回滚、打印 `released` 后退出。
 */

import {Database} from "bun:sqlite";

import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";

import {createPartition} from "../partition";

const raceRecord = defineRecord({key: "race", scope: "user", locality: "shared", version: 1, schema: Type.Object({pid: Type.Integer()}, {additionalProperties: false})});

async function* lines(): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of Bun.stdin.stream()) {
        buffer += decoder.decode(chunk, {stream: true});
        let index = buffer.indexOf("\n");
        while (index >= 0) {
            yield buffer.slice(0, index);
            buffer = buffer.slice(index + 1);
            index = buffer.indexOf("\n");
        }
    }
}

async function main(input: AsyncGenerator<string>): Promise<void> {
    const [mode, path, owner] = process.argv.slice(2);
    if (mode === "race" && path !== undefined && owner !== undefined) {
        const partition = createPartition({path});
        const registered = partition.register(owner, raceRecord.descriptor);
        if (!registered.ok) throw new Error(`登记失败：${registered.code}`);
        console.log("ready");
        if ((await input.next()).value !== "go") return;
        console.log("attempting");
        const result = partition.write({owner, key: raceRecord.key, resource: "", client: ""}, raceRecord.descriptor, {kind: "save", value: {pid: process.pid}, expect: null});
        console.log(JSON.stringify(result));
        partition.close();
        return;
    }
    if (mode === "hold" && path !== undefined) {
        const db = new Database(path);
        db.run("BEGIN IMMEDIATE");
        console.log("locked");
        await input.next();
        db.run("ROLLBACK");
        db.close();
        console.log("released");
        return;
    }
    throw new Error(`用法：race <库> <owner> | hold <库>，收到 ${process.argv.slice(2).join(" ")}`);
}

const input = lines();
try {
    await main(input);
} finally {
    // 关掉标准输入的读取，进程在测试还没关它的那一端时也能退出。
    await input.return(undefined);
}
