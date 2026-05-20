const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const stylesDir = path.join(__dirname, '../src/styles');
const outDir = path.join(__dirname, '../public/css');

if (!fs.existsSync(stylesDir)) {
    console.log('No src/styles directory found. Skipping theme build.');
    process.exit(0);
}

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

// Find all directories in src/styles
const themes = fs.readdirSync(stylesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && dirent.name !== 'components')
    .map(dirent => dirent.name);

themes.forEach(theme => {
    const entryPath = path.join(stylesDir, theme, 'index.scss');
    const outPath = path.join(outDir, `${theme}.css`);
    
    if (fs.existsSync(entryPath)) {
        console.log(`Compiling theme: ${theme}`);
        try {
            // Using npx sass so it uses the locally installed sass
            execSync(`npx sass --pkg-importer=node --load-path=node_modules/@uswds/uswds/packages --load-path=node_modules ${entryPath}:${outPath}`, { stdio: 'inherit' });
            console.log(`Successfully compiled ${theme}`);
        } catch (err) {
            console.error(`Failed to compile theme ${theme}:`, err.message);
            process.exit(1);
        }
    } else {
        console.warn(`Warning: Theme folder '${theme}' is missing index.scss`);
    }
});
