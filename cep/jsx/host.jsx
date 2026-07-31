// Host-side helpers for the dockable CEP chat panel.

function aeMcpChatEnsureFolder(folder) {
    if (folder.exists) return true;
    if (folder.parent && !folder.parent.exists) aeMcpChatEnsureFolder(folder.parent);
    return folder.create();
}

function aeMcpChatStartCompanion() {
    try {
        var candidates = [];
        try {
            var extensionRoot = new File($.fileName).parent.parent;
            candidates.push(new File(extensionRoot.fsName + "/bin/after-effects-codex-chat.exe"));
        } catch (_extensionPathError) {}
        candidates.push(new File(Folder.userData.fsName + "/AfterEffectsMCP/after-effects-codex-chat.exe"));
        candidates.push(new File(Folder.myDocuments.fsName + "/ae-mcp-bridge/bin/after-effects-codex-chat.exe"));
        for (var i = 0; i < candidates.length; i++) {
            if (!candidates[i].exists) continue;
            var launcher = new File(candidates[i].parent.fsName + "/launch-chat.vbs");
            if (!launcher.exists) continue;
            var launched = launcher.execute();
            return JSON.stringify({ ok: launched === true, path: candidates[i].fsName, launcher: launcher.fsName });
        }
        return JSON.stringify({ ok: false, error: "The Codex companion or its hidden launcher is not installed." });
    } catch (error) {
        return JSON.stringify({ ok: false, error: error.toString() });
    }
}

function aeMcpChatGetContext() {
    try {
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
                pixelAspect: item.pixelAspect,
                frameRate: item.frameRate,
                duration: item.duration,
                workAreaStart: item.workAreaStart,
                workAreaDuration: item.workAreaDuration
            };
            context.time = item.time;
            var selected = item.selectedLayers;
            for (var i = 0; i < selected.length; i++) {
                var layerInfo = {
                    name: selected[i].name,
                    index: selected[i].index,
                    threeDLayer: selected[i].threeDLayer,
                    selectedProperties: []
                };
                try {
                    var properties = selected[i].selectedProperties;
                    for (var p = 0; p < properties.length; p++) {
                        layerInfo.selectedProperties.push({ name: properties[p].name, matchName: properties[p].matchName });
                    }
                } catch (_propertyError) {}
                context.selectedLayers.push(layerInfo);
            }
        }
        return JSON.stringify(context);
    } catch (error) {
        return JSON.stringify({ error: error.toString() });
    }
}

function aeMcpChatCaptureViewer(outputPath) {
    try {
        var comp = app.project ? app.project.activeItem : null;
        if (!(comp && comp instanceof CompItem)) {
            return JSON.stringify({ ok: false, error: "No active composition to attach." });
        }
        var attachmentFolder = new Folder(Folder.myDocuments.fsName + "/ae-mcp-bridge/codex-chat/attachments");
        aeMcpChatEnsureFolder(attachmentFolder);
        var safeName = comp.name.replace(/[\\\/:*?"<>|]/g, "_");
        var output = outputPath ? new File(outputPath) : new File(attachmentFolder.fsName + "/viewer-" + safeName + "-" + String((new Date()).getTime()) + ".png");
        comp.saveFrameToPng(comp.time, output);
        // AE 2026 can return from saveFrameToPng just before the PNG becomes
        // visible to CEP. The panel polls this unique path until it is complete.
        return JSON.stringify({ ok: true, path: output.fsName, ready: output.exists, label: "Composition Viewer" });
    } catch (error) {
        return JSON.stringify({ ok: false, error: "Viewer capture failed: " + error.toString() });
    }
}
