import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const UV_VERSION = "0.11.19";

export const UV_SHA256: Record<string, string> = {
  "x86_64-unknown-linux-gnu": "7035608168e106375b36d0c818d537a889c51a8625fe7f8f7cad5e62b947c368",
  "aarch64-unknown-linux-gnu": "83b13ab184a45b7d9a3b0e4b10eaebd50ad41e66cb16dcce8e60aa7be13ae399",
  "x86_64-unknown-linux-musl": "c4c0d0a383413261af5f0f0743e1292f4aafbe907987ed83bd0ac66f0a3d7e20",
  "aarch64-unknown-linux-musl": "767629b64cdf078c32e42819db28d5ca868b8dc7e3a879967fadc3e4f7f66be3",
  "x86_64-apple-darwin": "1585f415cade9f061e7f00fe5b00030a79ccfac60c650242ce639ba946138d40",
  "aarch64-apple-darwin": "d8f59c38e8c4168ee468d423cd63184be12fa6995a4283d41ee1a14d003c9453",
  "x86_64-pc-windows-msvc": "1665fc8e37b5d70a134820d6d7891747471a2ac8bc940ee7af0b69fd03b28d61",
  "aarch64-pc-windows-msvc": "5592a990a9d9901fd0d23992d872f2ec3ca91b7bbd3d5f0bb5e6f42b851493d8",
};

const CPU_NAMES: Record<string, string> = { x64: "x86_64", arm64: "aarch64" };

export function uvTarget(platform: string, arch: string, musl: boolean): string | undefined {
  const cpu = CPU_NAMES[arch];
  if (!cpu) return undefined;
  if (platform === "darwin") return `${cpu}-apple-darwin`;
  if (platform === "win32") return `${cpu}-pc-windows-msvc`;
  if (platform === "linux") return `${cpu}-unknown-linux-${musl ? "musl" : "gnu"}`;
  return undefined;
}

export function uvAssetName(target: string): string {
  return `uv-${target}${target.endsWith("-windows-msvc") ? ".zip" : ".tar.gz"}`;
}

function isMusl(): boolean {
  if (process.platform !== "linux") return false;
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return !report?.header?.glibcVersionRuntime;
}

function executableName(): string {
  return process.platform === "win32" ? "uv.exe" : "uv";
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

export async function ensureUv(storageDir: string, log: (line: string) => void): Promise<string> {
  const binDir = path.join(storageDir, "bin");
  const installDir = path.join(binDir, `uv-${UV_VERSION}`);
  const binary = path.join(installDir, executableName());
  if (await exists(binary)) return binary;

  const target = uvTarget(process.platform, process.arch, isMusl());
  if (!target) {
    throw new Error(`Rationale cannot download uv for ${process.platform}-${process.arch}. Install uv yourself and set rationale.uvPath.`);
  }
  const asset = uvAssetName(target);
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`;
  log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Downloading uv failed: HTTP ${response.status} from ${url}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== UV_SHA256[target]) throw new Error(`The downloaded ${asset} failed its checksum check (got ${digest}).`);

  await fs.mkdir(binDir, { recursive: true });
  const work = await fs.mkdtemp(path.join(binDir, ".download-"));
  try {
    const archivePath = path.join(work, asset);
    const extractDir = path.join(work, "extract");
    await fs.writeFile(archivePath, archive);
    await fs.mkdir(extractDir);
    await extractArchive(archivePath, extractDir);
    const extracted = await findFile(extractDir, executableName());
    if (!extracted) throw new Error(`${asset} did not contain ${executableName()}.`);
    const staged = path.join(work, "staged");
    await fs.mkdir(staged);
    await fs.rename(extracted, path.join(staged, executableName()));
    await fs.chmod(path.join(staged, executableName()), 0o755);
    try {
      await fs.rename(staged, installDir);
    } catch (error) {
      if (!(await exists(binary))) throw error;
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
  await removeOtherVersions(binDir, path.basename(installDir));
  log(`Installed uv ${UV_VERSION} to ${binary}`);
  return binary;
}

async function removeOtherVersions(binDir: string, keep: string): Promise<void> {
  for (const entry of await fs.readdir(binDir)) {
    if (entry.startsWith("uv-") && entry !== keep) await fs.rm(path.join(binDir, entry), { recursive: true, force: true });
  }
}

async function findFile(dir: string, name: string): Promise<string | undefined> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = await findFile(full, name);
      if (found) return found;
    }
  }
  return undefined;
}

function extractArchive(archive: string, destination: string): Promise<void> {
  const tar = process.platform === "win32"
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
    : "tar";
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ["-xf", archive, "-C", destination], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => reject(new Error(`Could not run tar to extract uv: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Extracting uv failed: ${stderr.trim() || `tar exited with code ${code}`}`)));
  });
}
