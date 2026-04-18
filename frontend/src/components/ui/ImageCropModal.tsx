// Модалка обрезки изображения. Используется для аватарок пользователей и серверов.

import { useState, useRef, useCallback } from 'react';
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { X, RotateCw } from 'lucide-react';
import { useT } from '../../i18n';

interface ImageCropModalProps {
  src: string;
  /** Форма обрезки: circle для аватарок, square для серверов */
  shape?: 'circle' | 'square';
  onCrop: (file: File) => void;
  onClose: () => void;
}

function centerAspectCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 80 }, 1, width, height),
    width,
    height
  );
}

export function ImageCropModal({ src, shape = 'circle', onCrop, onClose }: ImageCropModalProps) {
  const t = useT();
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop>();
  const [rotation, setRotation] = useState(0);

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    setCrop(centerAspectCrop(w, h));
  }, []);

  const handleCrop = useCallback(async () => {
    const img = imgRef.current;
    if (!img || !crop) return;

    const canvas = document.createElement('canvas');
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;

    // Конвертируем crop в пиксели натурального изображения
    let cropX: number, cropY: number, cropW: number, cropH: number;
    if (crop.unit === '%') {
      cropX = (crop.x / 100) * natW;
      cropY = (crop.y / 100) * natH;
      cropW = (crop.width / 100) * natW;
      cropH = (crop.height / 100) * natH;
    } else {
      const scaleX = natW / img.width;
      const scaleY = natH / img.height;
      cropX = crop.x * scaleX;
      cropY = crop.y * scaleY;
      cropW = crop.width * scaleX;
      cropH = crop.height * scaleY;
    }

    const outputSize = Math.min(Math.max(cropW, cropH), 512);

    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d')!;

    if (rotation !== 0) {
      ctx.translate(outputSize / 2, outputSize / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-outputSize / 2, -outputSize / 2);
    }

    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, outputSize, outputSize);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          onCrop(new File([blob], 'avatar.png', { type: 'image/png' }));
          onClose();
        }
      },
      'image/png',
      1
    );
  }, [crop, rotation, onCrop, onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="bg-[var(--bg-secondary)] rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('crop.title')}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-[var(--text-muted)]">
            <X size={16} />
          </button>
        </div>

        {/* Crop area */}
        <div className="p-4 flex justify-center" style={{ background: 'var(--bg-tertiary)' }}>
          <ReactCrop
            crop={crop}
            onChange={(_, percentCrop) => setCrop(percentCrop)}
            aspect={1}
            circularCrop={shape === 'circle'}
            className="max-h-[50vh]"
          >
            <img
              ref={imgRef}
              src={src}
              alt=""
              onLoad={onImageLoad}
              className="max-h-[50vh] object-contain"
              style={{ transform: `rotate(${rotation}deg)` }}
            />
          </ReactCrop>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-color)]">
          <button
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 transition-colors"
          >
            <RotateCw size={14} />
            {t('crop.rotate')}
          </button>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-[var(--text-secondary)] hover:bg-white/10 transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleCrop}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
            >
              {t('crop.apply')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
