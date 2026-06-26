// apps/editor/src/components/RichTextEditor.tsx
//
// Inline rich text editor — overlays a contenteditable div over the canvas
// text node when double-clicked.
//
// KEY UX DECISIONS:
//   - No onBlur dismiss — the editor stays open while the user interacts
//     with the inspector panel to apply formatting. Dismissed only via
//     Escape, Cmd+Enter, or clicking the canvas outside the text node.
//   - Format controls (Bold/Italic/Color) live in InspectorPanel's
//     RichTextFormatBar, which calls applyRichFormat() exposed via a ref.
//   - The underlying Pixi text is hidden (opacity:0) in the RAF loop while
//     editing, so the canvas and overlay don't both render the same text.

import { useCallback, useLayoutEffect, useRef } from "react";
import type { Node } from "core";
import type { TextSpan } from "core";
import type { ColorOKLCH } from "core";
import { setSpansAndTextOp } from "../commands/text-span-ops";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import type { FitTransform } from "../viewport/geometry";
import { compToScreen } from "../viewport/geometry";
import { hexStringToOklch, oklchToHex, rgbToOklch } from "renderer-webgl";

// ── DOM → spans ───────────────────────────────────────────────────────────

/** Parse CSS color string (rgb/rgba/hex) → ColorOKLCH, or null if unparseable. */
function cssColorToOklch(css: string): ColorOKLCH | null {
  if (!css || css === "inherit" || css === "initial") return null;
  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgb = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return rgbToOklch(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  // hex
  if (css.startsWith("#")) return hexStringToOklch(css);
  return null;
}

function domToSpans(container: HTMLElement): TextSpan[] {
  const spans: TextSpan[] = [];

  function extractStyle(el: HTMLElement): Partial<TextSpan> {
    const style: Partial<TextSpan> = {};
    const cs = window.getComputedStyle(el);
    const fw = cs.fontWeight;
    if (Number(fw) >= 600 || fw === "bold" || el.tagName === "B" || el.tagName === "STRONG") style.weight = 700;
    if (cs.fontStyle === "italic" || el.tagName === "I" || el.tagName === "EM") style.italic = true;

    // data-color takes priority (our own markup from spansToHtml)
    const dataColor = el.dataset.color;
    if (dataColor) {
      try { style.color = JSON.parse(dataColor) as ColorOKLCH; } catch { /* */ }
    } else {
      // inline color from execCommand("foreColor") — comes in as CSS rgb() string
      const inlineColor = el.style.color;
      if (inlineColor) {
        const oklch = cssColorToOklch(inlineColor);
        if (oklch) style.color = oklch;
      }
    }

    const size = el.dataset.fontSize;
    if (size) style.fontSize = Number(size);
    return style;
  }

  function walk(node: ChildNode, inherited: Partial<TextSpan> = {}): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text) spans.push({ text, ...inherited });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") { spans.push({ text: "\n" }); return; }
    const style = { ...inherited, ...extractStyle(el) };
    if (el.tagName === "DIV" && spans.length > 0 && spans[spans.length - 1]?.text !== "\n") {
      spans.push({ text: "\n" });
    }
    for (const child of Array.from(el.childNodes)) walk(child, style);
  }

  for (const child of Array.from(container.childNodes)) walk(child);
  return spans.filter((s) => s.text !== undefined);
}

// ── Spans → HTML ──────────────────────────────────────────────────────────

export function spansToHtml(spans: TextSpan[], baseColor: ColorOKLCH): string {
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

// ── Public format API (called from InspectorPanel) ────────────────────────

export interface RichTextEditorHandle {
  applyBold(): void;
  applyItalic(): void;
  applyColor(hex: string): void;
  saveSelection(): void;
  focus(): void;
}

// ── Main component ────────────────────────────────────────────────────────

interface RichTextEditorProps {
  node: Node;
  fit: FitTransform;
  nodeMatrix: import("contract").Mat3;
  onDismiss: () => void;
  editorHandle?: React.MutableRefObject<RichTextEditorHandle | null>;
}

export function RichTextEditor({ node, fit, nodeMatrix, onDismiss, editorHandle }: RichTextEditorProps) {
  const store = useEditorStoreApi();
  const editorRef = useRef<HTMLDivElement>(null);
  const suppressNextChange = useRef(false);

  const fontSize   = (node.props.fontSize   as number)     ?? 64;
  const fontFamily = (node.props.fontFamily as string)     ?? "Inter";
  const fontWeight = (node.props.weight     as number)     ?? 400;
  const lineHeight = (node.props.lineHeight as number)     ?? 1.2;
  const baseColor  = (node.props.fill       as ColorOKLCH) ?? { l: 1, c: 0, h: 0 };
  const baseHex    = `#${oklchToHex(baseColor).toString(16).padStart(6, "0")}`;

  // Scale is encoded in the world matrix. Extract it:
  // nodeMatrix = [a, b, tx, c, d, ty, 0, 0, 1]
  // scaleX = sqrt(a²+c²), scaleY = sqrt(b²+d²)
  const scaleX = Math.sqrt(nodeMatrix[0] ** 2 + nodeMatrix[3] ** 2);
  const scaleY = Math.sqrt(nodeMatrix[1] ** 2 + nodeMatrix[4] ** 2);
  const rotation = Math.atan2(nodeMatrix[3], nodeMatrix[0]); // radians

  // Position: apply the full viewport fit to node's world-space origin
  const screenPos = compToScreen({ x: nodeMatrix[2], y: nodeMatrix[5] }, fit);

  const scaledFontSize = fontSize * fit.scale * scaleX;

  const spans      = node.props.spans as unknown as TextSpan[] | undefined;
  const plainText  = (node.props.text as string) ?? "";
  const initialHtml = spans?.length
    ? spansToHtml(spans, baseColor)
    : plainText.split("\n").map((l) => `<div>${l || "<br>"}</div>`).join("");

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    suppressNextChange.current = true;
    el.innerHTML = initialHtml;
    suppressNextChange.current = false;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInput = useCallback(() => {
    if (suppressNextChange.current) return;
    const el = editorRef.current;
    if (!el) return;
    const newSpans = domToSpans(el);
    const state = store.getState();
    state.apply(setSpansAndTextOp(activeComp(state), node.id, newSpans));
  }, [store, node.id]);

  // Save/restore selection so color picker doesn't lose the selection range
  const savedRangeRef = useRef<Range | null>(null);

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
  }

  function restoreSelection() {
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }
  }

  // Expose format API so InspectorPanel can drive formatting without stealing focus
  if (editorHandle) {
    editorHandle.current = {
      applyBold() {
        editorRef.current?.focus();
        document.execCommand("bold");
        handleInput();
      },
      applyItalic() {
        editorRef.current?.focus();
        document.execCommand("italic");
        handleInput();
      },
      applyColor(hex) {
        // Restore the selection that was saved when the color picker opened,
        // then apply — without this the selection is lost when focus moved
        // to the color input and execCommand affects nothing.
        editorRef.current?.focus();
        restoreSelection();
        document.execCommand("foreColor", false, hex);
        handleInput();
      },
      saveSelection() {
        saveSelection();
      },
      focus() { editorRef.current?.focus(); },
    };
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onDismiss(); return; }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onDismiss(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); document.execCommand("bold"); handleInput(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === "i") { e.preventDefault(); document.execCommand("italic"); handleInput(); return; }
    e.stopPropagation();
  }, [onDismiss, handleInput]);

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      className="rich-text-editor"
      style={{
        position: "absolute",
        // Position at the node's screen-space origin
        left: screenPos.x,
        top: screenPos.y,
        // Apply node scale and rotation via CSS transform
        transform: rotation !== 0 ? `rotate(${rotation}rad)` : undefined,
        transformOrigin: "0 0",
        minWidth: Math.max(120, scaledFontSize * 4),
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
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}