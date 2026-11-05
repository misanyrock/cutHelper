import { pathToFileURL } from "node:url";
import {
  frame,
  projectRanges,
  totalFrames,
  type Project,
} from "../shared/model.js";
const xml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function fcp7(p: Project, editor: "premiere" | "resolve") {
  const m = p.media,
    rs = projectRanges(p),
    rate = Math.round(m.fpsNum / m.fpsDen),
    ntsc = m.fpsDen === 1001 ? "TRUE" : "FALSE";
  const rateXml = `<rate><timebase>${rate}</timebase><ntsc>${ntsc}</ntsc></rate>`;
  const videoFormat = `<width>${m.width}</width><height>${m.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance>`;
  const file = `<file id="source"><name>${xml(m.name)}</name><pathurl>${xml(pathToFileURL(m.path).href)}</pathurl>${rateXml}<duration>${totalFrames(m)}</duration><media><video><samplecharacteristics>${rateXml}${videoFormat}</samplecharacteristics></video><audio><samplecharacteristics><depth>16</depth><samplerate>${m.audioRate}</samplerate></samplecharacteristics><channelcount>${m.audioChannels}</channelcount></audio></media></file>`;
  let emittedFile = false;
  const clips = (audio: boolean, channel = 1) => {
    let cursor = 0;
    return rs
      .map((r, i) => {
        const a = frame(r.startUs, m),
          b = frame(r.endUs, m),
          start = cursor;
        cursor += b - a;
        const id = `${audio ? "a" + channel : "v"}-${i}`;
        const source = emittedFile ? '<file id="source"/>' : file;
        emittedFile = true;
        const links = [
          { id: `v-${i}`, type: "video", track: 1 },
          ...Array.from({ length: m.audioChannels }, (_, j) => ({
            id: `a${j + 1}-${i}`,
            type: "audio",
            track: j + 1,
          })),
        ]
          .map(
            (l) =>
              `<link><linkclipref>${l.id}</linkclipref><mediatype>${l.type}</mediatype><trackindex>${l.track}</trackindex><clipindex>${i + 1}</clipindex></link>`,
          )
          .join("");
        return `<clipitem id="${id}"><name>${xml(m.name)}</name><duration>${totalFrames(m)}</duration>${rateXml}<start>${start}</start><end>${cursor}</end><in>${a}</in><out>${b}</out>${source}<sourcetrack><mediatype>${audio ? "audio" : "video"}</mediatype><trackindex>${audio ? channel : 1}</trackindex></sourcetrack>${links}</clipitem>`;
      })
      .join("");
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="cuthelper"><name>${xml(m.name)} · ${editor === "premiere" ? "Premiere" : "DaVinci Resolve"} 粗剪</name><duration>${rs.reduce((s, r) => s + frame(r.endUs, m) - frame(r.startUs, m), 0)}</duration>${rateXml}<media><video><format><samplecharacteristics>${rateXml}${videoFormat}</samplecharacteristics></format><track>${clips(false)}</track></video><audio><format><samplecharacteristics><depth>16</depth><samplerate>${m.audioRate}</samplerate></samplecharacteristics></format>${Array.from({ length: m.audioChannels }, (_, i) => `<track>${clips(true, i + 1)}</track>`).join("")}</audio></media></sequence></xmeml>`;
}
export function fcpxml(p: Project) {
  const m = p.media,
    rs = projectRanges(p),
    time = (f: number) => `${f * m.fpsDen}/${m.fpsNum}s`;
  let offset = 0;
  const clips = rs
    .map((r, i) => {
      const a = frame(r.startUs, m),
        d = frame(r.endUs, m) - a;
      const result = `<asset-clip name="${xml(m.name)} · ${i + 1}" ref="r2" offset="${time(offset)}" start="${time(a)}" duration="${time(d)}" audioRole="dialogue"/>`;
      offset += d;
      return result;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.9"><resources><format id="r1" frameDuration="${time(1)}" width="${m.width}" height="${m.height}" colorSpace="1-1-1 (Rec. 709)"/><asset id="r2" name="${xml(m.name)}" start="0s" duration="${time(totalFrames(m))}" hasVideo="1" format="r1" hasAudio="1" audioSources="1" audioChannels="${m.audioChannels}" audioRate="${m.audioRate}"><media-rep kind="original-media" src="${xml(pathToFileURL(m.path).href)}"/></asset></resources><library><event name="CutHelper"><project name="${xml(m.name)} 粗剪"><sequence format="r1" duration="${time(offset)}" tcStart="0s" tcFormat="NDF" audioLayout="${m.audioChannels === 1 ? "mono" : "stereo"}" audioRate="${m.audioRate === 44100 ? "44.1k" : "48k"}"><spine>${clips}</spine></sequence></project></event></library></fcpxml>`;
}
