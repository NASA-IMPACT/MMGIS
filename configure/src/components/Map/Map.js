import React, { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import { Deck } from "@deck.gl/core";
import { BitmapLayer } from "@deck.gl/layers";
import { MVTLayer, Tile3DLayer, TileLayer } from "@deck.gl/geo-layers";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";

import ReactJson from "react-json-view";

import { makeStyles } from "@mui/styles";

const useStyles = makeStyles((theme) => ({
  Map: {
    width: "100%",
    height: "100%",
    background: theme.palette.swatches.grey[100],
    position: "relative",
    display: "flex",
  },
  mapContainer: {
    width: "100%",
    height: "100%",
    background: "#0f1010",
  },
  left: {
    flex: 1,
    height: "100%",
  },
  right: {
    height: "100%",
    overflowY: "auto",
    background: theme.palette.swatches.grey[900],
    padding: "20px",
    boxSizing: "border-box",
  },
}));

// vector is { geojson: {}, style: {}}
const Map = ({ configuration, layer, vector, clickableFeatures }) => {
  const [map, setMap] = useState(null);
  const [feature, setFeature] = useState(null);
  const mapRef = useRef(null);
  const deckRef = useRef(null);

  const c = useStyles();

  const isDeckGL = configuration?.msv?.mapEngine === "deckgl";

  const InitMap = () => {
    if (deckRef.current && deckRef.current.finalize) {
      deckRef.current.finalize();
      deckRef.current = null;
    }

    if (map && map.remove) {
      map.off();
      map.remove();
    }

    if (!mapRef.current) return;

    const m = L.map(mapRef.current, { attributionControl: false }).setView(
      [
        parseFloat(configuration?.msv?.view?.[0] || 0),
        parseFloat(configuration?.msv?.view?.[1] || 0),
      ],
      parseFloat(configuration?.msv?.view?.[2] || 4)
    );
    try {
      L.tileLayer(
        layer?.url ? layer.url : "https://c.tile.osm.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          tms: layer?.url ? true : false,
        }
      ).addTo(m);
    } catch (err) {}

    if (vector) {
      try {
        const l = L.geoJSON(vector.geojson, {
          style: function () {
            return vector.style;
          },
          pointToLayer: function (feature, latlng) {
            return L.circleMarker(latlng);
          },
          onEachFeature(feature, layer) {
            if (clickableFeatures) {
              layer.on("click", () => {
                l.setStyle({ color: vector?.style?.color || "#08aeea" });
                layer.setStyle({ color: "red" });
                setFeature(feature);
              });
            }
          },
        }).addTo(m);
        m.fitBounds(l.getBounds());
      } catch (err) {}
    }

    setMap(m);
  };

  const InitDeckGL = () => {
    if (map && map.remove) {
      map.off();
      map.remove();
      setMap(null);
    }

    if (deckRef.current && deckRef.current.finalize) {
      deckRef.current.finalize();
      deckRef.current = null;
    }

    if (!mapRef.current) return;

    const layerType = layer?.type;
    const opacity =
      layer?.initialOpacity != null ? parseFloat(layer.initialOpacity) : 1;
    const layers = [];
    let viewState = {
      latitude: parseFloat(configuration?.msv?.view?.[0] || 0),
      longitude: parseFloat(configuration?.msv?.view?.[1] || 0),
      zoom: parseFloat(configuration?.msv?.view?.[2] || 4),
      pitch: layerType === "Tile3DLayer" ? 60 : 0,
      bearing: 0,
    };

    const setDeckViewState = (nextViewState) => {
      viewState = { ...viewState, ...nextViewState };
      if (deckRef.current) deckRef.current.setProps({ viewState });
    };

    if (layer?.url) {
      if (layerType === "Tile3DLayer") {
        layers.push(
          new Tile3DLayer({
            id: "configure-preview-tile-3d",
            data: layer.url,
            loader: Tiles3DLoader,
            opacity,
            pickable: true,
            pointSize: Number(layer?.pointSize) || 2,
            onTilesetLoad: (tileset) => {
              if (Array.isArray(tileset?.cartographicCenter)) {
                setDeckViewState({
                  longitude: tileset.cartographicCenter[0],
                  latitude: tileset.cartographicCenter[1],
                  zoom: Number.isFinite(tileset.zoom)
                    ? tileset.zoom
                    : viewState.zoom,
                  pitch: 60,
                });
              }
            },
          })
        );
      } else if (layerType === "MVTLayer") {
        layers.push(
          new MVTLayer({
            id: "configure-preview-mvt",
            data: layer.url,
            minZoom: layer?.minZoom,
            maxZoom: layer?.maxNativeZoom || layer?.maxZoom,
            opacity,
            pickable: true,
          })
        );
      } else {
        layers.push(
          new TileLayer({
            id: "configure-preview-tile",
            data: layer.url,
            minZoom: layer?.minZoom,
            maxZoom: layer?.maxNativeZoom || layer?.maxZoom,
            opacity,
            tileSize: 256,
            renderSubLayers: (props) => {
              const bbox = props.tile.bbox;
              return new BitmapLayer({
                ...props,
                data: undefined,
                image: props.data,
                bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
              });
            },
          })
        );
      }
    }

    deckRef.current = new Deck({
      parent: mapRef.current,
      viewState,
      onViewStateChange: ({ viewState: nextViewState }) => {
        setDeckViewState(nextViewState);
      },
      controller: true,
      layers,
    });
  };

  // Make viewer
  useEffect(() => {
    if (isDeckGL) InitDeckGL();
    else InitMap();

    return () => {
      if (deckRef.current && deckRef.current.finalize) {
        deckRef.current.finalize();
        deckRef.current = null;
      }
    };
  }, [isDeckGL, vector, layer?.type, layer?.url]);

  return (
    <div className={c.Map}>
      <div className={c.left}>
        <div ref={mapRef} className={c.mapContainer}></div>
      </div>
      <div
        className={c.right}
        style={{
          width: feature != null ? "500px" : "0px",
          padding: feature != null ? "20px" : "0px",
        }}
      >
        <ReactJson
          src={feature}
          theme="rjv-default"
          displayObjectSize={false}
          displayDataTypes={false}
          enableClipboard={false}
          displayArrayKey={false}
          iconStyle="triangle"
        />
      </div>
    </div>
  );
};

export default Map;
