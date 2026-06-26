// apps/editor/src/components/ShapePicker.tsx
//
// Visual shape picker shown in the inspector when a shape node is selected.
// Clicking a shape icon sets props.shape (and resets relevant props).
// Replaces the plain <select> for props.shape with an icon grid.

import type { Json } from "core";

export interface ShapeOption {
  value: string;
  label: string;
  icon: React.ReactNode;
}

export const SHAPE_OPTIONS: ShapeOption[] = [
  { value: "rect",     label: "Rectangle", icon: <RectIcon /> },
  { value: "ellipse",  label: "Ellipse",   icon: <EllipseIcon /> },
  { value: "triangle", label: "Triangle",  icon: <TriangleIcon /> },
  { value: "diamond",  label: "Diamond",   icon: <DiamondIcon /> },
  { value: "star",     label: "Star",      icon: <StarIcon /> },
  { value: "ngon",     label: "Polygon",   icon: <NgonIcon /> },
  { value: "arrow",    label: "Arrow",     icon: <ArrowIcon /> },
  { value: "line",     label: "Line",      icon: <LineIcon /> },
];

function RectIcon()     { return <svg viewBox="0 0 20 20"><rect x="2" y="4" width="16" height="12" rx="1" /></svg>; }
function EllipseIcon()  { return <svg viewBox="0 0 20 20"><ellipse cx="10" cy="10" rx="8" ry="6" /></svg>; }
function TriangleIcon() { return <svg viewBox="0 0 20 20"><polygon points="10,2 18,18 2,18" /></svg>; }
function DiamondIcon()  { return <svg viewBox="0 0 20 20"><polygon points="10,2 18,10 10,18 2,10" /></svg>; }
function StarIcon()     { return <svg viewBox="0 0 20 20"><polygon points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7" /></svg>; }
function NgonIcon()     { return <svg viewBox="0 0 20 20"><polygon points="10,1 17.7,5.5 17.7,14.5 10,19 2.3,14.5 2.3,5.5" /></svg>; }
function ArrowIcon()    { return <svg viewBox="0 0 20 20"><polygon points="1,8 13,8 13,4 19,10 13,16 13,12 1,12" /></svg>; }
function LineIcon()     { return <svg viewBox="0 0 20 20"><line x1="2" y1="10" x2="18" y2="10" strokeWidth="2" /></svg>; }

interface ShapePickerProps {
  value: string;
  onChange: (value: Json) => void;
}

export function ShapePicker({ value, onChange }: ShapePickerProps) {
  return (
    <div className="shape-picker">
      {SHAPE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`shape-picker__btn${value === opt.value ? " shape-picker__btn--active" : ""}`}
          title={opt.label}
          onClick={() => onChange(opt.value as Json)}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}