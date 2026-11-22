(() => {
  'use strict';

  const GAME = (window.GAME = window.GAME || {});

  // =========================================================================
  // 1. CORE CONSTANTS, SEEDED RNG & COLOR/MATH UTILITIES
  // =========================================================================
  GAME.PIXEL_W = 480;
  GAME.PIXEL_H = 270;
  GAME.TILE_SIZE = 16;
  GAME.FIXED_DT = 1 / 60;

  const BAYER4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5]
  ];
  GAME.BAYER4 = BAYER4;

  class SeededRNG {
    constructor(seed = 1337) {
      this.s = seed >>> 0;
      if (this.s === 0) this.s = 0x6d2b79f5;
    }
    next() {
      let t = (this.s += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(min, max) {
      return min + this.next() * (max - min);
    }
    int(min, max) {
      return Math.floor(this.range(min, max + 1));
    }
    chance(p) {
      return this.next() < p;
    }
    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    }
  }
  GAME.SeededRNG = SeededRNG;

  function hash2D(x, y, seed = 42) {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  GAME.hash2D = hash2D;

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }
  GAME.clamp = clamp;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  GAME.lerp = lerp;

  function hexToRgb(hex) {
    const clean = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    const n = parseInt(clean, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  GAME.hexToRgb = hexToRgb;

  function createOffscreen(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { canvas: c, ctx };
  }
  GAME.createOffscreen = createOffscreen;

  function bayerCheck(x, y, threshold) {
    return (BAYER4[y & 3][x & 3] + 0.5) / 16 < threshold;
  }
  GAME.bayerCheck = bayerCheck;

  function valueNoise1D(t, seed = 17) {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    const a = hash2D(i, 0, seed);
    const b = hash2D(i + 1, 0, seed);
    return lerp(a, b, u);
  }
  GAME.valueNoise1D = valueNoise1D;

  // =========================================================================
  // 2. CRISP BITMAP PIXEL FONT (FULL ASCII + ARROWS FOR SIGNS & TERMINALS)
  // =========================================================================
  const FONT_GLYPHS = {
    'A': ['0110','1001','1111','1001','1001'],
    'B': ['1110','1001','1110','1001','1110'],
    'C': ['0111','1000','1000','1000','0111'],
    'D': ['1110','1001','1001','1001','1110'],
    'E': ['1111','1000','1110','1000','1111'],
    'F': ['1111','1000','1110','1000','1000'],
    'G': ['0111','1000','1011','1001','0111'],
    'H': ['1001','1001','1111','1001','1001'],
    'I': ['111','010','010','010','111'],
    'J': ['0011','0001','0001','1001','0110'],
    'K': ['1001','1010','1100','1010','1001'],
    'L': ['1000','1000','1000','1000','1111'],
    'M': ['10001','11011','10101','10001','10001'],
    'N': ['1001','1101','1011','1001','1001'],
    'O': ['0110','1001','1001','1001','0110'],
    'P': ['1110','1001','1110','1000','1000'],
    'Q': ['0110','1001','1001','1011','0111'],
    'R': ['1110','1001','1110','1010','1001'],
    'S': ['0111','1000','0110','0001','1110'],
    'T': ['11111','00100','00100','00100','00100'],
    'U': ['1001','1001','1001','1001','0110'],
    'V': ['1001','1001','1001','0110','0110'],
    'W': ['10001','10001','10101','11011','10001'],
    'X': ['1001','1001','0110','1001','1001'],
    'Y': ['10001','01010','00100','00100','00100'],
    'Z': ['1111','0010','0100','1000','1111'],
    'a': ['0000','0110','0001','0111','0111'],
    'b': ['1000','1110','1001','1001','1110'],
    'c': ['0000','0111','1000','1000','0111'],
    'd': ['0001','0111','1001','1001','0111'],
    'e': ['0000','0110','1111','1000','0111'],
    'f': ['0011','0100','1110','0100','0100'],
    'g': ['0111','1001','0111','0001','1110'],
    'h': ['1000','1110','1001','1001','1001'],
    'i': ['010','000','010','010','010'],
    'j': ['001','000','001','101','010'],
    'k': ['1000','1010','1100','1010','1001'],
    'l': ['110','010','010','010','011'],
    'm': ['00000','11010','10101','10101','10001'],
    'n': ['0000','1110','1001','1001','1001'],
    'o': ['0000','0110','1001','1001','0110'],
    'p': ['0000','1110','1001','1110','1000'],
    'q': ['0000','0111','1001','0111','0001'],
    'r': ['0000','1011','1100','1000','1000'],
    's': ['0000','0111','1100','0011','1110'],
    't': ['0100','1110','0100','0100','0011'],
    'u': ['0000','1001','1001','1001','0111'],
    'v': ['0000','1001','1001','0110','0110'],
    'w': ['00000','10001','10101','10101','01010'],
    'x': ['0000','1001','0110','0110','1001'],
    'y': ['0000','1001','0111','0001','1110'],
    'z': ['0000','1111','0010','0100','1111'],
    '0': ['0110','1011','1101','1001','0110'],
    '1': ['010','110','010','010','111'],
    '2': ['1110','0001','0110','1000','1111'],
    '3': ['1110','0001','0110','0001','1110'],
    '4': ['1001','1001','1111','0001','0001'],
    '5': ['1111','1000','1110','0001','1110'],
    '6': ['0111','1000','1111','1001','0110'],
    '7': ['1111','0001','0010','0100','0100'],
    '8': ['0110','1001','0110','1001','0110'],
    '9': ['0110','1001','0111','0001','1110'],
    '-': ['000','000','111','000','000'],
    '_': ['000','000','000','000','111'],
    '+': ['000','010','111','010','000'],
    '=': ['000','111','000','111','000'],
    '/': ['001','001','010','100','100'],
    ':': ['0','1','0','1','0'],
    ';': ['0','1','0','1','1'],
    '.': ['0','0','0','0','1'],
    ',': ['00','00','00','01','10'],
    '!': ['1','1','1','0','1'],
    '?': ['110','001','010','000','010'],
    "'": ['1','1','0','0','0'],
    '"': ['101','101','000','000','000'],
    '(': ['01','10','10','10','01'],
    ')': ['10','01','01','01','10'],
    '[': ['11','10','10','10','11'],
    ']': ['11','01','01','01','11'],
    '#': ['01010','11111','01010','11111','01010'],
    '%': ['1001','0010','0100','1001','0000'],
    '•': ['00','00','11','11','00'],
    '→': ['00100','00010','11111','00010','00100'],
    '←': ['00100','01000','11111','01000','00100'],
    '↑': ['00100','01110','10101','00100','00100'],
    '↓': ['00100','00100','10101','01110','00100'],
    ' ': ['000','000','000','000','000']
  };
  GAME.FONT_GLYPHS = FONT_GLYPHS;

  function measurePixelText(text) {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const g = FONT_GLYPHS[ch] || FONT_GLYPHS[ch.toUpperCase()] || FONT_GLYPHS[' '];
      w += g[0].length + (i < text.length - 1 ? 1 : 0);
    }
    return w;
  }
  GAME.measurePixelText = measurePixelText;

  function drawPixelText(ctx, text, x, y, color = '#eef4ff', shadowColor = null) {
    let cx = Math.floor(x);
    const cy = Math.floor(y);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const g = FONT_GLYPHS[ch] || FONT_GLYPHS[ch.toUpperCase()] || FONT_GLYPHS[' '];
      const gw = g[0].length;
      if (shadowColor) {
        ctx.fillStyle = shadowColor;
        for (let row = 0; row < g.length; row++) {
          for (let col = 0; col < gw; col++) {
            if (g[row][col] === '1') ctx.fillRect(cx + col, cy + row + 1, 1, 1);
          }
        }
      }
      ctx.fillStyle = color;
      for (let row = 0; row < g.length; row++) {
        for (let col = 0; col < gw; col++) {
          if (g[row][col] === '1') ctx.fillRect(cx + col, cy + row, 1, 1);
        }
      }
      cx += gw + 1;
    }
    return cx - Math.floor(x);
  }
  GAME.drawPixelText = drawPixelText;

  // =========================================================================
  // 3. THREE-SECTOR BIOME PALETTES
  // =========================================================================
  const BIOME_PALETTES = {
    sector04: {
      name: 'SECTOR 04: FLOODED SUBWAY',
      skyStops: [
        { y: 0.00, hex: '#060a14' },
        { y: 0.30, hex: '#0d1930' },
        { y: 0.65, hex: '#172c52' },
        { y: 0.90, hex: '#234173' },
        { y: 1.00, hex: '#122342' }
      ],
      archCols: ['#0d1b36', '#10203d', '#152a4f', '#182f57', '#1f3b6b'],
      brickMortar: '#081020',
      brickShades: ['#0e1c36', '#112140', '#14274a', '#172c52', '#1c3461'],
      pipeColor: '#1a3057',
      pipeHi: '#254275',
      vineCols: ['#0b2121', '#10302c', '#153d35'],
      stone: {
        core: '#030408',
        dark: '#0a101c',
        mid: '#1a273b',
        edge: '#354861',
        rimMid: '#4a5d73',
        rimHigh: '#7b94ad',
        crack: '#070b14'
      },
      flora: {
        dark: '#124032',
        mid: '#1c5c46',
        bright: '#38a86b',
        tip: '#6ee89a',
        blooms: ['#ff7a59', '#ff8fa3', '#7af5ff', '#ffe38f']
      },
      truss: {
        top: '#6f8aa8',
        mid: '#3c5069',
        dark: '#182230',
        rivet: '#99b4d1',
        braceA: '#364961',
        braceB: '#4f6885',
        rust: '#6e3429'
      },
      ambientShadow: 'rgba(4, 9, 22, 0.74)',
      shaftColor: [55, 110, 195],
      lampGlow: [255, 70, 75],
      orbColor: '#ff66d9',
      waterColor: 'rgba(13, 38, 66, 0.72)',
      waterHighlight: '#4a9ec7',
      waterMid: '#214d75',
      moteColors: ['#8ec5ff', '#b8dcff', '#6ee89a', '#ffd99e', '#e5a8ff'],
      fogTint: 'rgba(16, 36, 72, 0.10)'
    },

    sector07: {
      name: 'SECTOR 07: HYDRO-PUMP CONDUITS',
      skyStops: [
        { y: 0.00, hex: '#041317' },
        { y: 0.32, hex: '#082026' },
        { y: 0.65, hex: '#0f343b' },
        { y: 0.88, hex: '#15464d' },
        { y: 1.00, hex: '#092429' }
      ],
      archCols: ['#071d22', '#0b282e', '#10373f', '#15464d', '#1c5961'],
      brickMortar: '#041216',
      brickShades: ['#081e24', '#0c272e', '#10323b', '#143d47', '#1a4c57'],
      pipeColor: '#1f4f54',
      pipeHi: '#3d7d7d',
      vineCols: ['#0a2e30', '#114747', '#1f7a73'],
      stone: {
        core: '#030408',
        dark: '#08171c',
        mid: '#142f36',
        edge: '#29575c',
        rimMid: '#3b7375',
        rimHigh: '#6ab0a8',
        crack: '#040c0f'
      },
      flora: {
        dark: '#0d3b38',
        mid: '#156159',
        bright: '#23b59b',
        tip: '#80ffea',
        blooms: ['#4dffdb', '#99fff0', '#54d2ff', '#b8ff9e']
      },
      truss: {
        top: '#6fa39c',
        mid: '#39615e',
        dark: '#142626',
        rivet: '#9ed9ce',
        braceA: '#2f5452',
        braceB: '#4a7a75',
        rust: '#7a4829'
      },
      ambientShadow: 'rgba(3, 14, 18, 0.74)',
      shaftColor: [45, 195, 190],
      lampGlow: [75, 245, 215],
      orbColor: '#4dffdb',
      waterColor: 'rgba(10, 54, 58, 0.75)',
      waterHighlight: '#6bffea',
      waterMid: '#1f7a7a',
      moteColors: ['#66ffe5', '#99fff0', '#48cae4', '#b8ff9e', '#ffffff'],
      fogTint: 'rgba(14, 62, 68, 0.11)'
    },

    sector09: {
      name: 'SECTOR 09: GEOTHERMAL REACTOR',
      skyStops: [
        { y: 0.00, hex: '#08070e' },
        { y: 0.25, hex: '#12070a' },
        { y: 0.58, hex: '#260e12' },
        { y: 0.85, hex: '#45191c' },
        { y: 1.00, hex: '#6e261b' }
      ],
      archCols: ['#1a090d', '#240c10', '#331217', '#42171b', '#572122'],
      brickMortar: '#0b0406',
      brickShades: ['#17090b', '#1f0c0f', '#291013', '#331417', '#401a1c'],
      pipeColor: '#3d1d1a',
      pipeHi: '#6b3629',
      vineCols: ['#170b0d', '#261315', '#3b211e'],
      stone: {
        core: '#030408',
        dark: '#14090b',
        mid: '#261416',
        edge: '#472a28',
        rimMid: '#634139',
        rimHigh: '#916d5f',
        crack: '#090305'
      },
      flora: {
        dark: '#2e1612',
        mid: '#52291c',
        bright: '#8c4926',
        tip: '#ffaa33',
        blooms: ['#ffaa33', '#ff5938', '#ffd875', '#ff7a45']
      },
      truss: {
        top: '#8c756b',
        mid: '#4f3b35',
        dark: '#1f1412',
        rivet: '#c2a799',
        braceA: '#42302b',
        braceB: '#664a40',
        rust: '#9c3a1f'
      },
      ambientShadow: 'rgba(12, 4, 6, 0.72)',
      shaftColor: [255, 145, 70],
      lampGlow: [255, 170, 50],
      orbColor: '#ffaa33',
      waterColor: 'rgba(110, 28, 12, 0.84)',
      waterHighlight: '#ffbb45',
      waterMid: '#cf421b',
      moteColors: ['#ffaa33', '#ff6b3d', '#ffd875', '#ff9466', '#ffffff'],
      fogTint: 'rgba(72, 24, 16, 0.12)'
    }
  };
  GAME.BIOME_PALETTES = BIOME_PALETTES;

  // =========================================================================
  // 4. PROCEDURAL ASSET FACTORY (BAKED OFFSCREEN CACHES AT STARTUP)
  // =========================================================================
  class AssetFactory {
    constructor() {
      this.tileVariants = 4;
      this.bgLayers = {};      // biome -> { backdrop, megaArch, brickVault, foliage }
      this.surfaceBackdrop = null;
      this.stoneTiles = {};    // biome -> [16][4] 20x28 canvases
      this.trussTiles = {};    // biome -> [4] 16x16 canvases
      this.cornerDots = {};    // biome -> { NW, NE, SE, SW }
      this.robotFrames = {};   // sleep, idle[4], run[6], jump[1], fall[1]
      this.signs = {};         // subway, tunnel, biolab, reactor
      this.cageLamp = null;
      this.bioLamp = null;
      this.amberLamp = null;
      this.anchorPlate = null;
      this.wallBracketLeft = null;
      this.wallBracketRight = null;
      this.energyOrb = null;
      this.bioOrb = null;
      this.reactorOrb = null;
      this.crystals = [];
      this.bioMushrooms = [];
      this.shardFrames = [];
      this.crates = [];
      this.pipeFixtures = [];
      this.terminalSprite = null;
      this.exitGateSprite = null;

      // Machinery sprites
      this.elevatorCage = null;
      this.pulleyWheelFrames = [];
      this.counterweight = null;
      this.gondolaTrolley = null;
      this.gondolaCar = null;
      this.turbineFrames = [];
      this.steamValve = null;

      // Blurred DOF framing
      this.dofTopChunks = [];
      this.dofBottomChunks = [];
      this.dofSideSpire = null;
    }

    bakeAll() {
      const biomes = Object.keys(BIOME_PALETTES);
      for (const biome of biomes) {
        this.bakeBiomeBackgrounds(biome, BIOME_PALETTES[biome]);
        this.bakeBiomeTerrainTiles(biome, BIOME_PALETTES[biome]);
        this.bakeBiomeTrussTiles(biome, BIOME_PALETTES[biome]);
      }
      this.bakeSurfaceDawnBackdrop();
      this.bakeRobotFrames();
      this.bakeSigns();
      this.bakeLampsAndBrackets();
      this.bakeOrbs();
      this.bakeCrystals();
      this.bakeBioMushrooms();
      this.bakeShardPickups();
      this.bakeCrates();
      this.bakePipeFixtures();
      this.bakeTerminalAndExitGate();
      this.bakeMachinerySprites();
      this.bakeBlurredForegroundDOF();
    }

    getStoneTile(biome, mask, variant) {
      const b = this.stoneTiles[biome] || this.stoneTiles.sector04;
      return b[mask & 15][variant % this.tileVariants];
    }

    getTrussTile(biome, variant) {
      const b = this.trussTiles[biome] || this.trussTiles.sector04;
      return b[variant % b.length];
    }

    // -----------------------------------------------------------------------
    // A. PER-BIOME PARALLAX BACKGROUNDS (LAYERS 0..3)
    // -----------------------------------------------------------------------
    bakeBiomeBackgrounds(biome, pal) {
      this.bgLayers[biome] = {
        backdrop: this.buildDitheredBackdrop(pal.skyStops),
        megaArch: this.buildMegaArch(biome, pal),
        brickVault: this.buildBrickVault(biome, pal),
        foliage: this.buildBgFoliage(biome, pal)
      };
    }

    buildDitheredBackdrop(stops) {
      const W = GAME.PIXEL_W, H = GAME.PIXEL_H;
      const { canvas, ctx } = createOffscreen(W, H);
      const parsed = stops.map(s => ({ y: s.y, rgb: hexToRgb(s.hex) }));
      const img = ctx.createImageData(W, H);
      const data = img.data;

      for (let y = 0; y < H; y++) {
        const t = y / (H - 1);
        let s0 = parsed[0], s1 = parsed[parsed.length - 1];
        for (let i = 0; i < parsed.length - 1; i++) {
          if (t >= parsed[i].y && t <= parsed[i + 1].y) {
            s0 = parsed[i];
            s1 = parsed[i + 1];
            break;
          }
        }
        const span = Math.max(0.0001, s1.y - s0.y);
        const localT = (t - s0.y) / span;
        for (let x = 0; x < W; x++) {
          const rgb = bayerCheck(x, y, localT) ? s1.rgb : s0.rgb;
          const idx = (y * W + x) * 4;
          data[idx] = rgb[0];
          data[idx + 1] = rgb[1];
          data[idx + 2] = rgb[2];
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return canvas;
    }

    bakeSurfaceDawnBackdrop() {
      const { canvas, ctx } = createOffscreen(GAME.PIXEL_W, GAME.PIXEL_H);
      const base = this.buildDitheredBackdrop([
        { y: 0.00, hex: '#09152b' },
        { y: 0.35, hex: '#18345e' },
        { y: 0.72, hex: '#345e8c' },
        { y: 0.90, hex: '#6387ab' },
        { y: 1.00, hex: '#a69e8d' }
      ]);
      ctx.drawImage(base, 0, 0);

      // Crisp pixel stars in upper night sky
      const rng = new SeededRNG(2099);
      for (let i = 0; i < 65; i++) {
        const sx = rng.int(4, GAME.PIXEL_W - 4);
        const sy = rng.int(4, 130);
        ctx.fillStyle = rng.chance(0.3) ? '#fff5d6' : '#cbe5ff';
        ctx.fillRect(sx, sy, 1, 1);
      }
      this.surfaceBackdrop = canvas;
    }

    buildMegaArch(biome, pal) {
      const w = 640, h = 360;
      const { canvas, ctx } = createOffscreen(w, h);
      const [c0, c1, c2, c3, c4] = pal.archCols;

      ctx.fillStyle = c0;
      for (let ax = 20; ax < w; ax += 180) {
        ctx.fillRect(ax, 0, 26, h);
        ctx.fillRect(ax + 120, 0, 20, h);
        for (let dx = 0; dx <= 120; dx++) {
          const norm = (dx - 60) / 60;
          const archH = Math.floor(42 + (1 - norm * norm) * 44);
          ctx.fillRect(ax + 14 + dx, 0, 1, archH);
        }
      }

      if (biome === 'sector07') {
        // Colossal distant hydro-pump cylindrical reservoirs & diagonal braces
        for (const tx of [70, 270, 470]) {
          ctx.fillStyle = c1;
          ctx.fillRect(tx, 34, 68, 280);
          ctx.fillStyle = c3;
          ctx.fillRect(tx + 4, 34, 10, 280);
          ctx.fillStyle = c4;
          ctx.fillRect(tx - 4, 30, 76, 10);
          ctx.fillRect(tx - 4, 150, 76, 8);
          ctx.fillRect(tx - 4, 270, 76, 10);
        }
      } else if (biome === 'sector09') {
        // Giant reactor cooling shafts & angled X-frame towers
        for (const rx of [65, 255, 445]) {
          ctx.fillStyle = c1;
          ctx.fillRect(rx, 0, 52, h);
          ctx.fillStyle = c2;
          ctx.fillRect(rx + 6, 0, 8, h);
          ctx.fillStyle = c4;
          for (let y = 20; y < h; y += 64) {
            ctx.fillRect(rx - 6, y, 64, 7);
            // Glowing faint furnace vent slits
            ctx.fillStyle = '#5c2019';
            ctx.fillRect(rx + 14, y + 18, 24, 4);
            ctx.fillStyle = c4;
          }
        }
      } else {
        // Sector 04 giant curved aqueduct pipes & deep arched silhouettes
        ctx.fillStyle = c1;
        ctx.fillRect(0, 88, w, 24);
        ctx.fillStyle = c3;
        ctx.fillRect(0, 88, w, 4);
        ctx.fillStyle = c0;
        ctx.fillRect(0, 107, w, 5);

        for (const px of [95, 290, 485]) {
          ctx.fillStyle = c1;
          ctx.fillRect(px, 0, 32, h);
          ctx.fillStyle = c3;
          ctx.fillRect(px + 2, 0, 5, h);
          ctx.fillStyle = c0;
          ctx.fillRect(px + 25, 0, 7, h);
          for (let ry = 40; ry < h; ry += 72) {
            ctx.fillStyle = c2;
            ctx.fillRect(px - 4, ry, 40, 8);
            ctx.fillStyle = c4;
            ctx.fillRect(px - 4, ry, 40, 2);
          }
        }
      }

      // Giant arched subterranean tunnel cutouts
      ctx.fillStyle = c2;
      for (let x = 155; x < w; x += 260) {
        for (let y = 145; y < 290; y++) {
          const rad = 46;
          if (y < 145 + rad) {
            const dy = 145 + rad - y;
            const span = Math.floor(Math.sqrt(rad * rad - dy * dy));
            ctx.fillRect(x - span, y, span * 2, 1);
          } else {
            ctx.fillRect(x - rad, y, rad * 2, 1);
          }
        }
      }
      return canvas;
    }

    buildBrickVault(biome, pal) {
      const w = 512, h = 384;
      const { canvas, ctx } = createOffscreen(w, h);
      const img = ctx.createImageData(w, h);
      const data = img.data;

      const mortarRgb = hexToRgb(pal.brickMortar);
      const brickPalette = pal.brickShades.map(hexToRgb);

      const bh = biome === 'sector09' ? 12 : 8;
      const bw = biome === 'sector09' ? 24 : 16;

      for (let y = 0; y < h; y++) {
        const row = Math.floor(y / bh);
        const rowY = y % bh;
        const stagger = (row & 1) ? Math.floor(bw / 2) : 0;
        const fogFactor = 0.72 + 0.28 * Math.sin((y / h) * Math.PI);

        for (let x = 0; x < w; x++) {
          const bx = Math.floor((x + stagger) / bw);
          const colX = (x + stagger) % bw;
          const isMortar = rowY === 0 || colX === 0;
          const bRand = hash2D(bx, row, 901);

          let r, g, b;
          if (isMortar) {
            r = mortarRgb[0]; g = mortarRgb[1]; b = mortarRgb[2];
          } else {
            const pIdx = Math.min(brickPalette.length - 1, Math.floor(bRand * brickPalette.length));
            const base = brickPalette[pIdx];
            const grain = (hash2D(x, y, 77) - 0.5) * 8;
            const bevel = rowY === 1 ? 6 : (rowY === bh - 1 ? -5 : 0);
            r = clamp(Math.round((base[0] + grain + bevel) * fogFactor), 4, 255);
            g = clamp(Math.round((base[1] + grain + bevel) * fogFactor), 4, 255);
            b = clamp(Math.round((base[2] + grain + bevel) * fogFactor), 6, 255);
          }

          // Deep vaulted arch cutouts showing far Layer 1 behind
          const cellX = x % 128;
          const distCenter = Math.abs(cellX - 64);
          let alpha = 228;
          if (y > 90 && y < 275 && distCenter < 34) {
            const archTop = y < 124 ? Math.sqrt(34 * 34 - distCenter * distCenter) : 34;
            if (y > 124 - archTop) {
              alpha = 65;
            }
          }

          const idx = (y * w + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = alpha;
        }
      }
      ctx.putImageData(img, 0, 0);

      // Vertical pipe conduits & structural steel beams
      for (const px of [20, 146, 276, 404]) {
        ctx.fillStyle = pal.brickMortar;
        ctx.fillRect(px - 1, 0, 12, h);
        ctx.fillStyle = pal.pipeColor;
        ctx.fillRect(px + 1, 0, 7, h);
        ctx.fillStyle = pal.pipeHi;
        ctx.fillRect(px + 2, 0, 2, h);
        for (let fy = 24; fy < h; fy += 56) {
          ctx.fillStyle = pal.brickMortar;
          ctx.fillRect(px - 2, fy - 1, 14, 6);
          ctx.fillStyle = pal.pipeHi;
          ctx.fillRect(px - 1, fy, 12, 3);
        }
      }

      // Horizontal steel girders
      for (const gy of [78, 286]) {
        ctx.fillStyle = pal.brickMortar;
        ctx.fillRect(0, gy, w, 12);
        ctx.fillStyle = pal.pipeColor;
        ctx.fillRect(0, gy + 1, w, 2);
        ctx.fillRect(0, gy + 9, w, 2);
        for (let rx = 8; rx < w; rx += 16) {
          ctx.fillStyle = pal.pipeHi;
          ctx.fillRect(rx, gy + 4, 2, 3);
        }
      }
      return canvas;
    }

    buildBgFoliage(biome, pal) {
      const w = 480, h = 270;
      const { canvas, ctx } = createOffscreen(w, h);
      const rng = new SeededRNG(404 + biome.charCodeAt(biome.length - 1));
      const [vDark, vMid, vLeaf] = pal.vineCols;

      if (biome !== 'sector09') {
        // Hanging vine curtains or glowing bio-tendrils
        for (let x = 6; x < w; x += rng.int(11, 22)) {
          const len = rng.int(26, 94);
          const thickness = rng.chance(0.35) ? 2 : 1;
          for (let y = 0; y < len; y++) {
            const sway = Math.round(Math.sin(y * 0.12 + x) * 1.8);
            ctx.fillStyle = y < len * 0.55 ? vDark : vMid;
            ctx.fillRect(x + sway, y, thickness, 1);
            if (y > 8 && rng.chance(0.24)) {
              const side = rng.chance(0.5) ? -1 : 1;
              ctx.fillStyle = vLeaf;
              ctx.fillRect(x + sway + side, y, 2, 2);
              if (biome === 'sector07' && y > len - 6 && rng.chance(0.45)) {
                ctx.fillStyle = '#33b5a6';
                ctx.fillRect(x + sway, y + 1, 2, 2);
              }
            }
          }
        }
      } else {
        // Sector 09: Hanging dark structural cables & ash-dusted vertical struts
        for (let x = 18; x < w; x += rng.int(26, 48)) {
          const len = rng.int(34, 110);
          ctx.fillStyle = vDark;
          ctx.fillRect(x, 0, 2, len);
          ctx.fillStyle = vLeaf;
          ctx.fillRect(x - 1, len - 4, 4, 4);
        }
      }

      // Mid-depth vertical support pillars
      for (const bx of [84, 240, 396]) {
        ctx.fillStyle = pal.brickMortar;
        ctx.fillRect(bx, 0, 10, h);
        ctx.fillStyle = pal.archCols[1];
        ctx.fillRect(bx + 1, 0, 2, h);
        for (let my = 18; my < h; my += rng.int(28, 52)) {
          ctx.fillStyle = vMid;
          ctx.fillRect(bx - 2, my, 14, 4);
          ctx.fillRect(bx + rng.int(-2, 8), my + 4, 2, rng.int(4, 12));
        }
      }

      // Sagging catenary cables
      ctx.fillStyle = pal.brickMortar;
      for (const [x0, y0, x1, y1] of [[0, 35, 190, 48], [180, 50, 390, 28], [310, 62, 480, 42]]) {
        const steps = x1 - x0;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const cx = Math.round(lerp(x0, x1, t));
          const sag = Math.sin(t * Math.PI) * 26;
          const cy = Math.round(lerp(y0, y1, t) + sag);
          ctx.fillRect(cx, cy, 1, 1);
        }
      }
      return canvas;
    }

    // -----------------------------------------------------------------------
    // B. PER-BIOME AUTO-TILED 16x16 TERRAIN (20x28 STAMPS + CORNER BEVELS)
    // -----------------------------------------------------------------------
    bakeBiomeTerrainTiles(biome, pal) {
      const CORE = hexToRgb(pal.stone.core);
      const DARK_STONE = hexToRgb(pal.stone.dark);
      const MID_STONE = hexToRgb(pal.stone.mid);
      const SLATE_EDGE = hexToRgb(pal.stone.edge);
      const RIM_MID = hexToRgb(pal.stone.rimMid);
      const RIM_HIGH = hexToRgb(pal.stone.rimHigh);
      const CRACK = hexToRgb(pal.stone.crack);

      const MOSS_DARK = hexToRgb(pal.flora.dark);
      const MOSS_MID = hexToRgb(pal.flora.mid);
      const MOSS_BRIGHT = hexToRgb(pal.flora.bright);
      const MOSS_TIP = hexToRgb(pal.flora.tip);
      const BLOOMS = pal.flora.blooms.map(hexToRgb);

      const SW = 20, SH = 28;
      const OX = 2, OY = 6;
      const tilesByMask = [];

      for (let mask = 0; mask < 16; mask++) {
        tilesByMask[mask] = [];
        const hasN = (mask & 1) !== 0;
        const hasE = (mask & 2) !== 0;
        const hasS = (mask & 4) !== 0;
        const hasW = (mask & 8) !== 0;

        for (let v = 0; v < this.tileVariants; v++) {
          const { canvas, ctx } = createOffscreen(SW, SH);
          const img = ctx.createImageData(SW, SH);
          const d = img.data;
          const seed = mask * 37 + v * 113 + biome.charCodeAt(biome.length - 1) * 19;

          const setPx = (px, py, rgb, a = 255) => {
            if (px < 0 || px >= SW || py < 0 || py >= SH) return;
            const i = (py * SW + px) * 4;
            d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = a;
          };

          for (let ly = 0; ly < 16; ly++) {
            for (let lx = 0; lx < 16; lx++) {
              const px = OX + lx;
              const py = OY + ly;
              const nNoise = hash2D(lx, ly, seed);

              const distN = hasN ? 99 : ly;
              const distS = hasS ? 99 : 15 - ly;
              const distW = hasW ? 99 : lx;
              const distE = hasE ? 99 : 15 - lx;

              if (!hasN && !hasW && lx === 0 && ly === 0) continue;
              if (!hasN && !hasE && lx === 15 && ly === 0) continue;
              if (!hasS && !hasW && lx === 0 && ly === 15) continue;
              if (!hasS && !hasE && lx === 15 && ly === 15) continue;
              if (!hasS && ly === 15 && nNoise < 0.36) continue;

              let color = CORE;
              const isSeam =
                (!hasN && ly >= 1 && ly <= 4 && (lx === 7 + (v % 3) || ly === 3)) ||
                (!hasW && lx <= 4 && ly === 7 + (v % 2)) ||
                (!hasE && lx >= 11 && ly === 8 + (v % 2));

              if (distN === 0) {
                color = nNoise > 0.25 ? RIM_HIGH : RIM_MID;
              } else if (distN === 1) {
                color = isSeam ? CRACK : (nNoise > 0.45 ? RIM_MID : SLATE_EDGE);
              } else if (distN === 2) {
                color = isSeam ? CRACK : (nNoise > 0.35 ? SLATE_EDGE : MID_STONE);
              } else if (distN <= 4) {
                const fade = 1 - (distN - 2) / 3.2;
                color = bayerCheck(lx, ly, fade) ? MID_STONE : DARK_STONE;
              } else if (distN <= 6) {
                color = bayerCheck(lx, ly, 0.38) ? DARK_STONE : CORE;
              } else if (distW === 0 || distE === 0) {
                color = nNoise > 0.35 ? SLATE_EDGE : MID_STONE;
              } else if (distW <= 2 || distE <= 2) {
                color = nNoise > 0.4 ? MID_STONE : DARK_STONE;
              } else if (distW <= 4 || distE <= 4) {
                color = bayerCheck(lx, ly, 0.42) ? DARK_STONE : CORE;
              } else if (distS === 0) {
                color = nNoise > 0.5 ? MID_STONE : DARK_STONE;
              } else if (distS <= 3) {
                color = bayerCheck(lx, ly, 0.45 - distS * 0.1) ? DARK_STONE : CORE;
              }

              // Sector 09 titanium plate rivet studs near exposed metal edges
              if (biome === 'sector09' && !hasN && ly === 2 && (lx === 3 || lx === 12)) {
                color = RIM_HIGH;
              }

              if (color !== CORE && isSeam) color = CRACK;
              setPx(px, py, color, 255);
            }
          }

          // Top flora / bio-lichen / reactor slag ash pass
          if (!hasN) {
            const coverage = biome === 'sector09' ? 0.36 : (v === 3 ? 0.52 : 0.85);
            for (let lx = 0; lx < 16; lx++) {
              const mNoise = hash2D(lx, v, seed + 501);
              if (mNoise > coverage) continue;
              const px = OX + lx;
              setPx(px, OY, mNoise < 0.32 ? MOSS_TIP : MOSS_BRIGHT);
              setPx(px, OY + 1, MOSS_MID);

              if (biome !== 'sector09' && hash2D(lx, 11, seed) < 0.44) {
                const gh = 1 + Math.floor(hash2D(lx, 12, seed) * 3);
                for (let g = 1; g <= gh; g++) {
                  setPx(px, OY - g, g === gh ? MOSS_TIP : MOSS_BRIGHT);
                }
                if (gh >= 2 && hash2D(lx, 99, seed) < 0.17) {
                  const fl = BLOOMS[(lx + v) % BLOOMS.length];
                  setPx(px, OY - gh - 1, fl);
                  setPx(px + (lx < 15 ? 1 : -1), OY - gh - 1, fl);
                }
              }

              if (hash2D(lx, 21, seed) < 0.25) {
                const hang = 2 + Math.floor(hash2D(lx, 22, seed) * 4);
                for (let h = 1; h <= hang; h++) {
                  const col = h === hang ? MOSS_DARK : (h <= 2 ? MOSS_BRIGHT : MOSS_MID);
                  setPx(px, OY + 1 + h, col);
                }
              }
            }
          }

          // Underside ceiling stalactites & root/coolant tendrils
          if (!hasS) {
            for (let lx = 1; lx < 15; lx++) {
              const sNoise = hash2D(lx, 77, seed);
              if (sNoise < 0.26) {
                const drop = 1 + Math.floor(hash2D(lx, 78, seed) * 5);
                for (let r = 0; r < drop; r++) {
                  const col = r < 2 ? DARK_STONE : (r < 4 ? MID_STONE : SLATE_EDGE);
                  setPx(OX + lx, OY + 16 + r, r === 0 ? CORE : col);
                }
              } else if (sNoise > 0.88) {
                const rootLen = 2 + Math.floor(hash2D(lx, 88, seed) * 4);
                for (let r = 0; r < rootLen; r++) {
                  setPx(OX + lx, OY + 16 + r, r === rootLen - 1 ? MOSS_BRIGHT : MOSS_DARK);
                }
              }
            }
          }

          // Side moss / oxidized tufts
          if (!hasW && v % 2 === 0) {
            for (let ly = 3; ly < 12; ly++) {
              if (hash2D(0, ly, seed) < 0.24) {
                setPx(OX - 1, OY + ly, MOSS_MID);
                setPx(OX, OY + ly, MOSS_BRIGHT);
              }
            }
          }
          if (!hasE && v % 2 === 1) {
            for (let ly = 4; ly < 13; ly++) {
              if (hash2D(15, ly, seed) < 0.24) {
                setPx(OX + 16, OY + ly, MOSS_MID);
                setPx(OX + 15, OY + ly, MOSS_BRIGHT);
              }
            }
          }

          ctx.putImageData(img, 0, 0);
          tilesByMask[mask].push(canvas);
        }
      }
      this.stoneTiles[biome] = tilesByMask;

      // Inner L-corner bevel stamps
      const corners = {};
      for (const cName of ['NW', 'NE', 'SE', 'SW']) {
        const { canvas, ctx } = createOffscreen(4, 4);
        ctx.fillStyle = pal.stone.edge;
        ctx.fillRect(0, 0, 4, 4);
        ctx.fillStyle = pal.stone.mid;
        ctx.fillRect(1, 1, 2, 2);
        ctx.fillStyle = pal.stone.rimHigh;
        if (cName === 'NW') ctx.fillRect(3, 3, 1, 1);
        if (cName === 'NE') ctx.fillRect(0, 3, 1, 1);
        if (cName === 'SE') ctx.fillRect(0, 0, 1, 1);
        if (cName === 'SW') ctx.fillRect(3, 0, 1, 1);
        corners[cName] = canvas;
      }
      this.cornerDots[biome] = corners;
    }

    // -----------------------------------------------------------------------
    // C. PER-BIOME STEEL TRUSS PLATFORMS (XXXXX CROSS-BRACING + RIVETS)
    // -----------------------------------------------------------------------
    bakeBiomeTrussTiles(biome, pal) {
      const list = [];
      for (let v = 0; v < 4; v++) {
        const { canvas, ctx } = createOffscreen(16, 16);
        const t = pal.truss;

        ctx.fillStyle = t.top;
        ctx.fillRect(0, 0, 16, 1);
        ctx.fillStyle = t.mid;
        ctx.fillRect(0, 1, 16, 2);
        ctx.fillStyle = t.dark;
        ctx.fillRect(0, 3, 16, 1);

        ctx.fillStyle = t.rivet;
        ctx.fillRect(2, 1, 1, 1);
        ctx.fillRect(7, 1, 1, 1);
        ctx.fillRect(12, 1, 1, 1);

        ctx.fillStyle = t.mid;
        ctx.fillRect(0, 12, 16, 1);
        ctx.fillStyle = t.dark;
        ctx.fillRect(0, 13, 16, 1);

        for (let bx = 0; bx < 16; bx += 8) {
          for (let i = 0; i < 8; i++) {
            ctx.fillStyle = '#090d14';
            ctx.fillRect(bx + i, 4 + i, 2, 1);
            ctx.fillStyle = t.braceA;
            ctx.fillRect(bx + i, 4 + i, 1, 1);

            ctx.fillStyle = '#090d14';
            ctx.fillRect(bx + (7 - i), 4 + i, 2, 1);
            ctx.fillStyle = t.braceB;
            ctx.fillRect(bx + (7 - i), 4 + i, 1, 1);
          }
          ctx.fillStyle = t.mid;
          ctx.fillRect(bx, 4, 1, 8);
        }

        if (v === 1 || v === 3) {
          ctx.fillStyle = t.rust;
          ctx.fillRect(4, 2, 3, 1);
          ctx.fillStyle = pal.flora.mid;
          ctx.fillRect(1, 0, 5, 2);
          ctx.fillStyle = pal.flora.bright;
          ctx.fillRect(2, 0, 3, 1);
          ctx.fillStyle = pal.flora.tip;
          ctx.fillRect(3, 0, 1, 1);
          ctx.fillStyle = pal.flora.mid;
          ctx.fillRect(4, 3, 1, 3);
        }
        if (v === 2) {
          ctx.fillStyle = pal.flora.mid;
          ctx.fillRect(10, 0, 4, 2);
          ctx.fillStyle = pal.flora.bright;
          ctx.fillRect(11, 0, 2, 1);
        }

        list.push(canvas);
      }
      this.trussTiles[biome] = list;
    }

    // -----------------------------------------------------------------------
    // D. PROTAGONIST UNIT-04 "PICO" SPRITE SHEET (24x24 px)
    // -----------------------------------------------------------------------
    bakeRobotFrames() {
      const drawRobotBody = (opts) => {
        const { canvas, ctx } = createOffscreen(24, 24);
        const {
          bobY = 0,
          tiltX = 0,
          stretchY = 0,
          legL = 0,
          legR = 0,
          armL = 0,
          armR = 0,
          antY = 0,
          unlitAnt = false
        } = opts;

        const cx = 12 + tiltX;
        const bottom = 22;
        const bodyH = 11 + stretchY;
        const bodyW = stretchY > 0 ? 12 : (stretchY < 0 ? 14 : 13);
        const topY = bottom - 3 - bodyH + bobY;

        const px = (x, y, col) => {
          ctx.fillStyle = col;
          ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
        };

        // 1. Antenna stem & glowing tip
        const antX = Math.round(cx - tiltX * 0.5);
        const antTop = topY - 4 + antY;
        ctx.fillStyle = '#3a4b66';
        ctx.fillRect(antX, antTop + 1, 1, 3);
        if (unlitAnt) {
          px(antX, antTop, '#38465c');
        } else {
          px(antX, antTop, '#ffffff');
          px(antX - 1, antTop, '#8ce8ff');
          px(antX + 1, antTop, '#8ce8ff');
        }

        // 2. Stubby rounded legs & boots
        const lx = Math.round(cx - 3);
        const rx = Math.round(cx + 2);
        const ly = bottom - 3 + legL;
        const ry = bottom - 3 + legR;
        ctx.fillStyle = '#0c101a';
        ctx.fillRect(lx - 1, ly - 1, 4, 4);
        ctx.fillStyle = '#4e6382';
        ctx.fillRect(lx, ly, 2, 2);
        ctx.fillStyle = '#eef4ff';
        ctx.fillRect(lx, ly, 1, 1);

        ctx.fillStyle = '#0c101a';
        ctx.fillRect(rx - 1, ry - 1, 4, 4);
        ctx.fillStyle = '#4e6382';
        ctx.fillRect(rx, ry, 2, 2);
        ctx.fillStyle = '#eef4ff';
        ctx.fillRect(rx, ry, 1, 1);

        // 3. Cute rounded off-white chassis with 1px dark outline
        const left = Math.round(cx - bodyW / 2);
        const right = left + bodyW - 1;
        const botY = topY + bodyH - 1;

        for (let y = topY - 1; y <= botY + 1; y++) {
          for (let x = left - 1; x <= right + 1; x++) {
            const dx = (x - cx + 0.5) / (bodyW * 0.52);
            const dy = (y - (topY + bodyH * 0.5)) / (bodyH * 0.54);
            const dist = dx * dx + dy * dy * 0.85;
            if (dist <= 1.24) {
              if (dist > 0.94 || y === botY + 1) {
                px(x, y, '#0c101a');
              } else {
                let col = '#dce8fb';
                if (dy < -0.45 && dx < 0.35) col = '#ffffff';
                else if (dy < -0.18) col = '#eef4ff';
                else if (dy > 0.48 || dx > 0.55) col = '#8aa4c9';
                else if (dy > 0.22 || dx > 0.32) col = '#9db4d4';
                px(x, y, col);
              }
            }
          }
        }

        // Tiny shoulder armor stripe
        px(left + 1, topY + 6, '#587499');
        px(right - 1, topY + 6, '#587499');

        // 4. Side arm nubs
        ctx.fillStyle = '#0c101a';
        ctx.fillRect(left - 2, topY + 6 + armL, 2, 4);
        ctx.fillStyle = '#9db4d4';
        ctx.fillRect(left - 1, topY + 7 + armL, 1, 2);

        ctx.fillStyle = '#0c101a';
        ctx.fillRect(right + 1, topY + 6 + armR, 2, 4);
        ctx.fillStyle = '#b9cce6';
        ctx.fillRect(right + 1, topY + 7 + armR, 1, 2);

        // 5. Expressive Dark Visor
        const vx = Math.round(cx - 4 + tiltX * 0.5);
        const vy = topY + 3;
        ctx.fillStyle = '#0c101a';
        ctx.fillRect(vx, vy, 9, 5);
        ctx.fillStyle = '#182238';
        ctx.fillRect(vx + 1, vy, 7, 1);

        canvas.visorX = vx;
        canvas.visorY = vy;
        return canvas;
      };

      this.robotFrames.sleep = [
        drawRobotBody({ bobY: 2, stretchY: -1, antY: 1, unlitAnt: true })
      ];
      this.robotFrames.idle = [
        drawRobotBody({ bobY: 0, antY: 0 }),
        drawRobotBody({ bobY: 0, antY: 0 }),
        drawRobotBody({ bobY: 1, antY: 0 }),
        drawRobotBody({ bobY: 1, antY: 1 })
      ];
      this.robotFrames.run = [
        drawRobotBody({ bobY: -1, tiltX: 1, legL: -1, legR: 1, armL: 1, armR: -1 }),
        drawRobotBody({ bobY: 0,  tiltX: 1, legL: 0,  legR: -1, armL: 0, armR: 0 }),
        drawRobotBody({ bobY: 1,  tiltX: 1, legL: 1,  legR: -1, armL: -1, armR: 1, antY: 1 }),
        drawRobotBody({ bobY: -1, tiltX: 1, legL: 1,  legR: -1, armL: -1, armR: 1 }),
        drawRobotBody({ bobY: 0,  tiltX: 1, legL: -1, legR: 0, armL: 0, armR: 0 }),
        drawRobotBody({ bobY: 1,  tiltX: 1, legL: -1, legR: 1, armL: 1, armR: -1, antY: 1 })
      ];
      this.robotFrames.jump = [
        drawRobotBody({ bobY: -1, stretchY: 1, legL: -1, legR: -1, armL: -2, armR: -2, antY: 1 })
      ];
      this.robotFrames.fall = [
        drawRobotBody({ bobY: 1, stretchY: -1, legL: 0, legR: -1, armL: -2, armR: -2, antY: -1 })
      ];
    }

    // -----------------------------------------------------------------------
    // E. ANCHORED SUBWAY & FACILITY SIGNS (FLOOR, CEILING & WALL MOUNTED)
    // -----------------------------------------------------------------------
    bakeSigns() {
      // 1. Floor-Mounted Grand Subway Sign (SECTOR 04)
      this.signs.subway = this.buildSignCanvas({
        w: 116,
        h: 64,
        boardW: 108,
        boardH: 38,
        boardY: 10,
        header: 'SECTOR 04',
        badgeColor: '#c24dff',
        badgeBg: '#4f1e63',
        glowColor: '#ff66d9',
        lines: [
          { text: 'Train Station ↑', color: '#eef4ff' },
          { text: 'Tower T-124  ←',  color: '#cbdcf2' },
          { text: 'East Lift 07 →',  color: '#cbdcf2' },
          { text: 'Storage B4   ↓',  color: '#a3bcdb' }
        ],
        twoTubes: true,
        mountType: 'floor',
        mossColor: ['#1c5c46', '#38a86b', '#6ee89a'],
        seed: 707
      });

      // 2. Ceiling-Suspended Directional Sign (SUB-02)
      this.signs.tunnel = this.buildSignCanvas({
        w: 76,
        h: 38,
        boardW: 70,
        boardH: 26,
        boardY: 10,
        header: 'SUB-02',
        badgeColor: '#c24dff',
        badgeBg: '#4f1e63',
        glowColor: '#ff66d9',
        lines: [
          { text: 'Station  ↑', color: '#eef4ff' },
          { text: 'Truss    →', color: '#b8cde6' }
        ],
        twoTubes: false,
        mountType: 'ceiling',
        mossColor: ['#1c5c46', '#38a86b', '#6ee89a'],
        seed: 808
      });

      // 3. Wall-Bracketed Bio-Pump Sign (BIO-PUMP 07)
      this.signs.biolab = this.buildSignCanvas({
        w: 98,
        h: 44,
        boardW: 86,
        boardH: 32,
        boardY: 10,
        header: 'BIO-PUMP 07',
        badgeColor: '#4dffdb',
        badgeBg: '#124a42',
        glowColor: '#4dffdb',
        lines: [
          { text: 'Hydro Core  ↑', color: '#e6fffb' },
          { text: 'Gondola Bay →', color: '#b2ebe2' },
          { text: 'Coolant Sump↓', color: '#8ad4ca' }
        ],
        twoTubes: false,
        mountType: 'wall',
        wallSide: 'left',
        mossColor: ['#156159', '#23b59b', '#80ffea'],
        seed: 909
      });

      // 4. Floor-Mounted Reactor Sign (CORE SHAFT 09)
      this.signs.reactor = this.buildSignCanvas({
        w: 112,
        h: 60,
        boardW: 102,
        boardH: 34,
        boardY: 10,
        header: 'CORE SHAFT 09',
        badgeColor: '#ffaa33',
        badgeBg: '#5c2b10',
        glowColor: '#ffaa33',
        lines: [
          { text: 'Surface Spire ↑', color: '#fff3db' },
          { text: 'Valve Array   ←', color: '#edd4ad' },
          { text: 'Magma Sump    ↓', color: '#cfab7e' }
        ],
        twoTubes: true,
        mountType: 'floor',
        mossColor: ['#52291c', '#8c4926', '#ffaa33'],
        seed: 1010
      });
    }

    buildSignCanvas(cfg) {
      const {
        w, h, boardW, boardH, boardY, header, badgeColor, badgeBg,
        glowColor, lines, twoTubes, mountType, wallSide = 'left', mossColor, seed
      } = cfg;
      const { canvas, ctx } = createOffscreen(w, h);
      const rng = new SeededRNG(seed);

      let bx = Math.floor((w - boardW) / 2);
      if (mountType === 'wall') {
        bx = wallSide === 'left' ? 8 : w - boardW - 8;
      }

      const legOffsets = [];

      // 1. Anchoring Hardware (Floor legs / Ceiling lugs / Wall L-brackets)
      if (mountType === 'floor') {
        const legL = bx + 14;
        const legR = bx + boardW - 18;
        legOffsets.push(legL + 1, legR + 1);
        for (const lx of [legL, legR]) {
          ctx.fillStyle = '#090d14';
          ctx.fillRect(lx - 1, boardY + boardH - 2, 5, h - (boardY + boardH - 2));
          ctx.fillStyle = '#2d3d54';
          ctx.fillRect(lx, boardY + boardH - 2, 3, h - (boardY + boardH - 2));
          ctx.fillStyle = '#5c7596';
          ctx.fillRect(lx, boardY + boardH - 2, 1, h - (boardY + boardH - 2));
          // Bolted floor flange base plate
          ctx.fillStyle = '#141c29';
          ctx.fillRect(lx - 4, h - 3, 11, 3);
          ctx.fillStyle = '#4c6382';
          ctx.fillRect(lx - 3, h - 3, 9, 1);
          ctx.fillStyle = '#8fa9c7';
          ctx.fillRect(lx - 2, h - 2, 1, 1);
          ctx.fillRect(lx + 4, h - 2, 1, 1);
        }
      } else if (mountType === 'ceiling') {
        // Twin top clevis anchor lugs where suspension rods bolt onto the frame
        const lugL = bx + 12;
        const lugR = bx + boardW - 15;
        legOffsets.push(lugL + 1, lugR + 1);
        for (const lx of [lugL, lugR]) {
          ctx.fillStyle = '#141c29';
          ctx.fillRect(lx - 1, 0, 5, boardY);
          ctx.fillStyle = '#465d7a';
          ctx.fillRect(lx, 0, 3, boardY);
          ctx.fillStyle = '#8aa4c4';
          ctx.fillRect(lx + 1, 2, 1, 2);
        }
      } else if (mountType === 'wall') {
        // Riveted steel L-brackets bolted into side wall
        const anchorX = wallSide === 'left' ? 0 : w - 10;
        const armX = wallSide === 'left' ? 2 : bx + boardW - 2;
        const bYs = [boardY + 6, boardY + boardH - 10];
        for (const by of bYs) {
          // Wall mounting plate
          ctx.fillStyle = '#0c111a';
          ctx.fillRect(anchorX, by - 3, 4, 10);
          ctx.fillStyle = '#3c506b';
          ctx.fillRect(anchorX + (wallSide === 'left' ? 1 : 0), by - 2, 3, 8);
          // Bolts
          ctx.fillStyle = '#8fa9c7';
          ctx.fillRect(anchorX + 1, by - 1, 1, 1);
          ctx.fillRect(anchorX + 1, by + 4, 1, 1);
          // Horizontal steel bracket arm + diagonal gusset strut
          ctx.fillStyle = '#253347';
          ctx.fillRect(armX, by, 8, 3);
          ctx.fillStyle = '#5a7394';
          ctx.fillRect(armX, by, 8, 1);
          ctx.fillStyle = '#192333';
          ctx.fillRect(armX + (wallSide === 'left' ? 2 : 3), by + 3, 3, 3);
        }
        legOffsets.push(...bYs);
      }

      // 2. Main Metal Sign Cabinet
      ctx.fillStyle = '#080c12';
      ctx.fillRect(bx - 1, boardY - 1, boardW + 2, boardH + 2);
      ctx.fillStyle = '#384c66';
      ctx.fillRect(bx, boardY, boardW, boardH);
      ctx.fillStyle = '#607a9c';
      ctx.fillRect(bx, boardY, boardW, 1);
      ctx.fillStyle = '#1b2638';
      ctx.fillRect(bx + 1, boardY + boardH - 2, boardW - 2, 2);

      // Enamel dark industrial face
      ctx.fillStyle = '#101b29';
      ctx.fillRect(bx + 2, boardY + 2, boardW - 4, boardH - 4);

      for (let py = boardY + 2; py < boardY + boardH - 2; py++) {
        for (let px = bx + 2; px < bx + boardW - 2; px++) {
          const n = hash2D(px, py, seed);
          if (n > 0.87) {
            ctx.fillStyle = '#162538';
            ctx.fillRect(px, py, 1, 1);
          } else if (n < 0.08) {
            ctx.fillStyle = '#0b131f';
            ctx.fillRect(px, py, 1, 1);
          }
        }
      }

      // Rust streaks & corner rivets
      const rustCols = ['#4d221d', '#6e3226', '#8a422f'];
      for (let i = 0; i < 8; i++) {
        const rx = bx + rng.int(4, boardW - 6);
        const ry = boardY + rng.int(2, boardH - 8);
        const rLen = rng.int(3, 8);
        for (let r = 0; r < rLen; r++) {
          ctx.fillStyle = rustCols[r % rustCols.length];
          ctx.fillRect(rx, ry + r, 1, 1);
        }
      }
      ctx.fillStyle = '#7b94ad';
      ctx.fillRect(bx + 3, boardY + 3, 1, 1);
      ctx.fillRect(bx + boardW - 4, boardY + 3, 1, 1);
      ctx.fillRect(bx + 3, boardY + boardH - 4, 1, 1);
      ctx.fillRect(bx + boardW - 4, boardY + boardH - 4, 1, 1);

      // 3. Header Badge + Pixel Typography
      const badgeW = measurePixelText(header) + 6;
      ctx.fillStyle = badgeBg;
      ctx.fillRect(bx + 5, boardY + 5, badgeW, 7);
      ctx.fillStyle = badgeColor;
      ctx.fillRect(bx + 5, boardY + 5, badgeW, 1);
      drawPixelText(ctx, header, bx + 8, boardY + 6, '#ffffff', '#090c14');

      ctx.fillStyle = badgeColor;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(bx + 5, boardY + 13, boardW - 10, 1);
      ctx.globalAlpha = 1;

      let ly = boardY + 16;
      const lineStep = lines.length > 2 ? 6 : 7;
      for (const line of lines) {
        drawPixelText(ctx, line.text, bx + 6, ly, line.color, '#060a12');
        ly += lineStep;
      }

      // 4. Overgrown Moss / Lichen / Ash Clinging to Cabinet Rim
      for (let mx = bx + 2; mx < bx + boardW - 2; mx++) {
        if (rng.chance(0.42)) {
          ctx.fillStyle = rng.chance(0.45) ? mossColor[1] : mossColor[0];
          ctx.fillRect(mx, boardY - 1, 1, 2);
          if (rng.chance(0.25)) {
            ctx.fillStyle = mossColor[2];
            ctx.fillRect(mx, boardY - 2, 1, 1);
          }
          if (rng.chance(0.20)) {
            ctx.fillStyle = mossColor[0];
            ctx.fillRect(mx, boardY + 1, 1, rng.int(1, 3));
          }
        }
      }

      // 5. Overhead Fluorescent Tube Fixture Hoods
      const hoodW = twoTubes ? Math.floor(boardW * 0.35) : Math.floor(boardW * 0.54);
      const hoodPositions = twoTubes
        ? [bx + 10, bx + boardW - 10 - hoodW]
        : [bx + Math.floor((boardW - hoodW) / 2)];

      const tubeBounds = [];
      for (const hx of hoodPositions) {
        ctx.fillStyle = '#253347';
        ctx.fillRect(hx + 4, 4, 2, boardY - 4);
        ctx.fillRect(hx + hoodW - 6, 4, 2, boardY - 4);
        ctx.fillStyle = '#0c111a';
        ctx.fillRect(hx - 1, 1, hoodW + 2, 5);
        ctx.fillStyle = '#3c4f69';
        ctx.fillRect(hx, 2, hoodW, 3);
        ctx.fillStyle = '#6782a6';
        ctx.fillRect(hx + 1, 2, hoodW - 2, 1);
        ctx.fillStyle = mossColor[1];
        ctx.fillRect(hx + 5, 1, 4, 1);

        tubeBounds.push({ x: hx + 2, y: 5, w: hoodW - 4, h: 2 });
      }

      canvas.tubeBounds = tubeBounds;
      canvas.boardRect = { x: bx, y: boardY, w: boardW, h: boardH };
      canvas.mountType = mountType;
      canvas.wallSide = wallSide;
      canvas.legOffsets = legOffsets;
      canvas.glowColor = glowColor;
      return canvas;
    }

    // -----------------------------------------------------------------------
    // F. LAMPS & BOLTED MOUNTING BRACKETS / FLANGE PLATES
    // -----------------------------------------------------------------------
    bakeLampsAndBrackets() {
      const makeLamp = (shadeDark, shadeMid, shadeHi, rustCol, bulbOuter, bulbMid, bulbCore) => {
        const { canvas, ctx } = createOffscreen(20, 28);
        // Cord & top connector collar
        ctx.fillStyle = '#1b2433';
        ctx.fillRect(8, 0, 4, 3);
        ctx.fillStyle = '#3b4e69';
        ctx.fillRect(9, 2, 2, 6);

        // Dome shade
        ctx.fillStyle = '#080b12';
        ctx.fillRect(4, 7, 12, 6);
        ctx.fillStyle = shadeMid;
        ctx.fillRect(6, 8, 8, 2);
        ctx.fillStyle = shadeHi;
        ctx.fillRect(7, 8, 6, 1);
        ctx.fillStyle = shadeDark;
        ctx.fillRect(4, 10, 12, 3);
        ctx.fillStyle = rustCol;
        ctx.fillRect(12, 10, 3, 2);

        // Glowing bulb
        ctx.fillStyle = bulbOuter;
        ctx.fillRect(7, 13, 6, 5);
        ctx.fillStyle = bulbMid;
        ctx.fillRect(8, 13, 4, 4);
        ctx.fillStyle = bulbCore;
        ctx.fillRect(9, 14, 2, 2);

        // Protective wire cage
        ctx.fillStyle = '#18212e';
        ctx.fillRect(6, 13, 1, 6);
        ctx.fillRect(13, 13, 1, 6);
        ctx.fillRect(9, 17, 2, 2);
        ctx.fillRect(7, 18, 6, 1);
        return canvas;
      };

      // Sector 04: Crimson/coral industrial lamp
      this.cageLamp = makeLamp('#232f42', '#33445c', '#5e7694', '#733528', '#ff3b4d', '#ff7a59', '#fff3d6');
      // Sector 07: Oxidized copper cage + bioluminescent cyan-mint bulb
      this.bioLamp = makeLamp('#1f3836', '#2f5752', '#5ea69d', '#7d4a2b', '#18b89a', '#4dffdb', '#e6fffb');
      // Sector 09: Heavy titanium blast cage + amber gold filament
      this.amberLamp = makeLamp('#2b1e1b', '#47312c', '#7a594d', '#9e3e24', '#e8681e', '#ffaa33', '#fff5cf');

      // Bolted Ceiling Anchor Flange Plate (10x5 px)
      {
        const { canvas, ctx } = createOffscreen(10, 5);
        ctx.fillStyle = '#090d14';
        ctx.fillRect(0, 0, 10, 4);
        ctx.fillStyle = '#384b63';
        ctx.fillRect(1, 0, 8, 3);
        ctx.fillStyle = '#6c87a8';
        ctx.fillRect(1, 0, 8, 1);
        ctx.fillStyle = '#9db7d6';
        ctx.fillRect(2, 1, 1, 1);
        ctx.fillRect(7, 1, 1, 1);
        ctx.fillStyle = '#243245';
        ctx.fillRect(4, 3, 2, 2);
        this.anchorPlate = canvas;
      }

      // Bolted Horizontal Wall Bracket Arm (14x10 px, left & right variants)
      const makeWallArm = (fromLeft) => {
        const { canvas, ctx } = createOffscreen(14, 10);
        const plateX = fromLeft ? 0 : 10;
        const armX = fromLeft ? 3 : 1;
        // Vertical bolted wall plate
        ctx.fillStyle = '#090d14';
        ctx.fillRect(plateX, 0, 4, 10);
        ctx.fillStyle = '#3d526b';
        ctx.fillRect(plateX + (fromLeft ? 1 : 0), 1, 3, 8);
        ctx.fillStyle = '#8ea8c7';
        ctx.fillRect(plateX + 1, 2, 1, 1);
        ctx.fillRect(plateX + 1, 7, 1, 1);
        // Horizontal cantilever arm + diagonal gusset
        ctx.fillStyle = '#182230';
        ctx.fillRect(armX, 2, 10, 3);
        ctx.fillStyle = '#5c7594';
        ctx.fillRect(armX, 2, 10, 1);
        for (let i = 0; i < 4; i++) {
          const gx = fromLeft ? 3 + i : 9 - i;
          ctx.fillStyle = '#2c3d52';
          ctx.fillRect(gx, 7 - i, 2, 2);
        }
        return canvas;
      };
      this.wallBracketLeft = makeWallArm(true);
      this.wallBracketRight = makeWallArm(false);
    }

    // -----------------------------------------------------------------------
    // G. PULSING SECTOR ENERGY CORES / CHECKPOINT ORBS (32x32 px)
    // -----------------------------------------------------------------------
    bakeOrbs() {
      const makeOrb = (rimDark, haloMid, haloBright) => {
        const { canvas, ctx } = createOffscreen(32, 32);
        const cx = 16, cy = 16;
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const dx = x - cx + 0.5;
            const dy = y - cy + 0.5;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 4.3) {
              ctx.fillStyle = dist > 3.1 ? rimDark : '#080410';
              ctx.fillRect(x, y, 1, 1);
            } else if (dist < 6.2) {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(x, y, 1, 1);
            } else if (dist < 8.4) {
              ctx.fillStyle = haloBright;
              ctx.fillRect(x, y, 1, 1);
            } else if (dist < 11.2) {
              ctx.fillStyle = bayerCheck(x, y, 0.72) ? haloMid : rimDark;
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
        return canvas;
      };

      this.energyOrb = makeOrb('#4a146b', '#c24dff', '#ff66d9');
      this.bioOrb = makeOrb('#0e524a', '#1dd6b8', '#75ffea');
      this.reactorOrb = makeOrb('#6b280b', '#ff7b1c', '#ffcc4d');
    }

    // -----------------------------------------------------------------------
    // H. RUBY CRYSTALS & BIOLUMINESCENT SPORE MUSHROOMS
    // -----------------------------------------------------------------------
    bakeCrystals() {
      const drawCluster = (w, h, shards, seed) => {
        const { canvas, ctx } = createOffscreen(w, h);
        for (const s of shards) {
          const { bx, by, tx, ty, halfW } = s;
          const minY = Math.min(by, ty);
          const maxY = Math.max(by, ty);
          for (let py = minY; py <= maxY; py++) {
            const t = (py - by) / ((ty - by) || 1);
            const cx = lerp(bx, tx, t);
            const hw = Math.max(0.6, halfW * (1 - t * 0.85));
            const x0 = Math.round(cx - hw);
            const x1 = Math.round(cx + hw);
            for (let px = x0; px <= x1; px++) {
              const side = (px - cx) / (hw || 1);
              let col = '#c91234';
              if (t > 0.82) col = '#ffffff';
              else if (t > 0.62 || side < -0.35) col = '#ff8fa3';
              else if (side < 0.15) col = '#ff1e42';
              else col = '#69091e';
              ctx.fillStyle = col;
              ctx.fillRect(px, py, 1, 1);
            }
          }
        }
        const rng = new SeededRNG(seed);
        ctx.fillStyle = '#090e18';
        ctx.fillRect(2, h - 3, w - 4, 3);
        for (let x = 2; x < w - 2; x++) {
          if (rng.chance(0.55)) {
            ctx.fillStyle = rng.chance(0.4) ? '#38a86b' : '#1c5c46';
            ctx.fillRect(x, h - 3, 1, 2);
          }
        }
        return canvas;
      };

      this.crystals.push(drawCluster(24, 24, [
        { bx: 7,  by: 21, tx: 4,  ty: 8,  halfW: 2.5 },
        { bx: 17, by: 21, tx: 20, ty: 7,  halfW: 2.5 },
        { bx: 12, by: 22, tx: 13, ty: 2,  halfW: 3.4 }
      ], 101));

      this.crystals.push(drawCluster(18, 20, [
        { bx: 6,  by: 18, tx: 4,  ty: 6,  halfW: 2.4 },
        { bx: 12, by: 18, tx: 14, ty: 3,  halfW: 3.0 }
      ], 202));
    }

    bakeBioMushrooms() {
      const makeMushCluster = (w, h, caps, seed) => {
        const { canvas, ctx } = createOffscreen(w, h);
        const rng = new SeededRNG(seed);
        for (const m of caps) {
          // Curved translucent stalk
          for (let y = m.capY + 2; y < h - 2; y++) {
            const t = (y - m.capY) / (h - m.capY);
            const sx = Math.round(m.x + Math.sin(t * 2.2) * m.curve);
            ctx.fillStyle = '#184a45';
            ctx.fillRect(sx - 1, y, 2, 1);
            ctx.fillStyle = '#52b8aa';
            ctx.fillRect(sx, y, 1, 1);
          }
          // Glowing bioluminescent dome cap
          for (let dy = -m.rY; dy <= 1; dy++) {
            const span = Math.round(m.rX * Math.sqrt(Math.max(0, 1 - (dy / (m.rY + 0.5)) ** 2)));
            for (let dx = -span; dx <= span; dx++) {
              const px = m.x + dx;
              const py = m.capY + dy;
              if (dy === 1) {
                // Underside glowing gills
                ctx.fillStyle = (dx & 1) ? '#99fff0' : '#26a694';
              } else if (dy <= -m.rY + 1) {
                ctx.fillStyle = '#e0fff9';
              } else if (Math.abs(dx) === span) {
                ctx.fillStyle = '#156159';
              } else {
                ctx.fillStyle = '#33e6c8';
              }
              ctx.fillRect(px, py, 1, 1);
            }
          }
          // Tiny glowing spots on cap
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(m.x - 1, m.capY - m.rY + 1, 1, 1);
          if (m.rX >= 4) ctx.fillRect(m.x + 2, m.capY - 1, 1, 1);
        }
        // Mossy verdigris base
        ctx.fillStyle = '#071a1c';
        ctx.fillRect(2, h - 3, w - 4, 3);
        for (let x = 2; x < w - 2; x++) {
          if (rng.chance(0.55)) {
            ctx.fillStyle = rng.chance(0.4) ? '#23b59b' : '#156159';
            ctx.fillRect(x, h - 3, 1, 2);
          }
        }
        return canvas;
      };

      // Variant 0: Tall triple bio-mushroom cluster (24x24)
      this.bioMushrooms.push(makeMushCluster(24, 24, [
        { x: 6,  capY: 13, rX: 4, rY: 3, curve: -1 },
        { x: 18, capY: 11, rX: 4, rY: 3, curve: 1 },
        { x: 12, capY: 6,  rX: 6, rY: 4, curve: 0.6 }
      ], 611));

      // Variant 1: Compact twin bio-mushroom cluster (18x20)
      this.bioMushrooms.push(makeMushCluster(18, 20, [
        { x: 6,  capY: 11, rX: 4, rY: 3, curve: -0.8 },
        { x: 12, capY: 7,  rX: 5, rY: 4, curve: 0.8 }
      ], 612));
    }

    bakeShardPickups() {
      for (let f = 0; f < 4; f++) {
        const { canvas, ctx } = createOffscreen(12, 14);
        const wMod = f === 1 || f === 3 ? 2 : (f === 2 ? 1 : 3);
        const cx = 6;
        for (let dy = 1; dy <= 12; dy++) {
          const span = dy < 6 ? Math.round((dy / 6) * wMod) : Math.round(((12 - dy) / 6) * wMod);
          for (let dx = -span - 1; dx <= span + 1; dx++) {
            const x = cx + dx;
            if (Math.abs(dx) === span + 1 || dy === 1 || dy === 12) {
              ctx.fillStyle = '#24040b';
            } else if (dx <= 0 && dy <= 5) {
              ctx.fillStyle = '#ffffff';
            } else if (dx < 0) {
              ctx.fillStyle = '#ff8fa3';
            } else if (dx === 0) {
              ctx.fillStyle = '#ff1e42';
            } else {
              ctx.fillStyle = '#a30d2b';
            }
            ctx.fillRect(x, dy, 1, 1);
          }
        }
        this.shardFrames.push(canvas);
      }
    }

    bakeCrates() {
      const makeCrate = (w, h, seed) => {
        const { canvas, ctx } = createOffscreen(w, h);
        const rng = new SeededRNG(seed);

        ctx.fillStyle = '#070a10';
        ctx.fillRect(0, 1, w, h - 1);
        ctx.fillStyle = '#243142';
        ctx.fillRect(1, 2, w - 2, h - 3);
        ctx.fillStyle = '#364861';
        ctx.fillRect(1, 2, w - 2, 3);
        ctx.fillStyle = '#5b7494';
        ctx.fillRect(2, 2, w - 4, 1);

        const bandY = Math.floor(h * 0.45);
        for (let x = 3; x < w - 3; x++) {
          for (let y = bandY; y < bandY + 4; y++) {
            const stripe = ((x + y) % 6) < 3;
            ctx.fillStyle = stripe ? '#c98f32' : '#18202c';
            if (rng.chance(0.15)) ctx.fillStyle = '#4f2c1d';
            ctx.fillRect(x, y, 1, 1);
          }
        }

        ctx.fillStyle = '#141c26';
        ctx.fillRect(2, 5, w - 4, 1);
        ctx.fillRect(2, h - 4, w - 4, 1);
        ctx.fillStyle = '#738fad';
        ctx.fillRect(3, 3, 1, 1);
        ctx.fillRect(w - 4, 3, 1, 1);
        ctx.fillRect(3, h - 3, 1, 1);
        ctx.fillRect(w - 4, h - 3, 1, 1);

        for (let x = 2; x < w - 2; x++) {
          if (rng.chance(0.45)) {
            ctx.fillStyle = rng.chance(0.5) ? '#5e2c22' : '#7a3b29';
            ctx.fillRect(x, h - rng.int(2, 4), 1, 2);
          }
        }

        for (let x = 1; x < w - 1; x++) {
          if (rng.chance(0.58)) {
            ctx.fillStyle = '#1c5c46';
            ctx.fillRect(x, 1, 1, 2);
            ctx.fillStyle = rng.chance(0.45) ? '#38a86b' : '#6ee89a';
            ctx.fillRect(x, 0, 1, 1);
          }
        }
        return canvas;
      };

      this.crates.push(makeCrate(24, 20, 303));
      this.crates.push(makeCrate(18, 16, 405));
    }

    bakePipeFixtures() {
      const { canvas, ctx } = createOffscreen(32, 48);
      for (const [px, pw] of [[6, 6], [16, 8]]) {
        ctx.fillStyle = '#090e17';
        ctx.fillRect(px - 1, 0, pw + 2, 48);
        ctx.fillStyle = '#1f2d42';
        ctx.fillRect(px, 0, pw, 48);
        ctx.fillStyle = '#3b5170';
        ctx.fillRect(px + 1, 0, 2, 48);
        for (const cy of [8, 30]) {
          ctx.fillStyle = '#121a26';
          ctx.fillRect(px - 2, cy, pw + 4, 4);
          ctx.fillStyle = '#4e678a';
          ctx.fillRect(px - 1, cy + 1, pw + 2, 1);
        }
      }
      ctx.fillStyle = '#5c1f1e';
      ctx.fillRect(15, 16, 9, 9);
      ctx.fillStyle = '#9e322b';
      ctx.fillRect(16, 17, 7, 7);
      ctx.fillStyle = '#111824';
      ctx.fillRect(17, 18, 2, 2);
      ctx.fillRect(20, 18, 2, 2);
      ctx.fillRect(17, 21, 2, 2);
      ctx.fillRect(20, 21, 2, 2);
      this.pipeFixtures.push(canvas);
    }

    // -----------------------------------------------------------------------
    // I. DATA TERMINALS & SURFACE BROADCAST GATE
    // -----------------------------------------------------------------------
    bakeTerminalAndExitGate() {
      // Interactive Lore CRT Data Console (20x24 px, anchored flush on floor)
      {
        const { canvas, ctx } = createOffscreen(20, 24);
        // Pedestal base anchored to ground
        ctx.fillStyle = '#090d14';
        ctx.fillRect(4, 15, 12, 9);
        ctx.fillStyle = '#243142';
        ctx.fillRect(5, 16, 10, 7);
        ctx.fillStyle = '#485f7d';
        ctx.fillRect(2, 22, 16, 2); // bolted floor plate
        ctx.fillStyle = '#738fad';
        ctx.fillRect(3, 22, 1, 1);
        ctx.fillRect(16, 22, 1, 1);

        // Angled keyboard console lip
        ctx.fillStyle = '#182230';
        ctx.fillRect(2, 13, 16, 4);
        ctx.fillStyle = '#4c6482';
        ctx.fillRect(3, 13, 14, 1);
        ctx.fillStyle = '#7896ba';
        ctx.fillRect(5, 14, 2, 1);
        ctx.fillRect(9, 14, 2, 1);
        ctx.fillRect(13, 14, 1, 1);

        // CRT Monitor Housing
        ctx.fillStyle = '#080c12';
        ctx.fillRect(2, 1, 16, 13);
        ctx.fillStyle = '#334459';
        ctx.fillRect(3, 2, 14, 11);
        ctx.fillStyle = '#5c7594';
        ctx.fillRect(3, 2, 14, 1);

        // Dark CRT Glass Screen
        ctx.fillStyle = '#061412';
        ctx.fillRect(4, 4, 12, 8);
        canvas.screenRect = { x: 4, y: 4, w: 12, h: 8 };
        this.terminalSprite = canvas;
      }

      // Surface Broadcast Relay Beacon Gate (34x44 px)
      {
        const { canvas, ctx } = createOffscreen(34, 44);
        // Bolted base platform
        ctx.fillStyle = '#090d14';
        ctx.fillRect(2, 36, 30, 8);
        ctx.fillStyle = '#2a394f';
        ctx.fillRect(3, 37, 28, 6);
        ctx.fillStyle = '#607a9c';
        ctx.fillRect(4, 37, 26, 1);
        // Hazard strip along base
        for (let x = 5; x < 29; x++) {
          ctx.fillStyle = ((x >> 1) & 1) ? '#d9982b' : '#18202c';
          ctx.fillRect(x, 39, 1, 2);
        }

        // Twin heavy broadcast spire pylons
        ctx.fillStyle = '#0a0f17';
        ctx.fillRect(7, 8, 20, 29);
        ctx.fillStyle = '#1d2838';
        ctx.fillRect(8, 9, 18, 28);
        ctx.fillStyle = '#3b4e69';
        ctx.fillRect(9, 10, 4, 27);
        ctx.fillRect(21, 10, 4, 27);
        ctx.fillStyle = '#6b87a8';
        ctx.fillRect(10, 10, 1, 27);
        ctx.fillRect(22, 10, 1, 27);

        // Central Spire Antenna Needle
        ctx.fillStyle = '#567091';
        ctx.fillRect(16, 1, 2, 16);
        ctx.fillStyle = '#b4cee8';
        ctx.fillRect(16, 1, 1, 12);

        // Dish / Emitter Ring
        ctx.fillStyle = '#121a26';
        ctx.fillRect(12, 16, 10, 12);
        ctx.fillStyle = '#4f6885';
        ctx.fillRect(13, 17, 8, 2);
        ctx.fillRect(13, 25, 8, 2);

        this.exitGateSprite = canvas;
      }
    }

    // -----------------------------------------------------------------------
    // J. HIGH-CRAFT MOVING MACHINERY SPRITES
    // -----------------------------------------------------------------------
    bakeMachinerySprites() {
      // 1. Heavy Riveted Freight Elevator Cage (48x18 px floor + side frame bars)
      {
        const w = 48, h = 24;
        const { canvas, ctx } = createOffscreen(w, h);
        // Top overhead hoist crossbar & clevis ring (y = 0..4)
        ctx.fillStyle = '#090d14';
        ctx.fillRect(21, 0, 6, 3);
        ctx.fillStyle = '#5f7899';
        ctx.fillRect(22, 0, 4, 2);
        ctx.fillStyle = '#253347';
        ctx.fillRect(4, 2, w - 8, 3);
        ctx.fillStyle = '#4e6785';
        ctx.fillRect(4, 2, w - 8, 1);

        // Vertical corner tension struts connecting top bar to cage floor
        for (const sx of [3, w - 6]) {
          ctx.fillStyle = '#0a0f17';
          ctx.fillRect(sx, 3, 3, 12);
          ctx.fillStyle = '#384c66';
          ctx.fillRect(sx + 1, 3, 1, 12);
        }

        // Heavy Steel Cage Deck (y = 14..24 -> deck top sits at y=14)
        const dy = 14;
        ctx.fillStyle = '#080c12';
        ctx.fillRect(0, dy, w, 10);
        ctx.fillStyle = '#465d7a';
        ctx.fillRect(1, dy, w - 2, 2);
        ctx.fillStyle = '#7b94ad';
        ctx.fillRect(1, dy, w - 2, 1);

        // Yellow/black industrial hazard stripe band
        for (let x = 2; x < w - 2; x++) {
          for (let y = dy + 3; y < dy + 6; y++) {
            const stripe = ((x + y) % 6) < 3;
            ctx.fillStyle = stripe ? '#d49a2a' : '#18202c';
            ctx.fillRect(x, y, 1, 1);
          }
        }

        // Underside heavy steel ribs & rivets
        ctx.fillStyle = '#212e40';
        ctx.fillRect(1, dy + 6, w - 2, 3);
        ctx.fillStyle = '#627c9c';
        for (let rx = 4; rx < w - 4; rx += 8) {
          ctx.fillRect(rx, dy + 7, 1, 1);
        }

        canvas.deckOffsetY = dy;
        canvas.beaconCoords = [{ x: 3, y: 8 }, { x: w - 6, y: 8 }];
        this.elevatorCage = canvas;
      }

      // 2. Bolted Overhead Pulley Wheel (4 Rotation Frames, 18x18 px)
      for (let f = 0; f < 4; f++) {
        const { canvas, ctx } = createOffscreen(18, 18);
        const cx = 9, cy = 9;
        // Ceiling mounting housing bracket behind top half
        ctx.fillStyle = '#090d14';
        ctx.fillRect(4, 0, 10, 8);
        ctx.fillStyle = '#314259';
        ctx.fillRect(5, 0, 8, 7);
        ctx.fillStyle = '#607a9c';
        ctx.fillRect(5, 0, 8, 1);

        // Outer circular pulley wheel
        for (let y = 0; y < 18; y++) {
          for (let x = 0; x < 18; x++) {
            const dx = x - cx + 0.5;
            const dy = y - cy + 0.5;
            const r = Math.hypot(dx, dy);
            if (r <= 7.4 && r >= 5.2) {
              ctx.fillStyle = r > 6.5 ? '#0b1018' : (dy < 0 ? '#6b87a8' : '#354861');
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }

        // Rotating 4 spokes
        const baseAng = (f * Math.PI) / 8;
        for (let s = 0; s < 4; s++) {
          const ang = baseAng + (s * Math.PI) / 2;
          for (let step = 1; step <= 5; step++) {
            const sx = Math.round(cx + Math.cos(ang) * step);
            const sy = Math.round(cy + Math.sin(ang) * step);
            ctx.fillStyle = '#4e6785';
            ctx.fillRect(sx, sy, 1, 1);
          }
        }
        // Center axle hub
        ctx.fillStyle = '#090d14';
        ctx.fillRect(cx - 2, cy - 2, 4, 4);
        ctx.fillStyle = '#99b4d1';
        ctx.fillRect(cx - 1, cy - 1, 2, 2);
        this.pulleyWheelFrames.push(canvas);
      }

      // 3. Heavy Cast-Iron Counterweight Block (14x20 px)
      {
        const { canvas, ctx } = createOffscreen(14, 20);
        ctx.fillStyle = '#080b12';
        ctx.fillRect(1, 2, 12, 17);
        // Hoist eyelet top
        ctx.fillStyle = '#536c8a';
        ctx.fillRect(5, 0, 4, 3);
        // Main ballast plates
        ctx.fillStyle = '#263447';
        ctx.fillRect(2, 3, 10, 15);
        ctx.fillStyle = '#475e7a';
        ctx.fillRect(2, 3, 10, 2);
        // Recessed horizontal ribs
        ctx.fillStyle = '#121a26';
        ctx.fillRect(2, 7, 10, 2);
        ctx.fillRect(2, 12, 10, 2);
        // Hazard stripe band
        for (let x = 3; x < 11; x++) {
          ctx.fillStyle = (x & 1) ? '#c98e2b' : '#18202c';
          ctx.fillRect(x, 15, 1, 2);
        }
        // Guide rail shoes on left/right
        ctx.fillStyle = '#6f8aa8';
        ctx.fillRect(0, 5, 2, 3);
        ctx.fillRect(0, 14, 2, 3);
        ctx.fillRect(12, 5, 2, 3);
        ctx.fillRect(12, 14, 2, 3);
        this.counterweight = canvas;
      }

      // 4. Motorized I-Beam Cargo Gondola Trolley (20x12 px)
      {
        const { canvas, ctx } = createOffscreen(20, 12);
        ctx.fillStyle = '#090d14';
        ctx.fillRect(2, 1, 16, 9);
        ctx.fillStyle = '#2d3d54';
        ctx.fillRect(3, 2, 14, 7);
        ctx.fillStyle = '#5f7899';
        ctx.fillRect(3, 2, 14, 1);
        // Dual flanged rail wheels with glowing amber bearings
        for (const wx of [5, 13]) {
          ctx.fillStyle = '#141c26';
          ctx.fillRect(wx - 1, 0, 4, 4);
          ctx.fillStyle = '#ffaa33';
          ctx.fillRect(wx, 1, 2, 2);
        }
        // Bottom suspension clevis
        ctx.fillStyle = '#4e6785';
        ctx.fillRect(8, 9, 4, 3);
        this.gondolaTrolley = canvas;
      }

      // 5. Suspended Cargo Gondola Car (44x22 px)
      {
        const w = 44, h = 22;
        const { canvas, ctx } = createOffscreen(w, h);
        // Overhead suspension yoke & corner rods
        ctx.fillStyle = '#3c506b';
        ctx.fillRect(20, 0, 4, 3);
        ctx.fillRect(4, 2, w - 8, 2);
        ctx.fillStyle = '#1b2636';
        ctx.fillRect(4, 4, 2, 10);
        ctx.fillRect(w - 6, 4, 2, 10);

        // Warm work lantern hanging from yoke
        ctx.fillStyle = '#253347';
        ctx.fillRect(19, 3, 6, 3);
        ctx.fillStyle = '#ffaa33';
        ctx.fillRect(20, 6, 4, 3);
        ctx.fillStyle = '#fff3d6';
        ctx.fillRect(21, 6, 2, 2);

        // Gondola steel platform floor (top sits at y = 14)
        const dy = 14;
        ctx.fillStyle = '#090d14';
        ctx.fillRect(0, dy, w, 8);
        ctx.fillStyle = '#4c6482';
        ctx.fillRect(1, dy, w - 2, 2);
        ctx.fillStyle = '#7b94ad';
        ctx.fillRect(1, dy, w - 2, 1);
        for (let x = 2; x < w - 2; x++) {
          ctx.fillStyle = ((x >> 1) & 1) ? '#c98e2b' : '#18202c';
          ctx.fillRect(x, dy + 3, 1, 2);
        }
        ctx.fillStyle = '#243245';
        ctx.fillRect(2, dy + 5, w - 4, 2);

        canvas.deckOffsetY = dy;
        canvas.lanternOffset = { x: 22, y: 7 };
        this.gondolaCar = canvas;
      }

      // 6. Industrial Exhaust Turbine Rotor (4 Rotation Frames, 36x36 px)
      for (let f = 0; f < 4; f++) {
        const size = 36;
        const { canvas, ctx } = createOffscreen(size, size);
        const cx = 18, cy = 18;

        // Recessed dark circular vent cavity & riveted bezel frame
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const dx = x - cx + 0.5;
            const dy = y - cy + 0.5;
            const r = Math.hypot(dx, dy);
            if (r <= 17.5 && r >= 14.5) {
              ctx.fillStyle = r > 16.5 ? '#060a10' : (dy < 0 ? '#3a4e68' : '#1c2838');
              ctx.fillRect(x, y, 1, 1);
            } else if (r < 14.5) {
              ctx.fillStyle = '#040812';
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }

        // 6 angled spinning turbine blades
        const baseAng = (f * Math.PI) / 12;
        for (let b = 0; b < 6; b++) {
          const ang = baseAng + (b * Math.PI) / 3;
          const perp = ang + Math.PI / 2;
          for (let r = 3; r <= 13; r++) {
            const bx = cx + Math.cos(ang) * r;
            const by = cy + Math.sin(ang) * r;
            const width = 1.2 + (r / 13) * 1.6;
            for (let w = -width; w <= width; w += 0.7) {
              const px = Math.round(bx + Math.cos(perp) * w);
              const py = Math.round(by + Math.sin(perp) * w);
              ctx.fillStyle = w < 0 ? '#4e6887' : '#243347';
              ctx.fillRect(px, py, 1, 1);
            }
          }
        }

        // Central hub cap + bezel rivets
        ctx.fillStyle = '#0c111a';
        ctx.fillRect(cx - 3, cy - 3, 6, 6);
        ctx.fillStyle = '#6b87a8';
        ctx.fillRect(cx - 2, cy - 2, 4, 4);
        ctx.fillStyle = '#9db4d4';
        ctx.fillRect(cx - 1, cy - 1, 2, 2);

        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          ctx.fillStyle = '#7b94ad';
          ctx.fillRect(Math.round(cx + Math.cos(a) * 15.8), Math.round(cy + Math.sin(a) * 15.8), 1, 1);
        }

        this.turbineFrames.push(canvas);
      }

      // 7. Pressurized Steam Vent Valve (14x14 px)
      {
        const { canvas, ctx } = createOffscreen(14, 14);
        ctx.fillStyle = '#090d14';
        ctx.fillRect(2, 2, 10, 10);
        ctx.fillStyle = '#2d3d54';
        ctx.fillRect(3, 3, 8, 8);
        ctx.fillStyle = '#5c7594';
        ctx.fillRect(4, 3, 6, 2);
        // Brass nozzle & pressure gauge
        ctx.fillStyle = '#b87d28';
        ctx.fillRect(5, 5, 4, 4);
        ctx.fillStyle = '#ffcf6e';
        ctx.fillRect(6, 6, 2, 2);
        ctx.fillStyle = '#0c111a';
        ctx.fillRect(6, 1, 2, 2);
        this.steamValve = canvas;
      }
    }

    // -----------------------------------------------------------------------
    // K. LAYER 7: EXTREME BLURRED FOREGROUND DEPTH-OF-FIELD SILHOUETTES
    // -----------------------------------------------------------------------
    bakeBlurredForegroundDOF() {
      const makeBlurredChunk = (w, h, drawFn) => {
        const pad = 14;
        const raw = createOffscreen(w + pad * 2, h + pad * 2);
        raw.ctx.save();
        raw.ctx.translate(pad, pad);
        drawFn(raw.ctx, w, h);
        raw.ctx.restore();

        const blurred = createOffscreen(w + pad * 2, h + pad * 2);
        const bctx = blurred.ctx;
        bctx.imageSmoothingEnabled = true;
        if ('filter' in bctx) {
          bctx.filter = 'blur(5px)';
          bctx.drawImage(raw.canvas, 0, 0);
          bctx.filter = 'none';
        } else {
          bctx.globalAlpha = 0.22;
          for (let ox = -3; ox <= 3; ox += 2) {
            for (let oy = -3; oy <= 3; oy += 2) {
              bctx.drawImage(raw.canvas, ox, oy);
            }
          }
          bctx.globalAlpha = 1;
        }
        return blurred.canvas;
      };

      for (let v = 0; v < 2; v++) {
        this.dofBottomChunks.push(makeBlurredChunk(260, 42, (ctx, w, h) => {
          const rng = new SeededRNG(910 + v * 55);
          ctx.fillStyle = '#030408';
          ctx.beginPath();
          ctx.moveTo(-10, h + 12);
          ctx.lineTo(-10, h - 10);
          for (let x = 0; x <= w + 10; x += 14) {
            const peak = rng.range(10, 32);
            ctx.lineTo(x, h - peak);
          }
          ctx.lineTo(w + 10, h + 12);
          ctx.closePath();
          ctx.fill();
        }));
      }

      for (let v = 0; v < 2; v++) {
        this.dofTopChunks.push(makeBlurredChunk(260, 38, (ctx, w, h) => {
          const rng = new SeededRNG(950 + v * 71);
          ctx.fillStyle = '#030408';
          ctx.beginPath();
          ctx.moveTo(-10, -12);
          for (let x = 0; x <= w + 10; x += 12) {
            const drop = rng.range(8, 28);
            ctx.lineTo(x, drop);
          }
          ctx.lineTo(w + 10, -12);
          ctx.closePath();
          ctx.fill();

          ctx.lineWidth = 3;
          ctx.strokeStyle = '#030408';
          for (let rx = 22; rx < w - 20; rx += rng.int(36, 68)) {
            ctx.beginPath();
            ctx.moveTo(rx, 0);
            ctx.quadraticCurveTo(rx + rng.range(-8, 8), 18, rx + rng.range(-5, 5), rng.range(24, 36));
            ctx.stroke();
          }
        }));
      }

      this.dofSideSpire = makeBlurredChunk(44, 180, (ctx, w, h) => {
        const rng = new SeededRNG(991);
        ctx.fillStyle = '#030408';
        ctx.beginPath();
        ctx.moveTo(-10, -10);
        for (let y = 0; y <= h + 10; y += 16) {
          ctx.lineTo(rng.range(14, 32), y);
        }
        ctx.lineTo(-10, h + 10);
        ctx.closePath();
        ctx.fill();
      });
    }
  }
  GAME.AssetFactory = AssetFactory;
})();