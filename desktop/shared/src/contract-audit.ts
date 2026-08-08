import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {parseProductRuntimeContract, type ProductRuntimeContract} from "nbook/shared/product-runtime-contract";

export type ContractAudit = {
    imageRoot: string;
    schema: ProductRuntimeContract["schema"];
    entries: string[];
    unsafeEntries: string[];
};

/** 只审计 Contract 的入口路径，拒绝绝对路径、路径逃逸和非 commands 入口。 */
export async function auditProductContract(imageRootInput: string): Promise<ContractAudit> {
    const imageRoot = resolve(imageRootInput);
    const contractPath = resolve(imageRoot, "server", "runtime-contract.json");
    const contract = parseProductRuntimeContract(JSON.parse(await readFile(contractPath, "utf8")) as unknown);
    const entries = Object.values(contract.commands).map((item) => item.entry);
    const unsafeEntries = entries.filter((entry) => {
        const normalized = entry.replaceAll("\\", "/");
        return normalized !== entry
            || normalized.startsWith("/")
            || normalized.split("/").includes("..")
            || !normalized.startsWith("server/commands/")
            || normalized.includes(".bun")
            || normalized.includes(".pnpm");
    });
    return {imageRoot, schema: contract.schema, entries, unsafeEntries};
}
