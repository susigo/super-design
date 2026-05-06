import { useCallback, useEffect, useRef, useState } from 'react';
import {
  extractDesignSystemImport,
  saveDesignSystemImport,
  stageDesignSystemImport,
  type StagedDesignSystemFile,
} from '../providers/design-system-import';

// "Sample importer" dialog. Lifecycle:
//   idle → uploading → extracting → editable preview → saved/failed
//
// We pull the user's BYOK creds from the parent (passed in via props)
// rather than re-asking for them. If creds are missing we render a
// prompt directing the user to Settings instead of making them juggle
// keys here.

interface Props {
  apiBaseUrl?: string;
  apiKey?: string;
  apiModel?: string;
  apiProtocol?: 'anthropic' | 'openai';
  onClose: () => void;
  onSaved: (id: string) => void;
}

type Phase = 'idle' | 'uploading' | 'extracting' | 'preview' | 'saving';

type StagedFile = StagedDesignSystemFile;

export function ImportDesignSystemDialog({
  apiBaseUrl,
  apiKey,
  apiModel,
  apiProtocol = 'anthropic',
  onClose,
  onSaved,
}: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedFile | null>(null);
  const [body, setBody] = useState('');
  const [slug, setSlug] = useState('');
  const [hint, setHint] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const credsReady = Boolean(apiBaseUrl && apiKey && apiModel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stage = useCallback(async (file: File) => {
    setPhase('uploading');
    setError(null);
    try {
      setStaged(await stageDesignSystemImport(file));
      setPhase('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
    }
  }, []);

  const extract = useCallback(async () => {
    if (!staged || !credsReady) return;
    setPhase('extracting');
    setError(null);
    try {
      const data = await extractDesignSystemImport({
        stagingId: staged.stagingId,
        baseUrl: apiBaseUrl,
        apiKey,
        model: apiModel,
        protocol: apiProtocol,
        hint: hint.trim() || undefined,
      });
      setSlug(data.slug);
      setBody(data.body);
      setPhase('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
    }
  }, [staged, credsReady, apiBaseUrl, apiKey, apiModel, apiProtocol, hint]);

  const save = useCallback(async () => {
    if (!body.trim() || !slug.trim()) return;
    setPhase('saving');
    setError(null);
    try {
      const savedId = await saveDesignSystemImport({ slug: slug.trim(), body });
      onSaved(savedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('preview');
    }
  }, [body, slug, onSaved]);

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal modal-settings"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import design system"
        style={{ maxWidth: 880 }}
      >
        <header className="modal-head">
          <span className="kicker">导入</span>
          <h2>从素材生成 DESIGN.md</h2>
          <p className="subtitle">
            拖入图片 / PDF / HTML / ZIP,vision 模型自动抽取 9 节 DESIGN.md。
          </p>
        </header>
        <div className="modal-body" style={{ display: 'block', padding: 18 }}>
          {!credsReady ? (
            <div className="empty-card">
              请先在 <strong>Settings → Execution mode</strong> 里配置 API
              provider(必须支持 vision 输入),再来导入。
            </div>
          ) : null}

          {!staged ? (
            <DropZone
              disabled={!credsReady || phase === 'uploading'}
              onPick={(file) => stage(file)}
              onChooseClick={() => fileRef.current?.click()}
            />
          ) : (
            <div
              style={{
                border: '1px solid var(--border, #e5e5e5)',
                borderRadius: 6,
                padding: 12,
                marginBottom: 12,
                fontSize: 13,
              }}
            >
              <strong>已暂存</strong>
              <span style={{ marginLeft: 8, opacity: 0.7 }}>
                {staged.originalName || staged.stagingId} ·{' '}
                {(staged.size / 1024).toFixed(1)} KB · {staged.mime}
              </span>
              <button
                type="button"
                className="ghost"
                style={{ marginLeft: 12 }}
                onClick={() => setStaged(null)}
                disabled={phase === 'extracting' || phase === 'saving'}
              >
                重新选择
              </button>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf,text/html,.html,.zip"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void stage(f);
              e.target.value = '';
            }}
          />

          {staged && phase !== 'preview' ? (
            <div style={{ marginTop: 12 }}>
              <label
                htmlFor="import-hint"
                style={{ fontSize: 12, fontWeight: 600 }}
              >
                Hint (optional)
              </label>
              <textarea
                id="import-hint"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="e.g. focus on the dashboard section, or 'this is a fintech brand'"
                rows={2}
                style={{
                  width: '100%',
                  marginTop: 4,
                  fontSize: 12,
                }}
              />
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  marginTop: 12,
                  alignItems: 'center',
                }}
              >
                <button
                  type="button"
                  onClick={extract}
                  disabled={
                    !credsReady ||
                    phase === 'extracting' ||
                    phase === 'uploading'
                  }
                >
                  {phase === 'extracting'
                    ? 'Extracting…'
                    : '开始 vision 抽取'}
                </button>
                {phase === 'extracting' ? (
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    上限 90 秒,如超时会自动放弃。
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {phase === 'preview' || phase === 'saving' ? (
            <div style={{ marginTop: 12 }}>
              <div className="form-row" style={{ marginBottom: 8 }}>
                <label htmlFor="ds-slug">Slug</label>
                <input
                  id="ds-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </div>
              <label
                htmlFor="ds-body"
                style={{ fontSize: 12, fontWeight: 600 }}
              >
                DESIGN.md (可手改后保存)
              </label>
              <textarea
                id="ds-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={20}
                style={{
                  width: '100%',
                  marginTop: 4,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                }}
              />
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={save}
                  disabled={phase === 'saving' || !body.trim() || !slug.trim()}
                >
                  {phase === 'saving' ? 'Saving…' : '保存为 design system'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setPhase('idle')}
                >
                  返回上一步
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              className="empty-card"
              style={{ marginTop: 12, color: 'var(--text-warn, #c44)' }}
            >
              {error}
            </div>
          ) : null}
        </div>
        <footer className="modal-foot">
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

function DropZone({
  disabled,
  onPick,
  onChooseClick,
}: {
  disabled: boolean;
  onPick: (file: File) => void;
  onChooseClick: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onPick(file);
      }}
      style={{
        border: `2px dashed ${over ? '#5b8dff' : 'var(--border, #c5c5c5)'}`,
        borderRadius: 6,
        padding: 28,
        textAlign: 'center',
        background: over ? 'rgba(91,141,255,0.05)' : 'transparent',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onClick={() => !disabled && onChooseClick()}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>
        拖入图片 / PDF / HTML / ZIP
      </div>
      <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>
        或点击选择文件 · 上限 100 MB · 仅本机存储
      </div>
    </div>
  );
}
