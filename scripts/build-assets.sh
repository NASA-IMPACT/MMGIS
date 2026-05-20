#!/bin/bash
set -e

# Resolve the package root from the script location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Asset source → target destination mappings.
# For MMGIS, we copy fonts to public/css/fonts so theme CSS files can reference them
ASSETS=(
  "node_modules/@fontsource:public/css/fonts"
  "node_modules/@fontsource-variable:public/css/fonts"
  "node_modules/@uswds/uswds/dist/fonts:public/css/fonts"
  "node_modules/@uswds/uswds/dist/img:public/img"
)

copy_asset() {
  local src dest abs_src abs_dest
  src="$1"
  dest="$2"

  # Resolve any symlinks in the source directory before copying.
  abs_src="$(realpath "$PROJECT_ROOT/$src")"
  abs_dest="$PROJECT_ROOT/$dest"

  mkdir -p "$abs_dest"

  # Copy files and directories
  rsync -a "$abs_src/" "$abs_dest/"
  printf 'Copied %s → %s\n' "$abs_src" "$abs_dest"
}

for mapping in "${ASSETS[@]}"; do
  IFS=":" read -r src dest <<< "$mapping"
  copy_asset "$src" "$dest"
done
