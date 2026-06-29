// apps/editor/src/components/EffectsBrowser.tsx
//
// The redesigned effect PICKER (Deliverable: "category-based browsing").
// Replaces the old flat <select> "Add effect" dropdown. Browsable panel:
// search box + category filter chips + a grid of effect cards (each a small
// preview tile, name and category dot). Clicking a card calls `onAdd(effect)`
// — exactly the key the old dropdown's <option value> carried, so the wiring
// in EffectStackPanel (addEffectOp) is unchanged.
//
// Pure presentation + local view state (search text, active category). No
// store/registry mutation happens here.

import { useMemo, useState } from "react";
import { CATEGORIES, categoryOf, categoryMeta, previewBackground, effectAbbr } from "../inspector/effect-categories";
import type { CategoryId } from "../inspector/effect-categories";

interface DefLike {
  effect: string;
  displayName: string;
  category?: string;
  description?: string;
}

export function EffectsBrowser({
  effects,
  addedKeys,
  onAdd,
}: {
  effects: DefLike[];
  addedKeys: ReadonlySet<string>;
  onAdd: (effect: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<CategoryId | "all">("all");

  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const visible = cat === "all" ? CATEGORIES : CATEGORIES.filter((c) => c.id === cat);
    return visible
      .map((c) => {
        const cards = effects
          .filter((def) => categoryOf(def) === c.id)
          .filter(
            (def) =>
              !q ||
              def.displayName.toLowerCase().includes(q) ||
              (def.description ?? "").toLowerCase().includes(q),
          );
        return { meta: c, cards };
      })
      .filter((g) => g.cards.length > 0);
  }, [effects, cat, q]);

  const empty = groups.length === 0;

  return (
    <div className="fx-browser">
      {/* Search */}
      <div className="fx-browser__search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${effects.length} effects…`}
        />
        {q.length > 0 && (
          <button type="button" className="fx-browser__clear" onClick={() => setQuery("")} aria-label="Clear search">×</button>
        )}
      </div>

      {/* Category chips */}
      <div className="fx-browser__chips">
        <button
          type="button"
          className="fx-chip"
          aria-pressed={cat === "all"}
          onClick={() => setCat("all")}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="fx-chip"
            aria-pressed={cat === c.id}
            onClick={() => setCat(c.id)}
          >
            <span className="fx-chip__dot" style={{ background: c.color }} />
            {c.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="fx-browser__results">
        {empty && <div className="fx-browser__empty">No effects match “{query}”.</div>}
        {groups.map(({ meta, cards }) => (
          <div key={meta.id} className="fx-browser__group">
            <div className="fx-browser__grouphead">
              <span className="fx-browser__groupdot" style={{ background: meta.color }} />
              <span className="fx-browser__grouplabel">{meta.label}</span>
              <span className="fx-browser__groupcount">{cards.length}</span>
            </div>
            <div className="fx-browser__grid">
              {cards.map((def) => {
                const added = addedKeys.has(def.effect);
                return (
                  <button
                    key={def.effect}
                    type="button"
                    className="fx-card"
                    title={def.description ?? def.displayName}
                    onClick={() => onAdd(def.effect)}
                  >
                    <div className="fx-card__thumb" style={{ background: previewBackground(meta.color) }}>
                      <span className="fx-card__abbr">{effectAbbr(def.displayName)}</span>
                      {added && (
                        <span className="fx-card__added" aria-label="Already added">
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        </span>
                      )}
                    </div>
                    <div className="fx-card__foot">
                      <span className="fx-card__dot" style={{ background: meta.color }} />
                      <span className="fx-card__name">{def.displayName}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
