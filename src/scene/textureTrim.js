import { Texture, Rectangle } from 'pixi.js';

/**
 * Midjourney 生成アセットは周囲に大きな透明余白(+ 消し残りの RGB)がある。
 * 不透明部分の相対 bbox {x0,y0,x1,y1} でクロップした Texture を返し、
 * anchor(0.5, 1) がちょうど見た目の底に来るようにする。
 */
export function trimTexture(src, bbox) {
  if (!src || !bbox) return src ?? null;
  const fw = src.source.width;
  const fh = src.source.height;
  const r = new Rectangle(
    bbox.x0 * fw,
    bbox.y0 * fh,
    (bbox.x1 - bbox.x0) * fw,
    (bbox.y1 - bbox.y0) * fh,
  );
  return new Texture({ source: src.source, frame: r });
}
