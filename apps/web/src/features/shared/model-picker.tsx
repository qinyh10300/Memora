"use client";

import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

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

function ModelProviderIcon({ label }: { label: string }) {
  const provider = providerClass(label);
  const gradientId = useId().replaceAll(":", "");

  if (provider === "is-claude") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M12 1.9v4.4M12 17.7v4.4M1.9 12h4.4M17.7 12h4.4M4.86 4.86l3.1 3.1M16.04 16.04l3.1 3.1M19.14 4.86l-3.1 3.1M7.96 16.04l-3.1 3.1M7.35 2.95l1.68 4.06M14.97 16.99l1.68 4.06M2.95 16.65l4.06-1.68M16.99 9.03l4.06-1.68M16.65 2.95l-1.68 4.06M9.03 16.99l-1.68 4.06M2.95 7.35l4.06 1.68M16.99 14.97l4.06 1.68"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.7"
        />
      </svg>
    );
  }

  if (provider === "is-gemini") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <defs>
          <linearGradient id={gradientId} x1="3" x2="21" y1="19" y2="5">
            <stop stopColor="#4f8cff" />
            <stop offset="0.52" stopColor="#7867ff" />
            <stop offset="1" stopColor="#d06adf" />
          </linearGradient>
        </defs>
        <path
          d="M20.62 10.84a14.15 14.15 0 0 1-4.45-3 14.11 14.11 0 0 1-3.68-6.46.5.5 0 0 0-.98 0 14.13 14.13 0 0 1-3.68 6.46 14.15 14.15 0 0 1-4.45 3c-.65.28-1.32.5-2 .67a.5.5 0 0 0 0 .98c.68.17 1.35.4 2 .68a14.15 14.15 0 0 1 4.45 3 14.11 14.11 0 0 1 3.68 6.45.5.5 0 0 0 .98 0c.17-.68.4-1.35.68-2a14.15 14.15 0 0 1 3-4.45 14.11 14.11 0 0 1 6.45-3.68.5.5 0 0 0 0-.98 13.25 13.25 0 0 1-2-.67Z"
          fill={`url(#${gradientId})`}
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path
        d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 0 0-.856 0l-5.97 3.473Zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 0 1 .476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163ZM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898ZM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128Zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472Zm-5.637-5.303-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 0 1 4.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 0 1-.476 0Zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523Zm5.899 2.83a5.947 5.947 0 0 0 5.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0 0 10.205 0a5.947 5.947 0 0 0-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 0 0 4.162 1.713Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function RichModelPicker({
  label,
  options,
  selectedId,
  disabled = false,
  compact = false,
  header = false,
  subtitle,
  onChange,
  onUpgrade,
}: {
  label: string;
  options: ModelPickerOption[];
  selectedId: string | null;
  disabled?: boolean;
  compact?: boolean;
  header?: boolean;
  subtitle?: string;
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
    <div
      className={`rich-model-picker ${compact ? "is-compact" : ""} ${header ? "is-header" : ""} ${open ? "is-open" : ""}`}
      ref={rootRef}
    >
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
          <ModelProviderIcon label={selected?.label ?? ""} />
        </span>
        <span className="rich-model-trigger-copy">
          <strong>{selected?.label ?? "暂无可用模型"}</strong>
          {header && subtitle ? <small>{subtitle}</small> : null}
        </span>
        {header ? (
          <ChevronRight aria-hidden="true" size={15} />
        ) : (
          <ChevronDown aria-hidden="true" size={15} />
        )}
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
                  <ModelProviderIcon label={option.label} />
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
                  <span className="model-upgrade-label">升级</span>
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
