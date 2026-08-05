// See https://www.asprs.org/wp-content/uploads/pers/2000journal/january/2000_jan_87-90.pdf for viewshedding algorithm
import $ from 'jquery'
import F_ from '../../Basics/Formulae_/Formulae_'
import L_ from '../../Basics/Layers_/Layers_'
import G_ from '../../Basics/Globe_/Globe_'

let ViewshedTool_Algorithm = {
    // Returns a viewshed grid where
    // 0: hidden
    // 1: visible
    // 2: observer
    // 8: visible but not within elevation bounds
    // 9: no data
    perOctant: false,
    viewshed: function (viewshedData) {
        if (viewshedData.useCurvature) this.curveData(viewshedData)
        /*
            console.log(d)
            // TESTING =====
            d.data = [
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 2, 2, 2],
                [0, 0, 0, 0, 0, 0, 2, 0, 0],
                [0, 0, 0, 0, 0, 0, 2, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0, 0, 0, 0, 0],
            ]
            d.source.height = 2
            d.dataSource = { x: 6, y: 1 }
            // END
            */

        let grids = this.initializeGrids(viewshedData)
        this.processFirst(viewshedData, grids)
        this.processUp(viewshedData, grids)
        this.processDown(viewshedData, grids)

        this.mask(viewshedData, grids)

        //console.log(grids)

        return grids.resultGrid
    },
    initializeGrids: function (viewshedData) {
        // Initialize grids with the same dimensions as the data grid and with 0s
        let refGrid = []
        let resultGrid = []
        for (let i = 0; i < viewshedData.data.length; i++) {
            refGrid.push(new Array(viewshedData.data[0].length).fill(0))
            resultGrid.push(new Array(viewshedData.data[0].length).fill(0))
        }

        // Populate the ref grid with the observer's height
        const observerCell = viewshedData.dataSource
        viewshedData.source.surfaceHeight =
            viewshedData.data[observerCell.y][observerCell.x]
        refGrid[observerCell.y][observerCell.x] =
            viewshedData.data[observerCell.y][observerCell.x]
        resultGrid[observerCell.y][observerCell.x] = 2

        // N
        refGrid[observerCell.y - 1][observerCell.x] =
            viewshedData.data[observerCell.y - 1][observerCell.x]
        resultGrid[observerCell.y - 1][observerCell.x] = 1

        // NW
        refGrid[observerCell.y - 1][observerCell.x - 1] =
            viewshedData.data[observerCell.y - 1][observerCell.x - 1]
        resultGrid[observerCell.y - 1][observerCell.x - 1] = 1

        // W
        refGrid[observerCell.y][observerCell.x - 1] =
            viewshedData.data[observerCell.y][observerCell.x - 1]
        resultGrid[observerCell.y][observerCell.x - 1] = 1

        // SW
        refGrid[observerCell.y + 1][observerCell.x - 1] =
            viewshedData.data[observerCell.y + 1][observerCell.x - 1]
        resultGrid[observerCell.y + 1][observerCell.x - 1] = 1

        // S
        refGrid[observerCell.y + 1][observerCell.x] =
            viewshedData.data[observerCell.y + 1][observerCell.x]
        resultGrid[observerCell.y + 1][observerCell.x] = 1

        // SE
        refGrid[observerCell.y + 1][observerCell.x + 1] =
            viewshedData.data[observerCell.y + 1][observerCell.x + 1]
        resultGrid[observerCell.y + 1][observerCell.x + 1] = 1

        // E
        refGrid[observerCell.y][observerCell.x + 1] =
            viewshedData.data[observerCell.y][observerCell.x + 1]
        resultGrid[observerCell.y][observerCell.x + 1] = 1

        // NE
        refGrid[observerCell.y - 1][observerCell.x + 1] =
            viewshedData.data[observerCell.y - 1][observerCell.x + 1]
        resultGrid[observerCell.y - 1][observerCell.x + 1] = 1

        return { refGrid, resultGrid }
    },
    // Viewsheds the "horizontal x" axis
    processFirst: function (viewshedData, grids) {
        const observerCell = viewshedData.dataSource

        const observerHeight =
            grids.refGrid[observerCell.y][observerCell.x] +
            viewshedData.source.height
        let cellTargetHeight

        // Process Left
        for (let i = observerCell.x - 2; i >= 0; i--) {
            grids.refGrid[observerCell.y][i] = this.calcHeightLine(
                i - observerCell.x,
                grids.refGrid[observerCell.y][i + 1],
                observerHeight
            )

            // Set visibility if our value is less than the data's
            cellTargetHeight =
                viewshedData.data[observerCell.y][i] +
                viewshedData.options.targetHeight
            if (grids.refGrid[observerCell.y][i] <= cellTargetHeight) {
                if (
                    this.isInElevationFOV(
                        viewshedData,
                        i,
                        observerCell.y,
                        observerHeight,
                        cellTargetHeight
                    )
                )
                    grids.resultGrid[observerCell.y][i] = 1
                else grids.resultGrid[observerCell.y][i] = 0 //8
            }

            // Check if NoData
            if (
                ViewshedTool_Algorithm.isNoData(
                    viewshedData.data[observerCell.y][i]
                )
            )
                grids.resultGrid[observerCell.y][i] = 9

            // Set ref position to the greater: plane height or actual elevation
            grids.refGrid[observerCell.y][i] = Math.max(
                grids.refGrid[observerCell.y][i],
                viewshedData.data[observerCell.y][i]
            )
        }

        // Process Right
        for (
            let i = observerCell.x + 2;
            i < viewshedData.data[0].length;
            i++
        ) {
            grids.refGrid[observerCell.y][i] = this.calcHeightLine(
                i - observerCell.x,
                grids.refGrid[observerCell.y][i - 1],
                observerHeight
            )

            // Set visibility if our value is less than the data's
            cellTargetHeight =
                viewshedData.data[observerCell.y][i] +
                viewshedData.options.targetHeight
            if (grids.refGrid[observerCell.y][i] <= cellTargetHeight) {
                if (
                    this.isInElevationFOV(
                        viewshedData,
                        i,
                        observerCell.y,
                        observerHeight,
                        cellTargetHeight
                    )
                )
                    grids.resultGrid[observerCell.y][i] = 1
                else grids.resultGrid[observerCell.y][i] = 0 //8
            }

            // Check if NoData
            if (
                ViewshedTool_Algorithm.isNoData(
                    viewshedData.data[observerCell.y][i]
                )
            )
                grids.resultGrid[observerCell.y][i] = 9

            // Set ref position to the greater: plane height or actual elevation
            grids.refGrid[observerCell.y][i] = Math.max(
                grids.refGrid[observerCell.y][i],
                viewshedData.data[observerCell.y][i]
            )
        }

        // Process Up
        for (let j = observerCell.y - 2; j >= 0; j--) {
            grids.refGrid[j][observerCell.x] = this.calcHeightLine(
                j - observerCell.y,
                grids.refGrid[j + 1][observerCell.x],
                observerHeight
            )

            // Set visibility if our value is less than the data's
            cellTargetHeight =
                viewshedData.data[j][observerCell.x] +
                viewshedData.options.targetHeight
            if (grids.refGrid[j][observerCell.x] <= cellTargetHeight) {
                if (
                    this.isInElevationFOV(
                        viewshedData,
                        observerCell.x,
                        j,
                        observerHeight,
                        cellTargetHeight
                    )
                )
                    grids.resultGrid[j][observerCell.x] = 1
                else grids.resultGrid[j][observerCell.x] = 0 //8
            }

            // Check if NoData
            if (
                ViewshedTool_Algorithm.isNoData(
                    viewshedData.data[j][observerCell.x]
                )
            )
                grids.resultGrid[j][observerCell.x] = 9

            // Set ref position to the greater: plane height or actual elevation
            grids.refGrid[j][observerCell.x] = Math.max(
                grids.refGrid[j][observerCell.x],
                viewshedData.data[j][observerCell.x]
            )
        }

        // Process Down
        for (
            let j = observerCell.y + 2;
            j < viewshedData.data.length;
            j++
        ) {
            grids.refGrid[j][observerCell.x] = this.calcHeightLine(
                j - observerCell.y,
                grids.refGrid[j - 1][observerCell.x],
                observerHeight
            )

            // Set visibility if our value is less than the data's
            cellTargetHeight =
                viewshedData.data[j][observerCell.x] +
                viewshedData.options.targetHeight
            if (grids.refGrid[j][observerCell.x] <= cellTargetHeight) {
                if (
                    this.isInElevationFOV(
                        viewshedData,
                        observerCell.x,
                        j,
                        observerHeight,
                        cellTargetHeight
                    )
                )
                    grids.resultGrid[j][observerCell.x] = 1
                else grids.resultGrid[j][observerCell.x] = 0 //8
            }

            // Check if NoData
            if (
                ViewshedTool_Algorithm.isNoData(
                    viewshedData.data[j][observerCell.x]
                )
            )
                grids.resultGrid[j][observerCell.x] = 9

            // Set ref position to the greater: plane height or actual elevation
            grids.refGrid[j][observerCell.x] = Math.max(
                grids.refGrid[j][observerCell.x],
                viewshedData.data[j][observerCell.x]
            )
        }
    },
    processUp: function (viewshedData, grids) {
        const observerCell = viewshedData.dataSource

        const observerHeight =
            grids.refGrid[observerCell.y][observerCell.x] +
            viewshedData.source.height
        let cellTargetHeight

        // Scan Up
        for (let j = observerCell.y - 1; j >= 0; j--) {
            // Process Left
            for (let i = observerCell.x - 1; i >= 0; i--) {
                if (ViewshedTool_Algorithm.perOctant) {
                    grids.refGrid[j][i] =
                        i - observerCell.x < j - observerCell.y
                            ? this.calcHeightDiagonal2(
                                  i - observerCell.x,
                                  j - observerCell.y,
                                  grids.refGrid[j][i + 1],
                                  i - observerCell.x + 1,
                                  j - observerCell.y,
                                  grids.refGrid[j + 1][i + 1],
                                  i - observerCell.x + 1,
                                  j - observerCell.y + 1,
                                  observerHeight
                              )
                            : this.calcHeightDiagonal2(
                                  i - observerCell.x,
                                  j - observerCell.y,
                                  grids.refGrid[j + 1][i],
                                  i - observerCell.x,
                                  j - observerCell.y + 1,
                                  grids.refGrid[j + 1][i + 1],
                                  i - observerCell.x + 1,
                                  j - observerCell.y + 1,
                                  observerHeight
                              )
                } else {
                    grids.refGrid[j][i] = this.calcHeightDiagonal(
                        i - observerCell.x,
                        j - observerCell.y,
                        grids.refGrid[j][i + 1],
                        grids.refGrid[j + 1][i],
                        observerHeight
                    )
                }

                // Set visibility if our value is less than the data's
                cellTargetHeight =
                    viewshedData.data[j][i] + viewshedData.options.targetHeight
                if (grids.refGrid[j][i] <= cellTargetHeight) {
                    if (
                        this.isInElevationFOV(
                            viewshedData,
                            i,
                            j,
                            observerHeight,
                            cellTargetHeight
                        )
                    )
                        grids.resultGrid[j][i] = 1
                    else grids.resultGrid[j][i] = 0 //8
                }

                // Check if NoData
                if (ViewshedTool_Algorithm.isNoData(viewshedData.data[j][i]))
                    grids.resultGrid[j][i] = 9

                // Set ref position to the greater: plane height or actual elevation
                grids.refGrid[j][i] = Math.max(
                    grids.refGrid[j][i],
                    viewshedData.data[j][i]
                )
            }

            // Process Right
            for (
                let i = observerCell.x + 1;
                i < viewshedData.data[0].length;
                i++
            ) {
                if (ViewshedTool_Algorithm.perOctant) {
                    grids.refGrid[j][i] =
                        i - observerCell.x > Math.abs(j - observerCell.y)
                            ? this.calcHeightDiagonal2(
                                  i - observerCell.x,
                                  j - observerCell.y,
                                  grids.refGrid[j][i - 1],
                                  i - observerCell.x - 1,
                                  j - observerCell.y,
                                  grids.refGrid[j + 1][i - 1],
                                  i - observerCell.x - 1,
                                  j - observerCell.y + 1,
                                  observerHeight
                              )
                            : this.calcHeightDiagonal2(
                                  i - observerCell.x,
                                  j - observerCell.y,
                                  grids.refGrid[j + 1][i],
                                  i - observerCell.x,
                                  j - observerCell.y + 1,
                                  grids.refGrid[j + 1][i - 1],
                                  i - observerCell.x - 1,
                                  j - observerCell.y + 1,
                                  observerHeight
                              )
                } else {
                    grids.refGrid[j][i] = this.calcHeightDiagonal(
                        i - observerCell.x,
                        j - observerCell.y,
                        grids.refGrid[j][i - 1],
                        grids.refGrid[j + 1][i],
                        observerHeight
                    )
                }

                // Set visibility if our value is less than the data's
                cellTargetHeight =
                    viewshedData.data[j][i] + viewshedData.options.targetHeight
                if (grids.refGrid[j][i] <= cellTargetHeight) {
                    if (
                        this.isInElevationFOV(
                            viewshedData,
                            i,
                            j,
                            observerHeight,
                            cellTargetHeight
                        )
                    )
                        grids.resultGrid[j][i] = 1
                    else grids.resultGrid[j][i] = 0 //8
                }

                // Check if NoData
                if (ViewshedTool_Algorithm.isNoData(viewshedData.data[j][i]))
                    grids.resultGrid[j][i] = 9

                // Set ref position to the greater: plane height or actual elevation
                grids.refGrid[j][i] = Math.max(
                    grids.refGrid[j][i],
                    viewshedData.data[j][i]
                )
            }
        }
    },
    processDown: function (viewshedData, grids) {
        const observerCell = viewshedData.dataSource

        const observerHeight =
            grids.refGrid[observerCell.y][observerCell.x] +
            viewshedData.source.height
        let cellTargetHeight

        // Scan Down
        for (let j = observerCell.y + 1; j < viewshedData.data.length; j++) {
            // Process Left
            for (let i = observerCell.x - 1; i >= 0; i--) {
                if (ViewshedTool_Algorithm.perOctant) {
                    grids.refGrid[j][i] =
                        Math.abs(i - observerCell.x) > j - observerCell.y
                            ? this.calcHeightDiagonal2(
                                  i - observerCell.x,
                                  j - observerCell.y,
                                  grids.refGrid[j][i + 1],
                                  i - observerCell.x + 1,
                                  j - observerCell.y,
                                  grids.refGrid[j - 1][i + 1],
                                  i - observerCell.x + 1,
                                  j - observerCell.y - 1,
                                  observerHeight
                              )
                            : this.calcHeightDiagonal2(
                                  i - observerCell.x,
                                  j - observerCell.y,
                                  grids.refGrid[j - 1][i],
                                  i - observerCell.x,
                                  j - observerCell.y - 1,
                                  grids.refGrid[j - 1][i + 1],
                                  i - observerCell.x + 1,
                                  j - observerCell.y - 1,
                                  observerHeight
                              )
                } else {
                    grids.refGrid[j][i] = this.calcHeightDiagonal(
                        i - observerCell.x,
                        j - observerCell.y,
                        grids.refGrid[j][i + 1],
                        grids.refGrid[j - 1][i],
                        observerHeight
                    )
                }

                // Set visibility if our value is less than the data's
                cellTargetHeight =
                    viewshedData.data[j][i] + viewshedData.options.targetHeight
                if (grids.refGrid[j][i] <= cellTargetHeight) {
                    if (
                        this.isInElevationFOV(
                            viewshedData,
                            i,
                            j,
                            observerHeight,
                            cellTargetHeight
                        )
                    )
                        grids.resultGrid[j][i] = 1
                    else grids.resultGrid[j][i] = 0 //8
                }

                // Check if NoData
                if (ViewshedTool_Algorithm.isNoData(viewshedData.data[j][i]))
                    grids.resultGrid[j][i] = 9

                // Set ref position to the greater: plane height or actual elevation
                grids.refGrid[j][i] = Math.max(
                    grids.refGrid[j][i],
                    viewshedData.data[j][i]
                )
            }

            // Process Right
            for (
                let i = observerCell.x + 1;
                i < viewshedData.data[0].length;
                i++
            ) {
                if (ViewshedTool_Algorithm.perOctant) {
                    grids.refGrid[j][i] =
                        i - observerCell.x > j - observerCell.y
                            ? this.calcHeightDiagonal2(
                                  i - observerCell.x,
                                  j - observerCell.y,
                                  grids.refGrid[j][i - 1],
                                  i - observerCell.x - 1,
                                  j - observerCell.y,
                                  grids.refGrid[j - 1][i - 1],
                                  i - observerCell.x - 1,
                                  j - observerCell.y - 1,
                                  observerHeight
                              )
                            : this.calcHeightDiagonal2(
                                  i - observerCell.x,
                                  j - observerCell.y,
                                  grids.refGrid[j - 1][i],
                                  i - observerCell.x,
                                  j - observerCell.y - 1,
                                  grids.refGrid[j - 1][i - 1],
                                  i - observerCell.x - 1,
                                  j - observerCell.y - 1,
                                  observerHeight
                              )
                } else {
                    grids.refGrid[j][i] = this.calcHeightDiagonal(
                        i - observerCell.x,
                        j - observerCell.y,
                        grids.refGrid[j][i - 1],
                        grids.refGrid[j - 1][i],
                        observerHeight
                    )
                }

                // Set visibility if our value is less than the data's
                cellTargetHeight =
                    viewshedData.data[j][i] + viewshedData.options.targetHeight
                if (grids.refGrid[j][i] <= cellTargetHeight) {
                    if (
                        this.isInElevationFOV(
                            viewshedData,
                            i,
                            j,
                            observerHeight,
                            cellTargetHeight
                        )
                    )
                        grids.resultGrid[j][i] = 1
                    else grids.resultGrid[j][i] = 0 //8
                }

                // Check if NoData
                if (ViewshedTool_Algorithm.isNoData(viewshedData.data[j][i]))
                    grids.resultGrid[j][i] = 9

                // Set ref position to the greater: plane height or actual elevation
                grids.refGrid[j][i] = Math.max(
                    grids.refGrid[j][i],
                    viewshedData.data[j][i]
                )
            }
        }
    },
    isInElevationFOV(viewshedData, i, j, sourceHeight, height) {
        if (viewshedData.options.FOVElevation < 180) {
            const srcLatLng = G_.litho.projection.tileXYZ2LatLng(
                viewshedData.topLeftTile.x +
                    viewshedData.dataSource.x / viewshedData.tileResolution,
                viewshedData.topLeftTile.y +
                    viewshedData.dataSource.y / viewshedData.tileResolution,
                viewshedData.topLeftTile.z
            )
            const latLng = G_.litho.projection.tileXYZ2LatLng(
                viewshedData.topLeftTile.x + i / viewshedData.tileResolution,
                viewshedData.topLeftTile.y + j / viewshedData.tileResolution,
                viewshedData.topLeftTile.z
            )
            const dist = F_.lngLatDistBetween(
                srcLatLng.lng,
                srcLatLng.lat,
                latLng.lng,
                latLng.lat
            )
            const ang =
                Math.atan2(height - sourceHeight, dist) * (180 / Math.PI)
            if (
                ang >
                    viewshedData.options.centerElevation -
                        viewshedData.options.FOVElevation / 2 &&
                ang <
                    viewshedData.options.centerElevation +
                        viewshedData.options.FOVElevation / 2
            )
                return true
            return false
        }
        return true
    },
    mask: function (viewshedData, grids) {
        // Azimuth
        // based on options.centerAzimuth and FOVAzimuth
        if (viewshedData.options.FOVAzimuth < 360) {
            let minAz =
                (viewshedData.options.centerAzimuth -
                    viewshedData.options.FOVAzimuth / 2 +
                    90) *
                (Math.PI / 180)
            let maxAz =
                (viewshedData.options.centerAzimuth +
                    viewshedData.options.FOVAzimuth / 2 +
                    90) *
                (Math.PI / 180)
            if (minAz < 0) {
                minAz += Math.PI * 2
                maxAz += Math.PI * 2
            }
            for (let y = 0; y < grids.resultGrid.length; y++) {
                for (let x = 0; x < grids.resultGrid[y].length; x++) {
                    let ang = Math.atan2(
                        viewshedData.dataSource.y - y,
                        viewshedData.dataSource.x - x
                    )
                    if (ang < 0) ang += Math.PI * 2
                    if (
                        !(
                            (ang > minAz && ang < maxAz) ||
                            (ang + Math.PI * 2 > minAz &&
                                ang + Math.PI * 2 < maxAz)
                        )
                    )
                        grids.resultGrid[y][x] = 0
                }
            }
        }
    },
    isNoData(data) {
        if (data == 1010101 || data > 35000 || data < -35000) return true
        return false
    },
    // i - x coordinate from observer, follows image coordinate system
    // Za - refGrid height value, the "behind" point value
    // Zo - observer's height, constant per viewshed
    calcHeightLine: function (i, Za, Zo) {
        i = Math.abs(i)
        if (i == 1) return Za
        else return (Za - Zo) / (i - 1) + Za
    },
    calcHeightLine2: function (i, Za, Zo) {
        i = Math.abs(i)
        if (i == 1) return Za
        else return (Za - Zo) / (i - 1) + Za
    },
    calcHeightDiagonal: function (i, j, Za, Zb, Zo) {
        i = Math.abs(i)
        j = Math.abs(j)
        return ((Za - Zo) * i + (Zb - Zo) * j) / (i + j - 1) + Zo
    },
    calcHeightEdge: function (i, j, Za, Zb, Zo) {
        if (i == j) return this.calcHeightLine(i, Za, Zo)
        else return ((Za - Zo) * i + (Zb - Zo) * (j - i)) / (j - 1) + Zo
    },
    curveData: function (viewshedData) {
        if (viewshedData.hasDataCurved) return
        viewshedData.hasDataCurved = true
        for (let j = 0; j < viewshedData.data.length; j++) {
            for (let i = 0; i < viewshedData.data[j].length; i++) {
                viewshedData.data[j][i] = this.curve(
                    i,
                    j,
                    viewshedData.data[j][i],
                    viewshedData
                )
            }
        }
    },
    curve: function (i, j, height, viewshedData) {
        const ll = G_.litho.projection.tileXYZ2LatLng(
            viewshedData.topLeftTile.x + i / viewshedData.tileResolution,
            viewshedData.topLeftTile.y + j / viewshedData.tileResolution,
            viewshedData.topLeftTile.z
        )
        const dist = F_.lngLatDistBetween(
            viewshedData.source.lng,
            viewshedData.source.lat,
            ll.lng,
            ll.lat
        )
        const r = F_.radiusOfPlanetMajor
        const a = (1 / r) * dist
        return height - r * (1 - Math.cos(a))
    },
    calcHeightDiagonal2: function (i, j, Za, Ia, Ja, Zb, Ib, Jb, Zo) {
        const p = { x: 0, y: 0, z: Zo }
        const q = { x: Ia, y: Ja, z: Za }
        const r = { x: Ib, y: Jb, z: Zb }

        // Plane through p, q, r via cross product: a*x + b*y + c*z + d = 0
        const a1 = q.x - p.x
        const b1 = q.y - p.y
        const c1 = q.z - p.z
        const a2 = r.x - p.x
        const b2 = r.y - p.y
        const c2 = r.z - p.z
        const a = b1 * c2 - b2 * c1
        const b = a2 * c1 - a1 * c2
        const c = a1 * b2 - b1 * a2
        const d = -a * p.x - b * p.y - c * p.z

        let result = (a * i + b * j + d) / -c

        result =
            result == Infinity || result == -Infinity || isNaN(result)
                ? this.calcHeightLine2(i, Zb, Zo)
                : result

        //console.log(p, q, r, i, j, result)

        return result
    },
}

export default ViewshedTool_Algorithm
