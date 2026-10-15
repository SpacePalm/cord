// iOS FileAttachmentChip (Media/MediaViews.swift): Label(name, doc.fill | waveform) caption accent, padding 10×7,
// bgInput, radius 8; tap → authenticated download with ProgressRing(22) (monotonic) → share sheet
// (navigator.share({files}) → fallback download). Second taps ignored while downloading; errors silent.
// (shared with actions: Media & links sheet).
import './message.css';
import { useEffect, useRef, useState } from 'react';
import { Icon, ProgressRing } from '../../ui';
import { attachmentDisplayName, downloadWithProgress, isVoiceAttachment, peekDownloaded, shareOrDownload } from './media';

export interface FileAttachmentChipProps {
  /** Attachment URL (protected /api/media/messages/… or public). */
  url: string;
  /** Display name; default = last path segment, decoded. */
  filename?: string;
}

export function FileAttachmentChip(props: FileAttachmentChipProps) {
  const name = props.filename ?? attachmentDisplayName(props.url);
  const [progress, setProgress] = useState<number | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const onTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy.current) return;
    // Downloaded earlier in this session → share right away (still inside the user gesture).
    const cached = peekDownloaded(props.url);
    if (cached) {
      void shareOrDownload(cached, name);
      return;
    }
    busy.current = true;
    setProgress(0);
    downloadWithProgress(props.url, (p) => {
      if (alive.current) setProgress((cur) => (cur === null || p >= cur ? p : cur));
    })
      .then((blob) => shareOrDownload(blob, name))
      .catch(() => {})
      .finally(() => {
        busy.current = false;
        if (alive.current) setProgress(null);
      });
  };

  return (
    <button type="button" className={'m-msg-file' + (progress !== null ? ' is-busy' : '')} onClick={onTap}>
      <span className="m-msg-file-icon">
        {progress !== null ? (
          <ProgressRing value={progress} size={22} />
        ) : (
          <Icon name={isVoiceAttachment(props.url) ? 'waveform' : 'doc.fill'} size={15} strokeWidth={2} />
        )}
      </span>
      <span className="m-msg-file-name">{name}</span>
    </button>
  );
}
