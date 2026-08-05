import {createInterface} from "node:readline";
import {join, resolve} from "node:path";

import {
    desktopSupervisorLine,
    parseDesktopSupervisorRequest,
    type DesktopSupervisorEvent,
    type DesktopSupervisorRequest,
} from "nbook/shared/desktop-contract";
import {
    verifyProductRuntimeReceiptControlPlane,
    verifyProductRuntimeReceiptFully,
} from "nbook/shared/product-runtime-receipt";
import type {ProductRuntimeExpectedIdentity} from "nbook/shared/product-runtime-image-verifier";

import {startInstallationApplication} from "#manager/migration-operation";
import {installationPaths} from "#manager/paths";
import {issueInstalledProductRuntimeReceipt} from "#manager/product";
import type {InstallationManifest, ProductComponent} from "#manager/types";

export type DesktopSupervisorOptions = {
    root: string;
    manifest: InstallationManifest;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
};

type ActiveRun = {
    requestId: string;
    controller: AbortController;
    promise: Promise<void>;
};

/**
 * Manager 的 Desktop Supervisor NDJSON 主循环。
 * Envelope 只看到结构化事件；Product、State Root、回执和 shutdown 全由 Manager 持有。
 */
export async function runDesktopSupervisor(options: DesktopSupervisorOptions): Promise<void> {
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const root = resolve(options.root);
    const paths = installationPaths(root, options.manifest.roots);
    let active: ActiveRun | null = null;
    const emit = (event: DesktopSupervisorEvent): void => {
        output.write(desktopSupervisorLine(event));
    };
    const fail = (requestId: string, code: string, error: unknown, recoverable = true): void => {
        emit({
            schema: "nbook.desktop-supervisor/v1",
            requestId,
            type: "failure",
            code,
            message: error instanceof Error ? error.message : String(error),
            recoverable,
        });
    };

    const reader = createInterface({input, crlfDelay: Infinity});
    for await (const line of reader) {
        if (!line.trim()) continue;
        let request: DesktopSupervisorRequest;
        try {
            request = parseDesktopSupervisorRequest(JSON.parse(line) as unknown);
        } catch (error) {
            fail("unknown", "invalid-request", error, false);
            continue;
        }
        if (request.type === "start") {
            if (active) {
                fail(request.requestId, "already-running", "NeuroBook Desktop 已经有一个 Supervisor 启动任务。", true);
                continue;
            }
            const controller = new AbortController();
            const promise = startDesktop(root, options.manifest, request, controller, emit, fail)
                .finally(() => {
                    if (active?.promise === promise) active = null;
                });
            active = {requestId: request.requestId, controller, promise};
            continue;
        }
        if (request.type === "stop") {
            if (!active) {
                emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "stopped", shutdown: "graceful"});
                continue;
            }
            emit({schema: "nbook.desktop-supervisor/v1", requestId: active.requestId, type: "stage", stage: "stopping-product"});
            active.controller.abort();
            continue;
        }
        if (request.type === "verify") {
            try {
                emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "stage", stage: "quick-verify"});
                await verifyReceipt(root, options.manifest, paths.deploy, true);
                emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "verified", verification: "full"});
            } catch (error) {
                fail(request.requestId, "verification-failed", error, true);
            }
            continue;
        }
        try {
            emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "stage", stage: "repairing"});
            await repairReceipt(root, options.manifest, paths.deploy);
            emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "verified", verification: "full"});
        } catch (error) {
            fail(request.requestId, "repair-failed", error, true);
        }
    }
    if (active) {
        active.controller.abort();
        await active.promise.catch(() => undefined);
    }
}

async function startDesktop(
    root: string,
    manifest: InstallationManifest,
    request: Extract<DesktopSupervisorRequest, {type: "start"}>,
    controller: AbortController,
    emit: (event: DesktopSupervisorEvent) => void,
    fail: (requestId: string, code: string, error: unknown, recoverable?: boolean) => void,
): Promise<void> {
    try {
        emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "stage", stage: "quick-verify"});
        await verifyReceipt(root, manifest, join(root, ".deploy"), false);
        emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "stage", stage: "migration"});
        emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "stage", stage: "starting-product"});
        await startInstallationApplication(root, {
            healthCheck: true,
            openBrowser: false,
            port: request.port,
            startupNonce: request.startupNonce,
            shutdownSignal: controller.signal,
            onReady: async ({port, startupNonce}) => {
                emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "stage", stage: "waiting-ready"});
                const nonce = startupNonce ?? request.startupNonce;
                emit({
                    schema: "nbook.desktop-supervisor/v1",
                    requestId: request.requestId,
                    type: "ready",
                    url: `http://127.0.0.1:${String(port)}/`,
                    origin: `http://127.0.0.1:${String(port)}`,
                    version: manifest.appVersion.startsWith("v") ? manifest.appVersion : `v${manifest.appVersion}`,
                    startupNonce: nonce,
                });
                emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "stage", stage: "background-verify"});
                await verifyReceipt(root, manifest, join(root, ".deploy"), true);
                emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "verified", verification: "full"});
            },
        });
        emit({schema: "nbook.desktop-supervisor/v1", requestId: request.requestId, type: "stopped", shutdown: "graceful"});
    } catch (error) {
        fail(request.requestId, "start-failed", error, true);
    }
}

async function verifyReceipt(root: string, manifest: InstallationManifest, deployRoot: string, full: boolean): Promise<void> {
    const product = nativeProduct(manifest.components.product);
    if (!product) throw new Error("Desktop Local 需要 native Product Runtime Image；Container Profile 不能作为 Desktop Local。");
    const expected: ProductRuntimeExpectedIdentity = {
        version: product.version,
        revision: product.revision,
        dirty: false,
        platform: product.platform,
        imageId: product.imageId,
        sourceDigest: product.sourceDigest,
        lockfileSha256: product.lockfileSha256,
        builderContractVersion: product.builderContractVersion,
    };
    const imageRoot = resolve(root, product.path);
    const receiptPath = join(deployRoot, "product-runtime-receipt.json");
    if (full) await verifyProductRuntimeReceiptFully(imageRoot, receiptPath, expected);
    else await verifyProductRuntimeReceiptControlPlane(imageRoot, receiptPath, expected);
}

async function repairReceipt(root: string, manifest: InstallationManifest, deployRoot: string): Promise<void> {
    // 先完整验证当前镜像，再原子重建回执；镜像损坏时绝不覆盖已有证据。
    const product = nativeProduct(manifest.components.product);
    if (!product) throw new Error("只有 native Product 才能修复 Runtime receipt。");
    await issueInstalledProductRuntimeReceipt(root, product, join(deployRoot, "product-runtime-receipt.json"));
}

function nativeProduct(product: ProductComponent | undefined): Exclude<ProductComponent, {provider: "container"}> | null {
    return product && product.provider !== "container" ? product : null;
}
