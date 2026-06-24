// apps/editor/src/components/RichTextEditor.tsx
//
// Inline rich text editor — overlays a contenteditable div over the canvas
// text node when double-clicked. Supports:
//   - Multiline (Enter key)
//   - Per-selection formatting: Bold (Cmd+B), Italic (Cmd+I)
//   - Color picker, font size override via a floating format toolbar
//   - Dismiss: Escape, Cmd+Enter, or click outside
//
// The DOM state is serialized to TextSpan[] on every input event and written
// to node.props.spans via setSpansAndTextOp.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Node } from "core";
import type { TextSpan } from "core";
import type { ColorOKLCH } from "core";
import { setSpansAndTextOp } from "../commands/text-span-ops";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import type { FitTransform } from "../viewport/geometry";
import { compToScreen } from "../viewport/geometry";
import { oklchToHex } from "renderer-webgl";

// ── DOM → spans serialization ─────────────────────────────────────────────

/** Walk a contenteditable container and extract a flat TextSpan[] from it. */
function domToSpans(container: HTMLElement): TextSpan[] {
  const spans: TextSpan[] = [];

  function extractStyle(el: HTMLElement): Partial<TextSpan> {
    const style: Partial<TextSpan> = {};
    const cs = window.getComputedStyle(el);
    const fw = cs.fontWeight;
    if (Number(fw) >= 600 || fw === "bold" || el.tagName === "B" || el.tagName === "STRONG") style.weight = 700;
    if (cs.fontStyle === "italic" || el.tagName === "I" || el.tagName === "EM") style.italic = true;
    const color = el.dataset.color;
    if (color) {
      try { style.color = JSON.parse(color) as ColorOKLCH; } catch { /* ignore */ }
    }
    const size = el.dataset.fontSize;
    if (size) style.fontSize = Number(size);
    return style;
  }

  function walk(node: ChildNode, inheritedStyle: Partial<TextSpan> = {}): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) spans.push({ text, ...inheritedStyle });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      spans.push({ text: "\n" });
      return;
    }
    const style = { ...inheritedStyle, ...extractStyle(el) };
    if (el.tagName === "DIV" && spans.length > 0 && spans[spans.length - 1]?.text !== "\n") {
      spans.push({ text: "\n" });
    }
    for (const child of Array.from(el.childNodes)) walk(child, style);
  }

  for (const child of Array.from(container.childNodes)) walk(child);
  return spans.filter((s) => s.text !== undefined);
}

// ── Spans → DOM initialization ────────────────────────────────────────────

function spansToHtml(spans: TextSpan[], baseColor: ColorOKLCH): string {
  if (!spans.length) return "";
  let html = "";
  let lineBuffer = "";

  function spanToInline(span: TextSpan): string {
    const text = span.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const hasStyle = span.weight === 700 || span.italic || span.color || span.fontSize;
    if (!hasStyle) return text;
    const dataAttrs = [
      span.color ? `data-color='${JSON.stringify(span.color)}'` : "",
      span.fontSize ? `data-font-size='${span.fontSize}'` : "",
    ].filter(Boolean).join(" ");
    const styles = [
      span.weight === 700 ? "font-weight:700" : "",
      span.italic ? "font-style:italic" : "",
      span.fontSize ? `font-size:${span.fontSize}px` : "",
      span.color ? `color:#${oklchToHex(span.color).toString(16).padStart(6, "0")}` : "",
    ].filter(Boolean).join(";");
    return `<span style="${styles}" ${dataAttrs}>${text}</span>`;
  }

  for (const span of spans) {
    if (span.text === "\n") {
      html += `<div>${lineBuffer || "<br>"}</div>`;
      lineBuffer = "";
    } else {
      lineBuffer += spanToInline(span);
    }
  }
  if (lineBuffer) html += `<div>${lineBuffer}</div>`;
  return html;
}

// ── Format toolbar ────────────────────────────────────────────────────────

interface FormatState {
  bold: boolean;
  italic: boolean;
  color: string; // hex
  fontSize: string;
}

function getFormatState(): FormatState {
  return {
    bold: document.queryCommandState("bold"),
    italic: document.queryCommandState("italic"),
    color: document.queryCommandValue("foreColor") || "#ffffff",
    fontSize: "",
  };
}

function FormatToolbar({
  visible,
  position,
  baseColor,
  onBold,
  onItalic,
  onColor,
}: {
  visible: boolean;
  position: { x: number; y: number };
  baseColor: ColorOKLCH;
  onBold: () => void;
  onItalic: () => void;
  onColor: (hex: string) => void;
}) {
  if (!visible) return null;
  const fmt = getFormatState();
  const baseHex = `#${oklchToHex(baseColor).toString(16).padStart(6, "0")}`;

  return (
    <div
      className="rich-text-toolbar"
      style={{ position: "fixed", left: position.x, top: position.y - 44, zIndex: 100 }}
      onPointerDown={(e) => e.preventDefault()} // don't steal focus
    >
      <button className={`rtt-btn${fmt.bold ? " rtt-btn--active" : ""}`} title="Bold (⌘B)" tabIndex={0} onClick={onBold}>
        <b>B</b>
      </button>
      <button className={`rtt-btn${fmt.italic ? " rtt-btn--active" : ""}`} title="Italic (⌘I)" tabIndex={0} onClick={onItalic}>
        <i>I</i>
      </button>
      <span className="rtt-sep" />
      <label className="rtt-color" title="Text color">
        <input type="color" defaultValue={baseHex} onChange={(e) => onColor(e.target.value)} />
        <span className="rtt-color-swatch" style={{ background: fmt.color !== "rgb(0, 0, 0)" ? fmt.color : baseHex }} />
      </label>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

interface RichTextEditorProps {
  node: Node;
  fit: FitTransform;
  onDismiss: () => void;
}

export function RichTextEditor({ node, fit, onDismiss }: RichTextEditorProps) {
  const store = useEditorStoreApi();
  const editorRef = useRef<HTMLDivElement>(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [toolbarPos, setToolbarPos] = useState({ x: 0, y: 0 });
  const suppressNextChange = useRef(false);

  const fontSize = (node.props.fontSize as number) ?? 64;
  const fontFamily = (node.props.fontFamily as string) ?? "Inter";
  const fontWeight = (node.props.weight as number) ?? 400;
  const lineHeight = (node.props.lineHeight as number) ?? 1.2;
  const baseColor = (node.props.fill as ColorOKLCH) ?? { l: 1, c: 0, h: 0 };
  const scaledFontSize = fontSize * fit.scale;

  const spans = (node.props.spans as unknown as TextSpan[] | undefined);
  const plainText = (node.props.text as string) ?? "";

  // Initialize HTML from spans or plain text
  const initialHtml = spans?.length
    ? spansToHtml(spans, baseColor)
    : plainText.split("\n").map((l) => `<div>${l || "<br>"}</div>`).join("");

  // Position overlay at the node's canvas position
  const screenPos = compToScreen(
    { x: node.transform.position.x, y: node.transform.position.y },
    fit
  );

  // Focus + place cursor at end on mount
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    suppressNextChange.current = true;
    el.innerHTML = initialHtml;
    suppressNextChange.current = false;
    el.focus();
    // Place cursor at end
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismiss on Escape / Cmd+Enter
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onDismiss(); return; }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onDismiss(); return; }
    e.stopPropagation();
  }, [onDismiss]);

  // Serialize DOM → spans on every input
  const handleInput = useCallback(() => {
    if (suppressNextChange.current) return;
    const el = editorRef.current;
    if (!el) return;
    const newSpans = domToSpans(el);
    const state = store.getState();
    state.apply(setSpansAndTextOp(activeComp(state), node.id, newSpans));
  }, [store, node.id]);

  // Show/hide format toolbar on selection change
  useEffect(() => {
    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !editorRef.current?.contains(sel.anchorNode)) {
        setToolbarVisible(false);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setToolbarPos({ x: rect.left + rect.width / 2 - 60, y: rect.top });
      setToolbarVisible(true);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  function applyBold() {
    document.execCommand("bold");
    handleInput();
  }

  function applyItalic() {
    document.execCommand("italic");
    handleInput();
  }

  function applyColor(hex: string) {
    document.execCommand("foreColor", false, hex);
    handleInput();
  }

  const baseHex = `#${oklchToHex(baseColor).toString(16).padStart(6, "0")}`;

  return (
    <>
      <FormatToolbar
        visible={toolbarVisible}
        position={toolbarPos}
        baseColor={baseColor}
        onBold={applyBold}
        onItalic={applyItalic}
        onColor={applyColor}
      />
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="rich-text-editor"
        style={{
          position: "absolute",
          left: screenPos.x,
          top: screenPos.y,
          minWidth: Math.max(120, scaledFontSize * 6),
          minHeight: scaledFontSize * lineHeight + 8,
          fontFamily,
          fontSize: scaledFontSize,
          fontWeight,
          lineHeight,
          color: baseHex,
          background: "rgba(0,0,0,0.5)",
          border: "1.5px solid var(--accent)",
          borderRadius: "var(--radius-sm)",
          padding: "4px 8px",
          outline: "none",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          boxSizing: "border-box",
          zIndex: 20,
          caretColor: "var(--accent)",
          backdropFilter: "blur(1px)",
          cursor: "text",
        }}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onBlur={(e) => {
          // Don't dismiss if focus moved to the format toolbar
          const related = e.relatedTarget as HTMLElement | null;
          if (related?.closest(".rich-text-toolbar")) return;
          onDismiss();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </>
  );
}