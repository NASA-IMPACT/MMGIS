import React from "react";
import { useSelector, useDispatch } from "react-redux";

import {
  getLayerByUUID,
  traverseLayers,
  insertLayerAfterUUID,
  getIn,
  setIn,
} from "../../../../../core/utils";

import {
  setModal,
  setSnackBarText,
  setConfiguration,
} from "../../../../../core/ConfigureStore";

import { inject } from "../../../../../core/injectables";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";

import CloseSharpIcon from "@mui/icons-material/CloseSharp";
import LayersIcon from "@mui/icons-material/Layers";

import ContentCopyIcon from "@mui/icons-material/ContentCopy";

import { makeStyles, useTheme } from "@mui/styles";
import useMediaQuery from "@mui/material/useMediaQuery";

import Maker from "../../../../../core/Maker";

import dataConfig from "../../../../../metaconfigs/layer-data-config.json";
import headerConfig from "../../../../../metaconfigs/layer-header-config.json";
import modelConfig from "../../../../../metaconfigs/layer-model-config.json";
import queryConfig from "../../../../../metaconfigs/layer-query-config.json";
import tileConfig from "../../../../../metaconfigs/layer-tile-config.json";
import vectorConfig from "../../../../../metaconfigs/layer-vector-config.json";
import vectortileConfig from "../../../../../metaconfigs/layer-vectortile-config.json";
import velocityConfig from "../../../../../metaconfigs/layer-velocity-config.json";
import imageConfig from "../../../../../metaconfigs/layer-image-config.json";
import videoConfig from "../../../../../metaconfigs/layer-video-config.json";

const useStyles = makeStyles((theme) => ({
  Modal: {
    margin: theme.headHeights[1],
    [theme.breakpoints.down("xs")]: {
      margin: "6px",
    },
    "& .MuiDialog-container": {
      width: "100%",
      transform: "translateX(-50%) translateY(-50%)",
      left: "50%",
      top: "50%",
      position: "absolute",
      marginLeft: "111px",
    },
  },
  contents: {
    height: "100%",
    width: "100%",
    maxWidth: "80% !important",
    maxHeight: "calc(100% - 32px) !important",
  },
  heading: {
    height: theme.headHeights[2],
    boxSizing: "border-box",
    background: theme.palette.swatches.p[0],
    padding: `4px ${theme.spacing(2)} 4px ${theme.spacing(4)} !important`,
  },
  title: {
    padding: `8px 0px`,
    fontSize: theme.typography.pxToRem(16),
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  content: {
    padding: "0px !important",
    height: `calc(100% - ${theme.headHeights[2]}px)`,
    overflowY: "auto",
  },
  closeIcon: {
    padding: theme.spacing(1.5),
    height: "100%",
    margin: "4px 0px",
  },
  flexBetween: {
    display: "flex",
    justifyContent: "space-between",
  },
  subtitle: {
    fontSize: "14px !important",
    width: "100%",
    marginBottom: "8px !important",
    color: theme.palette.swatches.grey[300],
    letterSpacing: "0.2px",
  },
  subtitle2: {
    fontSize: "12px !important",
    fontStyle: "italic",
    width: "100%",
    marginBottom: "8px !important",
    color: theme.palette.swatches.grey[400],
  },
  missionNameInput: {
    width: "100%",
    margin: "8px 0px 4px 0px !important",
  },
  backgroundIcon: {
    margin: "7px 8px 0px 0px",
  },
  dialogActions: {
    display: "flex !important",
    justifyContent: "space-between !important",
    background: `${theme.palette.swatches.grey[150]} !important`,
    padding: "8px 14px !important",
  },
  removeButton: {
    background: `${theme.palette.swatches.red[500]} !important`,
    color: `${theme.palette.swatches.grey[1000]} !important`,
    border: "none !important",
  },
  uuid: {
    color: theme.palette.swatches.grey[600],
    fontSize: "14px",
  },
  actionsRight: {
    display: "flex",
  },
  cloneButton: {
    color: `${theme.palette.swatches.grey[900]} !important`,
  },
  divider: {
    borderColor: `${theme.palette.swatches.grey[300]} !important`,
    margin: "0px 10px !important",
  },
  doneButton: {
    background: `${theme.palette.swatches.p[0]} !important`,
    color: `${theme.palette.swatches.grey[150]} !important`,
    border: "none !important",
    width: "100px",
  },
}));

/**
 * Layer types each engine supports for the Layer Type dropdown.
 * Mirrors ENGINE_LAYER_SUPPORT in src/essence/Basics/MapEngines/types/engine.ts.
 * Structural types are filtered per engine because not all engines support layer
 * tree grouping.
 */
const ENGINE_LAYER_SUPPORT = {
  leaflet: ["vector", "tile", "vectortile", "data", "image", "video", "velocity"],
  deckgl: [
    "GeoJsonLayer",
    "TileLayer",
    "Tile3DLayer",
    "PointCloudLayer",
    "MVTLayer",
    "ScatterplotLayer",
  ],
};

const ENGINE_STRUCTURAL_LAYER_TYPES = {
  leaflet: ["header", "query", "model"],
  deckgl: [],
};

/**
 * Layer metaconfigs keyed by stored layer type.
 */
const LAYER_TYPE_CONFIGS = {
  data: dataConfig,
  header: headerConfig,
  model: modelConfig,
  query: queryConfig,
  tile: tileConfig,
  vector: vectorConfig,
  vectortile: vectortileConfig,
  velocity: velocityConfig,
  image: imageConfig,
  video: videoConfig,
  GeoJsonLayer: vectorConfig,
  ScatterplotLayer: vectorConfig,
  TileLayer: tileConfig,
  BitmapLayer: tileConfig,
  Tile3DLayer: tileConfig,
  PointCloudLayer: tileConfig,
  MVTLayer: vectortileConfig,
};

/**
 * Config fields to hide per engine and layer type.
 * Structure: ENGINE_HIDDEN_FIELDS[engine][layerType] = Set of field paths.
 * Use "_all" to hide a field for every layer type under that engine.
 *
 * Field paths match the `field` key in the metaconfig JSON files.
 * Add entries here when a field is not meaningful for a given engine/type combo.
 */
const ENGINE_HIDDEN_FIELDS = {
  deckgl: {
    _all: new Set([
      "variables.markerIcon.shadowUrl",
      "variables.markerIcon.shadowSize.0",
      "variables.markerIcon.shadowSize.1",
      "variables.markerIcon.shadowAnchor.0",
      "variables.markerIcon.shadowAnchor.1",
    ]),
    vector: new Set([
      "shape",
      "style.shapeIcon",
      "style.shapeProp",
      "style.shapeRotationOffset",
      "style.animation",
    ]),
    GeoJsonLayer: new Set([
      "shape",
      "style.shapeIcon",
      "style.shapeProp",
      "style.shapeRotationOffset",
      "style.animation",
    ]),
    ScatterplotLayer: new Set([
      "shape",
      "style.shapeIcon",
      "style.shapeProp",
      "style.shapeRotationOffset",
      "style.animation",
    ]),
    tile: new Set([]),
    TileLayer: new Set([]),
    BitmapLayer: new Set([]),
    Tile3DLayer: new Set([]),
    PointCloudLayer: new Set([]),
    MVTLayer: new Set([]),
  },
};

const MODAL_NAME = "layer";
const LayerModal = (props) => {
  const c = useStyles();

  const modal = useSelector((state) => state.core.modal[MODAL_NAME]);
  const configuration = useSelector((state) => state.core.configuration);

  const layerUUID = modal && modal.layerUUID ? modal.layerUUID : null;
  const layer = getLayerByUUID(configuration.layers, layerUUID) || {};

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const dispatch = useDispatch();

  let config = LAYER_TYPE_CONFIGS[layer.type] || {};
  const mapEngine = configuration?.msv?.mapEngine || "leaflet";

  config = inject(config);

  if (mapEngine !== "leaflet" && ENGINE_LAYER_SUPPORT[mapEngine] && config.tabs) {
    const allowedTypes = [
      ...ENGINE_LAYER_SUPPORT[mapEngine],
      ...(ENGINE_STRUCTURAL_LAYER_TYPES[mapEngine] ?? []),
    ];
    const engineFields = ENGINE_HIDDEN_FIELDS[mapEngine] ?? {};
    const hiddenFields = new Set([
      ...(engineFields._all ?? []),
      ...(engineFields[layer.type] ?? []),
    ]);

    config = JSON.parse(JSON.stringify(config));
    config.tabs.forEach((tab) => {
      tab.rows.forEach((row) => {
        row.components = row.components.filter(
          (comp) => !comp.field || !hiddenFields.has(comp.field)
        );

        row.components.forEach((comp) => {
          if (comp.field === "type" && comp.type === "dropdown") {
            const filtered = comp.options.filter((opt) =>
              allowedTypes.includes(opt)
            );
            ENGINE_LAYER_SUPPORT[mapEngine].forEach((t) => {
              if (!filtered.includes(t)) filtered.push(t);
            });
            comp.options = filtered;
          }
        });
      });

      tab.rows = tab.rows.filter((row) => row.components.length > 0);
    });

    config.tabs = config.tabs.filter((tab) => tab.rows.length > 0);
  }

  const handleClose = (skipSetConfiguration) => {
    if (skipSetConfiguration !== true) {
      const nextConfiguration = JSON.parse(JSON.stringify(configuration));
      traverseLayers(nextConfiguration.layers, (l, path, index) => {
        if (layer.uuid === l.uuid) {
          // We're repopulating all the layers values to trim it exactly to its spec
          // (otherwise defaults may be missing and switching layer types would mix parameters)
          let completedLayer = {
            uuid: l.uuid,
            sublayers: l.sublayers || [],
          };
          config.tabs.forEach((t) => {
            t.rows.forEach((r) => {
              r.components.forEach((c) => {
                // Skip non-field components (such as the map)
                if (c.field == null) return;

                const currentValue = getIn(l, c.field.split("."), null);
                if (currentValue != null)
                  setIn(completedLayer, c.field.split("."), currentValue, true);

                if (c.type === "dropdown" || c.type === "colordropdown") {
                  const currentValue = getIn(l, c.field);
                  if (currentValue == null) {
                    setIn(
                      completedLayer,
                      c.field.split("."),
                      c.options[0],
                      true
                    );
                  }
                } else if (c.type === "checkbox" || c.type === "switch") {
                  const currentValue = getIn(l, c.field);
                  if (currentValue == null && c.defaultChecked != null) {
                    setIn(
                      completedLayer,
                      c.field.split("."),
                      c.defaultChecked,
                      true
                    );
                  }
                } else if (c.type === "slider") {
                  const currentValue = getIn(l, c.field);
                  if (currentValue == null && c.default != null) {
                    setIn(
                      completedLayer,
                      c.field.split("."),
                      c.default || c.min || 0,
                      true
                    );
                  }
                } else if (c.type === "colorpicker") {
                  const currentValue = getIn(l, c.field);
                  if (currentValue == null) {
                    setIn(
                      completedLayer,
                      c.field.split("."),
                      c.default || "#FFFFFF",
                      true
                    );
                  }
                }
              });
            });
          });

          // Clear and copy while maintaining reference
          Object.keys(l).forEach((key) => {
            delete l[key];
          });
          // Setting these here just so that the show up first in the object
          l.name = completedLayer.name;
          l.uuid = completedLayer.uuid;
          Object.keys(completedLayer).forEach((key) => {
            l[key] = completedLayer[key];
          });
        }
      });
      dispatch(setConfiguration(nextConfiguration));
    }
    // close modal
    dispatch(setModal({ name: MODAL_NAME, on: false }));
  };

  return (
    <Dialog
      className={c.Modal}
      fullScreen={isMobile}
      open={modal !== false}
      onClose={handleClose}
      aria-labelledby="responsive-dialog-title"
      PaperProps={{
        className: c.contents,
      }}
    >
      <DialogTitle className={c.heading}>
        <div className={c.flexBetween}>
          <div className={c.flexBetween}>
            <LayersIcon className={c.backgroundIcon} />
            <div className={c.title}>{layer.name}</div>
          </div>
          <IconButton
            className={c.closeIcon}
            title="Close"
            aria-label="close"
            onClick={handleClose}
          >
            <CloseSharpIcon fontSize="inherit" />
          </IconButton>
        </div>
      </DialogTitle>
      <DialogContent className={c.content}>
        <Maker config={config} layer={layer} inlineHelp={true} />
      </DialogContent>
      <DialogActions className={c.dialogActions}>
        <div>
          <Button
            className={c.removeButton}
            variant="outlined"
            startIcon={<DeleteForeverIcon size="small" />}
            onClick={() => {
              const nextConfiguration = JSON.parse(
                JSON.stringify(configuration)
              );
              traverseLayers(nextConfiguration.layers, (l, path, index) => {
                if (layer.uuid === l.uuid) {
                  return "remove";
                }
              });
              dispatch(setConfiguration(nextConfiguration));
              dispatch(
                setSnackBarText({
                  text: `Removed '${layer.name}'.`,
                  severity: "success",
                })
              );
              handleClose(true);
            }}
          >
            Remove Layer
          </Button>
        </div>
        <div className={c.uuid}>{`Layer UUID: ${layer.uuid}${
          typeof layer.uuid === "number"
            ? " (Will be formally assigned upon saving)"
            : ""
        }`}</div>
        <div className={c.actionsRight}>
          <Tooltip title="Clone Layer" placement="top" arrow>
            <IconButton
              className={c.cloneButton}
              onClick={() => {
                const nextConfiguration = JSON.parse(
                  JSON.stringify(configuration)
                );
                const clonedLayer = JSON.parse(JSON.stringify(layer));
                window.newUUIDCount++;
                const uuid = window.newUUIDCount;
                clonedLayer.uuid = uuid;
                if (clonedLayer.type === "header") clonedLayer.sublayers = [];
                insertLayerAfterUUID(
                  nextConfiguration.layers,
                  clonedLayer,
                  layer.uuid
                );
                dispatch(setConfiguration(nextConfiguration));
                dispatch(
                  setSnackBarText({
                    text: `Cloned '${layer.name}'.`,
                    severity: "success",
                  })
                );
              }}
            >
              <ContentCopyIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>

          <Divider className={c.divider} orientation="vertical" flexItem />

          <Button
            className={c.doneButton}
            onClick={() => {
              handleClose();
            }}
          >
            Done
          </Button>
        </div>
      </DialogActions>
    </Dialog>
  );
};

export default LayerModal;
