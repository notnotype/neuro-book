import {readFile} from "node:fs/promises";
import {timingSafeEqual} from "node:crypto";
import {join} from "node:path";
import {getRequestHeader, setResponseHeader} from "h3";

const GITHUB_URL = "https://github.com/notnotype/neuro-book";

type AppVersionKind = "package";

interface AppVersionDto {
    versionLabel: string;
    versionKind: AppVersionKind;
    githubUrl: string;
    /** 受管 Desktop 启动注入的内存 nonce；普通 B/S 请求不返回此字段。 */
    startupNonce?: string;
}

interface PackageManifest {
    homepage?: string;
    repository?: string | {
        url?: string;
    };
    version?: string;
}

/**
 * 返回设置页底部展示用的版本和仓库地址。
 */
export default defineEventHandler(async (event): Promise<AppVersionDto> => {
    const manifest = await readProductPackageManifest();
    const startupNonce = process.env.NEURO_BOOK_STARTUP_NONCE?.trim();
    const requestedNonce = getRequestHeader(event, "x-neuro-book-startup-nonce")?.trim();
    const authorizedNonce = startupNonce && requestedNonce && secretsEqual(startupNonce, requestedNonce)
        ? startupNonce
        : undefined;
    setResponseHeader(event, "cache-control", "no-store");
    return {
        versionLabel: versionLabel(manifest?.version ?? "unknown"),
        versionKind: "package",
        githubUrl: githubUrl(manifest),
        ...(authorizedNonce && /^[A-Za-z0-9_-]{32,128}$/u.test(authorizedNonce) ? {startupNonce: authorizedNonce} : {}),
    };
});

/** 只有本次 Manager 注入的精确 nonce 才能读回启动关联信息。 */
function secretsEqual(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left, "utf8");
    const rightBytes = Buffer.from(right, "utf8");
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Product Root 优先读根 package；GHCR / 通用 `.output` runner 可只带 server package。
 */
async function readProductPackageManifest(): Promise<PackageManifest | null> {
    for (const path of packageManifestCandidates()) {
        try {
            const manifest = JSON.parse(await readFile(path, "utf8")) as PackageManifest;
            if (manifest.version) {
                return manifest;
            }
        } catch {
            continue;
        }
    }
    return null;
}

function packageManifestCandidates(): string[] {
    return [
        join(process.cwd(), "package.json"),
        join(process.cwd(), ".output", "server", "package.json"),
    ];
}

function versionLabel(version: string): string {
    const normalized = version.trim();
    if (!normalized || normalized === "unknown" || normalized.startsWith("v")) {
        return normalized || "unknown";
    }
    return `v${normalized}`;
}

function githubUrl(manifest: PackageManifest | null): string {
    const repository = typeof manifest?.repository === "string"
        ? manifest.repository
        : manifest?.repository?.url;
    return normalizeGithubUrl(repository ?? manifest?.homepage) ?? GITHUB_URL;
}

function normalizeGithubUrl(value?: string): string | null {
    if (!value) {
        return null;
    }
    const trimmed = value.trim()
        .replace(/^git\+/u, "")
        .replace(/\.git$/u, "");
    const sshMatch = /^git@github\.com:([^/]+\/[^/]+)$/u.exec(trimmed);
    if (sshMatch) {
        return `https://github.com/${sshMatch[1]}`;
    }
    if (/^https:\/\/github\.com\/[^/]+\/[^/]+/u.test(trimmed)) {
        return trimmed;
    }
    return null;
}
