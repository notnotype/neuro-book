import {spawn} from "node:child_process";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {
    PRODUCT_BUN_RUNTIME_ARGS,
    productRuntimeCwd,
    readProductRuntimeContract,
    resolveProductRuntimeChecks,
    resolveProductRuntimeCheck,
    resolveProductRuntimeCommand,
} from "nbook/shared/product-runtime-contract";
import {ProductRuntimeImageVerifier} from "nbook/shared/product-runtime-image-verifier";
import {
    productRuntimeReceiptAuthorizationFromEnvironment,
    verifyAuthorizedProductRuntimeReceiptControlPlane,
} from "nbook/shared/product-runtime-receipt";

/** 固定 bootstrap：把逻辑 command/check ID 解析成当前镜像的实际 bundle 入口。 */
async function main(): Promise<void> {
    const [mode, id, ...args] = process.argv.slice(2);
    if ((mode !== "command" && mode !== "check") || !id) {
        throw new Error("用法：product-command <command|check> <id> [...args]");
    }
    const imageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    delete process.env.NODE_PATH;
    const applicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT?.trim();
    if (!applicationRoot) {
        throw new Error("Product Runtime command 缺少 NEURO_BOOK_APPLICATION_ROOT；必须由 Manager、Desktop Envelope 或 CLI wrapper 显式注入。");
    }
    const receiptAuthorization = productRuntimeReceiptAuthorizationFromEnvironment(process.env);
    if (receiptAuthorization) {
        await verifyAuthorizedProductRuntimeReceiptControlPlane(imageRoot, applicationRoot, receiptAuthorization);
    } else {
        await new ProductRuntimeImageVerifier().openSelfVerified(imageRoot);
    }
    const contract = await readProductRuntimeContract(imageRoot);
    const childEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        NEURO_BOOK_APPLICATION_ROOT: applicationRoot,
        NEURO_BOOK_PRODUCT_IMAGE_ROOT: imageRoot,
    };
    delete childEnvironment.NODE_PATH;
    if (mode === "check" && id === "all") {
        if (args.length > 0) throw new Error("Product Runtime check all 不接受额外参数。");
        for (const invocation of resolveProductRuntimeChecks(contract)) {
            const entry = resolve(imageRoot, ...invocation.entry.split("/"));
            const code = await run(entry, invocation.fixedArgs, applicationRoot, childEnvironment);
            if (code !== 0) {
                process.exitCode = code;
                return;
            }
        }
        process.exitCode = 0;
        return;
    }
    const invocation = mode === "command"
        ? resolveProductRuntimeCommand(contract, id, args)
        : resolveProductRuntimeCheck(contract, id, args);
    const entry = resolve(imageRoot, ...invocation.entry.split("/"));
    const cwd = productRuntimeCwd(mode, id, applicationRoot, process.cwd());
    const code = await run(entry, invocation.fixedArgs, cwd, childEnvironment);
    process.exitCode = code;
}

/** 使用当前受控 Bun 运行入口，并原样转发 stdio 与退出码。 */
async function run(entry: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
    return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [...PRODUCT_BUN_RUNTIME_ARGS, entry, ...args], {
            cwd,
            env,
            stdio: "inherit",
            windowsHide: true,
        });
        const forward = (signal: NodeJS.Signals): void => {
            if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        };
        const onSigint = (): void => forward("SIGINT");
        const onSigterm = (): void => forward("SIGTERM");
        const cleanup = (): void => {
            process.off("SIGINT", onSigint);
            process.off("SIGTERM", onSigterm);
        };
        process.once("SIGINT", onSigint);
        process.once("SIGTERM", onSigterm);
        child.once("error", (error) => {
            cleanup();
            rejectPromise(error);
        });
        child.once("exit", (code, signal) => {
            cleanup();
            if (signal) rejectPromise(new Error(`Product Runtime command 被信号中断：${signal}`));
            else resolvePromise(code ?? 1);
        });
    });
}

await main();
