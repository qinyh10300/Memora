#!/bin/sh
# Fails if raw color values appear outside tokens.css / theme-light.css's token block.
# Allowed everywhere: var(--…) references, including rgba(var(--*-rgb), α).
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/apps/web/src/styles"

# Provider brand marks (Claude/Gemini logos) are the sanctioned chromatic exception.
viol=0
for f in workbench.css capture.css library.css public.css responsive.css features.css insights.css settings.css team.css; do
  hits=$(grep -nE 'rgba?\(\s*[0-9]|#[0-9a-fA-F]{3,8}\b' "$f" | grep -v 'var(--' | grep -vE '#d97757|#7867ff' || true)
  if [ -n "$hits" ]; then
    echo "== $f =="
    echo "$hits"
    viol=1
  fi
done

# theme-light.css: raw colors are legal only inside the leading token-override
# block (the first `html.memora-theme-light {` rule); component rules below it
# must go through tokens.
light_hits=$(awk '
  NR == 1, /^\}/ { intoken = 1 }
  /^\}/ && intoken { intoken = 0; next }
  intoken { next }
  (/rgba?\(\s*[0-9]/ || /#[0-9a-fA-F]{3,8}/) && $0 !~ /var\(--/ { print FILENAME ":" FNR ": " $0 }
' theme-light.css || true)
if [ -n "$light_hits" ]; then
  echo "== theme-light.css (component rules) =="
  echo "$light_hits"
  viol=1
fi

if [ "$viol" -eq 0 ]; then
  echo "audit-styles: OK — no raw colors outside token definitions."
fi
exit "$viol"
