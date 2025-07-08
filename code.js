// --- Constants ---
const UI_WIDTH = 400;
const UI_HEIGHT = 560; // Increased height for new UI elements

// --- Client Storage Keys ---
const PREFERENCES_KEY = 'imageExtractorUserPrefs_v1'; // Added versioning to key

// --- Helper Function to Traverse Nodes ---
function traverseNodes(nodes, callback) {
    for (const node of nodes) {
        callback(node);
        if ("children" in node && Array.isArray(node.children)) {
            traverseNodes(node.children, callback);
        }
    }
}

// --- Helper Function to Extract Data (Main Feature - Comprehensive) ---
async function extractNodeData(node) {
  if (!node) return null;
  const data = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation || 0,
    opacity: (node.opacity !== null && node.opacity !== undefined) ? node.opacity : 1,
    visible: (node.visible !== null && node.visible !== undefined) ? node.visible : true,
    constraints: node.constraints ? {
      horizontal: node.constraints.horizontal,
      vertical: node.constraints.vertical
    } : null,
  };
  if (typeof node.cornerRadius === 'number') {
    data.cornerRadius = node.cornerRadius;
  } else if (node.cornerRadius && typeof node.cornerRadius !== 'symbol' && node.type !== 'TEXT') {
    data.topLeftRadius = node.topLeftRadius || 0;
    data.topRightRadius = node.topRightRadius || 0;
    data.bottomLeftRadius = node.bottomLeftRadius || 0;
    data.bottomRightRadius = node.bottomRightRadius || 0;
  }
  if ('fills' in node && Array.isArray(node.fills) && node.fills !== figma.mixed && node.fills.length > 0) {
    data.fills = node.fills.filter(fill => fill.visible !== false).map(fill => ({
      type: fill.type,
      color: fill.color ? { r: fill.color.r, g: fill.color.g, b: fill.color.b } : null,
      opacity: (fill.opacity !== null && fill.opacity !== undefined) ? fill.opacity : 1,
      imageHash: fill.type === 'IMAGE' ? fill.imageHash : undefined,
    }));
  } else if ('fills' in node && node.fills === figma.mixed) {
    data.fills = "Mixed";
  }
  if ('strokes' in node && Array.isArray(node.strokes) && node.strokes !== figma.mixed && node.strokes.length > 0) {
    data.strokes = node.strokes.filter(stroke => stroke.visible !== false).map(stroke => ({
      type: stroke.type,
      color: stroke.color ? { r: stroke.color.r, g: stroke.color.g, b: stroke.color.b } : null,
      opacity: (stroke.opacity !== null && stroke.opacity !== undefined) ? stroke.opacity : 1,
    }));
    data.strokeWeight = node.strokeWeight === figma.mixed ? "Mixed" : (node.strokeWeight || 0);
  } else if ('strokes' in node && node.strokes === figma.mixed) {
    data.strokes = "Mixed";
    data.strokeWeight = "Mixed";
  }
  if ('effects' in node && Array.isArray(node.effects) && node.effects.length > 0) {
    data.effects = node.effects.filter(effect => effect.visible !== false).map(effect => ({
      type: effect.type,
      radius: effect.radius,
      color: effect.color ? { r: effect.color.r, g: effect.color.g, b: effect.color.b, a: effect.color.a } : null,
      offset: effect.offset,
      spread: effect.spread
    }));
  }
  if (node.type === 'TEXT') {
    data.characters = node.characters;
    data.fontSize = node.fontSize === figma.mixed ? "Mixed" : node.fontSize;
    if (node.fontName !== figma.mixed && node.fontName) {
      try {
        await figma.loadFontAsync(node.fontName);
        data.fontName = { family: node.fontName.family, style: node.fontName.style };
      } catch(e){
        data.fontName = "Error loading";
      }
    } else {
      data.fontName = "Mixed";
    }
  }
  if ('layoutMode' in node && node.layoutMode !== "NONE") {
    data.layoutMode = node.layoutMode;
    data.itemSpacing = node.itemSpacing || 0;
  }
  if (node.type === 'INSTANCE' && 'getMainComponentAsync' in node) {
    try {
      const mainComp = await node.getMainComponentAsync();
      if(mainComp) data.mainComponent = {name: mainComp.name, id: mainComp.id };
    } catch(e){
      data.mainComponent = "Error";
    }
  }
  if ('children' in node && Array.isArray(node.children)) {
    const childPromises = node.children.map(child => extractNodeData(child));
    data.children = (await Promise.all(childPromises)).filter(Boolean);
  }
  return data;
}


// --- NEW/MODIFIED ASSET EXTRACTION HELPER FUNCTIONS ---

/**
 * Finds nodes within the parentNode that contain visible image fills and are exportable.
 * @param {SceneNode} parentNode The node to start searching from.
 */
async function findNodesWithImageFills(parentNode) {
    console.log(`[ImageFinder] Scanning '${parentNode.name}' (ID: ${parentNode.id}) for nodes with image fills...`);
    figma.ui.postMessage({ type: 'info', message: `Scanning '${parentNode.name}' for images...` });

    const nodesWithImages = [];
    const visitedNodeIds = new Set();

    traverseNodes([parentNode], (node) => {
        if (!node || visitedNodeIds.has(node.id)) {
            return;
        }
        visitedNodeIds.add(node.id);

        let isEffectivelyVisible = node.visible !== false; // Default to true if visible is undefined
        if (node !== parentNode) {
            let tempParent = node.parent;
            let allParentsVisible = true;
            while (tempParent && tempParent.type !== 'DOCUMENT' && tempParent.type !== 'PAGE') {
                 if (tempParent.visible === false) { // Explicitly check for false
                    allParentsVisible = false;
                    break;
                }
                if (tempParent === parentNode.parent) break; // Stop if we go above the originally selected node's parent
                tempParent = tempParent.parent;
            }
            isEffectivelyVisible = (node.visible !== false) && allParentsVisible;
        } else {
             isEffectivelyVisible = parentNode.visible !== false; // For the top selected node
        }


        if (!isEffectivelyVisible) {
            // console.log(`[ImageFinder] Skipping invisible node: ${node.name} (ID: ${node.id})`);
            return;
        }

        if ('fills' in node && node.fills && node.fills !== figma.mixed && Array.isArray(node.fills)) {
            const hasVisibleImageFill = node.fills.some(fill =>
                fill && fill.type === 'IMAGE' && (fill.visible !== false) && fill.imageHash
            );

            if (hasVisibleImageFill) {
                // Check if node is exportable
                if ('exportAsync' in node && typeof node.exportAsync === 'function') {
                    const safeName = (node.name || 'UnnamedNode')
                        .replace(/[^\w\s\-\.]/g, '_') // Allow word chars, whitespace, hyphen, dot. Replace others.
                        .replace(/\s+/g, '_') // Replace whitespace with underscore
                        .replace(/\.+$/, ''); // Trim trailing dots
                    nodesWithImages.push({
                        nodeId: node.id,
                        nodeName: safeName || `ImageNode_${node.id.replace(/[:|,]/g, '_')}`
                    });
                    console.log(`[ImageFinder] Found exportable node with image fill: ${node.name} (ID: ${node.id})`);
                } else {
                    console.log(`[ImageFinder] Node ${node.name} (ID: ${node.id}, Type: ${node.type}) has image fill but is not exportable.`);
                }
            }
        }
    });

    console.log(`[ImageFinder] Found ${nodesWithImages.length} exportable nodes with image fills.`);
    if (nodesWithImages.length > 0) {
        figma.ui.postMessage({
            type: 'nodes-with-images-found',
            data: nodesWithImages
        });
    } else {
        figma.ui.postMessage({
            type: 'info',
            message: 'No exportable nodes with visible image fills found in the selection.'
        });
    }
}


/**
 * Exports a given node as an image in the specified format.
 * @param {object} msg The message from the UI.
 * @param {string} msg.nodeId The ID of the node to export.
 * @param {string} msg.fileName The desired file name for the exported image.
 * @param {'PNG' | 'JPG' | 'SVG' | 'PDF'} msg.format The desired export format.
 * @param {number} [msg.quality] Optional JPEG quality (1-100).
 */
async function exportNodeAsImage(msg) {
    const { nodeId, fileName, format, quality } = msg;

    if (!nodeId || !fileName || !format) {
        figma.ui.postMessage({ type: 'error', message: 'Missing nodeId, fileName, or format for image export.' });
        return;
    }
    console.log(`[ImageExporter] Request to export node ID ${nodeId} as ${fileName} (Format: ${format})`);

    try {
        // ******** THIS IS THE FIX ********
        const node = await figma.getNodeByIdAsync(nodeId);
        // *******************************

        if (!node) {
            throw new Error(`Node with ID ${nodeId} not found.`);
        }
        if (!('exportAsync' in node) || typeof node.exportAsync !== 'function') {
            throw new Error(`Node type ${node.type} (Name: ${node.name}) is not exportable.`);
        }

        /** @type {ExportSettingsImage | ExportSettingsJPG | ExportSettingsPDF | ExportSettingsSVG} */
        let exportSettings = { format: format.toUpperCase() };

        if (format.toUpperCase() === 'JPG') {
             /** @type {ExportSettingsJPG} */
            (exportSettings).quality = Math.max(1, Math.min(100, quality || 80));
        }

        if (format.toUpperCase() === 'PNG' || format.toUpperCase() === 'JPG') {
             /** @type {ExportSettingsImage} */
            (exportSettings).contentsOnly = true;
        }

        const bytes = await node.exportAsync(exportSettings);

        if (!bytes || bytes.length === 0) {
            throw new Error(`ExportAsync returned empty data for ${fileName}. Node: ${node.name}`);
        }

        console.log(`[ImageExporter] Successfully exported ${bytes.length} bytes for ${fileName}`);
        figma.ui.postMessage({
            type: 'image-bytes-ready',
            bytes: bytes,
            fileName: fileName,
            format: format.toUpperCase() // Pass format back for MIME type determination in UI
        });

    } catch (error) {
        console.error(`[ImageExporter] Error exporting node ${nodeId} ('${fileName}'):`, error);
        figma.ui.postMessage({
            type: 'error',
            message: `Could not export image '${fileName}': ${error.message}`
        });
    }
}

// --- OTHER ASSET EXTRACTION FUNCTIONS ---
async function extractAndSendTexts(parentNode) {
    const texts = [];
    traverseNodes([parentNode], (node) => {
        if (node.type === 'TEXT' && node.characters) {
            if ((node.visible !== false) || node === parentNode) {
                 texts.push({ name: node.name || "UnnamedText", content: node.characters });
            }
        }
    });
    if (texts.length > 0) {
        figma.ui.postMessage({ type: 'assets-extracted', assetType: 'texts', data: texts });
    } else {
        figma.ui.postMessage({ type: 'info', message: 'No visible text elements found in the selection.' });
    }
}

async function extractAndSendSVGs(parentNode, assetTypeName) {
    const svgs = [];
    if (!parentNode || (parentNode.visible === false && parentNode.type !== 'COMPONENT' && parentNode.type !== 'FRAME')) {
         figma.ui.postMessage({ type: 'info', message: `Selected node for ${assetTypeName} is not visible or suitable.` });
         return;
    }
    if (parentNode.type === 'TEXT' && (assetTypeName === 'icons' || assetTypeName === 'shapes')) {
         figma.ui.postMessage({ type: 'info', message: `Text nodes are not typically exported as ${assetTypeName}.` });
         return;
    }
    try {
        const svgBytes = await parentNode.exportAsync({ format: 'SVG', svgOutlineText: true, svgIdAttribute: true, svgSimplifyStroke: false });
        if (svgBytes && svgBytes.length > 0) {
            svgs.push({ name: `${(parentNode.name || 'untitled').replace(/[^a-z0-9_\-.]/gi, '_')}.svg`, data: svgBytes });
        } else { throw new Error("Export returned empty data."); }
    } catch (e) {
        console.error(`SVG Export Error: ${parentNode.name}: ${e.message}`, e);
        figma.ui.postMessage({ type: 'error', message: `SVG Export Failed for '${parentNode.name}': ${e.message}` });
        return;
    }
    if (svgs.length > 0) {
        figma.ui.postMessage({ type: 'assets-extracted', assetType: assetTypeName, data: svgs });
    } else {
        figma.ui.postMessage({ type: 'info', message: `Could not generate SVG for the selected ${assetTypeName}.` });
    }
}

async function extractAndSendFonts(parentNode) {
    const fontSet = new Set();
    const fonts = [];
    await (async function loadAndFindFontsRecursive(node) {
        if (!node || (node.visible === false && node !== parentNode)) return;
        if (node.type === 'TEXT') {
            if (node.fontName !== figma.mixed && node.fontName) {
                try { await figma.loadFontAsync(node.fontName); const key = `${node.fontName.family}|${node.fontName.style}`; if (!fontSet.has(key)) { fontSet.add(key); fonts.push({ family: node.fontName.family, style: node.fontName.style, sourceNode: node.name }); } } catch(e) {}
            } else if (node.fontName === figma.mixed) { const segments = node.getStyledTextSegments(['fontName']); for (const seg of segments) { if (seg.fontName) { try { await figma.loadFontAsync(seg.fontName); const key = `${seg.fontName.family}|${seg.fontName.style}`; if (!fontSet.has(key)) { fontSet.add(key); fonts.push({ family: seg.fontName.family, style: seg.fontName.style, sourceNode: `${node.name} (segment)` }); } } catch(e) {} } } }
        }
        if ('children' in node && Array.isArray(node.children)) { for (const child of node.children) { await loadAndFindFontsRecursive(child); } }
    })(parentNode);
    if (fonts.length > 0) { figma.ui.postMessage({ type: 'assets-extracted', assetType: 'fonts', data: fonts }); } else { figma.ui.postMessage({ type: 'info', message: 'No unique fonts found.' }); }
}

async function extractAndSendColors(parentNode) {
    const colorSet = new Set(); const extractedColors = [];
    function rgbToHex(r, g, b) { const compToHex = c => Math.max(0, Math.min(255, Math.round(c*255))).toString(16).padStart(2,'0'); return `#${compToHex(r)}${compToHex(g)}${compToHex(b)}`; }
    traverseNodes([parentNode], (node) => {
        if (node.visible === false && node !== parentNode) return;
        const process = (paints, type) => { if (paints && paints !== figma.mixed && Array.isArray(paints)) { paints.forEach(p => { if (p.visible !== false && p.type === 'SOLID' && p.color) { const hex = rgbToHex(p.color.r, p.color.g, p.color.b); const op = p.opacity === undefined ? 1 : p.opacity; const key = `${hex}|${op.toFixed(3)}|${type}|${node.id}`; if (!colorSet.has(key)) { colorSet.add(key); extractedColors.push({ hex, rgb: p.color, opacity: op, type, sourceNode: node.name || `Unnamed ${node.type}` }); } } }); } };
        if ('fills' in node) process(node.fills, 'fill'); if ('strokes' in node) process(node.strokes, 'stroke');
        if ('effects' in node && Array.isArray(node.effects)) { node.effects.forEach(ef => { if (ef.visible !== false && ef.color && (ef.type === 'DROP_SHADOW' || ef.type === 'INNER_SHADOW')) { const hex = rgbToHex(ef.color.r, ef.color.g, ef.color.b); const op = ef.color.a; const key = `${hex}|${op.toFixed(3)}|effect-${ef.type}|${node.id}`; if (!colorSet.has(key)) { colorSet.add(key); extractedColors.push({ hex, rgb: ef.color, opacity: op, type: `effect (${ef.type.toLowerCase().replace(/_/g, ' ')})`, sourceNode: node.name || `Unnamed ${node.type}` }); } } }); }
    });
    if (extractedColors.length > 0) { figma.ui.postMessage({ type: 'assets-extracted', assetType: 'colors', data: extractedColors }); } else { figma.ui.postMessage({ type: 'info', message: 'No distinct solid colors found.' }); }
}


// --- Plugin Main Logic ---
figma.showUI(__html__, { width: UI_WIDTH, height: UI_HEIGHT, title: "Fast Track Code Extractor" });

figma.ui.onmessage = async msg => {
    const selection = figma.currentPage.selection;

    if (msg.type === 'get-preferences') {
        try {
            const prefs = await figma.clientStorage.getAsync(PREFERENCES_KEY);
            figma.ui.postMessage({ type: 'preferences-loaded', data: prefs || {} });
        } catch (e) {
            console.error("Error loading preferences:", e);
            figma.ui.postMessage({ type: 'preferences-loaded', data: {} });
        }
        return;
    }
    if (msg.type === 'save-preferences') {
        try {
            await figma.clientStorage.setAsync(PREFERENCES_KEY, msg.data);
            figma.ui.postMessage({ type: 'preferences-saved', message: 'Preferences saved!' });
        } catch (e) {
            console.error("Error saving preferences:", e);
            figma.ui.postMessage({ type: 'error', message: 'Failed to save preferences.' });
        }
        return;
    }

    if (msg.type === 'extract-data') {
        if (selection.length === 0) { figma.ui.postMessage({ type: 'error', message: 'Please select an element for general data extraction.' }); return; }
        if (selection.length > 1) { figma.ui.postMessage({ type: 'error', message: 'Please select only one element for general data extraction.' }); return; }
        try {
            const selectedNode = selection[0];
            figma.ui.postMessage({ type: 'info', message: `Extracting general data for '${selectedNode.name}'...` });
            const extractedData = await extractNodeData(selectedNode);
            if (extractedData) {
                const jsonDataString = JSON.stringify(extractedData, null, 2);
                figma.ui.postMessage({ type: 'display-data', data: jsonDataString });
            } else {
                figma.ui.postMessage({ type: 'error', message: 'Could not extract data from the selected element.' });
            }
        } catch (error) {
            console.error("Main Extraction Error:", error);
            figma.ui.postMessage({ type: 'error', message: `Data Extraction Error: ${error.message}. Check Figma console.` });
        }
    } else if (msg.type === 'extract-specific-asset') {
        if (selection.length === 0) {
            figma.ui.postMessage({ type: 'error', message: 'Please select an element to extract assets from.' });
            return;
        }
        const selectedNode = selection[0]; // For most assets, we operate on the first selected node.
                                        // Image extraction (findNodesWithImageFills) will traverse its children if it's a container.
        const assetType = msg.assetType;

        try {
            switch (assetType) {
                case 'images':
                    await findNodesWithImageFills(selectedNode);
                    break;
                case 'texts': await extractAndSendTexts(selectedNode); break;
                case 'icons': case 'shapes': await extractAndSendSVGs(selectedNode, assetType); break;
                case 'fonts': await extractAndSendFonts(selectedNode); break;
                case 'colors': await extractAndSendColors(selectedNode); break;
                default:
                    figma.ui.postMessage({ type: 'error', message: `Unknown asset type: ${assetType}` });
            }
        } catch (error) {
            console.error(`Error extracting ${assetType} for node ${selectedNode.name}:`, error);
            figma.ui.postMessage({ type: 'error', message: `Error extracting ${assetType}: ${error.message}. Check Figma console.` });
        }
    } else if (msg.type === 'export-node-as-image') {
        await exportNodeAsImage(msg);
    }
};

figma.on("selectionchange", () => {
    const selectionCount = figma.currentPage.selection.length;
    if (selectionCount === 0) {
        figma.ui.postMessage({ type: 'no-selection' });
    } else {
        figma.ui.postMessage({ type: 'selection-available', count: selectionCount });
    }
});