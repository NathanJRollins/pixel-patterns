/*****************************************************
Todo:
	Pattern display zoom slider (more easily view patterns on more pixel-dense displays)
	Drag to draw/erase
	Download as preset size (detect browser's as one of them) or custom input size
	URL to current pattern
	Save/load patterns
	Optimise (primarily pattern-repeating part of code)
	Prettify UI
	Sell soul to documentation devil (+ readme.md)
	Settings button/menu to further adjust min/max parameters, etc.
	Sharpen display - pattern should appear pixel-perfectly

(Maybe)
	Basic tools (line, bucket, dropper, etc.)
	Preset/example patterns
	Undo/redo (eh)

*******************************************************/

var desiredNumOfColumns;
var desiredNumOfRows;
var drawnPixels;
var zoomLevel = 1;

function drawPanelDimensionsChanged() {
  setDrawPanelDimensions(
    document.getElementById("draw-range-width").value,
    document.getElementById("draw-range-height").value
	);
}

function setDrawPanelDimensions(x, y) {
  desiredNumOfColumns = x;
	desiredNumOfRows = y;
  initializeDrawnPixelArray();
}

function initializeDrawnPixelArray(defaultColor = "rgba(0,0,0,0)") {
	drawnPixels = Array();
  for (var x = 0; x < desiredNumOfColumns; x++)
		drawnPixels[x] = Array(parseInt(desiredNumOfRows)).fill(defaultColor);
	// clear old displays
	drawDrawingPanel();
	drawDisplayPanel();
}

// Register click listener on drawing panel
document.getElementById("drawing-panel").addEventListener("click", function(e) {
  var boundingRect = document.getElementById("drawing-panel").getBoundingClientRect();
  var canvasWidth = boundingRect.right - boundingRect.left;
	var canvasHeight = boundingRect.bottom - boundingRect.top;
	
  // Get location clicked within drawing panel
  var clickedLoc = {
    x: e.clientX - boundingRect.left,
    y: e.clientY - boundingRect.top
	};
  var pixelScaledXLoc = Math.floor((desiredNumOfColumns * clickedLoc.x) / canvasWidth);
	var pixelScaledYLoc = Math.floor((desiredNumOfRows * clickedLoc.y) / canvasHeight);
	
  drawPixel(pixelScaledXLoc, pixelScaledYLoc);
});

function drawPixel(x, y) {
	// Draw pixel in data structure, or clear if already present here
	var thisColor = getRgbaFormattedCurrentColor()
	drawnPixels[x][y] = (drawnPixels[x][y] == thisColor ? "rgba(0,0,0,0)" : thisColor);
	drawDrawingPanel();
	drawDisplayPanel();
}

function drawDrawingPanel() {
	var canvas = document.getElementById("drawing-panel");
	var boundingRect = canvas.getBoundingClientRect();
	var displayWidth = boundingRect.right - boundingRect.left-2;
	var displayHeight = boundingRect.bottom - boundingRect.top-2;
	canvas.width = displayWidth;
	canvas.height = displayHeight;
	var cellWidth  = displayWidth / desiredNumOfColumns;
	var cellHeight = displayHeight / desiredNumOfRows;

	var ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.imageSmoothingEnabled = false;
	ctx.translate(0.5,0.5); // for smoothing those lines to pixel perfection
	ctx.lineWidth = 1;

	// Draw pixels
	for (var y = 0; y < desiredNumOfRows; y++)
		for (var x = 0; x < desiredNumOfColumns; x++) {
			ctx.fillStyle = drawnPixels[x][y];
			ctx.fillRect(x*cellWidth, y*cellHeight, cellWidth, cellHeight);
		}

	// Draw gridlines
	ctx.strokeStyle = "#80808044";
	for (var y = 1; y < desiredNumOfRows; y++) {
		// Draw horizontals
		ctx.beginPath();
		ctx.moveTo(0,            Math.round(y*cellHeight));
		ctx.lineTo(displayWidth, Math.round(y*cellHeight));
		ctx.stroke();
	}
	for (var x = 1; x < desiredNumOfColumns; x++) {
		// Draw verticals
		ctx.beginPath();
		ctx.moveTo(Math.round(x*cellWidth), 0);
		ctx.lineTo(Math.round(x*cellWidth), displayHeight);
		ctx.stroke();
	}
}

function drawDisplayPanel() {	
	// XXX: Optimise this.
	// It's per-pixel, but we can just repeat the pattern itself once it's in as imagedata
	var canvas = document.getElementById("display-panel");
	var ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	var boundingRect = canvas.getBoundingClientRect();
	var displayWidth = boundingRect.right - boundingRect.left - 2;
	var displayHeight = boundingRect.bottom - boundingRect.top - 2;
	canvas.width = displayWidth;
	canvas.height = displayHeight;

	for ( var y = 0; y < displayHeight/zoomLevel; y++ ) {
		for ( var x = 0; x < displayWidth/zoomLevel; x++ ) {
			ctx.fillStyle = drawnPixels[x%desiredNumOfColumns][y%desiredNumOfRows];
			ctx.fillRect(zoomLevel*x, zoomLevel*y, zoomLevel, zoomLevel);
		}
	}
}

function clearPanel() {
	initializeDrawnPixelArray();
}

function fillPanel() {
	initializeDrawnPixelArray(getRgbaFormattedCurrentColor());
}

function getRgbaFormattedCurrentColor() {
	// split hex value from color input into an object with RGBA components
	var chosenColor = document.getElementById("chosen-color").value.toString(16);
	var splitColor = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(chosenColor);
	var colorObject = {
		r: parseInt(splitColor[1], 16),
		g: parseInt(splitColor[2], 16),
		b: parseInt(splitColor[3], 16),
		a: document.getElementById("chosen-alpha").valueAsNumber
	};
	// Convert that object into the desired formatted string
	var formattedString = `rgba(${colorObject.r},${colorObject.g},${colorObject.b},${colorObject.a})`;
	return formattedString;
}

// Change color display's opacity, since the color chooser doesn't implement transparency by default
function updateColorDisplayOpacity() {
	document.getElementById("chosen-color").style.opacity = document.getElementById("chosen-alpha").valueAsNumber;
}

function zoomChanged() {
	zoomLevel = document.getElementById("zoom-level").valueAsNumber;
	drawDisplayPanel();
}

// Trigger once to initalize slider values & display
drawPanelDimensionsChanged();
updateColorDisplayOpacity();
zoomChanged();