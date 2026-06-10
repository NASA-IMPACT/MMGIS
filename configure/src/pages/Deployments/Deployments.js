import React, { useCallback, useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { makeStyles } from "@mui/styles";

import clsx from "clsx";

import { calls } from "../../core/calls";
import { setModal, setSnackBarText } from "../../core/ConfigureStore";

import DeleteDeploymentModal from "./Modals/DeleteDeploymentModal/DeleteDeploymentModal";

import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import Link from "@mui/material/Link";

import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import RefreshIcon from "@mui/icons-material/Refresh";
import PublishIcon from "@mui/icons-material/Publish";
import UpgradeIcon from "@mui/icons-material/Upgrade";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";

const useStyles = makeStyles((theme) => ({
  Deployments: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexFlow: "column",
    background: theme.palette.swatches.grey[1000],
    padding: "0px",
    boxSizing: "border-box",
    backgroundImage: "url(configure/build/gridlines.png)",
  },
  topbar: {
    width: "calc(100% - 100px)",
    height: "44px",
    minHeight: "44px !important",
    display: "flex",
    justifyContent: "space-between",
    padding: `0px 20px`,
    boxSizing: `border-box !important`,
  },
  topbarTitle: {
    display: "flex",
    color: theme.palette.swatches.grey[150],
    "& > svg": {
      color: theme.palette.swatches.grey[150],
      margin: "3px 10px 0px 2px",
    },
  },
  content: {
    width: "100%",
    overflowY: "auto",
    padding: "0px 60px",
    boxSizing: "border-box",
  },
  subtitle: {
    fontSize: "13px !important",
    fontStyle: "italic",
    color: theme.palette.swatches.grey[400],
    margin: "10px 0px !important",
  },
  publishForm: {
    display: "flex",
    gap: "16px",
    margin: "20px 0px",
    alignItems: "center",
  },
  missionSelect: {
    width: "280px",
  },
  nameField: {
    width: "280px",
  },
  publishButton: {
    height: "40px",
    borderRadius: "3px !important",
    background: `${theme.palette.swatches.p[11]} !important`,
    color: "white !important",
  },
  listHeader: {
    display: "flex",
    height: "32px",
    lineHeight: "32px",
    width: "100%",
    background: theme.palette.swatches.grey[150],
    color: "white",
    fontWeight: "bold",
    fontSize: "12px",
    textTransform: "uppercase",
    marginBottom: "2px",
    "& > div": {
      padding: "0px 16px",
      boxSizing: "border-box",
    },
  },
  listItem: {
    display: "flex",
    minHeight: "42px",
    lineHeight: "42px",
    width: "100%",
    background: theme.palette.swatches.grey[900],
    border: `1px solid ${theme.palette.swatches.grey[700]}`,
    boxShadow: `0px 1px 3px 0px rgba(0,0,0,0.15)`,
    marginBottom: "3px",
    fontSize: "13px",
    "& > div": {
      padding: "0px 16px",
      boxSizing: "border-box",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
  },
  colId: { width: "60px", textAlign: "center" },
  colName: { width: "200px" },
  colMission: { width: "160px" },
  colStatus: { width: "200px", textTransform: "uppercase", fontSize: "12px" },
  colUrl: { flex: 1 },
  colActions: {
    width: "120px",
    display: "flex",
    justifyContent: "end",
  },
  statusError: {
    color: theme.palette.swatches.red
      ? theme.palette.swatches.red[400]
      : "#e57373",
  },
  lastError: {
    fontSize: "11px",
    fontStyle: "italic",
    color: "#e57373",
    lineHeight: "16px",
    padding: "0px 16px 8px 76px",
  },
  empty: {
    padding: "40px 0px",
    textAlign: "center",
    fontStyle: "italic",
    color: theme.palette.swatches.grey[400],
  },
}));

export default function Deployments() {
  const c = useStyles();

  const dispatch = useDispatch();

  const missions = useSelector((state) => state.core.missions);

  const [deployments, setDeployments] = useState([]);
  const [publishMission, setPublishMission] = useState("");
  const [publishName, setPublishName] = useState("");

  const queryDeployments = useCallback(() => {
    calls.api(
      "getDeployments",
      {},
      (res) => {
        setDeployments(res?.body?.deployments || []);
      },
      (res) => {
        dispatch(
          setSnackBarText({
            text: res?.message || "Failed to get deployments.",
            severity: "error",
          })
        );
      }
    );
  }, [dispatch]);

  useEffect(() => {
    queryDeployments();
  }, [queryDeployments]);

  const publish = () => {
    if (publishMission === "") {
      dispatch(
        setSnackBarText({
          text: "Pick a mission to publish.",
          severity: "warning",
        })
      );
      return;
    }
    calls.api(
      "publishDeployment",
      { mission: publishMission, name: publishName || publishMission },
      () => {
        dispatch(
          setSnackBarText({
            text: "Publishing… This runs in the background; refresh for live status.",
            severity: "success",
          })
        );
        setPublishName("");
        queryDeployments();
      },
      (res) => {
        dispatch(
          setSnackBarText({
            text: res?.message || "Failed to publish.",
            severity: "error",
          })
        );
      }
    );
  };

  const update = (deployment) => {
    calls.api(
      "updateDeployment",
      { urlReplacements: { id: deployment.id } },
      () => {
        dispatch(
          setSnackBarText({
            text: `Updating '${deployment.name}'… This runs in the background.`,
            severity: "success",
          })
        );
        queryDeployments();
      },
      (res) => {
        dispatch(
          setSnackBarText({
            text: res?.message || "Failed to update.",
            severity: "error",
          })
        );
      }
    );
  };

  // Deletion is destructive (tears down the dashboard's hosting), so it
  // goes through an explicit type-the-name confirmation modal; the modal
  // owns the DELETE call.
  const remove = (deployment) => {
    dispatch(
      setModal({
        name: "deleteDeployment",
        deployment: deployment,
      })
    );
  };

  return (
    <div className={c.Deployments}>
      <Toolbar className={c.topbar}>
        <div className={c.topbarTitle}>
          <RocketLaunchIcon />
          <Typography
            style={{ fontWeight: "bold", fontSize: "16px", lineHeight: "29px" }}
            variant="h6"
            component="div"
          >
            Deployments
          </Typography>
        </div>
        <Tooltip title="Refresh live status" placement="left" arrow>
          <IconButton onClick={queryDeployments}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>
      <div className={c.content}>
        <Typography className={c.subtitle}>
          Publish a mission as a standalone, statically-hosted dashboard.
          Status is read live from CloudFormation on every refresh.
        </Typography>
        <div className={c.publishForm}>
          <FormControl className={c.missionSelect} size="small">
            <InputLabel id="deployments-mission-label">Mission</InputLabel>
            <Select
              labelId="deployments-mission-label"
              value={publishMission}
              label="Mission"
              onChange={(e) => setPublishMission(e.target.value)}
            >
              {(missions || []).map((mission) => (
                <MenuItem key={mission} value={mission}>
                  {mission}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            className={c.nameField}
            size="small"
            label="Dashboard Name (optional)"
            value={publishName}
            onChange={(e) => setPublishName(e.target.value)}
          />
          <Button
            className={c.publishButton}
            variant="contained"
            endIcon={<PublishIcon />}
            onClick={publish}
          >
            Publish
          </Button>
        </div>
        <div className={c.listHeader}>
          <div className={c.colId}>ID</div>
          <div className={c.colName}>Name</div>
          <div className={c.colMission}>Mission</div>
          <div className={c.colStatus}>Status</div>
          <div className={c.colUrl}>URL</div>
          <div className={c.colActions}>Actions</div>
        </div>
        {deployments.length === 0 ? (
          <div className={c.empty}>No published dashboards yet.</div>
        ) : (
          deployments.map((d) => (
            <div key={d.id}>
              <div className={c.listItem}>
                <div className={c.colId}>{d.id}</div>
                <div className={c.colName} title={d.name}>
                  {d.name}
                </div>
                <div className={c.colMission} title={d.mission}>
                  {d.mission}
                </div>
                <div
                  className={clsx(c.colStatus, {
                    [c.statusError]: d.status === "failed",
                  })}
                  title={d.stack_status_reason || d.stack_status || d.status}
                >
                  {d.status}
                  {d.stack_status ? ` — ${d.stack_status}` : ""}
                </div>
                <div className={c.colUrl}>
                  {d.cloudfront_url ? (
                    <Link
                      href={d.cloudfront_url}
                      target="_blank"
                      rel="noopener"
                    >
                      {d.cloudfront_url}
                    </Link>
                  ) : (
                    "—"
                  )}
                </div>
                <div className={c.colActions}>
                  <Tooltip
                    title="Update — republish against the mission's latest configuration (same URL)"
                    placement="top"
                    arrow
                  >
                    <IconButton size="small" onClick={() => update(d)}>
                      <UpgradeIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip
                    title="Delete — tear down the dashboard's hosting (retries a stuck teardown)"
                    placement="top"
                    arrow
                  >
                    <IconButton size="small" onClick={() => remove(d)}>
                      <DeleteForeverIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </div>
              </div>
              {d.last_error ? (
                <div className={c.lastError}>{d.last_error}</div>
              ) : null}
            </div>
          ))
        )}
      </div>
      <DeleteDeploymentModal queryDeployments={queryDeployments} />
    </div>
  );
}
