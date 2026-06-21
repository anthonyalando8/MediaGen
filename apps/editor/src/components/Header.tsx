// apps/editor/src/components/Header.tsx
//
// Top app bar (UI/UX redesign). Holds brand identity, the project name/meta,
// the save indicator, the light/dark theme toggle, and the headline workflow
// actions (Preview / Export).
//
// NOTE ON SCOPE: this is presentation only. The composition meta shown here
// (resolution / fps / duration) is illustrative chrome; wire it to
// `activeComp(store)` if you want it live. "Preview" and "Export" are the
// primary-workflow affordances the redesign introduces — they are
// intentionally left without handlers here so this change adds NO behavior;
// attach them to your render/export pipeline when it exists.

import { Download, Moon, Play, Sun, Waves } from "lucide-react";

interface HeaderProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export function Header({ theme, onToggleTheme }: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <Waves size={22} />
        <span className="app-header__brand-name">SeaBytes</span>
      </div>

      <div className="app-header__divider" />

      <div className="app-header__project">
        <span className="app-header__project-name">Untitled Project</span>
        <span className="app-header__project-meta">1920×1080 · 30 fps</span>
      </div>

      <span className="app-header__spacer" />

      <div className="app-header__saved">
        <span className="app-header__saved-dot" />
        All changes saved
      </div>

      <div className="app-header__divider" />

      <button
        className="btn btn-icon btn-outline"
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        aria-label="Toggle theme"
        onClick={onToggleTheme}
      >
        {theme === "dark" ? <Moon size={17} /> : <Sun size={17} />}
      </button>

      <button className="btn btn-outline" title="Preview playback">
        <Play size={15} />
        Preview
      </button>

      <button className="btn btn-primary" title="Export / render">
        <Download size={15} />
        Export
      </button>
    </header>
  );
}
