const fs = require("fs");
const path = require("path");

const logger = require("./logger");
const { isLean } = require("./Backend/Utils/deploymentMode");

function updateTools() {
  let tools = {};

  let toolItems = null;

  // First read all the standard tools
  let toolsPath = "./src/essence/Tools";
  try {
    toolItems = fs.readdirSync(toolsPath, { withFileTypes: true });
  } catch (err) {
    toolItems = [];
    logger(
      "warn",
      "Could not find any default tools: ${toolsPath}. Did you mean to do this?",
      "Tools",
      null,
      err
    );
  }
  toolItems = toolItems || [];
  for (let i = 0; i < toolItems.length; i++) {
    let isDir = false;
    try {
      isDir = toolItems[i].isDirectory();
    } catch (err) {
      logger(
        "error",
        "No tools could be added. Is your node version >= v10.10.0?",
        "Tools",
        null,
        err
      );
      return;
    }

    // Lean deployments exclude the Draw tool entirely
    if (isLean() && toolItems[i].name === "Draw") continue;

    if (isDir && toolItems[i].name[0] != "_" && toolItems[i].name[0] != ".") {
      try {
        const contents = fs.readFileSync(
          toolsPath + "/" + toolItems[i].name + "/config.json"
        );
        const jsonContent = JSON.parse(contents);
        tools[toolItems[i].name] = jsonContent;
      } catch (err) {
        logger(
          "error",
          "The following tool could not be added: " + toolItems[i].name,
          "Tools",
          null,
          err
        );
      }
    }
  }

  // Now read all private and plugin tool directories
  const essencePath = path.join(__dirname, "..", "src", "essence");
  let essenceItems = [];
  try {
    essenceItems = fs.readdirSync(essencePath, { withFileTypes: true });
  } catch (err) {
    logger(
      "warn",
      "Could not read essence directory for plugin tools",
      "Tools",
      null,
      err
    );
  }

  // Filter directories that match *Private-Tools* or *Plugin-Tools*
  const pluginToolDirs = essenceItems.filter(item => {
    try {
      return item.isDirectory() && 
             (item.name.includes("Private-Tools") || 
              item.name.includes("Plugin-Tools"));
    } catch (err) {
      return false;
    }
  });

  // Process each plugin tools directory
  pluginToolDirs.forEach((pluginDir) => {
    const pluginPath = `${essencePath}/${pluginDir.name}`;
    let pluginItems = [];
    
    try {
      pluginItems = fs.readdirSync(pluginPath, { withFileTypes: true });
    } catch (err) {
      logger(
        "warn",
        `Could not read plugin tools directory: ${pluginDir.name}`,
        "Tools",
        null,
        err
      );
      return;
    }

    for (let i = 0; i < pluginItems.length; i++) {
      if (
        pluginItems[i].isDirectory() &&
        pluginItems[i].name[0] != "_" &&
        pluginItems[i].name[0] != "."
      ) {
        try {
          const contents = fs.readFileSync(
            pluginPath + "/" + pluginItems[i].name + "/config.json"
          );
          const jsonContent = JSON.parse(contents);
          tools[pluginItems[i].name] = jsonContent;
          logger(
            "info",
            `Loaded tool: ${pluginItems[i].name} from ${pluginDir.name}`,
            "Tools"
          );
        } catch (err) {
          logger(
            "error",
            `The following tool could not be added from ${pluginDir.name}: ${pluginItems[i].name}`,
            "Tools",
            null,
            err
          );
        }
      }
    }
  });

  // Sort the tools by toolbarPriority
  tools = Object.keys(tools)
    .sort(function (a, b) {
      return (
        (tools[a].toolbarPriority || 1000) - (tools[b].toolbarPriority || 1000)
      );
    })
    .reduce((obj, key) => {
      obj[key] = tools[key];
      return obj;
    }, {});

  // Build dynamic toolConfigs.json file for configure page
  try {
    fs.writeFileSync(
      "./configure/public/toolConfigs.json",
      JSON.stringify(tools)
    );
    logger(
      "success",
      "Successfully updated source tool configurations.",
      "Tools"
    );
  } catch (err) {
    logger("error", "Failed to write toolConfigs.json", "Tools", null, err);
  }

  //Build dynamic /src/pre/tools.js file
  let toolConfigs = "";
  let toolModules = {};
  let testModules = {};
  let kindsModule = null;
  for (let t in tools) {
    for (let p in tools[t].paths) {
      let pname;
      if (p === "Kinds") {
        kindsModule = p;
        pname = "kinds";
      } else toolModules[p] = p;
      toolConfigs += `import ${pname || p} from '../${tools[t].paths[p]}'\n`;
    }
    if (tools[t].tests) {
      for (let test in tools[t].tests) {
        testModules[test] = test;
        toolConfigs += `import ${test} from '../${tools[t].tests[test]}'\n`;
      }
    }
  }

  toolConfigs += `\n`;
  toolConfigs += `export const toolConfigs = ${JSON.stringify(tools)}\n`;
  toolConfigs += `export const toolModules = ${JSON.stringify(
    toolModules
  ).replace(/"/g, "")}\n`;
  toolConfigs += `export const testModules = ${JSON.stringify(
    testModules
  ).replace(/"/g, "")}\n`;
  toolConfigs += `export const Kinds = kinds`;

  if (kindsModule == null) {
    logger(
      "error",
      "Kinds tool is required but is not found. Are you missing a config.js?",
      "Tools",
      null
    );
  } else {
    try {
      fs.writeFileSync("./src/pre/tools.js", toolConfigs);
      logger("success", "Successfully plugged-in tools.", "Tools");
    } catch (err) {
      logger(
        "error",
        "Failed to write tool paths to src tools.js",
        "Tools",
        null,
        err
      );
    }
  }

  bakeStaticConfig();
}

// Writes src/pre/staticConfig.js (gitignored; the STATIC_MISSION_CONFIG
// webpack alias target) so static builds can answer baked calls. With no
// config given, only ensures the file exists (an empty bake) — the publish
// flow (PR 8) supplies the real mission config and overwrites it.
function bakeStaticConfig(config) {
  const staticConfigPath = "./src/pre/staticConfig.js";

  if (config == null && fs.existsSync(staticConfigPath)) return;

  const contents = [
    "// Generated by API/updateTools.js (bakeStaticConfig). Do not edit.",
    "// Static (backend-less) builds answer baked calls from this object,",
    "// keyed by call name (see src/pre/staticHandlers.js).",
    `export default ${JSON.stringify(config || {})}`,
    "",
  ].join("\n");

  try {
    fs.writeFileSync(staticConfigPath, contents);
    logger("success", "Successfully baked static config.", "StaticConfig");
  } catch (err) {
    logger(
      "error",
      "Failed to write src/pre/staticConfig.js",
      "StaticConfig",
      null,
      err
    );
  }
}

function updateComponents() {
    let components = {};

    // Scan src/essence/ for component plugin directories
    const essencePath = path.join(__dirname, "..", "src", "essence");
    let essenceItems = [];
    try {
        essenceItems = fs.readdirSync(essencePath, { withFileTypes: true });
    } catch (err) {
        logger(
            "warn",
            "Could not read essence directory for plugin components",
            "Components",
            null,
            err
        );
    }

    // Filter directories that match *Private-Components* or *Plugin-Components*
    const pluginComponentDirs = essenceItems.filter((item) => {
        try {
            return (
                item.isDirectory() &&
                (item.name.includes("Private-Components") ||
                    item.name.includes("Plugin-Components"))
            );
        } catch (err) {
            return false;
        }
    });

    // Process each plugin components directory
    pluginComponentDirs.forEach((pluginDir) => {
        const pluginPath = `${essencePath}/${pluginDir.name}`;
        let pluginItems = [];

        try {
            pluginItems = fs.readdirSync(pluginPath, { withFileTypes: true });
        } catch (err) {
            logger(
                "warn",
                `Could not read plugin components directory: ${pluginDir.name}`,
                "Components",
                null,
                err
            );
            return;
        }

        for (let i = 0; i < pluginItems.length; i++) {
            if (
                pluginItems[i].isDirectory() &&
                pluginItems[i].name[0] != "_" &&
                pluginItems[i].name[0] != "."
            ) {
                try {
                    const contents = fs.readFileSync(
                        pluginPath + "/" + pluginItems[i].name + "/config.json"
                    );
                    const jsonContent = JSON.parse(contents);
                    components[pluginItems[i].name] = jsonContent;
                    logger(
                        "info",
                        `Loaded component: ${pluginItems[i].name} from ${pluginDir.name}`,
                        "Components"
                    );
                } catch (err) {
                    logger(
                        "error",
                        `The following component could not be added from ${pluginDir.name}: ${pluginItems[i].name}`,
                        "Components",
                        null,
                        err
                    );
                }
            }
        }
    });

    // Build dynamic componentConfigs.json file for configure page
    try {
        fs.writeFileSync(
            "./configure/public/componentConfigs.json",
            JSON.stringify(components)
        );
        logger(
            "success",
            "Successfully updated source component configurations.",
            "Components"
        );
    } catch (err) {
        logger(
            "error",
            "Failed to write componentConfigs.json",
            "Components",
            null,
            err
        );
    }

    // Build dynamic /src/pre/components.js file
    let componentConfigs = "";
    let componentModules = {};

    for (let c in components) {
        for (let p in components[c].paths) {
            componentModules[p] = p;
            componentConfigs += `import ${p} from '../${components[c].paths[p]}'\n`;
        }
    }

    componentConfigs += `\n`;
    componentConfigs += `export const componentConfigs = ${JSON.stringify(
        components
    )}\n`;
    componentConfigs += `export const componentModules = ${JSON.stringify(
        componentModules
    ).replace(/"/g, "")}\n`;

    try {
        fs.writeFileSync("./src/pre/components.js", componentConfigs);
        logger("success", "Successfully plugged-in components.", "Components");
    } catch (err) {
        logger(
            "error",
            "Failed to write component paths to src/pre/components.js",
            "Components",
            null,
            err
        );
    }
}

module.exports = { updateTools, updateComponents, bakeStaticConfig };
