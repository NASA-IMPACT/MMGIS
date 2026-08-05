// See https://www.asprs.org/wp-content/uploads/pers/2000journal/january/2000_jan_87-90.pdf for shadeding algorithm
import $ from 'jquery'
import F_ from '../../Basics/Formulae_/Formulae_'
import L_ from '../../Basics/Layers_/Layers_'
import G_ from '../../Basics/Globe_/Globe_'

let ShadeTool_Algorithm = {
    // Returns a shade grid where
    // 0: hidden
    // 1: visible
    // 2: source cell
    // 8: visible but not within elevation bounds
    // 9: no data
    perOctant: false,
    // Shade is viewshed run from the illumination source: source cell = observer
    shade: function (shadeData) {
        this.curveData(shadeData)
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

        let grids = this.initializeGrids(shadeData)

        //this.processFirst(d, grids)
        if (shadeData.targetSource.altitude > 0) {
            this.processUp(shadeData, grids)
            this.processDown(shadeData, grids)

            this.mask(shadeData, grids)
        }

        //console.log(grids)

        return grids.resultGrid
    },
    initializeGrids: function (shadeData) {
        // Initialize grids with the same dimensions as the data grid and with 0s
        let refGrid = []
        let resultGrid = []
        for (let i = 0; i < shadeData.data.length; i++) {
            refGrid.push(new Array(shadeData.data[0].length).fill(0))
            resultGrid.push(new Array(shadeData.data[0].length).fill(0))
        }

        // We're going to say that all edges (2px thick) of the screen/data are visible

        // Top and Bottom
        for (let x = 0; x < shadeData.data[0].length; x++) {
            refGrid[0][x] = shadeData.data[0][x]
            refGrid[1][x] = shadeData.data[1][x]
            resultGrid[0][x] = 1
            resultGrid[1][x] = 1
            refGrid[shadeData.data.length - 1][x] =
                shadeData.data[shadeData.data.length - 1][x]
            refGrid[shadeData.data.length - 2][x] =
                shadeData.data[shadeData.data.length - 2][x]
            resultGrid[shadeData.data.length - 1][x] = 1
            resultGrid[shadeData.data.length - 2][x] = 1
        }
        // Right and Left
        for (let y = 0; y < shadeData.data.length; y++) {
            refGrid[y][0] = shadeData.data[y][0]
            refGrid[y][1] = shadeData.data[y][1]
            resultGrid[y][0] = 1
            resultGrid[y][1] = 1
            refGrid[y][shadeData.data[0].length - 1] =
                shadeData.data[y][shadeData.data[0].length - 1]
            refGrid[y][shadeData.data[0].length - 2] =
                shadeData.data[y][shadeData.data[0].length - 2]
            resultGrid[y][shadeData.data[0].length - 1] = 1
            resultGrid[y][shadeData.data[0].length - 2] = 1
        }

        return { refGrid, resultGrid }
    },
    // Shades the "horizontal x" axis
    processFirst: function (shadeData, grids) {
        const targetSourceCell = shadeData.dataSource

        const sourceHeight =
            grids.refGrid[targetSourceCell.y][targetSourceCell.x] +
            shadeData.source.height
        let cellTargetHeight

        // Process Left
        for (let i = targetSourceCell.x - 2; i >= 0; i--) {
            grids.refGrid[targetSourceCell.y][i] = this.calcHeightLine(
                i - targetSourceCell.x,
                grids.refGrid[targetSourceCell.y][i + 1],
                sourceHeight
            )

            // Set visibility if our value is less than the data's
            cellTargetHeight =
                shadeData.data[targetSourceCell.y][i] +
                shadeData.options.targetHeight
            if (grids.refGrid[targetSourceCell.y][i] <= cellTargetHeight) {
                if (
                    this.isInElevationFOV(
                        shadeData,
                        i,
                        targetSourceCell.y,
                        sourceHeight,
                        cellTargetHeight
                    )
                )
                    grids.resultGrid[targetSourceCell.y][i] = 1
                else grids.resultGrid[targetSourceCell.y][i] = 0 //8
            }

            // Check if NoData
            if (
                ShadeTool_Algorithm.isNoData(
                    shadeData.data[targetSourceCell.y][i]
                )
            )
                grids.resultGrid[targetSourceCell.y][i] = 9

            // Set ref position to the greater: plane height or actual elevation
            grids.refGrid[targetSourceCell.y][i] = Math.max(
                grids.refGrid[targetSourceCell.y][i],
                shadeData.data[targetSourceCell.y][i]
            )
        }

        // Process Right
        for (
            let i = targetSourceCell.x + 2;
            i < shadeData.data[0].length;
            i++
        ) {
            grids.refGrid[targetSourceCell.y][i] = this.calcHeightLine(
                i - targetSourceCell.x,
                grids.refGrid[targetSourceCell.y][i - 1],
                sourceHeight
            )

            // Set visibility if our value is less than the data's
            cellTargetHeight =
                shadeData.data[targetSourceCell.y][i] +
                shadeData.options.targetHeight
            if (grids.refGrid[targetSourceCell.y][i] <= cellTargetHeight) {
                if (
                    this.isInElevationFOV(
                        shadeData,
                        i,
                        targetSourceCell.y,
                        sourceHeight,
                        cellTargetHeight
                    )
                )
                    grids.resultGrid[targetSourceCell.y][i] = 1
                else grids.resultGrid[targetSourceCell.y][i] = 0 //8
            }

            // Check if NoData
            if (
                ShadeTool_Algorithm.isNoData(
                    shadeData.data[targetSourceCell.y][i]
                )
            )
                grids.resultGrid[targetSourceCell.y][i] = 9

            // Set ref position to the greater: plane height or actual elevation
            grids.refGrid[targetSourceCell.y][i] = Math.max(
                grids.refGrid[targetSourceCell.y][i],
                shadeData.data[targetSourceCell.y][i]
            )
        }

        // Process Up
        for (let j = targetSourceCell.y - 2; j >= 0; j--) {
            grids.refGrid[j][targetSourceCell.x] = this.calcHeightLine(
                j - targetSourceCell.y,
                grids.refGrid[j + 1][targetSourceCell.x],
                sourceHeight
            )

            // Set visibility if our value is less than the data's
            cellTargetHeight =
                shadeData.data[j][targetSourceCell.x] +
                shadeData.options.targetHeight
            if (grids.refGrid[j][targetSourceCell.x] <= cellTargetHeight) {
                if (
                    this.isInElevationFOV(
                        shadeData,
                        targetSourceCell.x,
                        j,
                        sourceHeight,
                        cellTargetHeight
                    )
                )
                    grids.resultGrid[j][targetSourceCell.x] = 1
                else grids.resultGrid[j][targetSourceCell.x] = 0 //8
            }

            // Check if NoData
            if (
                ShadeTool_Algorithm.isNoData(
                    shadeData.data[j][targetSourceCell.x]
                )
            )
                grids.resultGrid[j][targetSourceCell.x] = 9

            // Set ref position to the greater: plane height or actual elevation
            grids.refGrid[j][targetSourceCell.x] = Math.max(
                grids.refGrid[j][targetSourceCell.x],
                shadeData.data[j][targetSourceCell.x]
            )
        }

        // Process Down
        for (
            let j = targetSourceCell.y + 2;
            j < shadeData.data.length;
            j++
        ) {
            grids.refGrid[j][targetSourceCell.x] = this.calcHeightLine(
                j - targetSourceCell.y,
                grids.refGrid[j - 1][targetSourceCell.x],
                sourceHeight
            )

            // Set visibility if our value is less than the data's
            cellTargetHeight =
                shadeData.data[j][targetSourceCell.x] +
                shadeData.options.targetHeight
            if (grids.refGrid[j][targetSourceCell.x] <= cellTargetHeight) {
                if (
                    this.isInElevationFOV(
                        shadeData,
                        targetSourceCell.x,
                        j,
                        sourceHeight,
                        cellTargetHeight
                    )
                )
                    grids.resultGrid[j][targetSourceCell.x] = 1
                else grids.resultGrid[j][targetSourceCell.x] = 0 //8
            }

            // Check if NoData
            if (
                ShadeTool_Algorithm.isNoData(
                    shadeData.data[j][targetSourceCell.x]
                )
            )
                grids.resultGrid[j][targetSourceCell.x] = 9

            // Set ref position to the greater: plane height or actual elevation
            grids.refGrid[j][targetSourceCell.x] = Math.max(
                grids.refGrid[j][targetSourceCell.x],
                shadeData.data[j][targetSourceCell.x]
            )
        }
    },
    processUp: function (shadeData, grids) {
        const targetSourceCell = shadeData.dataSource

        const sourceHeight = shadeData.targetSource.altitude
        let cellTargetHeight

        // Scan Up
        for (
            let j = Math.min(shadeData.data.length - 2, targetSourceCell.y - 1);
            j >= 0;
            j--
        ) {
            // Process Left
            for (
                let i = Math.min(
                    shadeData.data[0].length - 2,
                    targetSourceCell.x - 1
                );
                i >= 0;
                i--
            ) {
                if (ShadeTool_Algorithm.perOctant) {
                    grids.refGrid[j][i] =
                        i - targetSourceCell.x < j - targetSourceCell.y
                            ? this.calcHeightDiagonal2(
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j][i + 1],
                                  i - targetSourceCell.x + 1,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j + 1][i + 1],
                                  i - targetSourceCell.x + 1,
                                  j - targetSourceCell.y + 1,
                                  sourceHeight
                              )
                            : this.calcHeightDiagonal2(
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j + 1][i],
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y + 1,
                                  grids.refGrid[j + 1][i + 1],
                                  i - targetSourceCell.x + 1,
                                  j - targetSourceCell.y + 1,
                                  sourceHeight
                              )
                } else {
                    grids.refGrid[j][i] = this.calcHeightDiagonal(
                        i - targetSourceCell.x,
                        j - targetSourceCell.y,
                        grids.refGrid[j][i + 1],
                        grids.refGrid[j + 1][i],
                        sourceHeight
                    )
                }

                // Set visibility if our value is less than the data's
                cellTargetHeight =
                    shadeData.data[j][i] + shadeData.options.targetHeight
                if (grids.refGrid[j][i] <= cellTargetHeight) {
                    if (
                        this.isInElevationFOV(
                            shadeData,
                            i,
                            j,
                            sourceHeight,
                            cellTargetHeight
                        )
                    )
                        grids.resultGrid[j][i] = 1
                    else grids.resultGrid[j][i] = 0 //8
                }

                // Check if NoData
                if (ShadeTool_Algorithm.isNoData(shadeData.data[j][i]))
                    grids.resultGrid[j][i] = 9

                // Set ref position to the greater: plane height or actual elevation
                grids.refGrid[j][i] = Math.max(
                    grids.refGrid[j][i],
                    shadeData.data[j][i]
                )
            }

            // Process Right
            for (
                let i = Math.max(1, targetSourceCell.x + 1);
                i < shadeData.data[0].length;
                i++
            ) {
                if (ShadeTool_Algorithm.perOctant) {
                    grids.refGrid[j][i] =
                        i - targetSourceCell.x > Math.abs(j - targetSourceCell.y)
                            ? this.calcHeightDiagonal2(
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j][i - 1],
                                  i - targetSourceCell.x - 1,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j + 1][i - 1],
                                  i - targetSourceCell.x - 1,
                                  j - targetSourceCell.y + 1,
                                  sourceHeight
                              )
                            : this.calcHeightDiagonal2(
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j + 1][i],
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y + 1,
                                  grids.refGrid[j + 1][i - 1],
                                  i - targetSourceCell.x - 1,
                                  j - targetSourceCell.y + 1,
                                  sourceHeight
                              )
                } else {
                    grids.refGrid[j][i] = this.calcHeightDiagonal(
                        i - targetSourceCell.x,
                        j - targetSourceCell.y,
                        grids.refGrid[j][i - 1],
                        grids.refGrid[j + 1][i],
                        sourceHeight
                    )
                }

                // Set visibility if our value is less than the data's
                cellTargetHeight =
                    shadeData.data[j][i] + shadeData.options.targetHeight
                if (grids.refGrid[j][i] <= cellTargetHeight) {
                    if (
                        this.isInElevationFOV(
                            shadeData,
                            i,
                            j,
                            sourceHeight,
                            cellTargetHeight
                        )
                    )
                        grids.resultGrid[j][i] = 1
                    else grids.resultGrid[j][i] = 0 //8
                }

                // Check if NoData
                if (ShadeTool_Algorithm.isNoData(shadeData.data[j][i]))
                    grids.resultGrid[j][i] = 9

                // Set ref position to the greater: plane height or actual elevation
                grids.refGrid[j][i] = Math.max(
                    grids.refGrid[j][i],
                    shadeData.data[j][i]
                )
            }
        }
    },
    processDown: function (shadeData, grids) {
        const targetSourceCell = shadeData.dataSource

        const sourceHeight = shadeData.targetSource.altitude
        let cellTargetHeight

        // Scan Down
        for (
            let j = Math.max(1, targetSourceCell.y + 1);
            j < shadeData.data.length;
            j++
        ) {
            // Process Left
            for (
                let i = Math.min(
                    shadeData.data[0].length - 2,
                    targetSourceCell.x - 1
                );
                i >= 0;
                i--
            ) {
                if (ShadeTool_Algorithm.perOctant) {
                    grids.refGrid[j][i] =
                        Math.abs(i - targetSourceCell.x) >
                        j - targetSourceCell.y
                            ? this.calcHeightDiagonal2(
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j][i + 1],
                                  i - targetSourceCell.x + 1,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j - 1][i + 1],
                                  i - targetSourceCell.x + 1,
                                  j - targetSourceCell.y - 1,
                                  sourceHeight
                              )
                            : this.calcHeightDiagonal2(
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j - 1][i],
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y - 1,
                                  grids.refGrid[j - 1][i + 1],
                                  i - targetSourceCell.x + 1,
                                  j - targetSourceCell.y - 1,
                                  sourceHeight
                              )
                } else {
                    grids.refGrid[j][i] = this.calcHeightDiagonal(
                        i - targetSourceCell.x,
                        j - targetSourceCell.y,
                        grids.refGrid[j][i + 1],
                        grids.refGrid[j - 1][i],
                        sourceHeight
                    )
                }

                // Set visibility if our value is less than the data's
                cellTargetHeight =
                    shadeData.data[j][i] + shadeData.options.targetHeight
                if (grids.refGrid[j][i] <= cellTargetHeight) {
                    if (
                        this.isInElevationFOV(
                            shadeData,
                            i,
                            j,
                            sourceHeight,
                            cellTargetHeight
                        )
                    )
                        grids.resultGrid[j][i] = 1
                    else grids.resultGrid[j][i] = 0 //8
                }

                // Check if NoData
                if (ShadeTool_Algorithm.isNoData(shadeData.data[j][i]))
                    grids.resultGrid[j][i] = 9

                // Set ref position to the greater: plane height or actual elevation
                grids.refGrid[j][i] = Math.max(
                    grids.refGrid[j][i],
                    shadeData.data[j][i]
                )
            }

            // Process Right
            for (
                let i = Math.max(1, targetSourceCell.x + 1);
                i < shadeData.data[0].length;
                i++
            ) {
                if (ShadeTool_Algorithm.perOctant) {
                    grids.refGrid[j][i] =
                        i - targetSourceCell.x > j - targetSourceCell.y
                            ? this.calcHeightDiagonal2(
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j][i - 1],
                                  i - targetSourceCell.x - 1,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j - 1][i - 1],
                                  i - targetSourceCell.x - 1,
                                  j - targetSourceCell.y - 1,
                                  sourceHeight
                              )
                            : this.calcHeightDiagonal2(
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y,
                                  grids.refGrid[j - 1][i],
                                  i - targetSourceCell.x,
                                  j - targetSourceCell.y - 1,
                                  grids.refGrid[j - 1][i - 1],
                                  i - targetSourceCell.x - 1,
                                  j - targetSourceCell.y - 1,
                                  sourceHeight
                              )
                } else {
                    grids.refGrid[j][i] = this.calcHeightDiagonal(
                        i - targetSourceCell.x,
                        j - targetSourceCell.y,
                        grids.refGrid[j][i - 1],
                        grids.refGrid[j - 1][i],
                        sourceHeight
                    )
                }

                // Set visibility if our value is less than the data's
                cellTargetHeight =
                    shadeData.data[j][i] + shadeData.options.targetHeight
                if (grids.refGrid[j][i] <= cellTargetHeight) {
                    if (
                        this.isInElevationFOV(
                            shadeData,
                            i,
                            j,
                            sourceHeight,
                            cellTargetHeight
                        )
                    )
                        grids.resultGrid[j][i] = 1
                    else grids.resultGrid[j][i] = 0 //8
                }

                // Check if NoData
                if (ShadeTool_Algorithm.isNoData(shadeData.data[j][i]))
                    grids.resultGrid[j][i] = 9

                // Set ref position to the greater: plane height or actual elevation
                grids.refGrid[j][i] = Math.max(
                    grids.refGrid[j][i],
                    shadeData.data[j][i]
                )
            }
        }
    },
    isInElevationFOV(shadeData, i, j, sourceHeight, height) {
        if (shadeData.options.FOVElevation < 180) {
            const srcLatLng = G_.litho.projection.tileXYZ2LatLng(
                shadeData.topLeftTile.x +
                    shadeData.dataSource.x / shadeData.tileResolution,
                shadeData.topLeftTile.y +
                    shadeData.dataSource.y / shadeData.tileResolution,
                shadeData.topLeftTile.z
            )
            const latLng = G_.litho.projection.tileXYZ2LatLng(
                shadeData.topLeftTile.x + i / shadeData.tileResolution,
                shadeData.topLeftTile.y + j / shadeData.tileResolution,
                shadeData.topLeftTile.z
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
                    shadeData.options.centerElevation -
                        shadeData.options.FOVElevation / 2 &&
                ang <
                    shadeData.options.centerElevation +
                        shadeData.options.FOVElevation / 2
            )
                return true
            return false
        }
        return true
    },
    mask: function (shadeData, grids) {
        // Azimuth
        // based on options.centerAzimuth and FOVAzimuth
        if (shadeData.options.FOVAzimuth < 360) {
            let minAz =
                (shadeData.options.centerAzimuth -
                    shadeData.options.FOVAzimuth / 2 +
                    90) *
                (Math.PI / 180)
            let maxAz =
                (shadeData.options.centerAzimuth +
                    shadeData.options.FOVAzimuth / 2 +
                    90) *
                (Math.PI / 180)
            if (minAz < 0) {
                minAz += Math.PI * 2
                maxAz += Math.PI * 2
            }
            for (let y = 0; y < grids.resultGrid.length; y++) {
                for (let x = 0; x < grids.resultGrid[y].length; x++) {
                    let ang = Math.atan2(
                        shadeData.dataSource.y - y,
                        shadeData.dataSource.x - x
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
    // Zo - observer's height, constant per shade
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
    curveData: function (shadeData) {
        if (shadeData.hasDataCurved) return
        shadeData.hasDataCurved = true
        for (let j = 0; j < shadeData.data.length; j++) {
            for (let i = 0; i < shadeData.data[j].length; i++) {
                shadeData.data[j][i] = this.curve(
                    i,
                    j,
                    shadeData.data[j][i],
                    shadeData
                )
            }
        }
    },
    curve: function (i, j, height, shadeData) {
        const ll = G_.litho.projection.tileXYZ2LatLng(
            shadeData.topLeftTile.x + i / shadeData.tileResolution,
            shadeData.topLeftTile.y + j / shadeData.tileResolution,
            shadeData.topLeftTile.z
        )
        const dist = F_.lngLatDistBetween(
            shadeData.source.lng,
            shadeData.source.lat,
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

export default ShadeTool_Algorithm
