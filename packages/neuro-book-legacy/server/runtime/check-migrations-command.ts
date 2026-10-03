import {assertProductMigrationsReady} from "nbook/server/runtime/product-migration-gate";

try {
    await assertProductMigrationsReady();
    process.stdout.write("NeuroBook migration check: ready\n");
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
}
