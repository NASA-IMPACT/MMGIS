// Deployment-capability lookup for the Configure SPA.
//
// Metaconfig components may declare `"requiresCapability": "<name>"`; Maker
// renders them only when the current deployment supports that capability.
// The mapping from deployment mode to capabilities lives here, in one place,
// so the form engine never needs to know about specific fields or modes.

const CAPABILITY_RULES = {
  // Anything served by the local sidecar proxies (/titiler, /stac, …) or the
  // on-disk Missions/ tree — both absent in lean deployments.
  localSidecars: (mode) => mode !== "lean",
};

export const isCapabilityEnabled = (capability) => {
  const rule = CAPABILITY_RULES[capability];
  if (rule == null) {
    console.warn(
      `Unknown capability "${capability}" — hiding the component that requires it.`
    );
    return false;
  }
  const mode = (window.mmgisglobal || {}).DEPLOYMENT_MODE || "full";
  return rule(mode);
};
