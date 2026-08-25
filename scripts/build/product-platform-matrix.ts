export type ProductPlatformMatrixEntry = {
    platform: string;
    runner: string;
    command: string;
    archive: string;
    port: number;
    browser: string;
    prGate?: boolean;
};

export type SelectedProductPlatformEntry = Omit<ProductPlatformMatrixEntry, "prGate">;

export const PRODUCT_PLATFORM_MATRIX_ENTRIES: ProductPlatformMatrixEntry[] = [
    {
        platform: "linux-x64-glibc",
        runner: "ubuntu-latest",
        command: "release:product:linux",
        archive: "neuro-book-product-linux-x64-glibc.tar.gz",
        port: 39223,
        browser: "playwright",
        prGate: true,
    },
    {
        platform: "linux-aarch64-glibc",
        runner: "ubuntu-24.04-arm",
        command: "release:product:linux-aarch64",
        archive: "neuro-book-product-linux-aarch64-glibc.tar.gz",
        port: 39224,
        browser: "playwright",
    },
    {
        platform: "darwin-x64",
        runner: "macos-15-intel",
        command: "release:product:darwin",
        archive: "neuro-book-product-darwin-x64.tar.gz",
        port: 39225,
        browser: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    {
        platform: "darwin-aarch64",
        runner: "macos-15",
        command: "release:product:darwin-aarch64",
        archive: "neuro-book-product-darwin-aarch64.tar.gz",
        port: 39226,
        browser: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
];

export function selectProductPlatformMatrix(eventName: string): Array<SelectedProductPlatformEntry> {
    const selected = eventName === "pull_request"
        ? PRODUCT_PLATFORM_MATRIX_ENTRIES.filter((entry) => entry.prGate === true)
        : PRODUCT_PLATFORM_MATRIX_ENTRIES;
    return selected.map(({prGate: _prGate, ...entry}) => entry);
}

if (import.meta.main) {
    const eventName = process.argv[2] ?? process.env.EVENT_NAME ?? "";
    if (eventName === "") {
        throw new Error("Usage: bun scripts/build/product-platform-matrix.ts <event-name> (or set EVENT_NAME)");
    }
    process.stdout.write(JSON.stringify({include: selectProductPlatformMatrix(eventName)}));
}
