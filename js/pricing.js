/**
 * PricingEngine – Panel 5
 *
 * Công thức:
 * 1. Tổng diện tích S (cm²) từ các ô đã chọn
 * 2. Giá gốc /cm² cho Very Easy (Green):
 *      - Nếu S <= 640:  priceGreen = 100000 * (5 / S) ^ 0.391
 *      - Nếu S >  640:  priceGreen = 15000
 * 3. Hệ số theo màu:
 *      Green 1.0 | Blue 1.1 | Yellow 1.2 | Orange 1.3 | Red 1.4
 * 4. Tổng tiền = Σ (area_màu * priceGreen * hệ_số_màu)
 * 5. Nếu tổng < 300.000₫ → làm tròn lên 300.000₫
 */
class PricingEngine {
  constructor(options = {}) {
    this.exchangeRate = {
      usd: 26062,
      eur: 30382,
    };

    // Hệ số nhân theo độ khó (so với Green)
    this.multipliers = {
      'very-easy': 1.0,
      'easy':      1.1,
      'medium':    1.2,
      'hard':      1.3,
      'very-hard': 1.4,
    };

    this.MIN_TOTAL_VND = 300000;
    this.AREA_THRESHOLD = 640;   // cm²
    this.FLAT_PRICE_GREEN = 15000; // ₫/cm² khi S > 640

    this.priceMode = 'auto'; // auto | manual
    this.manualPriceGreen = 0;

    this.onPriceUpdate = options.onPriceUpdate || function () {};
  }

  setPriceMode(mode) {
    this.priceMode = mode === 'manual' ? 'manual' : 'auto';
  }

  setManualPrice(price) {
    this.manualPriceGreen = parseFloat(price) || 0;
  }

  /**
   * Tính giá Green / cm² theo tổng diện tích (hoặc manual)
   */
  calcPriceGreen(totalAreaCm2) {
    if (this.priceMode === 'manual' && this.manualPriceGreen > 0) {
      return this.manualPriceGreen;
    }
    if (!totalAreaCm2 || totalAreaCm2 <= 0) return 0;
    if (totalAreaCm2 > this.AREA_THRESHOLD) {
      return this.FLAT_PRICE_GREEN;
    }
    // 100000 * (5 / S) ^ 0.391
    return 100000 * Math.pow(5 / totalAreaCm2, 0.391);
  }

  calculate(selection) {
    var totalAreaCm2 = selection.totalAreaCm2 || 0;
    var cellCount = selection.cellCount || 0;
    var areas = selection.byDifficultyAreas || {};
    var counts = selection.byDifficulty || {};

    // Nếu không có area theo màu nhưng có cell count – fallback
    if (totalAreaCm2 <= 0 || cellCount <= 0) {
      var empty = this._emptyResult();
      this.onPriceUpdate(empty);
      return empty;
    }

    var priceGreen = this.calcPriceGreen(totalAreaCm2);

    // Tính từng nhóm màu
    var breakdown = [];
    var totalVnd = 0;
    var order = ['very-easy', 'easy', 'medium', 'hard', 'very-hard'];
    var labels = {
      'very-easy': 'Rất dễ',
      'easy': 'Dễ',
      'medium': 'Trung bình',
      'hard': 'Khó',
      'very-hard': 'Rất khó',
    };

    for (var i = 0; i < order.length; i++) {
      var diff = order[i];
      var area = areas[diff] || 0;
      if (area <= 0) continue;
      var mult = this.multipliers[diff] || 1;
      var pricePerCm2 = priceGreen * mult;
      var subtotal = area * pricePerCm2;
      totalVnd += subtotal;
      breakdown.push({
        difficulty: diff,
        label: labels[diff] || diff,
        areaCm2: +area.toFixed(2),
        cellCount: counts[diff] || 0,
        multiplier: mult,
        pricePerCm2: +pricePerCm2.toFixed(2),
        subtotal: Math.round(subtotal),
      });
    }

    // Làm tròn tổng
    totalVnd = Math.round(totalVnd);

    // Min 300k
    var appliedMin = false;
    if (totalVnd > 0 && totalVnd < this.MIN_TOTAL_VND) {
      totalVnd = this.MIN_TOTAL_VND;
      appliedMin = true;
    }

    var result = {
      cellCount: cellCount,
      totalAreaCm2: +(+totalAreaCm2).toFixed(2),
      priceGreen: +priceGreen.toFixed(2),
      breakdown: breakdown,
      totalVnd: totalVnd,
      appliedMin: appliedMin,
      isFlatRate: totalAreaCm2 > this.AREA_THRESHOLD,
      totalUsd: +(totalVnd / this.exchangeRate.usd).toFixed(2),
      totalEur: +(totalVnd / this.exchangeRate.eur).toFixed(2),
      exchangeRate: {
        usd: this.exchangeRate.usd,
        eur: this.exchangeRate.eur,
      },
      // giữ tương thích UI cũ
      difficulty: selection.difficulty || 'medium',
      pricePerCm2: +priceGreen.toFixed(2),
    };

    this.onPriceUpdate(result);
    return result;
  }

  _emptyResult() {
    return {
      cellCount: 0,
      totalAreaCm2: 0,
      priceGreen: 0,
      breakdown: [],
      totalVnd: 0,
      appliedMin: false,
      isFlatRate: false,
      totalUsd: 0,
      totalEur: 0,
      exchangeRate: {
        usd: this.exchangeRate.usd,
        eur: this.exchangeRate.eur,
      },
      difficulty: 'medium',
      pricePerCm2: 0,
    };
  }

  setExchangeRate(usd, eur) {
    if (usd) this.exchangeRate.usd = usd;
    if (eur) this.exchangeRate.eur = eur;
  }
}

window.PricingEngine = PricingEngine;
