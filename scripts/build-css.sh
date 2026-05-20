#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Compile all theme SCSS files to public/css/
echo "Compiling theme CSS files..."

# Find all theme directories (excluding components)
for theme_dir in "$PROJECT_ROOT"/src/styles/*/; do
  theme_name=$(basename "$theme_dir")

  # Skip components directory
  if [ "$theme_name" = "components" ]; then
    continue
  fi

  # Check if index.scss exists
  if [ -f "$theme_dir/index.scss" ]; then
    echo "Compiling theme: $theme_name"
    npx sass "$@" \
      --pkg-importer=node \
      --load-path=node_modules/@uswds/uswds/packages \
      --load-path=node_modules \
      "$theme_dir/index.scss:public/css/${theme_name}.css"
    echo "Successfully compiled $theme_name"
  else
    echo "Warning: Theme folder '$theme_name' is missing index.scss"
  fi
done
