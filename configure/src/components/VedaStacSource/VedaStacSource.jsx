import React, { useState } from "react";
import { useDispatch } from "react-redux";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";

import { calls } from "../../core/calls";
import { setConfiguration, setSnackBarText } from "../../core/ConfigureStore";

const DEFAULT_STAC = "https://dev.disasters.openveda.cloud/api/stac";
const DEFAULT_RASTER = "https://dev.disasters.openveda.cloud/api/raster";

// The layer fields a fill takes over. Everything else — identity (uuid),
// opacity, style, analysis, properties tabs — keeps its value: the source
// supports the admin, it doesn't decide for them.
const FILL_FIELDS = [
  "name",
  "url",
  "tileformat",
  "minZoom",
  "maxNativeZoom",
  "maxZoom",
  "boundingBox",
  "time",
  "variables.legendOrientation",
  "variables.legend",
  "description",
];

function getByPath(obj, path) {
  return path
    .split(".")
    .reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

/** Identical render entries collapse to one (VEDA collections commonly
 *  duplicate `dashboard` under the asset's name). The default entry is
 *  ordered first so it survives under its own key and stays preselected. */
function dedupeRenders(renders, defaultRender) {
  const ordered = [
    ...renders.filter((r) => r.key === defaultRender),
    ...renders.filter((r) => r.key !== defaultRender),
  ];
  const seen = new Set();
  return ordered.filter((r) => {
    const signature = JSON.stringify([
      r.assets,
      r.bidx,
      r.rescale,
      r.colormap_name,
      r.nodata,
    ]);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

/** One plain-language line summarizing a render's parameters. Internal
 *  keys/aliases never surface in copy. */
function renderSummary(r) {
  const bits = [];
  if (r.assets?.length) bits.push(r.assets.join("+"));
  if (r.bidx?.length)
    bits.push(`${r.bidx.length} band${r.bidx.length > 1 ? "s" : ""}`);
  if (r.colormap_name) bits.push(r.colormap_name);
  if (r.rescale?.length) {
    const pair = Array.isArray(r.rescale[0]) ? r.rescale[0] : r.rescale;
    bits.push(`${pair[0]}..${pair[1]}`);
  }
  if (r.nodata !== null && r.nodata !== undefined) bits.push(`nodata ${r.nodata}`);
  return bits.join(" · ") || "no parameters";
}

/**
 * VEDA STAC Source (#333): step 1 looks a collection up and shows what it
 * offers — renders and temporal coverage, with preselections; step 2 fills
 * this layer's form fields from the human's choices. An ongoing
 * collection's end time is written as the "now" policy (#332) so the layer
 * never goes stale. Everything stays editable afterwards.
 */
export default function VedaStacSource({ layer, updateConfiguration, tooltip }) {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collectionId, setCollectionId] = useState("");
  const [stacUrl, setStacUrl] = useState(DEFAULT_STAC);
  const [rasterUrl, setRasterUrl] = useState(DEFAULT_RASTER);
  const [facts, setFacts] = useState(null);
  const [renderKey, setRenderKey] = useState("");
  const [timeMode, setTimeMode] = useState("time");

  const fail = (message) =>
    dispatch(setSnackBarText({ text: message, severity: "error" }));

  const reset = () => {
    setFacts(null);
    setBusy(false);
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    reset();
  };

  const lookUp = () => {
    if (busy) return;
    if (collectionId.trim() === "") {
      fail("Please enter a STAC collection id.");
      return;
    }
    setBusy(true);
    calls.api(
      "vedastac_inspect",
      { collectionId: collectionId.trim(), stacUrl: stacUrl.trim() },
      (res) => {
        setBusy(false);
        setFacts(res.facts);
        setRenderKey(res.facts.defaultRender || "");
        setTimeMode(res.facts.suggestedTimeMode);
      },
      (err) => {
        setBusy(false);
        fail(err?.message || "Could not look up that collection.");
      }
    );
  };

  const fill = () => {
    if (busy) return;
    setBusy(true);
    calls.api(
      "vedastac_fill",
      {
        collectionId: collectionId.trim(),
        stacUrl: stacUrl.trim(),
        rasterUrl: rasterUrl.trim(),
        render: renderKey || undefined,
        timeMode,
      },
      (res) => {
        setBusy(false);
        let conf = null;
        FILL_FIELDS.forEach((field) => {
          const value = getByPath(res.layer, field);
          if (value === undefined) return;
          conf = updateConfiguration(field, value, layer, true, conf);
        });
        if (conf != null) dispatch(setConfiguration(conf));
        const warnings = res.warnings || [];
        dispatch(
          setSnackBarText({
            text:
              warnings.length > 0
                ? `Filled from '${collectionId.trim()}' with ${warnings.length} warning(s) — see the browser console.`
                : `Filled from '${collectionId.trim()}'.`,
            severity: warnings.length > 0 ? "warning" : "success",
          })
        );
        warnings.forEach((w) => console.warn(`[VEDA STAC Source] ${w}`));
        setOpen(false);
        reset();
      },
      (err) => {
        setBusy(false);
        fail(err?.message || "Could not fill the layer from that collection.");
      }
    );
  };

  const renderOptions = facts
    ? dedupeRenders(facts.renders, facts.defaultRender)
    : [];

  const timeFacts = facts
    ? facts.temporal.start == null
      ? "no temporal extent"
      : `${facts.temporal.start.slice(0, 10)} → ${
          facts.temporal.end == null
            ? "ongoing"
            : facts.temporal.end.slice(0, 10)
        }${facts.interval ? ` · ${facts.interval}` : ""}`
    : "";

  return (
    <>
      <Tooltip title={tooltip || ""} placement="top" arrow>
        <Button
          variant="outlined"
          startIcon={<TravelExploreIcon />}
          onClick={() => setOpen(true)}
        >
          VEDA STAC Source
        </Button>
      </Tooltip>
      <Dialog open={open} onClose={close} fullWidth>
        <DialogTitle>VEDA STAC Source</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            Looks a VEDA STAC collection up and shows what it offers — you
            choose how to use it, and this layer's fields are filled from the
            collection's own metadata. An ongoing collection's end time is
            written as "now", so the layer stays current as data grows.
            Everything stays editable afterwards.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            required
            margin="dense"
            label="Collection ID"
            placeholder="e.g. sentinel2-nbr-daily"
            value={collectionId}
            disabled={facts != null}
            onChange={(e) => setCollectionId(e.target.value)}
          />
          <TextField
            fullWidth
            margin="dense"
            label="STAC API root"
            value={stacUrl}
            disabled={facts != null}
            onChange={(e) => setStacUrl(e.target.value)}
          />
          <TextField
            fullWidth
            margin="dense"
            label="Raster API root (titiler-pgstac)"
            value={rasterUrl}
            disabled={facts != null}
            onChange={(e) => setRasterUrl(e.target.value)}
          />
          {facts != null && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1">{facts.title}</Typography>
              {renderOptions.length === 0 && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  This collection declares no renders — it can't be filled
                  automatically.
                </Typography>
              )}
              {renderOptions.length === 1 && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Render — {renderSummary(renderOptions[0])}
                </Typography>
              )}
              {renderOptions.length > 1 && (
                <TextField
                  select
                  fullWidth
                  margin="dense"
                  label="Render"
                  value={renderKey}
                  onChange={(e) => setRenderKey(e.target.value)}
                >
                  {renderOptions.map((r) => (
                    <MenuItem key={r.key} value={r.key}>
                      {`${r.key} — ${renderSummary(r)}`}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <FormLabel sx={{ mt: 2, display: "block" }}>
                Time — {timeFacts}
              </FormLabel>
              <RadioGroup
                value={timeMode}
                onChange={(e) => setTimeMode(e.target.value)}
              >
                <FormControlLabel
                  value="time"
                  control={<Radio size="small" />}
                  label="Time-enabled (driven by the time slider; an ongoing collection's end follows the current date)"
                  disabled={facts.temporal.start == null}
                />
                <FormControlLabel
                  value="static"
                  control={<Radio size="small" />}
                  label="Static (no time filtering)"
                />
              </RadioGroup>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (busy) return;
              if (facts != null) reset();
              else close();
            }}
            disabled={busy}
          >
            {facts != null ? "Back" : "Cancel"}
          </Button>
          {facts == null ? (
            <Button variant="contained" onClick={lookUp} disabled={busy}>
              {busy ? "Looking up…" : "Look Up"}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={fill}
              disabled={busy || renderOptions.length === 0}
            >
              {busy ? "Filling…" : "Fill Layer"}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
