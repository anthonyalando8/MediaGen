// apps/editor/src/components/TextEditOverlay.tsx
//
// Inline text editor — overlays a <textarea> directly on the canvas over
// the selected text node when double-clicked. The textarea is positioned
// and sized to match the rendered text's screen position and font so edits
// feel "in place". Dismisses on blur or Escape, writing the final value
// via setNodeProp.

import { useEffect, useRef } from "react";
import type { Node } from "core";
import { setNodeProp } from "../commands/set-node-prop";
import { useEditorStoreApi } from "../store/context";
import { activeComp } from "../store/selectors";
import type { FitTransform } from "../viewport/geometry";
import { compToScreen } from "../viewport/geometry";

interface TextEditOverlayProps {
  node: Node;
  fit: FitTransform;
  onDismiss: () => void;
}

export function TextEditOverlay({ node, fit, onDismiss }: TextEditOverlayProps) {
  const store = useEditorStoreApi();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus and select all on mount
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
    }
    // Ctrl/Cmd+Enter also dismisses
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onDismiss();
    }
    // Stop propagation so viewport shortcuts (delete, etc.) don't fire
    e.stopPropagation();
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const state = store.getState();
    state.apply(setNodeProp(activeComp(state), node.id, "props.text", e.target.value));
  }

  // Position the textarea at the node's screen-space origin
  const screenPos = compToScreen(
    { x: node.transform.position.x, y: node.transform.position.y },
    fit
  );

  const fontSize = (node.props.fontSize as number) ?? 64;
  const fontFamily = (node.props.fontFamily as string) ?? "Inter";
  const fontWeight = (node.props.weight as number) ?? 400;
  const scaledFontSize = fontSize * fit.scale;
  const text = (node.props.text as string) ?? "";
  const lineCount = text.split("\n").length;
  const lineHeight = (node.props.lineHeight as number) ?? 1.2;

  const style: React.CSSProperties = {
    position: "absolute",
    left: screenPos.x,
    top: screenPos.y,
    // Width: generous default so text doesn't wrap unexpectedly; user can resize
    minWidth: Math.max(120, scaledFontSize * 8),
    minHeight: scaledFontSize * lineHeight * Math.max(lineCount, 1) + scaledFontSize * lineHeight,
    // Font matches the rendered text exactly
    fontFamily,
    fontSize: scaledFontSize,
    fontWeight,
    lineHeight,
    // Transparent background so the canvas text shows through while editing;
    // a subtle border makes the edit area visible
    background: "rgba(0,0,0,0.45)",
    color: "var(--text-0)",
    border: "1.5px solid var(--accent)",
    borderRadius: "var(--radius-sm)",
    padding: "4px 6px",
    outline: "none",
    resize: "both",
    zIndex: 20,
    // Match text node alignment
    textAlign: (node.props.align as React.CSSProperties["textAlign"]) ?? "left",
    caretColor: "var(--accent)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    boxSizing: "border-box",
    backdropFilter: "blur(1px)",
  };

  return (
    <textarea
      ref={textareaRef}
      style={style}
      value={text}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={onDismiss}
      // Prevent viewport pointer events from firing through the textarea
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}