// Poll composer sheet (iOS PollComposerView).
// Large sheet, inline title "Опрос", leading "Отмена"; question + 2…10 options; "Создать опрос" closes
// the sheet immediately and the chat sends (not optimistic; failure → chat error line).
import { useState } from 'react';
import { SheetScreen } from '../../nav/Screen';
import { BarTextButton } from '../../nav/BarButton';
import { present, type SheetCtx } from '../../present/PresentationProvider';
import { CordField } from '../../ui/CordField';
import { CordButton } from '../../ui/CordButton';
import { Icon } from '../../ui/Icon';
import { useMT } from '../../i18n';
import './chat.css';

export interface PollComposerSheetProps extends SheetCtx {
  onCreate: (question: string, options: string[]) => void;
}

const MAX_OPTIONS = 10;
const MAX_LEN = 200;

export function PollComposerSheet({ dismiss, onCreate }: PollComposerSheetProps) {
  const t = useMT();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const canCreate = question.trim().length > 0 && options.filter((o) => o.trim()).length >= 2;

  return (
    <SheetScreen
      title={t('pollComposer.title')}
      leading={<BarTextButton onPress={() => void dismiss()}>{t('pollComposer.cancel')}</BarTextButton>}
      contentStyle={{ padding: 20 }}
    >
      <div className="m-chat-poll">
        <CordField
          label={t('pollComposer.questionLabel')}
          placeholder={t('pollComposer.questionPlaceholder')}
          value={question}
          onChange={setQuestion}
          maxLength={MAX_LEN}
        />
        <div className="m-chat-poll-label">{t('pollComposer.optionsLabel')}</div>
        {options.map((opt, i) => (
          <div className="m-chat-poll-option" key={i}>
            <CordField
              placeholder={t('pollComposer.optionPlaceholder', i + 1)}
              value={opt}
              onChange={(v) => setOptions((list) => list.map((o, j) => (j === i ? v : o)))}
              maxLength={MAX_LEN}
              style={{ flex: 1, minWidth: 0 }}
            />
            {options.length > 2 && (
              <button
                type="button"
                className="m-chat-poll-remove"
                aria-label={t('chat.m.removeOption')}
                onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}
              >
                <Icon name="minus.circle.fill" size={23} color="var(--text-muted)" />
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_OPTIONS && (
          <button type="button" className="m-chat-poll-add" onClick={() => setOptions((list) => [...list, ''])}>
            <Icon name="plus" size={18} strokeWidth={2} />
            <span>{t('pollComposer.addOption')}</span>
          </button>
        )}
        <CordButton
          disabled={!canCreate}
          style={{ marginTop: 6 }}
          onPress={() => {
            const q = question;
            const opts = options;
            void dismiss();
            onCreate(q, opts);
          }}
        >
          {t('pollComposer.create')}
        </CordButton>
      </div>
    </SheetScreen>
  );
}

/** Present the poll composer as a large sheet. */
export function openPollComposer(onCreate: (question: string, options: string[]) => void): void {
  present.presentSheet((ctx) => <PollComposerSheet {...ctx} onCreate={onCreate} />);
}
