import { useCallback, useEffect, useMemo, useState } from 'react';

// Side panel for the deck preview that lets users fill in
// `<img data-od-image-prompt="…" data-od-image-id="…">` placeholders
// by calling gpt-image-2 through the daemon.
//
// We DO NOT mutate the source HTML on disk from here directly. We
// hand the patched HTML back to the parent via `onPatched(nextSource)`;
// the parent decides whether to refresh the iframe (in-memory) and
// whether to write it back to disk via PUT /api/projects/:id/deck/html.

interface Placeholder {
  id: string;
  prompt: string;
  aspect: string;
  alt: string | null;
  currentSrc: string;
  status: 'idle' | 'generating' | 'done' | 'error';
  error?: string;
}

interface PromptTemplate {
  id: string;
  name: string;
  prompt: string;
  group: string;
}

interface Props {
  source: string;
  projectId: string;
  conversationId?: string | null;
  onPatched: (nextSource: string) => void;
  onClose: () => void;
}

export function DeckImagePanel({
  source,
  projectId,
  conversationId = null,
  onPatched,
  onClose,
}: Props) {
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  // Re-parse placeholders whenever the source changes — this lets the
  // panel pick up new placeholders if the agent appends more slides.
  useEffect(() => {
    setPlaceholders(parsePlaceholders(source));
  }, [source]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTemplates(true);
    fetch('/api/prompt-templates?surface=image')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.templates)
          ? data.templates
          : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data)
              ? data
              : [];
        setPrompts(list.map(normalizeTemplate).filter(Boolean) as PromptTemplate[]);
      })
      .catch(() => setPrompts([]))
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groupedTemplates = useMemo(() => {
    const groups: Record<string, PromptTemplate[]> = {};
    for (const t of prompts) {
      const arr = groups[t.group] ?? (groups[t.group] = []);
      arr.push(t);
    }
    return groups;
  }, [prompts]);

  const updatePlaceholder = useCallback(
    (id: string, patch: Partial<Placeholder>) => {
      setPlaceholders((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
    },
    [],
  );

  const generate = useCallback(
    async (placeholder: Placeholder) => {
      if (!placeholder.prompt.trim()) {
        updatePlaceholder(placeholder.id, {
          status: 'error',
          error: 'prompt is empty',
        });
        return;
      }
      updatePlaceholder(placeholder.id, { status: 'generating', error: undefined });
      const ctrl = new AbortController();
      const timeout = window.setTimeout(() => ctrl.abort(), 90_000);
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/deck/image`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              placeholderId: placeholder.id,
              prompt: placeholder.prompt,
              aspect: placeholder.aspect,
              conversationId,
            }),
            signal: ctrl.signal,
          },
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const msg =
            (errBody && (errBody.error || errBody.message)) || `HTTP ${res.status}`;
          throw new Error(typeof msg === 'string' ? msg : String(msg));
        }
        const data = (await res.json()) as { src: string };
        const patched = patchSourceImage(source, placeholder.id, data.src);
        onPatched(patched);
        updatePlaceholder(placeholder.id, {
          status: 'done',
          currentSrc: data.src,
        });
      } catch (err) {
        const aborted =
          err instanceof Error && err.name === 'AbortError'
            ? 'Timed out (90s).'
            : err instanceof Error
              ? err.message
              : String(err);
        updatePlaceholder(placeholder.id, { status: 'error', error: aborted });
      } finally {
        window.clearTimeout(timeout);
      }
    },
    [projectId, source, conversationId, onPatched, updatePlaceholder],
  );

  return (
    <aside
      className="deck-image-panel"
      style={{
        width: 360,
        background: 'var(--surface, #fff)',
        borderLeft: '1px solid var(--border, #e5e5e5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border, #e5e5e5)',
        }}
      >
        <div>
          <strong>AI 配图</strong>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            gpt-image-2 · {placeholders.length} 个占位符
          </div>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={onClose}
          aria-label="Close"
          title="Close"
        >
          ✕
        </button>
      </header>

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {placeholders.length === 0 ? (
          <div className="empty-card" style={{ fontSize: 12 }}>
            未检测到占位符。
            <br />
            agent 需要在 deck 中输出{' '}
            <code>{'<img data-od-image-prompt="…" data-od-image-id="…" />'}</code>{' '}
            才能在这里出现。
          </div>
        ) : (
          placeholders.map((p) => (
            <div
              key={p.id}
              style={{
                border: '1px solid var(--border, #e5e5e5)',
                borderRadius: 6,
                padding: 10,
                marginBottom: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <code style={{ fontSize: 11 }}>{p.id}</code>
                <span
                  className={`usage-pill status-${p.status}`}
                  style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: pillBg(p.status),
                    color: '#fff',
                  }}
                >
                  {p.status}
                </span>
              </div>

              {Object.keys(groupedTemplates).length > 0 ? (
                <select
                  className="settings-select"
                  style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                  defaultValue=""
                  onChange={(e) => {
                    const tid = e.target.value;
                    if (!tid) return;
                    const t = prompts.find((tt) => tt.id === tid);
                    if (t) updatePlaceholder(p.id, { prompt: t.prompt });
                  }}
                >
                  <option value="">
                    {loadingTemplates
                      ? 'Loading templates…'
                      : '选 prompt 模板…'}
                  </option>
                  {Object.entries(groupedTemplates).map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : null}

              <textarea
                value={p.prompt}
                onChange={(e) =>
                  updatePlaceholder(p.id, { prompt: e.target.value })
                }
                rows={3}
                style={{
                  width: '100%',
                  marginTop: 6,
                  fontFamily: 'inherit',
                  fontSize: 12,
                }}
              />

              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => generate(p)}
                  disabled={p.status === 'generating'}
                >
                  {p.status === 'generating'
                    ? 'Generating…'
                    : p.status === 'done'
                      ? '重生成'
                      : '生成'}
                </button>
                <span style={{ fontSize: 11, opacity: 0.7, alignSelf: 'center' }}>
                  {p.aspect}
                </span>
              </div>

              {p.error ? (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text-warn, #c44)',
                    marginTop: 6,
                  }}
                >
                  {p.error}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function parsePlaceholders(source: string): Placeholder[] {
  if (!source || typeof DOMParser === 'undefined') return [];
  try {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const nodes = Array.from(
      doc.querySelectorAll<HTMLImageElement>('img[data-od-image-prompt]'),
    );
    return nodes.map((node) => {
      const id =
        node.getAttribute('data-od-image-id') ||
        Math.random().toString(36).slice(2);
      const aspect = node.getAttribute('data-od-image-aspect') || '1:1';
      const prompt = node.getAttribute('data-od-image-prompt') || '';
      const alt = node.getAttribute('alt');
      const currentSrc = node.getAttribute('src') || '';
      return {
        id,
        prompt,
        aspect,
        alt,
        currentSrc,
        status: currentSrc ? 'done' : 'idle',
      };
    });
  } catch {
    return [];
  }
}

function patchSourceImage(source: string, placeholderId: string, src: string) {
  // Use DOMParser to do the DOM edit then serialize back. This avoids
  // brittle attribute-order-dependent regex patches and preserves the
  // original whitespace/newlines elsewhere in the document.
  if (typeof DOMParser === 'undefined') return source;
  try {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const node = doc.querySelector(
      `img[data-od-image-id="${cssEscape(placeholderId)}"]`,
    );
    if (!node) return source;
    node.setAttribute('src', src);
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return source;
  }
}

function cssEscape(value: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

function normalizeTemplate(raw: unknown): PromptTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id =
    typeof r.id === 'string'
      ? r.id
      : typeof r.name === 'string'
        ? r.name
        : null;
  const prompt = typeof r.prompt === 'string' ? r.prompt : null;
  if (!id || !prompt) return null;
  const name = typeof r.name === 'string' ? r.name : id;
  const group = inferGroup(id);
  return { id, name, prompt, group };
}

function inferGroup(id: string) {
  if (id.startsWith('profile-avatar')) return 'avatar';
  if (id.startsWith('social-media-post') || id.startsWith('social-')) return 'social';
  if (id.startsWith('game-')) return 'game';
  if (id.startsWith('infographic-')) return 'infographic';
  return 'other';
}

function pillBg(status: Placeholder['status']) {
  if (status === 'idle') return '#9aa';
  if (status === 'generating') return '#5b8dff';
  if (status === 'done') return '#22c8a0';
  return '#c44';
}
