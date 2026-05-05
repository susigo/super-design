import { useRef, useState } from 'react';

interface Annotation {
  x: number;
  y: number;
  w: number;
  h: number;
  note: string;
}

interface Props {
  imageUrl: string;
  viewport: string;
  filePath?: string;
  onSendToAgent?: (message: string) => void;
}

export function ScreenshotAnnotation({ imageUrl, viewport, filePath, onSendToAgent }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [drawing, setDrawing] = useState<{ startX: number; startY: number } | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const getRelativePos = (e: React.MouseEvent) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: Math.round(e.clientX - rect.left),
      y: Math.round(e.clientY - rect.top),
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editingIndex !== null) return;
    const pos = getRelativePos(e);
    setDrawing({ startX: pos.x, startY: pos.y });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!drawing) return;
    const pos = getRelativePos(e);
    const w = Math.abs(pos.x - drawing.startX);
    const h = Math.abs(pos.y - drawing.startY);
    if (w > 10 && h > 10) {
      setAnnotations((prev) => [
        ...prev,
        {
          x: Math.min(drawing.startX, pos.x),
          y: Math.min(drawing.startY, pos.y),
          w,
          h,
          note: '',
        },
      ]);
      setEditingIndex(annotations.length);
    }
    setDrawing(null);
  };

  const updateNote = (index: number, note: string) => {
    setAnnotations((prev) => prev.map((a, i) => (i === index ? { ...a, note } : a)));
  };

  const removeAnnotation = (index: number) => {
    setAnnotations((prev) => prev.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  const composeMessage = () => {
    const file = filePath ?? 'the artifact';
    const lines = annotations
      .filter((a) => a.note.trim())
      .map((a) => `- [x:${a.x}, y:${a.y}, ${a.w}x${a.h}]: "${a.note}"`);
    return `I annotated the ${viewport} screenshot of ${file}:\n${lines.join('\n')}`;
  };

  const handleSend = () => {
    if (!onSendToAgent) return;
    const msg = composeMessage();
    if (msg.includes('"')) onSendToAgent(msg);
  };

  return (
    <div className="screenshot-annotation">
      <div
        ref={containerRef}
        className="screenshot-annotation-canvas"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        <img src={imageUrl} alt="Screenshot for annotation" draggable={false} />
        {annotations.map((ann, i) => (
          <div
            key={i}
            className={`screenshot-annotation-rect ${editingIndex === i ? 'editing' : ''}`}
            style={{ left: ann.x, top: ann.y, width: ann.w, height: ann.h }}
            onClick={() => setEditingIndex(i)}
          >
            <span className="screenshot-annotation-number">{i + 1}</span>
          </div>
        ))}
      </div>

      {annotations.length > 0 ? (
        <div className="screenshot-annotation-list">
          {annotations.map((ann, i) => (
            <div key={i} className="screenshot-annotation-entry">
              <span className="screenshot-annotation-badge">{i + 1}</span>
              <input
                type="text"
                className="screenshot-annotation-input"
                placeholder="Add a note..."
                value={ann.note}
                onChange={(e) => updateNote(i, e.target.value)}
                autoFocus={editingIndex === i}
                onFocus={() => setEditingIndex(i)}
              />
              <button
                type="button"
                className="screenshot-annotation-remove"
                onClick={() => removeAnnotation(i)}
              >
                x
              </button>
            </div>
          ))}
          {onSendToAgent ? (
            <button
              type="button"
              className="screenshot-annotation-send"
              onClick={handleSend}
              disabled={annotations.every((a) => !a.note.trim())}
            >
              Send to Agent
            </button>
          ) : null}
        </div>
      ) : (
        <div className="screenshot-annotation-hint">
          Click and drag on the screenshot to add annotations
        </div>
      )}
    </div>
  );
}
