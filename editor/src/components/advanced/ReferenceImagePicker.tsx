import { useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import type { ReferenceImage } from "../../providers/types";

function shouldRevokeReferenceUrl(image: ReferenceImage): boolean {
  return image.blob_url.startsWith("blob:") && (image.source === "upload" || image.source === "sketch" || image.source === "clipboard");
}

function revokeReferenceUrl(image: ReferenceImage): void {
  if (shouldRevokeReferenceUrl(image)) URL.revokeObjectURL(image.blob_url);
}

export function ReferenceImagePicker({ images, onChange }: { images: ReferenceImage[]; onChange: (images: ReferenceImage[]) => void }) {
  const previousImagesRef = useRef(images);
  const latestImagesRef = useRef(images);

  useEffect(() => {
    const nextIds = new Set(images.map((image) => image.image_id));
    for (const previous of previousImagesRef.current) {
      if (!nextIds.has(previous.image_id)) revokeReferenceUrl(previous);
    }
    previousImagesRef.current = images;
    latestImagesRef.current = images;
  }, [images]);

  useEffect(() => () => {
    for (const image of latestImagesRef.current) revokeReferenceUrl(image);
  }, []);

  function updateImage(imageId: string, patch: Partial<Pick<ReferenceImage, "note" | "weight">>) {
    onChange(images.map((image) => image.image_id === imageId ? { ...image, ...patch } : image));
  }

  return (
    <section className="advanced-card compact">
      <h3>参考图</h3>
      <label className="file-button" data-help-key="asset.reference">
        选择参考图片
        <input type="file" accept="image/*" multiple onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          const next = files.map((file) => ({
            image_id: `ref_${nanoid(8)}`,
            source: "upload" as const,
            blob_url: URL.createObjectURL(file),
            note: file.name,
            weight: 0.7,
          }));
          onChange([...images, ...next]);
          event.currentTarget.value = "";
        }} />
      </label>
      <div className="generated-grid">
        {images.map((image) => (
          <article className="ai-glow-surface" key={image.image_id}>
            <img src={image.blob_url} alt={image.note ?? image.image_id} />
            <label>
              权重
              <input
                type="number"
                min={0}
                max={1}
                step={0.1}
                value={image.weight}
                data-help-key="asset.referenceWeight"
                onChange={(event) => updateImage(image.image_id, { weight: Math.min(1, Math.max(0, Number.parseFloat(event.target.value) || 0)) })}
              />
            </label>
            <label>
              备注
              <input value={image.note ?? ""} data-help-key="asset.referenceNote" onChange={(event) => updateImage(image.image_id, { note: event.target.value })} />
            </label>
            <button type="button" data-help-key="asset.removeReference" onClick={() => onChange(images.filter((item) => item.image_id !== image.image_id))}>删除</button>
          </article>
        ))}
      </div>
    </section>
  );
}
