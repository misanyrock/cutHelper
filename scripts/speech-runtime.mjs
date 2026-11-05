import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  access,
  chmod,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const version = "1.9.5";
const checksum =
  "ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720";
const target = path.resolve(
  `.cache/whisper-runtime/${process.platform}-${process.arch}`,
);
const executable = "whisper-cli" + (process.platform === "win32" ? ".exe" : "");
const buildConfigVersion = process.platform === "win32" ? "3-utf8" : 3;
try {
  const stamp = JSON.parse(
    await readFile(path.join(target, "runtime.json"), "utf8"),
  );
  await access(path.join(target, executable));
  if (
    stamp.version === version &&
    stamp.checksum === checksum &&
    stamp.buildConfigVersion === buildConfigVersion
  ) {
    console.log("Offline speech runtime already prepared");
    process.exit(0);
  }
} catch {}
await mkdir(".cache/downloads", { recursive: true });
const archive = path.resolve(`.cache/downloads/whisper-${version}.tar.gz`);
let valid = false;
try {
  valid =
    createHash("sha256")
      .update(await readFile(archive))
      .digest("hex") === checksum;
} catch {}
if (!valid) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  execFileSync(
    "curl",
    [
      "--silent",
      "--show-error",
      "--fail",
      "--location",
      "--retry",
      "2",
      "--connect-timeout",
      "30",
      ...(proxy ? ["--proxy", proxy] : []),
      "--output",
      archive,
      `https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/v${version}`,
    ],
    { stdio: "inherit" },
  );
}
if (
  createHash("sha256")
    .update(await readFile(archive))
    .digest("hex") !== checksum
)
  throw new Error("whisper.cpp source checksum mismatch");
const sourceRoot = path.resolve(".cache/whisper-source");
await mkdir(sourceRoot, { recursive: true });
execFileSync("cmake", ["-E", "tar", "xzf", archive], {
  cwd: sourceRoot,
  stdio: "inherit",
});
const source = path.join(sourceRoot, `whisper.cpp-${version}`),
  build = path.resolve(
    `.cache/whisper-build/${process.platform}-${process.arch}`,
  );
if (process.platform === "win32") {
  const file = path.join(source, "examples", "cli", "CMakeLists.txt");
  const manifest = path
    .resolve("build/windows-speech.manifest")
    .replaceAll("\\", "/");
  await writeFile(
    file,
    (await readFile(file, "utf8")) +
      `\ntarget_sources(whisper-cli PRIVATE "${manifest}")\n`,
  );
}
execFileSync(
  "cmake",
  [
    "-S",
    source,
    "-B",
    build,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_BUILD_EXAMPLES=ON",
    "-DGGML_NATIVE=OFF",
    "-DGGML_OPENMP=OFF",
    "-DGGML_BACKEND_DL=OFF",
    "-DGGML_METAL_EMBED_LIBRARY=ON",
    "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded",
    ...(process.platform === "darwin"
      ? ["-DCMAKE_OSX_DEPLOYMENT_TARGET=13.3"]
      : []),
  ],
  { stdio: "inherit" },
);
execFileSync(
  "cmake",
  [
    "--build",
    build,
    "--config",
    "Release",
    "--target",
    "whisper-cli",
    "--parallel",
    String(Math.min(4, os.availableParallelism())),
  ],
  { stdio: "inherit" },
);
await mkdir(target, { recursive: true });
const binary = path.join(
  build,
  "bin",
  ...(process.platform === "win32" ? ["Release"] : []),
  executable,
);
await copyFile(binary, path.join(target, executable));
await chmod(path.join(target, executable), 0o755);
await copyFile(
  path.join(source, "LICENSE"),
  path.join(target, "WHISPER-LICENSE.txt"),
);
await writeFile(
  path.join(target, "runtime.json"),
  JSON.stringify({
    version,
    checksum,
    buildConfigVersion,
    platform: process.platform,
    arch: process.arch,
  }),
);
console.log("Prepared offline speech runtime:", target);
