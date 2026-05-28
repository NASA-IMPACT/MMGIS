#!/bin/bash
set -e

# Build MMGIS themes
# This script:
# 1. Copies font and image assets from node_modules to public/
# 2. Compiles SCSS theme files to CSS in public/css/

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

echo "============================================"
echo "Building MMGIS Themes"
echo "============================================"

# Step 1: Copy assets (fonts and images)
echo ""
echo "Step 1: Copying assets from node_modules..."
bash "$SCRIPT_DIR/build-assets.sh"

# Step 2: Compile theme CSS files
echo ""
echo "Step 2: Compiling theme SCSS files..."
bash "$SCRIPT_DIR/build-css.sh" "$@"

echo ""
echo "============================================"
echo "Theme build complete!"
echo "============================================"
