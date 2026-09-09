import React, { useState } from "react";
import { isLeanMode } from "../../core/capabilities";
import { STATUS, TRANSITIONAL_STATUSES } from "../../core/deploymentStatus";
import { useSelector, useDispatch } from "react-redux";
import {} from "./SaveBarSlice";
import { makeStyles } from "@mui/styles";

import clsx from "clsx";

import { calls } from "../../core/calls";

import {
  setModal,
  setConfiguration,
  clearLockConfig,
  saveConfiguration,
  setSnackBarText,
  watchDeployment,
} from "../../core/ConfigureStore";

import Button from "@mui/material/Button";

import PreviewIcon from "@mui/icons-material/Preview";
import SaveIcon from "@mui/icons-material/Save";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";

import PreviewModal from "./Modals/PreviewModal/PreviewModal";

const useStyles = makeStyles((theme) => ({
  SaveBar: {
    width: "100%",
    position: "absolute",
    bottom: 0,
    right: 0,
    height: "48px",
    minHeight: "48px",
    display: "flex",
    justifyContent: "flex-end",
  },
  preview: {
    margin: "8px !important",
    height: "32px",
    border: `1px solid ${theme.palette.swatches.grey[500]} !important`,
    borderRadius: "3px !important",
    background: `${theme.palette.swatches.grey[800]} !important`,
  },
  save: {
    margin: "8px !important",
    height: "32px",
    borderRadius: "3px !important",
    background: `${theme.palette.swatches.p[11]} !important`,
    color: "white !important",
  },
  saveDisabled: {
    cursor: "not-allowed !important",
    background: `${theme.palette.swatches.red[500]} !important`,
  },
  errorIndicator: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    backgroundColor: theme.palette.error.main,
    marginLeft: "6px",
    display: "inline-block",
  },
}));

export default function SaveBar() {
  const c = useStyles();

  const dispatch = useDispatch();

  const mission = useSelector((state) => state.core.mission);
  const lockConfig = useSelector((state) => state.core.lockConfig);
  const validationErrors = useSelector((state) => state.core.validationErrors);
  const hasValidationErrors = validationErrors && validationErrors.length > 0;

  // True while a save-and-publish round trip is in flight; disables the
  // Publish button so a double-click can't start duplicate publish tasks.
  const [publishing, setPublishing] = useState(false);

  // Lean publish flow: publish this mission as a standalone dashboard (or
  // update its existing one — lean is 1:1, a mission is a dashboard).
  // Publishing is a background job; the Deployments page shows live status.
  const publishMission = () => {
    if (mission == null) {
      setPublishing(false);
      return;
    }
    calls.api(
      "getDeployments",
      {},
      (res) => {
        const existing = (res?.body?.deployments || []).find(
          (d) => d.mission === mission && d.status !== STATUS.DELETED
        );
        // A failed row with no stack ARN never got its dashboard, and Update
        // needs an existing stack; the only way forward is a fresh publish.
        if (
          existing != null &&
          existing.status === STATUS.FAILED &&
          existing.stack_arn == null
        ) {
          setPublishing(false);
          dispatch(
            setSnackBarText({
              text: `'${existing.name}' failed before its dashboard was created. Delete it on the Deployments page and Save & Publish again.`,
              severity: "warning",
            })
          );
          return;
        }
        const call = existing != null ? "updateDeployment" : "publishDeployment";
        const data =
          existing != null
            ? { urlReplacements: { id: existing.id } }
            : { mission: mission, name: mission };
        calls.api(
          call,
          data,
          (res) => {
            setPublishing(false);
            // Hand the in-flight deployment to DeploymentsWatcher, which
            // polls and raises a snackbar when the publish completes.
            const deployment = res?.body?.deployment;
            if (deployment != null)
              dispatch(
                watchDeployment({
                  id: deployment.id,
                  name: deployment.name,
                  status: deployment.status,
                })
              );
            dispatch(
              setSnackBarText({
                text: "Publishing… — you'll be notified here when it finishes.",
                severity: "success",
              })
            );
          },
          (res) => {
            setPublishing(false);
            // A refusal names why the dashboard cannot be (re)published
            // right now: a publish already running, a delete under way, a
            // deleted row, or a dashboard that appeared since this tab
            // listed them. When the row it names is still changing (a
            // publish, update or delete under way), hand it to the watcher
            // so this tab hears when it finishes; when it is a resting
            // dashboard that already exists, say how to refresh it.
            if (res?.reason != null) {
              const deployment = res?.body?.deployment;
              const transitional =
                deployment != null &&
                TRANSITIONAL_STATUSES.includes(deployment.status);
              if (transitional)
                dispatch(
                  watchDeployment({
                    id: deployment.id,
                    name: deployment.name,
                    status: deployment.status,
                  })
                );
              const text =
                res.reason === "exists" && !transitional
                  ? `${res.message} Click Save & Publish again to update it.`
                  : res.message;
              dispatch(setSnackBarText({ text, severity: "warning" }));
              return;
            }
            dispatch(
              setSnackBarText({
                text: res?.message || "Failed to publish.",
                severity: "error",
              })
            );
          }
        );
      },
      (res) => {
        setPublishing(false);
        dispatch(
          setSnackBarText({
            text: res?.message || "Failed to query deployments.",
            severity: "error",
          })
        );
      }
    );
  };

  const saveAndPublish = () => {
    if (publishing) return;
    setPublishing(true);
    dispatch(
      saveConfiguration({
        cb: (status, resp) => {
          if (status === "success") {
            if (mission != null) {
              calls.api(
                "get",
                { mission: mission },
                (res) => {
                  dispatch(setConfiguration(res));
                  dispatch(clearLockConfig({}));
                },
                (res) => {
                  dispatch(
                    setSnackBarText({
                      text:
                        res?.message ||
                        "Failed to get configuration for mission.",
                      severity: "error",
                    })
                  );
                }
              );
            }
            publishMission();
          } else {
            setPublishing(false);
            dispatch(
              setSnackBarText({
                text:
                  "Failed to save configuration!" +
                  (resp?.errors?.[0]?.reason
                    ? ` — ${resp?.errors?.[0]?.reason}`
                    : ""),
                severity: status,
              })
            );
          }
        },
      })
    );
  };

  return (
    <>
      <div className={c.SaveBar}>
        <Button
          className={c.preview}
          variant="outlined"
          startIcon={<PreviewIcon />}
          onClick={() => {
            dispatch(setModal({ name: "preview" }));
          }}
        >
          Preview Changes
        </Button>
        <Button
          className={clsx(c.save, { [c.saveDisabled]: lockConfig })}
          variant="contained"
          startIcon={hasValidationErrors ? <span className={c.errorIndicator} /> : null}
          endIcon={<SaveIcon />}
          onClick={() => {
            dispatch(
              saveConfiguration({
                cb: (status, resp) => {
                  dispatch(
                    setSnackBarText({
                      text:
                        status === "success"
                          ? "Saved!"
                          : "Failed to save configuration!" +
                            (resp?.errors?.[0]?.reason
                              ? ` — ${resp?.errors?.[0]?.reason}`
                              : ""),
                      severity: status,
                    })
                  );
                  if (status === "success")
                    if (mission != null)
                      calls.api(
                        "get",
                        { mission: mission },
                        (res) => {
                          dispatch(setConfiguration(res));
                          dispatch(clearLockConfig({}));
                        },
                        (res) => {
                          dispatch(
                            setSnackBarText({
                              text:
                                res?.message ||
                                "Failed to get configuration for mission.",
                              severity: "error",
                            })
                          );
                        }
                      );
                },
              })
            );
          }}
        >
          Save Changes
        </Button>
        {isLeanMode() ? (
          <Button
            className={clsx(c.save, { [c.saveDisabled]: lockConfig })}
            variant="contained"
            disabled={publishing}
            startIcon={
              hasValidationErrors ? <span className={c.errorIndicator} /> : null
            }
            endIcon={<RocketLaunchIcon />}
            onClick={saveAndPublish}
          >
            {publishing ? "Publishing…" : "Publish"}
          </Button>
        ) : null}
      </div>
      <PreviewModal />
    </>
  );
}
