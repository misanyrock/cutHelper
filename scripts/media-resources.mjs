import { createRequire } from "node:module";
import { mkdir, copyFile, chmod, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
await mkdir("media-resources", { recursive: true });
for (const [name, source] of [
  ["ffmpeg", require("ffmpeg-static")],
  ["ffprobe", require("@ffprobe-installer/ffprobe").path],
]) {
  const target = `media-resources/${name}${process.platform === "win32" ? ".exe" : ""}`;
  await copyFile(source, target);
  await chmod(target, 0o755);
}
await copyFile("docs/THIRD_PARTY.md", "media-resources/THIRD_PARTY.md");
for (const name of ["ffmpeg-static", "@ffprobe-installer/ffprobe"]) {
  try {
    await copyFile(
      require.resolve(name + "/LICENSE"),
      `media-resources/${name.replaceAll("/", "-")}-LICENSE`,
    );
  } catch {}
}
await copyFile(
  require("ffmpeg-static") + ".LICENSE",
  "media-resources/FFmpeg-GPL-LICENSE.txt",
);
await writeFile(
  "media-resources/BUILD.txt",
  `CutHelper media runtime: ${process.platform}/${process.arch}\nFFmpeg: https://ffmpeg.org\nBinaries: https://github.com/eugeneware/ffmpeg-static and https://github.com/SavageCore/node-ffprobe-installer\n`,
);
