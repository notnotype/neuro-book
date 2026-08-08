export const DESKTOP_UAC_BROKER_SCHEMA = "nbook.desktop-uac-broker/v2" as const;
export const DESKTOP_UAC_MAX_CONTROL_LINE_BYTES = 256 * 1024;
export const DESKTOP_UAC_MAX_SECRET_BYTES = 4096;
export const DESKTOP_UAC_MAX_ARGUMENTS = 128;
export const DESKTOP_UAC_MAX_ARGUMENT_BYTES = 4096;

export type DesktopUacBrokerAction = "desktop-install" | "desktop-repair" | "uninstall";

export type DesktopUacBrokerHello = {
    schema: typeof DESKTOP_UAC_BROKER_SCHEMA;
    type: "hello";
    operationId: string;
    nonce: string;
};

export type DesktopUacBrokerSecretHello = {
    schema: typeof DESKTOP_UAC_BROKER_SCHEMA;
    type: "secret-hello";
    operationId: string;
    nonce: string;
};

export type DesktopUacBrokerRequest = {
    schema: typeof DESKTOP_UAC_BROKER_SCHEMA;
    type: "request";
    operationId: string;
    action: DesktopUacBrokerAction;
    args: string[];
    secretBytes: number;
    installationId: string | null;
    installationRoot: string;
    manifestSha256: string | null;
    deleteData: boolean;
};

export type DesktopUacBrokerEvent =
    | {
        schema: typeof DESKTOP_UAC_BROKER_SCHEMA;
        type: "event";
        operationId: string;
        event: {
            kind: "json";
            value: Record<string, unknown>;
        };
    }
    | {
        schema: typeof DESKTOP_UAC_BROKER_SCHEMA;
        type: "event";
        operationId: string;
        event: {
            kind: "log";
            stream: "stdout" | "stderr";
            message: string;
        };
    }
    | {
        schema: typeof DESKTOP_UAC_BROKER_SCHEMA;
        type: "event";
        operationId: string;
        event: {
            kind: "complete";
            exitCode: number | null;
            signal: string | null;
        };
    }
    | {
        schema: typeof DESKTOP_UAC_BROKER_SCHEMA;
        type: "event";
        operationId: string;
        event: {
            kind: "failure";
            code: string;
            message: string;
        };
    };

export type DesktopUacBrokerControl =
    | DesktopUacBrokerHello
    | DesktopUacBrokerSecretHello
    | DesktopUacBrokerRequest
    | DesktopUacBrokerEvent;

/** 编码一行控制消息；秘密字节永远不经过这个函数。 */
export function encodeDesktopUacBrokerLine(value: DesktopUacBrokerControl): string {
    const line = JSON.stringify(value);
    const bytes = new TextEncoder().encode(line).byteLength;
    if (bytes > DESKTOP_UAC_MAX_CONTROL_LINE_BYTES) {
        throw new Error("Desktop UAC Broker 控制消息超过大小上限。");
    }
    if (line.includes("\r") || line.includes("\n")) {
        throw new Error("Desktop UAC Broker 控制消息不能包含原始换行。");
    }
    return `${line}\n`;
}

/** 解析并严格校验一行控制消息；输入来自提升边界，必须先收窄。 */
export function parseDesktopUacBrokerLine(line: string): DesktopUacBrokerControl {
    const bytes = new TextEncoder().encode(line).byteLength;
    if (bytes > DESKTOP_UAC_MAX_CONTROL_LINE_BYTES) {
        throw new Error("Desktop UAC Broker 控制消息超过大小上限。");
    }
    let value: unknown;
    try {
        value = JSON.parse(line) as unknown;
    } catch (error) {
        throw new Error(`Desktop UAC Broker 控制消息不是有效 JSON：${String(error)}`);
    }
    if (!isObject(value)) throw new Error("Desktop UAC Broker 控制消息必须是对象。");
    const root = value as Record<string, unknown>;
    if (root.schema !== DESKTOP_UAC_BROKER_SCHEMA || typeof root.type !== "string") {
        throw new Error("Desktop UAC Broker 控制消息 schema 无效。");
    }
    if (root.type === "hello") return parseHello(root);
    if (root.type === "secret-hello") return parseSecretHello(root);
    if (root.type === "request") return parseRequest(root);
    if (root.type === "event") return parseEvent(root);
    throw new Error(`Desktop UAC Broker 控制消息类型不受支持：${root.type}`);
}

function parseSecretHello(root: Record<string, unknown>): DesktopUacBrokerSecretHello {
    assertExactKeys(root, ["schema", "type", "operationId", "nonce"]);
    return {
        schema: DESKTOP_UAC_BROKER_SCHEMA,
        type: "secret-hello",
        operationId: nonEmptyString(root.operationId, "operationId"),
        nonce: nonEmptyString(root.nonce, "nonce"),
    };
}

function parseHello(root: Record<string, unknown>): DesktopUacBrokerHello {
    assertExactKeys(root, ["schema", "type", "operationId", "nonce"]);
    return {
        schema: DESKTOP_UAC_BROKER_SCHEMA,
        type: "hello",
        operationId: nonEmptyString(root.operationId, "operationId"),
        nonce: nonEmptyString(root.nonce, "nonce"),
    };
}

function parseRequest(root: Record<string, unknown>): DesktopUacBrokerRequest {
    assertExactKeys(root, [
        "schema",
        "type",
        "operationId",
        "action",
        "args",
        "secretBytes",
        "installationId",
        "installationRoot",
        "manifestSha256",
        "deleteData",
    ]);
    if (!isBrokerAction(root.action)) throw new Error("Desktop UAC Broker action 不受支持。");
    if (!Array.isArray(root.args)
        || root.args.length > DESKTOP_UAC_MAX_ARGUMENTS
        || root.args.some((value) => typeof value !== "string" || value.includes("\0")
            || new TextEncoder().encode(value).byteLength > DESKTOP_UAC_MAX_ARGUMENT_BYTES)) {
        throw new Error("Desktop UAC Broker 参数列表无效。");
    }
    if (!isSafeInteger(root.secretBytes)
        || root.secretBytes < 0
        || root.secretBytes > DESKTOP_UAC_MAX_SECRET_BYTES) {
        throw new Error("Desktop UAC Broker secretBytes 超出范围。");
    }
    const installationId = root.installationId === null ? null : nonEmptyString(root.installationId, "installationId");
    const installationRoot = nonEmptyString(root.installationRoot, "installationRoot");
    if (!isAbsoluteDesktopPath(installationRoot)) {
        throw new Error("Desktop UAC Broker installationRoot 必须是绝对路径。");
    }
    const manifestSha256 = root.manifestSha256 === null ? null : root.manifestSha256;
    if (manifestSha256 !== null && !isSha256(manifestSha256)) {
        throw new Error("Desktop UAC Broker manifestSha256 无效。");
    }
    if (typeof root.deleteData !== "boolean") {
        throw new Error("Desktop UAC Broker deleteData 无效。");
    }
    return {
        schema: DESKTOP_UAC_BROKER_SCHEMA,
        type: "request",
        operationId: nonEmptyString(root.operationId, "operationId"),
        action: root.action,
        args: [...root.args],
        secretBytes: root.secretBytes,
        installationId,
        installationRoot,
        manifestSha256,
        deleteData: root.deleteData,
    };
}

function parseEvent(root: Record<string, unknown>): DesktopUacBrokerEvent {
    assertExactKeys(root, ["schema", "type", "operationId", "event"]);
    if (!isObject(root.event)) throw new Error("Desktop UAC Broker event 缺少 event。");
    const event = root.event as Record<string, unknown>;
    if (event.kind === "json") {
        assertExactKeys(event, ["kind", "value"]);
        if (!isObject(event.value)) throw new Error("Desktop UAC Broker json event 必须携带对象。");
        return {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "event",
            operationId: nonEmptyString(root.operationId, "operationId"),
            event: {kind: "json", value: event.value as Record<string, unknown>},
        };
    }
    if (event.kind === "log") {
        assertExactKeys(event, ["kind", "stream", "message"]);
        if (event.stream !== "stdout" && event.stream !== "stderr") throw new Error("Desktop UAC Broker log stream 无效。");
        return {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "event",
            operationId: nonEmptyString(root.operationId, "operationId"),
            event: {
                kind: "log",
                stream: event.stream,
                message: boundedString(event.message, "message", 16 * 1024),
            },
        };
    }
    if (event.kind === "complete") {
        assertExactKeys(event, ["kind", "exitCode", "signal"]);
        if ((event.exitCode !== null && !Number.isInteger(event.exitCode))
            || (event.signal !== null && typeof event.signal !== "string")) {
            throw new Error("Desktop UAC Broker complete event 无效。");
        }
        return {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "event",
            operationId: nonEmptyString(root.operationId, "operationId"),
            event: {kind: "complete", exitCode: event.exitCode as number | null, signal: event.signal as string | null},
        };
    }
    if (event.kind === "failure") {
        assertExactKeys(event, ["kind", "code", "message"]);
        return {
            schema: DESKTOP_UAC_BROKER_SCHEMA,
            type: "event",
            operationId: nonEmptyString(root.operationId, "operationId"),
            event: {
                kind: "failure",
                code: boundedString(event.code, "code", 256),
                message: boundedString(event.message, "message", 16 * 1024),
            },
        };
    }
    throw new Error("Desktop UAC Broker event kind 无效。");
}

function assertExactKeys(value: Record<string, unknown>, keys: string[]): void {
    const expected = new Set(keys);
    const actual = Object.keys(value);
    if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
        throw new Error("Desktop UAC Broker 控制消息包含未知字段。");
    }
}

function nonEmptyString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
        throw new Error(`Desktop UAC Broker ${name} 无效。`);
    }
    return value;
}

function boundedString(value: unknown, name: string, maxBytes: number): string {
    const result = nonEmptyString(value, name);
    if (new TextEncoder().encode(result).byteLength > maxBytes) {
        throw new Error(`Desktop UAC Broker ${name} 超过大小上限。`);
    }
    return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value);
}

function isSha256(value: unknown): value is string {
    return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isAbsoluteDesktopPath(value: string): boolean {
    return value.startsWith("/")
        || value.startsWith("\\\\")
        || /^[A-Za-z]:[\\/]/u.test(value);
}

function isBrokerAction(value: unknown): value is DesktopUacBrokerAction {
    return value === "desktop-install" || value === "desktop-repair" || value === "uninstall";
}
