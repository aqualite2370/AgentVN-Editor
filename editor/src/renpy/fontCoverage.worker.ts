import { create, type FontFace } from "fontkit";
import { analyzeFontCharacterCoverage } from "./fontCoverage";

interface FontCoverageRequest {
  fontData: ArrayBuffer;
  text: string;
}

interface FontCoverageWorkerScope {
  onmessage: ((event: MessageEvent<FontCoverageRequest>) => void) | null;
  postMessage: (message: unknown) => void;
}

const scope = self as unknown as FontCoverageWorkerScope;

scope.onmessage = (event) => {
  try {
    const parsed = create(new Uint8Array(event.data.fontData));
    const faces: FontFace[] = "fonts" in parsed ? parsed.fonts as FontFace[] : [parsed as FontFace];
    const codePoints = new Set<number>();
    for (const face of faces) {
      for (const codePoint of face.characterSet) codePoints.add(codePoint);
    }
    scope.postMessage({
      status: "success",
      result: analyzeFontCharacterCoverage(codePoints, event.data.text),
    });
  } catch (error) {
    scope.postMessage({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
