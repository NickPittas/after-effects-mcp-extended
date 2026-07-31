#target aftereffects
#targetengine "session"

// mcp-bridge-auto.jsx
// Auto-running MCP Bridge panel for After Effects

// Remove #include directives as we define functions below
/*
#include "createComposition.jsx"
#include "createTextLayer.jsx"
#include "createShapeLayer.jsx"
#include "createSolidLayer.jsx"
#include "setLayerProperties.jsx"
*/

// --- Function Definitions ---

// --- createComposition (from createComposition.jsx) --- 
function createComposition(args) {
    try {
        var name = args.name || "New Composition";
        var width = parseInt(args.width) || 1920;
        var height = parseInt(args.height) || 1080;
        var pixelAspect = parseFloat(args.pixelAspect) || 1.0;
        var duration = parseFloat(args.duration) || 10.0;
        var frameRate = parseFloat(args.frameRate) || 30.0;
        var bgColor = args.backgroundColor ? [args.backgroundColor.r/255, args.backgroundColor.g/255, args.backgroundColor.b/255] : [0, 0, 0];
        var newComp = app.project.items.addComp(name, width, height, pixelAspect, duration, frameRate);
        if (args.backgroundColor) {
            newComp.bgColor = bgColor;
        }
        return JSON.stringify({
            status: "success", message: "Composition created successfully",
            composition: { name: newComp.name, id: newComp.id, width: newComp.width, height: newComp.height, pixelAspect: newComp.pixelAspect, duration: newComp.duration, frameRate: newComp.frameRate, bgColor: newComp.bgColor }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// --- createTextLayer (from createTextLayer.jsx) ---
function createTextLayer(args) {
    try {
        var compName = args.compName || "";
        var text = args.text || "Text Layer";
        var position = args.position || [960, 540]; 
        var fontSize = args.fontSize || 72;
        var color = args.color || [1, 1, 1]; 
        var startTime = args.startTime || 0;
        var duration = args.duration || 5; 
        var fontFamily = args.fontFamily || "Arial";
        var alignment = args.alignment || "center"; 
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; } 
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        var textLayer = comp.layers.addText(text);
        var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
        var textDocument = textProp.value;
        textDocument.fontSize = fontSize;
        textDocument.fillColor = color;
        textDocument.font = fontFamily;
        if (alignment === "left") { textDocument.justification = ParagraphJustification.LEFT_JUSTIFY; } 
        else if (alignment === "center") { textDocument.justification = ParagraphJustification.CENTER_JUSTIFY; } 
        else if (alignment === "right") { textDocument.justification = ParagraphJustification.RIGHT_JUSTIFY; }
        textProp.setValue(textDocument);
        textLayer.property("Position").setValue(position);
        textLayer.startTime = startTime;
        if (duration > 0) { textLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: "Text layer created successfully",
            layer: { name: textLayer.name, index: textLayer.index, type: "text", inPoint: textLayer.inPoint, outPoint: textLayer.outPoint, position: textLayer.property("Position").value }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// --- createShapeLayer (from createShapeLayer.jsx) --- 
function createShapeLayer(args) {
    try {
        var compName = args.compName || "";
        var shapeType = args.shapeType || "rectangle"; 
        var position = args.position || [960, 540]; 
        var size = args.size || [200, 200]; 
        var fillColor = args.fillColor || [1, 0, 0]; 
        var strokeColor = args.strokeColor || [0, 0, 0]; 
        var strokeWidth = args.strokeWidth || 0; 
        var startTime = args.startTime || 0;
        var duration = args.duration || 5; 
        var name = args.name || "Shape Layer";
        var points = args.points || 5; 
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; } 
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        var shapeLayer = comp.layers.addShape();
        shapeLayer.name = name;
        var contents = shapeLayer.property("Contents"); 
        var shapeGroup = contents.addProperty("ADBE Vector Group");
        var groupContents = shapeGroup.property("Contents"); 
        var shapePathProperty;
        if (shapeType === "rectangle") {
            shapePathProperty = groupContents.addProperty("ADBE Vector Shape - Rect");
            shapePathProperty.property("Size").setValue(size);
        } else if (shapeType === "ellipse") {
            shapePathProperty = groupContents.addProperty("ADBE Vector Shape - Ellipse");
            shapePathProperty.property("Size").setValue(size);
        } else if (shapeType === "polygon" || shapeType === "star") { 
            shapePathProperty = groupContents.addProperty("ADBE Vector Shape - Star");
            shapePathProperty.property("Type").setValue(shapeType === "polygon" ? 1 : 2); 
            shapePathProperty.property("Points").setValue(points);
            shapePathProperty.property("Outer Radius").setValue(size[0] / 2);
            if (shapeType === "star") { shapePathProperty.property("Inner Radius").setValue(size[0] / 3); }
        }
        var fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
        fill.property("Color").setValue(fillColor);
        fill.property("Opacity").setValue(100);
        if (strokeWidth > 0) {
            var stroke = groupContents.addProperty("ADBE Vector Graphic - Stroke");
            stroke.property("Color").setValue(strokeColor);
            stroke.property("Stroke Width").setValue(strokeWidth);
            stroke.property("Opacity").setValue(100);
        }
        shapeLayer.property("Position").setValue(position);
        shapeLayer.startTime = startTime;
        if (duration > 0) { shapeLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: "Shape layer created successfully",
            layer: { name: shapeLayer.name, index: shapeLayer.index, type: "shape", shapeType: shapeType, inPoint: shapeLayer.inPoint, outPoint: shapeLayer.outPoint, position: shapeLayer.property("Position").value }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// --- createCamera ---
function createCamera(args) {
    try {
        var compName = args.compName || "";
        var name = args.name || "Camera";
        var zoom = args.zoom || 1777.78; // Default ~50mm equivalent
        var position = args.position; // Optional [x, y, z]
        var pointOfInterest = args.pointOfInterest; // Optional [x, y, z]
        var oneNode = args.oneNode || false; // If true, create a one-node camera (no point of interest)

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var centerPoint = [comp.width / 2, comp.height / 2];
        var cameraLayer = comp.layers.addCamera(name, centerPoint);
        cameraLayer.property("Camera Options").property("Zoom").setValue(zoom);

        if (oneNode) {
            cameraLayer.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
        }

        if (position !== undefined && position !== null) {
            cameraLayer.property("Position").setValue(position);
        }

        if (pointOfInterest !== undefined && pointOfInterest !== null && !oneNode) {
            cameraLayer.property("Point of Interest").setValue(pointOfInterest);
        }

        var result = {
            name: cameraLayer.name,
            index: cameraLayer.index,
            zoom: cameraLayer.property("Camera Options").property("Zoom").value,
            position: cameraLayer.property("Position").value,
            oneNode: oneNode
        };
        if (!oneNode) {
            result.pointOfInterest = cameraLayer.property("Point of Interest").value;
        }

        return JSON.stringify({
            status: "success",
            message: "Camera created successfully",
            layer: result
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// --- duplicateLayer ---
function duplicateLayer(args) {
    try {
        var compName = args.compName || "";
        var layerIndex = args.layerIndex;
        var layerName = args.layerName || "";
        var newName = args.newName; // optional rename

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }

        var newLayer = layer.duplicate();
        if (newName) { newLayer.name = newName; }

        return JSON.stringify({
            status: "success",
            message: "Layer duplicated successfully",
            original: { name: layer.name, index: layer.index },
            duplicate: { name: newLayer.name, index: newLayer.index }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// --- deleteLayer ---
function deleteLayer(args) {
    try {
        var compName = args.compName || "";
        var layerIndex = args.layerIndex;
        var layerName = args.layerName || "";

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }

        var deletedName = layer.name;
        var deletedIndex = layer.index;
        layer.remove();

        return JSON.stringify({
            status: "success",
            message: "Layer deleted successfully",
            deleted: { name: deletedName, index: deletedIndex }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// --- setLayerMask: create or modify a mask on a layer ---
function setLayerMask(args) {
    try {
        var compName = args.compName || "";
        var layerIndex = args.layerIndex;
        var layerName = args.layerName || "";
        var maskIndex = args.maskIndex; // optional — if provided, modify existing mask
        var maskPath = args.maskPath; // array of [x, y] points defining the mask shape
        var maskRect = args.maskRect; // shorthand: {top, left, width, height} for rectangular masks
        var maskMode = args.maskMode || "add"; // "add", "subtract", "intersect", "none"
        var maskFeather = args.maskFeather; // optional [x, y] feather
        var maskOpacity = args.maskOpacity; // optional 0-100
        var maskExpansion = args.maskExpansion; // optional pixels
        var maskName = args.maskName; // optional rename

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); }
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }

        // Build the mask shape
        var shapePoints = [];
        if (maskRect) {
            // Rectangle shorthand
            var t = maskRect.top || 0;
            var l = maskRect.left || 0;
            var w = maskRect.width || comp.width;
            var h = maskRect.height || comp.height;
            shapePoints = [[l, t], [l + w, t], [l + w, t + h], [l, t + h]];
        } else if (maskPath && maskPath.length >= 3) {
            shapePoints = maskPath;
        } else {
            throw new Error("Must provide either maskRect or maskPath with at least 3 points");
        }

        // Create the shape object
        var myShape = new Shape();
        var vertices = [];
        for (var p = 0; p < shapePoints.length; p++) {
            vertices.push(shapePoints[p]);
        }
        myShape.vertices = vertices;
        myShape.closed = true;

        var changed = [];
        var mask;

        if (maskIndex !== undefined && maskIndex !== null) {
            // Modify existing mask
            if (maskIndex > 0 && maskIndex <= layer.property("Masks").numProperties) {
                mask = layer.property("Masks").property(maskIndex);
            } else {
                throw new Error("Mask index out of bounds: " + maskIndex);
            }
            mask.property("Mask Path").setValue(myShape);
            changed.push("maskPath");
        } else {
            // Create new mask
            mask = layer.property("Masks").addProperty("Mask");
            mask.property("Mask Path").setValue(myShape);
            changed.push("newMask");
        }

        // Set mask mode
        var modes = {
            "none": MaskMode.NONE,
            "add": MaskMode.ADD,
            "subtract": MaskMode.SUBTRACT,
            "intersect": MaskMode.INTERSECT,
            "lighten": MaskMode.LIGHTEN,
            "darken": MaskMode.DARKEN,
            "difference": MaskMode.DIFFERENCE
        };
        if (modes[maskMode] !== undefined) {
            mask.maskMode = modes[maskMode];
            changed.push("maskMode");
        }

        if (maskFeather !== undefined && maskFeather !== null) {
            mask.property("Mask Feather").setValue(maskFeather);
            changed.push("maskFeather");
        }
        if (maskOpacity !== undefined && maskOpacity !== null) {
            mask.property("Mask Opacity").setValue(maskOpacity);
            changed.push("maskOpacity");
        }
        if (maskExpansion !== undefined && maskExpansion !== null) {
            mask.property("Mask Expansion").setValue(maskExpansion);
            changed.push("maskExpansion");
        }
        if (maskName) {
            mask.name = maskName;
            changed.push("maskName");
        }

        return JSON.stringify({
            status: "success",
            message: "Mask set successfully",
            layer: { name: layer.name, index: layer.index },
            mask: {
                name: mask.name,
                index: mask.propertyIndex,
                mode: maskMode,
                changedProperties: changed
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// --- createSolidLayer (from createSolidLayer.jsx) ---
function createSolidLayer(args) {
    try {
        var compName = args.compName || "";
        var color = args.color || [1, 1, 1]; 
        var name = args.name || "Solid Layer";
        var position = args.position || [960, 540]; 
        var size = args.size; 
        var startTime = args.startTime || 0;
        var duration = args.duration || 5; 
        var isAdjustment = args.isAdjustment || false; 
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; } 
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        if (!size) { size = [comp.width, comp.height]; }
        var solidLayer;
        if (isAdjustment) {
            solidLayer = comp.layers.addSolid([0, 0, 0], name, size[0], size[1], 1);
            solidLayer.adjustmentLayer = true;
        } else {
            solidLayer = comp.layers.addSolid(color, name, size[0], size[1], 1);
        }
        solidLayer.property("Position").setValue(position);
        solidLayer.startTime = startTime;
        if (duration > 0) { solidLayer.outPoint = startTime + duration; }
        return JSON.stringify({
            status: "success", message: isAdjustment ? "Adjustment layer created successfully" : "Solid layer created successfully",
            layer: { name: solidLayer.name, index: solidLayer.index, type: isAdjustment ? "adjustment" : "solid", inPoint: solidLayer.inPoint, outPoint: solidLayer.outPoint, position: solidLayer.property("Position").value, isAdjustment: solidLayer.adjustmentLayer }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// --- setLayerProperties (modified to handle text properties) ---
function setLayerProperties(args) {
    try {
        var compName = args.compName || "";
        var layerName = args.layerName || "";
        var layerIndex = args.layerIndex; 
        
        // General Properties
        var position = args.position; 
        var scale = args.scale; 
        var rotation = args.rotation; 
        var opacity = args.opacity; 
        var startTime = args.startTime; 
        var duration = args.duration; 

        // Text Specific Properties
        var textContent = args.text; // New: text content
        var fontFamily = args.fontFamily; // New: font family
        var fontSize = args.fontSize; // New: font size
        var fillColor = args.fillColor; // New: font color
        
        // Find the composition (same logic as before)
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; } 
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        
        // Find the layer (same logic as before)
        var layer = null;
        if (layerIndex !== undefined && layerIndex !== null) {
            if (layerIndex > 0 && layerIndex <= comp.numLayers) { layer = comp.layer(layerIndex); } 
            else { throw new Error("Layer index out of bounds: " + layerIndex); }
        } else if (layerName) {
            for (var j = 1; j <= comp.numLayers; j++) {
                if (comp.layer(j).name === layerName) { layer = comp.layer(j); break; }
            }
        }
        if (!layer) { throw new Error("Layer not found: " + (layerName || "index " + layerIndex)); }
        
        var changedProperties = [];
        var textDocumentChanged = false;
        var textProp = null;
        var textDocument = null;

        // --- Text Property Handling ---
        if (layer instanceof TextLayer && (textContent !== undefined || fontFamily !== undefined || fontSize !== undefined || fillColor !== undefined)) {
            var sourceTextProp = layer.property("Source Text");
            if (sourceTextProp && sourceTextProp.value) {
                var currentTextDocument = sourceTextProp.value; // Get the current value
                var updated = false;

                if (textContent !== undefined && textContent !== null && currentTextDocument.text !== textContent) {
                    currentTextDocument.text = textContent;
                    changedProperties.push("text");
                    updated = true;
                }
                if (fontFamily !== undefined && fontFamily !== null && currentTextDocument.font !== fontFamily) {
                    // Add basic validation/logging for font existence if needed
                    // try { app.fonts.findFont(fontFamily); } catch (e) { logToPanel("Warning: Font '"+fontFamily+"' might not be installed."); }
                    currentTextDocument.font = fontFamily;
                    changedProperties.push("fontFamily");
                    updated = true;
                }
                if (fontSize !== undefined && fontSize !== null && currentTextDocument.fontSize !== fontSize) {
                    currentTextDocument.fontSize = fontSize;
                    changedProperties.push("fontSize");
                    updated = true;
                }
                // Comparing colors needs care due to potential floating point inaccuracies if set via UI
                // Simple comparison for now
                if (fillColor !== undefined && fillColor !== null && 
                    (currentTextDocument.fillColor[0] !== fillColor[0] || 
                     currentTextDocument.fillColor[1] !== fillColor[1] || 
                     currentTextDocument.fillColor[2] !== fillColor[2])) {
                    currentTextDocument.fillColor = fillColor;
                    changedProperties.push("fillColor");
                    updated = true;
                }

                // Only set the value if something actually changed
                if (updated) {
                    try {
                        sourceTextProp.setValue(currentTextDocument);
                        logToPanel("Applied changes to Text Document for layer: " + layer.name);
                    } catch (e) {
                        logToPanel("ERROR applying Text Document changes: " + e.toString());
                        // Decide if we should throw or just log the error for text properties
                        // For now, just log, other properties might still succeed
                    }
                }
                 // Store the potentially updated document for the return value
                 textDocument = currentTextDocument; 

            } else {
                logToPanel("Warning: Could not access Source Text property for layer: " + layer.name);
            }
        }

        // --- Enabled/Visible ---
        var enabled = args.enabled;
        if (enabled !== undefined && enabled !== null) { layer.enabled = !!enabled; changedProperties.push("enabled"); }

        // --- Blend Mode ---
        var blendMode = args.blendMode;
        if (blendMode !== undefined && blendMode !== null) {
            var modes = {
                "normal": BlendingMode.NORMAL,
                "add": BlendingMode.ADD,
                "multiply": BlendingMode.MULTIPLY,
                "screen": BlendingMode.SCREEN,
                "overlay": BlendingMode.OVERLAY,
                "softLight": BlendingMode.SOFT_LIGHT,
                "hardLight": BlendingMode.HARD_LIGHT,
                "colorDodge": BlendingMode.COLOR_DODGE,
                "colorBurn": BlendingMode.COLOR_BURN,
                "darken": BlendingMode.DARKEN,
                "lighten": BlendingMode.LIGHTEN,
                "difference": BlendingMode.DIFFERENCE,
                "exclusion": BlendingMode.EXCLUSION,
                "hue": BlendingMode.HUE,
                "saturation": BlendingMode.SATURATION,
                "color": BlendingMode.COLOR,
                "luminosity": BlendingMode.LUMINOSITY
            };
            if (modes[blendMode] !== undefined) {
                layer.blendingMode = modes[blendMode];
                changedProperties.push("blendMode");
            }
        }

        // --- Track Matte ---
        var trackMatteType = args.trackMatteType;
        if (trackMatteType !== undefined && trackMatteType !== null) {
            // Values: "none", "alpha", "alphaInverted", "luma", "lumaInverted"
            var matteTypes = {
                "none": TrackMatteType.NO_TRACK_MATTE,
                "alpha": TrackMatteType.ALPHA,
                "alphaInverted": TrackMatteType.ALPHA_INVERTED,
                "luma": TrackMatteType.LUMA,
                "lumaInverted": TrackMatteType.LUMA_INVERTED
            };
            if (matteTypes[trackMatteType] !== undefined) {
                layer.trackMatteType = matteTypes[trackMatteType];
                changedProperties.push("trackMatteType");
            }
        }

        // --- General Property Handling ---
        var threeDLayer = args.threeDLayer;
        if (threeDLayer !== undefined && threeDLayer !== null) { layer.threeDLayer = !!threeDLayer; changedProperties.push("threeDLayer"); }
        if (position !== undefined && position !== null) {
            var posProp = layer.property("Position");
            if (posProp.numKeys > 0) { while (posProp.numKeys > 0) { posProp.removeKey(1); } }
            posProp.setValue(position);
            changedProperties.push("position");
        }
        if (scale !== undefined && scale !== null) { layer.property("Scale").setValue(scale); changedProperties.push("scale"); }
        if (rotation !== undefined && rotation !== null) {
            if (layer.threeDLayer) { 
                // For 3D layers, Z rotation is often what's intended by a single value
                layer.property("Z Rotation").setValue(rotation);
            } else { 
                layer.property("Rotation").setValue(rotation); 
            }
            changedProperties.push("rotation");
        }
        if (opacity !== undefined && opacity !== null) { layer.property("Opacity").setValue(opacity); changedProperties.push("opacity"); }
        if (startTime !== undefined && startTime !== null) { layer.startTime = startTime; changedProperties.push("startTime"); }
        if (duration !== undefined && duration !== null && duration > 0) {
            var actualStartTime = (startTime !== undefined && startTime !== null) ? startTime : layer.startTime;
            layer.outPoint = actualStartTime + duration;
            changedProperties.push("duration");
        }

        // Return success with updated layer details (including text if changed)
        var returnLayerInfo = {
            name: layer.name,
            index: layer.index,
            threeDLayer: layer.threeDLayer,
            position: layer.property("Position").value,
            scale: layer.property("Scale").value,
            rotation: layer.threeDLayer ? layer.property("Z Rotation").value : layer.property("Rotation").value, // Return appropriate rotation
            opacity: layer.property("Opacity").value,
            inPoint: layer.inPoint,
            outPoint: layer.outPoint,
            changedProperties: changedProperties
        };
        // Add text properties to the return object if it was a text layer
        if (layer instanceof TextLayer && textDocument) {
            returnLayerInfo.text = textDocument.text;
            returnLayerInfo.fontFamily = textDocument.font;
            returnLayerInfo.fontSize = textDocument.fontSize;
            returnLayerInfo.fillColor = textDocument.fillColor;
        }

        // *** ADDED LOGGING HERE ***
        logToPanel("Final check before return:");
        logToPanel("  Changed Properties: " + changedProperties.join(", "));
        logToPanel("  Return Layer Info Font: " + (returnLayerInfo.fontFamily || "N/A")); 
        logToPanel("  TextDocument Font: " + (textDocument ? textDocument.font : "N/A"));

        return JSON.stringify({
            status: "success", message: "Layer properties updated successfully",
            layer: returnLayerInfo
        }, null, 2);
    } catch (error) {
        // Error handling remains similar, but add more specific checks if needed
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// --- batchSetLayerProperties: apply properties to multiple layers in one call ---
function batchSetLayerProperties(args) {
    try {
        var compName = args.compName || "";
        var operations = args.operations; // Array of {layerIndex, threeDLayer, position, scale, rotation, opacity, ...}

        if (!operations || !operations.length) {
            throw new Error("No operations provided. Pass an array of {layerIndex, ...properties}");
        }

        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }

        var results = [];
        for (var o = 0; o < operations.length; o++) {
            var op = operations[o];
            var layer = null;
            if (op.layerIndex !== undefined && op.layerIndex !== null) {
                if (op.layerIndex > 0 && op.layerIndex <= comp.numLayers) { layer = comp.layer(op.layerIndex); }
                else { results.push({ layerIndex: op.layerIndex, status: "error", message: "Layer index out of bounds" }); continue; }
            } else if (op.layerName) {
                for (var j = 1; j <= comp.numLayers; j++) {
                    if (comp.layer(j).name === op.layerName) { layer = comp.layer(j); break; }
                }
            }
            if (!layer) { results.push({ layerIndex: op.layerIndex, layerName: op.layerName, status: "error", message: "Layer not found" }); continue; }

            var changed = [];
            if (op.threeDLayer !== undefined && op.threeDLayer !== null) { layer.threeDLayer = !!op.threeDLayer; changed.push("threeDLayer"); }
            if (op.position !== undefined && op.position !== null) {
                var posProp = layer.property("Position");
                if (posProp.numKeys > 0) {
                    while (posProp.numKeys > 0) { posProp.removeKey(1); }
                }
                posProp.setValue(op.position);
                changed.push("position");
            }
            if (op.scale !== undefined && op.scale !== null) { layer.property("Scale").setValue(op.scale); changed.push("scale"); }
            if (op.rotation !== undefined && op.rotation !== null) {
                if (layer.threeDLayer) { layer.property("Z Rotation").setValue(op.rotation); }
                else { layer.property("Rotation").setValue(op.rotation); }
                changed.push("rotation");
            }
            if (op.opacity !== undefined && op.opacity !== null) { layer.property("Opacity").setValue(op.opacity); changed.push("opacity"); }
            if (op.blendMode !== undefined && op.blendMode !== null) {
                var bModes = {"normal":BlendingMode.NORMAL,"add":BlendingMode.ADD,"multiply":BlendingMode.MULTIPLY,"screen":BlendingMode.SCREEN,"overlay":BlendingMode.OVERLAY,"softLight":BlendingMode.SOFT_LIGHT,"hardLight":BlendingMode.HARD_LIGHT,"darken":BlendingMode.DARKEN,"lighten":BlendingMode.LIGHTEN,"difference":BlendingMode.DIFFERENCE};
                if (bModes[op.blendMode] !== undefined) { layer.blendingMode = bModes[op.blendMode]; changed.push("blendMode"); }
            }
            if (op.startTime !== undefined && op.startTime !== null) { layer.startTime = op.startTime; changed.push("startTime"); }
            if (op.outPoint !== undefined && op.outPoint !== null) { layer.outPoint = op.outPoint; changed.push("outPoint"); }

            results.push({
                layerIndex: layer.index,
                name: layer.name,
                status: "success",
                threeDLayer: layer.threeDLayer,
                position: layer.property("Position").value,
                changedProperties: changed
            });
        }

        return JSON.stringify({ status: "success", results: results }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

/**
 * Sets a keyframe for a specific property on a layer.
 * Indices are 1-based for After Effects collections.
 * @param {number} compIndex - The index of the composition (1-based).
 * @param {number} layerIndex - The index of the layer within the composition (1-based).
 * @param {string} propertyName - The name of the property (e.g., "Position", "Scale", "Rotation", "Opacity").
 * @param {number} timeInSeconds - The time (in seconds) for the keyframe.
 * @param {any} value - The value for the keyframe (e.g., [x, y] for Position, [w, h] for Scale, angle for Rotation, percentage for Opacity).
 * @returns {string} JSON string indicating success or error.
 */
function setLayerKeyframe(compIndex, layerIndex, propertyName, timeInSeconds, value) {
    try {
        // Use 1-based indices as per After Effects API
        var comp = app.project.items[compIndex];
        if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "Composition not found at index " + compIndex });
        }
        var layer = comp.layers[layerIndex];
        if (!layer) {
            return JSON.stringify({ success: false, message: "Layer not found at index " + layerIndex + " in composition '" + comp.name + "'"});
        }

        var transformGroup = layer.property("Transform");
        if (!transformGroup) {
             return JSON.stringify({ success: false, message: "Transform properties not found for layer '" + layer.name + "' (type: " + layer.matchName + ")." });
        }

        var property = transformGroup.property(propertyName);
        if (!property) {
            // Check other common property groups if not in Transform
             if (layer.property("Effects") && layer.property("Effects").property(propertyName)) {
                 property = layer.property("Effects").property(propertyName);
             } else if (layer.property("Text") && layer.property("Text").property(propertyName)) {
                 property = layer.property("Text").property(propertyName);
            } // Add more groups if needed (e.g., Masks, Shapes)

            if (!property) {
                 return JSON.stringify({ success: false, message: "Property '" + propertyName + "' not found on layer '" + layer.name + "'." });
            }
        }


        // Ensure the property can be keyframed
        if (!property.canVaryOverTime) {
             return JSON.stringify({ success: false, message: "Property '" + propertyName + "' cannot be keyframed." });
        }

        // Make sure the property is enabled for keyframing
        if (property.numKeys === 0 && !property.isTimeVarying) {
             property.setValueAtTime(comp.time, property.value); // Set initial keyframe if none exist
        }


        property.setValueAtTime(timeInSeconds, value);

        return JSON.stringify({ success: true, message: "Keyframe set for '" + propertyName + "' on layer '" + layer.name + "' at " + timeInSeconds + "s." });
    } catch (e) {
        return JSON.stringify({ success: false, message: "Error setting keyframe: " + e.toString() + " (Line: " + e.line + ")" });
    }
}


/**
 * Sets an expression for a specific property on a layer.
 * @param {number} compIndex - The index of the composition (1-based).
 * @param {number} layerIndex - The index of the layer within the composition (1-based).
 * @param {string} propertyName - The name of the property (e.g., "Position", "Scale", "Rotation", "Opacity").
 * @param {string} expressionString - The JavaScript expression string. Use "" to remove expression.
 * @returns {string} JSON string indicating success or error.
 */
function setLayerExpression(compIndex, layerIndex, propertyName, expressionString) {
    try {
         // Adjust indices to be 0-based for ExtendScript arrays
        var comp = app.project.items[compIndex];
         if (!comp || !(comp instanceof CompItem)) {
            return JSON.stringify({ success: false, message: "Composition not found at index " + compIndex });
        }
        var layer = comp.layers[layerIndex];
         if (!layer) {
            return JSON.stringify({ success: false, message: "Layer not found at index " + layerIndex + " in composition '" + comp.name + "'"});
        }

        var transformGroup = layer.property("Transform");
         if (!transformGroup) {
             // Allow expressions on non-transformable layers if property exists elsewhere
             // return JSON.stringify({ success: false, message: "Transform properties not found for layer '" + layer.name + "' (type: " + layer.matchName + ")." });
        }

        var property = transformGroup ? transformGroup.property(propertyName) : null;
         if (!property) {
            // Check other common property groups if not in Transform
             if (layer.property("Effects") && layer.property("Effects").property(propertyName)) {
                 property = layer.property("Effects").property(propertyName);
             } else if (layer.property("Text") && layer.property("Text").property(propertyName)) {
                 property = layer.property("Text").property(propertyName);
             }

            // Search inside individual effects for sub-properties
            if (!property && layer.property("Effects")) {
                var effects = layer.property("Effects");
                for (var ei = 1; ei <= effects.numProperties; ei++) {
                    var eff = effects.property(ei);
                    try {
                        var subProp = eff.property(propertyName);
                        if (subProp) { property = subProp; break; }
                    } catch (e2) {}
                }
            }

            if (!property) {
                 return JSON.stringify({ success: false, message: "Property '" + propertyName + "' not found on layer '" + layer.name + "'." });
            }
        }

        if (!property.canSetExpression) {
            return JSON.stringify({ success: false, message: "Property '" + propertyName + "' does not support expressions." });
        }

        property.expression = expressionString;

        var action = expressionString === "" ? "removed" : "set";
        return JSON.stringify({ success: true, message: "Expression " + action + " for '" + propertyName + "' on layer '" + layer.name + "'." });
    } catch (e) {
        return JSON.stringify({ success: false, message: "Error setting expression: " + e.toString() + " (Line: " + e.line + ")" });
    }
}

// --- applyEffect (from applyEffect.jsx) ---
function applyEffect(args) {
    try {
        // Extract parameters
        var compIndex = args.compIndex || 1; // Default to first comp
        var layerIndex = args.layerIndex || 1; // Default to first layer
        var effectName = args.effectName; // Name of the effect to apply
        var effectMatchName = args.effectMatchName; // After Effects internal name (more reliable)
        var effectCategory = args.effectCategory || ""; // Optional category for filtering
        var presetPath = args.presetPath; // Optional path to an effect preset
        var effectSettings = args.effectSettings || {}; // Optional effect parameters
        
        if (!effectName && !effectMatchName && !presetPath) {
            throw new Error("You must specify either effectName, effectMatchName, or presetPath");
        }
        
        // Find the composition by index
        var comp = app.project.item(compIndex);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + compIndex);
        }
        
        // Find the layer by index
        var layer = comp.layer(layerIndex);
        if (!layer) {
            throw new Error("Layer not found at index " + layerIndex + " in composition '" + comp.name + "'");
        }
        
        var effectResult;
        
        // Apply preset if a path is provided
        if (presetPath) {
            var presetFile = new File(presetPath);
            if (!presetFile.exists) {
                throw new Error("Effect preset file not found: " + presetPath);
            }
            
            // Apply the preset to the layer
            layer.applyPreset(presetFile);
            effectResult = {
                type: "preset",
                name: presetPath.split('/').pop().split('\\').pop(),
                applied: true
            };
        }
        // Apply effect by match name (more reliable method)
        else if (effectMatchName) {
            var effect = layer.Effects.addProperty(effectMatchName);
            effectResult = {
                type: "effect",
                name: effect.name,
                matchName: effect.matchName,
                index: effect.propertyIndex
            };
            
            // Apply settings if provided
            applyEffectSettings(effect, effectSettings);
        }
        // Apply effect by display name
        else {
            // Get the effect from the Effect menu
            var effect = layer.Effects.addProperty(effectName);
            effectResult = {
                type: "effect",
                name: effect.name,
                matchName: effect.matchName,
                index: effect.propertyIndex
            };
            
            // Apply settings if provided
            applyEffectSettings(effect, effectSettings);
        }
        
        return JSON.stringify({
            status: "success",
            message: "Effect applied successfully",
            effect: effectResult,
            layer: {
                name: layer.name,
                index: layerIndex
            },
            composition: {
                name: comp.name,
                index: compIndex
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

// Helper function to apply effect settings
function applyEffectSettings(effect, settings) {
    // Skip if no settings are provided
    if (!settings) return;
    var hasKeys = false;
    for (var k in settings) { if (settings.hasOwnProperty(k)) { hasKeys = true; break; } }
    if (!hasKeys) return;
    
    // Iterate through all provided settings
    for (var propName in settings) {
        if (settings.hasOwnProperty(propName)) {
            try {
                // Find the property in the effect
                var property = null;
                
                // Try direct property access first
                try {
                    property = effect.property(propName);
                } catch (e) {
                    // If direct access fails, search through all properties
                    for (var i = 1; i <= effect.numProperties; i++) {
                        var prop = effect.property(i);
                        if (prop.name === propName) {
                            property = prop;
                            break;
                        }
                    }
                }
                
                // Set the property value if found
                if (property && property.setValue) {
                    property.setValue(settings[propName]);
                }
            } catch (e) {
                // Log error but continue with other properties
                $.writeln("Error setting effect property '" + propName + "': " + e.toString());
            }
        }
    }
}

// --- applyEffectTemplate (from applyEffectTemplate.jsx) ---
function applyEffectTemplate(args) {
    try {
        // Extract parameters
        var compIndex = args.compIndex || 1; // Default to first comp
        var layerIndex = args.layerIndex || 1; // Default to first layer
        var templateName = args.templateName; // Name of the template to apply
        var customSettings = args.customSettings || {}; // Optional customizations
        
        if (!templateName) {
            throw new Error("You must specify a templateName");
        }
        
        // Find the composition by index
        var comp = app.project.item(compIndex);
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + compIndex);
        }
        
        // Find the layer by index
        var layer = comp.layer(layerIndex);
        if (!layer) {
            throw new Error("Layer not found at index " + layerIndex + " in composition '" + comp.name + "'");
        }
        
        // Template definitions
        var templates = {
            // Blur effects
            "gaussian-blur": {
                effectMatchName: "ADBE Gaussian Blur 2",
                settings: {
                    "Blurriness": customSettings.blurriness || 20
                }
            },
            "directional-blur": {
                effectMatchName: "ADBE Directional Blur",
                settings: {
                    "Direction": customSettings.direction || 0,
                    "Blur Length": customSettings.length || 10
                }
            },
            
            // Color correction effects
            "color-balance": {
                effectMatchName: "ADBE Color Balance (HLS)",
                settings: {
                    "Hue": customSettings.hue || 0,
                    "Lightness": customSettings.lightness || 0,
                    "Saturation": customSettings.saturation || 0
                }
            },
            "brightness-contrast": {
                effectMatchName: "ADBE Brightness & Contrast 2",
                settings: {
                    "Brightness": customSettings.brightness || 0,
                    "Contrast": customSettings.contrast || 0,
                    "Use Legacy": false
                }
            },
            "curves": {
                effectMatchName: "ADBE CurvesCustom",
                // Curves are complex and would need special handling
            },
            
            // Stylistic effects
            "glow": {
                effectMatchName: "ADBE Glow",
                settings: {
                    "Glow Threshold": customSettings.threshold || 50,
                    "Glow Radius": customSettings.radius || 15,
                    "Glow Intensity": customSettings.intensity || 1
                }
            },
            "drop-shadow": {
                effectMatchName: "ADBE Drop Shadow",
                settings: {
                    "Shadow Color": customSettings.color || [0, 0, 0, 1],
                    "Opacity": customSettings.opacity || 50,
                    "Direction": customSettings.direction || 135,
                    "Distance": customSettings.distance || 10,
                    "Softness": customSettings.softness || 10
                }
            },
            
            // Common effect chains
            "cinematic-look": {
                effects: [
                    {
                        effectMatchName: "ADBE CurvesCustom",
                        settings: {}
                    },
                    {
                        effectMatchName: "ADBE Vibrance",
                        settings: {
                            "Vibrance": 15,
                            "Saturation": -5
                        }
                    }
                ]
            },
            "text-pop": {
                effects: [
                    {
                        effectMatchName: "ADBE Drop Shadow",
                        settings: {
                            "Shadow Color": [0, 0, 0, 1],
                            "Opacity": 75,
                            "Distance": 5,
                            "Softness": 10
                        }
                    },
                    {
                        effectMatchName: "ADBE Glow",
                        settings: {
                            "Glow Threshold": 50,
                            "Glow Radius": 10,
                            "Glow Intensity": 1.5
                        }
                    }
                ]
            }
        };
        
        // Check if the requested template exists
        var template = templates[templateName];
        if (!template) {
            var availableTemplates = Object.keys(templates).join(", ");
            throw new Error("Template '" + templateName + "' not found. Available templates: " + availableTemplates);
        }
        
        var appliedEffects = [];
        
        // Apply single effect or multiple effects based on template structure
        if (template.effectMatchName) {
            // Single effect template
            var effect = layer.Effects.addProperty(template.effectMatchName);
            
            // Apply settings
            for (var propName in template.settings) {
                try {
                    var property = effect.property(propName);
                    if (property) {
                        property.setValue(template.settings[propName]);
                    }
                } catch (e) {
                    $.writeln("Warning: Could not set " + propName + " on effect " + effect.name + ": " + e);
                }
            }
            
            appliedEffects.push({
                name: effect.name,
                matchName: effect.matchName
            });
        } else if (template.effects) {
            // Multiple effects template
            for (var i = 0; i < template.effects.length; i++) {
                var effectData = template.effects[i];
                var effect = layer.Effects.addProperty(effectData.effectMatchName);
                
                // Apply settings
                for (var propName in effectData.settings) {
                    try {
                        var property = effect.property(propName);
                        if (property) {
                            property.setValue(effectData.settings[propName]);
                        }
                    } catch (e) {
                        $.writeln("Warning: Could not set " + propName + " on effect " + effect.name + ": " + e);
                    }
                }
                
                appliedEffects.push({
                    name: effect.name,
                    matchName: effect.matchName
                });
            }
        }
        
        return JSON.stringify({
            status: "success",
            message: "Effect template '" + templateName + "' applied successfully",
            appliedEffects: appliedEffects,
            layer: {
                name: layer.name,
                index: layerIndex
            },
            composition: {
                name: comp.name,
                index: compIndex
            }
        }, null, 2);
    } catch (error) {
        return JSON.stringify({
            status: "error",
            message: error.toString()
        }, null, 2);
    }
}

// --- End of Function Definitions ---

// --- Bridge test function to verify communication and effects application ---
function bridgeTestEffects(args) {
    try {
        var compIndex = (args && args.compIndex) ? args.compIndex : 1;
        var layerIndex = (args && args.layerIndex) ? args.layerIndex : 1;

        // Apply a light Gaussian Blur
        var blurRes = JSON.parse(applyEffect({
            compIndex: compIndex,
            layerIndex: layerIndex,
            effectMatchName: "ADBE Gaussian Blur 2",
            effectSettings: { "Blurriness": 5 }
        }));

        // Apply a simple drop shadow via template
        var shadowRes = JSON.parse(applyEffectTemplate({
            compIndex: compIndex,
            layerIndex: layerIndex,
            templateName: "drop-shadow"
        }));

        return JSON.stringify({
            status: "success",
            message: "Bridge test effects applied.",
            results: [blurRes, shadowRes]
        }, null, 2);
    } catch (e) {
        return JSON.stringify({ status: "error", message: e.toString() }, null, 2);
    }
}

// JSON polyfill for ExtendScript (when JSON is undefined)
if (typeof JSON === "undefined") {
    JSON = {};
}
if (typeof JSON.parse !== "function") {
    JSON.parse = function (text) {
        // Safe-ish fallback for trusted input (our own command file)
        return eval("(" + text + ")");
    };
}
if (typeof JSON.stringify !== "function") {
    (function () {
        function esc(str) {
            return (str + "")
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"')
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")
                .replace(/\t/g, "\\t");
        }
        function toJSON(val) {
            if (val === null) return "null";
            var t = typeof val;
            if (t === "number" || t === "boolean") return String(val);
            if (t === "string") return '"' + esc(val) + '"';
            if (val instanceof Array) {
                var a = [];
                for (var i = 0; i < val.length; i++) a.push(toJSON(val[i]));
                return "[" + a.join(",") + "]";
            }
            if (t === "object") {
                var props = [];
                for (var k in val) {
                    if (val.hasOwnProperty(k) && typeof val[k] !== "function" && typeof val[k] !== "undefined") {
                        props.push('"' + esc(k) + '":' + toJSON(val[k]));
                    }
                }
                return "{" + props.join(",") + "}";
            }
            return "null";
        }
        JSON.stringify = function (value, _replacer, _space) {
            return toJSON(value);
        };
    })();
}

// Use the host-provided Panel when loaded from Scripts/ScriptUI Panels.
// Fall back to a floating palette only when the script is run directly.
var panel = (this instanceof Panel)
    ? this
    : new Window("palette", "After Effects MCP", undefined, { resizeable: true });
panel.orientation = "column";
panel.alignChildren = ["fill", "fill"];
panel.spacing = 6;
panel.margins = 8;

// The bridge is deliberately a single-purpose panel. Chat lives only in the
// separate CEP extension and no longer appears as a ScriptUI tab.
var mainTabs = panel.add("group");
mainTabs.orientation = "column";
mainTabs.alignment = ["fill", "fill"];
mainTabs.alignChildren = ["fill", "fill"];

var bridgeTab = mainTabs.add("group");
bridgeTab.orientation = "column";
bridgeTab.alignChildren = ["fill", "top"];
bridgeTab.spacing = 10;
bridgeTab.margins = 12;

// Keep the legacy controls detached and hidden only so old helper functions
// remain harmless while this release migrates entirely to CEP.
var chatTab = panel.add("group");
chatTab.orientation = "column";
chatTab.alignChildren = ["fill", "top"];
chatTab.spacing = 6;
chatTab.margins = 0;
chatTab.visible = false;
chatTab.maximumSize = [0, 0];

// Status display
var statusText = bridgeTab.add("statictext", undefined, "Waiting for commands...");
statusText.alignment = ["fill", "top"];

// Add log area
var logPanel = bridgeTab.add("panel", undefined, "Command Log");
logPanel.orientation = "column";
logPanel.alignChildren = ["fill", "fill"];
var logText = logPanel.add("edittext", undefined, "", {multiline: true, readonly: true});
logText.preferredSize.height = 200;
logText.alignment = ["fill", "fill"];

// Auto-run checkbox
var autoRunCheckbox = bridgeTab.add("checkbox", undefined, "Automatically execute MCP commands");
autoRunCheckbox.value = true;
autoRunCheckbox.helpTip = "Enabled by default. Pending MCP commands are accepted and executed automatically.";

var openCepChatButton = bridgeTab.add("button", undefined, "Open MCP Chat");
openCepChatButton.helpTip = "Open the dockable CEP/HTML chat panel.";
openCepChatButton.onClick = function () {
    var commandId = app.findMenuCommandId("After Effects MCP Chat");
    if (commandId && commandId > 0) app.executeCommand(commandId);
    else alert("Open Window > Extensions > After Effects MCP Chat.");
};

// Codex Chat UI. The panel communicates with the local companion through a
// small file queue so no network server or Node runtime is needed inside AE.
var chatStatusGroup = chatTab.add("group");
chatStatusGroup.orientation = "row";
chatStatusGroup.alignment = ["fill", "top"];
chatStatusGroup.alignChildren = ["left", "center"];
var chatActivityIcon = chatStatusGroup.add("statictext", undefined, "●");
chatActivityIcon.preferredSize.width = 16;
var chatStatusText = chatStatusGroup.add("statictext", undefined, "Starting Codex companion...");
chatStatusText.alignment = ["fill", "center"];

var chatAccountGroup = chatTab.add("group");
chatAccountGroup.orientation = "row";
chatAccountGroup.alignment = ["fill", "top"];
chatAccountGroup.alignChildren = ["left", "center"];
var chatAccountText = chatAccountGroup.add("statictext", undefined, "Account: checking...");
chatAccountText.alignment = ["fill", "center"];
var chatReloginButton = chatAccountGroup.add("button", undefined, "Switch Account");

var chatSetupGroup = chatTab.add("group");
chatSetupGroup.orientation = "row";
chatSetupGroup.alignChildren = ["left", "center"];
var chatLaunchButton = chatSetupGroup.add("button", undefined, "Start Companion");
var chatInstallButton = chatSetupGroup.add("button", undefined, "Install Codex CLI");
var chatLoginButton = chatSetupGroup.add("button", undefined, "Sign In");
var chatRetryButton = chatSetupGroup.add("button", undefined, "Retry");

var chatHelpGroup = chatTab.add("group");
chatHelpGroup.orientation = "row";
var chatCopyInstallButton = chatHelpGroup.add("button", undefined, "Copy Install Command");
var chatInstructionsButton = chatHelpGroup.add("button", undefined, "Official Instructions");

var transcriptPanel = chatTab.add("panel", undefined, "Conversation");
transcriptPanel.orientation = "column";
transcriptPanel.alignChildren = ["fill", "fill"];
transcriptPanel.alignment = ["fill", "fill"];
transcriptPanel.preferredSize.height = 230;
transcriptPanel.minimumSize.height = 70;
var chatRoleLegend = transcriptPanel.add("group");
chatRoleLegend.orientation = "row";
chatRoleLegend.alignment = ["fill", "top"];
var chatYouBadge = chatRoleLegend.add("statictext", undefined, "  YOU  ");
var chatCodexBadge = chatRoleLegend.add("statictext", undefined, "  CODEX  ");
var chatSystemBadge = chatRoleLegend.add("statictext", undefined, "  SYSTEM  ");
setChatControlColors(chatYouBadge, [0.12, 0.17, 0.25, 1], [0.50, 0.72, 1.0, 1]);
setChatControlColors(chatCodexBadge, [0.12, 0.19, 0.16, 1], [0.45, 0.92, 0.68, 1]);
setChatControlColors(chatSystemBadge, [0.23, 0.19, 0.10, 1], [1.0, 0.75, 0.32, 1]);
var chatTranscript = transcriptPanel.add("edittext", undefined, "", { multiline: true, readonly: true, scrolling: true });
chatTranscript.alignment = ["fill", "fill"];
chatTranscript.minimumSize.height = 45;

var chatApprovalPanel = chatTab.add("panel", undefined, "Approval Required");
chatApprovalPanel.orientation = "column";
chatApprovalPanel.alignChildren = ["fill", "top"];
chatApprovalPanel.visible = false;
var chatApprovalText = chatApprovalPanel.add("statictext", undefined, "", { multiline: true });
chatApprovalText.preferredSize.height = 44;
var chatApprovalButtons = chatApprovalPanel.add("group");
var chatApproveButton = chatApprovalButtons.add("button", undefined, "Allow");
var chatApproveSessionButton = chatApprovalButtons.add("button", undefined, "Allow for Session");
var chatDeclineButton = chatApprovalButtons.add("button", undefined, "Decline");

var chatAttachGroup = chatTab.add("group");
chatAttachGroup.orientation = "row";
var chatAttachViewer = chatAttachGroup.add("checkbox", undefined, "Attach Viewer");
chatAttachViewer.value = true;
var chatAttachUi = chatAttachGroup.add("checkbox", undefined, "Attach AE UI");
chatAttachUi.value = false;
var chatTrustAeMcp = chatAttachGroup.add("checkbox", undefined, "No Permission Prompts");
chatTrustAeMcp.value = true;
chatTrustAeMcp.helpTip = "Run the dedicated AE chat in autonomous mode. Codex will not ask for MCP, command, or file approvals; operations blocked by its sandbox will fail instead.";

var chatPrompt = chatTab.add("edittext", undefined, "", { multiline: true, scrolling: true });
chatPrompt.preferredSize.height = 72;
chatPrompt.alignment = ["fill", "top"];

var chatActionGroup = chatTab.add("group");
chatActionGroup.orientation = "row";
chatActionGroup.alignment = ["fill", "top"];
var chatSendButton = chatActionGroup.add("button", undefined, "Send");
var chatStopButton = chatActionGroup.add("button", undefined, "Stop");
var chatLatestButton = chatActionGroup.add("button", undefined, "Latest");
var chatClearButton = chatActionGroup.add("button", undefined, "Clear View");

var chatInstallCommand = "powershell -ExecutionPolicy Bypass -c \"irm https://chatgpt.com/codex/install.ps1 | iex\"";
var lastChatStateTimestamp = "";
var lastChatState = null;
var chatFollowTranscript = true;

function setChatControlColors(control, background, foreground) {
    try {
        if (background) control.graphics.backgroundColor = control.graphics.newBrush(control.graphics.BrushType.SOLID_COLOR, background);
        if (foreground) control.graphics.foregroundColor = control.graphics.newPen(control.graphics.PenType.SOLID_COLOR, foreground, 1);
    } catch (_chatColorError) {}
}

function renderChatTranscript(transcript) {
    transcript = transcript || [];
    var lines = [];
    for (var i = 0; i < transcript.length; i++) {
        var entry = transcript[i];
        var role = entry.role === "assistant" ? "CODEX" : (entry.role === "user" ? "YOU" : "SYSTEM");
        var marker = entry.role === "assistant" ? "[ CODEX ]" : (entry.role === "user" ? "[ YOU ]" : "[ SYSTEM ]");
        lines.push(marker);
        lines.push(entry.text || (entry.role === "assistant" ? "…" : ""));
        lines.push("────────────────────────────────");
        lines.push("");
    }
    if (!lines.length) lines.push("Your conversation will appear here.");
    var newText = lines.join("\n");
    if (chatTranscript.text !== newText) chatTranscript.text = newText;
    if (chatFollowTranscript) {
        try { chatTranscript.selection = [newText.length, newText.length]; } catch (_chatBottomFollowError) {}
    }
}

try {
    chatTranscript.addEventListener("mousewheel", function () { chatFollowTranscript = false; });
    chatTranscript.addEventListener("mousedown", function () { chatFollowTranscript = false; });
} catch (_chatWheelError) {}

function getChatFolder() {
    var folder = new Folder(Folder.myDocuments.fsName + "/ae-mcp-bridge/codex-chat");
    if (!folder.exists) folder.create();
    return folder;
}

function getChatRequestFolder() {
    var folder = new Folder(getChatFolder().fsName + "/requests");
    if (!folder.exists) folder.create();
    return folder;
}

function getChatAttachmentFolder() {
    var folder = new Folder(getChatFolder().fsName + "/attachments");
    if (!folder.exists) folder.create();
    return folder;
}

function queueChatRequest(action, data) {
    data = data || {};
    data.id = String((new Date()).getTime()) + "-" + String(Math.floor(Math.random() * 100000));
    data.action = action;
    var requestFile = new File(getChatRequestFolder().fsName + "/" + data.id + ".json");
    requestFile.encoding = "UTF-8";
    if (!requestFile.open("w")) throw new Error("Unable to write the Codex Chat request.");
    requestFile.write(JSON.stringify(data, null, 2));
    requestFile.close();
}

function chatContextSnapshot() {
    var context = {
        projectFile: app.project && app.project.file ? app.project.file.fsName : null,
        activeItem: null,
        composition: null,
        time: null,
        selectedLayers: []
    };
    var item = app.project ? app.project.activeItem : null;
    if (item) context.activeItem = item.name;
    if (item && item instanceof CompItem) {
        context.composition = {
            name: item.name,
            id: item.id,
            width: item.width,
            height: item.height,
            frameRate: item.frameRate,
            duration: item.duration
        };
        context.time = item.time;
        var selected = item.selectedLayers;
        for (var i = 0; i < selected.length; i++) {
            var layerInfo = { name: selected[i].name, index: selected[i].index, selectedProperties: [] };
            try {
                var properties = selected[i].selectedProperties;
                for (var p = 0; p < properties.length; p++) {
                    layerInfo.selectedProperties.push({ name: properties[p].name, matchName: properties[p].matchName });
                }
            } catch (_propertyError) {}
            context.selectedLayers.push(layerInfo);
        }
    }
    return context;
}

function captureViewerForChat() {
    var comp = app.project ? app.project.activeItem : null;
    if (!(comp && comp instanceof CompItem)) return null;
    var folder = getChatAttachmentFolder();
    var safeName = comp.name.replace(/[\\\/:*?"<>|]/g, "_");
    var output = new File(folder.fsName + "/viewer-" + safeName + "-" + String((new Date()).getTime()) + ".png");
    comp.saveFrameToPng(comp.time, output);
    return output.fsName;
}

function findChatCompanion() {
    var candidates = [];
    try { candidates.push(new File($.fileName).parent.fsName + "/after-effects-codex-chat.exe"); } catch (_scriptPathError) {}
    candidates.push(Folder.userData.fsName + "/AfterEffectsMCP/after-effects-codex-chat.exe");
    candidates.push(Folder.myDocuments.fsName + "/ae-mcp-bridge/bin/after-effects-codex-chat.exe");
    for (var i = 0; i < candidates.length; i++) {
        var file = new File(candidates[i]);
        if (file.exists) return file;
    }
    return null;
}

function startChatCompanion() {
    var companion = findChatCompanion();
    if (companion) {
        var hiddenCompanionPath = companion.fsName.replace(/'/g, "''");
        system.callSystem("powershell.exe -NoProfile -WindowStyle Hidden -Command \"Start-Process -FilePath '" + hiddenCompanionPath + "' -WindowStyle Hidden\"");
        chatStatusText.text = "Starting Codex companion...";
        return true;
    }

    // Developer fallback. Release packages always use the self-contained EXE.
    var developerHost = new File(Folder.myDocuments.fsName + "/ae-mcp-bridge/bin/chat-host.js");
    var developerNode = new File("C:/Program Files/nodejs/node.exe");
    if (developerHost.exists && developerNode.exists) {
        var hiddenNodePath = developerNode.fsName.replace(/'/g, "''");
        var hiddenHostPath = developerHost.fsName.replace(/'/g, "''");
        system.callSystem("powershell.exe -NoProfile -WindowStyle Hidden -Command \"Start-Process -FilePath '" + hiddenNodePath + "' -ArgumentList '" + hiddenHostPath + "' -WindowStyle Hidden\"");
        chatStatusText.text = "Starting development companion...";
        return true;
    }

    chatStatusText.text = "Codex companion is not installed";
    return false;
}

function renderChatState(state) {
    chatLaunchButton.visible = state.hostStatus !== "ready";
    chatInstallButton.visible = state.cliStatus === "missing";
    chatCopyInstallButton.visible = state.cliStatus === "missing";
    chatInstructionsButton.visible = state.cliStatus === "missing";
    chatLoginButton.visible = state.cliStatus === "signedOut";
    chatReloginButton.visible = state.cliStatus === "ready" && state.account !== null && state.account !== undefined;
    chatRetryButton.visible = state.cliStatus === "missing" || state.cliStatus === "signedOut" || state.hostStatus === "error";
    chatSendButton.enabled = state.cliStatus === "ready" && !state.busy;
    chatStopButton.enabled = state.busy === true;
    if (state.noApprovalPrompts !== undefined) chatTrustAeMcp.value = state.noApprovalPrompts === true;

    if (state.account) {
        var planSuffix = state.account.planType ? " · " + state.account.planType : "";
        chatAccountText.text = "Account: " + (state.account.email || state.account.label || state.account.type) + planSuffix;
        chatAccountText.helpTip = "Signed in through Codex CLI";
    } else {
        chatAccountText.text = state.cliStatus === "signedOut" ? "Account: not signed in" : "Account: checking...";
        chatAccountText.helpTip = "";
    }

    chatApprovalPanel.visible = state.approval !== null && state.approval !== undefined;
    if (state.approval) {
        chatApprovalText.text = (state.approval.summary || "Approval required") + "\n" + (state.approval.details || "");
        var labels = state.approval.buttonLabels || {};
        chatApproveButton.text = labels.accept || "Allow";
        chatApproveSessionButton.text = labels.session || "Allow for Session";
        chatApproveSessionButton.visible = state.approval.method !== "item/tool/requestUserInput" || !!labels.session;
        chatDeclineButton.text = labels.decline || "Decline";
    }
    try { chatTab.layout.layout(true); } catch (_chatLayoutError) {}
    renderChatTranscript(state.transcript || []);
    try { chatTab.layout.layout(true); } catch (_chatLayoutAfterTranscriptError) {}
}

function renderChatActivityAnimation(state) {
    if (!state) return;
    var activity = state.activity || {};
    var busy = state.busy === true;
    var frame = Math.floor((new Date()).getTime() / 220) % 4;
    var frames = ["·", "●", "◉", "●"];
    var icon = busy ? frames[frame] : (activity.kind === "error" ? "!" : (state.cliStatus === "signedOut" ? "○" : "●"));
    var color = activity.kind === "error" ? [1.0, 0.35, 0.32, 1] :
        (activity.kind === "afterEffects" ? [0.62, 0.52, 1.0, 1] :
        (activity.kind === "command" || activity.kind === "files" ? [1.0, 0.72, 0.28, 1] :
        (busy ? [0.35, 0.78, 1.0, 1] : [0.35, 0.88, 0.55, 1])));
    chatActivityIcon.text = icon;
    setChatControlColors(chatActivityIcon, null, color);
    var label = activity.label || state.statusText || "Codex Chat";
    if (activity.detail) label += " · " + activity.detail;
    chatStatusText.text = label;
}

function refreshChatState() {
    // The ScriptUI chat was replaced by the CEP panel. Keep this no-op so any
    // timer left by an older loaded panel instance becomes harmless.
    return;
    try {
        var stateFile = new File(getChatFolder().fsName + "/state.json");
        if (!stateFile.exists) return;
        stateFile.encoding = "UTF-8";
        if (!stateFile.open("r")) return;
        var content = stateFile.read();
        stateFile.close();
        var state = JSON.parse(content);
        lastChatState = state;
        if (state.updatedAt !== lastChatStateTimestamp) {
            lastChatStateTimestamp = state.updatedAt;
            renderChatState(state);
        }
        renderChatActivityAnimation(state);
    } catch (_chatStateError) {}
}

chatLaunchButton.onClick = function () { startChatCompanion(); };
chatRetryButton.onClick = function () {
    if (!startChatCompanion()) return;
    queueChatRequest("status", {});
};
chatInstallButton.onClick = function () {
    if (!confirm("Install Codex CLI using the official OpenAI standalone installer?\n\n" + chatInstallCommand + "\n\nThis does not require Node.js or npm.")) return;
    if (!startChatCompanion()) return;
    queueChatRequest("installCodex", {});
};
chatLoginButton.onClick = function () { queueChatRequest("login", {}); };
chatReloginButton.onClick = function () {
    if (!confirm("Sign out of the current Codex account and choose another account?")) return;
    queueChatRequest("relogin", {});
};
chatCopyInstallButton.onClick = function () {
    var escaped = chatInstallCommand.replace(/'/g, "''");
    system.callSystem("powershell -NoProfile -Command \"Set-Clipboard -Value '" + escaped + "'\"");
    chatStatusText.text = "Install command copied";
};
chatInstructionsButton.onClick = function () {
    system.callSystem('cmd /c start "" "https://learn.chatgpt.com/docs/codex/cli"');
};
chatSendButton.onClick = function () {
    var promptText = chatPrompt.text;
    if (!promptText || !promptText.replace(/\s/g, "")) {
        alert("Enter a message first.");
        return;
    }
    var viewerPath = null;
    if (chatAttachViewer.value) {
        try { viewerPath = captureViewerForChat(); }
        catch (captureError) { alert("Viewer capture failed: " + captureError.toString()); return; }
    }
    chatFollowTranscript = true;
    queueChatRequest("send", {
        prompt: promptText,
        context: chatContextSnapshot(),
        viewerPath: viewerPath,
        attachAeUi: chatAttachUi.value,
        trustAfterEffectsMcp: chatTrustAeMcp.value,
        noApprovalPrompts: chatTrustAeMcp.value
    });
    chatPrompt.text = "";
    chatStatusText.text = "Sending to Codex...";
};
chatStopButton.onClick = function () { queueChatRequest("stop", {}); };
chatLatestButton.onClick = function () {
    chatFollowTranscript = true;
    if (lastChatState) renderChatTranscript(lastChatState.transcript || []);
};
chatClearButton.onClick = function () { chatFollowTranscript = true; queueChatRequest("clearTranscript", {}); };
chatApproveButton.onClick = function () { queueChatRequest("approval", { decision: "accept" }); };
chatApproveSessionButton.onClick = function () { queueChatRequest("approval", { decision: "acceptForSession" }); };
chatDeclineButton.onClick = function () { queueChatRequest("approval", { decision: "decline" }); };
chatTrustAeMcp.onClick = function () {
    queueChatRequest("updateSettings", {
        trustAfterEffectsMcp: chatTrustAeMcp.value,
        noApprovalPrompts: chatTrustAeMcp.value
    });
};

// Check interval (ms)
var checkInterval = 750;
var isChecking = false;
var lastBridgeCommand = "";

function writeBridgeHeartbeat(stateName) {
    try {
        var heartbeat = new File(Folder.myDocuments.fsName + "/ae-mcp-bridge/ae_bridge_status.json");
        heartbeat.encoding = "UTF-8";
        if (!heartbeat.open("w")) return;
        heartbeat.write(JSON.stringify({
            version: "1.9.10",
            state: stateName || (isChecking ? "checking" : "ready"),
            autoRun: autoRunCheckbox.value === true,
            lastCommand: lastBridgeCommand,
            updatedAt: (new Date()).toISOString ? (new Date()).toISOString() : String((new Date()).getTime())
        }, null, 2));
        heartbeat.close();
    } catch (_heartbeatError) {}
}

// Command file path - use Documents folder for reliable access
function getCommandFilePath() {
    var userFolder = Folder.myDocuments;
    var bridgeFolder = new Folder(userFolder.fsName + "/ae-mcp-bridge");
    if (!bridgeFolder.exists) {
        bridgeFolder.create();
    }
    return bridgeFolder.fsName + "/ae_command.json";
}

// Result file path - use Documents folder for reliable access
function getResultFilePath() {
    var userFolder = Folder.myDocuments;
    var bridgeFolder = new Folder(userFolder.fsName + "/ae-mcp-bridge");
    if (!bridgeFolder.exists) {
        bridgeFolder.create();
    }
    return bridgeFolder.fsName + "/ae_mcp_result.json";
}

// --- setCompositionProperties: set duration, frameRate, etc. on active or named comp ---
function setCompositionProperties(args) {
    try {
        var compName = args.compName || "";
        var comp = null;
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === compName) { comp = item; break; }
        }
        if (!comp) {
            if (app.project.activeItem instanceof CompItem) { comp = app.project.activeItem; }
            else { throw new Error("No composition found with name '" + compName + "' and no active composition"); }
        }
        var changed = [];
        if (args.duration !== undefined && args.duration !== null) { comp.duration = args.duration; changed.push("duration"); }
        if (args.frameRate !== undefined && args.frameRate !== null) { comp.frameRate = args.frameRate; changed.push("frameRate"); }
        if (args.width !== undefined && args.width !== null && args.height !== undefined && args.height !== null) {
            comp.width = args.width; comp.height = args.height; changed.push("dimensions");
        }
        return JSON.stringify({
            status: "success",
            composition: { name: comp.name, duration: comp.duration, frameRate: comp.frameRate, width: comp.width, height: comp.height },
            changedProperties: changed
        }, null, 2);
    } catch (error) {
        return JSON.stringify({ status: "error", message: error.toString() }, null, 2);
    }
}

// Functions for each script type
function getProjectInfo() {
    var project = app.project;
    var result = {
        projectName: project.file ? project.file.name : "Untitled Project",
        path: project.file ? project.file.fsName : "",
        numItems: project.numItems,
        bitsPerChannel: project.bitsPerChannel,
        timeMode: project.timeDisplayType === TimeDisplayType.FRAMES ? "Frames" : "Timecode",
        items: []
    };

    // Count item types
    var countByType = {
        compositions: 0,
        footage: 0,
        folders: 0,
        solids: 0
    };

    // Get item information (limited for performance)
    for (var i = 1; i <= Math.min(project.numItems, 50); i++) {
        var item = project.item(i);
        var itemType = "";
        
        if (item instanceof CompItem) {
            itemType = "Composition";
            countByType.compositions++;
        } else if (item instanceof FolderItem) {
            itemType = "Folder";
            countByType.folders++;
        } else if (item instanceof FootageItem) {
            if (item.mainSource instanceof SolidSource) {
                itemType = "Solid";
                countByType.solids++;
            } else {
                itemType = "Footage";
                countByType.footage++;
            }
        }
        
        result.items.push({
            id: item.id,
            name: item.name,
            type: itemType
        });
    }
    
    result.itemCounts = countByType;

    // Include active composition metadata if available
    if (app.project.activeItem instanceof CompItem) {
        var ac = app.project.activeItem;
        result.activeComp = {
            id: ac.id,
            name: ac.name,
            width: ac.width,
            height: ac.height,
            duration: ac.duration,
            frameRate: ac.frameRate,
            numLayers: ac.numLayers
        };
    }

    return JSON.stringify(result, null, 2);
}

function listCompositions() {
    var project = app.project;
    var result = {
        compositions: []
    };
    
    // Loop through items in the project
    for (var i = 1; i <= project.numItems; i++) {
        var item = project.item(i);
        
        // Check if the item is a composition
        if (item instanceof CompItem) {
            result.compositions.push({
                id: item.id,
                name: item.name,
                duration: item.duration,
                frameRate: item.frameRate,
                width: item.width,
                height: item.height,
                numLayers: item.numLayers
            });
        }
    }
    
    return JSON.stringify(result, null, 2);
}

function getLayerInfo() {
    var project = app.project;
    var result = {
        layers: []
    };
    
    // Get the active composition
    var activeComp = null;
    if (app.project.activeItem instanceof CompItem) {
        activeComp = app.project.activeItem;
    } else {
        return JSON.stringify({ error: "No active composition" }, null, 2);
    }
    
    // Loop through layers in the active composition
    for (var i = 1; i <= activeComp.numLayers; i++) {
        var layer = activeComp.layer(i);
        var layerInfo = {
            index: layer.index,
            name: layer.name,
            enabled: layer.enabled,
            locked: layer.locked,
            threeDLayer: layer.threeDLayer,
            position: layer.property("Position").value,
            inPoint: layer.inPoint,
            outPoint: layer.outPoint
        };
        
        result.layers.push(layerInfo);
    }
    
    return JSON.stringify(result, null, 2);
}

function createTextAnimator(args) {
    app.beginUndoGroup("Create Text Animator");
    try {
        var comp = app.project.items[args.compIndex];
        if (!comp || !(comp instanceof CompItem)) {
            throw new Error("Composition not found at index " + args.compIndex);
        }

        var layer = comp.layers[args.layerIndex];
        if (!layer) {
            throw new Error("Layer not found at index " + args.layerIndex);
        }

        var textProperties = layer.property("ADBE Text Properties");
        if (!textProperties) {
            throw new Error("Target layer is not a text layer.");
        }

        var animators = textProperties.property("ADBE Text Animators");
        var animator = animators.addProperty("ADBE Text Animator");
        animator.name = args.animatorName || "Text Animator";

        var animatorProperties = animator.property("ADBE Text Animator Properties");
        var propertyMatchNames = {
            anchorPoint: "ADBE Text Anchor Point 3D",
            position: "ADBE Text Position 3D",
            scale: "ADBE Text Scale 3D",
            rotation: "ADBE Text Rotation",
            opacity: "ADBE Text Opacity",
            skew: "ADBE Text Skew",
            skewAxis: "ADBE Text Skew Axis",
            tracking: "ADBE Text Tracking Amount",
            fillColor: "ADBE Text Fill Color",
            fillHue: "ADBE Text Fill Hue",
            fillSaturation: "ADBE Text Fill Saturation",
            fillBrightness: "ADBE Text Fill Brightness",
            fillOpacity: "ADBE Text Fill Opacity",
            strokeColor: "ADBE Text Stroke Color",
            strokeHue: "ADBE Text Stroke Hue",
            strokeSaturation: "ADBE Text Stroke Saturation",
            strokeBrightness: "ADBE Text Stroke Brightness",
            strokeOpacity: "ADBE Text Stroke Opacity",
            strokeWidth: "ADBE Text Stroke Width",
            blur: "ADBE Text Blur",
            characterOffset: "ADBE Text Character Offset",
            characterValue: "ADBE Text Character Value"
        };
        var addedProperties = [];
        for (var p = 0; p < args.properties.length; p++) {
            var definition = args.properties[p];
            var matchName = definition.property === "raw" ? definition.matchName : propertyMatchNames[definition.property];
            if (!matchName) throw new Error("Unsupported animator property: " + definition.property);
            var animatorProperty = animatorProperties.addProperty(matchName);
            if (!animatorProperty) throw new Error("After Effects could not add animator property " + matchName);
            animatorProperty.setValue(definition.value);
            addedProperties.push({ property: definition.property, matchName: matchName });
        }

        var selectors = animator.property("ADBE Text Selectors");
        var selector = selectors.addProperty("ADBE Text Selector");
        selector.name = "Range Selector";

        var start = selector.property("ADBE Text Percent Start");
        var end = selector.property("ADBE Text Percent End");
        var offset = selector.property("ADBE Text Percent Offset");
        var selectorArgs = args.selector || {};
        start.setValue(selectorArgs.start !== undefined ? selectorArgs.start : 0);
        end.setValue(selectorArgs.end !== undefined ? selectorArgs.end : 100);
        offset.setValue(selectorArgs.offset !== undefined ? selectorArgs.offset : 0);

        var advanced = selector.property("ADBE Text Range Advanced");
        if (advanced) {
            var basedOn = advanced.property("ADBE Text Range Type2");
            if (!basedOn) basedOn = advanced.property("ADBE Text Range Type 2");
            var basedOnValues = {
                characters: 1,
                charactersExcludingSpaces: 2,
                words: 3,
                lines: 4
            };
            if (basedOn) basedOn.setValue(basedOnValues[selectorArgs.basedOn || "characters"]);

            var smoothness = advanced.property("ADBE Text Selector Smoothness");
            if (smoothness) smoothness.setValue(selectorArgs.smoothness !== undefined ? selectorArgs.smoothness : 0);
            var easeHigh = advanced.property("ADBE Text Levels Max Ease");
            if (easeHigh && selectorArgs.easeHigh !== undefined) easeHigh.setValue(selectorArgs.easeHigh);
            var easeLow = advanced.property("ADBE Text Levels Min Ease");
            if (easeLow && selectorArgs.easeLow !== undefined) easeLow.setValue(selectorArgs.easeLow);
            var randomize = advanced.property("ADBE Text Randomize Order");
            if (randomize && selectorArgs.randomizeOrder !== undefined) randomize.setValue(selectorArgs.randomizeOrder ? 1 : 0);
        }

        var animatedSelectorProperty = start;
        if (selectorArgs.mode === "end") animatedSelectorProperty = end;
        if (selectorArgs.mode === "offset") animatedSelectorProperty = offset;
        var startTime = (selectorArgs.startTimeInSeconds !== undefined) ? selectorArgs.startTimeInSeconds : 0;
        var durationFrames = selectorArgs.durationInFrames || 25;
        var endTime = startTime + (durationFrames / comp.frameRate);
        animatedSelectorProperty.setValueAtTime(startTime, selectorArgs.from !== undefined ? selectorArgs.from : 0);
        animatedSelectorProperty.setValueAtTime(endTime, selectorArgs.to !== undefined ? selectorArgs.to : 100);

        return JSON.stringify({
            status: "success",
            message: "Text animator created successfully",
            layer: layer.name,
            animator: animator.name,
            properties: addedProperties,
            selectorMode: selectorArgs.mode || "start",
            startTime: startTime,
            endTime: endTime,
            durationFrames: durationFrames,
            frameRate: comp.frameRate
        });
    } catch (e) {
        return JSON.stringify({ status: "error", message: e.toString() });
    } finally {
        app.endUndoGroup();
    }
}

// --- General After Effects command surface ---
function aeGetComposition(args) {
    var comp = null;
    if (args.compIndex !== undefined && args.compIndex !== null) {
        comp = app.project.item(args.compIndex);
    } else if (args.compName) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem && item.name === args.compName) {
                comp = item;
                break;
            }
        }
    } else if (app.project.activeItem instanceof CompItem) {
        comp = app.project.activeItem;
    }
    if (!comp || !(comp instanceof CompItem)) throw new Error("Composition not found.");
    return comp;
}

function aeGetLayer(comp, args) {
    var layer = null;
    if (args.layerIndex !== undefined && args.layerIndex !== null) {
        layer = comp.layer(args.layerIndex);
    } else if (args.layerName) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === args.layerName) {
                layer = comp.layer(i);
                break;
            }
        }
    }
    if (!layer) throw new Error("Layer not found.");
    return layer;
}

function aeResolveProperty(root, propertyPath) {
    var path = propertyPath;
    if (typeof path === "string") path = path.split("/");
    if (!path || path.length === 0) return root;
    var current = root;
    for (var i = 0; i < path.length; i++) {
        var segment = path[i];
        var next = null;
        try { next = current.property(segment); } catch (_directError) {}
        if (!next && typeof segment === "string" && current.numProperties) {
            for (var p = 1; p <= current.numProperties; p++) {
                var candidate = current.property(p);
                if (candidate.name === segment || candidate.matchName === segment) {
                    next = candidate;
                    break;
                }
            }
        }
        if (!next) throw new Error("Property path segment not found: " + segment);
        current = next;
    }
    return current;
}

function aeTextJustificationName(value) {
    if (value === ParagraphJustification.RIGHT_JUSTIFY) return "right";
    if (value === ParagraphJustification.CENTER_JUSTIFY) return "center";
    if (value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT) return "fullJustifyLastLineLeft";
    if (value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT) return "fullJustifyLastLineRight";
    if (value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER) return "fullJustifyLastLineCenter";
    if (value === ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL) return "fullJustifyLastLineFull";
    return "left";
}

function aeTextJustificationValue(value) {
    if (typeof value !== "string") return value;
    var normalized = value.toLowerCase();
    var values = {
        left: ParagraphJustification.LEFT_JUSTIFY,
        right: ParagraphJustification.RIGHT_JUSTIFY,
        center: ParagraphJustification.CENTER_JUSTIFY,
        fulljustifylastlineleft: ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT,
        fulljustifylastlineright: ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT,
        fulljustifylastlinecenter: ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER,
        fulljustifylastlinefull: ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL,
        fulljustificationlastlineleft: ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT,
        fulljustificationlastlineright: ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT,
        fulljustificationlastlinecenter: ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER,
        fulljustificationlastlinefull: ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL,
        fulljustifyleft: ParagraphJustification.FULL_JUSTIFY_LASTLINE_LEFT,
        fulljustifyright: ParagraphJustification.FULL_JUSTIFY_LASTLINE_RIGHT,
        fulljustifycenter: ParagraphJustification.FULL_JUSTIFY_LASTLINE_CENTER,
        fulljustify: ParagraphJustification.FULL_JUSTIFY_LASTLINE_FULL
    };
    if (values[normalized] === undefined) throw new Error("Unsupported text justification: " + value);
    return values[normalized];
}

function aeSerializeTextDocument(document) {
    var result = {};
    var properties = [
        "text", "font", "fontFamily", "fontStyle", "fontSize",
        "applyFill", "fillColor", "applyStroke", "strokeColor", "strokeWidth", "strokeOverFill",
        "tracking", "kerning", "leading", "autoLeading", "baselineShift",
        "horizontalScale", "verticalScale", "tsume", "fauxBold", "fauxItalic",
        "allCaps", "smallCaps", "superscript", "subscript", "ligature", "noBreak",
        "autoHyphenate", "everyLineComposer", "composerEngine", "direction",
        "digitSet", "baselineDirection", "leadingType", "lineJoinType",
        "firstLineIndent", "startIndent", "endIndent", "spaceBefore", "spaceAfter",
        "hangingRoman", "boxText", "pointText", "boxTextPos", "boxTextSize",
        "boxVerticalAlignment", "boxAutoFitPolicy", "paragraphCount", "composedLineCount"
    ];
    for (var i = 0; i < properties.length; i++) {
        var propertyName = properties[i];
        try {
            var value = document[propertyName];
            if (value !== undefined) result[propertyName] = value;
        } catch (_textReadError) {}
    }
    try { result.justification = aeTextJustificationName(document.justification); } catch (_justificationReadError) {}
    return result;
}

function aeApplyTextSettings(target, settings) {
    var report = { changed: [], skipped: [] };
    if (!settings) return report;
    for (var propertyName in settings) {
        if (!settings.hasOwnProperty(propertyName)) continue;
        if (propertyName === "characterRanges" || propertyName === "paragraphRanges" || propertyName === "document" || propertyName === "settings") continue;
        try {
            var value = settings[propertyName];
            if (propertyName === "justification") value = aeTextJustificationValue(value);
            target[propertyName] = value;
            report.changed.push(propertyName);
        } catch (textSettingError) {
            report.skipped.push({ property: propertyName, message: textSettingError.toString() });
        }
    }
    return report;
}

function aeApplyTextRanges(document, ranges, methodName) {
    var reports = [];
    if (!ranges) return reports;
    if (typeof document[methodName] !== "function") {
        return [{ changed: [], skipped: [{ property: methodName, message: methodName + " is not supported by this After Effects version." }] }];
    }
    for (var i = 0; i < ranges.length; i++) {
        var rangeSpec = ranges[i];
        var isParagraphRange = methodName === "paragraphRange";
        var explicitStart = isParagraphRange ? rangeSpec.startParagraph : rangeSpec.startCharacter;
        var explicitEnd = isParagraphRange ? rangeSpec.endParagraph : rangeSpec.endCharacter;
        var start = explicitStart !== undefined ? explicitStart : (rangeSpec.start || 0);
        var defaultEnd = isParagraphRange ? document.paragraphCount : document.text.length;
        var end = explicitEnd !== undefined ? explicitEnd : (rangeSpec.end !== undefined ? rangeSpec.end : defaultEnd);
        try {
            var range = document[methodName](start, end);
            var report = aeApplyTextSettings(range, rangeSpec.settings || rangeSpec);
            reports.push({ start: start, end: end, changed: report.changed, skipped: report.skipped });
        } catch (rangeError) {
            reports.push({ start: start, end: end, changed: [], skipped: [{ property: methodName, message: rangeError.toString() }] });
        }
    }
    return reports;
}

function aeTextDocumentFromValue(property, value) {
    if (value instanceof TextDocument) return value;
    var document = property.value;
    if (typeof value === "string") {
        document.text = value;
        return document;
    }
    if (!value || typeof value !== "object") throw new Error("Source Text values require a string or text settings object.");
    var settings = value.document || value.settings || value;
    aeApplyTextSettings(document, settings);
    aeApplyTextRanges(document, value.characterRanges, "characterRange");
    aeApplyTextRanges(document, value.paragraphRanges, "paragraphRange");
    return document;
}

function aeSafeValue(value) {
    if (value === null || value === undefined) return value;
    if (value instanceof Shape) {
        return {
            vertices: value.vertices,
            inTangents: value.inTangents,
            outTangents: value.outTangents,
            closed: value.closed
        };
    }
    if (value instanceof TextDocument) {
        return aeSerializeTextDocument(value);
    }
    try {
        JSON.stringify(value);
        return value;
    } catch (_valueError) {
        return value.toString();
    }
}

function aeShapeFromValue(value) {
    if (value instanceof Shape) return value;
    if (!value || !value.vertices || value.vertices.length < 2) {
        throw new Error("Shape values require at least two vertices.");
    }
    var shape = new Shape();
    shape.vertices = value.vertices;
    if (value.inTangents) shape.inTangents = value.inTangents;
    if (value.outTangents) shape.outTangents = value.outTangents;
    shape.closed = value.closed !== undefined ? value.closed : true;
    return shape;
}

function aeCoercePropertyValue(property, value) {
    if (property.matchName === "ADBE Mask Shape" || property.matchName === "ADBE Vector Shape") {
        return aeShapeFromValue(value);
    }
    if (property.matchName === "ADBE Text Document") return aeTextDocumentFromValue(property, value);
    return value;
}

function aeInterpolationName(value) {
    if (value === KeyframeInterpolationType.HOLD) return "hold";
    if (value === KeyframeInterpolationType.BEZIER) return "bezier";
    return "linear";
}

function aeInterpolationValue(value) {
    if (value === "hold") return KeyframeInterpolationType.HOLD;
    if (value === "bezier") return KeyframeInterpolationType.BEZIER;
    return KeyframeInterpolationType.LINEAR;
}

function aeSerializeKeyframes(property) {
    var keys = [];
    if (!property || property.numKeys === undefined) return keys;
    for (var i = 1; i <= property.numKeys; i++) {
        var key = {
            index: i,
            time: property.keyTime(i),
            value: aeSafeValue(property.keyValue(i))
        };
        try {
            key.inInterpolation = aeInterpolationName(property.keyInInterpolationType(i));
            key.outInterpolation = aeInterpolationName(property.keyOutInterpolationType(i));
            key.temporalAutoBezier = property.keyTemporalAutoBezier(i);
            key.temporalContinuous = property.keyTemporalContinuous(i);
        } catch (_keyMetadataError) {}
        keys.push(key);
    }
    return keys;
}

function aeSerializeProperty(property, depth, maxDepth, includeValues) {
    var result = {
        name: property.name,
        matchName: property.matchName,
        index: property.propertyIndex,
        propertyType: property.propertyType,
        numProperties: property.numProperties || 0
    };
    try { result.enabled = property.enabled; } catch (_enabledError) {}
    try { result.selected = property.selected; } catch (_selectedError) {}
    if (property.propertyType === PropertyType.PROPERTY) {
        try { if (includeValues !== false) result.value = aeSafeValue(property.value); } catch (_readValueError) {}
        try { result.numKeys = property.numKeys; } catch (_numKeysError) {}
        try {
            if (property.canSetExpression) {
                result.expressionEnabled = property.expressionEnabled;
                result.expression = property.expression;
                result.expressionError = property.expressionError;
            }
        } catch (_expressionError) {}
    }
    if (depth < maxDepth && property.numProperties) {
        result.properties = [];
        for (var i = 1; i <= property.numProperties; i++) {
            result.properties.push(aeSerializeProperty(property.property(i), depth + 1, maxDepth, includeValues));
        }
    }
    return result;
}

function aeSetEffectSettings(effect, settings) {
    if (!settings) return [];
    var changed = [];
    for (var settingName in settings) {
        if (!settings.hasOwnProperty(settingName)) continue;
        var property = null;
        try { property = effect.property(settingName); } catch (_effectDirectError) {}
        if (!property) {
            for (var i = 1; i <= effect.numProperties; i++) {
                var candidate = effect.property(i);
                if (candidate.name === settingName || candidate.matchName === settingName) {
                    property = candidate;
                    break;
                }
            }
        }
        if (property && property.setValue) {
            property.setValue(settings[settingName]);
            changed.push(settingName);
        }
    }
    return changed;
}

function aeNormalizedEnumName(value) {
    return String(value || "").toLowerCase().replace(/[\s_\-]/g, "");
}

function aeBlendingModes() {
    return {
        normal: BlendingMode.NORMAL,
        dissolve: BlendingMode.DISSOLVE,
        dancingdissolve: BlendingMode.DANCING_DISSOLVE,
        darken: BlendingMode.DARKEN,
        multiply: BlendingMode.MULTIPLY,
        colorburn: BlendingMode.COLOR_BURN,
        classiccolorburn: BlendingMode.CLASSIC_COLOR_BURN,
        linearburn: BlendingMode.LINEAR_BURN,
        darkercolor: BlendingMode.DARKER_COLOR,
        add: BlendingMode.ADD,
        lighten: BlendingMode.LIGHTEN,
        screen: BlendingMode.SCREEN,
        colordodge: BlendingMode.COLOR_DODGE,
        classiccolordodge: BlendingMode.CLASSIC_COLOR_DODGE,
        lineardodge: BlendingMode.LINEAR_DODGE,
        lightercolor: BlendingMode.LIGHTER_COLOR,
        overlay: BlendingMode.OVERLAY,
        softlight: BlendingMode.SOFT_LIGHT,
        hardlight: BlendingMode.HARD_LIGHT,
        linearlight: BlendingMode.LINEAR_LIGHT,
        vividlight: BlendingMode.VIVID_LIGHT,
        pinlight: BlendingMode.PIN_LIGHT,
        hardmix: BlendingMode.HARD_MIX,
        difference: BlendingMode.DIFFERENCE,
        classicdifference: BlendingMode.CLASSIC_DIFFERENCE,
        exclusion: BlendingMode.EXCLUSION,
        subtract: BlendingMode.SUBTRACT,
        divide: BlendingMode.DIVIDE,
        hue: BlendingMode.HUE,
        saturation: BlendingMode.SATURATION,
        color: BlendingMode.COLOR,
        luminosity: BlendingMode.LUMINOSITY,
        stencilalpha: BlendingMode.STENCIL_ALPHA,
        stencilluma: BlendingMode.STENCIL_LUMA,
        silhouettealpha: BlendingMode.SILHOUETTE_ALPHA,
        silhouetteluma: BlendingMode.SILHOUETTE_LUMA,
        alphaadd: BlendingMode.ALPHA_ADD,
        luminescentpremul: BlendingMode.LUMINESCENT_PREMUL
    };
}

function aeBlendingModeValue(value) {
    if (typeof value !== "string") return value;
    var normalized = aeNormalizedEnumName(value);
    var modes = aeBlendingModes();
    if (modes[normalized] === undefined) throw new Error("Unsupported blending mode: " + value);
    return modes[normalized];
}

function aeBlendingModeName(value) {
    var modes = aeBlendingModes();
    for (var modeName in modes) {
        if (modes.hasOwnProperty(modeName) && modes[modeName] !== undefined && modes[modeName] === value) return modeName;
    }
    return String(value);
}

function aeTrackMatteTypes() {
    return {
        alpha: TrackMatteType.ALPHA,
        alphainverted: TrackMatteType.ALPHA_INVERTED,
        luma: TrackMatteType.LUMA,
        lumainverted: TrackMatteType.LUMA_INVERTED,
        none: TrackMatteType.NO_TRACK_MATTE
    };
}

function aeTrackMatteTypeValue(value) {
    if (typeof value !== "string") return value;
    var normalized = aeNormalizedEnumName(value);
    var types = aeTrackMatteTypes();
    if (types[normalized] === undefined) throw new Error("Unsupported track matte type: " + value);
    return types[normalized];
}

function aeTrackMatteTypeName(value) {
    var types = aeTrackMatteTypes();
    for (var typeName in types) {
        if (types.hasOwnProperty(typeName) && types[typeName] !== undefined && types[typeName] === value) return typeName;
    }
    return String(value);
}

function aeLayerSummary(layer) {
    var result = {
        index: layer.index,
        name: layer.name,
        enabled: layer.enabled,
        locked: layer.locked,
        shy: layer.shy,
        solo: layer.solo,
        threeDLayer: layer.threeDLayer,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        startTime: layer.startTime,
        stretch: layer.stretch
    };
    try { result.blendingMode = aeBlendingModeName(layer.blendingMode); } catch (_blendReadError) {}
    try { result.audioEnabled = layer.audioEnabled; } catch (_audioReadError) {}
    try { result.timeRemapEnabled = layer.timeRemapEnabled; } catch (_timeRemapReadError) {}
    try { result.hasTrackMatte = layer.hasTrackMatte; } catch (_hasMatteReadError) {}
    try { result.isTrackMatte = layer.isTrackMatte; } catch (_isMatteReadError) {}
    try { result.trackMatteType = aeTrackMatteTypeName(layer.trackMatteType); } catch (_matteTypeReadError) {}
    try {
        if (layer.trackMatteLayer) {
            result.trackMatteLayer = { index: layer.trackMatteLayer.index, name: layer.trackMatteLayer.name };
        }
    } catch (_matteLayerReadError) {}
    try { if (layer.parent) result.parent = { index: layer.parent.index, name: layer.parent.name }; } catch (_parentReadError) {}
    try { if (layer.source) result.source = { id: layer.source.id, name: layer.source.name }; } catch (_sourceReadError) {}
    return result;
}

function aeProjectItemIndex(target) {
    for (var i = 1; i <= app.project.numItems; i++) {
        if (app.project.item(i) === target) return i;
    }
    return null;
}

function aeInspect(args) {
    var scope = args.scope || "composition";
    if (scope === "project") {
        var projectResult = {
            name: app.project.file ? app.project.file.name : "Untitled Project",
            path: app.project.file ? app.project.file.fsName : "",
            bitsPerChannel: app.project.bitsPerChannel,
            numItems: app.project.numItems,
            items: []
        };
        var maxItems = args.maxItems || 200;
        for (var i = 1; i <= Math.min(app.project.numItems, maxItems); i++) {
            var item = app.project.item(i);
            projectResult.items.push({
                index: i,
                id: item.id,
                name: item.name,
                type: item instanceof CompItem ? "composition" : (item instanceof FolderItem ? "folder" : "footage")
            });
        }
        return projectResult;
    }

    var comp = aeGetComposition(args);
    if (scope === "composition") {
        var compResult = {
            index: comp.index,
            id: comp.id,
            name: comp.name,
            width: comp.width,
            height: comp.height,
            duration: comp.duration,
            frameRate: comp.frameRate,
            time: comp.time,
            workAreaStart: comp.workAreaStart,
            workAreaDuration: comp.workAreaDuration,
            numLayers: comp.numLayers,
            layers: []
        };
        for (var l = 1; l <= comp.numLayers; l++) {
            compResult.layers.push(aeLayerSummary(comp.layer(l)));
        }
        return compResult;
    }

    var layer = aeGetLayer(comp, args);
    if (scope === "layer") {
        return aeSerializeProperty(layer, 0, args.depth === undefined ? 1 : args.depth, args.includeValues);
    }
    if (scope === "propertyTree") {
        var propertyRoot = args.propertyPath ? aeResolveProperty(layer, args.propertyPath) : layer;
        return aeSerializeProperty(propertyRoot, 0, args.depth === undefined ? 4 : args.depth, args.includeValues);
    }
    if (scope === "effects") {
        var effects = layer.property("ADBE Effect Parade");
        var effectResults = [];
        for (var e = 1; e <= effects.numProperties; e++) {
            effectResults.push(aeSerializeProperty(effects.property(e), 0, args.depth === undefined ? 2 : args.depth, true));
        }
        return effectResults;
    }
    if (scope === "keyframes") {
        return aeSerializeKeyframes(aeResolveProperty(layer, args.propertyPath));
    }
    throw new Error("Unsupported inspection scope: " + scope);
}

function aePropertyCommand(args) {
    var comp = aeGetComposition(args);
    var layer = aeGetLayer(comp, args);
    var property = aeResolveProperty(layer, args.propertyPath);
    if (args.action === "get") return aeSerializeProperty(property, 0, args.depth || 0, true);
    if (args.action === "set") {
        var propertyValue = aeCoercePropertyValue(property, args.value);
        if (args.time !== undefined && args.time !== null) property.setValueAtTime(args.time, propertyValue);
        else property.setValue(propertyValue);
        return { property: property.name, value: aeSafeValue(property.value) };
    }
    if (args.action === "expression") {
        if (!property.canSetExpression) throw new Error("Property cannot accept expressions.");
        property.expression = args.expression || "";
        return { property: property.name, expression: property.expression, expressionEnabled: property.expressionEnabled };
    }
    throw new Error("Unsupported property action: " + args.action);
}

function aeApplyKeyframeOptions(property, index, args) {
    if (args.inInterpolation || args.outInterpolation) {
        property.setInterpolationTypeAtKey(
            index,
            aeInterpolationValue(args.inInterpolation || "linear"),
            aeInterpolationValue(args.outInterpolation || args.inInterpolation || "linear")
        );
    }
    if (args.temporalAutoBezier !== undefined) property.setTemporalAutoBezierAtKey(index, args.temporalAutoBezier);
    if (args.temporalContinuous !== undefined) property.setTemporalContinuousAtKey(index, args.temporalContinuous);
    if (args.inEase && args.outEase) {
        var inEase = [];
        var outEase = [];
        for (var i = 0; i < args.inEase.length; i++) inEase.push(new KeyframeEase(args.inEase[i].speed, args.inEase[i].influence));
        for (var o = 0; o < args.outEase.length; o++) outEase.push(new KeyframeEase(args.outEase[o].speed, args.outEase[o].influence));
        property.setTemporalEaseAtKey(index, inEase, outEase);
    }
}

function aeKeyframeCommand(args) {
    var comp = aeGetComposition(args);
    var layer = aeGetLayer(comp, args);
    var property = aeResolveProperty(layer, args.propertyPath);
    if (args.action === "get") return aeSerializeKeyframes(property);
    if (args.action === "set") {
        property.setValueAtTime(args.time, aeCoercePropertyValue(property, args.value));
        var index = property.nearestKeyIndex(args.time);
        aeApplyKeyframeOptions(property, index, args);
        return { property: property.name, keyframe: aeSerializeKeyframes(property)[index - 1] };
    }
    if (args.action === "update") {
        var updateIndex = args.index || property.nearestKeyIndex(args.time);
        if (args.value !== undefined) property.setValueAtKey(updateIndex, aeCoercePropertyValue(property, args.value));
        aeApplyKeyframeOptions(property, updateIndex, args);
        return { property: property.name, keyframe: aeSerializeKeyframes(property)[updateIndex - 1] };
    }
    if (args.action === "remove") {
        var removeIndex = args.index || property.nearestKeyIndex(args.time);
        property.removeKey(removeIndex);
        return { property: property.name, removedIndex: removeIndex, remaining: property.numKeys };
    }
    if (args.action === "clear") {
        while (property.numKeys > 0) property.removeKey(property.numKeys);
        return { property: property.name, remaining: 0 };
    }
    throw new Error("Unsupported keyframe action: " + args.action);
}

function aeEffectCommand(args) {
    var comp = aeGetComposition(args);
    var layer = aeGetLayer(comp, args);
    var effects = layer.property("ADBE Effect Parade");
    if (args.action === "get") {
        var effectResults = [];
        for (var e = 1; e <= effects.numProperties; e++) {
            effectResults.push(aeSerializeProperty(effects.property(e), 0, args.depth === undefined ? 2 : args.depth, true));
        }
        return effectResults;
    }
    if (args.action === "add") {
        if (args.presetPath) {
            var preset = new File(args.presetPath);
            if (!preset.exists) throw new Error("Preset not found: " + args.presetPath);
            layer.applyPreset(preset);
            return { preset: preset.fsName, applied: true };
        }
        var added = effects.addProperty(args.matchName || args.name);
        var addedChanges = aeSetEffectSettings(added, args.settings);
        return {
            index: added.propertyIndex,
            name: added.name,
            matchName: added.matchName,
            changedProperties: addedChanges
        };
    }
    var effect = effects.property(args.effectIndex || args.effectName);
    if (!effect) throw new Error("Effect not found.");
    if (args.action === "update") {
        var changed = aeSetEffectSettings(effect, args.settings);
        if (args.newName) { effect.name = args.newName; changed.push("name"); }
        if (args.enabled !== undefined) { effect.enabled = args.enabled; changed.push("enabled"); }
        return { index: effect.propertyIndex, name: effect.name, matchName: effect.matchName, changedProperties: changed };
    }
    if (args.action === "remove") {
        var removedName = effect.name;
        effect.remove();
        return { removed: removedName };
    }
    if (args.action === "move") {
        effect.moveTo(args.toIndex);
        return { name: effect.name, index: effect.propertyIndex };
    }
    throw new Error("Unsupported effect action: " + args.action);
}

function aeMaskModeName(mode) {
    if (mode === MaskMode.NONE) return "none";
    if (mode === MaskMode.SUBTRACT) return "subtract";
    if (mode === MaskMode.INTERSECT) return "intersect";
    if (mode === MaskMode.LIGHTEN) return "lighten";
    if (mode === MaskMode.DARKEN) return "darken";
    if (mode === MaskMode.DIFFERENCE) return "difference";
    return "add";
}

function aeMaskModeValue(mode) {
    var normalized = String(mode || "add").toLowerCase();
    var modes = {
        none: MaskMode.NONE,
        add: MaskMode.ADD,
        subtract: MaskMode.SUBTRACT,
        intersect: MaskMode.INTERSECT,
        lighten: MaskMode.LIGHTEN,
        darken: MaskMode.DARKEN,
        difference: MaskMode.DIFFERENCE
    };
    if (modes[normalized] === undefined) throw new Error("Unsupported mask mode: " + mode);
    return modes[normalized];
}

function aeGetMasks(layer) {
    var masks = layer.property("ADBE Mask Parade");
    if (!masks) throw new Error("This layer cannot contain masks.");
    return masks;
}

function aeGetMask(masks, args) {
    var mask = null;
    if (args.maskIndex !== undefined && args.maskIndex !== null) {
        if (args.maskIndex < 1 || args.maskIndex > masks.numProperties) {
            throw new Error("Mask index out of bounds: " + args.maskIndex);
        }
        mask = masks.property(args.maskIndex);
    } else if (args.maskName) {
        mask = masks.property(args.maskName);
    }
    if (!mask) throw new Error("Mask not found. Pass maskIndex or maskName.");
    return mask;
}

function aeMaskShapeFromArgs(args) {
    var shapeValue = args.shape || null;
    var rect = args.rect || args.maskRect;
    var vertices = args.vertices || args.maskPath;
    if (rect) {
        var top = rect.top !== undefined ? rect.top : 0;
        var left = rect.left !== undefined ? rect.left : 0;
        var width = rect.width;
        var height = rect.height;
        if (width === undefined || height === undefined) throw new Error("Mask rect requires width and height.");
        shapeValue = {
            vertices: [
                [left, top],
                [left + width, top],
                [left + width, top + height],
                [left, top + height]
            ],
            closed: true
        };
    } else if (vertices) {
        shapeValue = {
            vertices: vertices,
            inTangents: args.inTangents,
            outTangents: args.outTangents,
            closed: args.closed !== undefined ? args.closed : true
        };
    }
    return shapeValue ? aeShapeFromValue(shapeValue) : null;
}

function aeSerializeMask(mask) {
    var path = mask.property("ADBE Mask Shape");
    var feather = mask.property("ADBE Mask Feather");
    var opacity = mask.property("ADBE Mask Opacity");
    var expansion = mask.property("ADBE Mask Offset");
    var result = {
        index: mask.propertyIndex,
        name: mask.name,
        mode: aeMaskModeName(mask.maskMode),
        inverted: mask.inverted,
        rotoBezier: mask.rotoBezier,
        shape: aeSafeValue(path.value),
        feather: aeSafeValue(feather.value),
        opacity: opacity.value,
        expansion: expansion.value,
        pathKeyframes: aeSerializeKeyframes(path)
    };
    try { result.locked = mask.locked; } catch (_maskLockedError) {}
    try { result.color = mask.color; } catch (_maskColorError) {}
    return result;
}

function aeUpdateMask(mask, args) {
    var changed = [];
    var shape = aeMaskShapeFromArgs(args);
    if (shape) {
        var path = mask.property("ADBE Mask Shape");
        if (args.time !== undefined && args.time !== null) path.setValueAtTime(args.time, shape);
        else path.setValue(shape);
        changed.push("shape");
    }
    if (args.name !== undefined || args.newName !== undefined) {
        mask.name = args.name !== undefined ? args.name : args.newName;
        changed.push("name");
    }
    if (args.mode !== undefined) {
        mask.maskMode = aeMaskModeValue(args.mode);
        changed.push("mode");
    }
    if (args.inverted !== undefined) {
        mask.inverted = args.inverted;
        changed.push("inverted");
    }
    if (args.rotoBezier !== undefined) {
        mask.rotoBezier = args.rotoBezier;
        changed.push("rotoBezier");
    }
    if (args.locked !== undefined) {
        mask.locked = args.locked;
        changed.push("locked");
    }
    if (args.color !== undefined) {
        mask.color = args.color;
        changed.push("color");
    }
    if (args.feather !== undefined) {
        mask.property("ADBE Mask Feather").setValue(args.feather);
        changed.push("feather");
    }
    if (args.opacity !== undefined) {
        mask.property("ADBE Mask Opacity").setValue(args.opacity);
        changed.push("opacity");
    }
    if (args.expansion !== undefined) {
        mask.property("ADBE Mask Offset").setValue(args.expansion);
        changed.push("expansion");
    }
    return changed;
}

function aeMaskCommand(args) {
    var comp = aeGetComposition(args);
    var layer = aeGetLayer(comp, args);
    var masks = aeGetMasks(layer);
    if (args.action === "get") {
        if (args.maskIndex !== undefined || args.maskName) return aeSerializeMask(aeGetMask(masks, args));
        var maskResults = [];
        for (var i = 1; i <= masks.numProperties; i++) maskResults.push(aeSerializeMask(masks.property(i)));
        return { count: maskResults.length, masks: maskResults };
    }
    if (args.action === "add") {
        var shape = aeMaskShapeFromArgs(args);
        if (!shape) throw new Error("Adding a mask requires shape, vertices, maskPath, rect, or maskRect.");
        var added = masks.addProperty("ADBE Mask Atom");
        var addedChanges = aeUpdateMask(added, args);
        return { mask: aeSerializeMask(added), changedProperties: addedChanges };
    }
    var mask = aeGetMask(masks, args);
    if (args.action === "update" || args.action === "set") {
        var changed = aeUpdateMask(mask, args);
        return { mask: aeSerializeMask(mask), changedProperties: changed };
    }
    if (args.action === "remove") {
        var removedName = mask.name;
        var removedIndex = mask.propertyIndex;
        mask.remove();
        return { removed: removedName, removedIndex: removedIndex, remaining: masks.numProperties };
    }
    throw new Error("Unsupported mask action: " + args.action);
}

function aeShapeLayer(comp, args, allowCreate) {
    if (args.layerIndex !== undefined || args.layerName) return aeGetLayer(comp, args);
    if (!allowCreate || !args.createLayer) throw new Error("Pass layerIndex or layerName, or set createLayer for shape add.");
    var layer = comp.layers.addShape();
    var layerSettings = typeof args.createLayer === "object" ? args.createLayer : {};
    layer.name = layerSettings.name || args.newLayerName || "Shape Layer";
    if (layerSettings.position || args.layerPosition) {
        layer.property("ADBE Transform Group").property("ADBE Position").setValue(layerSettings.position || args.layerPosition);
    }
    if (layerSettings.inPoint !== undefined) layer.inPoint = layerSettings.inPoint;
    if (layerSettings.outPoint !== undefined) layer.outPoint = layerSettings.outPoint;
    return layer;
}

function aeShapeRoot(layer) {
    var root = layer.property("ADBE Root Vectors Group");
    if (!root) throw new Error("Layer is not a shape layer.");
    return root;
}

function aeShapeContents(property) {
    if (property.matchName === "ADBE Vector Group") {
        return property.property("ADBE Vectors Group");
    }
    if (property.matchName === "ADBE Root Vectors Group" || property.matchName === "ADBE Vectors Group") {
        return property;
    }
    throw new Error("Shape container path must resolve to Contents or a vector group.");
}

function aeResolveShapeItem(root, path, label) {
    if (!path || path.length === 0) throw new Error(label + " is required.");
    return aeResolveProperty(root, path);
}

function aeShapeMatchName(type) {
    var normalized = String(type || "").toLowerCase();
    var matchNames = {
        group: "ADBE Vector Group",
        rectangle: "ADBE Vector Shape - Rect",
        rect: "ADBE Vector Shape - Rect",
        ellipse: "ADBE Vector Shape - Ellipse",
        path: "ADBE Vector Shape - Group",
        polystar: "ADBE Vector Shape - Star",
        polygon: "ADBE Vector Shape - Star",
        star: "ADBE Vector Shape - Star",
        fill: "ADBE Vector Graphic - Fill",
        stroke: "ADBE Vector Graphic - Stroke",
        trimpaths: "ADBE Vector Filter - Trim",
        repeater: "ADBE Vector Filter - Repeater",
        roundcorners: "ADBE Vector Filter - RC",
        puckerbloat: "ADBE Vector Filter - PB",
        wigglepaths: "ADBE Vector Filter - Roughen",
        wiggletransform: "ADBE Vector Filter - Wiggler",
        twist: "ADBE Vector Filter - Twist",
        mergepaths: "ADBE Vector Filter - Merge",
        offsetpaths: "ADBE Vector Filter - Offset",
        zigzag: "ADBE Vector Filter - Zigzag"
    };
    var matchName = matchNames[normalized];
    if (!matchName) throw new Error("Unsupported shape item type: " + type);
    return matchName;
}

function aeSetShapeProperty(item, matchName, friendlyName, value) {
    if (value === undefined) return false;
    var property = item.property(matchName) || item.property(friendlyName);
    if (!property || !property.setValue) return false;
    property.setValue(aeCoercePropertyValue(property, value));
    return true;
}

function aeConfigureShapeItem(item, spec) {
    var changed = [];
    if (spec.name !== undefined) {
        item.name = spec.name;
        changed.push("name");
    }
    if (spec.enabled !== undefined) {
        item.enabled = spec.enabled;
        changed.push("enabled");
    }

    if (item.matchName === "ADBE Vector Group" && spec.transform) {
        var transform = item.property("ADBE Vector Transform Group");
        var transformChanges = aeSetEffectSettings(transform, spec.transform);
        for (var t = 0; t < transformChanges.length; t++) changed.push("transform/" + transformChanges[t]);
    }
    if (item.matchName === "ADBE Vector Shape - Rect") {
        if (aeSetShapeProperty(item, "ADBE Vector Rect Size", "Size", spec.size)) changed.push("size");
        if (aeSetShapeProperty(item, "ADBE Vector Rect Position", "Position", spec.position)) changed.push("position");
        if (aeSetShapeProperty(item, "ADBE Vector Rect Roundness", "Roundness", spec.roundness)) changed.push("roundness");
    } else if (item.matchName === "ADBE Vector Shape - Ellipse") {
        if (aeSetShapeProperty(item, "ADBE Vector Ellipse Size", "Size", spec.size)) changed.push("size");
        if (aeSetShapeProperty(item, "ADBE Vector Ellipse Position", "Position", spec.position)) changed.push("position");
    } else if (item.matchName === "ADBE Vector Shape - Star") {
        var requestedType = String(spec.type || "").toLowerCase();
        if (requestedType === "polygon" && aeSetShapeProperty(item, "ADBE Vector Star Type", "Type", 1)) changed.push("type");
        if (requestedType === "star" && aeSetShapeProperty(item, "ADBE Vector Star Type", "Type", 2)) changed.push("type");
        if (aeSetShapeProperty(item, "ADBE Vector Star Points", "Points", spec.points)) changed.push("points");
        if (aeSetShapeProperty(item, "ADBE Vector Star Position", "Position", spec.position)) changed.push("position");
        if (aeSetShapeProperty(item, "ADBE Vector Star Rotation", "Rotation", spec.rotation)) changed.push("rotation");
        if (aeSetShapeProperty(item, "ADBE Vector Star Inner Radius", "Inner Radius", spec.innerRadius)) changed.push("innerRadius");
        if (aeSetShapeProperty(item, "ADBE Vector Star Outer Radius", "Outer Radius", spec.outerRadius)) changed.push("outerRadius");
        if (aeSetShapeProperty(item, "ADBE Vector Star Inner Roundess", "Inner Roundness", spec.innerRoundness)) changed.push("innerRoundness");
        if (aeSetShapeProperty(item, "ADBE Vector Star Outer Roundess", "Outer Roundness", spec.outerRoundness)) changed.push("outerRoundness");
    } else if (item.matchName === "ADBE Vector Shape - Group") {
        if (aeSetShapeProperty(item, "ADBE Vector Shape", "Path", spec.shape)) changed.push("shape");
    } else if (item.matchName === "ADBE Vector Graphic - Fill") {
        if (aeSetShapeProperty(item, "ADBE Vector Fill Color", "Color", spec.color)) changed.push("color");
        if (aeSetShapeProperty(item, "ADBE Vector Fill Opacity", "Opacity", spec.opacity)) changed.push("opacity");
        if (aeSetShapeProperty(item, "ADBE Vector Fill Rule", "Fill Rule", spec.fillRule)) changed.push("fillRule");
    } else if (item.matchName === "ADBE Vector Graphic - Stroke") {
        if (aeSetShapeProperty(item, "ADBE Vector Stroke Color", "Color", spec.color)) changed.push("color");
        if (aeSetShapeProperty(item, "ADBE Vector Stroke Opacity", "Opacity", spec.opacity)) changed.push("opacity");
        if (aeSetShapeProperty(item, "ADBE Vector Stroke Width", "Stroke Width", spec.width)) changed.push("width");
        if (aeSetShapeProperty(item, "ADBE Vector Stroke Line Cap", "Line Cap", spec.lineCap)) changed.push("lineCap");
        if (aeSetShapeProperty(item, "ADBE Vector Stroke Line Join", "Line Join", spec.lineJoin)) changed.push("lineJoin");
        if (aeSetShapeProperty(item, "ADBE Vector Stroke Miter Limit", "Miter Limit", spec.miterLimit)) changed.push("miterLimit");
    }

    var settingChanges = aeSetEffectSettings(item, spec.settings);
    for (var s = 0; s < settingChanges.length; s++) changed.push("settings/" + settingChanges[s]);
    return changed;
}

function aeAddShapeItem(container, spec) {
    var item = container.addProperty(aeShapeMatchName(spec.type));
    var changed = aeConfigureShapeItem(item, spec);
    var childResults = [];
    if (item.matchName === "ADBE Vector Group" && spec.items) {
        var childContainer = aeShapeContents(item);
        for (var i = 0; i < spec.items.length; i++) {
            var childResult = aeAddShapeItem(childContainer, spec.items[i]);
            childResults.push({
                item: aeSerializeProperty(childResult.item, 0, 3, true),
                changedProperties: childResult.changedProperties,
                children: childResult.children
            });
        }
    }
    return { item: item, changedProperties: changed, children: childResults };
}

function aeShapeCommand(args) {
    var comp = aeGetComposition(args);
    var layer = aeShapeLayer(comp, args, args.action === "add");
    var root = aeShapeRoot(layer);
    if (args.action === "get") {
        var inspected = args.itemPath ? aeResolveProperty(root, args.itemPath) : root;
        return {
            layer: { index: layer.index, name: layer.name },
            item: aeSerializeProperty(inspected, 0, args.depth === undefined ? 5 : args.depth, args.includeValues)
        };
    }
    if (args.action === "add") {
        var containerTarget = args.containerPath ? aeResolveProperty(root, args.containerPath) : root;
        var container = aeShapeContents(containerTarget);
        var specifications = args.items && !args.type && !args.item ? args.items : [args.item || args];
        var additions = [];
        for (var i = 0; i < specifications.length; i++) {
            var addition = aeAddShapeItem(container, specifications[i]);
            additions.push({
                item: aeSerializeProperty(addition.item, 0, args.depth === undefined ? 4 : args.depth, true),
                changedProperties: addition.changedProperties,
                children: addition.children
            });
        }
        return { layer: { index: layer.index, name: layer.name }, additions: additions };
    }

    var item = aeResolveShapeItem(root, args.itemPath, "itemPath");
    if (args.action === "update" || args.action === "set") {
        var changed = aeConfigureShapeItem(item, args);
        return { item: aeSerializeProperty(item, 0, args.depth === undefined ? 4 : args.depth, true), changedProperties: changed };
    }
    if (args.action === "remove") {
        var removedName = item.name;
        var removedIndex = item.propertyIndex;
        item.remove();
        return { removed: removedName, removedIndex: removedIndex };
    }
    if (args.action === "move") {
        item.moveTo(args.toIndex);
        return { item: aeSerializeProperty(item, 0, 2, true) };
    }
    if (args.action === "duplicate") {
        var duplicate = item.duplicate();
        if (args.newName) duplicate.name = args.newName;
        return { item: aeSerializeProperty(duplicate, 0, args.depth === undefined ? 4 : args.depth, true) };
    }
    throw new Error("Unsupported shape action: " + args.action);
}

function aeTextSourceProperty(layer) {
    var textProperties = layer.property("ADBE Text Properties");
    var sourceText = textProperties ? textProperties.property("ADBE Text Document") : null;
    if (!sourceText) throw new Error("Layer is not a text layer.");
    return sourceText;
}

function aeTextSettingsFromArgs(args) {
    var source = args.document || args.settings || {};
    var settings = {};
    for (var sourceName in source) {
        if (source.hasOwnProperty(sourceName)) settings[sourceName] = source[sourceName];
    }
    var directProperties = [
        "text", "font", "fontSize", "applyFill", "fillColor", "applyStroke",
        "strokeColor", "strokeWidth", "strokeOverFill", "tracking", "kerning",
        "leading", "autoLeading", "baselineShift", "horizontalScale", "verticalScale",
        "tsume", "fauxBold", "fauxItalic", "allCaps", "smallCaps", "superscript",
        "subscript", "ligature", "noBreak", "autoHyphenate", "everyLineComposer",
        "composerEngine", "direction", "digitSet", "baselineDirection", "leadingType",
        "lineJoinType", "firstLineIndent", "startIndent", "endIndent", "spaceBefore",
        "spaceAfter", "hangingRoman", "justification", "boxTextSize",
        "boxVerticalAlignment", "boxAutoFitPolicy"
    ];
    for (var i = 0; i < directProperties.length; i++) {
        var propertyName = directProperties[i];
        if (args[propertyName] !== undefined) settings[propertyName] = args[propertyName];
    }
    return settings;
}

function aeApplyTextDocument(sourceText, args) {
    var document = sourceText.value;
    var settings = aeTextSettingsFromArgs(args);
    var report = aeApplyTextSettings(document, settings);
    var characterRanges = args.characterRanges || settings.characterRanges;
    var paragraphRanges = args.paragraphRanges || settings.paragraphRanges;
    var characterReports = aeApplyTextRanges(document, characterRanges, "characterRange");
    var paragraphReports = aeApplyTextRanges(document, paragraphRanges, "paragraphRange");
    if (args.time !== undefined && args.time !== null) sourceText.setValueAtTime(args.time, document);
    else sourceText.setValue(document);
    return {
        document: aeSerializeTextDocument(document),
        changedProperties: report.changed,
        skippedProperties: report.skipped,
        characterRanges: characterReports,
        paragraphRanges: paragraphReports,
        keyframes: aeSerializeKeyframes(sourceText)
    };
}

function aeTextCommand(args) {
    var comp = aeGetComposition(args);
    if (args.action === "add") {
        var created = args.boxSize ? comp.layers.addBoxText(args.boxSize) : comp.layers.addText(args.text || "");
        created.name = args.name || "Text Layer";
        if (args.position) {
            created.property("ADBE Transform Group").property("ADBE Position").setValue(args.position);
        }
        if (args.startTime !== undefined) created.startTime = args.startTime;
        if (args.inPoint !== undefined) created.inPoint = args.inPoint;
        if (args.outPoint !== undefined) created.outPoint = args.outPoint;
        else if (args.duration !== undefined) created.outPoint = created.startTime + args.duration;
        var createdResult = aeApplyTextDocument(aeTextSourceProperty(created), args);
        return {
            layer: { index: created.index, name: created.name, boxText: !!args.boxSize },
            text: createdResult
        };
    }

    var layer = aeGetLayer(comp, args);
    var sourceText = aeTextSourceProperty(layer);
    if (args.action === "get") {
        return {
            layer: { index: layer.index, name: layer.name },
            document: aeSerializeTextDocument(sourceText.value),
            keyframes: aeSerializeKeyframes(sourceText)
        };
    }
    if (args.action === "update" || args.action === "set") {
        return {
            layer: { index: layer.index, name: layer.name },
            text: aeApplyTextDocument(sourceText, args)
        };
    }
    throw new Error("Unsupported text action: " + args.action);
}

function aeSetLayerTrackMatte(comp, layer, args) {
    var matteLayer = null;
    if (args.matteLayerIndex !== undefined) matteLayer = comp.layer(args.matteLayerIndex);
    else if (args.matteLayerName) matteLayer = aeGetLayer(comp, { layerName: args.matteLayerName });
    if (!matteLayer) throw new Error("Pass matteLayerIndex or matteLayerName.");
    if (matteLayer === layer) throw new Error("A layer cannot use itself as a track matte.");
    var matteType = aeTrackMatteTypeValue(args.trackMatteType || args.matteType || "alpha");
    if (matteType === TrackMatteType.NO_TRACK_MATTE) return aeRemoveLayerTrackMatte(layer);
    if (typeof layer.setTrackMatte === "function") {
        layer.setTrackMatte(matteLayer, matteType);
    } else {
        matteLayer.moveBefore(layer);
        layer.trackMatteType = matteType;
    }
    return aeLayerSummary(layer);
}

function aeRemoveLayerTrackMatte(layer) {
    if (typeof layer.removeTrackMatte === "function") layer.removeTrackMatte();
    else layer.trackMatteType = TrackMatteType.NO_TRACK_MATTE;
    return aeLayerSummary(layer);
}

function aeLayerCommand(args) {
    var comp = aeGetComposition(args);
    if (args.action === "precompose") {
        var layerIndices = args.layerIndices || (args.layerIndex !== undefined ? [args.layerIndex] : null);
        if (!layerIndices || layerIndices.length === 0) throw new Error("Precompose requires layerIndices or layerIndex.");
        for (var p = 0; p < layerIndices.length; p++) {
            if (layerIndices[p] < 1 || layerIndices[p] > comp.numLayers) throw new Error("Layer index out of bounds: " + layerIndices[p]);
        }
        var precomp = comp.layers.precompose(
            layerIndices,
            args.newCompName || args.name || "Pre-comp",
            args.moveAllAttributes !== false
        );
        return {
            composition: {
                index: aeProjectItemIndex(precomp),
                id: precomp.id,
                name: precomp.name,
                duration: precomp.duration,
                frameRate: precomp.frameRate,
                numLayers: precomp.numLayers
            },
            sourceComposition: { id: comp.id, name: comp.name, numLayers: comp.numLayers }
        };
    }
    if (args.action === "add") {
        var created = null;
        if (args.type === "text") created = comp.layers.addText(args.text || "");
        else if (args.type === "null") created = comp.layers.addNull(args.duration || comp.duration);
        else if (args.type === "solid") created = comp.layers.addSolid(args.color || [1, 1, 1], args.name || "Solid", args.width || comp.width, args.height || comp.height, args.pixelAspect || 1, args.duration || comp.duration);
        else if (args.type === "shape") created = comp.layers.addShape();
        else if (args.type === "camera") created = comp.layers.addCamera(args.name || "Camera", args.centerPoint || [comp.width / 2, comp.height / 2]);
        else if (args.type === "light") created = comp.layers.addLight(args.name || "Light", args.centerPoint || [comp.width / 2, comp.height / 2]);
        else if (args.type === "item" || args.type === "projectItem" || args.type === "footage") {
            var sourceResult = aeGetProjectItem({
                itemIndex: args.itemIndex,
                itemId: args.itemId,
                itemName: args.itemName,
                active: false
            });
            if (!aeIsAVItem(sourceResult.item)) throw new Error("Only footage or compositions can be added as layers.");
            created = args.duration !== undefined ? comp.layers.add(sourceResult.item, args.duration) : comp.layers.add(sourceResult.item);
        }
        else throw new Error("Unsupported layer type: " + args.type);
        if (args.name) created.name = args.name;
        if (args.position) created.property("ADBE Transform Group").property("ADBE Position").setValue(args.position);
        return { layer: aeLayerSummary(created), type: args.type };
    }

    var layer = aeGetLayer(comp, args);
    if (args.action === "get") return aeLayerSummary(layer);
    if (args.action === "update") {
        var changed = [];
        var switches = ["name", "enabled", "locked", "shy", "solo", "threeDLayer", "adjustmentLayer", "guideLayer", "motionBlur", "collapseTransformation", "preserveTransparency", "audioEnabled", "frameBlending", "inPoint", "outPoint", "startTime", "stretch", "label", "comment"];
        for (var i = 0; i < switches.length; i++) {
            var key = switches[i];
            if (args[key] !== undefined) {
                layer[key] = args[key];
                changed.push(key);
            }
        }
        if (args.blendingMode !== undefined) {
            layer.blendingMode = aeBlendingModeValue(args.blendingMode);
            changed.push("blendingMode");
        }
        if (args.timeRemapEnabled !== undefined) {
            if (args.timeRemapEnabled && layer.canSetTimeRemapEnabled === false) throw new Error("Layer cannot enable time remapping.");
            layer.timeRemapEnabled = args.timeRemapEnabled;
            changed.push("timeRemapEnabled");
        }
        if (args.parentLayerIndex !== undefined) {
            layer.parent = args.parentLayerIndex === null ? null : comp.layer(args.parentLayerIndex);
            changed.push("parent");
        }
        if (args.trackMatteLayerIndex !== undefined || args.trackMatteLayerName) {
            aeSetLayerTrackMatte(comp, layer, {
                matteLayerIndex: args.trackMatteLayerIndex,
                matteLayerName: args.trackMatteLayerName,
                trackMatteType: args.trackMatteType
            });
            changed.push("trackMatte");
        } else if (args.removeTrackMatte === true) {
            aeRemoveLayerTrackMatte(layer);
            changed.push("trackMatte");
        }
        return { layer: aeLayerSummary(layer), changedProperties: changed };
    }
    if (args.action === "setTrackMatte") {
        return { layer: aeSetLayerTrackMatte(comp, layer, args) };
    }
    if (args.action === "removeTrackMatte") {
        return { layer: aeRemoveLayerTrackMatte(layer) };
    }
    if (args.action === "timeRemap") {
        if (args.enabled === false) {
            layer.timeRemapEnabled = false;
            return { layer: aeLayerSummary(layer), keyframes: [] };
        }
        if (layer.canSetTimeRemapEnabled === false) throw new Error("Layer cannot enable time remapping.");
        if (!layer.timeRemapEnabled) layer.timeRemapEnabled = true;
        var timeRemap = layer.property("ADBE Time Remapping");
        if (!timeRemap) throw new Error("Time Remap property is unavailable.");
        if (args.keyframes) {
            for (var k = 0; k < args.keyframes.length; k++) {
                var keyframe = args.keyframes[k];
                timeRemap.setValueAtTime(keyframe.time, keyframe.value);
            }
            if (args.clearExisting !== false) {
                for (var existingIndex = timeRemap.numKeys; existingIndex >= 1; existingIndex--) {
                    var existingTime = timeRemap.keyTime(existingIndex);
                    var keepExisting = false;
                    for (var requestedIndex = 0; requestedIndex < args.keyframes.length; requestedIndex++) {
                        if (Math.abs(args.keyframes[requestedIndex].time - existingTime) < 0.000001) {
                            keepExisting = true;
                            break;
                        }
                    }
                    if (!keepExisting) timeRemap.removeKey(existingIndex);
                }
            }
            for (var optionIndex = 0; optionIndex < args.keyframes.length; optionIndex++) {
                var optionKeyframe = args.keyframes[optionIndex];
                var keyIndex = timeRemap.nearestKeyIndex(optionKeyframe.time);
                aeApplyKeyframeOptions(timeRemap, keyIndex, optionKeyframe);
            }
        }
        if (args.expression !== undefined) timeRemap.expression = args.expression || "";
        return {
            layer: aeLayerSummary(layer),
            property: aeSerializeProperty(timeRemap, 0, 0, true),
            keyframes: aeSerializeKeyframes(timeRemap)
        };
    }
    if (args.action === "duplicate") {
        var duplicate = layer.duplicate();
        if (args.newName) duplicate.name = args.newName;
        return { layer: aeLayerSummary(duplicate) };
    }
    if (args.action === "remove") {
        var layerName = layer.name;
        layer.remove();
        return { removed: layerName };
    }
    if (args.action === "move") {
        if (args.where === "beginning") layer.moveToBeginning();
        else if (args.where === "end") layer.moveToEnd();
        else if (args.where === "before") layer.moveBefore(comp.layer(args.referenceLayerIndex));
        else if (args.where === "after") layer.moveAfter(comp.layer(args.referenceLayerIndex));
        else throw new Error("Unsupported move target.");
        return { layer: aeLayerSummary(layer) };
    }
    throw new Error("Unsupported layer action: " + args.action);
}


function aeCompositionCommand(args) {
    if (args.action === "create") {
        var created = app.project.items.addComp(args.name || "Composition", args.width || 1920, args.height || 1080, args.pixelAspect || 1, args.duration || 10, args.frameRate || 25);
        return { index: created.index, id: created.id, name: created.name };
    }
    var comp = aeGetComposition(args);
    if (args.action === "get") {
        return {
            id: comp.id,
            name: comp.name,
            width: comp.width,
            height: comp.height,
            duration: comp.duration,
            frameRate: comp.frameRate,
            time: comp.time,
            workAreaStart: comp.workAreaStart,
            workAreaDuration: comp.workAreaDuration,
            numLayers: comp.numLayers
        };
    }
    if (args.action === "update") {
        var changed = [];
        var keys = ["name", "width", "height", "duration", "frameRate", "workAreaStart", "workAreaDuration", "displayStartTime", "resolutionFactor", "bgColor"];
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (args[key] !== undefined) {
                comp[key] = args[key];
                changed.push(key);
            }
        }
        return { index: comp.index, name: comp.name, changedProperties: changed };
    }
    if (args.action === "duplicate") {
        var duplicate = comp.duplicate();
        if (args.newName) duplicate.name = args.newName;
        return { index: duplicate.index, id: duplicate.id, name: duplicate.name };
    }
    if (args.action === "remove") {
        var compName = comp.name;
        comp.remove();
        return { removed: compName };
    }
    throw new Error("Unsupported composition action: " + args.action);
}

function aeMergeObjects(base, override) {
    var result = {};
    var key;
    if (base) {
        for (key in base) if (base.hasOwnProperty(key)) result[key] = base[key];
    }
    if (override) {
        for (key in override) if (override.hasOwnProperty(key)) result[key] = override[key];
    }
    return result;
}

function aeImportAsValue(value) {
    var normalized = aeNormalizedEnumName(value || "footage");
    var values = {
        footage: ImportAsType.FOOTAGE,
        comp: ImportAsType.COMP,
        composition: ImportAsType.COMP,
        compcroppedlayers: ImportAsType.COMP_CROPPED_LAYERS,
        compositioncroppedlayers: ImportAsType.COMP_CROPPED_LAYERS,
        project: ImportAsType.PROJECT
    };
    if (values[normalized] === undefined) throw new Error("Unsupported importAs value: " + value);
    return values[normalized];
}

function aeAlphaModeValue(value) {
    if (typeof value !== "string") return value;
    var normalized = aeNormalizedEnumName(value);
    var values = {
        ignore: AlphaMode.IGNORE,
        straight: AlphaMode.STRAIGHT,
        premultiplied: AlphaMode.PREMULTIPLIED,
        premul: AlphaMode.PREMULTIPLIED
    };
    if (values[normalized] === undefined) throw new Error("Unsupported alpha mode: " + value);
    return values[normalized];
}

function aeAlphaModeName(value) {
    if (value === AlphaMode.IGNORE) return "ignore";
    if (value === AlphaMode.STRAIGHT) return "straight";
    if (value === AlphaMode.PREMULTIPLIED) return "premultiplied";
    return String(value);
}

function aeFieldSeparationValue(value) {
    if (typeof value !== "string") return value;
    var normalized = aeNormalizedEnumName(value);
    var values = {
        off: FieldSeparationType.OFF,
        upper: FieldSeparationType.UPPER_FIELD_FIRST,
        upperfieldfirst: FieldSeparationType.UPPER_FIELD_FIRST,
        lower: FieldSeparationType.LOWER_FIELD_FIRST,
        lowerfieldfirst: FieldSeparationType.LOWER_FIELD_FIRST
    };
    if (values[normalized] === undefined) throw new Error("Unsupported field separation type: " + value);
    return values[normalized];
}

function aeFieldSeparationName(value) {
    if (value === FieldSeparationType.OFF) return "off";
    if (value === FieldSeparationType.UPPER_FIELD_FIRST) return "upperFieldFirst";
    if (value === FieldSeparationType.LOWER_FIELD_FIRST) return "lowerFieldFirst";
    return String(value);
}

function aePulldownPhaseValue(value) {
    if (typeof value !== "string") return value;
    var normalized = aeNormalizedEnumName(value);
    var values = {
        off: PulldownPhase.OFF,
        wssww: PulldownPhase.WSSWW,
        sswww: PulldownPhase.SSWWW,
        swwws: PulldownPhase.SWWWS,
        wwwss: PulldownPhase.WWWSS,
        wwssw: PulldownPhase.WWSSW,
        wssww24padvance: PulldownPhase.WSSWW_24P_ADVANCE,
        sswww24padvance: PulldownPhase.SSWWW_24P_ADVANCE,
        swwws24padvance: PulldownPhase.SWWWS_24P_ADVANCE,
        wwwss24padvance: PulldownPhase.WWWSS_24P_ADVANCE,
        wwssw24padvance: PulldownPhase.WWSSW_24P_ADVANCE
    };
    if (values[normalized] === undefined) throw new Error("Unsupported pulldown phase: " + value);
    return values[normalized];
}

function aePulldownPhaseName(value) {
    if (value === PulldownPhase.OFF) return "off";
    if (value === PulldownPhase.WSSWW) return "wssww";
    if (value === PulldownPhase.SSWWW) return "sswww";
    if (value === PulldownPhase.SWWWS) return "swwws";
    if (value === PulldownPhase.WWWSS) return "wwwss";
    if (value === PulldownPhase.WWSSW) return "wwssw";
    if (value === PulldownPhase.WSSWW_24P_ADVANCE) return "wssww24pAdvance";
    if (value === PulldownPhase.SSWWW_24P_ADVANCE) return "sswww24pAdvance";
    if (value === PulldownPhase.SWWWS_24P_ADVANCE) return "swwws24pAdvance";
    if (value === PulldownPhase.WWWSS_24P_ADVANCE) return "wwwss24pAdvance";
    if (value === PulldownPhase.WWSSW_24P_ADVANCE) return "wwssw24pAdvance";
    return String(value);
}

function aePulldownMethodValue(value) {
    var normalized = aeNormalizedEnumName(value || "3:2");
    if (normalized === "32" || normalized === "pulldown32") return PulldownMethod.PULLDOWN_3_2;
    if (normalized === "advance24p" || normalized === "24padvance") return PulldownMethod.ADVANCE_24P;
    throw new Error("Unsupported pulldown guess method: " + value);
}

function aeIsAVItem(item) {
    return item instanceof CompItem || item instanceof FootageItem;
}

function aeGetProjectItem(args) {
    var item = null;
    var index = null;
    var requestedIndex = args.itemIndex !== undefined ? args.itemIndex :
        (args.compIndex !== undefined ? args.compIndex :
        (args.index !== undefined ? args.index : undefined));
    if (requestedIndex !== undefined) {
        if (requestedIndex < 1 || requestedIndex > app.project.numItems) throw new Error("Project item index out of bounds: " + requestedIndex);
        index = requestedIndex;
        item = app.project.item(index);
    } else {
        var requestedId = args.itemId !== undefined ? args.itemId : args.id;
        if (requestedId !== undefined) {
            if (app.project.itemByID) item = app.project.itemByID(requestedId);
            if (!item) {
                for (var idIndex = 1; idIndex <= app.project.numItems; idIndex++) {
                    if (app.project.item(idIndex).id === requestedId) {
                        item = app.project.item(idIndex);
                        break;
                    }
                }
            }
        } else {
            var requestedName = args.itemName || args.compositionName;
            if (requestedName) {
                for (var nameIndex = 1; nameIndex <= app.project.numItems; nameIndex++) {
                    if (app.project.item(nameIndex).name === requestedName) {
                        item = app.project.item(nameIndex);
                        break;
                    }
                }
            } else if (args.active !== false && app.project.activeItem) item = app.project.activeItem;
        }
    }
    if (!item) throw new Error("Project item not found. Use itemIndex, itemId, itemName, or an active project item.");
    if (index === null) index = aeProjectItemIndex(item);
    return { item: item, index: index };
}

function aeGetProjectFolder(args) {
    var folder = null;
    if (args.folderIndex !== undefined) folder = app.project.item(args.folderIndex);
    else if (args.folderId !== undefined && app.project.itemByID) folder = app.project.itemByID(args.folderId);
    else if (args.folderName) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof FolderItem && item.name === args.folderName) {
                folder = item;
                break;
            }
        }
    }
    if (folder && !(folder instanceof FolderItem)) throw new Error("Destination project item is not a folder.");
    return folder;
}

function aeProjectItemSummary(item) {
    var result = {
        index: aeProjectItemIndex(item),
        id: item.id,
        name: item.name,
        type: item instanceof CompItem ? "composition" : (item instanceof FolderItem ? "folder" : "footage")
    };
    try { if (item.parentFolder) result.parentFolder = { id: item.parentFolder.id, name: item.parentFolder.name }; } catch (_parentFolderReadError) {}
    try {
        if (item.file) result.path = item.file.fsName;
        else if (item.mainSource && item.mainSource.file) result.path = item.mainSource.file.fsName;
    } catch (_itemPathReadError) {}
    return result;
}

function aeFootageSourceType(source) {
    if (!source) return "none";
    if (source instanceof FileSource) return "file";
    if (source instanceof SolidSource) return "solid";
    if (source instanceof PlaceholderSource) return "placeholder";
    return "source";
}

function aeFootageSourceSummary(source) {
    if (!source) return null;
    var result = { type: aeFootageSourceType(source) };
    try { result.isStill = source.isStill; } catch (_sourceStillError) {}
    try { result.hasAlpha = source.hasAlpha; } catch (_sourceAlphaError) {}
    try { result.alphaMode = aeAlphaModeName(source.alphaMode); } catch (_sourceAlphaModeError) {}
    try { result.invertAlpha = source.invertAlpha; } catch (_sourceInvertAlphaError) {}
    try { result.premulColor = source.premulColor; } catch (_sourcePremulError) {}
    try { result.nativeFrameRate = source.nativeFrameRate; } catch (_sourceNativeRateError) {}
    try { result.conformFrameRate = source.conformFrameRate; } catch (_sourceConformRateError) {}
    try { result.displayFrameRate = source.displayFrameRate; } catch (_sourceDisplayRateError) {}
    try { result.fieldSeparationType = aeFieldSeparationName(source.fieldSeparationType); } catch (_sourceFieldError) {}
    try { result.highQualityFieldSeparation = source.highQualityFieldSeparation; } catch (_sourceHighQualityFieldError) {}
    try { result.removePulldown = aePulldownPhaseName(source.removePulldown); } catch (_sourcePulldownError) {}
    try { if (!source.isStill) result.loop = source.loop; } catch (_sourceLoopError) {}
    try { if (source.file) result.path = source.file.fsName; } catch (_sourceFileError) {}
    try { if (source.missingFootagePath) result.missingPath = source.missingFootagePath; } catch (_sourceMissingPathError) {}
    try { if (source instanceof SolidSource) result.color = source.color; } catch (_sourceColorError) {}
    try { if (source.colorProfile) result.colorProfile = source.colorProfile; } catch (_sourceProfileError) {}
    return result;
}

function aeDetailedProjectItemSummary(item, args) {
    var result = aeProjectItemSummary(item);
    try { result.comment = item.comment; } catch (_itemCommentError) {}
    try { result.label = item.label; } catch (_itemLabelError) {}
    try { result.selected = item.selected; } catch (_itemSelectedError) {}
    if (aeIsAVItem(item)) {
        try { result.width = item.width; } catch (_itemWidthError) {}
        try { result.height = item.height; } catch (_itemHeightError) {}
        try { result.duration = item.duration; } catch (_itemDurationError) {}
        try { result.frameRate = item.frameRate; } catch (_itemFrameRateError) {}
        try { result.pixelAspect = item.pixelAspect; } catch (_itemPixelAspectError) {}
        try { result.hasAudio = item.hasAudio; } catch (_itemAudioError) {}
        try { result.hasVideo = item.hasVideo; } catch (_itemVideoError) {}
        try { result.footageMissing = item.footageMissing; } catch (_itemMissingError) {}
        try { result.useProxy = item.useProxy; } catch (_itemUseProxyError) {}
        try { result.proxySource = aeFootageSourceSummary(item.proxySource); } catch (_itemProxyError) {}
        try { result.isMediaReplacementCompatible = item.isMediaReplacementCompatible; } catch (_itemReplacementError) {}
        if (!args || args.includeUsage !== false) {
            try {
                var usage = item.usedIn;
                result.usedIn = [];
                for (var usedIndex = 0; usedIndex < usage.length; usedIndex++) {
                    result.usedIn.push({
                        index: aeProjectItemIndex(usage[usedIndex]),
                        id: usage[usedIndex].id,
                        name: usage[usedIndex].name
                    });
                }
            } catch (_itemUsageError) {}
        }
    }
    if (item instanceof FootageItem) {
        try { result.mainSource = aeFootageSourceSummary(item.mainSource); } catch (_itemMainSourceError) {}
    }
    if (item instanceof CompItem) result.numLayers = item.numLayers;
    return result;
}

function aeApplyInterpretation(item, args) {
    var sourceKind = aeNormalizedEnumName(args.source || "main");
    var source = null;
    if (sourceKind === "proxy") {
        if (!aeIsAVItem(item) || !item.proxySource) throw new Error("Project item has no proxy source.");
        source = item.proxySource;
    } else {
        if (!(item instanceof FootageItem)) throw new Error("Main-source interpretation requires a footage item.");
        source = item.mainSource;
    }
    var changed = [];
    if (args.guessAlpha === true) {
        source.guessAlphaMode();
        changed.push("guessAlpha");
    }
    if (args.fieldSeparationType !== undefined) {
        source.fieldSeparationType = aeFieldSeparationValue(args.fieldSeparationType);
        changed.push("fieldSeparationType");
    }
    if (args.conformFrameRate !== undefined) {
        source.conformFrameRate = args.conformFrameRate;
        changed.push("conformFrameRate");
    }
    if (args.removePulldown !== undefined) {
        source.removePulldown = aePulldownPhaseValue(args.removePulldown);
        changed.push("removePulldown");
    }
    if (args.guessPulldown !== undefined && args.guessPulldown !== false) {
        source.guessPulldown(aePulldownMethodValue(typeof args.guessPulldown === "string" ? args.guessPulldown : args.pulldownMethod));
        changed.push("guessPulldown");
    }
    if (args.highQualityFieldSeparation !== undefined) {
        source.highQualityFieldSeparation = args.highQualityFieldSeparation;
        changed.push("highQualityFieldSeparation");
    }
    if (args.loop !== undefined) {
        source.loop = args.loop;
        changed.push("loop");
    }
    if (args.alphaMode !== undefined) {
        source.alphaMode = aeAlphaModeValue(args.alphaMode);
        changed.push("alphaMode");
    }
    if (args.invertAlpha !== undefined) {
        source.invertAlpha = args.invertAlpha;
        changed.push("invertAlpha");
    }
    if (args.premulColor !== undefined) {
        source.premulColor = args.premulColor;
        changed.push("premulColor");
    }
    return { source: sourceKind === "proxy" ? "proxy" : "main", changedProperties: changed, interpretation: aeFootageSourceSummary(source) };
}

function aeRelinkProjectItem(args) {
    var itemResult = aeGetProjectItem(args);
    var item = itemResult.item;
    if (!(item instanceof FootageItem)) throw new Error("Relink requires a footage item.");
    if (!args.path) throw new Error("Relink path is required.");
    var replacement = new File(args.path);
    if (!replacement.exists) throw new Error("Replacement file not found: " + args.path);
    if (args.sequence === true) item.replaceWithSequence(replacement, args.forceAlphabetical === true);
    else item.replace(replacement);
    var interpretation = aeApplyInterpretation(item, args);
    return {
        item: aeDetailedProjectItemSummary(item, args),
        sequence: args.sequence === true,
        interpretationChanges: interpretation.changedProperties
    };
}

function aeReloadProjectItem(args) {
    var itemResult = aeGetProjectItem(args);
    var item = itemResult.item;
    if (!(item instanceof FootageItem) || !(item.mainSource instanceof FileSource)) throw new Error("Reload requires file-based footage.");
    item.mainSource.reload();
    return aeDetailedProjectItemSummary(item, args);
}

function aeProxyProjectItem(args) {
    var itemResult = aeGetProjectItem(args);
    var item = itemResult.item;
    if (!aeIsAVItem(item)) throw new Error("Proxy operations require a composition or footage item.");
    var mode = aeNormalizedEnumName(args.mode || "set");
    if (mode === "none" || mode === "remove" || mode === "clear") item.setProxyToNone();
    else if (mode === "enable" || mode === "use") {
        if (!item.proxySource) throw new Error("Project item has no proxy source to enable.");
        item.useProxy = true;
    } else if (mode === "disable" || mode === "bypass") item.useProxy = false;
    else if (mode === "placeholder") {
        item.setProxyWithPlaceholder(
            args.name || (item.name + " Proxy"),
            args.width || item.width,
            args.height || item.height,
            args.frameRate || item.frameRate || 25,
            args.duration !== undefined ? args.duration : item.duration
        );
    } else if (mode === "solid") {
        item.setProxyWithSolid(
            args.color || [0, 0, 0],
            args.name || (item.name + " Proxy"),
            args.width || item.width,
            args.height || item.height,
            args.pixelAspect || item.pixelAspect || 1
        );
    } else {
        if (!args.path) throw new Error("Proxy file path is required.");
        var proxyFile = new File(args.path);
        if (!proxyFile.exists) throw new Error("Proxy file not found: " + args.path);
        if (mode === "sequence") item.setProxyWithSequence(proxyFile, args.forceAlphabetical === true);
        else item.setProxy(proxyFile);
    }
    if (args.interpretation) aeApplyInterpretation(item, aeMergeObjects(args.interpretation, { source: "proxy" }));
    return aeDetailedProjectItemSummary(item, args);
}

function aeProjectMediaList(args) {
    var results = [];
    var matched = 0;
    var offset = args.offset || 0;
    var limit = args.maxItems !== undefined ? args.maxItems : 100;
    var typeFilter = args.type ? aeNormalizedEnumName(args.type) : "";
    var nameFilter = args.nameContains ? String(args.nameContains).toLowerCase() : "";
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        var itemType = item instanceof CompItem ? "composition" : (item instanceof FolderItem ? "folder" : "footage");
        if (typeFilter && typeFilter !== itemType && !(typeFilter === "comp" && itemType === "composition")) continue;
        if (nameFilter && item.name.toLowerCase().indexOf(nameFilter) < 0) continue;
        if (args.missingOnly === true) {
            var missing = false;
            try { missing = item.footageMissing === true; } catch (_mediaMissingReadError) {}
            try { if (item.proxySource && item.proxySource.missingFootagePath) missing = true; } catch (_mediaProxyMissingReadError) {}
            if (!missing) continue;
        }
        if (args.unusedOnly === true) {
            if (!(item instanceof FootageItem)) continue;
            try { if (item.usedIn.length > 0) continue; } catch (_mediaUnusedReadError) { continue; }
        }
        if (args.proxyOnly === true) {
            try { if (!item.proxySource) continue; } catch (_mediaProxyReadError) { continue; }
        }
        if (matched >= offset && results.length < limit) results.push(aeDetailedProjectItemSummary(item, args));
        matched++;
    }
    return { totalMatched: matched, offset: offset, count: results.length, items: results };
}

function aeDependencyReport(args) {
    var rootResult = aeGetProjectItem(args);
    var root = rootResult.item;
    var dependencies = [];
    var seen = {};
    var includeNested = args.recursive !== false;
    function visitComposition(comp, depth) {
        for (var layerIndex = 1; layerIndex <= comp.numLayers; layerIndex++) {
            var layer = comp.layer(layerIndex);
            var source = null;
            try { source = layer.source; } catch (_dependencySourceError) {}
            if (!source) continue;
            var key = String(source.id);
            if (!seen[key]) {
                seen[key] = true;
                var detail = aeDetailedProjectItemSummary(source, args);
                detail.via = { compositionId: comp.id, compositionName: comp.name, layerIndex: layerIndex, layerName: layer.name, depth: depth };
                dependencies.push(detail);
            }
            if (includeNested && source instanceof CompItem) visitComposition(source, depth + 1);
        }
    }
    if (root instanceof CompItem) visitComposition(root, 1);
    var externalFiles = [];
    var missing = [];
    for (var dependencyIndex = 0; dependencyIndex < dependencies.length; dependencyIndex++) {
        var dependency = dependencies[dependencyIndex];
        if (dependency.path) externalFiles.push(dependency.path);
        if (dependency.footageMissing || (dependency.mainSource && dependency.mainSource.missingPath)) missing.push(dependency);
    }
    return {
        root: aeDetailedProjectItemSummary(root, args),
        recursive: includeNested,
        count: dependencies.length,
        dependencies: dependencies,
        externalFiles: externalFiles,
        missing: missing
    };
}

function aeProjectMediaManifest(args) {
    var items = [];
    var files = [];
    var uniqueFiles = {};
    var missing = [];
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (!(item instanceof FootageItem)) continue;
        var detail = aeDetailedProjectItemSummary(item, args);
        items.push(detail);
        if (detail.path) {
            var mainKey = detail.path.toLowerCase();
            if (!uniqueFiles[mainKey]) {
                uniqueFiles[mainKey] = true;
                files.push({ path: detail.path, kind: "main", itemId: detail.id, itemName: detail.name });
            }
        }
        if (detail.proxySource && detail.proxySource.path) {
            var proxyKey = detail.proxySource.path.toLowerCase();
            if (!uniqueFiles[proxyKey]) {
                uniqueFiles[proxyKey] = true;
                files.push({ path: detail.proxySource.path, kind: "proxy", itemId: detail.id, itemName: detail.name });
            }
        }
        if (detail.footageMissing || (detail.mainSource && detail.mainSource.missingPath)) missing.push(detail);
    }
    return { itemCount: items.length, uniqueFileCount: files.length, missingCount: missing.length, files: files, missing: missing, items: args.includeItems === false ? undefined : items };
}

function aeCleanupProject(args) {
    if (args.confirm !== true) throw new Error("Project cleanup requires confirm: true.");
    var mode = aeNormalizedEnumName(args.mode || "");
    var before = app.project.numItems;
    var removed = 0;
    if (mode === "consolidate" || mode === "consolidatefootage") removed = app.project.consolidateFootage();
    else if (mode === "removeunused" || mode === "removeunusedfootage") removed = app.project.removeUnusedFootage();
    else if (mode === "reduce" || mode === "reduceproject") {
        var keep = [];
        if (args.useSelection === true) {
            var selection = app.project.selection;
            for (var selectedIndex = 0; selectedIndex < selection.length; selectedIndex++) keep.push(selection[selectedIndex]);
        }
        if (args.keepItems) {
            for (var keepIndex = 0; keepIndex < args.keepItems.length; keepIndex++) keep.push(aeGetProjectItem(args.keepItems[keepIndex]).item);
        }
        if (args.keepItemIndices) {
            for (var indexIndex = 0; indexIndex < args.keepItemIndices.length; indexIndex++) keep.push(aeGetProjectItem({ itemIndex: args.keepItemIndices[indexIndex] }).item);
        }
        if (args.keepItemIds) {
            for (var idIndex = 0; idIndex < args.keepItemIds.length; idIndex++) keep.push(aeGetProjectItem({ itemId: args.keepItemIds[idIndex] }).item);
        }
        if (!keep.length) throw new Error("Reduce Project requires useSelection or at least one keep item.");
        removed = app.project.reduceProject(keep);
    } else throw new Error("Unsupported cleanup mode: " + args.mode);
    return { mode: mode, removed: removed, before: before, remaining: app.project.numItems };
}

function aeImportOne(importArgs) {
    var importFile = new File(importArgs.path);
    if (!importFile.exists) throw new Error("Import file not found: " + importArgs.path);
    var importOptions = new ImportOptions(importFile);
    if (importArgs.sequence !== undefined) importOptions.sequence = importArgs.sequence;
    if (importArgs.forceAlphabetical !== undefined) importOptions.forceAlphabetical = importArgs.forceAlphabetical;
    if (importArgs.importAs !== undefined) {
        var importType = aeImportAsValue(importArgs.importAs);
        if (!importOptions.canImportAs(importType)) throw new Error("File cannot be imported as " + importArgs.importAs + ": " + importArgs.path);
        importOptions.importAs = importType;
    }
    if (importArgs.rangeStart !== undefined) importOptions.rangeStart = importArgs.rangeStart;
    if (importArgs.rangeEnd !== undefined) importOptions.rangeEnd = importArgs.rangeEnd;
    var imported = app.project.importFile(importOptions);
    if (importArgs.name) imported.name = importArgs.name;
    var folder = aeGetProjectFolder(importArgs);
    if (folder) imported.parentFolder = folder;
    try {
        if (importArgs.conformFrameRate !== undefined) imported.mainSource.conformFrameRate = importArgs.conformFrameRate;
        if (importArgs.loop !== undefined) imported.mainSource.loop = importArgs.loop;
        if (importArgs.alphaMode !== undefined) imported.mainSource.alphaMode = aeAlphaModeValue(importArgs.alphaMode);
        if (importArgs.invertAlpha !== undefined) imported.mainSource.invertAlpha = importArgs.invertAlpha;
        if (importArgs.premulColor !== undefined) imported.mainSource.premulColor = importArgs.premulColor;
    } catch (_interpretationError) {}
    return aeProjectItemSummary(imported);
}

function aeRQStatusName(status) {
    if (status === RQItemStatus.WILL_CONTINUE) return "willContinue";
    if (status === RQItemStatus.NEEDS_OUTPUT) return "needsOutput";
    if (status === RQItemStatus.UNQUEUED) return "unqueued";
    if (status === RQItemStatus.QUEUED) return "queued";
    if (status === RQItemStatus.RENDERING) return "rendering";
    if (status === RQItemStatus.USER_STOPPED) return "userStopped";
    if (status === RQItemStatus.ERR_STOPPED) return "errorStopped";
    if (status === RQItemStatus.DONE) return "done";
    return String(status);
}

function aeLogTypeValue(value) {
    if (typeof value !== "string") return value;
    var normalized = aeNormalizedEnumName(value);
    var values = {
        errorsonly: LogType.ERRORS_ONLY,
        errorsandsettings: LogType.ERRORS_AND_SETTINGS,
        errorsandperframeinfo: LogType.ERRORS_AND_PER_FRAME_INFO
    };
    if (values[normalized] === undefined) throw new Error("Unsupported render log type: " + value);
    return values[normalized];
}

function aeLogTypeName(value) {
    if (value === LogType.ERRORS_AND_SETTINGS) return "errorsAndSettings";
    if (value === LogType.ERRORS_AND_PER_FRAME_INFO) return "errorsAndPerFrameInfo";
    return "errorsOnly";
}

function aePostRenderActionValue(value) {
    if (typeof value !== "string") return value;
    var normalized = aeNormalizedEnumName(value);
    var values = {
        none: PostRenderAction.NONE,
        "import": PostRenderAction.IMPORT,
        importandreplaceusage: PostRenderAction.IMPORT_AND_REPLACE_USAGE,
        setproxy: PostRenderAction.SET_PROXY
    };
    if (values[normalized] === undefined) throw new Error("Unsupported post-render action: " + value);
    return values[normalized];
}

function aePostRenderActionName(value) {
    if (value === PostRenderAction.IMPORT) return "import";
    if (value === PostRenderAction.IMPORT_AND_REPLACE_USAGE) return "importAndReplaceUsage";
    if (value === PostRenderAction.SET_PROXY) return "setProxy";
    return "none";
}

function aeSettingsFormat(value, settable) {
    var normalized = aeNormalizedEnumName(value || "string");
    if (normalized === "number") return settable ? GetSettingsFormat.NUMBER_SETTABLE : GetSettingsFormat.NUMBER;
    return settable ? GetSettingsFormat.STRING_SETTABLE : GetSettingsFormat.STRING;
}

function aeGetRenderQueueItem(args) {
    var index = args.renderQueueIndex !== undefined ? args.renderQueueIndex :
        (args.itemIndex !== undefined ? args.itemIndex :
        (args.index !== undefined ? args.index : 1));
    if (index < 1 || index > app.project.renderQueue.numItems) throw new Error("Render queue index out of bounds: " + index);
    return { item: app.project.renderQueue.item(index), index: index };
}

function aeOutputModuleSummary(renderItem, outputIndex, args) {
    var output = renderItem.outputModule(outputIndex);
    var result = {
        index: outputIndex,
        name: output.name,
        path: output.file ? output.file.fsName : "",
        includeSourceXMP: output.includeSourceXMP,
        postRenderAction: aePostRenderActionName(output.postRenderAction)
    };
    if (args && args.includeTemplates) result.templates = output.templates;
    if (args && args.includeSettings) result.settings = output.getSettings(aeSettingsFormat(args.settingsFormat, args.settableOnly));
    return result;
}

function aeRenderItemSummary(renderItem, index, args) {
    var result = {
        index: index,
        composition: { id: renderItem.comp.id, name: renderItem.comp.name },
        status: aeRQStatusName(renderItem.status),
        render: renderItem.render,
        timeSpanStart: renderItem.timeSpanStart,
        timeSpanDuration: renderItem.timeSpanDuration,
        skipFrames: renderItem.skipFrames,
        logType: aeLogTypeName(renderItem.logType),
        numOutputModules: renderItem.numOutputModules,
        outputs: []
    };
    try { result.queueItemNotify = renderItem.queueItemNotify; } catch (_queueItemNotifyReadError) {}
    try { result.elapsedSeconds = renderItem.elapsedSeconds; } catch (_elapsedReadError) {}
    try { if (renderItem.startTime) result.startTime = renderItem.startTime.toString(); } catch (_startTimeReadError) {}
    if (args && args.includeTemplates) result.renderSettingsTemplates = renderItem.templates;
    if (args && args.includeSettings) result.renderSettings = renderItem.getSettings(aeSettingsFormat(args.settingsFormat, args.settableOnly));
    for (var i = 1; i <= renderItem.numOutputModules; i++) result.outputs.push(aeOutputModuleSummary(renderItem, i, args));
    return result;
}

function aeConfigureRenderItem(renderItem, args) {
    var changed = [];
    if (args.renderSettingsTemplate || args.template) {
        renderItem.applyTemplate(args.renderSettingsTemplate || args.template);
        changed.push("renderSettingsTemplate");
    }
    if (args.renderSettings) {
        renderItem.setSettings(args.renderSettings);
        changed.push("renderSettings");
    }
    if (args.timeSpanStart !== undefined) { renderItem.timeSpanStart = args.timeSpanStart; changed.push("timeSpanStart"); }
    if (args.timeSpanDuration !== undefined) { renderItem.timeSpanDuration = args.timeSpanDuration; changed.push("timeSpanDuration"); }
    if (args.skipFrames !== undefined) { renderItem.skipFrames = args.skipFrames; changed.push("skipFrames"); }
    if (args.render !== undefined) { renderItem.render = args.render; changed.push("render"); }
    if (args.logType !== undefined) { renderItem.logType = aeLogTypeValue(args.logType); changed.push("logType"); }
    try {
        if (args.queueItemNotify !== undefined) { renderItem.queueItemNotify = args.queueItemNotify; changed.push("queueItemNotify"); }
    } catch (_queueItemNotifyWriteError) {}
    return changed;
}

function aeConfigureOutputModule(renderItem, outputIndex, args) {
    var output = renderItem.outputModule(outputIndex);
    var changed = [];
    if (args.outputTemplate || args.template) {
        output.applyTemplate(args.outputTemplate || args.template);
        changed.push("outputTemplate");
        output = renderItem.outputModule(outputIndex);
    }
    if (args.copyFromOutputIndex !== undefined) {
        var copiedSettings = renderItem.outputModule(args.copyFromOutputIndex).getSettings(GetSettingsFormat.STRING_SETTABLE);
        output.setSettings(copiedSettings);
        changed.push("copiedSettings");
        output = renderItem.outputModule(outputIndex);
    }
    if (args.outputSettings || args.settings) {
        output.setSettings(args.outputSettings || args.settings);
        changed.push("outputSettings");
        output = renderItem.outputModule(outputIndex);
    }
    if (args.outputPath || args.path) {
        output.file = new File(args.outputPath || args.path);
        changed.push("outputPath");
    }
    if (args.includeSourceXMP !== undefined) { output.includeSourceXMP = args.includeSourceXMP; changed.push("includeSourceXMP"); }
    if (args.postRenderAction !== undefined) { output.postRenderAction = aePostRenderActionValue(args.postRenderAction); changed.push("postRenderAction"); }
    return { output: aeOutputModuleSummary(renderItem, outputIndex, args), changedProperties: changed };
}

function aeRenderQueueSummary(args) {
    var queue = app.project.renderQueue;
    var result = {
        rendering: queue.rendering,
        canQueueInAME: queue.canQueueInAME,
        numItems: queue.numItems,
        items: []
    };
    try { result.queueNotify = queue.queueNotify; } catch (_queueNotifyReadError) {}
    for (var i = 1; i <= queue.numItems; i++) result.items.push(aeRenderItemSummary(queue.item(i), i, args));
    return result;
}

function aeRenderCommand(args) {
    var queue = app.project.renderQueue;
    if (args.action === "get") return aeRenderQueueSummary(args);
    if (args.action === "add") {
        var comp = aeGetComposition(args);
        var renderItem = queue.items.add(comp);
        var renderChanges = aeConfigureRenderItem(renderItem, args);
        var outputs = args.outputs;
        var outputResults = [];
        if (outputs && outputs.length) {
            for (var o = 0; o < outputs.length; o++) {
                if (o > 0) renderItem.outputModules.add();
                outputResults.push(aeConfigureOutputModule(renderItem, o + 1, outputs[o]));
            }
        } else {
            outputResults.push(aeConfigureOutputModule(renderItem, 1, {
                outputTemplate: args.outputTemplate,
                outputSettings: args.outputSettings,
                outputPath: args.outputPath,
                includeSourceXMP: args.includeSourceXMP,
                postRenderAction: args.postRenderAction
            }));
        }
        return {
            item: aeRenderItemSummary(renderItem, queue.numItems, args),
            changedProperties: renderChanges,
            outputs: outputResults
        };
    }
    if (args.action === "templates") {
        var temporary = false;
        var templateItem = null;
        if (queue.numItems > 0) templateItem = aeGetRenderQueueItem(args).item;
        else {
            templateItem = queue.items.add(aeGetComposition(args));
            temporary = true;
        }
        var templates = {
            renderSettings: templateItem.templates,
            outputModules: templateItem.outputModule(1).templates
        };
        if (temporary) templateItem.remove();
        return templates;
    }
    if (args.action === "queueInAME") {
        if (!queue.canQueueInAME) throw new Error("No queued render items are available for Adobe Media Encoder.");
        queue.queueInAME(args.renderImmediately === true);
        return { queuedInAME: true, renderImmediately: args.renderImmediately === true };
    }
    if (args.action === "show") {
        queue.showWindow(args.visible !== false);
        return { visible: args.visible !== false };
    }
    if (args.action === "render") {
        if (args.onlyIndices) {
            for (var q = 1; q <= queue.numItems; q++) {
                var shouldRender = false;
                for (var selected = 0; selected < args.onlyIndices.length; selected++) {
                    if (args.onlyIndices[selected] === q) { shouldRender = true; break; }
                }
                queue.item(q).render = shouldRender;
            }
        }
        queue.render();
        return aeRenderQueueSummary(args);
    }

    var itemResult = aeGetRenderQueueItem(args);
    var item = itemResult.item;
    var itemIndex = itemResult.index;
    if (args.action === "update") {
        var changes = aeConfigureRenderItem(item, args);
        return { item: aeRenderItemSummary(item, itemIndex, args), changedProperties: changes };
    }
    if (args.action === "duplicate") {
        var duplicate = item.duplicate();
        return { item: aeRenderItemSummary(duplicate, queue.numItems, args) };
    }
    if (args.action === "remove") {
        var removedComp = item.comp.name;
        item.remove();
        return { removed: removedComp, removedIndex: itemIndex, remaining: queue.numItems };
    }
    if (args.action === "addOutput") {
        item.outputModules.add();
        var addedIndex = item.numOutputModules;
        return aeConfigureOutputModule(item, addedIndex, args);
    }
    if (args.action === "getOutput") {
        return aeOutputModuleSummary(item, args.outputModuleIndex || 1, args);
    }
    if (args.action === "updateOutput") {
        return aeConfigureOutputModule(item, args.outputModuleIndex || 1, args);
    }
    if (args.action === "removeOutput") {
        var outputIndex = args.outputModuleIndex || 1;
        var removedOutput = item.outputModule(outputIndex).name;
        item.outputModule(outputIndex).remove();
        return { removed: removedOutput, removedIndex: outputIndex, remaining: item.numOutputModules };
    }
    if (args.action === "applyTemplate") {
        var kind = aeNormalizedEnumName(args.kind || "renderSettings");
        if (kind === "output" || kind === "outputmodule") {
            var outputModuleIndex = args.outputModuleIndex || 1;
            item.outputModule(outputModuleIndex).applyTemplate(args.name || args.template);
            return aeOutputModuleSummary(item, outputModuleIndex, args);
        }
        item.applyTemplate(args.name || args.template);
        return aeRenderItemSummary(item, itemIndex, args);
    }
    if (args.action === "saveTemplate") {
        var templateName = args.name;
        if (!templateName) throw new Error("Template name is required.");
        var templateKind = aeNormalizedEnumName(args.kind || "renderSettings");
        if (templateKind === "output" || templateKind === "outputmodule") {
            var templateOutputIndex = args.outputModuleIndex || 1;
            aeConfigureOutputModule(item, templateOutputIndex, args);
            var templateOutput = item.outputModule(templateOutputIndex);
            templateOutput.saveAsTemplate(templateName);
            return { saved: templateName, kind: "outputModule", templates: templateOutput.templates };
        }
        aeConfigureRenderItem(item, args);
        item.saveAsTemplate(templateName);
        return { saved: templateName, kind: "renderSettings", templates: item.templates };
    }
    throw new Error("Unsupported render action: " + args.action);
}

function aeProjectCommand(args) {
    if (args.action === "get") return aeInspect({ scope: "project", maxItems: args.maxItems });
    if (args.action === "media") return aeProjectMediaList(args);
    if (args.action === "getItem") return aeDetailedProjectItemSummary(aeGetProjectItem(args).item, args);
    if (args.action === "updateItem") {
        var updateResult = aeGetProjectItem(args);
        var updateItem = updateResult.item;
        var updateChanges = [];
        if (args.newName !== undefined) { updateItem.name = args.newName; updateChanges.push("name"); }
        if (args.comment !== undefined) { updateItem.comment = args.comment; updateChanges.push("comment"); }
        if (args.label !== undefined) { updateItem.label = args.label; updateChanges.push("label"); }
        if (args.selected !== undefined) { updateItem.selected = args.selected; updateChanges.push("selected"); }
        if (args.useProxy !== undefined) {
            if (!aeIsAVItem(updateItem)) throw new Error("useProxy requires a composition or footage item.");
            if (args.useProxy === true && !updateItem.proxySource) throw new Error("Project item has no proxy source to enable.");
            updateItem.useProxy = args.useProxy;
            updateChanges.push("useProxy");
        }
        if (args.moveToRoot === true) {
            updateItem.parentFolder = app.project.rootFolder;
            updateChanges.push("parentFolder");
        } else if (args.folderIndex !== undefined || args.folderId !== undefined || args.folderName) {
            updateItem.parentFolder = aeGetProjectFolder(args);
            updateChanges.push("parentFolder");
        }
        return { item: aeDetailedProjectItemSummary(updateItem, args), changedProperties: updateChanges };
    }
    if (args.action === "import") {
        var importSpecs = [];
        if (args.items) importSpecs = args.items;
        else if (args.paths) {
            for (var p = 0; p < args.paths.length; p++) {
                importSpecs.push(typeof args.paths[p] === "string" ? { path: args.paths[p] } : args.paths[p]);
            }
        } else importSpecs = [{ path: args.path }];
        var importedItems = [];
        for (var i = 0; i < importSpecs.length; i++) importedItems.push(aeImportOne(aeMergeObjects(args, importSpecs[i])));
        return { count: importedItems.length, items: importedItems };
    }
    if (args.action === "relink") {
        if (args.items && args.items.length) {
            var relinked = [];
            for (var relinkIndex = 0; relinkIndex < args.items.length; relinkIndex++) {
                var relinkArgs = aeMergeObjects(args, args.items[relinkIndex]);
                try {
                    relinked.push({ status: "success", data: aeRelinkProjectItem(relinkArgs) });
                } catch (relinkError) {
                    relinked.push({ status: "error", message: relinkError.toString(), selector: args.items[relinkIndex] });
                }
            }
            return { count: relinked.length, results: relinked };
        }
        return aeRelinkProjectItem(args);
    }
    if (args.action === "reload") {
        var reloadSpecs = [];
        if (args.items && args.items.length) reloadSpecs = args.items;
        else if (args.all === true) {
            for (var reloadProjectIndex = 1; reloadProjectIndex <= app.project.numItems; reloadProjectIndex++) {
                var reloadCandidate = app.project.item(reloadProjectIndex);
                if (reloadCandidate instanceof FootageItem && reloadCandidate.mainSource instanceof FileSource) {
                    reloadSpecs.push({ itemId: reloadCandidate.id });
                }
            }
        }
        if (reloadSpecs.length) {
            var reloaded = [];
            for (var reloadIndex = 0; reloadIndex < reloadSpecs.length; reloadIndex++) {
                try {
                    reloaded.push({ status: "success", data: aeReloadProjectItem(aeMergeObjects(args, reloadSpecs[reloadIndex])) });
                } catch (reloadError) {
                    reloaded.push({ status: "error", message: reloadError.toString(), selector: reloadSpecs[reloadIndex] });
                }
            }
            return { count: reloaded.length, results: reloaded };
        }
        return aeReloadProjectItem(args);
    }
    if (args.action === "interpret") {
        var interpretResult = aeGetProjectItem(args);
        var interpretation = aeApplyInterpretation(interpretResult.item, args);
        return { item: aeDetailedProjectItemSummary(interpretResult.item, args), changedProperties: interpretation.changedProperties, source: interpretation.source };
    }
    if (args.action === "proxy") return aeProxyProjectItem(args);
    if (args.action === "dependencies") return aeDependencyReport(args);
    if (args.action === "manifest") return aeProjectMediaManifest(args);
    if (args.action === "cleanup") return aeCleanupProject(args);
    if (args.action === "createFolder") {
        var folder = app.project.items.addFolder(args.name || "Folder");
        return { index: aeProjectItemIndex(folder), id: folder.id, name: folder.name };
    }
    if (args.action === "save") {
        if (args.path) app.project.save(new File(args.path));
        else app.project.save();
        return { path: app.project.file ? app.project.file.fsName : "" };
    }
    if (args.action === "queueRender") {
        var queued = aeRenderCommand(aeMergeObjects(args, { action: "add" }));
        if (args.renderNow) app.project.renderQueue.render();
        return queued;
    }
    throw new Error("Unsupported project action: " + args.action);
}

function aeFrameCommand(args) {
    var comp = aeGetComposition(args);
    if (args.action === "copy") {
        var commandId = app.findMenuCommandId("Copy Frame to Clipboard");
        if (!commandId) throw new Error("Copy Frame to Clipboard command was not found.");
        app.executeCommand(commandId);
        return { copiedToClipboard: true, time: comp.time, commandId: commandId };
    }
    if (args.action === "capture") {
        var captureFolder = new Folder(Folder.myDocuments.fsName + "/ae-mcp-bridge/captures");
        if (!captureFolder.exists) captureFolder.create();
        var time = args.time !== undefined ? args.time : comp.time;
        var safeName = comp.name.replace(/[\\\/:*?"<>|]/g, "_");
        var outputFile = args.outputPath ? new File(args.outputPath) : new File(captureFolder.fsName + "/" + safeName + "_" + Math.round(time * comp.frameRate) + ".png");
        comp.saveFrameToPng(time, outputFile);
        return { path: outputFile.fsName, time: time, frame: Math.round(time * comp.frameRate), composition: comp.name };
    }
    throw new Error("Unsupported frame action: " + args.action);
}

function aeCommand(args) {
    app.beginUndoGroup("After Effects MCP Command");
    try {
        var data = null;
        if (args.operation === "inspect") data = aeInspect(args);
        else if (args.operation === "property") data = aePropertyCommand(args);
        else if (args.operation === "keyframe") data = aeKeyframeCommand(args);
        else if (args.operation === "effect") data = aeEffectCommand(args);
        else if (args.operation === "mask") data = aeMaskCommand(args);
        else if (args.operation === "shape") data = aeShapeCommand(args);
        else if (args.operation === "text") data = aeTextCommand(args);
        else if (args.operation === "layer") data = aeLayerCommand(args);
        else if (args.operation === "composition") data = aeCompositionCommand(args);
        else if (args.operation === "project") data = aeProjectCommand(args);
        else if (args.operation === "render") data = aeRenderCommand(args);
        else if (args.operation === "frame") data = aeFrameCommand(args);
        else throw new Error("Unsupported operation: " + args.operation);
        return JSON.stringify({ status: "success", operation: args.operation, action: args.action, data: data });
    } catch (error) {
        return JSON.stringify({ status: "error", operation: args.operation, action: args.action, message: error.toString(), line: error.line || null });
    } finally {
        app.endUndoGroup();
    }
}

// Execute command
function executeCommand(command, args, commandId) {
    var result = "";

    logToPanel("Executing command: " + command);
    statusText.text = "Running: " + command;
    // Window has update(), but a docked ScriptUI Panel does not. Calling it
    // unconditionally aborts command execution after the bridge reads the
    // command file, leaving the MCP client waiting for a result.
    try {
        if (panel instanceof Window && panel.update) panel.update();
        else panel.layout.layout(true);
    } catch (_panelRefreshError) {}

    try {
        logToPanel("Attempting to execute: " + command); // Log before switch
        // Use a switch statement for clarity
        switch (command) {
            case "getProjectInfo":
                result = getProjectInfo();
                break;
            case "listCompositions":
                result = listCompositions();
                break;
            case "getLayerInfo":
                result = getLayerInfo();
                break;
            case "createComposition":
                logToPanel("Calling createComposition function...");
                result = createComposition(args);
                logToPanel("Returned from createComposition.");
                break;
            case "createTextLayer":
                logToPanel("Calling createTextLayer function...");
                result = createTextLayer(args);
                logToPanel("Returned from createTextLayer.");
                break;
            case "createShapeLayer":
                logToPanel("Calling createShapeLayer function...");
                result = createShapeLayer(args);
                logToPanel("Returned from createShapeLayer. Result type: " + typeof result);
                break;
            case "createSolidLayer":
                logToPanel("Calling createSolidLayer function...");
                result = createSolidLayer(args);
                logToPanel("Returned from createSolidLayer.");
                break;
            case "setLayerProperties":
                logToPanel("Calling setLayerProperties function...");
                result = setLayerProperties(args);
                logToPanel("Returned from setLayerProperties.");
                break;
            case "setLayerKeyframe":
                logToPanel("Calling setLayerKeyframe function...");
                result = setLayerKeyframe(args.compIndex, args.layerIndex, args.propertyName, args.timeInSeconds, args.value);
                logToPanel("Returned from setLayerKeyframe.");
                break;
            case "setLayerExpression":
                logToPanel("Calling setLayerExpression function...");
                result = setLayerExpression(args.compIndex, args.layerIndex, args.propertyName, args.expressionString);
                logToPanel("Returned from setLayerExpression.");
                break;
            case "applyEffect":
                logToPanel("Calling applyEffect function...");
                result = applyEffect(args);
                logToPanel("Returned from applyEffect.");
                break;
            case "applyEffectTemplate":
                logToPanel("Calling applyEffectTemplate function...");
                result = applyEffectTemplate(args);
                logToPanel("Returned from applyEffectTemplate.");
                break;
            case "bridgeTestEffects":
                logToPanel("Calling bridgeTestEffects function...");
                result = bridgeTestEffects(args);
                logToPanel("Returned from bridgeTestEffects.");
                break;
            case "createCamera":
                logToPanel("Calling createCamera function...");
                result = createCamera(args);
                logToPanel("Returned from createCamera.");
                break;
            case "batchSetLayerProperties":
                logToPanel("Calling batchSetLayerProperties function...");
                result = batchSetLayerProperties(args);
                logToPanel("Returned from batchSetLayerProperties.");
                break;
            case "setCompositionProperties":
                logToPanel("Calling setCompositionProperties function...");
                result = setCompositionProperties(args);
                logToPanel("Returned from setCompositionProperties.");
                break;
            case "duplicateLayer":
                logToPanel("Calling duplicateLayer function...");
                result = duplicateLayer(args);
                logToPanel("Returned from duplicateLayer.");
                break;
            case "deleteLayer":
                logToPanel("Calling deleteLayer function...");
                result = deleteLayer(args);
                logToPanel("Returned from deleteLayer.");
                break;
            case "setLayerMask":
                logToPanel("Calling setLayerMask function...");
                result = setLayerMask(args);
                logToPanel("Returned from setLayerMask.");
                break;
            case "createTextAnimator":
                logToPanel("Calling createTextAnimator function...");
                result = createTextAnimator(args);
                logToPanel("Returned from createTextAnimator.");
                break;
            case "aeCommand":
                logToPanel("Calling aeCommand function...");
                result = aeCommand(args);
                logToPanel("Returned from aeCommand.");
                break;
            default:
                result = JSON.stringify({ error: "Unknown command: " + command });
        }
        logToPanel("Execution finished for: " + command); // Log after switch
        
        // Save the result (ensure result is always a string)
        logToPanel("Preparing to write result file...");
        var resultString = (typeof result === 'string') ? result : JSON.stringify(result);
        
        // Try to parse the result as JSON to add a timestamp
        try {
            var resultObj = JSON.parse(resultString);
            // Add a timestamp to help identify if we're getting fresh results
            resultObj._responseTimestamp = (new Date()).getTime();
            resultObj._commandExecuted = command;
            resultObj._commandId = commandId || null;
            resultString = JSON.stringify(resultObj, null, 2);
            logToPanel("Added timestamp to result JSON for tracking freshness.");
        } catch (parseError) {
            // If it's not valid JSON, append the timestamp as a comment
            logToPanel("Could not parse result as JSON to add timestamp: " + parseError.toString());
            // We'll still continue with the original string
        }
        
        var resultFile = new File(getResultFilePath());
        resultFile.encoding = "UTF-8"; // Ensure UTF-8 encoding
        logToPanel("Opening result file for writing...");
        var opened = resultFile.open("w");
        if (!opened) {
            logToPanel("ERROR: Failed to open result file for writing: " + resultFile.fsName);
            throw new Error("Failed to open result file for writing.");
        }
        logToPanel("Writing to result file...");
        var written = resultFile.write(resultString);
        if (!written) {
             logToPanel("ERROR: Failed to write to result file (write returned false): " + resultFile.fsName);
             // Still try to close, but log the error
        }
        logToPanel("Closing result file...");
        var closed = resultFile.close();
         if (!closed) {
             logToPanel("ERROR: Failed to close result file: " + resultFile.fsName);
             // Continue, but log the error
        }
        logToPanel("Result file write process complete.");
        
        logToPanel("Command completed successfully: " + command); // Changed log message
        statusText.text = "Command completed: " + command;
        
        // Update command file status
        logToPanel("Updating command status to completed...");
        updateCommandStatus("completed", commandId);
        logToPanel("Command status updated.");
        
    } catch (error) {
        var errorMsg = "ERROR in executeCommand for '" + command + "': " + error.toString() + (error.line ? " (line: " + error.line + ")" : "");
        logToPanel(errorMsg); // Log detailed error
        statusText.text = "Error: " + error.toString();
        
        // Write detailed error to result file
        try {
            logToPanel("Attempting to write ERROR to result file...");
            var errorResult = JSON.stringify({ 
                status: "error", 
                command: command,
                _commandId: commandId || null,
                message: error.toString(),
                line: error.line,
                fileName: error.fileName
            });
            var errorFile = new File(getResultFilePath());
            errorFile.encoding = "UTF-8";
            if (errorFile.open("w")) {
                errorFile.write(errorResult);
                errorFile.close();
                logToPanel("Successfully wrote ERROR to result file.");
            } else {
                 logToPanel("CRITICAL ERROR: Failed to open result file to write error!");
            }
        } catch (writeError) {
             logToPanel("CRITICAL ERROR: Failed to write error to result file: " + writeError.toString());
        }
        
        // Update command file status even after error
        logToPanel("Updating command status to error...");
        updateCommandStatus("error", commandId);
        logToPanel("Command status updated to error.");
    }
}

// Update command file status
function updateCommandStatus(status, commandId) {
    try {
        var commandFile = new File(getCommandFilePath());
        if (commandFile.exists) {
            commandFile.open("r");
            var content = commandFile.read();
            commandFile.close();
            
            if (content) {
                var commandData = JSON.parse(content);
                if (commandId && commandData.id && commandData.id !== commandId) {
                    logToPanel("Skipped status update for a newer queued command.");
                    return;
                }
                commandData.status = status;
                
                commandFile.open("w");
                commandFile.write(JSON.stringify(commandData, null, 2));
                commandFile.close();
            }
        }
    } catch (e) {
        logToPanel("Error updating command status: " + e.toString());
    }
}

// Log message to panel
function logToPanel(message) {
    var timestamp = new Date().toLocaleTimeString();
    logText.text = timestamp + ": " + message + "\n" + logText.text;
}

// Check for new commands
function checkForCommands() {
    writeBridgeHeartbeat(autoRunCheckbox.value ? "ready" : "paused");
    if (!autoRunCheckbox.value || isChecking) return;
    
    isChecking = true;
    
    try {
        var commandFile = new File(getCommandFilePath());
        if (commandFile.exists) {
            commandFile.open("r");
            var content = commandFile.read();
            commandFile.close();
            
            if (content) {
                var commandData = (typeof JSON !== "undefined" && JSON.parse)
                    ? JSON.parse(content)
                    : eval("(" + content + ")");
                
                // Only execute pending commands
                if (commandData.status === "pending") {
                    lastBridgeCommand = commandData.command || "unknown";
                    // Update status to running
                    updateCommandStatus("running", commandData.id);
                    
                    // Execute the command
                    executeCommand(commandData.command, commandData.args || {}, commandData.id);
                }
            }
        }
    } catch (e) {
        logToPanel("Error checking for commands: " + e.toString());
    }
    
    isChecking = false;
    writeBridgeHeartbeat("ready");
}

// Set up timer to check for commands
function startCommandChecker() {
    try {
        if ($.global.__aeMcpBridgeCommandTaskId) {
            try { app.cancelTask($.global.__aeMcpBridgeCommandTaskId); } catch (_cancelOldTaskError) {}
        }
        $.global.__aeMcpBridgeTick = function () {
            try { checkForCommands(); }
            catch (error) {
                isChecking = false;
                logToPanel("Bridge timer error: " + error.toString());
                writeBridgeHeartbeat("error");
            }
        };
        $.global.__aeMcpBridgeCommandTaskId = app.scheduleTask("$.global.__aeMcpBridgeTick()", checkInterval, true);
        checkForCommands();
    } catch (error) {
        logToPanel("Unable to start bridge timer: " + error.toString());
        writeBridgeHeartbeat("error");
    }
}

// Add manual check button
var checkButton = bridgeTab.add("button", undefined, "Check for Commands Now");
checkButton.onClick = function() {
    logToPanel("Manually checking for commands");
    checkForCommands();
};

// Log startup
logToPanel("MCP Bridge Auto started");
logToPanel("Command file: " + getCommandFilePath());
statusText.text = "Ready - Auto-run is " + (autoRunCheckbox.value ? "ON" : "OFF");

// Start the command checker
startCommandChecker();

panel.onResizing = panel.onResize = function() {
    this.layout.resize();
    try {
        var compactChat = this.size && this.size.height < 430;
        chatPrompt.preferredSize.height = compactChat ? 46 : 72;
        if (lastChatState) renderChatTranscript(lastChatState.transcript || []);
    } catch (_chatResizeError) {}
};

// A host-provided ScriptUI Panel is already visible through the Window menu.
// A directly executed script still opens as a resizable floating palette.
if (panel instanceof Window) {
    panel.center();
    panel.show();
} else {
    panel.layout.layout(true);
}

