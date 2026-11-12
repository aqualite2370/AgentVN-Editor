import type { NovelProcessJob } from "./processJobTypes";
import type { NovelImportSession, ProgressiveImportJob } from "./types";

export function localNovelTaskTarget(
  job: Pick<NovelProcessJob, "jobId" | "source">,
  session: Pick<NovelImportSession, "session_id" | "document" | "ai_outline">,
  importJob?: Pick<ProgressiveImportJob, "status">,
): "analysis" | "blueprint" | "record" {
  if (job.source !== "mock" || job.jobId !== `mock_novel_process_${session.session_id}` || !session.document) {
    return "record";
  }
  if (!session.ai_outline) return "analysis";
  return importJob ? "blueprint" : "record";
}
