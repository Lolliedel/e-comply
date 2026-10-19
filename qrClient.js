/**
 * ESSU E-Comply QR Code & Digital ID SDK (qrClient.js)
 * 
 * Provides complete offline QR Code generation, Digital University ID Card rendering,
 * and Live Camera / File QR Reader capabilities as a seamless alternative to
 * Live20R biometric fingerprint scanning.
 * 
 * Features:
 * - Pure JavaScript QR Code Generator (Zero external dependencies, 100% offline)
 * - SVG and Canvas DataURL rendering with ESSU brand styling
 * - Live Camera QR Code Scanner with viewfinder & laser sweep animation
 * - Native BarcodeDetector hardware acceleration with pure JS fallback
 * - QR Image File Upload / Photo scanner
 * - Official ESSU Digital ID Card modal with Print and Download options
 * - Seamless integration with ZKTeco & biometricSigner
 */

(function () {
  // ── QR CODE GENERATOR CORE (Kazuhiko Arase - MIT) ─────────────────────────
  function QRPolynomial(num, shift) {
    if (typeof num.length === "undefined") throw new Error(num.length + "/" + shift);
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[offset + i];
  }
  QRPolynomial.prototype = {
    getAt: function (i) { return this.num[i]; },
    getLength: function () { return this.num.length; },
    multiply: function (e) {
      const num = new Array(this.getLength() + e.getLength() - 1);
      for (let i = 0; i < this.getLength(); i++) {
        for (let j = 0; j < e.getLength(); j++) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(this.getAt(i)) + QRMath.glog(e.getAt(j)));
        }
      }
      return new QRPolynomial(num, 0);
    },
    mod: function (e) {
      if (this.getLength() - e.getLength() < 0) return this;
      const ratio = QRMath.glog(this.getAt(0)) - QRMath.glog(e.getAt(0));
      const num = new Array(this.getLength());
      for (let i = 0; i < this.getLength(); i++) num[i] = this.getAt(i);
      for (let i = 0; i < e.getLength(); i++) num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
      return new QRPolynomial(num, 0).mod(e);
    }
  };

  const QRMath = {
    glog: function (n) {
      if (n < 1) throw new Error("glog(" + n + ")");
      return QRMath.LOG_TABLE[n];
    },
    gexp: function (n) {
      while (n < 0) n += 255;
      while (n >= 256) n -= 255;
      return QRMath.EXP_TABLE[n];
    },
    EXP_TABLE: new Array(256),
    LOG_TABLE: new Array(256)
  };
  for (let i = 0; i < 8; i++) QRMath.EXP_TABLE[i] = 1 << i;
  for (let i = 8; i < 256; i++) QRMath.EXP_TABLE[i] = QRMath.EXP_TABLE[i - 4] ^ QRMath.EXP_TABLE[i - 5] ^ QRMath.EXP_TABLE[i - 6] ^ QRMath.EXP_TABLE[i - 8];
  for (let i = 0; i < 255; i++) QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;

  const QRMaskPattern = {
    PATTERN000: 0, PATTERN001: 1, PATTERN010: 2, PATTERN011: 3,
    PATTERN100: 4, PATTERN101: 5, PATTERN110: 6, PATTERN111: 7
  };

  const QRUtil = {
    PATTERN_POSITION_TABLE: [
      [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
      [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
      [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70]
    ],
    G15: (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
    G18: (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0),
    G15_MASK: (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1),
    getBCHTypeInfo: function (data) {
      let d = data << 10;
      while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
        d ^= (QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15)));
      }
      return ((data << 10) | d) ^ QRUtil.G15_MASK;
    },
    getBCHDigit: function (data) {
      let digit = 0;
      while (data !== 0) { digit++; data >>>= 1; }
      return digit;
    },
    getPatternPosition: function (typeNumber) {
      return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1] || [];
    },
    getMask: function (maskPattern, i, j) {
      switch (maskPattern) {
        case QRMaskPattern.PATTERN000: return (i + j) % 2 === 0;
        case QRMaskPattern.PATTERN001: return i % 2 === 0;
        case QRMaskPattern.PATTERN010: return j % 3 === 0;
        case QRMaskPattern.PATTERN011: return (i + j) % 3 === 0;
        case QRMaskPattern.PATTERN100: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case QRMaskPattern.PATTERN101: return ((i * j) % 2) + ((i * j) % 3) === 0;
        case QRMaskPattern.PATTERN110: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
        case QRMaskPattern.PATTERN111: return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
        default: throw new Error("bad maskPattern:" + maskPattern);
      }
    },
    getErrorCorrectPolynomial: function (errorCorrectLength) {
      let a = new QRPolynomial([1], 0);
      for (let i = 0; i < errorCorrectLength; i++) {
        a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
      }
      return a;
    },
    getLengthInBits: function (mode, type) {
      if (1 <= type && type < 10) {
        switch (mode) {
          case 1: return 10;
          case 2: return 9;
          case 4: return 8;
          case 8: return 8;
          default: throw new Error("mode:" + mode);
        }
      } else if (type < 27) {
        switch (mode) {
          case 1: return 12;
          case 2: return 11;
          case 4: return 16;
          case 8: return 10;
          default: throw new Error("mode:" + mode);
        }
      } else {
        switch (mode) {
          case 1: return 14;
          case 2: return 13;
          case 4: return 16;
          case 8: return 12;
          default: throw new Error("mode:" + mode);
        }
      }
    },
    getLostPoint: function (qrCode) {
      const moduleCount = qrCode.getModuleCount();
      let lostPoint = 0;
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          let sameCount = 0;
          const dark = qrCode.isDark(row, col);
          for (let r = -1; r <= 1; r++) {
            if (row + r < 0 || moduleCount <= row + r) continue;
            for (let c = -1; c <= 1; c++) {
              if (col + c < 0 || moduleCount <= col + c) continue;
              if (r === 0 && c === 0) continue;
              if (dark === qrCode.isDark(row + r, col + c)) sameCount++;
            }
          }
          if (sameCount > 5) lostPoint += (3 + sameCount - 5);
        }
      }
      for (let row = 0; row < moduleCount - 1; row++) {
        for (let col = 0; col < moduleCount - 1; col++) {
          let count = 0;
          if (qrCode.isDark(row, col)) count++;
          if (qrCode.isDark(row + 1, col)) count++;
          if (qrCode.isDark(row, col + 1)) count++;
          if (qrCode.isDark(row + 1, col + 1)) count++;
          if (count === 0 || count === 4) lostPoint += 3;
        }
      }
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount - 6; col++) {
          if (qrCode.isDark(row, col) && !qrCode.isDark(row, col + 1) && qrCode.isDark(row, col + 2) && qrCode.isDark(row, col + 3) && qrCode.isDark(row, col + 4) && !qrCode.isDark(row, col + 5) && qrCode.isDark(row, col + 6)) {
            lostPoint += 40;
          }
        }
      }
      for (let col = 0; col < moduleCount; col++) {
        for (let row = 0; row < moduleCount - 6; row++) {
          if (qrCode.isDark(row, col) && !qrCode.isDark(row + 1, col) && qrCode.isDark(row + 2, col) && qrCode.isDark(row + 3, col) && qrCode.isDark(row + 4, col) && !qrCode.isDark(row + 5, col) && qrCode.isDark(row + 6, col)) {
            lostPoint += 40;
          }
        }
      }
      let darkCount = 0;
      for (let col = 0; col < moduleCount; col++) {
        for (let row = 0; row < moduleCount; row++) {
          if (qrCode.isDark(row, col)) darkCount++;
        }
      }
      const ratio = Math.abs((100 * darkCount) / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;
      return lostPoint;
    }
  };

  const QRRSBlock = {
    RS_BLOCK_TABLE: [
      [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
      [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
      [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
      [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
      [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
      [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
      [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
      [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
      [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
      [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16]
    ],
    getRSBlocks: function (typeNumber, errorCorrectLevel) {
      const rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
      if (!rsBlock) throw new Error("bad rs block @ typeNumber:" + typeNumber + "/errorCorrectLevel:" + errorCorrectLevel);
      const length = rsBlock.length / 3;
      const list = [];
      for (let i = 0; i < length; i++) {
        const count = rsBlock[i * 3 + 0];
        const totalCount = rsBlock[i * 3 + 1];
        const dataCount = rsBlock[i * 3 + 2];
        for (let j = 0; j < count; j++) list.push({ totalCount, dataCount });
      }
      return list;
    },
    getRsBlockTable: function (typeNumber, errorCorrectLevel) {
      switch (errorCorrectLevel) {
        case 1: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
        case 0: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
        case 3: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
        case 2: return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
        default: return undefined;
      }
    }
  };

  function QRBitBuffer() {
    this.buffer = [];
    this.length = 0;
  }
  QRBitBuffer.prototype = {
    get: function (index) { return ((this.buffer[Math.floor(index / 8)] >>> (7 - (index % 8))) & 1) === 1; },
    put: function (num, length) {
      for (let i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    },
    getLengthInBits: function () { return this.length; },
    putBit: function (bit) {
      const bufIndex = Math.floor(this.length / 8);
      if (this.buffer.length <= bufIndex) this.buffer.push(0);
      if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
      this.length++;
    }
  };

  function QR8bitByte(data) {
    this.mode = 4;
    this.data = data;
  }
  QR8bitByte.prototype = {
    getLength: function () { return this.data.length; },
    write: function (buffer) {
      for (let i = 0; i < this.data.length; i++) buffer.put(this.data.charCodeAt(i), 8);
    }
  };

  function QRCodeModel(typeNumber, errorCorrectLevel) {
    this.typeNumber = typeNumber;
    this.errorCorrectLevel = errorCorrectLevel;
    this.modules = null;
    this.moduleCount = 0;
    this.dataCache = null;
    this.dataList = [];
  }
  QRCodeModel.prototype = {
    addData: function (data) {
      this.dataList.push(new QR8bitByte(data));
      this.dataCache = null;
    },
    isDark: function (row, col) {
      if (row < 0 || this.moduleCount <= row || col < 0 || this.moduleCount <= col) {
        throw new Error(row + "," + col);
      }
      return this.modules[row][col];
    },
    getModuleCount: function () { return this.moduleCount; },
    make: function () {
      if (this.typeNumber < 1) {
        let typeNumber = 1;
        for (typeNumber = 1; typeNumber < 10; typeNumber++) {
          const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, this.errorCorrectLevel);
          const buffer = new QRBitBuffer();
          let totalDataCount = 0;
          for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
          for (let i = 0; i < this.dataList.length; i++) {
            const data = this.dataList[i];
            buffer.put(data.mode, 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
            data.write(buffer);
          }
          if (buffer.getLengthInBits() <= totalDataCount * 8) break;
        }
        this.typeNumber = typeNumber;
      }
      this.makeImpl(false, this.getBestMaskPattern());
    },
    makeImpl: function (test, maskPattern) {
      this.moduleCount = this.typeNumber * 4 + 17;
      this.modules = new Array(this.moduleCount);
      for (let row = 0; row < this.moduleCount; row++) {
        this.modules[row] = new Array(this.moduleCount);
        for (let col = 0; col < this.moduleCount; col++) this.modules[row][col] = null;
      }
      this.setupPositionProbePattern(0, 0);
      this.setupPositionProbePattern(this.moduleCount - 7, 0);
      this.setupPositionProbePattern(0, this.moduleCount - 7);
      this.setupPositionAdjustPattern();
      this.setupTimingPattern();
      this.setupTypeInfo(test, maskPattern);
      if (this.typeNumber >= 7) this.setupTypeNumber(test);
      if (this.dataCache === null) this.dataCache = QRCodeModel.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
      this.mapData(this.dataCache, maskPattern);
    },
    setupPositionProbePattern: function (row, col) {
      for (let r = -1; r <= 7; r++) {
        if (row + r <= -1 || this.moduleCount <= row + r) continue;
        for (let c = -1; c <= 7; c++) {
          if (col + c <= -1 || this.moduleCount <= col + c) continue;
          if ((0 <= r && r <= 6 && (c === 0 || c === 6)) || (0 <= c && c <= 6 && (r === 0 || r === 6)) || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
            this.modules[row + r][col + c] = true;
          } else {
            this.modules[row + r][col + c] = false;
          }
        }
      }
    },
    getBestMaskPattern: function () {
      let minLostPoint = 0;
      let pattern = 0;
      for (let i = 0; i < 8; i++) {
        this.makeImpl(true, i);
        const lostPoint = QRUtil.getLostPoint(this);
        if (i === 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }
      return pattern;
    },
    setupTimingPattern: function () {
      for (let r = 8; r < this.moduleCount - 8; r++) {
        if (this.modules[r][6] !== null) continue;
        this.modules[r][6] = (r % 2 === 0);
      }
      for (let c = 8; c < this.moduleCount - 8; c++) {
        if (this.modules[6][c] !== null) continue;
        this.modules[6][c] = (c % 2 === 0);
      }
    },
    setupPositionAdjustPattern: function () {
      const pos = QRUtil.getPatternPosition(this.typeNumber);
      if (!pos) return;
      for (let i = 0; i < pos.length; i++) {
        for (let j = 0; j < pos.length; j++) {
          const row = pos[i];
          const col = pos[j];
          if (this.modules[row][col] !== null) continue;
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              this.modules[row + r][col + c] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
            }
          }
        }
      }
    },
    setupTypeInfo: function (test, maskPattern) {
      const data = (this.errorCorrectLevel << 3) | maskPattern;
      const bits = QRUtil.getBCHTypeInfo(data);
      for (let i = 0; i < 15; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 6) this.modules[i][8] = mod;
        else if (i < 8) this.modules[i + 1][8] = mod;
        else this.modules[this.moduleCount - 15 + i][8] = mod;
      }
      for (let i = 0; i < 15; i++) {
        const mod = (!test && ((bits >> i) & 1) === 1);
        if (i < 8) this.modules[8][this.moduleCount - i - 1] = mod;
        else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
        else this.modules[8][15 - i - 1] = mod;
      }
      this.modules[this.moduleCount - 8][8] = !test;
    },
    setupTypeNumber: function (test) {},
    mapData: function (data, maskPattern) {
      let inc = -1;
      let row = this.moduleCount - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      for (let col = this.moduleCount - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
          for (let c = 0; c < 2; c++) {
            if (this.modules[row][col - c] === null) {
              let dark = false;
              if (byteIndex < data.length) dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
              const mask = QRUtil.getMask(maskPattern, row, col - c);
              if (mask) dark = !dark;
              this.modules[row][col - c] = dark;
              bitIndex--;
              if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
            }
          }
          row += inc;
          if (row < 0 || this.moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    }
  };

  QRCodeModel.createData = function (typeNumber, errorCorrectLevel, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
    const buffer = new QRBitBuffer();
    for (let i = 0; i < dataList.length; i++) {
      const data = dataList[i];
      buffer.put(data.mode, 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw new Error("code length overflow. (" + buffer.getLengthInBits() + ">" + (totalDataCount * 8) + ")");
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
    while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);
    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) break;
      buffer.put(0xec, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) break;
      buffer.put(0x11, 8);
    }
    return QRCodeModel.createBytes(buffer, rsBlocks);
  };

  QRCodeModel.createBytes = function (buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r++) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i++) dcdata[r][i] = 0xff & buffer.buffer[i + offset];
      offset += dcCount;
      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i++) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = (modIndex >= 0) ? modPoly.getAt(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i++) totalCodeCount += rsBlocks[i].totalCount;
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < dcdata[r].length) data[index++] = dcdata[r][i];
      }
    }
    for (let i = 0; i < maxEcCount; i++) {
      for (let r = 0; r < rsBlocks.length; r++) {
        if (i < ecdata[r].length) data[index++] = ecdata[r][i];
      }
    }
    return data;
  };

  // ── SOUND FEEDBACK ────────────────────────────────────────────────────────
  function playBeepSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 high beep
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } catch (e) {
      // Audio autoplay policy might restrict if not user-interacted, safe to ignore
    }
  }

  // ── PUBLIC QR CLIENT OBJECT ───────────────────────────────────────────────
  const QRClient = {
    activeStream: null,
    scanIntervalId: null,

    /**
     * Generate pure SVG string for a given text
     */
    generateSvg(text, { size = 200, margin = 2, color = "#14432A", bgColor = "#FFFFFF" } = {}) {
      if (!text) text = "ecomply:empty";
      const q = new QRCodeModel(0, 1); // error level L
      q.addData(String(text));
      q.make();
      const count = q.getModuleCount();
      const total = count + margin * 2;
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges">`;
      if (bgColor) {
        svg += `<rect width="${total}" height="${total}" fill="${bgColor}"/>`;
      }
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (q.isDark(r, c)) {
            svg += `<rect x="${c + margin}" y="${r + margin}" width="1" height="1" fill="${color}"/>`;
          }
        }
      }
      svg += `</svg>`;
      return svg;
    },

    /**
     * Generate HTML Canvas Data URL (PNG)
     */
    generateDataUrl(text, { size = 300, margin = 3, color = "#14432A", bgColor = "#FFFFFF" } = {}) {
      if (typeof document === "undefined") return "";
      const q = new QRCodeModel(0, 1);
      q.addData(String(text || ""));
      q.make();
      const count = q.getModuleCount();
      const total = count + margin * 2;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, size, size);

      const cell = size / total;
      ctx.fillStyle = color;
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (q.isDark(r, c)) {
            const x = Math.round((c + margin) * cell);
            const y = Math.round((r + margin) * cell);
            const w = Math.ceil(cell);
            const h = Math.ceil(cell);
            ctx.fillRect(x, y, w, h);
          }
        }
      }
      return canvas.toDataURL("image/png");
    },

    /**
     * Standardized QR Payload string for any User or Student
     */
    getUserQrPayload(user) {
      if (!user) return "";
      const id = String(user.id || "");
      const username = user.username || "";
      const idNum = user.student_number || user.student_no || user.employee_id || user.employee_no || "";
      const name = `${user.first_name || ""} ${user.last_name || ""}`.trim();
      const role = user.designation || (user.student_no || user.section_id || user.section ? "Student" : "Faculty");
      const campus = user.campus_name || user.campus || "Main Campus";

      return JSON.stringify({
        sys: "ESSU_E_COMPLY",
        v: 1,
        id: id,
        username: username,
        id_num: idNum,
        name: name,
        role: role,
        campus: campus
      });
    },

    /**
     * Parse and extract identifying info from scanned QR string
     */
    parseUserQrPayload(str) {
      if (!str) return null;
      str = String(str).trim();
      try {
        if (str.startsWith("{") && str.endsWith("}")) {
          const parsed = JSON.parse(str);
          return {
            id: String(parsed.id || parsed.user_id || ""),
            username: parsed.username || "",
            id_num: parsed.id_num || parsed.student_number || parsed.employee_id || "",
            name: parsed.name || "",
            role: parsed.role || "",
            campus: parsed.campus || ""
          };
        }
      } catch (e) {}

      // Pattern: ecomply:user:123 or ecomply:id:123 or ecomply:student:123
      const prefixMatch = str.match(/^ecomply:(?:user|student|id):([^:]+)/i);
      if (prefixMatch) {
        return { id: prefixMatch[1] };
      }

      // Plain numeric / alphanumeric ID
      return { id: str };
    },

    parseUserQr(str) {
      return this.parseUserQrPayload(str);
    },

    /**
     * Official Sample School ID Credentials for every university entity
     */
    SAMPLE_ENTITIES: {
      student: {
        id: "sample-student-01",
        entity_key: "student",
        entity_title: "Student",
        first_name: "Juan",
        middle_initial: "D",
        last_name: "Dela Cruz",
        username: "juan.delacruz",
        student_number: "2023-10482",
        designation: "Student",
        role: "student",
        academic_course_name: "BS Information Technology",
        course_code: "BSIT",
        section_name: "BSIT-3A",
        department: "Department of Computer Studies",
        college: "College of Computer Studies",
        campus_name: "Main Campus (Borongan)",
        campus: "Main Campus",
        blood_type: "O+",
        valid_until: "A.Y. 2025-2026",
        emergency_contact: "Maria Dela Cruz · 0917-555-0192",
        address: "Brgy. Songco, Borongan City, Eastern Samar",
        role_color: "#1F6F4A",
        role_bg: "#E1EEE6",
        role_badge: "Undergraduate Student",
        card_theme: "emerald",
        initials: "JD"
      },
      faculty: {
        id: "sample-faculty-01",
        entity_key: "faculty",
        entity_title: "Faculty",
        first_name: "Maria Elena",
        middle_initial: "S",
        last_name: "Santos",
        title_prefix: "Engr.",
        username: "maria.santos",
        employee_id: "ESSU-FAC-2018-042",
        designation: "Faculty",
        role: "staff",
        department: "Department of Information Technology",
        college: "College of Computer Studies",
        campus_name: "Main Campus (Borongan)",
        campus: "Main Campus",
        academic_rank: "Assistant Professor III",
        blood_type: "A+",
        valid_until: "June 2026",
        emergency_contact: "Carlos Santos · 0918-555-0234",
        address: "Brgy. Buntay, Borongan City, Eastern Samar",
        role_color: "#1E40AF",
        role_bg: "#E5EDF9",
        role_badge: "Academic Faculty / Instructor",
        card_theme: "blue",
        initials: "MS"
      },
      depthead: {
        id: "sample-depthead-01",
        entity_key: "depthead",
        entity_title: "Department Head",
        first_name: "Roberto",
        middle_initial: "C",
        last_name: "Tan",
        title_prefix: "Dr.",
        username: "roberto.tan",
        employee_id: "ESSU-DH-2015-018",
        designation: "Department Head",
        role: "staff",
        department: "Department of Information Technology",
        college: "College of Computer Studies",
        campus_name: "Main Campus (Borongan)",
        campus: "Main Campus",
        academic_rank: "Associate Professor / IT Chairperson",
        blood_type: "B+",
        valid_until: "June 2026",
        emergency_contact: "Elena Tan · 0919-555-0872",
        address: "Brgy. Alang-alang, Borongan City, Eastern Samar",
        role_color: "#8A6A0C",
        role_bg: "#FBF3D9",
        role_badge: "Department Chairperson",
        card_theme: "amber",
        initials: "RT"
      },
      dean: {
        id: "sample-dean-01",
        entity_key: "dean",
        entity_title: "College Dean",
        first_name: "Remedios",
        middle_initial: "M",
        last_name: "Mendoza",
        title_prefix: "Dr.",
        username: "remedios.mendoza",
        employee_id: "ESSU-DEAN-2012-005",
        designation: "Dean",
        role: "staff",
        department: "Office of the College Dean",
        college: "College of Computer Studies",
        campus_name: "Main Campus (Borongan)",
        campus: "Main Campus",
        academic_rank: "University Professor / College Dean",
        blood_type: "AB+",
        valid_until: "June 2027",
        emergency_contact: "Arthur Mendoza · 0920-555-0451",
        address: "Brgy. Taboc, Borongan City, Eastern Samar",
        role_color: "#14432A",
        role_bg: "#DFF0E5",
        role_badge: "College Dean",
        card_theme: "forest",
        initials: "RM"
      },
      campusadmin: {
        id: "sample-campusadmin-01",
        entity_key: "campusadmin",
        entity_title: "Campus Administrator",
        first_name: "Gabriel",
        middle_initial: "P",
        last_name: "Reyes",
        title_prefix: "Prof.",
        username: "gabriel.reyes",
        employee_id: "ESSU-ADMIN-2014-009",
        designation: "Campus Administrator",
        role: "staff",
        department: "Office of the Campus Administrator",
        college: "Guiuan Campus Administration",
        campus_name: "Guiuan Campus",
        campus: "Guiuan Campus",
        academic_rank: "Campus Executive Administrator",
        blood_type: "O+",
        valid_until: "June 2027",
        emergency_contact: "Sonia Reyes · 0921-555-0789",
        address: "Guiuan, Eastern Samar",
        role_color: "#8A3420",
        role_bg: "#FBEAE4",
        role_badge: "Campus Administrator",
        card_theme: "ruby",
        initials: "GR"
      },
      qa: {
        id: "sample-qa-01",
        entity_key: "qa",
        entity_title: "Quality Assurance",
        first_name: "Cynthia",
        middle_initial: "L",
        last_name: "Navarro",
        title_prefix: "Dr.",
        username: "cynthia.navarro",
        employee_id: "ESSU-QA-2016-021",
        designation: "Quality Assurance",
        role: "staff",
        department: "Institutional Quality Assurance Office",
        college: "Quality Assurance & Accreditation",
        campus_name: "Main Campus (Borongan)",
        campus: "Main Campus",
        academic_rank: "Director for Quality Assurance",
        blood_type: "A+",
        valid_until: "June 2026",
        emergency_contact: "Victor Navarro · 0922-555-0678",
        address: "Brgy. Campesao, Borongan City, Eastern Samar",
        role_color: "#6B21A8",
        role_bg: "#F3E8FF",
        role_badge: "QA Officer / Lead Auditor",
        card_theme: "purple",
        initials: "CN"
      },
      superadmin: {
        id: "sample-superadmin-01",
        entity_key: "superadmin",
        entity_title: "Super Admin",
        first_name: "Alexander",
        middle_initial: "T",
        last_name: "Gomez",
        title_prefix: "Engr.",
        username: "alexander.gomez",
        employee_id: "ESSU-SYS-2020-001",
        designation: "Super Admin",
        role: "staff",
        department: "Management Information Systems (MIS)",
        college: "ICT & University Systems Center",
        campus_name: "Main Campus (Borongan)",
        campus: "Main Campus",
        academic_rank: "MIS Director / University Super Admin",
        blood_type: "O+",
        valid_until: "Permanent Authority",
        emergency_contact: "Patricia Gomez · 0923-555-0321",
        address: "Borongan City, Eastern Samar",
        role_color: "#D9A62C",
        role_bg: "#FBF3D9",
        role_badge: "System Super Administrator",
        card_theme: "gold",
        initials: "AG"
      }
    },

    getSampleEntities() {
      return Object.values(this.SAMPLE_ENTITIES);
    },

    /**
     * Close any open scanner or ID modal and terminate active camera streams
     */
    closeModal() {
      if (this.scanIntervalId) {
        clearInterval(this.scanIntervalId);
        this.scanIntervalId = null;
      }
      if (this.activeStream) {
        this.activeStream.getTracks().forEach((track) => track.stop());
        this.activeStream = null;
      }
      const existingScanner = document.getElementById("qrScannerModalOverlay");
      if (existingScanner) existingScanner.remove();
      const existingIdCard = document.getElementById("qrIdCardModalOverlay");
      if (existingIdCard) existingIdCard.remove();
      const existingSample = document.getElementById("sampleSchoolIdModalOverlay");
      if (existingSample) existingSample.remove();
    },

    /**
     * Open interactive QR Code Scanner Modal (Webcam Camera + File Upload + Manual ID fallback)
     * Includes dual tab to switch to ZKTeco Live20R Fingerprint verification seamlessly.
     */
    openScannerModal({
      title = "Scan Digital ID / QR Code",
      subtitle = "Position student or faculty QR code within the scanner viewfinder.",
      candidates = [],
      allowSwitchToBio = true,
      onMatch,
      onSuccess,
      onError,
      onClose
    } = {}) {
      this.closeModal();

      const overlay = document.createElement("div");
      overlay.id = "qrScannerModalOverlay";
      overlay.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-fade-in";

      overlay.innerHTML = `
        <div class="bg-white border border-[#E3DFC8] rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl relative text-[#1B2116] flex flex-col max-h-[92vh] overflow-y-auto">
          
          <!-- Header -->
          <div class="flex items-center justify-between pb-3 border-b border-[#EFEBDB] mb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-[#14432A]/10 flex items-center justify-center text-[#14432A]">
                <img src="ICON/qr.svg" class="w-4 h-4" alt="">
              </div>
              <div>
                <h3 class="font-display font-bold text-sm text-[#14432A] leading-tight">${title}</h3>
                <p class="text-[11px] text-[#6B7060]">${subtitle}</p>
              </div>
            </div>
            <button id="qrScannerCloseBtn" class="text-xs text-[#8A8D93] hover:text-[#1B2116] p-1.5 rounded-lg hover:bg-[#FAF7EF] transition" aria-label="Close scanner"><img src="ICON/close.svg" class="w-3.5 h-3.5" alt="Close"></button>
          </div>

          <!-- Dual Verification Switcher Tabs (Fingerprint vs QR Code) -->
          ${allowSwitchToBio ? `
          <div class="flex rounded-xl bg-[#FAF7EF] p-1 border border-[#DEDACE] mb-3">
            <button type="button" id="qrTopSwitchToBioBtn" class="flex-1 py-1.5 text-xs font-semibold rounded-lg text-[#14432A] hover:bg-white/60 transition flex items-center justify-center gap-1.5">
              <img src="ICON/biometric.svg" class="w-3.5 h-3.5" alt=""> Use Fingerprint
            </button>
            <button type="button" class="flex-1 py-1.5 text-xs font-bold rounded-lg bg-[#14432A] text-white shadow-xs flex items-center justify-center gap-1.5">
              <img src="ICON/qr.svg" class="w-3.5 h-3.5 invert" alt=""> Use QR Code (Active)
            </button>
          </div>
          ` : ""}

          <!-- Live Camera Viewfinder -->
          <div class="relative w-full aspect-square max-w-[280px] mx-auto rounded-2xl overflow-hidden bg-black flex items-center justify-center shadow-inner border-2 border-[#14432A]">
            <video id="qrScannerVideo" playsinline autoplay muted class="w-full h-full object-cover"></video>
            <canvas id="qrScannerCanvas" class="hidden"></canvas>

            <!-- Animated Targeting HUD -->
            <div class="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
              <div class="relative w-full h-full border-2 border-[#D9A62C]/70 rounded-xl shadow-[0_0_15px_rgba(217,166,44,0.4)] flex items-center justify-center">
                <!-- Laser Sweep -->
                <div class="absolute left-2 right-2 h-0.5 bg-[#D9A62C] shadow-[0_0_8px_#D9A62C] animate-pulse" style="animation: qrSweep 2s ease-in-out infinite;"></div>
                <!-- Corner brackets -->
                <div class="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-[#14432A] -mt-1 -ml-1"></div>
                <div class="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-[#14432A] -mt-1 -mr-1"></div>
                <div class="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-[#14432A] -mb-1 -ml-1"></div>
                <div class="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-[#14432A] -mb-1 -mr-1"></div>
              </div>
            </div>

            <!-- Camera Loading / Fallback Notice -->
            <div id="qrCameraNotice" class="absolute inset-0 bg-[#1B2116]/90 text-white flex flex-col items-center justify-center p-4 text-center">
              <img src="ICON/qr.svg" class="w-10 h-10 mb-2 invert opacity-60" alt="">
              <div class="text-xs font-semibold mb-1" id="qrCameraNoticeTitle">Initializing Camera…</div>
              <p class="text-[11px] text-white/70" id="qrCameraNoticeSub">Allow browser camera permissions to scan ID card directly.</p>
            </div>
          </div>

          <style>
            @keyframes qrSweep {
              0% { top: 10%; opacity: 0.3; }
              50% { top: 85%; opacity: 1; }
              100% { top: 10%; opacity: 0.3; }
            }
          </style>

          <!-- Match Status Feedback Box -->
          <div id="qrScanAlert" class="hidden mt-3 p-2.5 rounded-xl text-xs flex items-center gap-2"></div>

          <!-- Actions & Alternative Input Options -->
          <div class="mt-4 space-y-2.5">
            <div class="flex items-center justify-between gap-2">
              <button type="button" id="qrSwitchCameraBtn" class="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#FAF7EF] hover:bg-[#F2EEDD] border border-[#DEDACE] text-[#14432A] text-xs font-semibold py-2 px-3 rounded-xl transition">
                <img src="ICON/sync.svg" class="w-3.5 h-3.5" alt=""> Switch Camera
              </button>
              <label for="qrUploadInput" class="flex-1 cursor-pointer inline-flex items-center justify-center gap-1.5 bg-[#FAF7EF] hover:bg-[#F2EEDD] border border-[#DEDACE] text-[#14432A] text-xs font-semibold py-2 px-3 rounded-xl transition">
                <img src="ICON/form.svg" class="w-3.5 h-3.5" alt=""> Upload Photo
                <input type="file" id="qrUploadInput" accept="image/*" class="hidden">
              </label>
            </div>

            <!-- Manual ID Entry Accordion -->
            <div class="border-t border-[#EFEBDB] pt-2.5">
              <div class="text-[11px] font-semibold text-[#8A6A0C] uppercase tracking-wider mb-1.5">Or Enter User / Student ID Number</div>
              <div class="flex gap-2">
                <input id="qrManualInput" placeholder="Enter ID # or username..." class="flex-1 border border-[#DEDACE] rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-[#D9A62C]">
                <button type="button" id="qrManualVerifyBtn" class="bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">Verify</button>
              </div>
            </div>
          </div>

          <div class="pt-3 border-t border-[#EFEBDB] mt-3 text-center text-[10px] text-[#8A8D93] flex items-center justify-center gap-1.5">
            <img src="ICON/biometric.svg" class="w-3.5 h-3.5 opacity-60" alt="">
            <span>Biometric Alternative: ESSU Digital QR Credential</span>
          </div>

        </div>
      `;

      document.body.appendChild(overlay);

      const video = document.getElementById("qrScannerVideo");
      const canvas = document.getElementById("qrScannerCanvas");
      const notice = document.getElementById("qrCameraNotice");
      const noticeTitle = document.getElementById("qrCameraNoticeTitle");
      const noticeSub = document.getElementById("qrCameraNoticeSub");
      const alertBox = document.getElementById("qrScanAlert");
      const closeBtn = document.getElementById("qrScannerCloseBtn");
      const switchBtn = document.getElementById("qrSwitchCameraBtn");
      const uploadInput = document.getElementById("qrUploadInput");
      const manualInput = document.getElementById("qrManualInput");
      const manualBtn = document.getElementById("qrManualVerifyBtn");
      const topBioBtn = document.getElementById("qrTopSwitchToBioBtn");

      let currentFacingMode = "environment"; // default to rear camera on mobile
      let isProcessing = false;

      // Close handlers
      closeBtn.onclick = () => {
        this.closeModal();
        if (typeof onClose === "function") onClose();
      };
      overlay.onclick = (e) => {
        if (e.target === overlay) {
          this.closeModal();
          if (typeof onClose === "function") onClose();
        }
      };

      if (topBioBtn) {
        topBioBtn.onclick = () => {
          this.closeModal();
          if (typeof window.ZKTeco !== "undefined" && typeof window.ZKTeco.openVerifyModal === "function") {
            window.ZKTeco.openVerifyModal({ title, subtitle, candidates, onMatch, onError, onClose });
          } else {
            alert("ZKTeco Live20R biometric SDK is not loaded.");
          }
        };
      }

      // Match handler
      const processScannedValue = (rawString) => {
        if (isProcessing) return;
        const parsed = this.parseUserQrPayload(rawString);
        if (!parsed || !parsed.id) return;

        isProcessing = true;
        playBeepSound();

        // Check against candidate list if provided
        let matched = null;
        if (candidates && candidates.length > 0) {
          matched = candidates.find((c) => {
            if (!c) return false;
            const cId = String(c.id || "");
            const cUser = String(c.username || "").toLowerCase();
            const cStudentNum = String(c.student_number || c.student_no || "");
            const cEmpNum = String(c.employee_id || c.employee_no || "");

            const pId = String(parsed.id || "");
            const pUser = String(parsed.username || "").toLowerCase();
            const pNum = String(parsed.id_num || "");

            // Match by primary ID
            if (pId && cId === pId) return true;
            // Match by username
            if (pUser && cUser && cUser === pUser) return true;
            if (pId && cUser && cUser === pId.toLowerCase()) return true;
            // Match by Student Number
            if (cStudentNum) {
              if (pNum && cStudentNum === pNum) return true;
              if (pId && cStudentNum === pId) return true;
            }
            // Match by Employee ID
            if (cEmpNum) {
              if (pNum && cEmpNum === pNum) return true;
              if (pId && cEmpNum === pId) return true;
            }
            return false;
          });
        } else {
          matched = parsed;
        }

        if (candidates && candidates.length > 0 && !matched) {
          // Scanned someone not in candidate list
          alertBox.className = "mt-3 p-2.5 rounded-xl text-xs bg-[#FBEAE4] border border-[#E5B4A4] text-[#8A3420] flex items-center gap-2";
          alertBox.innerHTML = `<img src="ICON/delete.svg" class="w-3.5 h-3.5" alt=""> <span>Scanned ID (#${parsed.id}) does not match the required signee or enrolled student.</span>`;
          alertBox.classList.remove("hidden");
          setTimeout(() => { isProcessing = false; }, 2000);
          return;
        }

        // Success!
        alertBox.className = "mt-3 p-2.5 rounded-xl text-xs bg-[#E1EEE6] border border-[#A2D1B8] text-[#1F6F4A] font-semibold flex items-center gap-2";
        const displayName = matched?.first_name ? `${matched.first_name} ${matched.last_name || ""}` : (parsed.name || `User #${parsed.id}`);
        alertBox.innerHTML = `✓ <span>Verified: ${displayName}</span>`;
        alertBox.classList.remove("hidden");

        setTimeout(() => {
          this.closeModal();
          if (typeof onMatch === "function") onMatch(matched, parsed);
          if (typeof onSuccess === "function") onSuccess(rawString, matched, parsed);
        }, 600);
      };

      // Camera initialization
      const startCamera = async (facing) => {
        if (this.activeStream) {
          this.activeStream.getTracks().forEach((t) => t.stop());
          this.activeStream = null;
        }
        notice.classList.remove("hidden");
        noticeTitle.textContent = "Starting Camera…";
        noticeSub.textContent = "Requesting video stream from device…";

        try {
          const constraints = {
            video: {
              facingMode: facing,
              width: { ideal: 640 },
              height: { ideal: 640 }
            }
          };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          this.activeStream = stream;
          video.srcObject = stream;
          await video.play();
          notice.classList.add("hidden");

          // Start detection loop
          startDetectionLoop();
        } catch (err) {
          console.warn("Camera access error:", err);
          notice.classList.remove("hidden");
          noticeTitle.textContent = "Camera Unavailable";
          noticeSub.textContent = "Please allow camera access or use 'Upload Photo' / manual ID input.";
        }
      };

      // BarcodeDetector / Canvas Reader loop
      const startDetectionLoop = () => {
        if (this.scanIntervalId) clearInterval(this.scanIntervalId);

        let barcodeDetector = null;
        if ("BarcodeDetector" in window) {
          try {
            barcodeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
          } catch (e) {
            barcodeDetector = null;
          }
        }

        this.scanIntervalId = setInterval(async () => {
          if (isProcessing) return;
          if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

          try {
            let decodedText = null;

            if (barcodeDetector) {
              try {
                const codes = await barcodeDetector.detect(video);
                if (codes && codes.length > 0 && codes[0].rawValue) {
                  decodedText = codes[0].rawValue;
                }
              } catch (bErr) {}
            }

            if (!decodedText) {
              // Canvas capture fallback with jsQR
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              if (typeof window.jsQR === "function") {
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = window.jsQR(imgData.data, imgData.width, imgData.height, {
                  inversionAttempts: "attemptBoth"
                });
                if (code && code.data) {
                  decodedText = code.data;
                }
              }
            }

            if (decodedText) {
              processScannedValue(decodedText);
            }
          } catch (e) {}
        }, 150);
      };

      // Switch Camera button
      switchBtn.onclick = () => {
        currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
        startCamera(currentFacingMode);
      };

      // File upload scanner
      uploadInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (rev) => {
          const img = new Image();
          img.onload = async () => {
            let decodedText = null;

            if ("BarcodeDetector" in window) {
              try {
                const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
                const barcodes = await detector.detect(img);
                if (barcodes.length > 0 && barcodes[0].rawValue) {
                  decodedText = barcodes[0].rawValue;
                }
              } catch (err) {}
            }

            if (!decodedText) {
              try {
                const offscreenCanvas = document.createElement("canvas");
                offscreenCanvas.width = img.naturalWidth || img.width;
                offscreenCanvas.height = img.naturalHeight || img.height;
                const offCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
                offCtx.drawImage(img, 0, 0);
                if (typeof window.jsQR === "function") {
                  const imgData = offCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
                  const code = window.jsQR(imgData.data, imgData.width, imgData.height, {
                    inversionAttempts: "attemptBoth"
                  });
                  if (code && code.data) {
                    decodedText = code.data;
                  }
                }
              } catch (canvasErr) {
                console.warn("Canvas QR decode notice:", canvasErr);
              }
            }

            if (decodedText) {
              processScannedValue(decodedText);
              return;
            }

            alertBox.className = "mt-3 p-2.5 rounded-xl text-xs bg-[#FBEAE4] border border-[#E5B4A4] text-[#8A3420]";
            alertBox.textContent = "Could not find a valid QR Code in this photo. Try another picture or enter your ID manually.";
            alertBox.classList.remove("hidden");
          };
          img.src = rev.target.result;
        };
        reader.readAsDataURL(file);
      };

      // Manual input handler
      manualBtn.onclick = () => {
        const val = manualInput.value.trim();
        if (!val) return;
        processScannedValue(val);
      };
      manualInput.onkeydown = (e) => {
        if (e.key === "Enter") manualBtn.click();
      };

      // Auto start camera
      startCamera(currentFacingMode);
    },

    /**
     * Render HTML card markup for Front and Back of an ESSU School ID
     */
    renderIdCardHtml(user, { isBack = false } = {}) {
      if (!user) return "";
      const qrPayload = this.getUserQrPayload(user);
      const qrDataUrl = this.generateDataUrl(qrPayload, { size: 300, color: "#14432A" });
      const fullName = `${user.last_name || ""}, ${user.first_name || ""} ${user.middle_initial ? user.middle_initial + "." : ""}`.trim();
      const prefix = user.title_prefix ? `${user.title_prefix} ` : "";
      const role = user.designation || (user.student_no || user.section_id || user.section ? "Student" : "Faculty");
      const idNum = user.student_number || user.student_no || user.employee_id || user.employee_no || `ESSU-${user.id}`;
      const campus = user.campus_name || user.campus || "Main Campus";
      const department = user.department_name || user.department || user.academic_rank || "Academic Department";
      const college = user.college_name || user.college || "";
      const programOrSec = user.section_name || user.section || user.academic_course_name || user.course_code || "";
      const validUntil = user.valid_until || "A.Y. 2025-2026";
      const bloodType = user.blood_type || "O+";
      const emergencyContact = user.emergency_contact || "Emergency Contact On File";
      const address = user.address || "Borongan City, Eastern Samar";

      // Card color themes
      let badgeBg = "bg-[#14432A]";
      let badgeText = "text-white";
      if (role.includes("Super Admin")) { badgeBg = "bg-[#D9A62C]"; badgeText = "text-[#14432A]"; }
      else if (role.includes("Dean")) { badgeBg = "bg-[#14432A]"; badgeText = "text-white"; }
      else if (role.includes("Department Head")) { badgeBg = "bg-[#8A6A0C]"; badgeText = "text-white"; }
      else if (role.includes("Faculty")) { badgeBg = "bg-[#1E40AF]"; badgeText = "text-white"; }
      else if (role.includes("Campus Admin")) { badgeBg = "bg-[#8A3420]"; badgeText = "text-white"; }
      else if (role.includes("Quality Assurance")) { badgeBg = "bg-[#6B21A8]"; badgeText = "text-white"; }
      else if (role.includes("Student")) { badgeBg = "bg-[#1F6F4A]"; badgeText = "text-white"; }

      if (isBack) {
        // Back of ID Card
        return `
          <div class="essu-id-back w-full bg-[#FAF8F1] border-2 border-[#14432A] rounded-2xl p-4 shadow-md flex flex-col items-center text-center relative overflow-hidden min-h-[460px]">
            <div class="absolute top-0 left-0 right-0 h-2 bg-[#D9A62C]"></div>

            <div class="text-[9px] font-bold tracking-wider text-[#14432A] uppercase mt-1">Republic of the Philippines</div>
            <div class="text-[11px] font-display font-bold text-[#14432A] uppercase leading-tight">Eastern Samar State University</div>
            <div class="text-[8px] text-[#6B7060] font-mono mt-0.5">${campus}</div>

            <!-- Scannable High-Res QR Code -->
            <div class="bg-white border-2 border-[#DEDACE] rounded-xl p-2 shadow-xs my-2.5 flex flex-col items-center">
              <img src="${qrDataUrl}" class="w-32 h-32 object-contain" alt="QR Credential">
              <span class="text-[9px] font-mono text-[#8A6A0C] font-bold mt-1 tracking-wider">${idNum}</span>
            </div>

            <!-- Simulated Barcode -->
            <div class="w-full px-4 mb-2 flex flex-col items-center">
              <div class="h-6 w-44 bg-[repeating-linear-gradient(90deg,#14432A,#14432A_2px,transparent_2px,transparent_4px,#14432A_4px,#14432A_7px,transparent_7px,transparent_8px)] opacity-85"></div>
              <div class="text-[8px] font-mono text-[#6B7060] tracking-widest mt-0.5">ESSU*${idNum}*SEC</div>
            </div>

            <!-- Info block -->
            <div class="w-full text-left bg-white border border-[#E3DFC8] rounded-lg p-2 text-[9px] space-y-0.5 mb-2">
              <div><span class="font-bold text-[#14432A]">Address:</span> <span class="text-[#52555C]">${address}</span></div>
              <div><span class="font-bold text-[#14432A]">Blood Type:</span> <span class="text-[#52555C] font-mono">${bloodType}</span> &nbsp; <span class="font-bold text-[#14432A]">Valid Until:</span> <span class="text-[#1F6F4A] font-semibold">${validUntil}</span></div>
              <div><span class="font-bold text-[#14432A]">Emergency:</span> <span class="text-[#52555C]">${emergencyContact}</span></div>
            </div>

            <!-- Certification & Signature -->
            <div class="text-[8px] text-[#6B7060] leading-tight mb-2 px-1">
              This card certifies that the bearer is a bonafide member of Eastern Samar State University. Loss of this card must be reported immediately.
            </div>

            <div class="mt-auto pt-1 w-full border-t border-[#DEDACE] flex justify-around items-end text-center">
              <div>
                <div class="font-serif italic text-[9px] text-[#14432A] font-bold">Andres C. Pagatpatan Jr.</div>
                <div class="text-[7.5px] uppercase tracking-wider text-[#6B7060]">University President</div>
              </div>
              <div>
                <div class="font-serif italic text-[9px] text-[#14432A] font-bold">Office of the Registrar</div>
                <div class="text-[7.5px] uppercase tracking-wider text-[#6B7060]">Validated / Certified</div>
              </div>
            </div>

            <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-[#D9A62C]"></div>
          </div>
        `;
      }

      // Front of ID Card
      return `
        <div class="essu-id-front w-full bg-gradient-to-b from-[#FAF7EF] via-[#FFFFFF] to-[#FCFBF6] border-2 border-[#14432A] rounded-2xl p-4 shadow-md flex flex-col items-center text-center relative overflow-hidden min-h-[460px]">
          <!-- Top Gold Accent Line -->
          <div class="absolute top-0 left-0 right-0 h-2 bg-[#D9A62C]"></div>

          <!-- University Header -->
          <div class="flex items-center gap-2 mb-2.5 mt-1">
            <img src="ICON/ESSU.png" class="w-10 h-10 object-contain drop-shadow-xs" alt="ESSU">
            <div class="text-left">
              <div class="text-[8.5px] font-bold tracking-wider text-[#6B7060] uppercase leading-tight">Republic of the Philippines</div>
              <div class="text-[10.5px] font-display font-bold text-[#14432A] uppercase leading-tight">Eastern Samar State University</div>
              <div class="text-[8.5px] text-[#8A6A0C] font-semibold tracking-wide uppercase">${campus}</div>
            </div>
          </div>

          <!-- Ribbon Divider -->
          <div class="w-full h-1 bg-gradient-to-r from-[#14432A] via-[#D9A62C] to-[#14432A] rounded-full mb-3"></div>

          <!-- Avatar / Photo with Gold Rim -->
          <div class="relative mb-2">
            <div class="w-22 h-22 rounded-full border-3 border-[#D9A62C] bg-[#14432A] text-white flex items-center justify-center font-display font-bold text-2xl overflow-hidden shadow-sm">
              ${user.profile_picture ? `<img src="${user.profile_picture}" class="w-full h-full object-cover">` : ((user.first_name?.[0] || "") + (user.last_name?.[0] || "")).toUpperCase()}
            </div>
            <!-- Security Hologram Badge -->
            <div class="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[#D9A62C] text-[#14432A] border-2 border-white flex items-center justify-center shadow-xs" title="Live20R & QR Verified">
              <img src="ICON/biometric.svg" class="w-3.5 h-3.5" alt="">
            </div>
          </div>

          <!-- Name & Role -->
          <div class="font-display font-bold text-base text-[#14432A] leading-snug px-1">
            ${prefix}${fullName}
          </div>
          <div class="inline-block ${badgeBg} ${badgeText} text-[10px] font-bold uppercase px-3 py-0.5 rounded-full mt-1 mb-2 tracking-wider shadow-2xs">
            ${role}
          </div>

          <!-- Program / Department / College -->
          <div class="text-xs text-[#1B2116] font-semibold px-2">${programOrSec ? `${programOrSec} · ` : ""}${department}</div>
          ${college ? `<div class="text-[10px] text-[#6B7060]">${college}</div>` : ""}

          <!-- ID Number Tag -->
          <div class="mt-2 mb-1 px-3 py-1 rounded-lg bg-[#FAF7EF] border border-[#DEDACE]">
            <div class="text-[8px] uppercase tracking-wider text-[#8A8D93] font-semibold leading-none">ID Number</div>
            <div class="text-xs text-[#8A6A0C] font-mono font-bold mt-0.5 tracking-wider">${idNum}</div>
          </div>

          <!-- Verification Chip Stamp -->
          <div class="mt-auto pt-2 pb-1 text-[9.5px] text-[#1F6F4A] font-semibold flex items-center gap-1.5 border-t border-[#EFEBDB] w-full justify-center">
            <span class="w-2 h-2 rounded-full bg-[#248A54] animate-pulse"></span>
            <span>Live20R Biometric & QR Verified</span>
            <span class="text-[#8A8D93] text-[9px]">· ${validUntil}</span>
          </div>

          <!-- Bottom Gold Accent Line -->
          <div class="absolute bottom-0 left-0 right-0 h-1.5 bg-[#D9A62C]"></div>
        </div>
      `;
    },

    /**
     * Open Sample School ID Modal featuring official interactive IDs for EVERY entity
     */
    openSampleSchoolIdModal(initialEntity = "student") {
      this.closeModal();

      let activeKey = initialEntity || "student";
      let showBackView = false;

      const overlay = document.createElement("div");
      overlay.id = "sampleSchoolIdModalOverlay";
      overlay.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 sm:p-4 animate-fade-in";

      overlay.innerHTML = `
        <div class="bg-white border border-[#E3DFC8] rounded-3xl max-w-lg w-full p-5 sm:p-6 shadow-2xl relative text-[#1B2116] flex flex-col max-h-[95vh] overflow-y-auto">
          
          <!-- Header -->
          <div class="flex items-center justify-between pb-3 border-b border-[#EFEBDB] mb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-[#14432A] text-white flex items-center justify-center shadow-xs">
                <img src="ICON/ESSU.png" class="w-7 h-7 object-contain" alt="ESSU">
              </div>
              <div>
                <h3 class="font-display font-bold text-base text-[#14432A] leading-tight">Official ESSU Sample School IDs</h3>
                <p class="text-[11px] text-[#6B7060]">Digital University ID Credentials for Every Campus Entity</p>
              </div>
            </div>
            <button id="sampleIdCloseBtn" class="text-xs text-[#8A8D93] hover:text-[#1B2116] p-1.5 rounded-lg hover:bg-[#FAF7EF] transition" aria-label="Close dialog"><img src="ICON/close.svg" class="w-4 h-4" alt="Close"></button>
          </div>

          <!-- Entity Switcher Tabs -->
          <div class="mb-3.5">
            <div class="text-[10.5px] font-semibold text-[#8A6A0C] uppercase tracking-wider mb-1.5">Select University Entity to Preview:</div>
            <div class="flex flex-wrap gap-1.5" id="sampleEntityTabsContainer">
              ${Object.values(this.SAMPLE_ENTITIES).map((ent) => `
                <button type="button" data-key="${ent.entity_key}" class="sample-entity-pill px-2.5 py-1 rounded-lg text-xs font-semibold transition border ${ent.entity_key === activeKey ? "bg-[#14432A] text-white border-[#14432A] shadow-xs" : "bg-[#FAF7EF] text-[#52555C] border-[#DEDACE] hover:bg-[#F2EEDD]"}">
                  ${ent.entity_title}
                </button>
              `).join("")}
            </div>
          </div>

          <!-- Flip Toggle Bar -->
          <div class="flex items-center justify-between mb-3 px-1">
            <div class="text-xs font-bold text-[#14432A] flex items-center gap-1.5">
              <span id="sampleActiveRoleTag" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E1EEE6] text-[#1F6F4A]">Student Credential</span>
              <span class="text-[11px] text-[#6B7060]" id="sampleActiveNameTag">—</span>
            </div>
            <button type="button" id="sampleFlipCardBtn" class="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg border border-[#DEDACE] bg-[#FAF7EF] hover:bg-[#F2EEDD] text-[#14432A] transition shadow-2xs">
              <img src="ICON/sync.svg" class="w-3.5 h-3.5" alt=""> <span id="sampleFlipBtnLabel">Flip to Back (QR Code)</span>
            </button>
          </div>

          <!-- Card Preview Stage -->
          <div class="w-full max-w-[340px] mx-auto transition-all duration-300" id="sampleCardStage">
            <!-- Rendered ID card here -->
          </div>

          <!-- Actions -->
          <div class="w-full flex flex-wrap gap-2 mt-4 pt-3 border-t border-[#EFEBDB]">
            <button type="button" id="sampleDownloadQrBtn" class="flex-1 min-w-[120px] bg-[#FAF7EF] hover:bg-[#F2EEDD] border border-[#DEDACE] text-[#14432A] text-xs font-semibold py-2.5 rounded-xl transition shadow-2xs flex items-center justify-center gap-1.5">
              <img src="ICON/qr.svg" class="w-3.5 h-3.5" alt=""> Download QR
            </button>
            <button type="button" id="samplePrintCardBtn" class="flex-1 min-w-[120px] bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-semibold py-2.5 rounded-xl transition shadow-xs flex items-center justify-center gap-1.5">
              <img src="ICON/print.svg" class="w-3.5 h-3.5 invert" alt=""> Print ID Card
            </button>
            <button type="button" id="sampleTestScannerBtn" class="w-full mt-1 bg-[#FAF7EF] hover:bg-[#F2EEDD] border border-[#DEDACE] text-[#8A6A0C] text-xs font-semibold py-2 rounded-xl transition flex items-center justify-center gap-1.5">
              <img src="ICON/scanner.svg" class="w-3.5 h-3.5" alt=""> Test Camera Scanner on this ID
            </button>
          </div>

        </div>
      `;

      document.body.appendChild(overlay);

      const stage = document.getElementById("sampleCardStage");
      const flipBtn = document.getElementById("sampleFlipCardBtn");
      const flipLabel = document.getElementById("sampleFlipBtnLabel");
      const roleTag = document.getElementById("sampleActiveRoleTag");
      const nameTag = document.getElementById("sampleActiveNameTag");
      const closeBtn = document.getElementById("sampleIdCloseBtn");
      const printBtn = document.getElementById("samplePrintCardBtn");
      const downloadBtn = document.getElementById("sampleDownloadQrBtn");
      const testScanBtn = document.getElementById("sampleTestScannerBtn");
      const tabs = overlay.querySelectorAll(".sample-entity-pill");

      const updateCardView = () => {
        const ent = this.SAMPLE_ENTITIES[activeKey] || this.SAMPLE_ENTITIES.student;
        stage.innerHTML = this.renderIdCardHtml(ent, { isBack: showBackView });
        roleTag.textContent = `${ent.entity_title} ID`;
        nameTag.textContent = `${ent.last_name}, ${ent.first_name}`;
        flipLabel.textContent = showBackView ? "Flip to Front View" : "Flip to Back (QR Code)";

        tabs.forEach((tab) => {
          if (tab.dataset.key === activeKey) {
            tab.className = "sample-entity-pill px-2.5 py-1 rounded-lg text-xs font-semibold transition border bg-[#14432A] text-white border-[#14432A] shadow-xs";
          } else {
            tab.className = "sample-entity-pill px-2.5 py-1 rounded-lg text-xs font-semibold transition border bg-[#FAF7EF] text-[#52555C] border-[#DEDACE] hover:bg-[#F2EEDD]";
          }
        });
      };

      tabs.forEach((tab) => {
        tab.onclick = () => {
          activeKey = tab.dataset.key;
          updateCardView();
        };
      });

      flipBtn.onclick = () => {
        showBackView = !showBackView;
        updateCardView();
      };

      closeBtn.onclick = () => this.closeModal();
      overlay.onclick = (e) => {
        if (e.target === overlay) this.closeModal();
      };

      downloadBtn.onclick = () => {
        const ent = this.SAMPLE_ENTITIES[activeKey] || this.SAMPLE_ENTITIES.student;
        const payload = this.getUserQrPayload(ent);
        const dataUrl = this.generateDataUrl(payload, { size: 350 });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `ESSU_${ent.entity_key.toUpperCase()}_SAMPLE_ID_QR.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      printBtn.onclick = () => {
        const ent = this.SAMPLE_ENTITIES[activeKey] || this.SAMPLE_ENTITIES.student;
        const frontHtml = this.renderIdCardHtml(ent, { isBack: false });
        const backHtml = this.renderIdCardHtml(ent, { isBack: true });

        const printWin = window.open("", "_blank", "width=700,height=800");
        printWin.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>ESSU Sample School ID - ${ent.entity_title}</title>
            <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
            <style>
              body { font-family: system-ui, sans-serif; background: #fff; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
              @media print {
                body { padding: 0; min-height: auto; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body>
            <div class="no-print text-center mb-4 text-xs text-gray-500 font-mono">
              Eastern Samar State University · Official ID Print Sheet (${ent.entity_title})
            </div>
            <div style="display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; max-width: 720px;">
              <div style="width: 320px;">${frontHtml}</div>
              <div style="width: 320px;">${backHtml}</div>
            </div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(() => window.close(), 1200);
              };
            </script>
          </body>
          </html>
        `);
        printWin.document.close();
      };

      testScanBtn.onclick = () => {
        const ent = this.SAMPLE_ENTITIES[activeKey] || this.SAMPLE_ENTITIES.student;
        this.openScannerModal({
          title: `Scan ${ent.entity_title} QR Code`,
          subtitle: `Testing camera detection with ${ent.first_name} ${ent.last_name}'s sample credential.`,
          candidates: [ent],
          onMatch: (matched) => {
            alert(`✓ Verification successful! Verified entity: ${matched.first_name} ${matched.last_name} (${matched.designation})`);
          }
        });
      };

      updateCardView();
    },

    /**
     * Open Official ESSU Digital ID Card Modal for ANY user or student
     */
    openIdCardModal(arg = {}) {
      this.closeModal();
      const user = (arg && arg.user) ? arg.user : (arg && (arg.id || arg.first_name || arg.last_name) ? arg : null);
      const onClose = (arg && arg.onClose) ? arg.onClose : null;
      if (!user) return;

      let showBack = false;

      const overlay = document.createElement("div");
      overlay.id = "qrIdCardModalOverlay";
      overlay.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-3 sm:p-4 animate-fade-in";

      overlay.innerHTML = `
        <div class="bg-white border border-[#E3DFC8] rounded-3xl max-w-sm w-full p-5 sm:p-6 shadow-2xl relative text-[#1B2116] flex flex-col items-center max-h-[95vh] overflow-y-auto">
          
          <!-- Top Row: Title + Flip & Close Buttons -->
          <div class="w-full flex items-center justify-between mb-3 pb-2 border-b border-[#EFEBDB]">
            <div class="flex items-center gap-1.5 text-xs font-bold text-[#14432A]">
              <img src="ICON/ESSU.png" class="w-4 h-4 object-contain" alt="">
              <span>Official Digital ID Card</span>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" id="qrFlipToggleBtn" class="text-[11px] font-semibold text-[#8A6A0C] hover:underline flex items-center gap-1">
                <img src="ICON/sync.svg" class="w-3 h-3" alt=""> <span id="qrFlipToggleLabel">Flip to Back</span>
              </button>
              <button id="qrIdCloseBtn" class="text-xs text-[#8A8D93] hover:text-[#1B2116] p-1.5 rounded-lg hover:bg-[#FAF7EF] transition" aria-label="Close dialog"><img src="ICON/close.svg" class="w-3.5 h-3.5" alt="Close"></button>
            </div>
          </div>

          <!-- Printable Card Frame -->
          <div id="essuPrintableIdCardStage" class="w-full flex items-center justify-center">
            ${this.renderIdCardHtml(user, { isBack: showBack })}
          </div>

          <!-- Action buttons -->
          <div class="w-full flex gap-2.5 mt-4">
            <button type="button" id="qrDownloadBtn" class="flex-1 bg-[#FAF7EF] hover:bg-[#F2EEDD] border border-[#DEDACE] text-[#14432A] text-xs font-semibold py-2.5 rounded-xl transition shadow-2xs flex items-center justify-center gap-1.5">
              <img src="ICON/qr.svg" class="w-3.5 h-3.5" alt=""> Download QR
            </button>
            <button type="button" id="qrPrintIdBtn" class="flex-1 bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-semibold py-2.5 rounded-xl transition shadow-xs flex items-center justify-center gap-1.5">
              <img src="ICON/print.svg" class="w-3.5 h-3.5 invert" alt=""> Print ID Card
            </button>
          </div>

        </div>
      `;

      document.body.appendChild(overlay);

      const closeBtn = document.getElementById("qrIdCloseBtn");
      const downloadBtn = document.getElementById("qrDownloadBtn");
      const printBtn = document.getElementById("qrPrintIdBtn");
      const flipBtn = document.getElementById("qrFlipToggleBtn");
      const flipLabel = document.getElementById("qrFlipToggleLabel");
      const stage = document.getElementById("essuPrintableIdCardStage");

      const updateView = () => {
        stage.innerHTML = this.renderIdCardHtml(user, { isBack: showBack });
        flipLabel.textContent = showBack ? "Flip to Front" : "Flip to Back";
      };

      flipBtn.onclick = () => {
        showBack = !showBack;
        updateView();
      };

      closeBtn.onclick = () => {
        this.closeModal();
        if (typeof onClose === "function") onClose();
      };
      overlay.onclick = (e) => {
        if (e.target === overlay) {
          this.closeModal();
          if (typeof onClose === "function") onClose();
        }
      };

      downloadBtn.onclick = () => {
        const qrPayload = this.getUserQrPayload(user);
        const qrDataUrl = this.generateDataUrl(qrPayload, { size: 350, color: "#14432A" });
        const a = document.createElement("a");
        a.href = qrDataUrl;
        a.download = `ESSU_ID_${user.username || user.id}_QR.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };

      printBtn.onclick = () => {
        const frontHtml = this.renderIdCardHtml(user, { isBack: false });
        const backHtml = this.renderIdCardHtml(user, { isBack: true });
        const fullName = `${user.last_name || ""}, ${user.first_name || ""}`.trim();

        const printWin = window.open("", "_blank", "width=700,height=800");
        printWin.document.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>ESSU Digital ID - ${fullName}</title>
            <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
            <style>
              body { font-family: system-ui, sans-serif; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
              @media print {
                body { padding: 0; min-height: auto; }
                .no-print { display: none; }
              }
            </style>
          </head>
          <body>
            <div class="no-print text-center mb-4 text-xs text-gray-500 font-mono">
              Eastern Samar State University · Official ID Print Sheet
            </div>
            <div style="display: flex; gap: 20px; flex-wrap: wrap; justify-content: center; max-width: 720px;">
              <div style="width: 320px;">${frontHtml}</div>
              <div style="width: 320px;">${backHtml}</div>
            </div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(() => window.close(), 1200);
              };
            </script>
          </body>
          </html>
        `);
        printWin.document.close();
      };
    }
  };

  // Auto-load pure JS client-side decoder (jsqr.min.js) if not loaded yet
  if (typeof window !== "undefined" && typeof window.jsQR === "undefined") {
    const s = document.createElement("script");
    s.src = "jsqr.min.js";
    s.onerror = () => {
      const cdn = document.createElement("script");
      cdn.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
      document.head.appendChild(cdn);
    };
    document.head.appendChild(s);
  }

  window.QRClient = QRClient;
})();
