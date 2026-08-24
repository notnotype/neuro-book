#!/usr/bin/env bun
import {spawn} from "node:child_process";
import {createHash, randomUUID} from "node:crypto";
import {existsSync} from "node:fs";
import {cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {check as checkLock, lock as acquireLock} from "proper-lockfile";
import {resolveAgentAcceptanceRoot} from "@notnotype/neuro-book-test-support/paths";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BUILD_OUTPUT_ROOT = resolve(REPO_ROOT, process.env.NEURO_BOOK_OUTPUT_DIR?.trim() || ".output");
const ACCEPTANCE_ROOT = resolveAgentAcceptanceRoot();
const ACCEPTANCE_POINTER = resolve(ACCEPTANCE_ROOT, "current.json");
const OWNER_FILE = ".nbook-product-acceptance.json";
const LEASE_FILE = ".nbook-product-acceptance-lease";
const ACCEPTANCE_OWNER = "nbook.product-runtime-acceptance";
const ACCEPTANCE_SCHEMA = 1;
const STALE_ACCEPTANCE_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 10_000;

const command = process.argv[2] ?? "stage";

if (command === "stage") {
    await stageProduct();
} else if (command === "start") {
    await runAcceptedCommand("start", process.argv.slice(3));
} else if (command === "create-admin") {
    await runAcceptedCommand("create-admin", process.argv.slice(3));
} else if (command === "cleanup") {
    await cleanupProduct(process.argv[3] ?? process.env.NEURO_BOOK_PRODUCT_OPERATION_ID ?? "");
} else {
    throw new Error(`未知 product runtime 命令：${command}`);
}

/**
 * 该命令故意不重建、不投影 Source，也不接受任意目录作为输入；产品正确性唯一
 * 来源是 Builder 已写入 ready marker 的 `.output`。实例位于系统受控 acceptance 根，
 * 不再污染仓库根 `product/` 或 `.agent/` 运行目录。
 */
async function stageProduct() {
    await mkdir(ACCEPTANCE_ROOT, {recursive: true});
    await sweepStaleAcceptances();

    const source = await openVerifiedImage(BUILD_OUTPUT_ROOT);
    const operationId = requestedOperationId();
    const stageRoot = resolveStageRoot(operationId);
    if (existsSync(stageRoot)) {
        throw new Error(`Product 验收实例已存在：${relative(REPO_ROOT, stageRoot).replaceAll("\\", "/")}`);
    }

    await mkdir(stageRoot, {recursive: true});
    const owner = acceptanceOwner(operationId, source.manifest);
    await writeOwner(stageRoot, owner);

    await withAcceptanceLease(stageRoot, async () => {
        const targetOutput = resolve(stageRoot, ".output");
        await cp(source.path, targetOutput, {recursive: true, dereference: false, force: false});

        // 复制完成后重新跑 Builder 的完整 payload 校验，不能把 cp 成功视为镜像正确。
        const copied = await openVerifiedImage(targetOutput, source.manifest);
        await writeOwner(stageRoot, acceptanceOwner(operationId, copied.manifest));
    });

    await writeAcceptancePointer(stageRoot, owner);
    console.log(`Product runtime staged: ${relative(REPO_ROOT, stageRoot).replaceAll("\\", "/")}`);
}

/**
 * 在已验证验收实例中运行 Product bundle 命令，并在整个子进程生命周期持有 lease。
 */
async function runAcceptedCommand(commandId, args) {
    const stageRoot = await resolveCurrentStage();
    const owner = await readOwner(stageRoot);
    const image = await openVerifiedImage(resolve(stageRoot, ".output"), owner);
    if (image.manifest.imageId !== owner.imageId) {
        throw new Error("Product 验收实例 owner 与 Runtime Image identity 不一致。");
    }

    const stateRoot = process.env.NEURO_BOOK_STATE_ROOT?.trim() || "state";
    if (!process.env.NEURO_BOOK_STATE_ROOT) {
        await mkdir(resolve(stageRoot, stateRoot), {recursive: true});
    }
    await withAcceptanceLease(stageRoot, async () => {
        const cacheRoot = process.env.NEURO_BOOK_CACHE_ROOT?.trim()
            ? resolve(process.env.NEURO_BOOK_CACHE_ROOT)
            : resolve(stageRoot, stateRoot, "cache");
        assertContained(resolve(stageRoot, stateRoot), cacheRoot, "Product Cache Root");
        const excludedRoots = [
            resolve(stageRoot, ".output"),
            resolve(stageRoot, stateRoot),
            resolve(stageRoot, cacheRoot),
        ];
        const beforeApplicationDigest = await applicationTreeDigest(stageRoot, excludedRoots);
        await run(process.execPath, [
            ...PRODUCT_BUN_RUNTIME_ARGS,
            `.output/${PRODUCT_RUNTIME_COMMAND_BOOTSTRAP}`,
            "command",
            commandId,
            ...args,
        ], {
            cwd: stageRoot,
            env: {
                ...process.env,
                NEURO_BOOK_APPLICATION_ROOT: stageRoot,
                NEURO_BOOK_STATE_ROOT: stateRoot,
                NEURO_BOOK_CACHE_ROOT: cacheRoot,
                BUN: process.execPath,
            },
        });
        await openVerifiedImage(resolve(stageRoot, ".output"), owner);
        const afterApplicationDigest = await applicationTreeDigest(stageRoot, excludedRoots);
        if (afterApplicationDigest !== beforeApplicationDigest) {
            throw new Error("Product command 修改了只读 Application Root；运行期文件必须进入 State Root 或 Cache Root。");
        }
    });
}

/**
 * 摘要验收实例中不属于 Runtime Image、State 或 Cache 的 Application Root 树。
 * owner/lease 是验收编排控制面，会在子进程运行期间刷新，因此不属于 Product 写入判定。
 */
async function applicationTreeDigest(applicationRoot, excludedRoots) {
    const hash = createHash("sha256");
    const queue = [applicationRoot];
    while (queue.length > 0) {
        const directory = queue.pop();
        const entries = await readdir(directory, {withFileTypes: true});
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const target = resolve(directory, entry.name);
            if (excludedRoots.some((root) => target === root || target.startsWith(`${root}${sep}`))) continue;
            if (directory === applicationRoot
                && (entry.name === OWNER_FILE || entry.name === LEASE_FILE || entry.name === `${LEASE_FILE}.lock`)) continue;
            const relativePath = relative(applicationRoot, target).replaceAll("\\", "/");
            const info = await lstat(target);
            if (info.isSymbolicLink()) throw new Error(`Product 验收 Application Root 含 symlink：${relativePath}`);
            if (info.isDirectory()) {
                hash.update(`directory\0${relativePath}\n`);
                queue.push(target);
                continue;
            }
            if (!info.isFile()) throw new Error(`Product 验收 Application Root 含特殊文件：${relativePath}`);
            hash.update(`file\0${relativePath}\0${String(info.size)}\0`);
            hash.update(await readFile(target));
            hash.update("\n");
        }
    }
    return `sha256:${hash.digest("hex")}`;
}

/**
 * 调用 Builder 的唯一公开验证入口。先从磁盘读完整 expected identity，再由 Builder
 * 复算 manifest、ready marker 和 payload；这里不复制 Builder 的校验算法。
 */
async function openVerifiedImage(imageRoot, expected = undefined) {
    const identity = expected ?? await readRuntimeImageIdentity(imageRoot);
    const builder = new ProductRuntimeImageBuilder(REPO_ROOT);
    return await builder.openVerified(imageRoot, identity);
}

/** 读取 Runtime Image 的基础身份，外部 JSON 先按 unknown 收窄。 */
async function readRuntimeImageIdentity(imageRoot) {
    let value;
    try {
        value = JSON.parse(await readFile(resolve(imageRoot, "runtime-image.json"), "utf8"));
    } catch (error) {
        throw new Error(`Product Runtime Image manifest 无法读取：${String(error)}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Product Runtime Image manifest 必须是对象。");
    }
    const manifest = value;
    const requiredString = [
        "version", "revision", "platform", "imageId", "lockfileSha256", "sourceDigest", "builderContractVersion",
    ];
    for (const key of requiredString) {
        if (typeof manifest[key] !== "string" || !manifest[key]) {
            throw new Error(`Product Runtime Image manifest 缺少 ${key}。`);
        }
    }
    if (typeof manifest.dirty !== "boolean") {
        throw new Error("Product Runtime Image manifest 缺少 dirty。");
    }
    return {
        version: manifest.version,
        revision: manifest.revision,
        dirty: manifest.dirty,
        platform: manifest.platform,
        imageId: manifest.imageId,
        lockfileSha256: manifest.lockfileSha256,
        sourceDigest: manifest.sourceDigest,
        builderContractVersion: manifest.builderContractVersion,
    };
}

/** 返回本次实例的稳定 operation ID，拒绝路径片段。 */
function requestedOperationId() {
    const requested = process.env.NEURO_BOOK_PRODUCT_OPERATION_ID?.trim();
    const operationId = requested || `acceptance-${new Date().toISOString().replace(/[^0-9]/gu, "")}-${randomUUID()}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(operationId) || operationId === "." || operationId === "..") {
        throw new Error(`Product 验收 operation ID 无效：${JSON.stringify(operationId)}`);
    }
    return operationId;
}

/**
 * 只清理本模块创建、operation 匹配且当前没有 lease 的验收 stage。
 * 缺少 owner 等同于 already-cleaned；未知 owner、路径逃逸或活动 lease 均拒绝删除。
 */
async function cleanupProduct(operationId) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(operationId) || operationId === "." || operationId === "..") {
        throw new Error(`Product 验收 cleanup operation ID 无效：${JSON.stringify(operationId)}`);
    }
    const stageRoot = resolveStageRoot(operationId);
    if (!existsSync(stageRoot)) {
        console.log("Product runtime cleanup: already-cleaned");
        return;
    }
    let owner;
    try {
        owner = JSON.parse(await readFile(resolve(stageRoot, OWNER_FILE), "utf8"));
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            console.log("Product runtime cleanup: already-cleaned");
            return;
        }
        throw new Error(`Product 验收 cleanup owner 无法读取：${String(error)}`);
    }
    if (!owner || typeof owner !== "object"
        || owner.owner !== ACCEPTANCE_OWNER || owner.schema !== ACCEPTANCE_SCHEMA
        || typeof owner.operationId !== "string") {
        throw new Error("Product 验收 cleanup 拒绝未知 owner。");
    }
    if (owner.operationId !== operationId) throw new Error("Product 验收 cleanup operation ID 不匹配。");
    assertContained(ACCEPTANCE_ROOT, stageRoot, "Product 验收 cleanup 目录");
    if (await checkLock(resolve(stageRoot, LEASE_FILE), {realpath: false})) {
        throw new Error("Product 验收 cleanup 拒绝删除仍被 lease 持有的 stage。");
    }
    await rm(stageRoot, {recursive: true, force: true});

    try {
        const pointer = JSON.parse(await readFile(ACCEPTANCE_POINTER, "utf8"));
        if (pointer && typeof pointer === "object"
            && pointer.owner === ACCEPTANCE_OWNER
            && pointer.schema === ACCEPTANCE_SCHEMA
            && pointer.operationId === operationId) {
            const pointerPath = typeof pointer.path === "string" ? resolve(REPO_ROOT, pointer.path) : null;
            if (pointerPath && pointerPath === stageRoot) await rm(ACCEPTANCE_POINTER, {force: true});
        }
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    console.log("Product runtime cleanup: cleaned");
}

function resolveStageRoot(operationId) {
    const configured = process.env.NEURO_BOOK_PRODUCT_STAGE_DIR?.trim();
    const stageRoot = configured
        ? resolve(configured)
        : resolve(ACCEPTANCE_ROOT, operationId);
    assertContained(ACCEPTANCE_ROOT, stageRoot, "Product 验收目录");
    if (stageRoot === ACCEPTANCE_ROOT) {
        throw new Error("Product 验收目录不能是受控 acceptance 根。");
    }
    return stageRoot;
}

/** 从当前 pointer 或受限环境变量定位验收实例。 */
async function resolveCurrentStage() {
    const configured = process.env.NEURO_BOOK_PRODUCT_STAGE_DIR?.trim();
    if (configured) {
        const stageRoot = resolve(configured);
        assertContained(ACCEPTANCE_ROOT, stageRoot, "Product 验收目录");
        return stageRoot;
    }
    let value;
    try {
        value = JSON.parse(await readFile(ACCEPTANCE_POINTER, "utf8"));
    } catch (error) {
        throw new Error(`没有可用 Product 验收实例，请先运行 bun run product:stage：${String(error)}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.path !== "string") {
        throw new Error("Product 验收实例 pointer 无效。");
    }
    const stageRoot = resolve(value.path);
    assertContained(ACCEPTANCE_ROOT, stageRoot, "Product 验收实例 pointer");
    return stageRoot;
}

/** 记录实例 owner、identity 和 heartbeat，供异常退出后的 sweep 判断。 */
function acceptanceOwner(operationId, manifest) {
    return {
        schema: ACCEPTANCE_SCHEMA,
        owner: ACCEPTANCE_OWNER,
        operationId,
        pid: process.pid,
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        imageId: manifest.imageId,
        version: manifest.version,
        revision: manifest.revision,
        dirty: manifest.dirty,
        platform: manifest.platform,
        lockfileSha256: manifest.lockfileSha256,
        sourceDigest: manifest.sourceDigest,
        builderContractVersion: manifest.builderContractVersion,
    };
}

/** owner JSON 是不可信磁盘输入，严格收窄为 Builder 需要的 expected identity。 */
async function readOwner(stageRoot) {
    let value;
    try {
        value = JSON.parse(await readFile(resolve(stageRoot, OWNER_FILE), "utf8"));
    } catch (error) {
        throw new Error(`Product 验收实例 owner 无法读取：${String(error)}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Product 验收实例 owner 无效。");
    }
    const owner = value;
    const stringFields = [
        "owner", "operationId", "imageId", "version", "revision", "platform", "lockfileSha256", "sourceDigest",
        "builderContractVersion",
    ];
    for (const key of stringFields) {
        if (typeof owner[key] !== "string" || !owner[key]) {
            throw new Error(`Product 验收实例 owner 缺少 ${key}。`);
        }
    }
    if (owner.schema !== ACCEPTANCE_SCHEMA || owner.owner !== ACCEPTANCE_OWNER || typeof owner.dirty !== "boolean") {
        throw new Error("Product 验收实例 owner schema 不受支持。");
    }
    return owner;
}

/** 通过 atomic pointer 让 start/create-admin 找到最近一次成功验收的实例。 */
async function writeAcceptancePointer(stageRoot, owner) {
    const pointer = {
        schema: ACCEPTANCE_SCHEMA,
        owner: ACCEPTANCE_OWNER,
        operationId: owner.operationId,
        imageId: owner.imageId,
        path: stageRoot,
        updatedAt: new Date().toISOString(),
    };
    const temporary = `${ACCEPTANCE_POINTER}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(pointer)}\n`, {encoding: "utf8", flag: "wx"});
    await rm(ACCEPTANCE_POINTER, {force: true});
    await rename(temporary, ACCEPTANCE_POINTER);
}

/** 写入 owner marker；运行中的 child 会定期刷新 heartbeat。 */
async function writeOwner(stageRoot, owner) {
    await writeFile(resolve(stageRoot, OWNER_FILE), `${JSON.stringify(owner)}\n`, "utf8");
}

/** 在持锁期间维持 heartbeat，异常退出后由下一次 stage 的 sweep 回收。 */
async function withAcceptanceLease(stageRoot, action) {
    const leaseTarget = resolve(stageRoot, LEASE_FILE);
    await writeFile(leaseTarget, "", {flag: "a"});
    const release = await acquireLock(leaseTarget, {
        realpath: false,
        stale: 60_000,
        update: HEARTBEAT_MS,
        retries: {retries: 0},
    });
    const heartbeat = setInterval(() => {
        void refreshHeartbeat(stageRoot).catch(() => undefined);
    }, HEARTBEAT_MS);
    try {
        return await action();
    } finally {
        clearInterval(heartbeat);
        await release();
    }
}

/** 更新 marker 的生命迹象；校验失败时不覆盖未知 owner。 */
async function refreshHeartbeat(stageRoot) {
    const owner = await readOwner(stageRoot);
    await writeOwner(stageRoot, {...owner, heartbeatAt: new Date().toISOString(), pid: process.pid});
}

/** 仅删除过期、已无 lease 且可识别为本模块拥有的临时实例。 */
async function sweepStaleAcceptances() {
    const entries = await readdir(ACCEPTANCE_ROOT, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const stageRoot = resolve(ACCEPTANCE_ROOT, entry.name);
        let owner;
        try {
            owner = await readOwner(stageRoot);
        } catch {
            continue;
        }
        const heartbeatAt = Date.parse(owner.heartbeatAt);
        if (!Number.isFinite(heartbeatAt) || Date.now() - heartbeatAt < STALE_ACCEPTANCE_MS) continue;
        const leased = await checkLock(resolve(stageRoot, LEASE_FILE), {realpath: false}).catch(() => false);
        if (!leased) {
            await rm(stageRoot, {recursive: true, force: true});
        }
    }
}

/** 运行 bundle command 并向 child 转发终止信号。 */
function run(commandName, args, options) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(commandName, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: "inherit",
            windowsHide: false,
        });
        const forwardSignals = ["SIGINT", "SIGTERM"];
        const forward = (signal) => {
            if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        };
        for (const signal of forwardSignals) process.once(signal, forward);
        const cleanup = () => {
            for (const signal of forwardSignals) process.removeListener(signal, forward);
        };
        child.on("error", (error) => {
            cleanup();
            rejectPromise(error);
        });
        child.on("exit", (code, signal) => {
            cleanup();
            if (signal) {
                rejectPromise(new Error(`${commandName} 被信号中断：${signal}`));
            } else if (code !== 0) {
                rejectPromise(new Error(`${commandName} ${args.join(" ")} 退出码 ${code ?? 1}`));
            } else {
                resolvePromise();
            }
        });
    });
}

/** 防止环境变量或 pointer 越过系统受控 Agent acceptance 根。 */
function assertContained(root, target, label) {
    const relativePath = relative(resolve(root), resolve(target));
    if (relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))) {
        return;
    }
    throw new Error(`${label} 逃逸系统受控 acceptance 根：${target}`);
}
