/**
 * ImageEditor
 * - Select / Erase: Mouse (brush), Drag (rect), Draw (polygon + Confirm)
 * - Crop: 4 cạnh kéo được
 * - Brush preview (xám) theo Selection size
 */
class ImageEditor {
  constructor(options = {}) {
    this.previewBox = null;
    this.fileNameEl = null;

    this.image = null;          // HTMLImageElement (có thể là ảnh đã crop)
    this.originalImage = null;  // ảnh gốc chưa crop
    this.canvas = null;
    this.ctx = null;

    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.aspectRatio = 1;

    this.widthMm = 0;
    this.heightMm = 0;

    this.cellLevel = 1;
    this.cellSizeMm = 10;
    this.gridInfo = null;

    // key "col,row" -> difficulty
    this.selectedCells = new Map();

    this.currentTool = 'select'; // select | erase | crop
    this.currentDifficulty = 'very-easy';
    this.selectMode = 'mouse';   // mouse | drag | draw
    this.brushSize = 1;
    this.frameScale = 50;

    // Interaction state
    this.isPointerDown = false;
    this.hoverCell = null;

    // Drag-rect
    this.dragStart = null;      // {x,y} canvas px
    this.dragCurrent = null;

    // Draw path
    this.drawPath = [];         // [{x,y}, ...] canvas px
    this.isDrawing = false;

    // Crop
    this.cropRect = null;       // {x,y,w,h} normalized 0-1 relative to image
    this.cropDragging = null;   // 'left'|'right'|'top'|'bottom'|null
    this.cropStartPos = null;

    this.onSelectionChange = options.onSelectionChange || function () {};
    this.onImageLoaded = options.onImageLoaded || function () {};
    this.onDimensionsChange = options.onDimensionsChange || function () {};
    this.onGridChange = options.onGridChange || function () {};

    this.diffColors = {
      'very-easy': 'rgba(34, 197, 94, 0.45)',
      'easy':      'rgba(59, 130, 246, 0.45)',
      'medium':    'rgba(234, 179, 8, 0.45)',
      'hard':      'rgba(249, 115, 22, 0.45)',
      'very-hard': 'rgba(239, 68, 68, 0.45)',
    };
  }

  init(dom) {
    this.previewBox = dom.previewBox;
    this.fileNameEl = dom.fileNameEl;
  }

  // ========================
  // Load image
  // ========================
  loadImage(file) {
    if (!file || !file.type.startsWith('image/')) {
      alert('Vui lòng chọn file ảnh hợp lệ.');
      return;
    }
    var reader = new FileReader();
    var self = this;
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        self.originalImage = img;
        self.image = img;
        self.naturalWidth = img.naturalWidth;
        self.naturalHeight = img.naturalHeight;
        self.aspectRatio = img.naturalWidth / img.naturalHeight;
        self.widthMm = 0;
        self.heightMm = 0;
        self.gridInfo = null;
        self.selectedCells.clear();
        self.cropRect = { x: 0, y: 0, w: 1, h: 1 };
        self.drawPath = [];
        self.dragStart = null;
        self.dragCurrent = null;
        self.applyFrameSize();
        self.renderPreview();
        self.onImageLoaded({
          name: file.name,
          width: img.naturalWidth,
          height: img.naturalHeight,
          aspectRatio: self.aspectRatio,
        });
      };
      img.onerror = function () {
        alert('Không thể tải ảnh. Vui lòng thử file khác.');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // ========================
  // Dimensions
  // ========================
  setWidthMm(widthMm) {
    widthMm = parseFloat(widthMm);
    if (!widthMm || widthMm <= 0 || !this.image) {
      this.widthMm = 0;
      this.heightMm = 0;
      this.gridInfo = null;
      this.selectedCells.clear();
      this.onDimensionsChange({ widthMm: 0, heightMm: 0 });
      this.renderPreview();
      this._emitSelection();
      return;
    }
    this.widthMm = widthMm;
    this.heightMm = +(widthMm / this.aspectRatio).toFixed(2);
    this.onDimensionsChange({ widthMm: this.widthMm, heightMm: this.heightMm });
    this.buildGrid();
    this.renderPreview();
  }

  setHeightMm(heightMm) {
    heightMm = parseFloat(heightMm);
    if (!heightMm || heightMm <= 0 || !this.image) {
      this.widthMm = 0;
      this.heightMm = 0;
      this.gridInfo = null;
      this.selectedCells.clear();
      this.onDimensionsChange({ widthMm: 0, heightMm: 0 });
      this.renderPreview();
      this._emitSelection();
      return;
    }
    this.heightMm = heightMm;
    this.widthMm = +(heightMm * this.aspectRatio).toFixed(2);
    this.onDimensionsChange({ widthMm: this.widthMm, heightMm: this.heightMm });
    this.buildGrid();
    this.renderPreview();
  }

  setCellLevel(level) {
    level = parseInt(level, 10) || 1;
    if ([1, 2, 4, 8].indexOf(level) === -1) level = 1;
    this.cellLevel = level;
    this.cellSizeMm = 10 / level;
    this.selectedCells.clear();
    if (this.widthMm > 0 && this.heightMm > 0) {
      this.buildGrid();
      this.renderPreview();
      this._emitSelection();
    }
  }

  setCellSize(v) {
    if ([1, 2, 4, 8].indexOf(+v) !== -1) this.setCellLevel(+v);
  }

  // ========================
  // Grid
  // ========================
  buildGrid() {
    if (!this.widthMm || !this.heightMm || this.widthMm <= 0 || this.heightMm <= 0) {
      this.gridInfo = null;
      this.onGridChange(null);
      return;
    }
    var cellMm = this.cellSizeMm;
    var w = this.widthMm;
    var h = this.heightMm;
    var colsFull = Math.floor(w / cellMm);
    var rowsFull = Math.floor(h / cellMm);
    var remMmX = +(w - colsFull * cellMm).toFixed(4);
    var remMmY = +(h - rowsFull * cellMm).toFixed(4);
    if (remMmX < 0.001) remMmX = 0;
    if (remMmY < 0.001) remMmY = 0;
    var hasRemX = remMmX > 0;
    var hasRemY = remMmY > 0;
    var totalCols = colsFull + (hasRemX ? 1 : 0);
    var totalRows = rowsFull + (hasRemY ? 1 : 0);

    var cells = [];
    for (var r = 0; r < totalRows; r++) {
      var row = [];
      for (var c = 0; c < totalCols; c++) {
        var isEdgeX = hasRemX && c === totalCols - 1;
        var isEdgeY = hasRemY && r === totalRows - 1;
        var wMm = isEdgeX ? remMmX : cellMm;
        var hMm = isEdgeY ? remMmY : cellMm;
        var type = 'full';
        if (isEdgeX && isEdgeY) type = 'corner';
        else if (isEdgeX) type = 'edgeX';
        else if (isEdgeY) type = 'edgeY';
        row.push({
          col: c, row: r, type: type,
          wMm: wMm, hMm: hMm,
          areaCm2: +((wMm / 10) * (hMm / 10)).toFixed(4),
          x: 0, y: 0, w: 0, h: 0,
        });
      }
      cells.push(row);
    }

    this.gridInfo = {
      cellMm: cellMm,
      colsFull: colsFull, rowsFull: rowsFull,
      remMmX: remMmX, remMmY: remMmY,
      hasRemX: hasRemX, hasRemY: hasRemY,
      totalCols: totalCols, totalRows: totalRows,
      fullCount: colsFull * rowsFull,
      cells: cells,
    };
    this.onGridChange(this.gridInfo);
  }

  // ========================
  // Frame
  // ========================
  setFrameScale(percent) {
    this.frameScale = Math.max(0, Math.min(100, percent));
    this.applyFrameSize();
    this.renderPreview();
  }

  applyFrameSize() {
    if (!this.previewBox) return;
    var minW = 300;
    var container = this.previewBox.parentElement;
    var maxW = (container ? container.clientWidth : window.innerWidth) - 8;
    if (maxW < minW) maxW = minW;
    var t = this.frameScale / 100;
    var frameW = Math.round(minW + (maxW - minW) * t);
    this.previewBox.style.width = frameW + 'px';
    this.previewBox.style.maxWidth = '100%';
    if (this.image && this.aspectRatio > 0) {
      this.previewBox.style.height = Math.round(frameW / this.aspectRatio) + 'px';
    } else {
      this.previewBox.style.height = frameW + 'px';
    }
  }

  // ========================
  // Tools / mode / brush
  // ========================
  setTool(tool) {
    this.currentTool = tool;
    this.dragStart = null;
    this.dragCurrent = null;
    this.drawPath = [];
    this.isDrawing = false;
    if (tool === 'crop' && this.image) {
      if (!this.cropRect) this.cropRect = { x: 0, y: 0, w: 1, h: 1 };
    }
    this._updateCursor();
    this.renderPreview();
  }

  setDifficulty(level) {
    this.currentDifficulty = level;
  }

  setSelectMode(mode) {
    this.selectMode = mode;
    this.dragStart = null;
    this.dragCurrent = null;
    this.drawPath = [];
    this.isDrawing = false;
    this._updateCursor();
    this.renderPreview();
  }

  setBrushSize(n) {
    n = parseInt(n, 10) || 1;
    this.brushSize = Math.max(1, Math.min(5, n));
  }

  // ========================
  // Render
  // ========================
  renderPreview() {
    if (!this.previewBox || !this.image) return;
    if (this.canvas) this._unbindCanvasEvents();

    this.previewBox.innerHTML = '';
    var frameW = this.previewBox.clientWidth || 300;
    var frameH = this.previewBox.clientHeight || 300;

    this.canvas = document.createElement('canvas');
    this.canvas.width = frameW;
    this.canvas.height = frameH;
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = this._cursorForTool();

    this.ctx = this.canvas.getContext('2d');
    this.ctx.drawImage(this.image, 0, 0, frameW, frameH);

    if (this.gridInfo && this.widthMm > 0 && this.heightMm > 0 && this.currentTool !== 'crop') {
      this._updateCellPixelBounds(frameW, frameH);
      this.drawSelectionFills();
      this.drawGrid(frameW, frameH);
    }

    // Overlay: brush preview, drag rect, draw path, crop handles
    this._drawOverlays(frameW, frameH);

    this.previewBox.appendChild(this.canvas);
    this._bindCanvasEvents();
  }

  _updateCellPixelBounds(frameW, frameH) {
    var g = this.gridInfo;
    if (!g) return;
    var scaleX = frameW / this.widthMm;
    var scaleY = frameH / this.heightMm;
    var y = 0;
    for (var r = 0; r < g.totalRows; r++) {
      var x = 0;
      var rowH = 0;
      for (var c = 0; c < g.totalCols; c++) {
        var cell = g.cells[r][c];
        var cw = cell.wMm * scaleX;
        var ch = cell.hMm * scaleY;
        cell.x = x; cell.y = y; cell.w = cw; cell.h = ch;
        rowH = ch;
        x += cw;
      }
      y += rowH;
    }
  }

  drawSelectionFills() {
    var g = this.gridInfo;
    if (!g) return;
    var ctx = this.ctx;
    var self = this;
    this.selectedCells.forEach(function (diff, key) {
      var parts = key.split(',');
      var c = +parts[0], r = +parts[1];
      if (r < 0 || r >= g.totalRows || c < 0 || c >= g.totalCols) return;
      var cell = g.cells[r][c];
      ctx.fillStyle = self.diffColors[diff] || 'rgba(0,0,0,0.3)';
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    });
  }

  drawGrid(frameW, frameH) {
    var g = this.gridInfo;
    if (!g) return;
    var ctx = this.ctx;
    for (var r = 0; r < g.totalRows; r++) {
      for (var c = 0; c < g.totalCols; c++) {
        var cell = g.cells[r][c];
        if (cell.type === 'full') {
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 1;
        } else if (cell.type === 'edgeX') {
          ctx.strokeStyle = 'rgba(37,99,235,0.7)';
          ctx.lineWidth = 1.5;
        } else if (cell.type === 'edgeY') {
          ctx.strokeStyle = 'rgba(234,179,8,0.8)';
          ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle = 'rgba(239,68,68,0.85)';
          ctx.lineWidth = 1.5;
        }
        ctx.strokeRect(Math.round(cell.x) + 0.5, Math.round(cell.y) + 0.5, Math.round(cell.w), Math.round(cell.h));
      }
    }
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = '11px sans-serif';
    ctx.fillText(g.fullCount + ' ô chẵn + lẻ (' + g.totalCols + '×' + g.totalRows + ')', 6, 14);
    ctx.restore();
  }

  _drawOverlays(frameW, frameH) {
    var ctx = this.ctx;

    // Brush preview (mouse mode + select/erase)
    if (this.currentTool !== 'crop' && this.selectMode === 'mouse' && this.hoverCell && this.gridInfo) {
      this._drawBrushPreview(this.hoverCell);
    }

    // Drag rectangle
    if (this.dragStart && this.dragCurrent) {
      var x1 = Math.min(this.dragStart.x, this.dragCurrent.x);
      var y1 = Math.min(this.dragStart.y, this.dragCurrent.y);
      var x2 = Math.max(this.dragStart.x, this.dragCurrent.x);
      var y2 = Math.max(this.dragStart.y, this.dragCurrent.y);
      ctx.save();
      ctx.strokeStyle = this.currentTool === 'erase' ? 'rgba(239,68,68,0.9)' : 'rgba(37,99,235,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      ctx.fillStyle = this.currentTool === 'erase' ? 'rgba(239,68,68,0.12)' : 'rgba(37,99,235,0.12)';
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.restore();
    }

    // Draw path
    if (this.drawPath.length > 0) {
      ctx.save();
      ctx.strokeStyle = this.currentTool === 'erase' ? 'rgba(239,68,68,0.95)' : 'rgba(37,99,235,0.95)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(this.drawPath[0].x, this.drawPath[0].y);
      for (var i = 1; i < this.drawPath.length; i++) {
        ctx.lineTo(this.drawPath[i].x, this.drawPath[i].y);
      }
      if (!this.isDrawing && this.drawPath.length > 2) {
        ctx.closePath();
        ctx.fillStyle = this.currentTool === 'erase' ? 'rgba(239,68,68,0.15)' : 'rgba(37,99,235,0.15)';
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
    }

    // Crop handles
    if (this.currentTool === 'crop' && this.cropRect) {
      this._drawCropOverlay(frameW, frameH);
    }
  }

  _drawBrushPreview(anchorCell) {
    var g = this.gridInfo;
    if (!g) return;
    var ctx = this.ctx;
    var n = this.brushSize;
    ctx.save();
    ctx.fillStyle = 'rgba(100,100,100,0.35)';
    ctx.strokeStyle = 'rgba(60,60,60,0.7)';
    ctx.lineWidth = 1.5;
    for (var dr = 0; dr < n; dr++) {
      for (var dc = 0; dc < n; dc++) {
        var rr = anchorCell.row + dr;
        var cc = anchorCell.col + dc;
        if (rr < 0 || rr >= g.totalRows || cc < 0 || cc >= g.totalCols) continue;
        var cell = g.cells[rr][cc];
        ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
        ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.w, cell.h);
      }
    }
    // Label size
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(n + '×' + n, anchorCell.x + 3, anchorCell.y + 13);
    ctx.restore();
  }

  _drawCropOverlay(frameW, frameH) {
    var cr = this.cropRect;
    var x = cr.x * frameW;
    var y = cr.y * frameH;
    var w = cr.w * frameW;
    var h = cr.h * frameH;
    var ctx = this.ctx;

    // Dim outside
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, frameW, y);
    ctx.fillRect(0, y + h, frameW, frameH - y - h);
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, frameW - x - w, h);

    // Crop border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);

    // 4 edge handles (chấm tròn)
    var handles = [
      { side: 'left',   hx: x,       hy: y + h / 2 },
      { side: 'right',  hx: x + w,   hy: y + h / 2 },
      { side: 'top',    hx: x + w / 2, hy: y },
      { side: 'bottom', hx: x + w / 2, hy: y + h },
    ];
    handles.forEach(function (hd) {
      ctx.beginPath();
      ctx.arc(hd.hx, hd.hy, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.restore();
  }

  // ========================
  // Pointer events
  // ========================
  _bindCanvasEvents() {
    if (!this.canvas) return;
    var self = this;
    this._onDown = function (e) { self._pointerDown(e); };
    this._onMove = function (e) { self._pointerMove(e); };
    this._onUp = function (e) { self._pointerUp(e); };

    this.canvas.addEventListener('mousedown', this._onDown);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('mouseup', this._onUp);

    this.canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      self._pointerDown(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      self._pointerMove(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchend', function (e) {
      self._pointerUp(e.changedTouches ? e.changedTouches[0] : e);
    });
  }

  _unbindCanvasEvents() {
    if (!this.canvas) return;
    if (this._onDown) this.canvas.removeEventListener('mousedown', this._onDown);
    if (this._onMove) window.removeEventListener('mousemove', this._onMove);
    if (this._onUp) window.removeEventListener('mouseup', this._onUp);
  }

  _cursorForTool() {
    if (this.currentTool === 'crop') return 'default';
    if (this.selectMode === 'draw') return 'crosshair';
    if (this.selectMode === 'drag') return 'crosshair';
    if (this.currentTool === 'select') return 'crosshair';
    if (this.currentTool === 'erase') return 'cell';
    return 'default';
  }

  _updateCursor() {
    if (this.canvas) this.canvas.style.cursor = this._cursorForTool();
  }

  _canvasPos(clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.canvas.width / rect.width),
      y: (clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }

  _getCellAt(clientX, clientY) {
    if (!this.canvas || !this.gridInfo) return null;
    var p = this._canvasPos(clientX, clientY);
    var g = this.gridInfo;
    for (var r = 0; r < g.totalRows; r++) {
      for (var c = 0; c < g.totalCols; c++) {
        var cell = g.cells[r][c];
        if (p.x >= cell.x && p.x < cell.x + cell.w && p.y >= cell.y && p.y < cell.y + cell.h) {
          return cell;
        }
      }
    }
    return null;
  }

  _pointerDown(e) {
    if (!this.canvas || !this.image) return;
    var pos = this._canvasPos(e.clientX, e.clientY);
    this.isPointerDown = true;

    // --- CROP ---
    if (this.currentTool === 'crop') {
      this.cropDragging = this._hitCropHandle(pos);
      this.cropStartPos = pos;
      return;
    }

    if (!this.gridInfo) return;

    // --- DRAW mode ---
    if (this.selectMode === 'draw') {
      this.isDrawing = true;
      this.drawPath = [pos];
      this._redrawOverlayOnly();
      return;
    }

    // --- DRAG mode ---
    if (this.selectMode === 'drag') {
      this.dragStart = pos;
      this.dragCurrent = pos;
      this._redrawOverlayOnly();
      return;
    }

    // --- MOUSE mode (brush) ---
    if (this.selectMode === 'mouse') {
      this._applyBrushAt(e.clientX, e.clientY);
    }
  }

  _pointerMove(e) {
    if (!this.canvas || !this.image) return;
    var pos = this._canvasPos(e.clientX, e.clientY);

    // Hover brush preview
    if (!this.isPointerDown && this.currentTool !== 'crop' && this.selectMode === 'mouse' && this.gridInfo) {
      var cell = this._getCellAt(e.clientX, e.clientY);
      var prev = this.hoverCell;
      this.hoverCell = cell;
      if (cell !== prev) this._redrawOverlayOnly();
    }

    if (!this.isPointerDown) return;

    // Crop drag
    if (this.currentTool === 'crop' && this.cropDragging) {
      this._updateCropFromDrag(pos);
      this._redrawOverlayOnly();
      return;
    }

    if (!this.gridInfo) return;

    // Draw path
    if (this.selectMode === 'draw' && this.isDrawing) {
      var last = this.drawPath[this.drawPath.length - 1];
      if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) > 3) {
        this.drawPath.push(pos);
        this._redrawOverlayOnly();
      }
      return;
    }

    // Drag rect
    if (this.selectMode === 'drag' && this.dragStart) {
      this.dragCurrent = pos;
      this._redrawOverlayOnly();
      return;
    }

    // Mouse brush
    if (this.selectMode === 'mouse') {
      this._applyBrushAt(e.clientX, e.clientY);
    }
  }

  _pointerUp(e) {
    if (!this.isPointerDown) return;
    this.isPointerDown = false;

    // Crop: just stop dragging (apply on Confirm)
    if (this.currentTool === 'crop') {
      this.cropDragging = null;
      return;
    }

    if (!this.gridInfo) return;

    // Draw: finish path (wait for Confirm)
    if (this.selectMode === 'draw' && this.isDrawing) {
      this.isDrawing = false;
      if (this.drawPath.length > 2) {
        // close visually
        this._redrawOverlayOnly();
      }
      return;
    }

    // Drag: apply rect selection
    if (this.selectMode === 'drag' && this.dragStart && this.dragCurrent) {
      this._applyRectSelection(this.dragStart, this.dragCurrent);
      this.dragStart = null;
      this.dragCurrent = null;
      this._redrawOverlayOnly();
      this._emitSelection();
      return;
    }

    // Mouse brush done
    if (this.selectMode === 'mouse') {
      this._emitSelection();
    }
  }

  // ========================
  // Brush / Rect / Draw apply
  // ========================
  _applyBrushAt(clientX, clientY) {
    var cell = this._getCellAt(clientX, clientY);
    if (!cell) return;
    var g = this.gridInfo;
    var n = this.brushSize;
    var changed = false;

    for (var dr = 0; dr < n; dr++) {
      for (var dc = 0; dc < n; dc++) {
        var rr = cell.row + dr;
        var cc = cell.col + dc;
        if (rr < 0 || rr >= g.totalRows || cc < 0 || cc >= g.totalCols) continue;
        var key = cc + ',' + rr;
        if (this.currentTool === 'select') {
          if (this.selectedCells.get(key) !== this.currentDifficulty) {
            this.selectedCells.set(key, this.currentDifficulty);
            changed = true;
          }
        } else if (this.currentTool === 'erase') {
          if (this.selectedCells.has(key)) {
            this.selectedCells.delete(key);
            changed = true;
          }
        }
      }
    }
    if (changed) this._redrawOverlayOnly();
  }

  _applyRectSelection(p1, p2) {
    var g = this.gridInfo;
    if (!g) return;
    var x1 = Math.min(p1.x, p2.x);
    var y1 = Math.min(p1.y, p2.y);
    var x2 = Math.max(p1.x, p2.x);
    var y2 = Math.max(p1.y, p2.y);

    for (var r = 0; r < g.totalRows; r++) {
      for (var c = 0; c < g.totalCols; c++) {
        var cell = g.cells[r][c];
        // Cell intersects rect?
        var cx1 = cell.x, cy1 = cell.y, cx2 = cell.x + cell.w, cy2 = cell.y + cell.h;
        if (cx2 < x1 || cx1 > x2 || cy2 < y1 || cy1 > y2) continue;
        // Center inside or any overlap — dùng overlap
        var key = c + ',' + r;
        if (this.currentTool === 'select') {
          this.selectedCells.set(key, this.currentDifficulty);
        } else if (this.currentTool === 'erase') {
          this.selectedCells.delete(key);
        }
      }
    }
  }

  /**
   * Point-in-polygon (ray casting)
   */
  _pointInPoly(x, y, path) {
    var inside = false;
    for (var i = 0, j = path.length - 1; i < path.length; j = i++) {
      var xi = path[i].x, yi = path[i].y;
      var xj = path[j].x, yj = path[j].y;
      var intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi + 0.0001) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  applyDrawSelection() {
    if (!this.gridInfo || this.drawPath.length < 3) return;
    var g = this.gridInfo;
    var path = this.drawPath;

    for (var r = 0; r < g.totalRows; r++) {
      for (var c = 0; c < g.totalCols; c++) {
        var cell = g.cells[r][c];
        var cx = cell.x + cell.w / 2;
        var cy = cell.y + cell.h / 2;
        if (!this._pointInPoly(cx, cy, path)) continue;
        var key = c + ',' + r;
        if (this.currentTool === 'select') {
          this.selectedCells.set(key, this.currentDifficulty);
        } else if (this.currentTool === 'erase') {
          this.selectedCells.delete(key);
        }
      }
    }
    this.drawPath = [];
    this.renderPreview();
    this._emitSelection();
  }

  // ========================
  // Crop logic
  // ========================
  _hitCropHandle(pos) {
    if (!this.cropRect || !this.canvas) return null;
    var fw = this.canvas.width, fh = this.canvas.height;
    var cr = this.cropRect;
    var x = cr.x * fw, y = cr.y * fh, w = cr.w * fw, h = cr.h * fh;
    var handles = [
      { side: 'left',   hx: x,       hy: y + h / 2 },
      { side: 'right',  hx: x + w,   hy: y + h / 2 },
      { side: 'top',    hx: x + w / 2, hy: y },
      { side: 'bottom', hx: x + w / 2, hy: y + h },
    ];
    var hitR = 14;
    for (var i = 0; i < handles.length; i++) {
      var hd = handles[i];
      if (Math.hypot(pos.x - hd.hx, pos.y - hd.hy) <= hitR) return hd.side;
    }
    return null;
  }

  _updateCropFromDrag(pos) {
    if (!this.cropRect || !this.canvas) return;
    var fw = this.canvas.width, fh = this.canvas.height;
    var cr = this.cropRect;
    var nx = pos.x / fw;
    var ny = pos.y / fh;
    nx = Math.max(0, Math.min(1, nx));
    ny = Math.max(0, Math.min(1, ny));

    var minSize = 0.05; // tối thiểu 5%

    if (this.cropDragging === 'left') {
      var right = cr.x + cr.w;
      cr.x = Math.min(nx, right - minSize);
      cr.w = right - cr.x;
    } else if (this.cropDragging === 'right') {
      cr.w = Math.max(minSize, nx - cr.x);
    } else if (this.cropDragging === 'top') {
      var bottom = cr.y + cr.h;
      cr.y = Math.min(ny, bottom - minSize);
      cr.h = bottom - cr.y;
    } else if (this.cropDragging === 'bottom') {
      cr.h = Math.max(minSize, ny - cr.y);
    }
  }

  /** Áp dụng crop → tạo ảnh mới, tính lại aspect ratio */
  applyCrop() {
    if (!this.image || !this.cropRect) return;
    var cr = this.cropRect;
    // Nếu gần như full thì bỏ qua
    if (cr.w > 0.98 && cr.h > 0.98 && cr.x < 0.01 && cr.y < 0.01) return;

    var srcW = this.image.naturalWidth || this.image.width;
    var srcH = this.image.naturalHeight || this.image.height;

    var sx = Math.round(cr.x * srcW);
    var sy = Math.round(cr.y * srcH);
    var sw = Math.round(cr.w * srcW);
    var sh = Math.round(cr.h * srcH);
    if (sw < 2 || sh < 2) return;

    var off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    var octx = off.getContext('2d');
    octx.drawImage(this.image, sx, sy, sw, sh, 0, 0, sw, sh);

    var self = this;
    var newImg = new Image();
    newImg.onload = function () {
      self.image = newImg;
      self.naturalWidth = newImg.naturalWidth;
      self.naturalHeight = newImg.naturalHeight;
      self.aspectRatio = newImg.naturalWidth / newImg.naturalHeight;

      // Giữ widthMm, tính lại heightMm theo tỷ lệ mới (hoặc ngược lại)
      if (self.widthMm > 0) {
        // Scale mm theo phần còn lại của chiều ngang
        self.widthMm = +(self.widthMm * cr.w).toFixed(2);
        self.heightMm = +(self.widthMm / self.aspectRatio).toFixed(2);
      } else if (self.heightMm > 0) {
        self.heightMm = +(self.heightMm * cr.h).toFixed(2);
        self.widthMm = +(self.heightMm * self.aspectRatio).toFixed(2);
      }

      self.cropRect = { x: 0, y: 0, w: 1, h: 1 };
      self.selectedCells.clear();
      self.currentTool = 'select';
      self.onDimensionsChange({ widthMm: self.widthMm, heightMm: self.heightMm });
      if (self.widthMm > 0 && self.heightMm > 0) self.buildGrid();
      self.applyFrameSize();
      self.renderPreview();
      self._emitSelection();
    };
    newImg.src = off.toDataURL('image/png');
  }

  // ========================
  // Redraw helpers
  // ========================
  _redrawOverlayOnly() {
    if (!this.canvas || !this.ctx || !this.image) return;
    var frameW = this.canvas.width;
    var frameH = this.canvas.height;
    this.ctx.clearRect(0, 0, frameW, frameH);
    this.ctx.drawImage(this.image, 0, 0, frameW, frameH);

    if (this.gridInfo && this.widthMm > 0 && this.currentTool !== 'crop') {
      this.drawSelectionFills();
      this.drawGrid(frameW, frameH);
    }
    this._drawOverlays(frameW, frameH);
  }

  // ========================
  // Confirm / Delete
  // ========================
  confirmSelection() {
    if (this.currentTool === 'crop') {
      this.applyCrop();
      return;
    }
    if (this.selectMode === 'draw' && this.drawPath.length >= 3) {
      this.applyDrawSelection();
      return;
    }
    this._emitSelection();
  }

  deleteArea() {
    this.selectedCells.clear();
    this.drawPath = [];
    this.dragStart = null;
    this.dragCurrent = null;
    this.renderPreview();
    this._emitSelection();
  }

  /**
   * Auto Select: chọn mọi ô KHÔNG phải màu trắng (trên ảnh)
   * Ô được coi là "có màu" nếu trung bình pixel trong ô lệch đáng kể khỏi trắng
   */
  autoSelect() {
    if (!this.image || !this.gridInfo || !this.canvas) {
      alert('Cần có ảnh và lưới (nhập kích thước mm) trước khi tự chọn.');
      return;
    }

    var g = this.gridInfo;
    var frameW = this.canvas.width;
    var frameH = this.canvas.height;

    // Vẽ ảnh ra offscreen để đọc pixel (không có overlay)
    var off = document.createElement('canvas');
    off.width = frameW;
    off.height = frameH;
    var octx = off.getContext('2d');
    octx.drawImage(this.image, 0, 0, frameW, frameH);

    var imgData = octx.getImageData(0, 0, frameW, frameH);
    var data = imgData.data;

    // Ngưỡng: pixel "trắng" nếu R,G,B đều >= 240
    var WHITE_THRESH = 240;
    // Ô được chọn nếu > 15% pixel không phải trắng
    var NON_WHITE_RATIO = 0.15;

    var added = 0;
    for (var r = 0; r < g.totalRows; r++) {
      for (var c = 0; c < g.totalCols; c++) {
        var cell = g.cells[r][c];
        var x0 = Math.max(0, Math.floor(cell.x));
        var y0 = Math.max(0, Math.floor(cell.y));
        var x1 = Math.min(frameW, Math.ceil(cell.x + cell.w));
        var y1 = Math.min(frameH, Math.ceil(cell.y + cell.h));

        var total = 0;
        var nonWhite = 0;

        // Sample (mỗi 2px để nhanh hơn)
        for (var y = y0; y < y1; y += 2) {
          for (var x = x0; x < x1; x += 2) {
            var idx = (y * frameW + x) * 4;
            var R = data[idx], G = data[idx + 1], B = data[idx + 2], A = data[idx + 3];
            if (A < 10) continue; // trong suốt coi như bỏ
            total++;
            if (R < WHITE_THRESH || G < WHITE_THRESH || B < WHITE_THRESH) {
              nonWhite++;
            }
          }
        }

        if (total > 0 && (nonWhite / total) >= NON_WHITE_RATIO) {
          var key = c + ',' + r;
          // Ghi đè màu theo độ khó đang chọn (kể cả ô đã chọn trước đó)
          if (this.selectedCells.get(key) !== this.currentDifficulty) {
            this.selectedCells.set(key, this.currentDifficulty);
            added++;
          }
        }
      }
    }

    this.renderPreview();
    this._emitSelection();
    console.log('Auto Select: added ' + added + ' cells, total selected = ' + this.selectedCells.size);
  }

  /**
   * Replace 1 Color: trong các ô đã chọn, đổi fromDiff → toDiff
   */
  replaceColor(fromDiff, toDiff) {
    if (!fromDiff || !toDiff) return;
    var changed = 0;
    var self = this;
    this.selectedCells.forEach(function (diff, key) {
      if (diff === fromDiff) {
        self.selectedCells.set(key, toDiff);
        changed++;
      }
    });
    if (changed > 0) {
      this.renderPreview();
      this._emitSelection();
    }
  }

  /**
   * Replace All: mọi ô đã chọn → toDiff
   */
  replaceAllColors(toDiff) {
    if (!toDiff) return;
    var self = this;
    var keys = [];
    this.selectedCells.forEach(function (_, key) { keys.push(key); });
    keys.forEach(function (key) {
      self.selectedCells.set(key, toDiff);
    });
    if (keys.length > 0) {
      this.renderPreview();
      this._emitSelection();
    }
  }

  _emitSelection() {
    this.onSelectionChange(this.getSelectionSummary());
  }

  getSelectionSummary() {
    var byDiff = {};
    var byDiffAreas = {};
    var totalArea = 0;
    var g = this.gridInfo;
    this.selectedCells.forEach(function (diff, key) {
      byDiff[diff] = (byDiff[diff] || 0) + 1;
      if (g) {
        var parts = key.split(',');
        var c = +parts[0], r = +parts[1];
        if (r >= 0 && r < g.totalRows && c >= 0 && c < g.totalCols) {
          var a = g.cells[r][c].areaCm2;
          totalArea += a;
          byDiffAreas[diff] = (byDiffAreas[diff] || 0) + a;
        }
      }
    });
    // Làm tròn diện tích từng nhóm
    var keys = Object.keys(byDiffAreas);
    for (var i = 0; i < keys.length; i++) {
      byDiffAreas[keys[i]] = +byDiffAreas[keys[i]].toFixed(4);
    }
    return {
      cellCount: this.selectedCells.size,
      difficulty: this.currentDifficulty,
      cellSizeMm: this.cellSizeMm,
      cellLevel: this.cellLevel,
      widthMm: this.widthMm,
      heightMm: this.heightMm,
      gridInfo: this.gridInfo,
      byDifficulty: byDiff,
      byDifficultyAreas: byDiffAreas,
      totalAreaCm2: +totalArea.toFixed(2),
    };
  }

  getGridInfo() {
    return this.gridInfo;
  }
}

window.ImageEditor = ImageEditor;
