import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const file = ".cache/speech-tests/ggml-tiny.bin";
const hash = "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21";
async function valid() {
  try {
    return (
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex") === hash
    );
  } catch {
    return false;
  }
}
if (!(await valid())) {
  await mkdir(".cache/speech-tests", { recursive: true });
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
      file,
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin",
    ],
    { stdio: "inherit" },
  );
  if (!(await valid())) throw new Error("Speech test model checksum mismatch");
}
const sample = ".cache/speech-tests/jfk.wav";
const sampleHash =
  "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e";
let sampleValid = false;
try {
  sampleValid =
    createHash("sha256")
      .update(await readFile(sample))
      .digest("hex") === sampleHash;
} catch {}
if (!sampleValid) {
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
      ...(proxy ? ["--proxy", proxy] : []),
      "--output",
      sample,
      "https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.9.5/samples/jfk.wav",
    ],
    { stdio: "inherit" },
  );
  if (
    createHash("sha256")
      .update(await readFile(sample))
      .digest("hex") !== sampleHash
  )
    throw new Error("Speech sample checksum mismatch");
}
console.log("Verified offline speech test model and audio");
