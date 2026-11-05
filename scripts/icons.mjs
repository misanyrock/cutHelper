// The editable SVG is the single source of truth. Raster files and OS icon
// containers are committed so builds never require a browser to generate icons.
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const svg = await readFile(
  new URL("../public/icon.svg", import.meta.url),
  "utf8",
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const images = new Map();
try {
  const markup = `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`;
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(markup);
    images.set(
      size,
      await page
        .locator("svg")
        .screenshot({ omitBackground: true, animations: "disabled" }),
    );
    await page.close();
  }
} finally {
  await browser.close();
}
await mkdir("build", { recursive: true });
await writeFile("public/icon.png", images.get(1024));

const icoSizes = [16, 32, 48, 64, 128, 256];
const directory = Buffer.alloc(6 + icoSizes.length * 16);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(icoSizes.length, 4);
let offset = directory.length;
icoSizes.forEach((size, index) => {
  const entry = 6 + index * 16,
    png = images.get(size);
  directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(png.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(
  "build/icon.ico",
  Buffer.concat([directory, ...icoSizes.map((size) => images.get(size))]),
);

const chunks = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
].map(([type, size]) => {
  const png = images.get(size),
    header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(
  8 + chunks.reduce((size, chunk) => size + chunk.length, 0),
  4,
);
await writeFile("build/icon.icns", Buffer.concat([header, ...chunks]));
console.log(
  "Generated public/icon.png, build/icon.icns and build/icon.ico from public/icon.svg",
);
