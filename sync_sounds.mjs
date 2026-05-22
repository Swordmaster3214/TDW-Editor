import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BASE_URL = process.env.SOUNDS_BASE_URL ?? "https://example.com";
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY ?? "24", 10);

const ROOT = process.cwd();
const SOUNDS_DIR = path.join(ROOT, "sounds");
const SOUNDS_JSON_PATH = path.join(ROOT, "sounds.json");
const MANIFEST_PATH = path.join(ROOT, ".sounds-manifest.txt");

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function readTextIfExists(filePath) {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeTextAtomic(filePath, content) {
  const tmp = `${filePath}.tmp`;
  await fs.promises.writeFile(tmp, content);
  await fs.promises.rename(tmp, filePath);
}

async function downloadToFile(url, outPath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`${url} -> empty response body`);
  }

  const tmp = `${outPath}.tmp`;
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmp));
  await fs.promises.rename(tmp, outPath);
}

async function runPool(items, limit, worker) {
  let index = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  });

  await Promise.all(workers);
}

function isSafeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id);
}

async function main() {
  await fs.promises.mkdir(SOUNDS_DIR, { recursive: true });

  const soundsRes = await fetch(`${BASE_URL}/sounds.json`);
  if (!soundsRes.ok) {
    throw new Error(`sounds.json -> HTTP ${soundsRes.status}`);
  }

  const soundsText = await soundsRes.text();
  const manifestHash = sha256(soundsText);
  const previousHash = await readTextIfExists(MANIFEST_PATH);

  let sounds;
  try {
    sounds = JSON.parse(soundsText);
  } catch (err) {
    throw new Error(`sounds.json is not valid JSON: ${err.message}`);
  }

  if (!Array.isArray(sounds)) {
    throw new Error("sounds.json must be a JSON array");
  }

  const ids = sounds
    .map((entry) => entry?.id)
    .filter(isSafeId);

  const desired = new Set(ids);

  let downloaded = 0;
  let deleted = 0;

  const existingFiles = await fs.promises.readdir(SOUNDS_DIR).catch(() => []);
  for (const file of existingFiles) {
    if (!file.endsWith(".wav")) continue;

    const id = path.basename(file, ".wav");
    if (!desired.has(id)) {
      await fs.promises.unlink(path.join(SOUNDS_DIR, file));
      deleted++;
    }
  }

  await runPool(ids, CONCURRENCY, async (id) => {
    const outPath = path.join(SOUNDS_DIR, `${id}.wav`);

    try {
      await fs.promises.access(outPath, fs.constants.F_OK);
      return;
    } catch {
      // Not cached locally; download it.
    }

    const url = `${BASE_URL}/sounds/${id}.wav`;
    await downloadToFile(url, outPath);
    downloaded++;
  });

  await writeTextAtomic(SOUNDS_JSON_PATH, soundsText);
  await writeTextAtomic(MANIFEST_PATH, `${manifestHash}\n`);

  const cacheChanged = previousHash !== manifestHash;

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const lines = [
      `manifest_hash=${manifestHash}`,
      `cache_changed=${cacheChanged ? "true" : "false"}`,
      `downloaded=${downloaded}`,
      `deleted=${deleted}`,
      `sound_count=${ids.length}`,
    ].join("\n") + "\n";

    await fs.promises.appendFile(outputFile, lines);
  }

  console.log(
    `Done. sounds=${ids.length} downloaded=${downloaded} deleted=${deleted} cache_changed=${cacheChanged}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
