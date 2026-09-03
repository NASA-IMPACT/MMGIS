export const publicUrl = `${window.location.pathname
  .replace(`configure`, "")
  .replace(/^\//g, "")}configure`;

// Origin plus the path the CMS is mounted under, minus the CMS's own segment
// and with no trailing slash: every caller appends its own "/…", and a CMS
// opened at "/configure/" leaves behind a "/" that would double it.
export const publicUrlMainSite = `${
  window.location.origin
}${window.location.pathname.replace(`/configure`, "").replace(/\/+$/, "")}`;

export const endpoints = {};

export const HASH_PATHS = {
  home: publicUrl + "/",
};
