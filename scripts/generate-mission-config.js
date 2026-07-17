#!/usr/bin/env node
/**
 * generate-mission-config.js — compose a complete MMGIS mission config from two
 * hand-maintained inputs: per-tool `defaults` blocks (in each tool's manifest)
 * and a curated profile (which tools, which start on, per-tool overrides, and
 * the scaffold: view/projection/look/layout/time/layers).
 *
 * Usage:
 *   node scripts/generate-mission-config.js <profile> [--out <path>] [--stdout] [--check]
 *
 *   <profile>   a profile name ("full-demo", "minimal") resolved under mission-profiles/,
 *               or a path to a profile .json.
 *   --out       output path (repo-root-relative or absolute). Defaults to the
 *               profile's own "output" field.
 *   --stdout    print the config to stdout instead of writing a file.
 *   --check     write nothing; exit non-zero if the on-disk artifact differs from
 *               a fresh generation (used by CI, though CI prefers a git diff).
 *
 * Design notes:
 *   - Only the tracked src/essence/Tools/<Name>/config.json manifests are scanned
 *     (not src/pre/tools.js, not any *Plugin-Tools* / *Private-Tools* dirs that
 *     API/updateTools.js also globs — untracked local tools must never influence
 *     committed output). `Kinds` is a core module, never a mission tool: hard-skipped.
 *   - A manifest opts into generation by declaring a `defaults` block. A profile's
 *     `exclude` list opts tools out of its implicit everything-on ("all") set —
 *     exclusion is profile policy, never manifest knowledge.
 *   - Output is deterministic: tools sorted by (toolbarPriority || 1000) then name,
 *     fixed key order, LF line endings, placeholders ({{MAPBOX_TOKEN}}) left verbatim.
 *   - The raw composition is what we write. We validate a DEEP CLONE with the
 *     backend validator (which mutates its input by injecting layer defaults).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const TOOLS_DIR = path.join(REPO_ROOT, 'src', 'essence', 'Tools');
const PROFILES_DIR = path.join(REPO_ROOT, 'mission-profiles');

// Core modules that live under Tools/ but are never mission tools.
const HARD_SKIP = new Set(['Kinds']);
// Non-tool entries under Tools/ (a shared helper folder).
const NON_TOOL_DIRS = new Set(['_shared']);

// Top-level config key order (matches API/templates/config_template.js).
const CONFIG_KEY_ORDER = [
  'msv',
  'projection',
  'look',
  'panelSettings',
  'panels',
  'time',
  'tools',
  'layers',
];

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge `source` onto a clone of `base`. Objects merge recursively; arrays
// and scalars from source replace base wholesale (matching the mission-template
// merge semantics from #194: posted arrays replace, never concatenate).
function deepMerge(base, source) {
  const out = deepClone(base);
  if (!isPlainObject(source)) return isPlainObject(out) ? out : deepClone(source);
  for (const key of Object.keys(source)) {
    if (isPlainObject(source[key]) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], source[key]);
    } else {
      out[key] = deepClone(source[key]);
    }
  }
  return out;
}

// Read the tracked tool manifests that declare a `defaults` block.
function loadManifests() {
  const manifests = {};
  for (const entry of fs.readdirSync(TOOLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (NON_TOOL_DIRS.has(entry.name)) continue;
    if (HARD_SKIP.has(entry.name)) continue;
    const file = path.join(TOOLS_DIR, entry.name, 'config.json');
    if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifests[manifest.name || entry.name] = manifest;
  }
  return manifests;
}

// Decide which tools a profile includes.
//   tools: "all"  -> every manifest with defaults, minus the profile's exclude list
//   tools: [names] -> exactly those names (must have defaults)
// Exclusion is profile policy, not manifest knowledge: a plugin declares what it
// looks like when included; the profile decides whether it's included.
function selectToolNames(profile, manifests) {
  const withDefaults = Object.keys(manifests).filter(
    (name) => manifests[name].defaults != null
  );

  if (profile.tools === 'all' || profile.tools == null) {
    const excluded = new Set(profile.exclude || []);
    return withDefaults.filter((name) => !excluded.has(name));
  }

  if (!Array.isArray(profile.tools)) {
    throw new Error(
      `profile.tools must be "all" or an array of tool names (got ${JSON.stringify(
        profile.tools
      )})`
    );
  }

  return profile.tools.map((name) => {
    const manifest = manifests[name];
    if (!manifest) {
      throw new Error(`profile lists unknown tool "${name}" (no manifest found)`);
    }
    if (manifest.defaults == null) {
      throw new Error(
        `profile lists tool "${name}" but its manifest declares no "defaults" block`
      );
    }
    return name;
  });
}

// Build one generated tool config entry with a fixed key order.
function buildToolEntry(manifest, on, overrideVariables) {
  const paths = manifest.paths || {};
  const js = Object.keys(paths)[0];
  if (!js) {
    throw new Error(`tool "${manifest.name}" manifest has no "paths" entry`);
  }

  const defaultVariables =
    (manifest.defaults && manifest.defaults.variables) || {};
  const variables = deepMerge(defaultVariables, overrideVariables || {});

  const entry = {};
  entry.name = manifest.name;
  if (manifest.defaultIcon) entry.icon = manifest.defaultIcon;
  entry.js = js;
  entry.on = on;
  entry.variables = variables;
  // CRITICAL: the modern runtime reads a tool's placement metadata only from the
  // mission-config entry (ToolMetadataUtils.generateToolMetadata reads
  // toolConfig.metadata), never from the manifest. Copy it verbatim when present,
  // or the tool piles into the first panel regardless of the scaffold's intent.
  if (manifest.metadata != null) entry.metadata = deepClone(manifest.metadata);

  return entry;
}

function generate(profile) {
  const manifests = loadManifests();
  const selected = selectToolNames(profile, manifests);

  const onSet = new Set(profile.on || []);
  const overrides = profile.overrides || {};

  const tools = selected
    .map((name) =>
      buildToolEntry(manifests[name], onSet.has(name), (overrides[name] || {}).variables)
    )
    .sort((a, b) => {
      const pa = manifests[a.name].toolbarPriority || 1000;
      const pb = manifests[b.name].toolbarPriority || 1000;
      if (pa !== pb) return pa - pb;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

  const scaffold = profile.scaffold || {};

  // Assemble in the canonical top-level key order. Every key is sourced from the
  // scaffold except `tools` (generated) and `layers` (scaffold-authored, with
  // their stable UUIDs; validate/add never mint UUIDs so these must be constants).
  const config = {};
  for (const key of CONFIG_KEY_ORDER) {
    if (key === 'tools') {
      config.tools = tools;
    } else if (key === 'layers') {
      config.layers = deepClone(scaffold.layers || []);
    } else if (scaffold[key] !== undefined) {
      config[key] = deepClone(scaffold[key]);
    }
  }

  return config;
}

// Recursively collect template keys absent from the config. Mirrors the
// mergeConfigWithTemplate (deepmerge) semantics: object keys gap-fill
// recursively, so recurse where BOTH sides are plain objects; posted arrays
// replace wholesale and posted scalars win, so for anything non-object the
// key's presence alone means the template contributes nothing.
function collectMissingTemplateKeys(template, config, prefix, missing) {
  for (const key of Object.keys(template)) {
    if (!Object.prototype.hasOwnProperty.call(config, key)) {
      missing.push(prefix + key);
      continue;
    }
    if (isPlainObject(template[key]) && isPlainObject(config[key])) {
      collectMissingTemplateKeys(template[key], config[key], `${prefix}${key}.`, missing);
    }
  }
}

// Assert the generated config is a recursive key-superset of the mission
// template, so the create path's gap-fill (add()'s deep merge) has nothing to
// add (committed file == seeded DB).
function assertTemplateSuperset(config) {
  const template = require(path.join(REPO_ROOT, 'API', 'templates', 'config_template.js'));
  const missing = [];
  collectMissingTemplateKeys(template, config, '', missing);
  if (missing.length) {
    throw new Error(
      `generated config is missing template keys: ${missing.join(', ')}. ` +
        `The profile's scaffold must supply every key config_template.js declares ` +
        `(nested object keys included), or add()'s gap-fill would inject them into the seeded DB.`
    );
  }
}

// Validate a deep clone (validate() mutates its input by injecting layer defaults).
function validateConfig(config) {
  const validate = require(path.join(REPO_ROOT, 'API', 'Backend', 'Config', 'validate.js'));
  const result = validate(deepClone(config));
  if (!result || result.valid !== true) {
    const errors = (result && result.errors) || [];
    const lines = errors.map(
      (e) => `  [${e.type}] ${e.reason}${e.invalidFields && e.invalidFields.length ? ' (' + e.invalidFields.join(', ') + ')' : ''}`
    );
    throw new Error(
      `generated config failed backend validation:\n${lines.join('\n')}`
    );
  }
}

function serialize(config) {
  // 2-space indent, LF, single trailing newline. Placeholders are already in the
  // scaffold verbatim, so they survive JSON round-trip unchanged.
  return JSON.stringify(config, null, 2) + '\n';
}

function resolveProfilePath(arg) {
  if (arg.endsWith('.json') || arg.includes('/') || arg.includes(path.sep)) {
    return path.resolve(arg);
  }
  return path.join(PROFILES_DIR, `${arg}.json`);
}

function resolveOutPath(profile, outArg) {
  const out = outArg || profile.output;
  if (!out) {
    throw new Error(
      'no output path: pass --out <path> or give the profile an "output" field'
    );
  }
  return path.isAbsolute(out) ? out : path.join(REPO_ROOT, out);
}

function parseArgs(argv) {
  const args = { profile: null, out: null, stdout: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--stdout') args.stdout = true;
    else if (a === '--check') args.check = true;
    else if (!args.profile) args.profile = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (!args.profile) {
    throw new Error(
      'usage: node scripts/generate-mission-config.js <profile> [--out <path>] [--stdout] [--check]'
    );
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const profilePath = resolveProfilePath(args.profile);
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

  const config = generate(profile);
  validateConfig(config);
  assertTemplateSuperset(config);

  const text = serialize(config);

  if (args.stdout) {
    process.stdout.write(text);
    return;
  }

  const outPath = resolveOutPath(profile, args.out);

  if (args.check) {
    const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (current !== text) {
      console.error(
        `STALE: ${path.relative(REPO_ROOT, outPath)} is out of date.\n` +
          `Regenerate with: node scripts/generate-mission-config.js ${args.profile}`
      );
      process.exit(1);
    }
    console.log(`OK: ${path.relative(REPO_ROOT, outPath)} is up to date.`);
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  console.log(
    `Wrote ${path.relative(REPO_ROOT, outPath)} (${config.tools.length} tools, ${config.layers.length} layers).`
  );
}

module.exports = {
  generate,
  loadManifests,
  selectToolNames,
  buildToolEntry,
  deepMerge,
  assertTemplateSuperset,
  serialize,
};

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`generate-mission-config: ${err.message}`);
    process.exit(1);
  }
}
