// Deployment-capability lookup for the Configure SPA.
//
// Metaconfig components may declare `"requiresCapability": "<name>"`; Maker
// renders them only when the current deployment supports that capability.
// The mapping from deployment mode to capabilities lives here, in one place,
// so the form engine never needs to know about specific fields or modes.

const currentMode = () => (window.mmgisglobal || {}).DEPLOYMENT_MODE || "full";

// Capability -> the deployment mode(s) that enable it. This is the Configure-SPA
// twin of the backend definition in API/Backend/Utils/capabilities.js — kept
// separate by design (Configure reads DEPLOYMENT_MODE off mmgisglobal; the
// backend reads the env directly), and using the same "capability -> enabling
// mode(s)" list shape so the two twins read identically and a shared capability
// is easy to keep in agreement.
const CAPABILITIES = {
  // Local sidecar proxies (/titiler, /stac, …) and the on-disk Missions/ tree —
  // absent in lean.
  localSidecars: ["full"],
  // Geodata management pages — gated off in lean.
  datasets: ["full"],
  geodatasets: ["full"],
  // Dashboard publish flow (Deployments page + Publish button) — lean only.
  deployments: ["lean"],
};

// Contract: an unknown capability warns and hides the component (fails safe at
// render time), unlike the backend twin which throws at boot so a typo is a
// deploy error.
export const isCapabilityEnabled = (capability) => {
  const modes = CAPABILITIES[capability];
  if (modes == null) {
    console.warn(
      `Unknown capability "${capability}" — hiding the component that requires it.`
    );
    return false;
  }
  return modes.includes(currentMode());
};
