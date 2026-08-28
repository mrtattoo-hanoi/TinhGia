/**
 * App – Điều phối (Việt hóa, file://)
 */
class App {
  constructor() {
    var self = this;

    this.editor = new ImageEditor({
      onSelectionChange: function (summary) { self.handleSelectionChange(summary); },
      onImageLoaded: function (info) { self.handleImageLoaded(info); },
      onDimensionsChange: function (dims) { self.handleDimensionsChange(dims); },
      onGridChange: function (gridInfo) { self.handleGridChange(gridInfo); },
    });

    this.pricing = new PricingEngine({
      onPriceUpdate: function (result) { self.renderPricing(result); },
    });

    this.dom = {};
    this._syncingDimensions = false;
  }

  init() {
    this.cacheDom();
    this.editor.init({
      previewBox: this.dom.previewBox,
      fileNameEl: this.dom.fileName,
    });
    this.bindEvents();
    this.editor.setFrameScale(50);
    this.editor.setTool('select');
    this.editor.setBrushSize(1);

    if (this.dom.toolButtons) {
      this.dom.toolButtons.forEach(function (b) {
        b.classList.toggle('active', b.dataset.tool === 'select');
      });
    }

    var self = this;
    window.addEventListener('resize', function () {
      self.editor.applyFrameSize();
      self.editor.renderPreview();
    });

    // Lấy tỷ giá online
    this.fetchExchangeRates();

    console.log('App initialized');
  }

  cacheDom() {
    this.dom = {
      imageUpload: document.getElementById('image-upload'),
      fileName: document.getElementById('file-name'),
      inputWidth: document.getElementById('input-width'),
      inputHeight: document.getElementById('input-height'),
      scaleSlider: document.getElementById('scale-slider'),
      priceMode: document.getElementById('price-mode'),
      manualPrice: document.getElementById('manual-price'),
      cellSize: document.getElementById('cell-size'),
      selectionSize: document.getElementById('selection-size'),
      toolButtons: document.querySelectorAll('.tool-btn[data-tool]'),
      diffChips: document.querySelectorAll('.diff-chip'),
      modeButtons: document.querySelectorAll('.mode-btn[data-mode]'),
      btnAutoSelect: document.getElementById('btn-auto-select'),
      fromColor: document.getElementById('from-color'),
      toColor: document.getElementById('to-color'),
      fromColorRow: document.getElementById('from-color-row'),
      toColorRow: document.getElementById('to-color-row'),
      btnReplace1: document.getElementById('btn-replace-1'),
      btnReplaceAll: document.getElementById('btn-replace-all'),
      selectedViewTitle: document.getElementById('selected-view-title'),
      previewBox: document.getElementById('preview-box'),
      btnConfirm: document.getElementById('btn-confirm'),
      btnDelete: document.getElementById('btn-delete'),
      complexityBadge: document.getElementById('complexity-badge'),
      totalArea: document.getElementById('total-area'),
      priceDetail: document.getElementById('price-detail'),
      totalCost: document.getElementById('total-cost'),
      conversions: document.getElementById('conversions'),
      exchangeRate: document.getElementById('exchange-rate'),
    };
  }

  bindEvents() {
    var self = this;

    // Panel 1
    if (this.dom.imageUpload) {
      this.dom.imageUpload.addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (file) self.editor.loadImage(file);
      });
    }

    // Panel 2
    if (this.dom.inputWidth) {
      this.dom.inputWidth.addEventListener('input', function (e) {
        if (self._syncingDimensions) return;
        self.editor.setWidthMm(e.target.value);
      });
    }
    if (this.dom.inputHeight) {
      this.dom.inputHeight.addEventListener('input', function (e) {
        if (self._syncingDimensions) return;
        self.editor.setHeightMm(e.target.value);
      });
    }
    if (this.dom.scaleSlider) {
      this.dom.scaleSlider.addEventListener('input', function (e) {
        self.editor.setFrameScale(+e.target.value);
      });
    }
    if (this.dom.cellSize) {
      this.dom.cellSize.addEventListener('change', function (e) {
        self.editor.setCellLevel(+e.target.value);
      });
    }
    if (this.dom.selectionSize) {
      this.dom.selectionSize.addEventListener('change', function (e) {
        self.editor.setBrushSize(+e.target.value);
      });
    }

    // Price mode Auto / Manual
    if (this.dom.priceMode) {
      var modeBtns = this.dom.priceMode.querySelectorAll('.toggle-btn');
      modeBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          modeBtns.forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var mode = btn.dataset.mode;
          self.pricing.setPriceMode(mode);
          if (self.dom.manualPrice) {
            self.dom.manualPrice.style.display = mode === 'manual' ? 'block' : 'none';
          }
          // Tính lại giá
          self.pricing.calculate(self.editor.getSelectionSummary());
        });
      });
    }
    if (this.dom.manualPrice) {
      this.dom.manualPrice.addEventListener('input', function (e) {
        self.pricing.setManualPrice(e.target.value);
        self.pricing.calculate(self.editor.getSelectionSummary());
      });
    }

    // Tools
    if (this.dom.toolButtons) {
      this.dom.toolButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.dom.toolButtons.forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          self.editor.setTool(btn.dataset.tool);
        });
      });
    }

    // Difficulty
    if (this.dom.diffChips) {
      this.dom.diffChips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          self.dom.diffChips.forEach(function (c) { c.classList.remove('active'); });
          chip.classList.add('active');
          self.editor.setDifficulty(chip.dataset.diff);
        });
      });
    }

    // Mode buttons (Chuột / Kéo khung / Vẽ vùng)
    if (this.dom.modeButtons) {
      this.dom.modeButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.dom.modeButtons.forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          self.editor.setSelectMode(btn.dataset.mode);
        });
      });
    }

    // Auto Select (nút riêng, không đổi mode)
    if (this.dom.btnAutoSelect) {
      this.dom.btnAutoSelect.addEventListener('click', function () {
        self.editor.autoSelect();
      });
    }

    // Color pick From / To (swatches)
    this._bindColorPicks(this.dom.fromColorRow, this.dom.fromColor);
    this._bindColorPicks(this.dom.toColorRow, this.dom.toColor);

    // Replace
    if (this.dom.btnReplace1) {
      this.dom.btnReplace1.addEventListener('click', function () {
        self.editor.replaceColor(self.dom.fromColor.value, self.dom.toColor.value);
      });
    }
    if (this.dom.btnReplaceAll) {
      this.dom.btnReplaceAll.addEventListener('click', function () {
        self.editor.replaceAllColors(self.dom.toColor.value);
      });
    }

    if (this.dom.btnConfirm) {
      this.dom.btnConfirm.addEventListener('click', function () {
        self.editor.confirmSelection();
      });
    }
    if (this.dom.btnDelete) {
      this.dom.btnDelete.addEventListener('click', function () {
        self.editor.deleteArea();
      });
    }
  }

  _bindColorPicks(row, hiddenInput) {
    if (!row || !hiddenInput) return;
    var picks = row.querySelectorAll('.color-pick');
    picks.forEach(function (btn) {
      btn.addEventListener('click', function () {
        picks.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        hiddenInput.value = btn.dataset.diff;
      });
    });
  }

  // ========================
  // Tỷ giá online
  // ========================
  fetchExchangeRates() {
    var self = this;
    // Dùng API miễn phí, fallback nếu lỗi / offline
    var url = 'https://open.er-api.com/v6/latest/USD';
    if (typeof fetch === 'undefined') return;

    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data && data.rates) {
          var usdVnd = data.rates.VND;
          var eurUsd = data.rates.EUR;
          if (usdVnd && eurUsd) {
            var eurVnd = Math.round(usdVnd / eurUsd);
            self.pricing.setExchangeRate(Math.round(usdVnd), eurVnd);
            // Cập nhật UI nếu đã có selection
            self.pricing.calculate(self.editor.getSelectionSummary());
            console.log('Tỷ giá cập nhật: USD=' + Math.round(usdVnd) + ' EUR=' + eurVnd);
          }
        }
      })
      .catch(function (err) {
        console.warn('Không lấy được tỷ giá online, dùng mặc định.', err);
      });
  }

  // ========================
  // Handlers
  // ========================
  handleImageLoaded(info) {
    if (this.dom.fileName) {
      this.dom.fileName.textContent = 'Đã có ảnh';
      this.dom.fileName.classList.add('has-image');
      this.dom.fileName.title = info.name || '';
    }
    this._syncingDimensions = true;
    if (this.dom.inputWidth) this.dom.inputWidth.value = '';
    if (this.dom.inputHeight) this.dom.inputHeight.value = '';
    this._syncingDimensions = false;
    if (this.dom.selectedViewTitle) {
      this.dom.selectedViewTitle.textContent = 'Vùng đã chọn (Lưới: 0 ô)';
    }
  }

  handleDimensionsChange(dims) {
    this._syncingDimensions = true;
    if (this.dom.inputWidth) this.dom.inputWidth.value = dims.widthMm || '';
    if (this.dom.inputHeight) this.dom.inputHeight.value = dims.heightMm || '';
    this._syncingDimensions = false;
  }

  handleGridChange(gridInfo) {
    if (!this.dom.selectedViewTitle) return;
    if (!gridInfo) {
      this.dom.selectedViewTitle.textContent = 'Vùng đã chọn (Lưới: 0 ô)';
      return;
    }
    var total = gridInfo.totalCols * gridInfo.totalRows;
    this.dom.selectedViewTitle.textContent =
      'Vùng đã chọn (Lưới: ' + gridInfo.fullCount + ' ô chẵn + lẻ, ' +
      total + ' ô, ' + gridInfo.totalCols + '×' + gridInfo.totalRows + ')';
  }

  handleSelectionChange(summary) {
    if (this.dom.selectedViewTitle) {
      var g = summary.gridInfo;
      if (g) {
        var total = g.totalCols * g.totalRows;
        this.dom.selectedViewTitle.textContent =
          'Vùng đã chọn (Lưới: ' + g.fullCount + ' ô chẵn + lẻ, ' +
          total + ' ô) — Đã chọn: ' + summary.cellCount;
      } else {
        this.dom.selectedViewTitle.textContent =
          'Vùng đã chọn — Đã chọn: ' + summary.cellCount + ' ô';
      }
    }
    this.pricing.calculate(summary);
  }

  renderPricing(result) {
    if (this.dom.complexityBadge) {
      var badge = 'Giá: ' + (result.priceGreen || 0).toLocaleString('vi-VN') + ' ₫/cm²';
      if (result.isFlatRate) badge += ' (cố định >640cm²)';
      if (result.appliedMin) badge += ' · tối thiểu 300k';
      this.dom.complexityBadge.textContent = badge;
    }

    if (this.dom.totalArea) {
      this.dom.totalArea.textContent =
        'Tổng diện tích: ' + result.totalAreaCm2 + ' cm² (' + result.cellCount + ' ô)';
    }

    if (this.dom.priceDetail) {
      if (!result.breakdown || result.breakdown.length === 0) {
        this.dom.priceDetail.innerHTML = '<span style="color:#94a3b8">Chưa chọn vùng nào</span>';
      } else {
        var colorMap = {
          'very-easy': '#22c55e',
          'easy': '#3b82f6',
          'medium': '#eab308',
          'hard': '#f97316',
          'very-hard': '#ef4444'
        };
        var lines = [];
        for (var i = 0; i < result.breakdown.length; i++) {
          var b = result.breakdown[i];
          var color = colorMap[b.difficulty] || '#94a3b8';
          lines.push(
            '<div class="price-line">' +
            '<span class="diff-dot" style="background:' + color + '"></span>' +
            '<span><strong>' + b.label + ':</strong> ' +
            b.areaCm2 + ' cm² × ' +
            b.pricePerCm2.toLocaleString('vi-VN') + ' ₫' +
            (b.multiplier !== 1 ? ' (×' + b.multiplier + ')' : '') +
            ' = <strong>' + b.subtotal.toLocaleString('vi-VN') + ' ₫</strong></span>' +
            '</div>'
          );
        }
        this.dom.priceDetail.innerHTML = lines.join('');
        this.dom.priceDetail.style.textAlign = 'left';
      }
    }

    if (this.dom.totalCost) {
      this.dom.totalCost.textContent = (result.totalVnd || 0).toLocaleString('vi-VN') + ' ₫';
    }
    if (this.dom.conversions) {
      this.dom.conversions.innerHTML =
        '≈ $' + (result.totalUsd || 0) + ' USD &nbsp;·&nbsp; ≈ €' + (result.totalEur || 0) + ' EUR';
    }
    if (this.dom.exchangeRate) {
      this.dom.exchangeRate.textContent =
        'Tỷ giá (USD): ' + result.exchangeRate.usd.toLocaleString('vi-VN') +
        ' ₫ | (EUR): ' + result.exchangeRate.eur.toLocaleString('vi-VN') + ' ₫';
    }
  }
}

document.addEventListener('DOMContentLoaded', function () {
  var app = new App();
  app.init();
});
