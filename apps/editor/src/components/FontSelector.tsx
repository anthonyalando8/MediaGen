// apps/editor/src/components/FontSelector.tsx
//
// A font picker that previews each font in its own typeface.
// Loads a curated set from Google Fonts (injected once into <head>).
// Used by the inspector when rendering props.fontFamily on text nodes.

import { useEffect, useState } from "react";
import type { Json } from "core";

// Curated font list — a mix of display, sans-serif, serif, mono, handwriting.
// Each is a valid Google Fonts family name.
export const FONT_LIST = [
  // Sans-serif (workhorse / title fonts)
  { family: "Inter",           category: "Sans" },
  { family: "Roboto",          category: "Sans" },
  { family: "Open Sans",       category: "Sans" },
  { family: "Montserrat",      category: "Sans" },
  { family: "Poppins",         category: "Sans" },
  { family: "Nunito",          category: "Sans" },
  { family: "Raleway",         category: "Sans" },
  { family: "Lato",            category: "Sans" },
  // Display / impact
  { family: "Bebas Neue",      category: "Display" },
  { family: "Oswald",          category: "Display" },
  { family: "Anton",           category: "Display" },
  { family: "Barlow Condensed",category: "Display" },
  { family: "Black Han Sans",  category: "Display" },
  // Serif
  { family: "Playfair Display",category: "Serif" },
  { family: "Merriweather",    category: "Serif" },
  { family: "Lora",            category: "Serif" },
  { family: "EB Garamond",     category: "Serif" },
  // Handwriting / script
  { family: "Pacifico",        category: "Script" },
  { family: "Dancing Script",  category: "Script" },
  { family: "Satisfy",         category: "Script" },
  { family: "Great Vibes",     category: "Script" },
  // Monospace
  { family: "Source Code Pro", category: "Mono" },
  { family: "Space Mono",      category: "Mono" },
  { family: "Roboto Mono",     category: "Mono" },
] as const;

// Load all fonts once into <head> via a single Google Fonts URL
let fontsInjected = false;
function injectFonts() {
  if (fontsInjected || typeof document === "undefined") return;
  fontsInjected = true;
  const families = FONT_LIST
    .filter((f) => f.family !== "Inter") // Inter is already loaded via CSS
    .map((f) => f.family.replace(/ /g, "+") + ":wght@400;700")
    .join("&family=");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
  document.head.appendChild(link);
}

interface FontSelectorProps {
  value: string;
  onChange: (value: Json) => void;
}

export function FontSelector({ value, onChange }: FontSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => { injectFonts(); }, []);

  const filtered = search.trim()
    ? FONT_LIST.filter((f) => f.family.toLowerCase().includes(search.toLowerCase()))
    : FONT_LIST;

  // Group by category for the dropdown
  const categories = ["Sans", "Display", "Serif", "Script", "Mono"] as const;

  return (
    <div className="font-selector">
      {/* Trigger button — shows current font in its own typeface */}
      <button
        type="button"
        className="font-selector__trigger"
        style={{ fontFamily: value }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-selector__preview">{value}</span>
        <span className="font-selector__arrow">▾</span>
      </button>

      {open && (
        <div className="font-selector__dropdown">
          <input
            className="font-selector__search"
            type="text"
            placeholder="Search fonts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="font-selector__list">
            {categories.map((cat) => {
              const items = filtered.filter((f) => f.category === cat);
              if (!items.length) return null;
              return (
                <div key={cat} className="font-selector__group">
                  <div className="font-selector__group-label">{cat}</div>
                  {items.map((f) => (
                    <button
                      key={f.family}
                      type="button"
                      className={`font-selector__item ${value === f.family ? "font-selector__item--active" : ""}`}
                      style={{ fontFamily: f.family }}
                      onClick={() => { onChange(f.family as Json); setOpen(false); setSearch(""); }}
                    >
                      {f.family}
                    </button>
                  ))}
                </div>
              );
            })}
            {filtered.length === 0 && (
              <div className="font-selector__empty">No fonts match</div>
            )}
          </div>
        </div>
      )}

      {/* Backdrop to close */}
      {open && (
        <div className="font-selector__backdrop" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}