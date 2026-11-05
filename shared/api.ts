import type {
  Loaded,
  Params,
  Project,
  Progress,
  ExportKind,
  Candidate,
  ModelStatus,
  Transcript,
} from "./model.js";
export interface CutHelperAPI {
  importVideo(): Promise<Loaded | null>;
  importDropped(file: File): Promise<Loaded | null>;
  analyze(params: Params): Promise<Candidate[]>;
  modelStatus(): Promise<ModelStatus>;
  downloadModel(): Promise<ModelStatus>;
  importModel(): Promise<ModelStatus | null>;
  transcribe(language: "auto" | "zh" | "en"): Promise<Transcript>;
  preview(project: Project): Promise<string>;
  saveProject(project: Project): Promise<string | null>;
  openProject(): Promise<Loaded | null>;
  exportProject(project: Project, kind: ExportKind): Promise<string | null>;
  cancel(): Promise<void>;
  onProgress(cb: (p: Progress) => void): () => void;
}
declare global {
  interface Window {
    cuthelper?: CutHelperAPI;
  }
}
