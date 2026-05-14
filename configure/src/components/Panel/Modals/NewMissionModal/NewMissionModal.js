import React, { useState } from "react";
import { useSelector, useDispatch } from "react-redux";

import { calls } from "../../../../core/calls";

import {
  setMissions,
  setModal,
  setSnackBarText,
} from "../../../../core/ConfigureStore";

import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";

import CloseSharpIcon from "@mui/icons-material/CloseSharp";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";

import TextField from "@mui/material/TextField";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";

import { makeStyles, useTheme } from "@mui/styles";
import useMediaQuery from "@mui/material/useMediaQuery";

const useStyles = makeStyles((theme) => ({
  Modal: {
    margin: theme.headHeights[1],
    [theme.breakpoints.down("xs")]: {
      margin: "6px",
    },
    "& .MuiDialog-container": {
      height: "unset !important",
      transform: "translateX(-50%) translateY(-50%)",
      left: "50%",
      top: "50%",
      position: "absolute",
    },
  },
  contents: {
    background: theme.palette.primary.main,
    height: "100%",
    width: "500px",
  },
  heading: {
    height: theme.headHeights[2],
    boxSizing: "border-box",
    background: theme.palette.swatches.p[0],
    borderBottom: `1px solid ${theme.palette.swatches.grey[800]}`,
    padding: `4px ${theme.spacing(2)} 4px ${theme.spacing(4)} !important`,
  },
  title: {
    padding: `8px 0px`,
    fontSize: theme.typography.pxToRem(16),
    fontWeight: "bold",
    textTransform: "uppercase",
  },
  content: {
    padding: "8px 16px 16px 16px !important",
    height: `calc(100% - ${theme.headHeights[2]}px)`,
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
  dropdownItem: {
    width: "100%",
    margin: "8px 0px 4px 0px !important",
  },
}));

const PLANET_RADII = {
  Earth: { major: 6371008, minor: 6371008 },
  Mars: { major: 3396190, minor: 3396190 },
  "The Moon": { major: 1737400, minor: 1737400 },
};

/** Map engines available at mission creation. Cannot be changed after the mission is created. */
const MAP_ENGINES = [
  { value: "leaflet", label: "Leaflet (2D slippy map)" },
  { value: "deckgl", label: "deck.gl (WebGL 2D/3D)" },
];

const MODAL_NAME = "newMission";
const NewMissionModal = (props) => {
  const {} = props;
  const c = useStyles();

  const modal = useSelector((state) => state.core.modal[MODAL_NAME]);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const dispatch = useDispatch();

  const [missionName, setMissionName] = useState("");
  const [createDir, setCreateDir] = useState(true);
  const [selectedPlanet, setSelectedPlanet] = useState("Earth");
  const [selectedEngine, setSelectedEngine] = useState("leaflet");
  const [selectedMode, setSelectedMode] = useState("classic");
  const [basemapProvider, setBasemapProvider] = useState("none");
  const [basemapStyle, setBasemapStyle] = useState("");
  const [basemapToken, setBasemapToken] = useState("");

  const handleClose = () => {
    // close modal
    dispatch(setModal({ name: MODAL_NAME, on: false }));
  };
  const handleSubmit = () => {
    if (missionName == null || missionName === "") {
      dispatch(
        setSnackBarText({
          text: "Please enter a mission name.",
          severity: "error",
        })
      );
      return;
    }

    const planetRadius = PLANET_RADII[selectedPlanet];

    const config = {
      msv: {
        radius: {
          major: planetRadius.major,
          minor: planetRadius.minor,
        },
        mapEngine: selectedEngine,
        mode: selectedMode,
      },
    };

    if (selectedEngine === "deckgl" && basemapProvider !== "none" && basemapStyle) {
      config.msv.basemap = {
        provider: basemapProvider,
        style: basemapStyle,
        ...(basemapProvider === "mapbox" && basemapToken ? { accessToken: basemapToken } : {}),
      };
    }

    calls.api(
      "add",
      {
        mission: missionName,
        makedir: createDir,
        config: config,
      },
      (res) => {
        calls.api(
          "missions",
          null,
          (res) => {
            dispatch(setMissions(res.missions));

            dispatch(
              setSnackBarText({
                text:
                  res.message ||
                  `Successfully added new mission: ${missionName}`,
                severity: "success",
              })
            );
            // reset fields
            setMissionName("");
            setCreateDir(true);
            setSelectedPlanet("Earth");
            setSelectedEngine("leaflet");
            setSelectedMode("classic");
            setBasemapProvider("none");
            setBasemapStyle("");
            setBasemapToken("");

            // and then close
            handleClose();
          },
          (res) => {
            dispatch(
              setSnackBarText({
                text: res?.message || "Failed to requery missions.",
                severity: "error",
              })
            );

            // reset fields
            setMissionName("");
            setCreateDir(true);
            setSelectedPlanet("Earth");
            setSelectedEngine("leaflet");
            setSelectedMode("classic");
            setBasemapProvider("none");
            setBasemapStyle("");
            setBasemapToken("");

            // and then close
            handleClose();
          }
        );
      },
      (res) => {
        dispatch(
          setSnackBarText({
            text: res?.message || "Failed to make new mission.",
            severity: "error",
          })
        );
      }
    );
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
            <RocketLaunchIcon className={c.backgroundIcon} />
            <div className={c.title}>Make a New Mission</div>
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
        <Typography className={c.subtitle}>
          Missions are separately configurable MMGIS map interfaces.
        </Typography>
        <TextField
          className={c.missionNameInput}
          label="Mission Name"
          variant="filled"
          value={missionName}
          onChange={(e) => {
            setMissionName(e.target.value);
          }}
        />
        <Typography className={c.subtitle2}>
          {`A new and unique name for a mission. No special characters allowed and it should not start with a number.`}
        </Typography>
        <FormControl className={c.dropdownItem} variant="filled">
          <InputLabel>Planet</InputLabel>
          <Select
            value={selectedPlanet}
            onChange={(e) => setSelectedPlanet(e.target.value)}
            label="Planet"
          >
            <MenuItem value="Earth">Earth</MenuItem>
            <MenuItem value="Mars">Mars</MenuItem>
            <MenuItem value="The Moon">The Moon</MenuItem>
          </Select>
        </FormControl>
        <Typography className={c.subtitle2}>
          {`Select the planet to set the default radius values for this mission. You can always change this later.`}
        </Typography>
        <FormControl className={c.dropdownItem} variant="filled">
          <InputLabel>Map Engine</InputLabel>
          <Select
            value={selectedEngine}
            onChange={(e) => setSelectedEngine(e.target.value)}
            label="Map Engine"
          >
            {MAP_ENGINES.map((eng) => (
              <MenuItem key={eng.value} value={eng.value}>
                {eng.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography className={c.subtitle2}>
          {`Choose the rendering engine for this mission's 2D map. This cannot be changed after the mission is created.`}
        </Typography>
        <FormControl className={c.dropdownItem} variant="filled">
          <InputLabel>Interface Mode</InputLabel>
          <Select
            value={selectedMode}
            onChange={(e) => setSelectedMode(e.target.value)}
            label="Interface Mode"
          >
            <MenuItem value="classic">Classic</MenuItem>
            <MenuItem value="modern">Modern</MenuItem>
          </Select>
        </FormControl>
        <Typography className={c.subtitle2}>
          {`Choose a interface style for the mission. This cannot be changed after the mission is created. 
          The classic mode is the original MMGIS layout whereas the modern mode has more flexible panel arrangements and modern look and feel.`}
        </Typography>
        {selectedEngine === "deckgl" && (
          <>
            <FormControl className={c.dropdownItem} variant="filled">
              <InputLabel>Basemap</InputLabel>
              <Select
                value={basemapProvider}
                onChange={(e) => setBasemapProvider(e.target.value)}
                label="Basemap"
              >
                <MenuItem value="none">None (transparent background)</MenuItem>
                <MenuItem value="maplibre">MapLibre GL (open-source)</MenuItem>
                <MenuItem value="mapbox">Mapbox GL (requires access token)</MenuItem>
              </Select>
            </FormControl>
            <Typography className={c.subtitle2}>
              {`Optional vector-tile basemap rendered beneath deck.gl layers. Can be changed later.`}
            </Typography>
            {basemapProvider !== "none" && (
              <>
                <TextField
                  className={c.missionNameInput}
                  label="Style URL"
                  variant="filled"
                  value={basemapStyle}
                  onChange={(e) => setBasemapStyle(e.target.value)}
                />
                <Typography className={c.subtitle2}>
                  {basemapProvider === "maplibre"
                    ? `MapLibre style URL. Example: https://demotiles.maplibre.org/style.json`
                    : `Mapbox style URL. Example: mapbox://styles/mapbox/streets-v12`}
                </Typography>
              </>
            )}
            {basemapProvider === "mapbox" && (
              <>
                <TextField
                  className={c.missionNameInput}
                  label="Mapbox Access Token"
                  variant="filled"
                  value={basemapToken}
                  onChange={(e) => setBasemapToken(e.target.value)}
                />
                <Typography className={c.subtitle2}>
                  {`Mapbox public token (starts with pk.ey...). Required for Mapbox styles.`}
                </Typography>
              </>
            )}
          </>
        )}
        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                checked={createDir}
                onChange={(e) => {
                  setCreateDir(!createDir);
                }}
              />
            }
            label="Create a /Missions/{Mission Name} directory"
          />
        </FormGroup>
        <Typography className={c.subtitle2}>
          {`Layer, Tiles and Data for this mission can be stored in /Missions/{Mission Name} directory.
            Whenever a non-absolute URL is found in this mission's configuration, it will be treated as relative to this folder regardless of whether this folder exists.`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button
          className={c.addSelected}
          variant="contained"
          onClick={handleSubmit}
        >
          Make Mission
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NewMissionModal;
