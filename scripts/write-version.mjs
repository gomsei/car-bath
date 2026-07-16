import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "static", "version.json");
const swPath = join(root, "static", "sw.js");
const isDev = process.argv.includes("--dev");

function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const builtAt = new Date().toISOString();
const sha = gitSha();
const version = isDev ? "dev" : sha ? `${sha}@${builtAt}` : builtAt;
const payload = {
  version,
  builtAt,
};

writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`);

const sw = readFileSync(swPath, "utf8").replace(
  /const CACHE_NAME = "car-bath-shell-[^"]+";/,
  `const CACHE_NAME = "car-bath-shell-${version}";`,
);
writeFileSync(swPath, sw);

console.log(`wrote ${output} (version: ${version})`);
