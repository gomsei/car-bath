import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildTimePath = join(root, "static", ".build-time");
const swPath = join(root, "static", "sw.js");
const indexPath = join(root, "static", "index.html");
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

writeFileSync(buildTimePath, version, "utf8");

const sw = readFileSync(swPath, "utf8").replace(
  /const CACHE_NAME = "car-bath-shell-[^"]+";/,
  `const CACHE_NAME = "car-bath-shell-${version}";`,
);
writeFileSync(swPath, sw);

const indexHtml = readFileSync(indexPath, "utf8").replace(
  /<meta name="app-version" content="[^"]*">/,
  `<meta name="app-version" content="${version}">`,
);
writeFileSync(indexPath, indexHtml);

console.log(`wrote ${buildTimePath} (version: ${version})`);
