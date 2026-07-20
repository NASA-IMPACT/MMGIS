import React from "react";
import { useSelector, useDispatch } from "react-redux";

import { setSnackBarText } from "../../core/ConfigureStore";

import { makeStyles } from "@mui/styles";

import Snackbar from "@mui/material/Snackbar";
import MuiAlert from "@mui/material/Alert";
import Link from "@mui/material/Link";

const useStyles = makeStyles((theme) => ({
  main: { top: "74px !important" },
  snackbar: {
    fontSize: 14,
    fontWeight: "bold",
  },
}));

// Just a small bit of anti-pattern so that, when the snackbar fades, it
// doesn't snap to a no text state
let afterImage = "";

const SnackBar = (props) => {
  const c = useStyles();
  const dispatch = useDispatch();

  const snackBarText = useSelector((state) => state.core.snackBarText);

  const openSnackbar = snackBarText !== false;

  const handleCloseSnackbar = (e, reason) => {
    if (reason === "clickaway") return;
    dispatch(setSnackBarText(false));
  };

  afterImage = snackBarText.text || afterImage;

  return (
    <Snackbar
      className={c.main}
      anchorOrigin={{
        vertical: "top",
        horizontal: "right",
      }}
      open={openSnackbar}
      // A toast carrying a link (e.g. a freshly published dashboard URL)
      // stays until dismissed; plain toasts auto-hide.
      autoHideDuration={snackBarText.link ? null : 5000}
      onClose={handleCloseSnackbar}
    >
      <MuiAlert
        className={c.snackbar}
        elevation={6}
        variant="filled"
        onClose={handleCloseSnackbar}
        severity={snackBarText.severity || "success"}
      >
        {snackBarText.text || afterImage}
        {snackBarText.link ? (
          <Link
            href={snackBarText.link}
            target="_blank"
            rel="noopener"
            color="inherit"
            style={{ marginLeft: "6px" }}
          >
            {snackBarText.link}
          </Link>
        ) : null}
      </MuiAlert>
    </Snackbar>
  );
};

SnackBar.propTypes = {};

export default SnackBar;
