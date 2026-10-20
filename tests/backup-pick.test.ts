// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import ts from "typescript";

type BackupModule = typeof import("../src/lib/backup");

// Execute the real backup module with the native boundaries mocked so the
// restore picker can be exercised without Tauri or real file access.
function loadBackup(overrides: Record<string, unknown>): BackupModule {
  const empty = {};
  const mocks: Record<string, unknown> = {
    "@/lib/download-text": empty,
    "@/lib/profile-sync/backup-payload": { buildSyncBackup: () => ({}) },
    "@/lib/theme-storage": empty,
    "@/lib/profiles": { readAllProfilesIdentity: () => [] },
    "@/lib/active-profile-id": { activeProfileId: () => "local" },
    "@/lib/secret-store": empty,
    "@/lib/storage-recovery": empty,
    "@/lib/harbor-migration": { renameHarborKey: () => null },
    "@/lib/local-library": empty,
    ...overrides,
  };
  const source = readFileSync(new URL("../src/lib/backup.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name: string) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected native boundary: ${name}`);
      return mocks[name];
    },
    module,
    module.exports,
  );
  return module.exports as BackupModule;
}

test("restore picks through the native dialog with an extension filter", async () => {
  const opened: unknown[] = [];
  const read: string[] = [];
  const picked = "/home/player/Downloads/Compass Backup/compass-backup-2026-10-13.harbx";
  const backup = loadBackup({
    "@tauri-apps/plugin-dialog": {
      open: async (options: unknown) => {
        opened.push(options);
        return picked;
      },
    },
    "@tauri-apps/plugin-fs": {
      readTextFile: async (path: string) => {
        read.push(path);
        return '{"format":"compass-backup"}';
      },
    },
  });

  assert.equal(await backup.pickBackupFile(), '{"format":"compass-backup"}');
  assert.deepEqual(opened, [
    {
      multiple: false,
      directory: false,
      filters: [{ name: "Compass backup", extensions: ["harbx", "json"] }],
    },
  ]);
  assert.deepEqual(read, [picked]);
});

test("cancelling the native picker reads nothing", async () => {
  let reads = 0;
  const backup = loadBackup({
    "@tauri-apps/plugin-dialog": { open: async () => null },
    "@tauri-apps/plugin-fs": {
      readTextFile: async () => {
        reads++;
        return "";
      },
    },
  });

  assert.equal(await backup.pickBackupFile(), null);
  assert.equal(reads, 0);
});

test("a file that cannot be read surfaces the failure", async () => {
  const backup = loadBackup({
    "@tauri-apps/plugin-dialog": { open: async () => "/missing.harbx" },
    "@tauri-apps/plugin-fs": {
      readTextFile: async () => {
        throw new Error("ENOENT");
      },
    },
  });

  await assert.rejects(() => backup.pickBackupFile(), /ENOENT/);
});

test("a Harbor backup restores under the Compass keys", async () => {
  const { renameHarborKey } = await import("../src/lib/harbor-migration.ts");
  const backup = loadBackup({ "@/lib/harbor-migration": { renameHarborKey } });

  const parsed = backup.parseBackup(
    JSON.stringify({
      format: "harbor-backup",
      version: 1,
      app: "0.9.0",
      data: { "harbor.settings": "{}", "harbor.auth": "secret", "compass.theme": "dark" },
    }),
  );

  assert.ok(parsed.ok);
  assert.deepEqual(parsed.backup.data, { "compass.settings": "{}", "compass.theme": "dark" });
  assert.equal(parsed.backup.format, "compass-backup");
});
