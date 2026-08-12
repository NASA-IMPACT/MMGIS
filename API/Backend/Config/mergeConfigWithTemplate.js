const deepmerge = require("deepmerge");

/**
 * Merge a posted config over the starter config template so the template acts
 * only as fallback defaults for what the post left out — never as forced
 * content (see issue #194).
 *
 * Behavior:
 *  - Posted arrays REPLACE the template's arrays wholesale (they do not
 *    concatenate). An explicitly empty array (e.g. `tools: []`) therefore wins
 *    and yields none.
 *  - Posted scalars win over the template's scalars.
 *  - Keys absent from the post are gap-filled from the template. This is what
 *    the "new mission" dialog relies on: it posts only a few fields and the
 *    template supplies the rest (including its default tools).
 *
 * Because posted arrays replace rather than append, re-merging an
 * already-merged config (the mission-clone path) is idempotent: no duplicate
 * accumulation across any number of generations.
 *
 * Pure: does not mutate either argument. deepmerge returns a fresh object;
 * the caller is responsible for cloning the shared template beforehand if it
 * intends to reuse it.
 *
 * @param {Object} template - the starter config template
 * @param {Object} postedConfig - the config submitted with the create request
 * @returns {Object} the merged config
 */
function mergeConfigWithTemplate(template, postedConfig) {
  if (!postedConfig) return template;
  return deepmerge(template, postedConfig, {
    // Posted array wins wholesale — return a copy so the merged config never
    // shares an array reference with the caller's posted object.
    arrayMerge: (_destinationArray, sourceArray) => sourceArray.slice(),
  });
}

module.exports = mergeConfigWithTemplate;
