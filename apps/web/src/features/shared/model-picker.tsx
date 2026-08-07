"use client";

import { Check, ChevronDown, LockKeyhole, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ModelPickerOption = {
  id: string;
  label: string;
  description: string;
  minPlan: "PLUS" | "PRO" | "ULTRA";
  badges: ("BEST" | "NEW")[];
  locked?: boolean;
};

const PLAN_RANK = { PLUS: 0, PRO: 1, ULTRA: 2 } as const;

export function planAllows(
  current: "PLUS" | "PRO" | "ULTRA" | undefined,
  required: "PLUS" | "PRO" | "ULTRA",
) {
  return PLAN_RANK[current ?? "PLUS"] >= PLAN_RANK[required];
}

function providerClass(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("claude")) return "is-claude";
  if (normalized.includes("gemini") || normalized.includes("banana")) return "is-gemini";
  return "is-openai";
}

export function RichModelPicker({
  label,
  options,
  selectedId,
  disabled = false,
  compact = false,
  onChange,
  onUpgrade,
}: {
  label: string;
  options: ModelPickerOption[];
  selectedId: string | null;
  disabled?: boolean;
  compact?: boolean;
  onChange: (id: string) => void;
  onUpgrade?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === selectedId) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`rich-model-picker ${compact ? "is-compact" : ""}`} ref={rootRef}>
      <button
        className="rich-model-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || !selected}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`model-provider-mark ${providerClass(selected?.label ?? "")}`}>
          <Sparkles aria-hidden="true" size={15} strokeWidth={1.9} />
        </span>
        <strong>{selected?.label ?? "暂无可用模型"}</strong>
        <ChevronDown aria-hidden="true" size={15} />
      </button>

      {open ? (
        <div className="rich-model-menu" role="listbox" aria-label={label}>
          {options.map((option) => {
            const locked = option.locked === true;
            const active = option.id === selected?.id;
            return (
              <button
                className={`rich-model-option ${active ? "is-active" : ""}`}
                type="button"
                role="option"
                aria-selected={active}
                key={option.id}
                onClick={() => {
                  if (locked) {
                    onUpgrade?.();
                    return;
                  }
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span className={`model-provider-mark ${providerClass(option.label)}`}>
                  <Sparkles aria-hidden="true" size={17} strokeWidth={1.9} />
                </span>
                <span className="rich-model-copy">
                  <span>
                    <strong>{option.label}</strong>
                    {option.badges.map((badge) => (
                      <small className={`model-badge is-${badge.toLowerCase()}`} key={badge}>
                        {badge === "BEST" ? "Best" : "New"}
                      </small>
                    ))}
                  </span>
                  <small>{option.description}</small>
                </span>
                {locked ? (
                  <span className="model-upgrade-label">
                    <LockKeyhole aria-hidden="true" size={12} />
                    {option.minPlan === "ULTRA" ? "Ultra" : "Pro"}
                  </span>
                ) : active ? (
                  <Check className="model-selected-check" aria-hidden="true" size={18} />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
