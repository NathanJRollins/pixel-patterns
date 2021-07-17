/*****************************************************
Todo:
	Have not touched any of this since long before AI came about.  Feed it through ChatGPT for criticism/advice/improvement.
	add "inspired in part by" attribution for that one girl's pattern app?  tho wasn't really... idea from old windows, then looked hers up
		any ideas borrowed from hers?
	Optimising displayPanel painting logic @ ~350.
	Store the pattern at the least as localStorage, not a cookie and NOT sessionStorage (probably store all? All but consent cookie maybe?).
		Allows storing much larger patterns/data not sent with every page load.
		We currently have errors if stored is too large, + it's improper/inefficient, too ephemeral, and fundamentally limited.

non-eye-catchy pattern for unusable background so as to not distract eye whether light or dark?
	Set pattern as repeating css background for whole page?  Super simple UI this way.
		Whole full-page can be naught but the current pattern, an entire tiling background of the result viewable in real-time at ultimate 1px/px scale (scale w/selected scale instead?).
	BG black, white, gray, ??  - Probably grey smaller-square-textured!  It's a recognizable standard.  Apply to both sides' BGs.
	see how other pro img editors do it
	just black?  with gray border outline?

	Extrapolate out functions to ID pixel color, XXX, XXX (a few great candidates, things repeated, used in future extensions)
	Make "Clear" button louder and maybe require confirmation (turn it red w/"CONFIRM?" text or something so user can just click that loc x2 after short CD, returning to normal if not clicked after a sec)
	Indicator for odd vs even dimensions on sliders?  Odd allows repeated patterns to more seamlessly blend.
	Drawn transparency type toggle switch.  Put color+alpha in the clicked cell VS blend old item at cell location with new color, according to currently selected alpha value.  Transparency for blending, once an opaque cell is there!
	If toggle default settings (stretch input, etc.) will it update prog state accordingly?
	Secondary color on RMB, or delete/clear on RMB?
	Dropper sampling tool.
	Download BG of it as preset size (detect browser's/screen's maxsize as one of them) + custom input size (+zoomfactor)
	Make cross-browser universal (& phone? no RMB, hold instead?  Maybe a toggle eraser button)
	Prettify UI + Maybe have simple interface, & fill the BG with their current in-progress pattern, to see it cascaded on a large scale?
		Will need to optimise first.  Currently is not efficient.  Many ways to achieve this.
	Documentation (+ readme.md)  (it's /** + enter !!) (comm.s say why, not how, when preferable)
	Settings button/menu to further adjust min/max parameters, etc.
	Sharpen display - pattern should appear pixel-perfectly - ensure 100% size + no interpolation
	Will a simple CSS repeating BG for the display element automate it?  Can do slower high-dimension rendering method for saving img.s.
	Do we like this "click with same color to delete cell" function?  Maybe RMB dragging to delete to transparency?  If not, RMB for alt. color, allowing 100% trans as option?
		Bear in mind that using a phone will affect this.  We can code for phone case separately if we like one/other.
	Randomization functionality (maybe using neat algorithms for bias toward cool/repeatable patterns - maybe reflect about axes for seamlessness)
		Firefox plugin to display new patterns on each about:blank new tab?
			Can link the projects together - allowing edit of which pattern appears
	Create patterns more efficiently - repeat, then repeat that result, etc. so it scales time-logarithmically rather than exponentially.
	Retain what existed before when dimensions shrink, rather than tossing away?
	Better favicon.  + https://realfavicongenerator.net/
		Make favicon their in-progress image once begun
	Save/load patterns (start with slot buttons which just save the array, then can later implement slot img previewing)
	URL w/param encoding current pattern/settings for sharing state via savable URL
	Perhaps put all settings (except immediately/frequently needed, like selected color) hidden beneath a gear button.
	Remove commented-out log lines.
	Remove all of this TODO nonsense which doesn't belong here.

(Maybe)
	Basic tools (line, bucket [fun algorithm!], dropper, etc.)
		If do "line from A to B" line-draw tool+algorithm, can use it during a drag to always detect+hit cells in between last location and current click location! Maybe thinner drag interp (cell intersection) than the nice fat line algorithm though.
	Preset/example patterns (+ a default, or random default?)
	Undo/redo (just naively save entire array state on each END DRAG.  Check RAM use when large history, compress if it's bad.)
	Proper attractive color sliders (consistent picker + alpha integration) (Maybe consistent is bad)
		Maybe have x previously selected colors - or just use system color picker which does this if sufficient.
	Check out viability of drag-drawing on phones. Maybe fatter lines when pressure higher?
	Upload-a-bitmap functionality?
	Static-scaling input where it repeats the pattern & user can just click anywhere there on-page to add to that part of pattern?  Simple modulo op. impl.
		Maybe a full-page version of this?  Whole new project or toggleable option?  Simple pattern, make bmp, set as tiling css BG?  New tab behavior?
	Optional interpolation or AA on output image?

*******************************************************/

"use strict";

function toggleInputPanelAspectRatioLock() {
	drawPanelDimensionsChanged();
	saveState();
}

/** Bitmap of currently drawn pixel colors.  2D array. */
let drawnPixels;

function drawPanelDimensionsChanged() {
	setDrawPanelDimensions(
		document.getElementById("draw-range-width").value,
		document.getElementById("draw-range-height").value
	);
}

function setDrawPanelDimensions(x, y) {
	document.getElementById("draw-range-width").value = +x;
	document.getElementById("draw-range-height").value = +y;
	initializeDrawnPixelArray("rgba(0,0,0,0)", true);
	saveState();
}


/**
 * Initializes a new 2-dimensional array of pixel color values.
 * @param {string} defaultColor Default color to initialize new array values to.
 * @param {boolean} keepPreviousDrawnPixels If true, will retain previous pixel array values where possible.
 */
function initializeDrawnPixelArray(defaultColor = "rgba(0,0,0,0)", keepPreviousDrawnPixels = false) {
	// Save old drawn pixels if we'll be re-drawing them.
	if (keepPreviousDrawnPixels && drawnPixels)
		var oldDrawnPixels = drawnPixels;

	// Initialize new pixel array, clearing all pixels.
	const desiredNumOfColumns = +document.getElementById("draw-range-width").value;
	const desiredNumOfRows = +document.getElementById("draw-range-height").value;
	drawnPixels = [];
	for (let x = 0; x < desiredNumOfColumns; x++)
		drawnPixels.push( new Array(parseInt(desiredNumOfRows)).fill(defaultColor) );

	// Re-draw previously-drawn pixels if requested.
	//   (For the pixels which we're able, given the new pattern's dimensions)
	if (keepPreviousDrawnPixels && oldDrawnPixels)
		// For each pixel in the pattern (given the requested dimensions)...
		for (let x = 0; x < desiredNumOfColumns; x++)
			for (let y = 0; y < desiredNumOfRows; y++)
				// If the dimensions make sense and we have a saved color value for this pixel...
				if ((drawnPixels.length > x) && (oldDrawnPixels.length > x) && (oldDrawnPixels[x] != null))
					if ((drawnPixels[x].length > y) && (oldDrawnPixels[x].length > y) && (oldDrawnPixels[x][y] != null))
						// Place the old pixel color in this location within the new pixel color array.
						drawnPixels[x][y] = oldDrawnPixels[x][y];

	// Re-paint displays.
	drawDrawingPanel();
	drawDisplayPanel();
}


// Disable right-click context menu on drawing panel (so we may utilize RMB).
document.getElementById("drawing-panel").addEventListener("contextmenu", event => event.preventDefault());
// Draw cell when clicked.
document.getElementById("drawing-panel").addEventListener("mousedown", function(e) {
	cellClicked(e, true);
});
// Draw all cells crossed while LMB is held down.
document.getElementById("drawing-panel").addEventListener("mousemove", function(e) {
	if ((e.buttons & 1) === 1)
		cellClicked(e);
});
// When LMB is released, stop recording cursor location as a stroke.
document.addEventListener("mouseup", event => cellsHitSoFar = null);


// Enable mouse drag-drawing.
let cellsHitSoFar; // 2D matrix tracking this drag.
let thisDragIsDrawing; // as opposed to erasing (erasing if color of first cell in drag == selected color)
/**
 * Marks a cell as selected.
 * @param {event} e The relevant click event.
 * @param {boolean} firstCellClicked Signifies if this is the first cell in a new (possibly multi-cell) dragging motion.  If so, the existing color at this cell will determine whether this drag draws or erases the existing color.
 */
function cellClicked(e, firstCellClicked = false) {
	const desiredNumOfColumns = +document.getElementById("draw-range-width").value;
	const desiredNumOfRows = +document.getElementById("draw-range-height").value;

	// Helper function to activate individual pixels (called one at a time).
	function triggerPixel(x, y) {
		// Draw pixel in data structure, or clear if already present here.
		const drawingColor = getRgbaFormattedCurrentColor();
		const cellIsAlreadyThisColor = (drawnPixels[x][y] === drawingColor);
		// Set this entire mouse drag to draw/erase based on the first cell.
		if (firstCellClicked || dragBeganOffscreen)
			thisDragIsDrawing = !cellIsAlreadyThisColor;
		// Draw/erase the pixel
		drawnPixels[x][y] = thisDragIsDrawing ? drawingColor : "rgba(0,0,0,0)";
		drawDrawingPanel();
		drawDisplayPanel();

		saveState();
	}

	const dragBeganOffscreen = (cellsHitSoFar == null);
	// If this is the first cell clicked for this drag, initialize the 2D array of so-far-affected cells.
	if (firstCellClicked || dragBeganOffscreen) {
		cellsHitSoFar = [];
		for (let x = 0; x < desiredNumOfColumns; x++)
			cellsHitSoFar.push( new Array(parseInt(desiredNumOfRows)).fill(false) );
	}

	let canvas = document.getElementById("drawing-panel");
	const boundingRect = document.getElementById("drawing-panel").getBoundingClientRect();
	const canvasWidth = boundingRect.right - boundingRect.left;
	const canvasHeight = boundingRect.bottom - boundingRect.top;

	/** Location clicked (in pixels) within drawing panel. */
	const clickedLoc = {
		x: e.clientX - boundingRect.left,
		y: e.clientY - boundingRect.top
	};

	// Determine and mark which cell we've hit.
	let pixelScaledXLoc;
	let pixelScaledYLoc;
	if (document.getElementById("cell-scale-type").checked) {
		// Determine which cell was clicked, accounting for stretching.
		pixelScaledXLoc = Math.floor((desiredNumOfColumns * clickedLoc.x) / canvasWidth);
		pixelScaledYLoc = Math.floor((desiredNumOfRows    * clickedLoc.y) / canvasHeight);
	}
	else {
		// We're keeping a 1:1 aspect ratio.  Determine which cell was clicked, accounting for padding.
		// Determine number of cells of padding required to make things square.
		const cellsOfPaddingRequiredPerSide = Math.abs(desiredNumOfColumns - desiredNumOfRows) / 2.0;
		const xPadPerSideInCells = ((desiredNumOfColumns < desiredNumOfRows) ? cellsOfPaddingRequiredPerSide : 0);
		const yPadPerSideInCells = ((desiredNumOfColumns > desiredNumOfRows) ? cellsOfPaddingRequiredPerSide : 0);
		// Determine pixel dimensions of cells + padding, given input dimensions and canvas size.
		let drawingAreaHeight = canvas.height;
		let drawingAreaWidth = canvas.width;
		const aspectRatio = (desiredNumOfColumns * 1.0) / desiredNumOfRows;
		if (aspectRatio > 1)
			drawingAreaHeight = canvas.height * 1.0 / aspectRatio;
		else
			drawingAreaWidth = canvas.width * aspectRatio;
		const cellWidthInPx = (drawingAreaWidth * 1.0) / desiredNumOfColumns;
		const cellHeightInPx = (drawingAreaHeight * 1.0) / desiredNumOfRows;
		const xPadPerSideInPx = xPadPerSideInCells * cellWidthInPx;
		const yPadPerSideInPx = yPadPerSideInCells * cellHeightInPx;
		// Determine which cell was clicked, accounting for padding.
		pixelScaledXLoc = Math.floor((clickedLoc.x - xPadPerSideInPx) / cellWidthInPx);
		pixelScaledYLoc = Math.floor((clickedLoc.y - yPadPerSideInPx) / cellHeightInPx);
	}  // end else (1:1 aspect ratio)

	// Mark this cell if this mouse drag hasn't done so already.
	if ((pixelScaledXLoc < desiredNumOfColumns) && (pixelScaledXLoc >= 0) && 
			(pixelScaledYLoc < desiredNumOfRows) && (pixelScaledYLoc >= 0)) // bounds check
		if (!cellsHitSoFar[pixelScaledXLoc][pixelScaledYLoc]) {
			cellsHitSoFar[pixelScaledXLoc][pixelScaledYLoc] = true;
			triggerPixel(pixelScaledXLoc, pixelScaledYLoc);
		}
} // end cellClicked()


/** Draws the input panel to the screen. */
function drawDrawingPanel() {
	let canvas = document.getElementById("drawing-panel");
	const boundingRect = canvas.getBoundingClientRect();
	const desiredNumOfColumns = +document.getElementById("draw-range-width").value;
	const desiredNumOfRows = +document.getElementById("draw-range-height").value;

	// Set dimensions
	const displayWidth  = boundingRect.right - boundingRect.left-2;
	const displayHeight = boundingRect.bottom - boundingRect.top-2;
	canvas.width  = displayWidth;
	canvas.height = displayHeight;

	// Get cell size and padding amount depending on aspect ratio ?stretching? setting.
	let cellWidthInPx;
	let cellHeightInPx;
	let xPadPerSideInPx = 0;
	let yPadPerSideInPx = 0;
	if (document.getElementById("cell-scale-type").checked) {  // Don't pad.  Stretch.
		cellWidthInPx  = displayWidth / desiredNumOfColumns;
		cellHeightInPx = displayHeight / desiredNumOfRows;
	}
	else {  // Pad to preserve 1:1 aspect.
		// Determine number of cells of padding required to make things square.
		const cellsOfPaddingRequiredPerSide = Math.abs(desiredNumOfColumns - desiredNumOfRows) / 2.0;
		const xPadPerSideInCells = ((desiredNumOfColumns < desiredNumOfRows) ? cellsOfPaddingRequiredPerSide : 0);
		const yPadPerSideInCells = ((desiredNumOfColumns > desiredNumOfRows) ? cellsOfPaddingRequiredPerSide : 0);

		// Determine pixel dimensions of cells + padding, given input dimensions and canvas size.
		let drawingAreaHeight = canvas.height;
		let drawingAreaWidth = canvas.width;
		const aspectRatio = (desiredNumOfColumns * 1.0) / desiredNumOfRows;
		if (aspectRatio > 1)
			drawingAreaHeight = canvas.height * 1.0 / aspectRatio;
		else
			drawingAreaWidth = canvas.width * aspectRatio;

		cellWidthInPx = (drawingAreaWidth * 1.0) / desiredNumOfColumns;
		cellHeightInPx = (drawingAreaHeight * 1.0) / desiredNumOfRows;
		xPadPerSideInPx = xPadPerSideInCells * cellWidthInPx;
		yPadPerSideInPx = yPadPerSideInCells * cellHeightInPx;
	} // end else (pad aspect ratio)

	// Draw pixels
	let ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.imageSmoothingEnabled = false;
	ctx.translate(0.5,0.5); // for smoothing those lines to pixel perfection
	ctx.lineWidth = 1;
	for (let y = 0; y < desiredNumOfRows; y++)
		for (let x = 0; x < desiredNumOfColumns; x++) {
			ctx.fillStyle = drawnPixels[x][y];
			ctx.fillRect(
				xPadPerSideInPx + (x)*cellWidthInPx,
				yPadPerSideInPx + (y)*cellHeightInPx,
				cellWidthInPx,
				cellHeightInPx);
		}

	// Draw gridlines
	ctx.strokeStyle = "#80808044";
	for (let y = 0; y <= desiredNumOfRows; y++) {
		// Draw horizontals
		ctx.beginPath();
		ctx.moveTo(
			Math.round(xPadPerSideInPx),
			Math.round(yPadPerSideInPx + (y)*cellHeightInPx));
		ctx.lineTo(
			Math.round(displayWidth-xPadPerSideInPx),
			Math.round(yPadPerSideInPx + (y)*cellHeightInPx));
		ctx.stroke();
	}
	for (let x = 0; x <= desiredNumOfColumns; x++) {
		// Draw verticals
		ctx.beginPath();
		ctx.moveTo(
			Math.round(xPadPerSideInPx + (x)*cellWidthInPx),
			Math.round(yPadPerSideInPx));
		ctx.lineTo(
			Math.round(xPadPerSideInPx + (x)*cellWidthInPx),
			Math.round(displayHeight-yPadPerSideInPx));
		ctx.stroke();
	}

	// Draw border around whole drawable area.
	ctx.strokeStyle = "#000000FF";
	ctx.stroke
	ctx.strokeRect(
		Math.round(xPadPerSideInPx),
		Math.round(yPadPerSideInPx),
		Math.round(displayWidth  - 2*xPadPerSideInPx),
		Math.round(displayHeight - 2*yPadPerSideInPx));
}


function drawDisplayPanel() {
	// XXX: Optimise this.
	//   It's per-pixel, but we can just repeat the pattern itself once it's in as imagedata.
	//   Maybe get values in simple 2D array, then paint simply out from there?  Easier/quicker than a canvas.
	//   Maybe repeat each pixel in base pattern at each eventual location in the full-size pattern, so we only iterate through each px in base pattern once.
	//   Maybe store 1 entire pattern in a bitmap type object, then paint those on it over and over 'til @ limit. Consider composing a new bitmap each time for logarithmic scaling to any size.
	//     ^ once this method is functional, can use that logic to make larger bitmaps & scale up. 2x2.
	//     ^ once this works, crop a DIMxDIMpx favicon from it & set as page's favicon.
	//   (This isn't an original problem - just look up ideal alg.s - consider cacheline locality)
	const desiredNumOfColumns = document.getElementById("draw-range-width").value;
	const desiredNumOfRows = document.getElementById("draw-range-height").value;
	let canvas = document.getElementById("display-panel");
	let ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	// Set dimensions
	const boundingRect = canvas.getBoundingClientRect();
	const displayWidth = boundingRect.right - boundingRect.left - 2;
	const displayHeight = boundingRect.bottom - boundingRect.top - 2;
	canvas.width = displayWidth;
	canvas.height = displayHeight;

	// Draw
	const zoomLevel = +document.getElementById("zoom-level").value;
	for (let y = 0; y < displayHeight/zoomLevel; y++) {
		for (let x = 0; x < displayWidth/zoomLevel; x++) {
			ctx.fillStyle = drawnPixels[x%desiredNumOfColumns][y%desiredNumOfRows];
			ctx.fillRect(
				zoomLevel*x,
				zoomLevel*y,
				zoomLevel,
				zoomLevel);
		}
	}

	// /**
	//  * Takes a pattern as input and returns a larger object of this pattern repeated (2x in both dimensions).
	//  * @param {*} inputPattern 
	//  */
	// function duplicatePattern(inputPattern) {
	// 	// REPEAT PATTERN SO IT'S 2X IN BOTH DIMENSIONS
	// 	return outputPattern;
	// }
	// // ! ! ! ! ! ! ! ! ! ! ! ! ! ! ! ! ! ! ! ! PAINT PATTERN TO TEXTURE OBJECT
	// let patternBitmap;
	// for ( ; patternBitmap.width < displayWidth/zoomLevel; patternBitmap = duplicatePattern(patternBitmap))
	// 	for ( ; patternBitmap.height < displayHeight/zoomLevel; patternBitmap = duplicatePattern(patternBitmap))
	// 		{}
	// // PRINT BITMAP TO PANEL (WELL, THE PORTION OF BITMAP OF PANEL SIZE)
	// //   ZOOM IT ACCORDINGLY

} // end drawDisplayPanel()


function clearPanel() {
	initializeDrawnPixelArray();
	saveState();
}


function fillPanel() {
	initializeDrawnPixelArray(getRgbaFormattedCurrentColor());
	saveState();
}


function getRgbaFormattedCurrentColor() {
	// Split hex value from color input into an object with RGBA components
	const chosenColor = document.getElementById("chosen-color").value.toString(16);
	const splitColor = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(chosenColor);
	const colorObject = {
		r: parseInt(splitColor[1], 16),
		g: parseInt(splitColor[2], 16),
		b: parseInt(splitColor[3], 16),
		a: document.getElementById("chosen-alpha").valueAsNumber
	};
	// Convert that object into the desired formatted string
	const formattedString = `rgba(${colorObject.r},${colorObject.g},${colorObject.b},${colorObject.a})`;
	return formattedString;
}


// Change color display's opacity, since the color chooser doesn't implement transparency by default
function updateColorDisplayOpacity() {
	document.getElementById("chosen-color").style.opacity = document.getElementById("chosen-alpha").valueAsNumber;
	saveState();
}


function zoomChanged() {
	drawDisplayPanel();
	saveState();
}


/**
 * Set cookie with 1 year duration.
 */
function setCookie(name, value) {
	document.cookie = name + "=" + (value || "") + "; Max-Age=31536000; path=/; SameSite=Strict; Secure";
}
/**
 * Gets a cookie.
 * src: https://www.w3schools.com/js/js_cookies.asp
 * @param {*} cname Cookie name.
 * @returns Cookie's string value.
 */
 function getCookie(cname) {
  const name = cname + "=";
  const decodedCookie = decodeURIComponent(document.cookie);
  const ca = decodedCookie.split(';');
  for (let i = 0; i <ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return c.substring(name.length, c.length);
    }
  }
  return "";
}
function deleteCookie(name) {   
	document.cookie = name +'=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Strict; Secure';
}

function toggleShouldSaveState(e) {
	if (e.checked) {
		setCookie("should_save", "yes");
		saveState();
	}
	else {
		deleteCookie("should_save");
		deleteCookie("num_columns");
		deleteCookie("num_rows");
		deleteCookie("zoom_level");
		deleteCookie("stretch_input");
		deleteCookie("pattern");
		deleteCookie("chosen_color");
		deleteCookie("chosen_alpha");
	}
}

/** @returns {boolean} Whether or not the program is configured to be saving data locally. */
function isSaving() {
	return (getCookie("should_save") === "yes");
}

/**
 * Stores program state for a future session.
 * Will not attempt to if the required setting is not present.
 */
function saveState() {
	if (!isSaving())
		return;
	// Input pattern.
	setCookie("pattern", JSON.stringify(drawnPixels));
	// Input dimensions.
	setCookie("num_columns", document.getElementById("draw-range-width").value);
	setCookie("num_rows",    document.getElementById("draw-range-height").value);
	// Zoom level.
	setCookie("zoom_level", +document.getElementById("zoom-level").value);
	// Input panel scaling type.
	setCookie("stretch_input", document.getElementById("cell-scale-type").checked.toString());
	// Current color + alpha.
	setCookie("chosen_color", document.getElementById("chosen-color").value);
	setCookie("chosen_alpha", document.getElementById("chosen-alpha").value);
}

/**
 * Restores program state from that saved by a previous session.
 * Will not attempt to if the required cookie is not present.
 */
function loadState() {
	if (!isSaving())
		return;
	document.getElementById("save-state").checked = true;
	// Input pattern.
	if (getCookie("pattern") !== "")
	drawnPixels = JSON.parse(getCookie("pattern"));
	// Input panel dimensions.
	if ((getCookie("num_columns") !== "") && (getCookie("num_rows") !== "")) {
		document.getElementById("draw-range-width").value  = +getCookie("num_columns");
		document.getElementById("draw-range-height").value = +getCookie("num_rows");
	}
	// Zoom level.
	if (getCookie("zoom_level") !== "")
		document.getElementById("zoom-level").value = +getCookie("zoom_level");
	// Input panel scaling type.
	if (getCookie("stretch_input") !== "")
		document.getElementById("cell-scale-type").checked = (getCookie("stretch_input") === "true");
	// Current color + alpha.
	if (getCookie("chosen_color") !== "")
		document.getElementById("chosen-color").value = getCookie("chosen_color");
	if (getCookie("chosen_alpha") !== "")
		document.getElementById("chosen-alpha").value = getCookie("chosen_alpha");
}
loadState();  // fails if no directive to be saving in first place


// Trigger once to initialize slider values & display.
drawPanelDimensionsChanged();
updateColorDisplayOpacity();
zoomChanged();