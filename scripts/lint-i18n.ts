/**
 * i18n keys linter
 *
 * Check mode (default): bun scripts/lint-i18n.ts
 * Fix mode: bun scripts/lint-i18n.ts --fix
 */

import { Glob } from "bun";
import { readdir } from "fs/promises";
import ru from "../src/i18n/ru";

const FIX_MODE = process.argv.includes("--fix");

const I18N_FILES = [
  "src/i18n/ru.ts",
  "src/i18n/en.ts",
  "src/i18n/rs.ts",
] as const;

async function getAllTsFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Glob("**/*.ts");

  for await (const file of glob.scan({ cwd: dir, absolute: true })) {
    // Exclude i18n directory itself
    if (!file.includes("/i18n/")) {
      files.push(file);
    }
  }

  return files;
}

async function findUsedKeys(files: string[]): Promise<Set<string>> {
  const usedKeys = new Set<string>();
  const allKeys = Object.keys(ru);

  for (const file of files) {
    const content = await Bun.file(file).text();

    for (const key of allKeys) {
      // Check for string literals: "key" or 'key'
      if (content.includes(`"${key}"`) || content.includes(`'${key}'`)) {
        usedKeys.add(key);
      }
    }
  }

  return usedKeys;
}

function findUnusedKeys(usedKeys: Set<string>): string[] {
  const allKeys = Object.keys(ru);
  return allKeys.filter((key) => !usedKeys.has(key));
}

async function removeKeysFromFile(
  filePath: string,
  keysToRemove: Set<string>
): Promise<number> {
  let content = await Bun.file(filePath).text();
  let removedCount = 0;

  for (const key of keysToRemove) {
    // Pattern for single-line string values: key: "value", or key: 'value',
    const singleLinePattern = new RegExp(
      `^\\s*${key}:\\s*["'][^"']*["'],?\\s*\\n`,
      "gm"
    );

    // Pattern for template literals: key: `...`,
    // Uses [\s\S]*? (non-greedy) to match across lines until we find `,
    const templatePattern = new RegExp(
      `^\\s*${key}:\\s*\`[\\s\\S]*?\`,?\\s*\\n`,
      "gm"
    );

    const before = content.length;
    content = content.replace(singleLinePattern, "");
    content = content.replace(templatePattern, "");

    if (content.length < before) {
      removedCount++;
    }
  }

  // Clean up multiple consecutive blank lines
  content = content.replace(/\n\n\n+/g, "\n\n");

  await Bun.write(filePath, content);
  return removedCount;
}

async function main() {
  console.log("Scanning for i18n key usage...\n");

  const tsFiles = await getAllTsFiles("src");
  console.log(`Found ${tsFiles.length} TypeScript files to scan`);

  const usedKeys = await findUsedKeys(tsFiles);
  console.log(`Found ${usedKeys.size} keys used in code`);

  const unusedKeys = findUnusedKeys(usedKeys);

  if (unusedKeys.length === 0) {
    console.log("\n✅ All i18n keys are used!");
    process.exit(0);
  }

  console.log(`\n❌ Found ${unusedKeys.length} unused keys:\n`);
  for (const key of unusedKeys) {
    console.log(`  - ${key}`);
  }

  if (!FIX_MODE) {
    console.log("\nRun with --fix to remove unused keys");
    process.exit(1);
  }

  // Fix mode: remove keys from all i18n files
  console.log("\n🔧 Removing unused keys...\n");

  const keysToRemove = new Set(unusedKeys);

  for (const file of I18N_FILES) {
    const removed = await removeKeysFromFile(file, keysToRemove);
    console.log(`  ${file}: removed ${removed} keys`);
  }

  console.log("\n✅ Done!");
}

main().catch(console.error);
