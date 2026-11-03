declare module "fontkit" {
  export interface FontFace {
    characterSet: number[];
  }

  export interface FontCollection {
    fonts: FontFace[];
  }

  export function create(buffer: Uint8Array): FontFace | FontCollection;
}
