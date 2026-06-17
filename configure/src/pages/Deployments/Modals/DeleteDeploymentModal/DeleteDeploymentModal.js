import React, { useState } from "react";
import { useSelector, useDispatch } from "react-redux";

import { calls } from "../../../../core/calls";

import { setModal, setSnackBarText } from "../../../../core/ConfigureStore";

import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";

import CloseSharpIcon from "@mui/icons-material/CloseSharp";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";

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
    background: theme.palette.swatches.p[4],
    borderBottom: `1px solid ${theme.palette.swatches.grey[800]}`,
    padding: `4px ${theme.spacing(2)} 4px ${theme.spacing(4)} !important`,
  },
  title: {
    padding: `8px 0px`,
    fontSize: theme.typography.pxToRem(16),
    fontWeight: "bold",
    color: theme.palette.swatches.grey[0],
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
  backgroundIcon: {
    margin: "7px 8px 0px 0px",
  },
  deploymentName: {
    textAlign: "center",
    fontSize: "24px !important",
    letterSpacing: "1px !important",
    color: theme.palette.swatches.p[4],
    fontWeight: "bold !important",
    margin: "10px !important",
    borderBottom: `1px solid ${theme.palette.swatches.grey[100]}`,
    paddingBottom: "10px",
  },
  warning: {
    fontStyle: "italic",
    fontSize: "14px !important",
    margin: "10px !important",
    color: theme.palette.swatches.grey[300],
  },
  confirmInput: {
    width: "100%",
    margin: "10px 0px 4px 0px !important",
    borderTop: `1px solid ${theme.palette.swatches.grey[500]}`,
  },
  confirmMessage: {
    fontStyle: "italic",
    fontSize: "15px !important",
  },
  dialogActions: {
    display: "flex !important",
    justifyContent: "space-between !important",
  },
  delete: {
    background: `${theme.palette.swatches.p[4]} !important`,
    color: `${theme.palette.swatches.grey[1000]} !important`,
    "&:hover": {
      background: `${theme.palette.swatches.grey[0]} !important`,
    },
  },
  cancel: {},
}));

const MODAL_NAME = "deleteDeployment";
const DeleteDeploymentModal = (props) => {
  const { queryDeployments } = props;
  const c = useStyles();

  const modal = useSelector((state) => state.core.modal[MODAL_NAME]);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const dispatch = useDispatch();

  const [deploymentName, setDeploymentName] = useState("");

  const deployment = modal?.deployment;

  const handleClose = () => {
    setDeploymentName("");
    dispatch(setModal({ name: MODAL_NAME, on: false }));
  };
  const handleSubmit = () => {
    if (deployment?.name == null) {
      dispatch(
        setSnackBarText({
          text: "Cannot delete undefined Deployment.",
          severity: "error",
        })
      );
      return;
    }

    if (deploymentName !== deployment.name) {
      dispatch(
        setSnackBarText({
          text: "Confirmation Deployment name does not match.",
          severity: "error",
        })
      );
      return;
    }

    calls.api(
      "deleteDeployment",
      { urlReplacements: { id: deployment.id } },
      () => {
        dispatch(
          setSnackBarText({
            text: `Deleting '${deployment.name}'…`,
            severity: "success",
          })
        );
        queryDeployments();
        handleClose();
      },
      (res) => {
        dispatch(
          setSnackBarText({
            text: res?.message || `Failed to delete '${deployment.name}'.`,
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
            <div className={c.title}>Delete a Deployment</div>
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
        <Typography
          className={c.deploymentName}
        >{`Deleting: ${deployment?.name}`}</Typography>
        <Typography className={c.warning}>
          This tears down the dashboard's hosting — its bucket is emptied and
          its CloudFormation stack is deleted. The published URL stops working.
        </Typography>
        <TextField
          className={c.confirmInput}
          label="Confirm Deployment Name"
          variant="filled"
          value={deploymentName}
          onChange={(e) => {
            setDeploymentName(e.target.value);
          }}
        />
        <Typography
          className={c.confirmMessage}
        >{`Enter '${deployment?.name}' above and click 'Delete' to confirm the permanent deletion of this Deployment.`}</Typography>
      </DialogContent>
      <DialogActions className={c.dialogActions}>
        <Button
          className={c.delete}
          variant="contained"
          startIcon={<DeleteForeverIcon size="small" />}
          onClick={handleSubmit}
        >
          Delete
        </Button>
        <Button className={c.cancel} variant="outlined" onClick={handleClose}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DeleteDeploymentModal;
