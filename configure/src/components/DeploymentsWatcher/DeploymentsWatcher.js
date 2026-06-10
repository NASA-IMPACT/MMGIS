import { useEffect, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";

import { calls } from "../../core/calls";
import {
  setDeployments,
  watchDeployment,
  unwatchDeployment,
  setSnackBarText,
} from "../../core/ConfigureStore";

const POLL_INTERVAL_MS = 15000;
const TRANSITIONAL_STATUSES = ["provisioning", "updating", "deleting"];

// The one shared deployments fetch — every reader (the Deployments page,
// this watcher's poll) goes through here and subscribes to
// state.core.deployments, so there is never a second parallel request
// stream. `quiet` suppresses the error snackbar for background polls.
export function queryDeployments(dispatch, options) {
  const { quiet, onDone } = options || {};
  calls.api(
    "getDeployments",
    {},
    (res) => {
      dispatch(setDeployments(res?.body?.deployments || []));
      if (typeof onDone === "function") onDone();
    },
    (res) => {
      if (!quiet)
        dispatch(
          setSnackBarText({
            text: res?.message || "Failed to get deployments.",
            severity: "error",
          })
        );
      if (typeof onDone === "function") onDone();
    }
  );
}

// Lean-only (no-op in full mode where /api/deployments doesn't exist).
// Mounted once at the Configure level so the admin hears about publish
// completion no matter which page they're on. Watches begin from the
// SaveBar's publish response and from any transitional row seen in the
// deployments list; while any watch is open, this polls getDeployments
// every 15s and raises a snackbar on each terminal transition.
export default function DeploymentsWatcher() {
  const dispatch = useDispatch();

  const deployments = useSelector((state) => state.core.deployments);
  const deploymentsWatch = useSelector((state) => state.core.deploymentsWatch);

  const inFlightRef = useRef(false);
  const lastDiffedRef = useRef(null);

  const isLean = window.mmgisglobal.DEPLOYMENT_MODE === "lean";
  const isWatching = Object.keys(deploymentsWatch).length > 0;

  // Diff each deployments list against the watch set: auto-watch
  // transitional rows, toast watched rows that reached a terminal status.
  useEffect(() => {
    if (!isLean) return;

    const byId = {};
    deployments.forEach((d) => {
      byId[d.id] = d;
    });

    deployments.forEach((d) => {
      const watched = deploymentsWatch[d.id];
      if (TRANSITIONAL_STATUSES.includes(d.status)) {
        if (watched == null || watched.status !== d.status)
          dispatch(
            watchDeployment({ id: d.id, name: d.name, status: d.status })
          );
      } else if (watched != null) {
        if (d.status === "published")
          dispatch(
            setSnackBarText({
              text: `'${d.name}' published —`,
              severity: "success",
              link: d.cloudfront_url,
            })
          );
        else if (d.status === "failed")
          dispatch(
            setSnackBarText({
              text: `'${d.name}' publish failed — see Deployments.`,
              severity: "error",
            })
          );
        else if (d.status === "deleted")
          dispatch(
            setSnackBarText({
              text: `'${d.name}' deleted.`,
              severity: "info",
            })
          );
        dispatch(unwatchDeployment({ id: d.id }));
      }
    });

    // A watched row that vanished from the list finished a delete (the row
    // is gone outright instead of flipping to 'deleted'). Only judged
    // against a freshly fetched list — when this effect re-runs because the
    // watch set changed (e.g. SaveBar just added a watch), the list on hand
    // predates that watch and would falsely report the row missing.
    const listIsFresh = lastDiffedRef.current !== deployments;
    lastDiffedRef.current = deployments;
    if (listIsFresh)
      Object.keys(deploymentsWatch).forEach((id) => {
        if (byId[id] == null) {
          if (deploymentsWatch[id].status === "deleting")
            dispatch(
              setSnackBarText({
                text: `'${deploymentsWatch[id].name}' deleted.`,
                severity: "info",
              })
            );
          dispatch(unwatchDeployment({ id: id }));
        }
      });
  }, [deployments, deploymentsWatch, dispatch, isLean]);

  // Poll while any watch is open. Keyed on the boolean so watch-set churn
  // doesn't reset the timer's phase.
  useEffect(() => {
    if (!isLean || !isWatching) return;

    const interval = setInterval(() => {
      // Skip the tick if the previous poll hasn't answered yet so a slow
      // backend can't stack parallel requests.
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      queryDeployments(dispatch, {
        quiet: true,
        onDone: () => {
          inFlightRef.current = false;
        },
      });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isWatching, dispatch, isLean]);

  return null;
}
