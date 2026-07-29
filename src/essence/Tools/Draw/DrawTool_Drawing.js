import $ from 'jquery'
import F_ from '../../Basics/Formulae_/Formulae_'
import L_ from '../../Basics/Layers_/Layers_'
import Map_ from '../../Basics/Map_/Map_'
import CursorInfo from '../../Ancillary/CursorInfo'
import turf from 'turf'
import { circle as turfCircle } from '@turf/turf'

import calls from '../../../pre/calls'

var DrawTool = null
var Drawing = {
    init: function (tool) {
        DrawTool = tool
        DrawTool.drawing = drawing
        DrawTool.drawOver = Drawing.drawOver
        DrawTool.drawThrough = Drawing.drawThrough
        DrawTool.drawUnder = Drawing.drawUnder
        DrawTool.drawOverThroughUnder = Drawing.drawOverThroughUnder
        DrawTool.endDrawing = Drawing.endDrawing
        DrawTool.setDrawingType = Drawing.setDrawingType
        DrawTool.switchDrawingType = Drawing.switchDrawingType
        DrawTool.setDrawing = Drawing.setDrawing

        L.Draw.Polyline.prototype._onTouch = L.Util.falseFn
    },
    drawOver: function (drawState, clip, callback) {
        var file_id =
            drawState.file_id == undefined
                ? DrawTool.currentFileId
                : drawState.file_id
        var lk = 'DrawTool_' + file_id

        let tag = null
        if (drawState.shape && drawState.shape.properties)
            tag = drawState.shape.properties.uuid

        // Add a temporary copy of the feature to the map immediately
        // This keeps it visible while we wait for the database save and reload
        const tempFeature = {
            type: 'Feature',
            geometry: typeof drawState.shape.geometry === 'string' ? JSON.parse(drawState.shape.geometry) : drawState.shape.geometry,
            properties: typeof drawState.shape.properties === 'string' ? JSON.parse(drawState.shape.properties) : drawState.shape.properties
        }

        let tempLayer
        try {
            tempLayer = L.geoJson(tempFeature, {
                style: tempFeature.properties.style || DrawTool.defaultStyle
            }).addTo(Map_.map)
        } catch (e) {
            console.error('[DrawTool] Failed to create temporary layer:', e)
        }

        DrawTool.addDrawing(
            {
                file_id: file_id,
                intent: drawState.intent,
                properties: JSON.stringify(drawState.shape.properties),
                geometry: JSON.stringify(drawState.shape.geometry),
                tag: tag,
                clip: clip,
            },
            (function (shape, tempLayer) {
                return function (data) {
                    DrawTool.refreshFile(DrawTool.currentFileId, null, true, null, false, function() {
                        // Remove the temporary layer now that the real feature is rendered
                        if (tempLayer) {
                            try {
                                Map_.map.removeLayer(tempLayer)
                            } catch (e) {
                                console.error('[DrawTool] Failed to remove temporary layer:', e)
                            }
                        }

                        // Clean up and restart drawing mode after refresh completes
                        if (drawState.end && drawState.begin) {
                            drawState.end()
                            drawState.begin()
                        }
                        if (typeof callback === 'function') callback(data)
                    }, null, null, true)
                }
            })(JSON.parse(JSON.stringify(drawState.shape)), tempLayer),
            function () {
                if (drawState.end && drawState.begin) {
                    drawState.end()
                    drawState.begin()
                }
            }
        )
    },
    drawThrough: function (drawState) {
        //Drawn the regular shape
        //DrawTool.drawOver(drawState)

        //Then modify the ones it overlapped
        var bb = turf.bbox(drawState.shape)

        var fileLayers = L_.layers.layer['DrawTool_' + DrawTool.currentFileId]

        throughLoop(0)
        function throughLoop(i) {
            if (i >= fileLayers.length) {
                //Draw the regular shape
                setTimeout(
                    (function (drawState) {
                        return function () {
                            DrawTool.drawOver(drawState)
                        }
                    })(drawState),
                    2
                )
            } else {
                let features = fileLayers[i]
                    ? fileLayers[i].toGeoJSON(L_.GEOJSON_PRECISION).features
                    : null
                if (features != null) {
                    let geojson = features[0]
                    if (F_.doBoundingBoxesIntersect(bb, turf.bbox(geojson))) {
                        let newGeometry
                        let noChange = false
                        try {
                            newGeometry = turf.difference(
                                geojson,
                                drawState.shape
                            ).geometry
                            if (
                                JSON.stringify(newGeometry) ==
                                JSON.stringify(geojson)
                            )
                                noChange = true
                        } catch (error) {
                            CursorInfo.update('ERROR: Topology.', 2500, true, {
                                x: 305,
                                y: 6,
                            })
                            if (drawState.end && drawState.begin) {
                                drawState.end()
                                drawState.begin()
                            }
                            return
                        }

                        if (!noChange) {
                            var feature =
                                fileLayers[i]._layers[
                                    Object.keys(fileLayers[i]._layers)[0]
                                ].feature
                            feature.geometry = newGeometry

                            if (DrawTool.vars.demtilesets) {
                                F_.lnglatsToDemtileElevs(
                                    feature.geometry,
                                    DrawTool.vars.demtilesets,
                                    function (data) {
                                        feature.geometry = data
                                        drawEdit(feature)
                                        //geoJSON = F_.geojsonAddSpatialProperties(geoJSON)
                                    }
                                )
                            } else {
                                drawEdit(feature)
                            }
                        } else {
                            throughLoop(i + 1)
                        }

                        function drawEdit(feature) {
                            calls.api(
                                'draw_edit',
                                {
                                    feature_id: feature.properties._.id,
                                    file_id: DrawTool.currentFileId,
                                    geometry: JSON.stringify(feature.geometry),
                                },
                                (function (feature, i) {
                                    return function (result) {
                                        feature.properties._.id = result.body.id
                                        Map_.rmNotNull(fileLayers[i])
                                        fileLayers[i] = L.geoJson(
                                            {
                                                type: 'FeatureCollection',
                                                features: [feature],
                                            },
                                            {
                                                style: function (feature) {
                                                    return feature.properties
                                                        .style
                                                },
                                            }
                                        ).addTo(Map_.map)

                                        //Reorder the layers
                                        for (let j = i; j >= 0; j--) {
                                            if (fileLayers[j] != null)
                                                fileLayers[j].bringToBack()
                                        }

                                        //Make sure the last drawn stays on top
                                        fileLayers[i].bringToFront()
                                        setTimeout(
                                            (function (i) {
                                                return function () {
                                                    throughLoop(i + 1)
                                                }
                                            })(i),
                                            2
                                        )
                                    }
                                })(feature, i),
                                function () {
                                    throughLoop(i + 1)
                                    CursorInfo.update(
                                        'Failed to cut through some shapes.',
                                        6000,
                                        true,
                                        { x: 305, y: 6 }
                                    )
                                }
                            )
                        }
                    } else {
                        throughLoop(i + 1)
                    }
                } else {
                    throughLoop(i + 1)
                }
            }
        }
    },
    drawUnder: function (drawState) {
        //Modify shape based on intersecting features
        var bb = turf.bbox(drawState.shape)
        var fileLayers = L_.layers.layer['DrawTool_' + DrawTool.currentFileId]

        for (var i = 0; i < fileLayers.length; i++) {
            if (fileLayers[i] == null) continue
            let geojson =
                fileLayers[i].feature ||
                fileLayers[i]._layers[
                    Object.keys(fileLayers[i]._layers)[0]
                ].feature
            if (F_.doBoundingBoxesIntersect(bb, turf.bbox(geojson))) {
                let newGeometry
                try {
                    newGeometry = turf.difference(
                        drawState.shape,
                        geojson
                    ).geometry
                    if (
                        JSON.stringify(newGeometry) !=
                        JSON.stringify(drawState.shape)
                    ) {
                        drawState.shape.geometry = newGeometry
                    }
                } catch (error) {
                    CursorInfo.update('ERROR: Topology.', 2500, true, {
                        x: 305,
                        y: 6,
                    })
                    if (drawState.end && drawState.begin) {
                        drawState.end()
                        drawState.begin()
                    }
                    return
                }
            }
        }

        // Draw the shape
        DrawTool.drawOver(drawState)
    },
    drawOverThroughUnder: function (drawState) {
        var tier = $('#drawToolDrawSettingsTier > div.active').attr('value')
        DrawTool.drawOver(drawState, tier)
    },
    endDrawing: function () {
        DrawTool.drawing.polygon.end()
        DrawTool.drawing.circle.end()
        DrawTool.drawing.rectangle.end()
        DrawTool.drawing.line.end()
        DrawTool.drawing.point.end()
        DrawTool.drawing.annotation.end()
        DrawTool.drawing.arrow.end()
    },
    setDrawingType: function (type) {
        switch (type) {
            case 'polygon':
                DrawTool.drawing.polygon.begin(type)
                break
            case 'circle':
                DrawTool.drawing.circle.begin(type)
                break
            case 'rectangle':
                DrawTool.drawing.rectangle.begin(type)
                break
            case 'line':
                DrawTool.drawing.line.begin(type)
                break
            case 'point':
                DrawTool.drawing.point.begin(type)
                break
            case 'text':
                DrawTool.drawing.annotation.begin(type)
                break
            case 'arrow':
                DrawTool.drawing.arrow.begin(type)
                break
            default:
                break
        }
    },
    switchDrawingType: function (type) {
        $('#drawToolDrawingTypeDiv > div').removeClass('active')
        if (type != null) {
            var elm = $('.drawToolDrawingType' + type)
            elm.addClass('active')

            DrawTool.setDrawingType($(this).attr('draw'))
        } else {
            $('#drawToolDrawingTypeDiv > div').css(
                'background',
                'var(--color-a2)'
            )
        }
    },
    setDrawing: function (onlyIntentChanged) {
        if (onlyIntentChanged) DrawTool.currentFileId = null
        switch (DrawTool.intentType) {
            case 'roi':
                DrawTool.switchDrawingType('Polygon')
                DrawTool.drawing.polygon.begin('roi')
                break
            case 'campaign':
                DrawTool.switchDrawingType('Polygon')
                DrawTool.drawing.polygon.begin('campaign')
                break
            case 'campsite':
                DrawTool.switchDrawingType('Polygon')
                DrawTool.drawing.polygon.begin('campsite')
                break
            case 'signpost':
                DrawTool.switchDrawingType('Point')
                DrawTool.drawing.point.begin('signpost')
                break
            case 'trail':
                DrawTool.switchDrawingType('Line')
                DrawTool.drawing.line.begin('trail')
                break
            case 'note':
                DrawTool.switchDrawingType('Text')
                DrawTool.drawing.annotation.begin('note')
                break
            case 'all':
                DrawTool.switchDrawingType('Polygon')
                DrawTool.drawing.polygon.begin('polygon')
                break
            default:
                DrawTool.drawing.polygon.end()
                DrawTool.drawing.circle.end()
                DrawTool.drawing.rectangle.end()
                DrawTool.drawing.point.end()
                DrawTool.drawing.line.end()
                DrawTool.drawing.annotation.end()
                break
        }

        if (DrawTool.intentType != null) {
            var color = DrawTool.categoryStyles[DrawTool.intentType].color
            $('#drawToolDrawIntentFilterDiv').css('background', color)
            $('#drawToolDrawingTypeDiv > div').css(
                'background',
                'var(--color-a2)'
            )
            $('#drawToolDrawingTypeDiv div.active').css('background', color)
            $('#drawToolDrawingTypeDiv').css('background', color)
            /*
            $('#drawToolDrawingInIndicator').css('background', color)
            $('#drawToolDrawingInIndicator').css(
                'color',
                DrawTool.intentType != 'campaign' &&
                    DrawTool.intentType != 'campsite' &&
                    DrawTool.intentType != 'trail'
                    ? '#ededed'
                    : '#222'
            )
            $('#drawToolDrawingInIndicator').text(
                'Drawing ' + DrawTool.prettyIntent(DrawTool.intentType)
            )
            */
        }
        $('#drawToolDrawFeaturesNewName').attr(
            'placeholder',
            DrawTool.intentType
        )
    },
}

var drawing = {
    polygon: {
        begin: function (intent) {
            var drawState = drawing.polygon

            //Overwrite Leaflet.Draw esc key to restart drawing
            L.Draw.Feature.prototype._cancelDrawing = function (e) {
                if (e.keyCode === 27) {
                    drawState.end()
                    drawState.begin()
                }
            }

            //Clear any other drawing events
            drawing.circle.end()
            drawing.rectangle.end()
            drawing.line.end()
            drawing.point.end()
            drawing.annotation.end()
            drawing.arrow.end()

            drawState.end()
            drawState.movemode = false
            drawState.shiftDisabled = false
            drawState.lastVertex = null

            if (intent != undefined) {
                drawState.intent = intent
                drawState.style = DrawTool.categoryStyles[intent]
            }

            drawState.drawing = new L.Draw.Polygon(Map_.map, {
                showArea: true,
                allowIntersection: false,
                guidelineDistance: 15,
                icon: new L.DivIcon({
                    iconSize: new L.Point(10, 10),
                    className: 'leaflet-div-icon leaflet-editing-icon',
                }),
                shapeOptions: drawState.style,
            })
            drawState.drawing.enable()

            drawState.shape = drawState.drawing

            Map_.map.on('click', drawState.start)
            Map_.map.on('draw:drawstop', drawState.stop)
            $('body').on('keydown', drawState.keydown)
            $('body').on('keyup', drawState.keyup)
        },
        end: function () {
            var drawState = drawing.polygon

            drawState.stopclick = false

            Map_.map.off('click', drawState.start)
            Map_.map.off('mousemove', drawState.move)
            Map_.map.off('draw:drawstop', drawState.stop)
            $('body').off('keydown', drawState.keydown)
            $('body').off('keyup', drawState.keyup)

            if (typeof drawState.drawing.disable === 'function') {
                drawState.drawing.disable()
            }
        },
        start: function (e) {
            var drawState = drawing.polygon

            if (!drawState.stopclick) {
                drawState.stopclick = true
                Map_.map.on('mousemove', drawState.move)
            }

            //Store this at start to avoid mixed modes
            if (
                $('#drawToolDrawSettingsMode > div.active').attr('value') ==
                'on'
            ) {
                drawState.movemode = true
                Map_.map.on('click', drawState.complete)
            }

            drawState.lastVertex = e.latlng
            drawState.shape = drawState.drawing._poly
        },
        complete: function () {
            var drawState = drawing.polygon

            drawState.drawing.completeShape()
            Map_.map.off('click', drawState.complete)
        },
        keydown: function (e) {
            var drawState = drawing.polygon
            //Ctrl-Z
            if (mmgisglobal.ctrlDown && e.which == '90')
                drawState.drawing.deleteLastVertex()
            //Ctrl and no drawing
            else if (
                mmgisglobal.ctrlDown &&
                (!drawState.drawing._markers ||
                    drawState.drawing._markers.length === 0)
            ) {
                drawState.shiftDisabled = true
                if (typeof drawState.drawing.disable === 'function')
                    drawState.drawing.disable()
            }
        },
        keyup: function (e) {
            var drawState = drawing.polygon
            if (
                !drawState.drawing._enabled &&
                (e.which == '17' ||
                    e.which == '91' ||
                    e.which == '93' ||
                    e.which == '224')
            ) {
                drawState.shiftDisabled = false
                drawState.drawing.enable()
            }
        },
        move: function (e) {
            var drawState = drawing.polygon

            if (e && drawState.movemode) {
                let res = parseInt(
                    $('#drawToolDrawSettingsModeVertexRes').val(),
                    drawState.lastVertex
                )
                drawState.currentrate++
                let dist = F_.lngLatDistBetween(
                    drawState.lastVertex.lng,
                    drawState.lastVertex.lat,
                    e.latlng.lng,
                    e.latlng.lat
                )

                if (dist > res) {
                    let pt = F_.getPtSomeDistBetween2OtherPts(
                        drawState.lastVertex.lng,
                        drawState.lastVertex.lat,
                        e.latlng.lng,
                        e.latlng.lat,
                        res / dist
                    )
                    pt = { lng: pt.x, lat: pt.y }
                    try {
                        drawState.drawing.addVertex(pt)
                        drawState.lastVertex = pt
                    } catch (e) {}
                    drawState.currentrate = 0
                }
            }

            drawState.shape = drawState.drawing._poly || drawState.shape
        },
        stop: function () {
            var drawState = drawing.polygon
            if (drawState.shiftDisabled) return

            drawState.shape = drawState.shape.toGeoJSON(L_.GEOJSON_PRECISION)

            drawState.shape.geometry.type = 'Polygon'
            drawState.shape.geometry.coordinates.push(
                drawState.shape.geometry.coordinates[0]
            )
            drawState.shape.geometry.coordinates = [
                drawState.shape.geometry.coordinates,
            ]
            drawState.shape.properties.style = drawState.style
            var newNameInput = $('#drawToolDrawFeaturesNewName')
            drawState.shape.properties.name =
                newNameInput.val() ||
                newNameInput.attr('placeholder') ||
                'Polygon'
            DrawTool.drawOverThroughUnder(drawState)
        },
        stopclick: false,
        intent: null,
        movemode: false,
        rate: 8,
        currentrate: 0,
        lastVertex: null,
        shiftDisabled: false,
        style: {},
        drawing: {},
        shape: {},
    },
    circle: {
        begin: function (intent, overrideStyle) {
            var drawState = drawing.circle
            //Overwrite Leaflet.Draw esc key to restart drawing
            L.Draw.Feature.prototype._cancelDrawing = function (e) {
                if (e.keyCode === 27) {
                    drawState.end()
                    drawState.begin()
                }
            }

            //Clear any other drawing events
            drawing.polygon.end()
            drawing.rectangle.end()
            drawing.line.end()
            drawing.point.end()
            drawing.annotation.end()
            drawing.arrow.end()

            drawState.end()

            drawState.movemode = false
            drawState.shiftDisabled = false
            drawState.lastVertex = null

            if (intent != undefined) {
                drawState.intent =
                    DrawTool.intentType === 'all'
                        ? 'polygon'
                        : DrawTool.intentType
                drawState.style = DrawTool.categoryStyles[drawState.intent]
            }
            if (overrideStyle) {
                drawState.style = overrideStyle
            }

            Map_.map.on('click', drawState.start)
            Map_.map.on('draw:drawstop', drawState.stop)
            $('body').on('keydown', drawState.keydown)
            $('body').on('keyup', drawState.keyup)
        },
        start: function (e) {
            let drawState = drawing.circle
            drawState.shape = e.latlng

            //Store this at start to avoid mixed modes
            if (
                $('#drawToolDrawSettingsCircle > div.active').attr('value') ==
                'on'
            ) {
                const forcedRadius = parseFloat(
                    $('#drawToolDrawSettingsCircleR').val()
                )
                drawState.shapeEnd = F_.destinationFromBearing(
                    drawState.shape.lat,
                    drawState.shape.lng,
                    0,
                    forcedRadius * 0.001 // km
                )
                drawState.shapeEnd = {
                    lat: drawState.shapeEnd[0],
                    lng: drawState.shapeEnd[1],
                }

                drawState.circleFeature = F_.circleFeatureFromTwoLngLats(
                    drawState.shape,
                    drawState.shapeEnd,
                    64,
                    window.mmgisglobal.customCRS
                )
                drawState.circleFeature.properties.style = drawState.style
                drawState.circleFeature.properties._radius = forcedRadius
                drawState.stop()
            } else {
                Map_.map.on('mousemove', drawState.move)
                Map_.map.on('click', drawState.stop)
                Map_.map.off('click', drawState.start)
            }
        },
        move: function (e) {
            let drawState = drawing.circle
            drawState.shapeEnd = e.latlng

            drawState.mRadius = F_.lngLatDistBetween(
                drawState.shape.lng,
                drawState.shape.lat,
                drawState.shapeEnd.lng,
                drawState.shapeEnd.lat
            )

            drawState.circleFeature = F_.circleFeatureFromTwoLngLats(
                drawState.shape,
                drawState.shapeEnd,
                64,
                window.mmgisglobal.customCRS
            )
            drawState.circleFeature.properties.style = drawState.style
            drawState.circleFeature.properties._radius = drawState.mRadius
            Map_.rmNotNull(drawState.tempCircle)
            drawState.tempCircle = L.geoJSON(
                F_.getBaseGeoJSON([drawState.circleFeature]),
                {
                    style: drawState.style,
                }
            ).addTo(Map_.map)

            Map_.rmNotNull(drawState.tempLine)
            drawState.tempLine = L.polyline(
                [
                    [drawState.shape.lat, drawState.shape.lng],
                    [drawState.shapeEnd.lat, drawState.shapeEnd.lng],
                ],
                {
                    color: 'black',
                    dashArray: '8 8',
                    weight: 2,
                    lineCap: 'square',
                }
            ).addTo(Map_.map)

            CursorInfo.update(
                `Radius: ${drawState.mRadius.toFixed(3)}m`,
                null,
                false,
                {
                    x: e.originalEvent.clientX + 30,
                    y: e.originalEvent.clientY - 15,
                }
            )
        },
        end: function () {
            let drawState = drawing.circle

            drawState.stopclick = false

            CursorInfo.hide()
            Map_.rmNotNull(drawState.tempLine)
            Map_.rmNotNull(drawState.tempCircle)

            Map_.map.off('click', drawState.start)
            Map_.map.off('click', drawState.stop)
            Map_.map.off('mousemove', drawState.move)
            Map_.map.off('draw:drawstop', drawState.stop)
            $('body').off('keydown', drawState.keydown)
            $('body').off('keyup', drawState.keyup)
            if (typeof drawState.drawing.disable === 'function')
                drawState.drawing.disable()
        },
        stop: function () {
            let drawState = drawing.circle

            if (drawState.shiftDisabled) return

            var newNameInput = $('#drawToolDrawFeaturesNewName')
            drawState.circleFeature.properties.name =
                newNameInput.val() ||
                newNameInput.attr('placeholder') ||
                'Circle'

            CursorInfo.hide()

            DrawTool.addDrawing(
                {
                    file_id: DrawTool.currentFileId,
                    intent: drawState.intent,
                    properties: JSON.stringify(
                        drawState.circleFeature.properties
                    ),
                    geometry: JSON.stringify(drawState.circleFeature.geometry),
                },
                function (data) {
                    DrawTool.refreshFile(DrawTool.currentFileId, null, true, null, false, function() {
                        drawState.end()
                        drawState.begin()
                    }, null, null, true)
                },
                function () {
                    if (drawState.end && drawState.begin) {
                        drawState.end()
                        drawState.begin()
                    }
                }
            )
        },
        stopclick: false,
        shiftDisabled: false,
        intent: null,
        style: {},
        drawing: {},
        mRadius: 0,
        tempLine: null,
        tempCircle: null,
        shape: {},
        shapeEnd: {},
        circleShape: {},
    },
    rectangle: {
        begin: function (intent, overrideStyle) {
            var drawState = drawing.rectangle
            //Overwrite Leaflet.Draw esc key to restart drawing
            L.Draw.Feature.prototype._cancelDrawing = function (e) {
                if (e.keyCode === 27) {
                    drawState.end()
                    drawState.begin()
                }
            }

            //Clear any other drawing events
            drawing.polygon.end()
            drawing.circle.end()
            drawing.line.end()
            drawing.point.end()
            drawing.annotation.end()
            drawing.arrow.end()

            drawState.end()

            drawState.movemode = false
            drawState.shiftDisabled = false
            drawState.lastVertex = null

            if (intent != undefined) {
                drawState.intent =
                    DrawTool.intentType === 'all'
                        ? 'polygon'
                        : DrawTool.intentType
                drawState.style = DrawTool.categoryStyles[drawState.intent]
            }
            if (overrideStyle) {
                drawState.style = overrideStyle
            }

            drawState.drawing = new L.Draw.Rectangle(Map_.map, {
                shapeOptions: drawState.style,
            })
            drawState.drawing.enable()

            drawState.shape = drawState.drawing

            Map_.map.on('draw:created', drawState.stop)
        },
        end: function () {
            var drawState = drawing.rectangle

            drawState.stopclick = false

            Map_.map.off('draw:created', drawState.stop)
            if (typeof drawState.drawing.disable === 'function')
                drawState.drawing.disable()
        },
        stop: function (drawEvent) {
            var drawState = drawing.rectangle

            if (drawState.shiftDisabled) return

            const bounds = drawEvent.layer._bounds
            drawState.shape = F_.boundingBoxToFeature(
                bounds._northEast,
                bounds._southWest
            )

            drawState.shape.properties.style = drawState.style
            var newNameInput = $('#drawToolDrawFeaturesNewName')
            drawState.shape.properties.name =
                newNameInput.val() ||
                newNameInput.attr('placeholder') ||
                'Rectangle'

            DrawTool.addDrawing(
                {
                    file_id: DrawTool.currentFileId,
                    intent: drawState.intent,
                    properties: JSON.stringify(drawState.shape.properties),
                    geometry: JSON.stringify(drawState.shape.geometry),
                },
                (function (shape) {
                    return function (data) {
                        DrawTool.refreshFile(DrawTool.currentFileId, null, true, null, false, function() {
                            drawState.begin()
                        }, null, null, true)
                    }
                })(JSON.parse(JSON.stringify(drawState.shape))),
                function () {
                    if (drawState.end && drawState.begin) {
                        drawState.end()
                        drawState.begin()
                    }
                }
            )
        },
        stopclick: false,
        shiftDisabled: false,
        intent: null,
        style: {},
        drawing: {},
        shape: {},
    },
    line: {
        begin: function (intent, overrideStyle, overrideFinishCallback) {
            var drawState = drawing.line

            //Overwrite Leaflet.Draw esc key to restart drawing
            L.Draw.Feature.prototype._cancelDrawing = function (e) {
                if (e.keyCode === 27) {
                    drawState.end()
                    drawState.begin()
                }
            }

            //Clear any other drawing events
            drawing.polygon.end()
            drawing.circle.end()
            drawing.rectangle.end()
            drawing.point.end()
            drawing.annotation.end()
            drawing.arrow.end()

            drawState.end()

            drawState.movemode = false
            drawState.shiftDisabled = false
            drawState.lastVertex = null

            if (intent != undefined) {
                drawState.intent = intent
                drawState.style = DrawTool.categoryStyles[intent]
            }
            if (overrideStyle) {
                drawState.style = overrideStyle
            }

            drawState.drawing = new L.Draw.Polyline(Map_.map, {
                icon: new L.DivIcon({
                    iconSize: new L.Point(10, 10),
                    className: 'leaflet-div-icon leaflet-editing-icon',
                }),
                shapeOptions: drawState.style,
            })
            drawState.drawing.enable()

            drawState.shape = drawState.drawing

            Map_.map.on('click', drawState.start)
            if (typeof overrideFinishCallback === 'function') {
                drawState.overstop = function () {
                    if (typeof drawState.shape.toGeoJSON === 'function') {
                        let s = drawState.shape.toGeoJSON(L_.GEOJSON_PRECISION)
                        s.geometry.type = 'LineString'
                        s.properties.style = drawState.style
                        overrideFinishCallback(s)
                    }
                }
                Map_.map.on('draw:drawstop', drawState.overstop)
            } else {
                drawState.overstop = null
                Map_.map.on('draw:drawstop', drawState.stop)
            }
            $('body').on('keydown', drawState.keydown)
            $('body').on('keyup', drawState.keyup)
        },
        end: function () {
            var drawState = drawing.line

            drawState.stopclick = false

            Map_.map.off('click', drawState.start)
            Map_.map.off('mousemove', drawState.move)
            Map_.map.off('draw:drawstop', drawState.stop)
            if (drawState.overstop)
                Map_.map.off('draw:drawstop', drawState.overstop)
            $('body').off('keydown', drawState.keydown)
            $('body').off('keyup', drawState.keyup)
            if (typeof drawState.drawing.disable === 'function')
                drawState.drawing.disable()
        },
        start: function (e) {
            var drawState = drawing.line

            if (!drawState.stopclick) {
                drawState.stopclick = true
                Map_.map.on('mousemove', drawState.move)
            }

            //Store this at start to avoid mixed modes
            if (
                $('#drawToolDrawSettingsMode > div.active').attr('value') ==
                'on'
            ) {
                drawState.movemode = true
                //Map_.map.on('click', drawState.complete)
            }

            drawState.lastVertex = e.latlng
            drawState.shape = drawState.drawing._poly
        },
        complete: function () {
            var drawState = drawing.line
            drawState.drawing.completeShape()
            Map_.map.off('click', drawState.complete)
        },
        keydown: function (e) {
            var drawState = drawing.line
            //Ctrl-Z
            if (mmgisglobal.ctrlDown && e.which == '90')
                drawState.drawing.deleteLastVertex()
            //Ctrl and no drawing
            else if (
                mmgisglobal.ctrlDown &&
                (!drawState.drawing._markers ||
                    drawState.drawing._markers.length === 0)
            ) {
                drawState.shiftDisabled = true
                if (typeof drawState.drawing.disable === 'function')
                    drawState.drawing.disable()
            }
        },
        keyup: function (e) {
            var drawState = drawing.line
            if (
                !drawState.drawing._enabled &&
                (e.which == '17' ||
                    e.which == '91' ||
                    e.which == '93' ||
                    e.which == '224')
            ) {
                drawState.shiftDisabled = false
                drawState.drawing.enable()
            }
        },
        move: function (e) {
            var drawState = drawing.line

            if (e && drawState.movemode) {
                let res = parseInt(
                    $('#drawToolDrawSettingsModeVertexRes').val(),
                    drawState.lastVertex
                )
                drawState.currentrate++
                let dist = F_.lngLatDistBetween(
                    drawState.lastVertex.lng,
                    drawState.lastVertex.lat,
                    e.latlng.lng,
                    e.latlng.lat
                )

                if (dist > res) {
                    let pt = F_.getPtSomeDistBetween2OtherPts(
                        drawState.lastVertex.lng,
                        drawState.lastVertex.lat,
                        e.latlng.lng,
                        e.latlng.lat,
                        res / dist
                    )
                    pt = { lng: pt.x, lat: pt.y }
                    try {
                        drawState.drawing.addVertex(pt)
                        drawState.lastVertex = pt
                    } catch (e) {}
                    drawState.currentrate = 0
                }
            }
            drawState.shape = drawState.drawing._poly || drawState.shape
        },
        stop: function () {
            var drawState = drawing.line

            if (drawState.shiftDisabled) return
            drawState.shape = drawState.shape.toGeoJSON(L_.GEOJSON_PRECISION)
            drawState.shape.geometry.type = 'LineString'
            drawState.shape.properties.style = drawState.style
            var newNameInput = $('#drawToolDrawFeaturesNewName')
            drawState.shape.properties.name =
                newNameInput.val() || newNameInput.attr('placeholder') || 'Line'

            DrawTool.addDrawing(
                {
                    file_id: DrawTool.currentFileId,
                    intent: drawState.intent,
                    properties: JSON.stringify(drawState.shape.properties),
                    geometry: JSON.stringify(drawState.shape.geometry),
                },
                (function (shape) {
                    return function (data) {
                        DrawTool.refreshFile(DrawTool.currentFileId, null, true, null, false, function() {
                            drawState.begin()
                        }, null, null, true)
                    }
                })(JSON.parse(JSON.stringify(drawState.shape))),
                function () {
                    if (drawState.end && drawState.begin) {
                        drawState.end()
                        drawState.begin()
                    }
                }
            )
        },
        overstop: null,
        stopclick: false,
        intent: null,
        movemode: false,
        shiftDisabled: false,
        rate: 8,
        currentrate: 0,
        lastVertex: null,
        style: {},
        drawing: {},
        shape: {},
    },
    point: {
        begin: function (intent) {
            var drawState = drawing.point

            //Overwrite Leaflet.Draw esc key to restart drawing
            L.Draw.Feature.prototype._cancelDrawing = function (e) {
                if (e.keyCode === 27) {
                    drawState.end()
                    drawState.begin()
                }
            }

            //Clear any other drawing events
            drawing.polygon.end()
            drawing.circle.end()
            drawing.rectangle.end()
            drawing.line.end()
            drawing.annotation.end()
            drawing.arrow.end()
            drawState.shiftDisabled = false

            drawState.end()

            if (intent != undefined) {
                drawState.intent = intent
                drawState.style = DrawTool.categoryStyles[intent]
            }

            drawState.drawing = new L.Draw.CircleMarker(Map_.map, {
                shapeOptions: drawState.style,
            })
            drawState.drawing.enable()

            drawState.shape = drawState.drawing

            Map_.map.on('mousemove', drawState.move)
            Map_.map.on('draw:drawstop', drawState.stop)
            $('body').on('keydown', drawState.keydown)
            $('body').on('keyup', drawState.keyup)
        },
        end: function () {
            var drawState = drawing.point

            drawState.stopclick = false

            Map_.map.off('mousemove', drawState.move)
            Map_.map.off('draw:drawstop', drawState.stop)
            $('body').off('keydown', drawState.keydown)
            $('body').off('keyup', drawState.keyup)
            if (typeof drawState.drawing.disable === 'function')
                drawState.drawing.disable()
        },
        start: function () {},
        keydown: function (e) {
            var drawState = drawing.point

            if (
                e.which == '17' ||
                e.which == '91' ||
                e.which == '93' ||
                e.which == '224'
            ) {
                drawState.shiftDisabled = true
                if (typeof drawState.drawing.disable === 'function')
                    drawState.drawing.disable()
            }
        },
        keyup: function (e) {
            var drawState = drawing.point

            if (
                e.which == '17' ||
                e.which == '91' ||
                e.which == '93' ||
                e.which == '224'
            ) {
                drawState.shiftDisabled = false
                drawState.drawing.enable()
            }
        },
        move: function (e) {
            var drawState = drawing.point
            drawState.shape = e.latlng
        },
        stop: function () {
            var drawState = drawing.point
            if (drawState.shiftDisabled) return

            var coords = [drawState.shape.lng, drawState.shape.lat]

            drawState.shape = {
                type: 'Feature',
                properties: {},
                geometry: {},
            }
            drawState.shape.geometry.type = 'Point'
            drawState.shape.geometry.coordinates = coords
            drawState.shape.properties.style = drawState.style
            var newNameInput = $('#drawToolDrawFeaturesNewName')
            drawState.shape.properties.name =
                newNameInput.val() ||
                newNameInput.attr('placeholder') ||
                'Point'

            DrawTool.addDrawing(
                {
                    file_id: DrawTool.currentFileId,
                    intent: drawState.intent,
                    properties: JSON.stringify(drawState.shape.properties),
                    geometry: JSON.stringify(drawState.shape.geometry),
                },
                (function (shape) {
                    return function (data) {
                        DrawTool.refreshFile(DrawTool.currentFileId, null, true, null, false, function() {
                            drawState.begin()
                        }, null, null, true)
                    }
                })(JSON.parse(JSON.stringify(drawState.shape))),
                function () {
                    if (drawState.end && drawState.begin) {
                        drawState.end()
                        drawState.begin()
                    }
                }
            )
        },
        stopclick: false,
        shiftDisabled: false,
        intent: null,
        style: {},
        drawing: {},
        shape: {},
    },
    annotation: {
        begin: function (intent) {
            var drawState = drawing.annotation

            //Overwrite Leaflet.Draw esc key to restart drawing
            L.Draw.Feature.prototype._cancelDrawing = function (e) {
                if (e.keyCode === 27) {
                    drawState.end()
                    drawState.begin()
                }
            }

            //Clear any other drawing events
            drawing.polygon.end()
            drawing.circle.end()
            drawing.rectangle.end()
            drawing.line.end()
            drawing.point.end()
            drawing.arrow.end()
            drawState.shiftDisabled = false

            drawState.end()

            if (intent != undefined) {
                drawState.intent = intent
                drawState.style = DrawTool.categoryStyles[intent]
            }

            drawState.drawing = new L.Draw.Marker(Map_.map, {
                icon: DrawTool.noteIcon,
            })

            drawState.drawing.enable()

            drawState.shape = drawState.drawing

            Map_.map.on('mousemove', drawState.move)
            Map_.map.on('draw:drawstop', drawState.stop)
            $('body').on('keydown', drawState.keydown)
            $('body').on('keyup', drawState.keyup)
        },
        end: function () {
            var drawState = drawing.annotation

            drawState.stopclick = false

            Map_.map.off('mousemove', drawState.move)
            Map_.map.off('draw:drawstop', drawState.stop)
            if (typeof drawState.drawing.disable === 'function')
                drawState.drawing.disable()
        },
        start: function () {},
        keydown: function (e) {
            var drawState = drawing.annotation
            if (
                e.which == '17' ||
                e.which == '91' ||
                e.which == '93' ||
                e.which == '224'
            ) {
                drawState.shiftDisabled = true
                if (typeof drawState.drawing.disable === 'function')
                    drawState.drawing.disable()
            } else if (e.which == '27') {
                //ESC
                Map_.rmNotNull(DrawTool.activeAnnotation)
                drawState.begin()
            }
        },
        keyup: function (e) {
            var drawState = drawing.annotation

            if (
                e.which == '17' ||
                e.which == '91' ||
                e.which == '93' ||
                e.which == '224'
            ) {
                drawState.shiftDisabled = false
                drawState.drawing.enable()
            }
        },
        move: function (e) {
            var drawState = drawing.annotation
            drawState.shape = e.latlng
        },
        stop: function () {
            var drawState = drawing.annotation
            if (drawState.shiftDisabled) return

            var coords = [drawState.shape.lat, drawState.shape.lng]

            var inputId = 'DrawTool_ActiveAnnotation'
            Map_.rmNotNull(DrawTool.activeAnnotation)
            DrawTool.activeAnnotation = L.popup({
                className: 'leaflet-popup-annotation',
                closeButton: false,
                autoClose: false,
                closeOnEscapeKey: false,
                closeOnClick: false,
                autoPan: false,
                offset: new L.point(0, 0),
            })
                .setLatLng(coords)
                .setContent(
                    "<div class='drawToolAnnotationWrapper'>" +
                        "<div><i id='" +
                        inputId +
                        "_Close' class='mdi mdi-close mdi-18px'></i></div>" +
                        "<input id='" +
                        inputId +
                        "' class='drawToolPreannotation' placeholder='Leave a note...'></input>" +
                        "<div><i id='" +
                        inputId +
                        "_Save' class='mdi mdi-content-save mdi-18px'></i></div>" +
                        '</div>'
                )
                .addTo(Map_.map)

            setTimeout(function () {
                if (document.getElementById(inputId))
                    document.getElementById(inputId).focus()
            }, 50)

            drawState.end()
            $('#' + inputId + '_Close').on('click', function () {
                Map_.rmNotNull(DrawTool.activeAnnotation)
                drawState.begin()
            })
            $('#' + inputId + '_Save').on('click', drawState.save)

            //Save on enter
            $('#' + inputId).keypress(function (e) {
                if (
                    (e.which && e.which == 13) ||
                    (e.keyCode && e.keyCode == 13)
                ) {
                    //enter
                    $('#' + inputId).blur()
                    $('#' + inputId + '_Save').click()
                    return false
                } else return true
            })
        },
        save: function () {
            var drawState = drawing.annotation
            if (drawState.shiftDisabled) return

            $('body').off('keydown', drawState.keydown)
            $('body').off('keyup', drawState.keyup)

            var coords = [drawState.shape.lng, drawState.shape.lat]
            drawState.shape = {
                type: 'Feature',
                properties: {},
                geometry: {},
            }
            drawState.shape.geometry.type = 'Point'
            drawState.shape.geometry.coordinates = coords
            drawState.shape.properties.style = drawState.style
            drawState.shape.properties.annotation = true
            var n = $('#drawToolDrawFeaturesNewName')
            var inputId = 'DrawTool_ActiveAnnotation'
            drawState.shape.properties.name = $('#' + inputId).val() || ''

            DrawTool.addDrawing(
                {
                    file_id: DrawTool.currentFileId,
                    intent: drawState.intent,
                    properties: JSON.stringify(drawState.shape.properties),
                    geometry: JSON.stringify(drawState.shape.geometry),
                },
                (function (shape) {
                    return function (data) {
                        DrawTool.refreshFile(DrawTool.currentFileId, null, true, null, false, function() {
                            Map_.rmNotNull(DrawTool.activeAnnotation)
                            drawState.begin()
                        }, null, null, true)
                    }
                })(JSON.parse(JSON.stringify(drawState.shape))),
                function () {
                    Map_.rmNotNull(DrawTool.activeAnnotation)
                    if (drawState.begin) {
                        drawState.begin()
                    }
                }
            )
        },
        stopclick: false,
        shiftDisabled: false,
        intent: null,
        style: {},
        drawing: {},
        shape: {},
    },
    arrow: {
        begin: function (intent) {
            var drawState = drawing.arrow

            //Overwrite Leaflet.Draw esc key to restart drawing
            L.Draw.Feature.prototype._cancelDrawing = function (e) {
                if (e.keyCode === 27) {
                    drawState.end()
                    drawState.begin()
                }
            }

            //Clear any other drawing events
            drawing.polygon.end()
            drawing.circle.end()
            drawing.rectangle.end()
            drawing.line.end()
            drawing.point.end()
            drawing.annotation.end()
            drawState.shiftDisabled = false

            drawState.end()

            if (intent != undefined) {
                drawState.intent = intent
                drawState.style = DrawTool.categoryStyles[intent]
            }

            Map_.map.on('click', drawState.start)
            $('body').on('keydown', drawState.keydown)
            $('body').on('keyup', drawState.keyup)
        },
        end: function () {
            var drawState = drawing.arrow

            drawState.stopclick = false

            Map_.map.off('click', drawState.start)
            Map_.map.off('mousemove', drawState.move)
            Map_.map.off('click', drawState.stop)
            $('body').off('keydown', drawState.keydown)
            $('body').off('keyup', drawState.keyup)
        },
        start: function (e) {
            var drawState = drawing.arrow

            drawState.startPt = e.latlng

            for (var i = 0; i < drawState.arrowHeads.length; i++)
                Map_.rmNotNull(drawState.arrowHeads[i])
            drawState.arrowHeads = []

            drawState.drawing = new L.Polyline(
                [drawState.startPt, drawState.startPt],
                {
                    color: 'red',
                }
            )

            drawState.shape = drawState.drawing

            Map_.map.off('click', drawState.start)
            Map_.map.on('mousemove', drawState.move)
            Map_.map.on('click', drawState.stop)
        },
        keydown: function (e) {
            var drawState = drawing.arrow

            if (
                e.which == '17' ||
                e.which == '91' ||
                e.which == '93' ||
                e.which == '224'
            ) {
                drawState.shiftDisabled = true
                if (typeof drawState.drawing.disable === 'function')
                    drawState.drawing.disable()
            }
        },
        keyup: function (e) {
            var drawState = drawing.arrow

            if (
                e.which == '17' ||
                e.which == '91' ||
                e.which == '93' ||
                e.which == '224'
            ) {
                drawState.shiftDisabled = false
                drawState.drawing.enable()
            }
        },
        move: function (e) {
            var drawState = drawing.arrow

            Map_.rmNotNull(drawState.drawing)

            var line = new L.Polyline([drawState.startPt, e.latlng])
            drawState.arrowHeads.push(
                L.polylineDecorator(line, {
                    patterns: [
                        {
                            offset: '100%',
                            repeat: 0,
                            symbol: L.Symbol.arrowHead({
                                pixelSize: drawState.style.radius,
                                polygon: false,
                                pathOptions: { stroke: false },
                            }),
                        },
                    ],
                }).addTo(Map_.map)
            )
            var arrowPts = DrawTool.getInnerLayers(
                drawState.arrowHeads[drawState.arrowHeads.length - 1],
                3
            )
            if (arrowPts) {
                arrowPts = arrowPts._latlngs

                drawState.drawing = new L.Polyline(
                    [
                        drawState.startPt,
                        e.latlng,
                        arrowPts[0],
                        e.latlng,
                        arrowPts[2],
                    ],
                    {
                        color: drawState.style.fillColor,
                        weight: drawState.style.width,
                        className: 'noPointerEventsImportant',
                    }
                ).addTo(Map_.map)
            }
            clearTimeout(drawState.arrowTimeout)
            drawState.arrowTimeout = setTimeout(function () {
                for (var i = 0; i < drawState.arrowHeads.length; i++)
                    Map_.rmNotNull(drawState.arrowHeads[i])
            }, 100)
        },
        stop: function (e) {
            var drawState = drawing.arrow
            if (drawState.shiftDisabled) return

            drawState.shape = new L.Polyline([
                drawState.startPt,
                e.latlng,
            ]).toGeoJSON(L_.GEOJSON_PRECISION)

            drawState.shape.properties.style = drawState.style
            drawState.shape.properties.name = 'Arrow'
            drawState.shape.properties.arrow = true

            Map_.rmNotNull(drawState.drawing)

            DrawTool.addDrawing(
                {
                    file_id: DrawTool.currentFileId,
                    intent: drawState.intent,
                    properties: JSON.stringify(drawState.shape.properties),
                    geometry: JSON.stringify(drawState.shape.geometry),
                },
                (function (shape, start, end) {
                    return function (data) {
                        DrawTool.refreshFile(DrawTool.currentFileId, null, true, null, false, null, null, null, true)

                        drawState.begin()
                    }
                })(
                    JSON.parse(JSON.stringify(drawState.shape)),
                    drawState.startPt,
                    e.latlng
                ),
                function () {
                    if (drawState.end && drawState.begin) {
                        drawState.end()
                        drawState.begin()
                    }
                }
            )

            drawState.end()
        },
        save: function () {
            var drawState = drawing.arrow
            if (drawState.shiftDisabled) return

            var coords = [drawState.shape.lat, drawState.shape.lng]
            drawState.shape = {
                type: 'Feature',
                properties: {},
                geometry: {},
            }
            drawState.shape.geometry.type = 'Point'
            drawState.shape.geometry.coordinates = coords
            drawState.shape.properties.style = drawState.style
            drawState.shape.properties.annotation = true
            var n = $('#drawToolDrawFeaturesNewName')
            var inputId = 'DrawTool_ActiveAnnotation'
            drawState.shape.properties.name = $('#' + inputId).val() || ''

            DrawTool.addDrawing(
                {
                    file_id: DrawTool.currentFileId,
                    intent: drawState.intent,
                    properties: JSON.stringify(drawState.shape.properties),
                    geometry: JSON.stringify(drawState.shape.geometry),
                },
                (function (shape) {
                    return function (data) {
                        Map_.rmNotNull(DrawTool.activeAnnotation)
                        var popup = L.popup({
                            className: 'leaflet-popup-annotation',
                            closeButton: false,
                            autoClose: false,
                            closeOnEscapeKey: false,
                            closeOnClick: false,
                            autoPan: false,
                            offset: new L.point(0, 3),
                        })
                            .setLatLng(coords)
                            .setContent(
                                '<div>' +
                                    "<div id='DrawToolAnnotation_" +
                                    DrawTool.currentFileId +
                                    '_' +
                                    data.id +
                                    "' class='drawToolAnnotation DrawToolAnnotation_" +
                                    DrawTool.currentFileId +
                                    "  blackTextBorder' layer='" +
                                    DrawTool.currentFileId +
                                    "' index='" +
                                    L_.layers.layer[
                                        'DrawTool_' + DrawTool.currentFileId
                                    ].length +
                                    "'></div>" +
                                    '</div>'
                            )
                            .addTo(Map_.map)

                        $(
                            '#DrawToolAnnotation_' +
                                DrawTool.currentFileId +
                                '_' +
                                data.id
                        ).text(shape.properties.name)

                        L_.layers.layer[
                            'DrawTool_' + DrawTool.currentFileId
                        ].push(popup)

                        $('.drawToolAnnotation').off('mouseover')
                        $('.drawToolAnnotation').on('mouseover', function () {
                            var layer = 'DrawTool_' + $(this).attr('layer')
                            var index = $(this).attr('index')
                            $('.drawToolShapeLi').removeClass('hovered')
                            $(
                                '.drawToolShapeLi .drawToolShapeLiItem'
                            ).mouseleave()
                            $(
                                '#drawToolShapeLiItem_' + layer + '_' + index
                            ).addClass('hovered')
                            $(
                                '#drawToolShapeLiItem_' +
                                    layer +
                                    '_' +
                                    index +
                                    ' .drawToolShapeLiItem'
                            ).mouseenter()
                        })
                        $('.drawToolAnnotation').off('mouseout')
                        $('.drawToolAnnotation').on('mouseout', function () {
                            $('.drawToolShapeLi').removeClass('hovered')
                            $(
                                '.drawToolShapeLi .drawToolShapeLiItem'
                            ).mouseleave()
                        })
                        $('.drawToolAnnotation').off('click')
                        $('.drawToolAnnotation').on('click', function () {
                            var layer = 'DrawTool_' + $(this).attr('layer')
                            var index = $(this).attr('index')
                            var shape = L_.layers.layer[layer][index]
                            if (!mmgisglobal.shiftDown) {
                                if (typeof shape.getBounds === 'function')
                                    Map_.map.fitBounds(shape.getBounds())
                                else Map_.map.panTo(shape._latlng)
                            }

                            shape.fireEvent('click')
                        })

                        var l =
                            L_.layers.layer[
                                'DrawTool_' + DrawTool.currentFileId
                            ][
                                L_.layers.layer[
                                    'DrawTool_' + DrawTool.currentFileId
                                ].length - 1
                            ]

                        l.feature = shape
                        l.properties = shape.properties
                        l.properties._ = l.properties._ || {}
                        l.properties._.id = data.id
                        l.properties._.intent = data.intent

                        drawState.begin()

                        DrawTool.populateShapes()
                    }
                })(JSON.parse(JSON.stringify(drawState.shape))),
                function () {
                    Map_.rmNotNull(DrawTool.activeAnnotation)
                    if (drawState.begin) {
                        drawState.begin()
                    }
                }
            )
        },
        startPt: null,
        stopclick: false,
        shiftDisabled: false,
        intent: null,
        style: {},
        drawing: {},
        drawingOld: {},
        shape: {},
        arrowTimeout: null,
        arrowHeads: [],
    },
}

export default Drawing
