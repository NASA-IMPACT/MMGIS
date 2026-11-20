---
layout: page
title: Image 
permalink: /configure/layers/image
parent: Layers
grand_parent: Configure
---

# Image  Layer

Image layers are GeoTIFF or Cloud Optimized GeoTIFFS (COGs). This currently only supports single banded GeoTIFF/COG images.

#### Layer Name

_type:_ string  
The unique display name and identifier of the layer. It must be unique and contain no special characters.

#### URL

_type:_ string  
A file path that points to a GeoTIFF or COG image. If the path is relative, it will be relative to the mission's directory.

#### Legend

_type:_ string  
An absolute or relative file path pointing to a `legend.csv` that describes the symbology of the layer. Please see the Legend Tool to see how to form a `legend.csv`.

#### Unit

_type:_ object  
Declares the unit the layer's data is in, which the legend, the feature popup, the timeseries card and the Identifier all print. Set on the Legend tab as `variables.unit`:

- **Unit** (`sourceUnit`): the data's unit, e.g. `μg/m³`. Wins over the raster Units field and over a unit written into the legend labels.
- **Show In** (`displayUnit`): the unit to show by default; one of the options, or empty for the data's own.
- **Unit Options** (`options`): other units the layer can be shown in, each a `label`, a `scale` and an optional `offset`, converting as `shown = value × scale + offset`. A layer with options shows a unit picker on its legend card; picking one relabels the legend bounds, the popup value and the timeseries together. Colors never change, only the printed numbers. The factor is often specific to the layer (μg/m³ to ppb depends on the pollutant).

```json
"unit": {
  "sourceUnit": "μg/m³",
  "options": [{ "label": "mg/m³", "scale": 0.001 }]
}
```

#### Fill min/max

_type:_ bool  
Fill in with the maximum color or minimum color value if below min and/or above max of the band

#### Hide No Data Value

_type:_ bool  
If true, hides all values where there is no data. This requires the image to have the nodata value set. 

#### Transform COG

_type:_ bool  
Enable rescaling and coloring single banded COGs on the fly. This only supports single banded GeoTIFF/COG images.

#### Minimum Pixel Data Value

_type:_ float _optional_  
If using single banded COGs, the default minimum value for which to rescale.

#### Maximum Pixel Data Value

_type:_ float _optional_  
If using single banded COGs, the default maximum value for which to rescale.

#### Maximum Pixel Data Value

_type:_ string _optional_  
Units string by which to suffix values. For instance if the units are meters, use 'm' so that values are displayed as '100m'.

#### Colormap 

_type:_ string _optional_  
Select using the drop down of available colors, which uses the intersection of colormaps from TiTiler  and js-colormaps.

#### Initial Visibility

_type:_ bool  
Whether the layer is on initially.

#### Initial Opacity

_type:_ float  
A value from 0 to 1 of the layer's initial opacity. 1 is fully opaque.

#### Minimum Zoom

_type:_ integer  
The lowest (smallest number) zoom level of the tile set.  
_Note: This field can be automatically populate with "Populate from XML". "Populate from XML" uses looks for a `tilemapresource.xml` in the tileset directory specified by the URL field._

#### Maximum Native Zoom

_type:_ integer  
The highest (largest number) zoom level of the tile set.  
_Note: This field can be automatically populate with "Populate from XML". "Populate from XML" uses looks for a `tilemapresource.xml` in the tileset directory specified by the URL field._

#### Maximum Zoom

_type:_ integer  
The highest (largest number) zoom level to see in MMGIS. This value is at least as high as Maximum Native Zoom. This allows zooms level higher than that of the tileset. Instead of rendering new tile image, it scales them in instead.

#### Bounding Box

_type:_ string _optional_  
A comma separated string defining the tileset's `minimumLonDeg,minimumLatDeg,maximumLonDeg,maximumLatDeg`. Setting a bounding box improves performance by limiting requests for tiles to only those that fit the bounds.  
_Note: This field can be automatically populate with "Populate from XML". "Populate from XML" uses looks for a `tilemapresource.xml` in the tileset directory specified by the URL field._
