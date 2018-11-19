/*****************************************************
Todo:
	Color & opacity (sliders for now)
	Drag to draw/erase
	Download as preset size (detect browser's as one of them) or custom input size
	Sharpen display - pattern should appear pixel-perfectly
	URL to current pattern
	Prettify UI

(Maybe)
	Preset patterns
	Save/load patterns
	Undo/redo (eh)
	Sell soul to documentation devil (+ readme.md)

*******************************************************/

var desiredPixelWidth;
var desiredPixelHeight;
var drawnPixels;

function drawPanelDimensionsChanged() {
  setDrawPanelDimensions(
    document.getElementById("draw-range-width").value,
    document.getElementById("draw-range-height").value
	);
}

function setDrawPanelDimensions(x, y) {
  desiredPixelWidth = x;
	desiredPixelHeight = y;
	
	var canvas = document.getElementById("drawing-panel");
	var boundingRect = document.getElementById("drawing-panel").getBoundingClientRect();
	var calculatedPixelWidth = (boundingRect.right - boundingRect.left);
	var calculatedPixelHeight = (boundingRect.bottom - boundingRect.top);
	canvas.width = calculatedPixelWidth;
	canvas.height = calculatedPixelHeight;

  initializeDrawnPixelArray();
}

function initializeDrawnPixelArray() {
	drawnPixels = Array();
  for (var x = 0; x < desiredPixelWidth; x++)
		drawnPixels[x] = Array(parseInt(desiredPixelHeight)).fill(0);
	// clear old displays
	drawDrawingPanel();
	drawDisplayPanel();
}

// Register click listener on drawing panel
document.getElementById("drawing-panel").addEventListener("click", function(e) {
  // Get location clicked within drawing panel
  var boundingRect = document.getElementById("drawing-panel").getBoundingClientRect();
  var clickedLoc = {
    x: e.clientX - boundingRect.left,
    y: e.clientY - boundingRect.top
  };
  var canvasWidth = boundingRect.right - boundingRect.left;
  var canvasHeight = boundingRect.bottom - boundingRect.top;

  var pixelScaledXLoc = Math.floor((desiredPixelWidth * clickedLoc.x) / canvasWidth);
	var pixelScaledYLoc = Math.floor((desiredPixelHeight * clickedLoc.y) / canvasHeight);
	
  drawPixel(pixelScaledXLoc, pixelScaledYLoc);
});

function drawPixel(x, y) {
	// Toggle pixel in data structure
	drawnPixels[x][y] = (drawnPixels[x][y] == 1) ? 0 : 1;
	drawDrawingPanel();
	drawDisplayPanel();
}

function drawDrawingPanel() {
	var boundingRect = document.getElementById("drawing-panel").getBoundingClientRect();
	var widthPerPixel = (boundingRect.right - boundingRect.left)/desiredPixelWidth;
	var heightPerPixel = (boundingRect.bottom - boundingRect.top)/desiredPixelHeight;
	
	var canvas = document.getElementById("drawing-panel");
  var ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	// ctx.imageSmoothingEnabled = false;
	ctx.lineWidth = 1;
	ctx.fillStyle = "rgba(0,0,0,255)";

	// Draw pixels
	for (var y = 0; y < desiredPixelHeight; y++)
		for (var x = 0; x < desiredPixelWidth; x++) {
			if (drawnPixels[x][y] == 1)
			ctx.fillRect(x*widthPerPixel, y*heightPerPixel, widthPerPixel, heightPerPixel);
		}

	// Draw grid lines
	ctx.strokeStyle = "#e0e0f844";
	for (var y = 1; y < desiredPixelHeight; y++) {
		ctx.beginPath();
		ctx.moveTo(0, y*heightPerPixel);
		ctx.lineTo(desiredPixelWidth*widthPerPixel, y*heightPerPixel);
		ctx.stroke(); 
		for (var x = 1; x < desiredPixelWidth; x++) {
			ctx.beginPath();
			ctx.moveTo(x*widthPerPixel, 0);
			ctx.lineTo(x*widthPerPixel, desiredPixelHeight*heightPerPixel);
			ctx.stroke(); 
		}
	}
}

function drawDisplayPanel() {
	// XXX: Optimise this.
	// It's per-pixel, but we can just repeat the pattern itself once it's in as imagedata
	var canvas = document.getElementById("display-panel");
	var ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = "rgba(0,0,0,255)";

	var boundingRect = canvas.getBoundingClientRect();
	var displayWidth = boundingRect.right - boundingRect.left;
	var displayHeight = boundingRect.bottom - boundingRect.top;

	for ( var y = 0; y < displayHeight; y++ ) {
		for ( var x = 0; x < displayWidth; x++ ) {
			if ( (drawnPixels[x%desiredPixelWidth][y%desiredPixelHeight]  ) == 1) {
				ctx.fillRect( x, y, 1, 1 );
			}
		}
	}
}

function clearPanel() {
	initializeDrawnPixelArray();
}

// Trigger once to initalize
drawPanelDimensionsChanged();