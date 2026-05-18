import { useEffect, useRef, useState } from "react";
import { gsap }    from "gsap";
import EventBus    from "../runtime/EventBus.js";

/**
 * SubtitleRenderer.jsx
 * --------------------
 * Renders TikTok/Reels-style captions synced to the scene timeline.
 * Listens to EventBus "scene:tick" and shows the active caption.
 *
 * Supports two caption modes:
 *   "block"  — full line appears at once (default)
 *   "word"   — word-by-word karaoke reveal
 *
 * ── Caption data shape ───────────────────────────────────────────
 * captions: [
 *   { at: 0.5, end: 2.0, text: "You won't get away with this.", speaker: "hero" },
 *   { at: 3.5, end: 5.0, text: "Oh yes I will.", speaker: "villain" },
 * ]
 *
 * Props:
 *   captions     — array of timed caption objects
 *   mode         — "block" | "word"
 *   stageWidth   — pixel width of stage (for positioning)
 *   stageHeight  — pixel height
 *   style        — override caption box styles
 */
export default function SubtitleRenderer({
  captions    = [],
  mode        = "block",
  stageWidth  = 360,
  stageHeight = 420,
  style       = {},
}) {
  const [activeCaption, setActiveCaption] = useState(null);
  const [visibleWords,  setVisibleWords]  = useState([]);
  const boxRef     = useRef(null);
  const wordTimers = useRef([]);

  // ── Sync to scene clock via EventBus ─────────────────────────
  useEffect(() => {
    const unsub = EventBus.on("scene:tick", ({ time }) => {
      // Find the caption active at this time
      const found = captions.find(c => time >= c.at && time < c.end);

      if (found !== activeCaption) {
        setActiveCaption(found ?? null);

        if (found) {
          // Animate caption in
          if (boxRef.current) {
            gsap.fromTo(boxRef.current,
              { opacity: 0, y: 8 },
              { opacity: 1, y: 0, duration: 0.15, ease: "power2.out" }
            );
          }

          // Word reveal mode
          if (mode === "word" && found.text) {
            const words  = found.text.split(" ");
            const segDur = (found.end - found.at) / words.length;
            setVisibleWords([]);

            // Clear any pending word timers
            wordTimers.current.forEach(clearTimeout);
            wordTimers.current = [];

            words.forEach((_, i) => {
              const t = setTimeout(() => {
                setVisibleWords(prev => [...prev, i]);
              }, i * segDur * 1000);
              wordTimers.current.push(t);
            });
          }
        } else {
          // Animate caption out
          if (boxRef.current) {
            gsap.to(boxRef.current, { opacity: 0, duration: 0.1 });
          }
          wordTimers.current.forEach(clearTimeout);
          wordTimers.current = [];
          setVisibleWords([]);
        }
      }
    });

    return () => {
      unsub();
      wordTimers.current.forEach(clearTimeout);
    };
  }, [captions, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeCaption) return null;

  const words = activeCaption.text?.split(" ") ?? [];
  const isSpeaker = (s) => activeCaption.speaker === s;

  return (
    <div
      ref={boxRef}
      style={{
        position:  "absolute",
        bottom:    Math.round(stageHeight * 0.10),
        left:      "50%",
        transform: "translateX(-50%)",
        width:     stageWidth * 0.88,
        textAlign: "center",
        pointerEvents: "none",
        zIndex:    10,
        ...style,
      }}
    >
      {/* Speaker label */}
      {activeCaption.speaker && (
        <div style={css.speaker(activeCaption.speaker)}>
          {activeCaption.speaker}
        </div>
      )}

      {/* Caption text */}
      <div style={css.box}>
        {mode === "word" ? (
          // Karaoke word-by-word
          words.map((word, i) => (
            <span
              key={i}
              style={{
                ...css.word,
                opacity:    visibleWords.includes(i) ? 1 : 0.2,
                color:      visibleWords.includes(i) ? "#ffffff" : "#ffffff50",
                fontWeight: visibleWords.includes(i) ? 700 : 400,
                transition: "opacity 0.08s, color 0.08s, font-weight 0.08s",
              }}
            >
              {word}{" "}
            </span>
          ))
        ) : (
          // Block mode — full line
          <span style={css.text}>{activeCaption.text}</span>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const SPEAKER_COLORS = {
  hero:    "#90b4ff",
  villain: "#f87171",
  default: "#ffffff80",
};

const css = {
  box: {
    background:   "rgba(0,0,0,0.65)",
    borderRadius:  8,
    padding:       "6px 12px",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    lineHeight:    1.4,
  },
  text: {
    fontSize:   14,
    color:      "#ffffff",
    fontFamily: "system-ui, sans-serif",
    fontWeight: 600,
    letterSpacing: "0.01em",
  },
  word: {
    fontSize:   14,
    fontFamily: "system-ui, sans-serif",
    display:    "inline",
  },
  speaker: (name) => ({
    fontSize:     10,
    fontFamily:   "monospace",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color:         SPEAKER_COLORS[name] ?? SPEAKER_COLORS.default,
    marginBottom:  3,
  }),
};