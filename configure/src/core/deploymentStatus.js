// Deployment status values, mirrored from the backend model
// (API/Backend/Deployments/models/deployment.js — a parity unit test
// keeps the two in sync). Configure code uses these instead of raw
// status string literals.
export const STATUS = Object.freeze({
  PROVISIONING: "provisioning",
  PUBLISHED: "published",
  UPDATING: "updating",
  DELETING: "deleting",
  DELETED: "deleted",
  FAILED: "failed",
});
export const TRANSITIONAL_STATUSES = Object.freeze([
  STATUS.PROVISIONING,
  STATUS.UPDATING,
  STATUS.DELETING,
]);
