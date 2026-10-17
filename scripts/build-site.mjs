import { spawnSync } from "node:child_process";
import { readFile, readdir, mkdir, rm, cp, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";

const next = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  stdio: "inherit", env: { ...process.env, MAPLE_PREVIEW_BUILD: "1", NEXT_PUBLIC_PREVIEW_ONLY: "false" },
});
if (next.status !== 0) process.exit(next.status ?? 1);
const assets = {};
const types = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg" };
async function addAsset(source, target) {
  assets[target] = { type: types[path.extname(source)] || "application/octet-stream", body: (await readFile(source)).toString("base64") };
}
async function walk(source, target) {
  for (const item of await readdir(source, { withFileTypes: true })) {
    if (item.isDirectory()) await walk(path.join(source, item.name), `${target}/${item.name}`);
    else if (!item.name.endsWith(".map")) await addAsset(path.join(source, item.name), `${target}/${item.name}`);
  }
}
await addAsset(".next-preview/server/app/index.html", "/index.html");
await walk(".next-preview/static", "/_next/static");
await walk("public", "");
const result = await build({
  entryPoints: ["worker/index.ts"], bundle: true, platform: "browser", format: "esm", target: "es2022", minify: true,
  conditions: ["browser"], write: false, legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "site-assets", setup(api) {
    api.onResolve({ filter: /^@site-assets$/ }, () => ({ path: "site-assets", namespace: "site-assets" }));
    api.onLoad({ filter: /.*/, namespace: "site-assets" }, () => ({ contents: `export const assets=${JSON.stringify(assets)}`, loader: "js" }));
  } }],
});
await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true }); await mkdir("dist/.openai", { recursive: true });
await writeFile("dist/server/index.js", result.outputFiles[0].contents);
await writeFile("dist/server/package.json", '{"type":"module"}\n');
await cp("worker/wrangler.config.json", "dist/server/wrangler.json");
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
console.log(`Built private Sites Worker with ${Object.keys(assets).length} embedded UI assets (${result.outputFiles[0].contents.length} bytes). No secrets are bundled.`);
