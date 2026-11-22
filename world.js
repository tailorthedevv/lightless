(() => {
  'use strict';

  const GAME = (window.GAME = window.GAME || {});
  const {
    PIXEL_W,
    PIXEL_H,
    TILE_SIZE,
    BIOME_PALETTES,
    hash2D,
    clamp,
    lerp
  } = GAME;

  // =========================================================================
  // 1. VERLET PHYSICS SYSTEM (CHAINS, FIBER-OPTICS, PENNANTS, CABLES, GRASS)
  // =========================================================================
  class VerletSystem {
    constructor() {
      this.chains = [];
      this.grassBlades = [];
    }

    clear() {
      this.chains = [];
      this.grassBlades = [];
    }

    addHangingChain(x, anchorY, links, segLen = 5, hasWeight = false, isVine = false, broken = false, isFiber = false) {
      const nodes = [];
      for (let i = 0; i <= links; i++) {
        nodes.push({
          x,
          y: anchorY + i * segLen,
          ox: x,
          oy: anchorY + i * segLen,
          pinned: i === 0
        });
      }
      this.chains.push({
        type: isFiber ? 'fiber_optic' : (broken ? 'broken_cable' : (isVine ? 'vine' : 'chain')),
        anchorX: x,
        anchorY,
        nodes,
        segLen,
        hasWeight,
        broken,
        sparkTimer: broken ? 0.6 + Math.random() * 2.2 : 0,
        phase: Math.random() * Math.PI * 2
      });
    }

    addPennant(x, y, segments = 6, segLen = 4, color = '#c93b4b') {
      const nodes = [];
      for (let i = 0; i <= segments; i++) {
        nodes.push({
          x: x + i * segLen,
          y: y + i * 0.6,
          ox: x + i * segLen,
          oy: y + i * 0.6,
          pinned: i === 0
        });
      }
      this.chains.push({
        type: 'pennant',
        anchorX: x,
        anchorY: y,
        nodes,
        segLen,
        color,
        hasWeight: false,
        broken: false,
        phase: Math.random() * Math.PI * 2
      });
    }

    addPowerCable(x0, y0, x1, y1, slack = 1.16, segments = 14) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const totalDist = Math.hypot(dx, dy) * slack;
      const segLen = totalDist / segments;
      const nodes = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const sag = Math.sin(t * Math.PI) * (totalDist * 0.14);
        const nx = lerp(x0, x1, t);
        const ny = lerp(y0, y1, t) + sag;
        nodes.push({
          x: nx,
          y: ny,
          ox: nx,
          oy: ny,
          pinned: i === 0 || i === segments
        });
      }
      this.chains.push({
        type: 'cable',
        anchorStart: { x: x0, y: y0 },
        anchorEnd: { x: x1, y: y1 },
        nodes,
        segLen,
        hasWeight: false,
        broken: false,
        phase: Math.random() * Math.PI * 2
      });
    }

    addGrassBlade(x, y, height, color, tipGlow = null) {
      this.grassBlades.push({
        x,
        y,
        height,
        color,
        tipGlow,
        angle: 0,
        vel: 0,
        phase: Math.random() * Math.PI * 2
      });
    }

    update(dt, time, player, windForce = 0) {
      const damping = 0.982;
      const gravity = 440 * dt * dt;
      const px = player.x + player.w * 0.5;
      const py = player.y + player.h * 0.5;

      for (const chain of this.chains) {
        const nodes = chain.nodes;
        const isPennant = chain.type === 'pennant';
        const windAmp = chain.type === 'cable' ? 14 : (isPennant ? 55 : 26);
        const ambientWind =
          (Math.sin(time * 1.45 + chain.phase) * 0.65 +
            Math.sin(time * 3.1 + chain.phase * 1.7) * 0.35) *
          windAmp *
          dt *
          dt;
        const gust = windForce * (isPennant ? 1.85 : 0.85) * dt * dt;

        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (n.pinned) continue;
          const vx = (n.x - n.ox) * damping;
          const vy = (n.y - n.oy) * damping;
          n.ox = n.x;
          n.oy = n.y;
          const weightFactor = 0.4 + 0.6 * (i / nodes.length);
          n.x += vx + (ambientWind + gust) * weightFactor;
          n.y += vy + gravity * (isPennant ? 0.35 : 1.0);

          const dx = n.x - px;
          const dy = n.y - py;
          const distSq = dx * dx + dy * dy;
          if (distSq < 169 && distSq > 0.01) {
            const dist = Math.sqrt(distSq);
            const push = (1 - dist / 13) * 1.45;
            n.x += (dx / dist) * push + player.vx * dt * 0.25;
            n.y += (dy / dist) * push * 0.5 + player.vy * dt * 0.14;
          }
        }

        for (let iter = 0; iter < 7; iter++) {
          for (let i = 0; i < nodes.length - 1; i++) {
            const a = nodes[i];
            const b = nodes[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 0.0001;
            const diff = (chain.segLen - dist) / dist;
            if (!a.pinned && !b.pinned) {
              a.x -= dx * diff * 0.5;
              a.y -= dy * diff * 0.5;
              b.x += dx * diff * 0.5;
              b.y += dy * diff * 0.5;
            } else if (a.pinned && !b.pinned) {
              b.x += dx * diff;
              b.y += dy * diff;
            } else if (!a.pinned && b.pinned) {
              a.x -= dx * diff;
              a.y -= dy * diff;
            }
          }
        }
      }

      for (const blade of this.grassBlades) {
        const windTarget =
          Math.sin(time * 2.1 + blade.x * 0.07 + blade.phase) * 0.22 +
          clamp(windForce * 0.0045, -0.75, 0.75);
        const dx = blade.x - px;
        const dy = blade.y - (player.y + player.h);
        let playerPush = 0;
        if (Math.abs(dx) < 11 && Math.abs(dy) < 10) {
          const dir = dx >= 0 ? 1 : -1;
          playerPush = dir * (1 - Math.abs(dx) / 11) * 0.95 + (player.vx / 130) * 0.45;
        }
        const target = clamp(windTarget + playerPush, -1.15, 1.15);
        const force = (target - blade.angle) * 42;
        blade.vel = (blade.vel + force * dt) * 0.86;
        blade.angle += blade.vel * dt * 8;
      }
    }

    render(ctx, camX, camY, assets, biome, player = null, machinery = null) {
      const vineDark =
        biome === 'sector07' ? '#156159'
        : biome === 'sector09' ? '#26181a'
        : biome === 'amber' ? '#5c2128'
        : biome === 'atrium' ? '#25521d'
        : '#1c5c46';
      const vineTip =
        biome === 'sector07' ? '#33e6c8'
        : biome === 'sector09' ? '#4d332d'
        : biome === 'amber' ? '#ffd27d'
        : biome === 'atrium' ? '#d9f77a'
        : '#38a86b';

      const px = player ? player.x + player.w * 0.5 : -9999;
      const py = player ? player.y + player.h * 0.5 : -9999;
      const sonarWaves = machinery ? machinery.sonarWaves : [];

      for (const chain of this.chains) {
        const nodes = chain.nodes;
        if (chain.type === 'cable') {
          for (const anc of [chain.anchorStart, chain.anchorEnd]) {
            const jx = Math.round(anc.x - camX);
            const jy = Math.round(anc.y - camY);
            ctx.fillStyle = '#090d14';
            ctx.fillRect(jx - 3, jy - 3, 6, 6);
            ctx.fillStyle = '#384c66';
            ctx.fillRect(jx - 2, jy - 2, 4, 4);
            ctx.fillStyle = '#8aa4c7';
            ctx.fillRect(jx - 1, jy - 1, 1, 1);
          }
          for (let i = 0; i < nodes.length - 1; i++) {
            const x0 = Math.round(nodes[i].x - camX);
            const y0 = Math.round(nodes[i].y - camY);
            const x1 = Math.round(nodes[i + 1].x - camX);
            const y1 = Math.round(nodes[i + 1].y - camY);
            this.drawPixelLine(ctx, x0, y0, x1, y1, '#080c14', 2);
            this.drawPixelLine(ctx, x0, y0 - 1, x1, y1 - 1, '#2b3f5e', 1);
            if (i === Math.floor(nodes.length / 2)) {
              ctx.fillStyle = '#4f6b91';
              ctx.fillRect(x0 - 1, y0 - 1, 3, 3);
            }
          }
        } else if (chain.type === 'pennant') {
          // Bolted pole & whipping cloth pennant banner
          const ax = Math.round(chain.anchorX - camX);
          const ay = Math.round(chain.anchorY - camY);
          ctx.fillStyle = '#1b2236';
          ctx.fillRect(ax - 1, ay - 2, 2, 16);
          ctx.fillStyle = '#8fa1c7';
          ctx.fillRect(ax - 1, ay - 2, 1, 12);
          for (let i = 0; i < nodes.length - 1; i++) {
            const x0 = Math.round(nodes[i].x - camX);
            const y0 = Math.round(nodes[i].y - camY);
            const x1 = Math.round(nodes[i + 1].x - camX);
            const y1 = Math.round(nodes[i + 1].y - camY);
            const thick = i < 2 ? 3 : (i < 4 ? 2 : 1);
            this.drawPixelLine(ctx, x0, y0, x1, y1, i % 2 === 0 ? chain.color : '#ffd27d', thick);
          }
        } else if (chain.type === 'fiber_optic') {
          const ax = Math.round(chain.anchorX - camX);
          const ay = Math.round(chain.anchorY - camY);
          if (assets && assets.anchorPlate) ctx.drawImage(assets.anchorPlate, ax - 5, ay - 1);
          for (let i = 0; i < nodes.length - 1; i++) {
            const n0 = nodes[i], n1 = nodes[i + 1];
            const x0 = Math.round(n0.x - camX), y0 = Math.round(n0.y - camY);
            const x1 = Math.round(n1.x - camX), y1 = Math.round(n1.y - camY);
            // Faint shimmer when player aura or sonar passes near!
            let lit = Math.hypot(n1.x - px, n1.y - py) < 62;
            if (!lit) {
              for (const sw of sonarWaves) {
                if (Math.abs(Math.hypot(n1.x - sw.x, n1.y - sw.y) - sw.r) < 34) {
                  lit = true;
                  break;
                }
              }
            }
            this.drawPixelLine(ctx, x0, y0, x1, y1, lit ? '#705cff' : '#090a1a', 1);
            if (lit && i === nodes.length - 2) {
              ctx.fillStyle = '#cfe8ff';
              ctx.fillRect(x1, y1, 2, 2);
            }
          }
        } else if (chain.type === 'broken_cable') {
          const ax = Math.round(chain.anchorX - camX);
          const ay = Math.round(chain.anchorY - camY);
          if (assets && assets.anchorPlate) ctx.drawImage(assets.anchorPlate, ax - 5, ay - 1);
          for (let i = 0; i < nodes.length - 1; i++) {
            const x0 = Math.round(nodes[i].x - camX);
            const y0 = Math.round(nodes[i].y - camY);
            const x1 = Math.round(nodes[i + 1].x - camX);
            const y1 = Math.round(nodes[i + 1].y - camY);
            this.drawPixelLine(ctx, x0, y0, x1, y1, '#090d14', 2);
            this.drawPixelLine(ctx, x0, y0, x1, y1, '#3a5170', 1);
          }
          const end = nodes[nodes.length - 1];
          const ex = Math.round(end.x - camX);
          const ey = Math.round(end.y - camY);
          ctx.fillStyle = chain.sparkTimer < 0.14 ? '#ffffff' : '#d4822a';
          ctx.fillRect(ex - 1, ey, 2, 2);
        } else if (chain.type === 'vine') {
          for (let i = 0; i < nodes.length - 1; i++) {
            const x0 = Math.round(nodes[i].x - camX);
            const y0 = Math.round(nodes[i].y - camY);
            const x1 = Math.round(nodes[i + 1].x - camX);
            const y1 = Math.round(nodes[i + 1].y - camY);
            this.drawPixelLine(ctx, x0, y0, x1, y1, i > nodes.length - 3 ? vineTip : vineDark, 1);
            if (i % 2 === 1) {
              ctx.fillStyle = vineTip;
              ctx.fillRect(x0 + (i % 4 === 1 ? 1 : -1), y0, 1, 2);
            }
          }
        } else {
          const ax = Math.round(chain.anchorX - camX);
          const ay = Math.round(chain.anchorY - camY);
          if (assets && assets.anchorPlate) ctx.drawImage(assets.anchorPlate, ax - 5, ay - 1);

          for (let i = 0; i < nodes.length - 1; i++) {
            const x0 = Math.round(nodes[i].x - camX);
            const y0 = Math.round(nodes[i].y - camY);
            const x1 = Math.round(nodes[i + 1].x - camX);
            const y1 = Math.round(nodes[i + 1].y - camY);
            const mx = Math.round((x0 + x1) * 0.5);
            const my = Math.round((y0 + y1) * 0.5);
            if (i % 2 === 0) {
              ctx.fillStyle = '#121924';
              ctx.fillRect(mx - 1, my - 2, 3, 4);
              ctx.fillStyle = '#536c8a';
              ctx.fillRect(mx, my - 1, 1, 2);
            } else {
              ctx.fillStyle = '#263447';
              ctx.fillRect(mx, my - 2, 2, 4);
              ctx.fillStyle = '#738fad';
              ctx.fillRect(mx, my - 1, 1, 1);
            }
          }
          if (chain.hasWeight) {
            const end = nodes[nodes.length - 1];
            const ex = Math.round(end.x - camX);
            const ey = Math.round(end.y - camY);
            ctx.fillStyle = '#0d131d';
            ctx.fillRect(ex - 2, ey - 1, 5, 5);
            ctx.fillStyle = '#475e7a';
            ctx.fillRect(ex - 1, ey, 3, 3);
          }
        }
      }

      for (const b of this.grassBlades) {
        const bx = Math.round(b.x - camX);
        const by = Math.round(b.y - camY);
        if (bx < -6 || bx > PIXEL_W + 6 || by < -8 || by > PIXEL_H + 8) continue;
        const tipX = Math.round(bx + Math.sin(b.angle) * b.height);
        const tipY = Math.round(by - Math.cos(b.angle * 0.5) * b.height);
        this.drawPixelLine(ctx, bx, by, tipX, tipY, b.color, 1);
        if (b.tipGlow) {
          ctx.fillStyle = b.tipGlow;
          ctx.fillRect(tipX, tipY, 1, 1);
        }
      }
    }

    drawPixelLine(ctx, x0, y0, x1, y1, color, thickness = 1) {
      ctx.fillStyle = color;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      while (true) {
        ctx.fillRect(x0, y0, thickness, thickness);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    }
  }
  GAME.VerletSystem = VerletSystem;

  // =========================================================================
  // 2. ATMOSPHERIC PARTICLE SYSTEM (MOTES, SPARKS, WIND, RAINBOW MIST, BUBBLES)
  // =========================================================================
  class ParticleSystem {
    constructor(worldW, worldH, palette) {
      this.worldW = worldW;
      this.worldH = worldH;
      this.palette = palette || BIOME_PALETTES.sector04;
      this.motes = [];
      this.particles = [];
      this.shockwaves = [];
      this.ripples = [];
      this.liquidBubbles = [];
      this.windStreaks = [];
      this.reset(worldW, worldH, this.palette);
    }

    reset(worldW, worldH, palette) {
      this.worldW = worldW;
      this.worldH = worldH;
      this.palette = palette || BIOME_PALETTES.sector04;
      this.motes = [];
      this.particles = [];
      this.shockwaves = [];
      this.ripples = [];
      this.liquidBubbles = [];
      this.windStreaks = [];

      const moteColors = this.palette.moteColors;
      for (let i = 0; i < 150; i++) {
        this.motes.push({
          x: Math.random() * worldW,
          y: Math.random() * worldH,
          vx: (Math.random() - 0.5) * 6,
          vy: -2.2 - Math.random() * 5,
          size: Math.random() < 0.18 ? 2 : 1,
          phase: Math.random() * Math.PI * 2,
          color: moteColors[i % moteColors.length],
          alpha: 0.25 + Math.random() * 0.55
        });
      }
    }

    spawnParticle(x, y, vx, vy, life, color, gravity = 0, size = 1, isSprinklerDrop = false) {
      this.particles.push({ x, y, vx, vy, life, maxLife: life, color, gravity, size, isSprinklerDrop });
    }

    spawnDustPuff(x, y, count = 5) {
      const cols = ['#7b94ad', '#4a5d73', '#9db4d4'];
      for (let i = 0; i < count; i++) {
        this.spawnParticle(
          x + (Math.random() - 0.5) * 8,
          y - 1,
          (Math.random() - 0.5) * 32,
          -10 - Math.random() * 24,
          0.24 + Math.random() * 0.22,
          cols[i % cols.length],
          35,
          Math.random() < 0.3 ? 2 : 1
        );
      }
    }

    spawnElectricSparks(x, y, count = 6) {
      const cols = ['#ffffff', '#8ce8ff', '#ffaa33'];
      for (let i = 0; i < count; i++) {
        this.spawnParticle(
          x, y,
          (Math.random() - 0.5) * 75,
          -20 - Math.random() * 45,
          0.18 + Math.random() * 0.24,
          cols[i % cols.length],
          220,
          1
        );
      }
    }

    spawnMachineryClunk(x, y) {
      const cols = ['#ffaa33', '#ffd875', '#7b94ad'];
      for (let i = 0; i < 6; i++) {
        this.spawnParticle(
          x + (Math.random() - 0.5) * 38,
          y,
          (Math.random() - 0.5) * 44,
          -12 - Math.random() * 24,
          0.22 + Math.random() * 0.2,
          cols[i % cols.length],
          80,
          1
        );
      }
    }

    spawnWaterSplash(x, y, count = 4, cols = null) {
      const palCols = cols || [this.palette.waterHighlight, '#ffffff', this.palette.waterMid];
      for (let i = 0; i < count; i++) {
        this.spawnParticle(
          x + (Math.random() - 0.5) * 4,
          y,
          (Math.random() - 0.5) * 40,
          -25 - Math.random() * 35,
          0.28 + Math.random() * 0.2,
          palCols[i % palCols.length],
          150,
          1
        );
      }
      this.ripples.push({ x, y, r: 1, maxR: 9, life: 0.45, maxLife: 0.45 });
    }

    spawnEmber(x, y, biome) {
      let cols = ['#ff3b4d', '#ff7a59', '#ffd180'];
      if (biome === 'sector07') cols = ['#4dffdb', '#99fff0', '#23b59b'];
      else if (biome === 'sector09') cols = ['#ffaa33', '#ff6b3d', '#fff3cf'];
      else if (biome === 'cryo') cols = ['#cfe8ff', '#705cff', '#ffffff'];
      else if (biome === 'amber') cols = ['#ffd27d', '#ff7369', '#fff2c2'];
      else if (biome === 'atrium') cols = ['#fff5bd', '#d9f77a', '#ffffff'];
      this.spawnParticle(
        x + (Math.random() - 0.5) * 6,
        y + 2,
        (Math.random() - 0.5) * 14,
        -12 - Math.random() * 18,
        0.55 + Math.random() * 0.65,
        cols[Math.floor(Math.random() * cols.length)],
        -6,
        1
      );
    }

    spawnSteamPlume(x, y, dirX, dirY) {
      const cols = ['#c7d9eb', '#95adc7', '#dceeff', '#6b829c'];
      for (let i = 0; i < 2; i++) {
        const spread = (Math.random() - 0.5) * 26;
        this.spawnParticle(
          x + (Math.random() - 0.5) * 3,
          y + (Math.random() - 0.5) * 3,
          dirX * (45 + Math.random() * 35) + (dirY !== 0 ? spread : 0),
          dirY * (45 + Math.random() * 35) + (dirX !== 0 ? spread : -12),
          0.55 + Math.random() * 0.45,
          cols[Math.floor(Math.random() * cols.length)],
          -28,
          Math.random() < 0.45 ? 2 : 1
        );
      }
    }

    spawnCrystalBurst(x, y, palette = ['#ff1e42', '#ff8fa3', '#ffffff']) {
      for (let i = 0; i < 18; i++) {
        const ang = (i / 18) * Math.PI * 2 + Math.random() * 0.3;
        const spd = 25 + Math.random() * 65;
        this.spawnParticle(
          x, y,
          Math.cos(ang) * spd,
          Math.sin(ang) * spd - 12,
          0.35 + Math.random() * 0.4,
          palette[i % palette.length],
          60,
          i % 4 === 0 ? 2 : 1
        );
      }
      this.shockwaves.push({ x, y, r: 2, maxR: 34, life: 0.42, maxLife: 0.42, color: palette[1] });
    }

    spawnOrbPulse(x, y, big = false, orbColor = '#ff66d9') {
      const count = big ? 36 : 12;
      const cols = ['#ffffff', orbColor, '#c24dff', '#80e5ff'];
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        const spd = big ? (38 + Math.random() * 88) : (18 + Math.random() * 32);
        this.spawnParticle(
          x, y,
          Math.cos(ang) * spd,
          Math.sin(ang) * spd,
          big ? 0.55 + Math.random() * 0.55 : 0.45,
          cols[i % cols.length],
          0,
          big && i % 3 === 0 ? 2 : 1
        );
      }
      this.shockwaves.push({
        x, y, r: 4, maxR: big ? 96 : 38,
        life: big ? 0.85 : 0.55, maxLife: big ? 0.85 : 0.55,
        color: big ? '#ffffff' : orbColor
      });
    }

    update(dt, time, level, audio) {
      const orb = level.orb;
      const vents = level.machinery ? level.machinery.steamVents : [];
      const windForce = level.machinery ? level.machinery.windForce : 0;
      const isAmber = level.biome === 'amber';
      const isAtrium = level.biome === 'atrium';

      for (const m of this.motes) {
        if (isAmber) {
          // Golden fireflies spiraling lazily upward
          m.x += Math.cos(time * 2.2 + m.phase) * 14 * dt;
          m.y += (-7 + Math.sin(time * 1.5 + m.phase) * 3) * dt;
        } else {
          m.x += (m.vx + Math.sin(time * 0.8 + m.phase) * 5.5 + windForce * 0.42) * dt;
          m.y += (m.vy + Math.cos(time * 0.6 + m.phase) * 2.5) * dt;
        }

        if (orb) {
          const dx = orb.x - m.x;
          const dy = orb.y - m.y;
          const dSq = dx * dx + dy * dy;
          if (dSq < 5600 && dSq > 36) {
            const d = Math.sqrt(dSq);
            m.x += (-dy / d) * 18 * dt;
            m.y += (dx / d) * 18 * dt;
          }
        }

        for (const v of vents) {
          if (!v.active) continue;
          const dx = m.x - v.x;
          const dy = m.y - v.y;
          if (dx * dx + dy * dy < 2400) {
            m.x += v.dirX * 52 * dt;
            m.y += (v.dirY * 52 - 18) * dt;
          }
        }

        if (m.x < 0) m.x += this.worldW;
        if (m.x >= this.worldW) m.x -= this.worldW;
        if (m.y < 0) m.y += this.worldH;
        if (m.y >= this.worldH) m.y -= this.worldH;
      }

      // Gale Viaduct diagonal rushing wind streaks during gusts
      if (level.biome === 'viaduct' && Math.abs(windForce) > 15) {
        if (Math.random() < dt * (8 + Math.abs(windForce) * 0.25)) {
          const dir = Math.sign(windForce);
          this.windStreaks.push({
            x: dir > 0 ? Math.random() * (this.worldW - 200) : 200 + Math.random() * (this.worldW - 200),
            y: 60 + Math.random() * (this.worldH - 120),
            vx: windForce * 3.4 + dir * 160,
            vy: 28 + Math.random() * 24,
            len: 10 + Math.random() * 14,
            life: 0.55 + Math.random() * 0.35,
            maxLife: 0.9
          });
        }
      }
      for (let i = this.windStreaks.length - 1; i >= 0; i--) {
        const w = this.windStreaks[i];
        w.life -= dt;
        if (w.life <= 0) { this.windStreaks.splice(i, 1); continue; }
        w.x += w.vx * dt;
        w.y += w.vy * dt;
      }

      // Live sparking broken cables
      if (level.verlet) {
        for (const chain of level.verlet.chains) {
          if (!chain.broken) continue;
          chain.sparkTimer -= dt;
          if (chain.sparkTimer <= 0) {
            chain.sparkTimer = 1.4 + Math.random() * 2.8;
            const end = chain.nodes[chain.nodes.length - 1];
            this.spawnElectricSparks(end.x, end.y, 6);
            end.x += (Math.random() - 0.5) * 3.5;
            end.y -= 1.2;
          }
        }
      }

      // Liquid bubbling (Sector 07 Coolant, Sector 09 Magma, Amber Reef Honey)
      if (level.puddles && level.puddles.length > 0 && level.biome !== 'sector04') {
        if (Math.random() < dt * 11) {
          const pd = level.puddles[Math.floor(Math.random() * level.puddles.length)];
          this.liquidBubbles.push({
            x: pd.x + 6 + Math.random() * Math.max(8, pd.w - 12),
            y: pd.y + pd.h - 2,
            targetY: pd.y + 1,
            vy: isAmber ? -4 - Math.random() * 4 : -9 - Math.random() * 8,
            size: Math.random() < 0.35 ? 2 : 1,
            color: level.biome === 'sector07' ? '#99fff0' : (isAmber ? '#fff2c2' : '#ffd875')
          });
        }
      }
      for (let i = this.liquidBubbles.length - 1; i >= 0; i--) {
        const b = this.liquidBubbles[i];
        b.y += b.vy * dt;
        if (b.y <= b.targetY) {
          this.ripples.push({ x: b.x, y: b.targetY, r: 1, maxR: 5, life: 0.32, maxLife: 0.32 });
          if (level.biome === 'sector09') {
            this.spawnParticle(b.x, b.targetY, (Math.random() - 0.5) * 18, -22 - Math.random() * 18, 0.35, '#ffaa33', 90, 1);
          }
          this.liquidBubbles.splice(i, 1);
        }
      }

      for (const lamp of level.lamps) {
        if (Math.random() < dt * 4.5) this.spawnEmber(lamp.x + 10, lamp.y + 15, level.biome);
      }

      if (level.biome === 'sector09' && Math.random() < dt * 16) {
        this.spawnEmber(60 + Math.random() * (this.worldW - 120), this.worldH - 42, 'sector09');
      }

      // Dripping Icicles (Cryo frozen vapor) & Amber/Water Ceiling Drips
      for (const drip of level.drips) {
        drip.timer -= dt;
        if (drip.timer <= 0) {
          drip.timer = (isAmber ? 2.4 : 1.6) + Math.random() * 2.8;
          drip.active = true;
          drip.cy = drip.y;
          drip.vy = isAmber ? 6 : 15;
        }
        if (drip.active) {
          drip.vy += (isAmber ? 95 : 260) * dt;
          drip.cy += drip.vy * dt;
          if (drip.cy >= drip.targetY) {
            drip.active = false;
            if (level.biome === 'cryo') {
              // Frozen vapor puff cloud on floor impact
              for (let k = 0; k < 4; k++) {
                this.spawnParticle(drip.x, drip.targetY, (Math.random() - 0.5) * 26, -6 - Math.random() * 10, 0.45, k % 2 === 0 ? '#cfe8ff' : '#705cff', -8, 2);
              }
            } else {
              this.spawnWaterSplash(drip.x, drip.targetY, 3);
              if (Math.random() < 0.42 && audio) audio.playWaterDrip();
            }
          }
        }
      }

      const rainbowCols = ['#ffb3d9', '#ffe899', '#a3ffcf', '#99e6ff'];
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Atrium sprinkler drops crossing sunlit beams create pastel rainbow mist sparkles!
        if (isAtrium && p.isSprinklerDrop && Math.random() < dt * 5) {
          for (const beamX of level.sunbeamXs || []) {
            if (Math.abs(p.x - beamX) < 38) {
              this.spawnParticle(p.x, p.y, (Math.random() - 0.5) * 14, -8 - Math.random() * 12, 0.38, rainbowCols[Math.floor(Math.random() * rainbowCols.length)], -12, 1);
              break;
            }
          }
        }
      }

      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const s = this.shockwaves[i];
        s.life -= dt;
        if (s.life <= 0) { this.shockwaves.splice(i, 1); continue; }
        const prog = 1 - s.life / s.maxLife;
        s.r = lerp(3, s.maxR, 1 - Math.pow(1 - prog, 2));
      }

      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.life -= dt;
        if (r.life <= 0) { this.ripples.splice(i, 1); continue; }
        r.r = lerp(1, r.maxR, 1 - r.life / r.maxLife);
      }
    }

    render(ctx, camX, camY, time, level) {
      for (const m of this.motes) {
        const sx = Math.round(m.x - camX);
        const sy = Math.round(m.y - camY);
        if (sx < -2 || sx > PIXEL_W + 2 || sy < -2 || sy > PIXEL_H + 2) continue;
        const pulse = 0.55 + 0.45 * Math.sin(time * 2.5 + m.phase);
        ctx.globalAlpha = m.alpha * pulse;
        ctx.fillStyle = m.color;
        ctx.fillRect(sx, sy, m.size, m.size);
      }
      ctx.globalAlpha = 1;

      // Gale Viaduct rushing wind streaks
      for (const w of this.windStreaks) {
        const sx = Math.round(w.x - camX);
        const sy = Math.round(w.y - camY);
        ctx.globalAlpha = clamp(w.life / w.maxLife, 0, 1) * 0.42;
        ctx.fillStyle = '#dce6f7';
        ctx.fillRect(sx, sy, Math.round(w.len), 1);
      }
      ctx.globalAlpha = 1;

      for (const b of this.liquidBubbles) {
        ctx.fillStyle = b.color;
        ctx.fillRect(Math.round(b.x - camX), Math.round(b.y - camY), b.size, b.size);
      }

      for (const drip of level.drips) {
        if (!drip.active) continue;
        const dx = Math.round(drip.x - camX);
        const dy = Math.round(drip.cy - camY);
        ctx.fillStyle = level.biome === 'cryo' ? '#cfe8ff' : this.palette.waterHighlight;
        ctx.fillRect(dx, dy - 1, 1, level.biome === 'amber' ? 3 : 2);
      }

      for (const rp of this.ripples) {
        const rx = Math.round(rp.x - camX);
        const ry = Math.round(rp.y - camY);
        ctx.globalAlpha = (rp.life / rp.maxLife) * 0.7;
        ctx.fillStyle = this.palette.waterHighlight;
        ctx.fillRect(Math.round(rx - rp.r), ry, 2, 1);
        ctx.fillRect(Math.round(rx + rp.r - 1), ry, 2, 1);
      }
      ctx.globalAlpha = 1;

      for (const p of this.particles) {
        const sx = Math.round(p.x - camX);
        const sy = Math.round(p.y - camY);
        if (sx < -4 || sx > PIXEL_W + 4 || sy < -4 || sy > PIXEL_H + 4) continue;
        ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(sx, sy, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      for (const s of this.shockwaves) {
        const sx = Math.round(s.x - camX);
        const sy = Math.round(s.y - camY);
        ctx.globalAlpha = clamp(s.life / s.maxLife, 0, 1) * 0.85;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.round(s.r), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  GAME.ParticleSystem = ParticleSystem;

  // =========================================================================
  // 3. MOVING MACHINERY & LEVEL MECHANICS SYSTEM (ALL 7 CHAPTERS)
  // =========================================================================
  class MachinerySystem {
    constructor() {
      this.elevators = [];
      this.gondolas = [];
      this.zipGondolas = [];
      this.gantries = [];
      this.turbines = [];
      this.steamVents = [];
      this.pistons = [];
      this.switches = [];
      this.blastDoors = [];
      this.drones = [];

      // New Biome Mechanics
      this.sonarPylons = [];
      this.sonarWaves = [];
      this.spotlights = [];
      this.bouncePods = [];
      this.centrifugeRings = [];
      this.sprinklers = [];
      this.ferns = [];
      this.moths = [];

      // Gale Viaduct Wind & Lightning
      this.windForce = 0;
      this.gustTimer = 0;
      this.lightningFlash = 0;
      this.lightningTimer = 4.5;
      this.windCatchers = [];
    }

    clear() {
      this.elevators = [];
      this.gondolas = [];
      this.zipGondolas = [];
      this.gantries = [];
      this.turbines = [];
      this.steamVents = [];
      this.pistons = [];
      this.switches = [];
      this.blastDoors = [];
      this.drones = [];
      this.sonarPylons = [];
      this.sonarWaves = [];
      this.spotlights = [];
      this.bouncePods = [];
      this.centrifugeRings = [];
      this.sprinklers = [];
      this.ferns = [];
      this.moths = [];
      this.windForce = 0;
      this.gustTimer = 0;
      this.lightningFlash = 0;
      this.lightningTimer = 4.5;
      this.windCatchers = [];
    }

    addElevator(spec) {
      const startY = spec.startAtTop ? spec.topY : spec.bottomY;
      this.elevators.push({
        id: spec.id,
        x: spec.x, y: startY, prevX: spec.x, prevY: startY,
        w: 48, h: 10,
        topY: spec.topY, bottomY: spec.bottomY, anchorY: spec.anchorY,
        cwX: spec.cwX, cwTopY: spec.cwTopY, cwBottomY: spec.cwBottomY,
        mode: spec.mode || 'cycle', requiresCore: !!spec.requiresCore,
        unlocked: !spec.requiresCore,
        travelTime: spec.travelTime || 2.8, pauseTime: spec.pauseTime || 1.2,
        timer: spec.phaseOffset || 0, dir: spec.startAtTop ? 1 : -1,
        state: 'docked', exitCharge: 0, exitTriggered: false, wheelAngle: 0,
        dx: 0, dy: 0
      });
    }

    addGondola(spec) {
      const safeMinX = Math.max(spec.minX, spec.leftWallX + 10);
      const safeMaxX = Math.min(spec.maxX, spec.rightWallX - 54);
      const minX = Math.min(safeMinX, safeMaxX);
      const maxX = Math.max(safeMinX + 8, safeMaxX);
      const startX = clamp(spec.startX !== undefined ? spec.startX : minX, minX, maxX);
      const carY = spec.trackY + 10 + spec.dropLen;
      const deckY = carY + 14;
      this.gondolas.push({
        id: spec.id,
        leftWallX: spec.leftWallX, rightWallX: spec.rightWallX,
        trackY: spec.trackY, minX, maxX, dropLen: spec.dropLen,
        x: startX, y: deckY, prevX: startX, prevY: deckY, w: 44, h: 8,
        travelTime: spec.travelTime || 3.4, pauseTime: spec.pauseTime || 0.9,
        timer: spec.phaseOffset || 0, dir: 1, state: 'docked', dx: 0, dy: 0
      });
    }

    // Steep cable-car zip gondola for Gale Viaduct (supports sagging angled cable)
    addZipGondola(spec) {
      const startDeckY = spec.y0 + 27;
      this.zipGondolas.push({
        id: spec.id,
        x0: spec.x0, y0: spec.y0, x1: spec.x1, y1: spec.y1,
        sag: spec.sag || 18,
        x: spec.x0, y: startDeckY, prevX: spec.x0, prevY: startDeckY, w: 44, h: 8,
        travelTime: spec.travelTime || 3.8, pauseTime: spec.pauseTime || 1.1,
        timer: 0, dir: 1, state: 'docked', tilt: 0, dx: 0, dy: 0
      });
    }

    // 45-degree diagonal glasshouse gantry lift for Shattered Glass Atrium
    addDiagonalGantry(spec) {
      this.gantries.push({
        id: spec.id,
        x0: spec.x0, y0: spec.y0, x1: spec.x1, y1: spec.y1,
        x: spec.x0, y: spec.y0, prevX: spec.x0, prevY: spec.y0, w: 44, h: 8,
        travelTime: spec.travelTime || 3.4, pauseTime: spec.pauseTime || 1.0,
        timer: spec.phaseOffset || 0, dir: 1, state: 'docked', dx: 0, dy: 0
      });
    }

    addTurbine(x, y, anchorTopY, anchorBotY, speed = 5.5, phase = 0) {
      this.turbines.push({ x, y, anchorTopY, anchorBotY, speed, phase, lightPulse: 1.0 });
    }

    addSteamVent(x, y, dirX, dirY, period = 4.2, duration = 1.25, phase = 0) {
      this.steamVents.push({ x, y, dirX, dirY, period, duration, timer: phase, active: false });
    }

    addPiston(x, floorY, stroke = 14, speed = 2.6, phase = 0) {
      this.pistons.push({ x, y: floorY - 40, floorY, stroke, speed, phase, offset: 0, wasBottom: false });
    }

    addSwitchAndDoor(switchX, switchFloorY, doorX, doorTopY, doorId) {
      this.switches.push({ id: `sw_${doorId}`, doorId, x: switchX, y: switchFloorY - 10, pressed: false });
      this.blastDoors.push({ id: doorId, x: doorX, y: doorTopY, openProgress: 0, opening: false });
    }

    addDrone(baseX, baseY, rangeX = 36, rangeY = 6, speed = 1.4, phase = 0) {
      this.drones.push({ baseX, baseY, x: baseX, y: baseY, rangeX, rangeY, speed, phase, facing: 1, frameIdx: 0 });
    }

    addSonarPylon(x, floorY) {
      this.sonarPylons.push({ x, y: floorY - 28, activeTimer: 0, cooldown: 0 });
    }

    addSpotlight(x, anchorY, baseAngle = Math.PI * 0.5, sweepRange = 0.55, speed = 1.0, phase = 0) {
      this.spotlights.push({ x, anchorY, baseAngle, sweepRange, speed, phase, angle: baseAngle });
    }

    addBouncePod(x, floorY) {
      this.bouncePods.push({ x, y: floorY - 18, squishTimer: 0 });
    }

    addCentrifugeRing(x, y, speed = 0.45, phase = 0) {
      this.centrifugeRings.push({ x, y, speed, angle: phase });
    }

    addSprinkler(x, floorY, phase = 0) {
      this.sprinklers.push({ x, y: floorY - 10, phase, timer: 0 });
    }

    addFern(x, y, side = 1) {
      this.ferns.push({
        id: `fern_${x}_${y}`,
        x, y, prevX: x, prevY: y + 4, w: 32, h: 6,
        side, openProgress: 0, triggered: false, dx: 0, dy: 0
      });
    }

    addMoth(baseX, baseY) {
      this.moths.push({ baseX, baseY, x: baseX, y: baseY, phase: Math.random() * 6.28, speed: 1.8 + Math.random() * 1.4 });
    }

    getPlatforms() {
      const list = [];
      for (const e of this.elevators) list.push(e);
      for (const g of this.gondolas) list.push(g);
      for (const z of this.zipGondolas) list.push(z);
      for (const gn of this.gantries) list.push(gn);
      for (const f of this.ferns) {
        if (f.openProgress >= 0.65) {
          // Walkable leaf deck at y + 4
          list.push({
            id: f.id, x: f.x, y: f.y + 4, prevX: f.x, prevY: f.y + 4,
            w: 32, h: 6, dx: 0, dy: 0
          });
        }
      }
      return list;
    }

    update(dt, level, player, particles, audio, camera, onTriggerExit) {
      const coreActive = level.orb ? level.orb.activated : true;
      const time = (level._time = (level._time || 0) + dt);
      const px = player.x + player.w * 0.5;
      const py = player.y + player.h;

      // 1. Gale Viaduct Periodic Wind Gusts & Sheet Lightning
      if (level.biome === 'viaduct') {
        this.gustTimer += dt;
        const cycle = (this.gustTimer % 7.5);
        // Periodic strong tailwind gusts sweeping right across the bridge
        this.windForce = cycle < 3.6 ? Math.sin((cycle / 3.6) * Math.PI) * 72 : 12;

        // Apply horizontal wind impulse to airborne PICO (extra tailwind jump boost!)
        if (!player.grounded) {
          player.vx += this.windForce * 0.88 * dt;
        }

        this.lightningTimer -= dt;
        if (this.lightningTimer <= 0) {
          this.lightningTimer = 4.2 + Math.random() * 5.0;
          this.lightningFlash = 1.0;
          if (audio && audio.playThunder) audio.playThunder();
        }
        if (this.lightningFlash > 0) this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.2);
      } else {
        this.windForce = 0;
        this.lightningFlash = 0;
      }

      // 2. Counterweighted Elevators
      for (const e of this.elevators) {
        e.prevX = e.x;
        e.prevY = e.y;
        e.unlocked = !e.requiresCore || coreActive;

        if (e.mode === 'exit') {
          if (!e.unlocked) {
            e.state = 'locked';
          } else if (e.state === 'ascending_exit') {
            e.y = Math.max(e.topY, e.y - 64 * dt);
            e.wheelAngle -= dt * 7;
            e.exitCharge += dt;
            if (Math.random() < dt * 8) {
              particles.spawnParticle(e.x + (Math.random() < 0.5 ? 4 : 43), e.y - 6, (Math.random() - 0.5) * 20, -15, 0.2, '#ffaa33', 60, 1);
            }
            if (e.exitCharge >= 0.95 && !e.exitTriggered) {
              e.exitTriggered = true;
              if (onTriggerExit) onTriggerExit();
            }
          } else {
            e.state = 'docked';
            const onDeck = player.grounded && player.ridingPlatformId === e.id && Math.abs(py - e.y) <= 2;
            if (onDeck) {
              e.timer += dt;
              if (e.timer >= 0.28) {
                e.state = 'ascending_exit';
                e.exitCharge = 0;
                camera.shake(1.4);
                particles.spawnMachineryClunk(e.x + 24, e.y + 4);
                if (audio && audio.playMachineryStart) audio.playMachineryStart();
              }
            } else {
              e.timer = 0;
            }
          }
        } else {
          e.timer += dt;
          if (e.state === 'docked') {
            if (e.timer >= e.pauseTime) {
              e.timer = 0; e.state = 'moving';
              if (audio && audio.playMachineryStart) audio.playMachineryStart();
            }
          } else if (e.state === 'moving') {
            const u = clamp(e.timer / e.travelTime, 0, 1);
            const smooth = 0.5 - 0.5 * Math.cos(u * Math.PI);
            const fromY = e.dir < 0 ? e.bottomY : e.topY;
            const toY = e.dir < 0 ? e.topY : e.bottomY;
            e.y = lerp(fromY, toY, smooth);
            e.wheelAngle += e.dir * dt * 6.5;
            if (u >= 1) {
              e.y = toY; e.dir = -e.dir; e.timer = 0; e.state = 'docked';
              particles.spawnMachineryClunk(e.x + 24, e.y + 4);
              camera.shake(0.9);
              if (audio && audio.playMachineryDock) audio.playMachineryDock();
            }
          }
        }
        e.dx = e.x - e.prevX;
        e.dy = e.y - e.prevY;
      }

      // 3. Horizontal Gondolas
      for (const g of this.gondolas) {
        g.prevX = g.x;
        g.prevY = g.y;
        g.timer += dt;
        if (g.state === 'docked') {
          if (g.timer >= g.pauseTime) {
            g.timer = 0; g.state = 'moving';
            if (audio && audio.playMachineryStart) audio.playMachineryStart();
          }
        } else {
          const u = clamp(g.timer / g.travelTime, 0, 1);
          const smooth = 0.5 - 0.5 * Math.cos(u * Math.PI);
          const fromX = g.dir > 0 ? g.minX : g.maxX;
          const toX = g.dir > 0 ? g.maxX : g.minX;
          g.x = lerp(fromX, toX, smooth);
          if (u >= 1) {
            g.x = toX; g.dir = -g.dir; g.timer = 0; g.state = 'docked';
            particles.spawnMachineryClunk(g.x + 22, g.y + 4);
            if (audio && audio.playMachineryDock) audio.playMachineryDock();
          }
        }
        g.dx = g.x - g.prevX;
        g.dy = g.y - g.prevY;
      }

      // 4. Steep Cable-Car Zip Gondolas (Viaduct)
      for (const z of this.zipGondolas) {
        z.prevX = z.x;
        z.prevY = z.y;
        z.timer += dt;
        if (z.state === 'docked') {
          z.tilt = lerp(z.tilt, 0, 1 - Math.exp(-8 * dt));
          if (z.timer >= z.pauseTime) {
            z.timer = 0; z.state = 'moving';
            if (audio && audio.playMachineryStart) audio.playMachineryStart();
          }
        } else {
          const u = clamp(z.timer / z.travelTime, 0, 1);
          const smooth = 0.5 - 0.5 * Math.cos(u * Math.PI);
          const progress = z.dir > 0 ? smooth : 1 - smooth;
          const cableX = lerp(z.x0, z.x1, progress);
          const cableY = lerp(z.y0, z.y1, progress) + Math.sin(progress * Math.PI) * z.sag;
          z.x = cableX;
          z.y = cableY + 27;
          z.tilt = Math.sin(u * Math.PI) * z.dir * 0.08 + this.windForce * 0.0007;
          if (u >= 1) {
            z.dir = -z.dir; z.timer = 0; z.state = 'docked';
            z.tilt = -z.dir * 0.14; // braking sway at pier!
            particles.spawnMachineryClunk(z.x + 22, z.y + 4);
            if (audio && audio.playMachineryDock) audio.playMachineryDock();
          }
        }
        z.dx = z.x - z.prevX;
        z.dy = z.y - z.prevY;
      }

      // 5. Diagonal 45-Degree Gantry Lifts (Glass Atrium)
      for (const gn of this.gantries) {
        gn.prevX = gn.x;
        gn.prevY = gn.y;
        gn.timer += dt;
        if (gn.state === 'docked') {
          if (gn.timer >= gn.pauseTime) {
            gn.timer = 0; gn.state = 'moving';
            if (audio && audio.playMachineryStart) audio.playMachineryStart();
          }
        } else {
          const u = clamp(gn.timer / gn.travelTime, 0, 1);
          const smooth = 0.5 - 0.5 * Math.cos(u * Math.PI);
          const p = gn.dir > 0 ? smooth : 1 - smooth;
          gn.x = lerp(gn.x0, gn.x1, p);
          gn.y = lerp(gn.y0, gn.y1, p);
          if (u >= 1) {
            gn.dir = -gn.dir; gn.timer = 0; gn.state = 'docked';
            particles.spawnMachineryClunk(gn.x + 22, gn.y + 4);
            if (audio && audio.playMachineryDock) audio.playMachineryDock();
          }
        }
        gn.dx = gn.x - gn.prevX;
        gn.dy = gn.y - gn.prevY;
      }

      // 6. Cryo Sonar Pylons & Expanding Sonar Waves + Sweeping Spotlights
      for (const pyObj of this.sonarPylons) {
        if (pyObj.cooldown > 0) pyObj.cooldown -= dt;
        if (pyObj.activeTimer > 0) pyObj.activeTimer -= dt;
        if (pyObj.cooldown <= 0 && Math.hypot(px - (pyObj.x + 8), py - 9 - (pyObj.y + 14)) < 26) {
          pyObj.cooldown = 3.2;
          pyObj.activeTimer = 2.6;
          this.sonarWaves.push({ x: pyObj.x + 8, y: pyObj.y + 5, r: 2, maxR: 380, life: 2.6, maxLife: 2.6 });
          if (audio && audio.playSonarPing) audio.playSonarPing();
        }
      }
      for (let i = this.sonarWaves.length - 1; i >= 0; i--) {
        const sw = this.sonarWaves[i];
        sw.life -= dt;
        if (sw.life <= 0) { this.sonarWaves.splice(i, 1); continue; }
        sw.r = lerp(2, sw.maxR, 1 - sw.life / sw.maxLife);
      }
      for (const sp of this.spotlights) {
        sp.angle = sp.baseAngle + Math.sin(time * sp.speed + sp.phase) * sp.sweepRange;
      }

      // 7. Amber Reef Bouncing Spore-Bladder Pods & Brass Centrifuge Rings
      for (const pod of this.bouncePods) {
        if (pod.squishTimer > 0) pod.squishTimer -= dt;
        if (player.vy >= -70 && Math.abs(px - (pod.x + 12)) < 16 && Math.abs(py - (pod.y + 6)) < 12) {
          player.vy = -4045;
          player.grounded = false;
          player.ridingPlatformId = null;
          player.coyoteTimer = 0;
          player.squashX = 0.72;
          player.squashY = 1.32;
          pod.squishTimer = 0.45;
          particles.spawnCrystalBurst(pod.x + 12, pod.y + 6, ['#ff7369', '#ffd27d', '#fff2c2']);
          camera.shake(1.8);
          if (audio && audio.playPodBounce) audio.playPodBounce();
        }
      }
      for (const cr of this.centrifugeRings) {
        cr.angle += cr.speed * dt;
      }

      // 8. Glass Atrium Rotating Sprinklers, Unfurling Ferns & Fluttering Moths
      for (const sp of this.sprinklers) {
        sp.timer += dt;
        if (sp.timer >= 0.045) {
          sp.timer = 0;
          const sweepAng = -Math.PI * 0.5 + Math.sin(time * 2.1 + sp.phase) * 0.85;
          const spd = 95 + Math.random() * 25;
          particles.spawnParticle(
            sp.x + 6, sp.y + 2,
            Math.cos(sweepAng) * spd, Math.sin(sweepAng) * spd,
            0.85, '#b8f2ff', 175, 1, true
          );
        }
      }
      for (const f of this.ferns) {
        if (!f.triggered && Math.hypot(px - (f.x + 16), py - 9 - (f.y + 6)) < 44) {
          f.triggered = true;
          if (audio && audio.playFernUnfurl) audio.playFernUnfurl();
        }
        if (f.triggered && f.openProgress < 1) {
          f.openProgress = Math.min(1, f.openProgress + dt * 1.9);
        }
      }
      for (const m of this.moths) {
        m.phase += m.speed * dt;
        m.x = m.baseX + Math.sin(m.phase) * 16 + Math.cos(m.phase * 1.7) * 6;
        m.y = m.baseY + Math.cos(m.phase * 1.3) * 10;
      }

      // 9. Turbines, Steam Vents, Pistons, Switches, Doors, Drones & Swinging Lamps
      for (const tb of this.turbines) {
        tb.phase += tb.speed * dt;
        tb.lightPulse = 0.58 + 0.42 * Math.sin(tb.phase * 6);
      }
      for (const sv of this.steamVents) {
        const wasActive = sv.active;
        sv.timer = (sv.timer + dt) % sv.period;
        sv.active = sv.timer < sv.duration;
        if (sv.active) {
          if (!wasActive && audio && audio.playSteamHiss) audio.playSteamHiss();
          if (Math.random() < dt * 28) particles.spawnSteamPlume(sv.x, sv.y, sv.dirX, sv.dirY);
        }
      }
      for (const p of this.pistons) {
        p.phase += p.speed * dt;
        const cycle = 0.5 - 0.5 * Math.cos(p.phase);
        p.offset = Math.round(cycle * p.stroke);
        const atBottom = cycle > 0.94;
        if (atBottom && !p.wasBottom) particles.spawnSteamPlume(p.x + 11, p.floorY - 2, (Math.random() - 0.5) * 0.6, -0.6);
        p.wasBottom = atBottom;
      }
      for (const sw of this.switches) {
        if (!sw.pressed && Math.abs(px - (sw.x + 8)) < 11 && Math.abs(py - (sw.y + 10)) < 6) {
          sw.pressed = true;
          const door = this.blastDoors.find(d => d.id === sw.doorId);
          if (door) door.opening = true;
          particles.spawnMachineryClunk(sw.x + 8, sw.y + 8);
          camera.shake(1.2);
          if (audio && audio.playMachineryDock) audio.playMachineryDock();
        }
      }
      for (const d of this.blastDoors) {
        if (d.opening && d.openProgress < 1) {
          d.openProgress = Math.min(1, d.openProgress + dt * 1.15);
          if (Math.random() < dt * 14) particles.spawnDustPuff(d.x + 8, d.y + 46 - d.openProgress * 42, 1);
        }
      }
      for (const dr of this.drones) {
        const oldX = dr.x;
        dr.phase += dr.speed * dt;
        dr.x = dr.baseX + Math.sin(dr.phase) * dr.rangeX;
        dr.y = dr.baseY + Math.sin(dr.phase * 2.1) * dr.rangeY;
        if (Math.abs(dr.x - oldX) > 0.02) dr.facing = dr.x >= oldX ? 1 : -1;
        dr.frameIdx = Math.floor(time * 9 + dr.phase) % 4;
        if (Math.random() < dt * 12) particles.spawnParticle(dr.x + 8, dr.y + 12, (Math.random() - 0.5) * 8, 22, 0.22, '#8ce8ff', 10, 1);
      }
      for (const lamp of level.lamps) {
        if (lamp.anchorType !== 'ceiling') continue;
        const windTarget = (Math.sin(time * 1.8 + lamp.seed) * 0.9 + this.windForce * 0.04) * 0.055;
        let impulse = 0;
        if (Math.hypot(px - (lamp.x + 10), player.y + 9 - (lamp.y + 14)) < 18) {
          impulse = clamp(player.vx * 0.014, -1.8, 1.8);
        }
        lamp.angVel = (lamp.angVel + (windTarget - lamp.angle) * 26 * dt + impulse * dt * 18) * 0.96;
        lamp.angle = clamp(lamp.angle + lamp.angVel * dt, -0.25, 0.25);
        lamp.x = lamp.anchorX - 10 + Math.sin(lamp.angle) * lamp.cordLen;
        lamp.y = lamp.anchorY + Math.cos(lamp.angle) * lamp.cordLen;
      }
    }

    carryPlayer(player, level) {
      if (!player.grounded || !player.ridingPlatformId) return;
      const plat = this.getPlatforms().find(p => p.id === player.ridingPlatformId);
      if (!plat) { player.ridingPlatformId = null; return; }
      if (plat.dx !== 0) {
        player.x += plat.dx;
        player.resolveHorizontal(level);
      }
      if (plat.dy !== 0) {
        player.y += plat.dy;
      }
    }

    renderBackground(ctx, camX, camY, assets, time = 0) {
      // Gale Viaduct colossal spinning background wind-catchers
      for (const wc of this.windCatchers) {
        const wx = Math.round(wc.x - camX * 0.55);
        const wy = Math.round(wc.y - camY * 0.55);
        ctx.drawImage(assets.windTurbineTower, wx - 18, wy);
        const fIdx = Math.floor(time * 2.2 + wc.phase) % assets.windSailFrames.length;
        ctx.drawImage(assets.windSailFrames[fIdx], wx - 36, wy - 18);
      }

      // Amber Reef giant embedded rotating tarnished-brass centrifuge rings
      for (const cr of this.centrifugeRings) {
        const cx = Math.round(cr.x - camX);
        const cy = Math.round(cr.y - camY);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(cr.angle);
        ctx.drawImage(assets.centrifugeRing, -28, -28);
        ctx.restore();
      }

      // Recessed exhaust turbines inside vertical steel duct columns
      for (const tb of this.turbines) {
        const tx = Math.round(tb.x - camX);
        const ty = Math.round(tb.y - camY);
        if (tx < -44 || tx > PIXEL_W + 44 || ty < -44 || ty > PIXEL_H + 44) continue;
        const topY = Math.round(tb.anchorTopY - camY);
        const botY = Math.round(tb.anchorBotY - camY);
        ctx.fillStyle = '#070b12';
        ctx.fillRect(tx + 8, topY, 20, Math.max(0, botY - topY));
        ctx.fillStyle = '#182230';
        ctx.fillRect(tx + 10, topY, 16, Math.max(0, botY - topY));
        if (assets.anchorPlate) {
          ctx.drawImage(assets.anchorPlate, tx + 13, topY - 1);
          ctx.drawImage(assets.anchorPlate, tx + 13, botY - 4);
        }
        const fIdx = Math.floor((tb.phase / (Math.PI * 2)) * 24) % assets.turbineFrames.length;
        ctx.drawImage(assets.turbineFrames[(fIdx + 4) % 4], tx, ty);
      }
    }

    renderForeground(ctx, camX, camY, assets, time, alpha = 1) {
      // Unfurling Giant Ferns (Atrium)
      for (const f of this.ferns) {
        const fx = Math.round(f.x - camX);
        const fy = Math.round(f.y - camY);
        const stage = Math.min(3, Math.floor(f.openProgress * 3.99));
        ctx.save();
        ctx.translate(fx + (f.side < 0 ? 32 : 0), fy);
        ctx.scale(f.side, 1);
        ctx.drawImage(assets.fernFrames[stage], 0, 0);
        ctx.restore();
      }

      // Sprinklers & Moths (Atrium)
      for (const sp of this.sprinklers) {
        ctx.drawImage(assets.sprinklerSprite, Math.round(sp.x - camX), Math.round(sp.y - camY));
      }
      for (const m of this.moths) {
        const mf = Math.floor(time * 12 + m.phase) % 2;
        ctx.drawImage(assets.mothFrames[mf], Math.round(m.x - camX), Math.round(m.y - camY));
      }

      // Sonar Pylons & Spotlights (Cryo-Archive)
      for (const pyObj of this.sonarPylons) {
        const frame = pyObj.activeTimer > 0 ? assets.sonarPylonFrames[1] : assets.sonarPylonFrames[0];
        ctx.drawImage(frame, Math.round(pyObj.x - camX), Math.round(pyObj.y - camY));
      }
      for (const sp of this.spotlights) {
        const sx = Math.round(sp.x - camX);
        const sy = Math.round(sp.anchorY - camY);
        ctx.drawImage(assets.anchorPlate, sx - 5, sy - 1);
        ctx.save();
        ctx.translate(sx, sy + 2);
        ctx.rotate(sp.angle - Math.PI * 0.5);
        ctx.drawImage(assets.spotlightHousing, -8, -2);
        ctx.restore();
      }

      // Bouncing Spore-Bladder Pods (Amber Reef)
      for (const pod of this.bouncePods) {
        const idx = pod.squishTimer > 0.25 ? 1 : (pod.squishTimer > 0 ? 2 : 0);
        ctx.drawImage(assets.sporePodFrames[idx], Math.round(pod.x - camX), Math.round(pod.y - camY));
      }

      // Switches & Blast Doors
      for (const sw of this.switches) {
        ctx.drawImage(assets.switchFrames[sw.pressed ? 1 : 0], Math.round(sw.x - camX), Math.round(sw.y - camY));
      }
      for (const d of this.blastDoors) {
        const dx = Math.round(d.x - camX);
        const dy = Math.round(d.y - camY);
        const liftY = Math.round(d.openProgress * 42);
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx - 1, dy, 18, 48);
        ctx.clip();
        ctx.drawImage(assets.blastDoor, dx, dy - liftY);
        const led = assets.blastDoor.ledRect;
        ctx.fillStyle = d.opening ? '#6ee89a' : '#ff3b4d';
        ctx.fillRect(dx + led.x, dy - liftY + led.y, led.w, led.h);
        ctx.restore();
      }

      // Hydraulic Pistons
      for (const p of this.pistons) {
        const px = Math.round(p.x - camX);
        const py = Math.round(p.y - camY);
        if (px < -28 || px > PIXEL_W + 28) continue;
        ctx.drawImage(assets.pistonHead, px, py - 14 + p.offset);
        ctx.drawImage(assets.pistonBase, px, py);
        const sr = assets.pistonBase.sightRect;
        const levelH = 3 + Math.round((p.offset / Math.max(1, p.stroke)) * (sr.h - 4));
        ctx.fillStyle = '#33e6c8';
        ctx.fillRect(px + sr.x + 1, py + sr.y + sr.h - levelH, 1, levelH);
      }

      // Counterweighted Elevators
      for (const e of this.elevators) {
        const rx = Math.round(lerp(e.prevX, e.x, alpha) - camX);
        const ry = Math.round(lerp(e.prevY, e.y, alpha) - camY);
        const ay = Math.round(e.anchorY - camY);
        const pulleyCx = rx + 24;
        const pulleyCy = ay + 9;
        const cwScreenX = Math.round(e.cwX - camX);
        const span = Math.max(1, e.bottomY - e.topY);
        const t = clamp((lerp(e.prevY, e.y, alpha) - e.topY) / span, 0, 1);
        const cwScreenY = Math.round(lerp(e.cwBottomY, e.cwTopY, t) - camY);

        ctx.fillStyle = '#0c121c';
        ctx.fillRect(cwScreenX + 5, ay, 4, Math.round(e.bottomY - e.anchorY + 14));
        ctx.fillStyle = '#253347';
        ctx.fillRect(cwScreenX + 6, ay, 2, Math.round(e.bottomY - e.anchorY + 14));

        ctx.fillStyle = '#5a7394';
        ctx.fillRect(pulleyCx, pulleyCy + 5, 1, Math.max(0, ry - 14 - (pulleyCy + 5)));
        ctx.fillStyle = '#3b4e69';
        ctx.fillRect(cwScreenX + 6, ay + 4, 1, Math.max(0, cwScreenY - (ay + 4)));
        const minC = Math.min(pulleyCx, cwScreenX + 6);
        const maxC = Math.max(pulleyCx, cwScreenX + 6);
        ctx.fillStyle = '#485f7d';
        ctx.fillRect(minC, ay + 3, maxC - minC + 1, 1);

        ctx.drawImage(assets.anchorPlate, cwScreenX + 2, ay - 1);
        const fIdx = Math.abs(Math.floor((e.wheelAngle / (Math.PI * 2)) * 16)) % 4;
        ctx.drawImage(assets.pulleyWheelFrames[fIdx], pulleyCx - 9, ay);
        ctx.drawImage(assets.counterweight, cwScreenX, cwScreenY);
        ctx.drawImage(assets.elevatorCage, rx, ry - 14);

        let beaconCol = '#38e89e';
        if (e.state === 'locked') beaconCol = Math.sin(time * 5.2) > 0 ? '#ff66d9' : '#7b2cbf';
        else if (e.state === 'moving' || e.state === 'ascending_exit') beaconCol = Math.sin(time * 12) > 0 ? '#ffaa33' : '#ff5500';
        for (const bc of assets.elevatorCage.beaconCoords) {
          ctx.fillStyle = '#090d14';
          ctx.fillRect(rx + bc.x - 1, ry - 14 + bc.y - 1, 4, 5);
          ctx.fillStyle = beaconCol;
          ctx.fillRect(rx + bc.x, ry - 14 + bc.y, 2, 3);
        }
      }

      // Horizontal Gondolas
      for (const g of this.gondolas) {
        const lx = Math.round(g.leftWallX - camX);
        const rxWall = Math.round(g.rightWallX - camX);
        const ty = Math.round(g.trackY - camY);
        const gx = Math.round(lerp(g.prevX, g.x, alpha) - camX);
        const gy = Math.round(lerp(g.prevY, g.y, alpha) - camY);
        const railW = Math.max(0, rxWall - lx);
        ctx.fillStyle = '#090d14';
        ctx.fillRect(lx, ty - 1, railW, 6);
        ctx.fillStyle = '#2c3d52';
        ctx.fillRect(lx, ty, railW, 4);
        ctx.fillStyle = '#607a9c';
        ctx.fillRect(lx, ty, railW, 1);
        ctx.drawImage(assets.wallBracketLeft, lx - 2, ty - 2);
        ctx.drawImage(assets.wallBracketRight, rxWall - 12, ty - 2);
        ctx.drawImage(assets.gondolaTrolley, gx + 12, ty - 3);
        const rodX = gx + 22;
        const carTopY = gy - 14;
        ctx.fillStyle = '#0c111a';
        ctx.fillRect(rodX - 1, ty + 7, 3, Math.max(0, carTopY - (ty + 7) + 2));
        ctx.fillStyle = '#5c7594';
        ctx.fillRect(rodX, ty + 7, 1, Math.max(0, carTopY - (ty + 7) + 2));
        ctx.drawImage(assets.gondolaCar, gx, carTopY);
      }

      // Steep Cable-Car Zip Gondolas (Gale Viaduct)
      for (const z of this.zipGondolas) {
        const steps = 28;
        ctx.fillStyle = '#182033';
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const sx = Math.round(lerp(z.x0 + 22, z.x1 + 22, t) - camX);
          const sy = Math.round(lerp(z.y0, z.y1, t) + Math.sin(t * Math.PI) * z.sag - camY);
          ctx.fillRect(sx, sy, 2, 2);
        }
        ctx.drawImage(assets.anchorPlate, Math.round(z.x0 + 17 - camX), Math.round(z.y0 - 2 - camY));
        ctx.drawImage(assets.anchorPlate, Math.round(z.x1 + 17 - camX), Math.round(z.y1 - 2 - camY));

        const zx = Math.round(lerp(z.prevX, z.x, alpha) - camX);
        const zy = Math.round(lerp(z.prevY, z.y, alpha) - camY);
        ctx.drawImage(assets.gondolaTrolley, zx + 12, zy - 30);
        ctx.save();
        ctx.translate(zx + 22, zy - 21);
        ctx.rotate(z.tilt);
        ctx.drawImage(assets.cableCarSprite, -22, 0);
        ctx.restore();
      }

      // Diagonal 45-Degree Gantry Lifts (Shattered Glass Atrium)
      for (const gn of this.gantries) {
        // Draw continuous 45-deg sloped steel I-beam rail
        const x0 = Math.round(gn.x0 + 22 - camX), y0 = Math.round(gn.y0 + 10 - camY);
        const x1 = Math.round(gn.x1 + 22 - camX), y1 = Math.round(gn.y1 + 10 - camY);
        const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const rx = Math.round(lerp(x0, x1, t));
          const ry = Math.round(lerp(y0, y1, t));
          ctx.fillStyle = '#362c18';
          ctx.fillRect(rx - 1, ry - 1, 3, 3);
          ctx.fillStyle = '#c9ad67';
          ctx.fillRect(rx, ry, 1, 1);
        }
        const gx = Math.round(lerp(gn.prevX, gn.x, alpha) - camX);
        const gy = Math.round(lerp(gn.prevY, gn.y, alpha) - camY);
        ctx.drawImage(assets.gantryLiftSprite, gx, gy - 6);
      }

      // Steam Vents & Hovering Drones
      for (const sv of this.steamVents) {
        const sx = Math.round(sv.x - camX - 7);
        const sy = Math.round(sv.y - camY - 7);
        ctx.drawImage(assets.steamValve, sx, sy);
        if (sv.active) {
          ctx.fillStyle = '#ffaa33';
          ctx.fillRect(sx + 6, sy + 6, 2, 2);
        }
      }
      for (const dr of this.drones) {
        const dx = Math.round(dr.x - camX);
        const dy = Math.round(dr.y - camY);
        if (dx < -20 || dx > PIXEL_W + 20) continue;
        ctx.save();
        ctx.translate(dx + 8, dy);
        ctx.scale(dr.facing, 1);
        ctx.drawImage(assets.droneFrames[dr.frameIdx], -8, 0);
        ctx.restore();
      }
    }
  }
  GAME.MachinerySystem = MachinerySystem;

  // =========================================================================
  // 4. LEVEL BUILDER (7 INTERCONNECTED CHAPTERS — ZERO FLOATING PROPS)
  // =========================================================================
  class LevelBuilder {
    constructor(assets, verlet, machinery) {
      this.assets = assets;
      this.verlet = verlet;
      this.machinery = machinery;

      this.sectorIndex = 0;
      this.biome = 'sector04';
      this.palette = BIOME_PALETTES.sector04;

      this.cols = 76;
      this.rows = 42;
      this.worldW = this.cols * TILE_SIZE;
      this.worldH = this.rows * TILE_SIZE;

      this.grid = [];
      this.masks = [];
      this.variants = [];

      this.lamps = [];
      this.crystals = [];
      this.bioVats = [];
      this.icicles = [];
      this.shards = [];
      this.crates = [];
      this.signs = [];
      this.pipes = [];
      this.drips = [];
      this.puddles = [];
      this.hazards = [];
      this.terminals = [];
      this.conduitLights = [];
      this.sunbeamXs = [];
      this.orb = null;
      this.exitGate = null;
      this.spawn = { x: 6 * TILE_SIZE, y: 36 * TILE_SIZE };
    }

    isGridSolid(c, r) {
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return true;
      return this.grid[r][c] === '#';
    }

    isSolidAtTile(c, r) {
      if (this.isGridSolid(c, r)) return true;
      if (this.machinery && this.machinery.blastDoors.length > 0) {
        const wx = c * TILE_SIZE + 8;
        const wy = r * TILE_SIZE + 8;
        for (const d of this.machinery.blastDoors) {
          if (d.openProgress < 0.72 && wx >= d.x && wx < d.x + 16 && wy >= d.y && wy < d.y + 48) {
            return true;
          }
        }
      }
      return false;
    }

    isTrussAtTile(c, r) {
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
      return this.grid[r][c] === 'T';
    }

    findAnchorUp(wx, wy, includeTruss = false) {
      const c = clamp(Math.floor(wx / TILE_SIZE), 0, this.cols - 1);
      let r = clamp(Math.floor(wy / TILE_SIZE), 0, this.rows - 1);
      while (r > 0) {
        if (this.isGridSolid(c, r) || (includeTruss && this.isTrussAtTile(c, r))) return (r + 1) * TILE_SIZE;
        r--;
      }
      return TILE_SIZE;
    }

    findAnchorDown(wx, wy) {
      const c = clamp(Math.floor(wx / TILE_SIZE), 0, this.cols - 1);
      let r = clamp(Math.floor(wy / TILE_SIZE), 0, this.rows - 1);
      while (r < this.rows - 1) {
        if (this.isGridSolid(c, r)) return r * TILE_SIZE;
        r++;
      }
      return (this.rows - 1) * TILE_SIZE;
    }

    findAnchorSide(wx, wy, dir) {
      const r = clamp(Math.floor(wy / TILE_SIZE), 0, this.rows - 1);
      let c = clamp(Math.floor(wx / TILE_SIZE), 0, this.cols - 1);
      while (c > 0 && c < this.cols - 1) {
        if (this.isGridSolid(c, r)) return dir < 0 ? (c + 1) * TILE_SIZE : c * TILE_SIZE;
        c += dir;
      }
      return dir < 0 ? TILE_SIZE : (this.cols - 1) * TILE_SIZE;
    }

    hasSolidFloorSpan(wx, floorY, width) {
      const r = Math.floor(floorY / TILE_SIZE);
      const c0 = Math.floor(wx / TILE_SIZE);
      const c1 = Math.floor((wx + width - 1) / TILE_SIZE);
      for (let c = c0; c <= c1; c++) {
        if (!this.isGridSolid(c, r) || this.isGridSolid(c, r - 1)) return false;
      }
      return true;
    }

    placeSign(key, approxX, approxY, flickerSeed) {
      const sprite = this.assets.signs[key];
      if (!sprite) return;
      const mount = sprite.mountType;
      if (mount === 'floor') {
        const legL = sprite.legOffsets[0], legR = sprite.legOffsets[1];
        const x = Math.round(approxX);
        const floorY = this.findAnchorDown(x + (legL + legR) * 0.5, approxY);
        for (let shift = 0; shift <= 24; shift += 2) {
          for (const dir of [1, -1]) {
            const testX = x + shift * dir;
            const cL = Math.floor((testX + legL) / TILE_SIZE);
            const cR = Math.floor((testX + legR) / TILE_SIZE);
            const rF = Math.floor(floorY / TILE_SIZE);
            if (this.isGridSolid(cL, rF) && this.isGridSolid(cR, rF) && !this.isGridSolid(cL, rF - 1) && !this.isGridSolid(cR, rF - 1)) {
              this.signs.push({ type: key, x: testX, y: floorY - sprite.height, sprite, flickerSeed, rods: null });
              return;
            }
          }
        }
      } else if (mount === 'ceiling') {
        const x = Math.round(approxX), y = Math.round(approxY);
        const rods = sprite.legOffsets.map((offX) => {
          const rx = x + offX;
          return { x: rx, topY: this.findAnchorUp(rx, y), botY: y + 2 };
        });
        this.signs.push({ type: key, x, y, sprite, flickerSeed, rods });
      } else if (mount === 'wall') {
        const dir = sprite.wallSide === 'left' ? -1 : 1;
        const wallX = this.findAnchorSide(approxX, approxY + 18, dir);
        const x = sprite.wallSide === 'left' ? wallX : wallX - sprite.width;
        this.signs.push({ type: key, x, y: Math.round(approxY), sprite, flickerSeed, rods: null });
      }
    }

    placeLamp(cx, approxY, dropLen, sprite) {
      const ceilingY = this.findAnchorUp(cx, approxY);
      const targetY = ceilingY + dropLen;
      const wallLeftX = this.findAnchorSide(cx, targetY + 6, -1);
      const wallRightX = this.findAnchorSide(cx, targetY + 6, 1);

      if (dropLen > 92 && (cx - wallLeftX <= 22 || wallRightX - cx <= 22)) {
        if (cx - wallLeftX <= wallRightX - cx) {
          this.lamps.push({ x: wallLeftX, y: targetY, anchorType: 'wallLeft', anchorX: wallLeftX, anchorY: targetY - 2, cordLen: 0, angle: 0, angVel: 0, sprite, seed: cx * 0.13 + targetY });
        } else {
          this.lamps.push({ x: wallRightX - 20, y: targetY, anchorType: 'wallRight', anchorX: wallRightX, anchorY: targetY - 2, cordLen: 0, angle: 0, angVel: 0, sprite, seed: cx * 0.13 + targetY });
        }
      } else {
        this.lamps.push({ x: Math.round(cx - 10), y: targetY, anchorType: 'ceiling', anchorX: Math.round(cx), anchorY: ceilingY, cordLen: dropLen, angle: 0, angVel: 0, sprite, seed: cx * 0.13 + ceilingY });
      }
    }

    placeFloorProp(list, approxX, approxY, sprite) {
      const w = sprite.width, h = sprite.height;
      const floorY = this.findAnchorDown(approxX + w * 0.5, approxY);
      const x = Math.round(approxX);
      for (let shift = 0; shift <= 24; shift += 2) {
        for (const dir of [1, -1]) {
          const testX = x + shift * dir;
          if (this.hasSolidFloorSpan(testX + 2, floorY, Math.max(4, w - 4))) {
            list.push({ x: testX, y: floorY - h, sprite });
            return;
          }
        }
      }
      list.push({ x, y: floorY - h, sprite });
    }

    placeBioVat(approxX, approxY, isMagma = false) {
      const frames = isMagma ? this.assets.magmaVatFrames : this.assets.bioVatFrames;
      const floorY = this.findAnchorDown(approxX + 10, approxY);
      for (let shift = 0; shift <= 24; shift += 2) {
        for (const dir of [1, -1]) {
          const testX = Math.round(approxX + shift * dir);
          if (this.hasSolidFloorSpan(testX + 2, floorY, 16)) {
            this.bioVats.push({ x: testX, y: floorY - 34, frames, phase: Math.random() * 4 });
            return;
          }
        }
      }
    }

    placeIcicle(approxX, approxY, variant = 0) {
      const topY = this.findAnchorUp(approxX, approxY);
      const sprite = this.assets.icicleSprites[variant % 2];
      this.icicles.push({ x: Math.round(approxX - 4), y: topY - 1, sprite });
      const targetY = this.findAnchorDown(approxX, topY + 12);
      this.drips.push({ x: Math.round(approxX), y: topY + sprite.height, cy: topY + sprite.height, vy: 0, targetY, timer: Math.random() * 2.5, active: false });
    }

    placeAnchoredPipe(approxX, approxY) {
      const x = Math.round(approxX);
      const anchorTopY = this.findAnchorUp(x + 16, approxY);
      const anchorBotY = this.findAnchorDown(x + 16, approxY);
      const y = clamp(Math.round(approxY), anchorTopY, Math.max(anchorTopY, anchorBotY - 48));
      this.pipes.push({ x, y, anchorTopY, anchorBotY, frames: this.assets.pipeFixtures });
    }

    placeAnchoredTurbine(approxX, approxY, speed = 5.5, phase = 0) {
      const x = Math.round(approxX), y = Math.round(approxY);
      this.machinery.addTurbine(x, y, this.findAnchorUp(x + 18, y + 18), this.findAnchorDown(x + 18, y + 18), speed, phase);
    }

    placeAnchoredVent(approxX, approxY, dirX, dirY, period, duration, phase) {
      if (dirY < 0) {
        const floorY = this.findAnchorDown(approxX, approxY);
        this.machinery.addSteamVent(Math.round(approxX), floorY - 5, dirX, dirY, period, duration, phase);
      } else {
        const wallX = this.findAnchorSide(approxX, approxY, dirX < 0 ? 1 : -1);
        this.machinery.addSteamVent(wallX, Math.round(approxY), dirX, dirY, period, duration, phase);
      }
    }

    placeAnchoredCable(x0, y0, x1, y1, slack = 1.15) {
      this.verlet.addPowerCable(x0, this.findAnchorUp(x0, y0), x1, this.findAnchorUp(x1, y1), slack, 14);
    }

    placeTerminal(id, approxX, approxY, title, lines) {
      const spr = this.assets.terminalSprite;
      const floorY = this.findAnchorDown(approxX + 10, approxY);
      const x = Math.round(approxX);
      for (let shift = 0; shift <= 24; shift += 2) {
        for (const dir of [1, -1]) {
          const testX = x + shift * dir;
          if (this.hasSolidFloorSpan(testX + 2, floorY, spr.width - 4)) {
            this.terminals.push({ id, x: testX, y: floorY - spr.height, floorY, title, lines, read: false, sprite: spr });
            return;
          }
        }
      }
    }

    placeAnchoredChain(wx, wy, links, hasWeight, isVine, broken = false, isFiber = false) {
      this.verlet.addHangingChain(wx, this.findAnchorUp(wx, wy), links, 5, hasWeight, isVine, broken, isFiber);
    }

    // -----------------------------------------------------------------------
    // BUILD CHAPTER BY INDEX (0..6)
    // -----------------------------------------------------------------------
    build(sectorIndex = 0) {
      this.sectorIndex = clamp(sectorIndex, 0, 6);
      const biomes = ['sector04', 'cryo', 'sector07', 'amber', 'sector09', 'viaduct', 'atrium'];
      this.biome = biomes[this.sectorIndex];
      this.palette = BIOME_PALETTES[this.biome];

      this.verlet.clear();
      this.machinery.clear();
      this.lamps = [];
      this.crystals = [];
      this.bioVats = [];
      this.icicles = [];
      this.shards = [];
      this.crates = [];
      this.signs = [];
      this.pipes = [];
      this.drips = [];
      this.puddles = [];
      this.hazards = [];
      this.terminals = [];
      this.conduitLights = [];
      this.sunbeamXs = [];
      this.orb = null;
      this.exitGate = null;

      if (this.sectorIndex === 0) this.buildSector04();
      else if (this.sectorIndex === 1) this.buildCryoArchive();
      else if (this.sectorIndex === 2) this.buildSector07();
      else if (this.sectorIndex === 3) this.buildAmberReef();
      else if (this.sectorIndex === 4) this.buildSector09();
      else if (this.sectorIndex === 5) this.buildGaleViaduct();
      else this.buildGlassAtrium();

      this.computeTileMasks();
      this.populateGrassAndSpores();
    }

    parseMap(rawRows) {
      this.rows = rawRows.length;
      this.cols = rawRows[0].length;
      this.worldW = this.cols * TILE_SIZE;
      this.worldH = this.rows * TILE_SIZE;
      this.grid = rawRows.map((row) => row.padEnd(this.cols, '#').slice(0, this.cols).split(''));
    }

    computeTileMasks() {
      this.masks = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
      this.variants = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (this.grid[r][c] === '#') {
            const n = this.isGridSolid(c, r - 1) ? 1 : 0;
            const e = this.isGridSolid(c + 1, r) ? 2 : 0;
            const s = this.isGridSolid(c, r + 1) ? 4 : 0;
            const w = this.isGridSolid(c - 1, r) ? 8 : 0;
            this.masks[r][c] = n | e | s | w;
            this.variants[r][c] = Math.floor(hash2D(c, r, 313 + this.sectorIndex * 41) * this.assets.tileVariants);
          } else if (this.grid[r][c] === 'T') {
            this.variants[r][c] = Math.floor(hash2D(c, r, 555 + this.sectorIndex * 17) * 4);
          }
        }
      }
    }

    populateGrassAndSpores() {
      if (this.palette.noGrass) return;
      const flora = this.palette.flora;
      const grassCols = [flora.dark, flora.mid, flora.bright];
      const glowTip = this.biome === 'sector07' ? flora.tip : null;
      for (let r = 1; r < this.rows - 1; r++) {
        for (let c = 1; c < this.cols - 1; c++) {
          if (this.grid[r][c] === '#' && this.grid[r - 1][c] === '.') {
            const tileSeed = hash2D(c, r, 777 + this.sectorIndex * 91);
            const density = this.biome === 'sector09' ? 0.25 : 0.72;
            if (tileSeed < density) {
              const count = 2 + Math.floor(hash2D(c, r, 778) * 3);
              for (let i = 0; i < count; i++) {
                const gx = c * TILE_SIZE + 2 + Math.floor(hash2D(c * 7 + i, r, 779) * 12);
                const gh = 3 + Math.floor(hash2D(c * 13 + i, r, 780) * 4);
                this.verlet.addGrassBlade(gx, r * TILE_SIZE, gh, grassCols[(c + i) % grassCols.length], (i === 0 && glowTip) ? glowTip : null);
              }
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // CHAPTER 1 (0): SECTOR 04 — FLOODED SUBWAY
    // -----------------------------------------------------------------------
    buildSector04() {
      this.parseMap([
        '############################################################################', // 00
        '############################################################################', // 01
        '###........##............................................................###', // 02
        '###......................................................................###', // 03
        '###......................................................................###', // 04
        '###..................###.....................###.........................###', // 05
        '###......................................................................###', // 06
        '###......................................................................###', // 07
        '###......................................................................###', // 08
        '###.............................#######..................................###', // 09
        '###...######.............................................................###', // 10
        '###......................................................................###', // 11
        '###.........................TTTTTTT..TTTTTT..............................###', // 12
        '###..........#####.......................................................###', // 13
        '###......................................................................###', // 14
        '###..................TTTTTT...................TTTTTT.....................###', // 15
        '###......................................................................###', // 16
        '###.................................#####................................###', // 17
        '###.............#######################################TTTTT###..........###', // 18
        '###.......TTTTT..........................................................###', // 19
        '###......................................................................###', // 20
        '###........................................................TTTTT.........###', // 21
        '###....TTTTT.............................................................###', // 22
        '###......................................................................###', // 23
        '###...#####....####...................................TTTTT..............###', // 24
        '###......................................................................###', // 25
        '###...............................................................######.###', // 26
        '###.....TTTTT..............................................TTTTT.........###', // 27
        '###......................................................................###', // 28
        '###......................................................................###', // 29
        '###.............#####.................................TTTTT..............###', // 30
        '###......................................................................###', // 31
        '###......................................................................###', // 32
        '###.....TTTTT...........#####..TTTTTTTTTTTTTTTTT...........TTTTT.........###', // 33
        '###......................................................................###', // 34
        '###...............................................................#######..###', // 35
        '###.............#####..####.......####............####....TTTTT..........###', // 36
        '###......................................................................###', // 37
        '###........................WWWWWWWWWWWWWWWWWWWWWW........................###', // 38
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);

      this.spawn = { x: 6.2 * TILE_SIZE, y: 37 * TILE_SIZE };
      this.placeSign('subway', 19.0 * TILE_SIZE, 18 * TILE_SIZE, 42);
      this.placeSign('tunnel', 36.0 * TILE_SIZE, 22 * TILE_SIZE, 99);

      const orbX = 35.5 * TILE_SIZE, orbY = 14.2 * TILE_SIZE;
      this.orb = { x: orbX, y: orbY, anchorY: this.findAnchorUp(orbX, orbY), sprite: this.assets.energyOrb, activated: false, pulseTimer: 0, chargeAnim: 0 };
      for (const cx of [17, 29, 41, 51]) this.conduitLights.push({ x: cx * TILE_SIZE, y: 18 * TILE_SIZE - 2 });

      const elevX = 63 * TILE_SIZE, elevAnchorY = this.findAnchorUp(elevX + 24, 7 * TILE_SIZE);
      this.machinery.addElevator({ id: 's04_exit_lift', x: elevX, topY: 7 * TILE_SIZE, bottomY: 18 * TILE_SIZE, anchorY: elevAnchorY, cwX: 67 * TILE_SIZE, cwTopY: elevAnchorY + 18, cwBottomY: 16 * TILE_SIZE, mode: 'exit', requiresCore: true, startAtTop: false });

      this.placeAnchoredTurbine(23 * TILE_SIZE, 28 * TILE_SIZE, 5.2, 0.4);
      this.machinery.addPiston(51.5 * TILE_SIZE, 39 * TILE_SIZE, 14, 2.5, 0);
      this.placeAnchoredVent(18.5 * TILE_SIZE, 36 * TILE_SIZE, 0, -1, 4.5, 1.2, 1.0);
      this.placeBioVat(47.2 * TILE_SIZE, 17 * TILE_SIZE, false);
      this.machinery.addDrone(28 * TILE_SIZE, 10 * TILE_SIZE, 36, 5, 1.3, 0.4);
      this.machinery.addSwitchAndDoor(49.5 * TILE_SIZE, 36 * TILE_SIZE, 66 * TILE_SIZE, 36 * TILE_SIZE, 's04_vault');

      for (const [lx, ly, drop] of [
        [8.5 * TILE_SIZE, 5 * TILE_SIZE, 20], [16 * TILE_SIZE, 8 * TILE_SIZE, 28],
        [49 * TILE_SIZE, 8 * TILE_SIZE, 28], [69 * TILE_SIZE, 5 * TILE_SIZE, 24],
        [60 * TILE_SIZE, 20 * TILE_SIZE, 22], [8 * TILE_SIZE, 32 * TILE_SIZE, 24],
        [27 * TILE_SIZE, 26 * TILE_SIZE, 22], [47 * TILE_SIZE, 26 * TILE_SIZE, 22]
      ]) this.placeLamp(lx, ly, drop, this.assets.cageLamp);

      this.placeFloorProp(this.crystals, 4 * TILE_SIZE, 37 * TILE_SIZE, this.assets.crystals[0]);
      this.placeFloorProp(this.crystals, 24.5 * TILE_SIZE, 35 * TILE_SIZE, this.assets.crystals[1]);
      this.placeFloorProp(this.crystals, 68.5 * TILE_SIZE, 37 * TILE_SIZE, this.assets.crystals[0]);
      this.placeFloorProp(this.crystals, 68.5 * TILE_SIZE, 24 * TILE_SIZE, this.assets.crystals[0]);
      this.placeFloorProp(this.crystals, 4.5 * TILE_SIZE, 23 * TILE_SIZE, this.assets.crystals[1]);
      this.placeFloorProp(this.crystals, 34.5 * TILE_SIZE, 8 * TILE_SIZE, this.assets.crystals[1]);

      this.placeFloorProp(this.crates, 10.2 * TILE_SIZE, 37 * TILE_SIZE, this.assets.crates[0]);
      this.placeFloorProp(this.crates, 12.0 * TILE_SIZE, 37 * TILE_SIZE, this.assets.crates[1]);
      this.placeFloorProp(this.crates, 15.2 * TILE_SIZE, 17 * TILE_SIZE, this.assets.crates[0]);
      this.placeFloorProp(this.crates, 42.5 * TILE_SIZE, 17 * TILE_SIZE, this.assets.crates[0]);
      this.placeFloorProp(this.crates, 6.8 * TILE_SIZE, 9 * TILE_SIZE, this.assets.crates[1]);

      this.placeTerminal('log_04_a', 8.6 * TILE_SIZE, 37 * TILE_SIZE, 'UNIT-04 DIAGNOSTIC LOG', ['POWER GRID OFFLINE - 412 DAYS', 'RESTORE SECTOR 04 CORE ABOVE', 'TO UNLOCK EAST FREIGHT LIFT.']);
      this.placeTerminal('log_04_b', 30.6 * TILE_SIZE, 17 * TILE_SIZE, 'TRANSIT DISPATCH 04-B', ['CRYO-ARCHIVE LOCKED BELOW.', 'USE EAST LIFT TO DESCEND INTO', 'SERVER LABYRINTH CRYO-00.']);

      [[5 * TILE_SIZE, 8.5 * TILE_SIZE], [35 * TILE_SIZE, 7.5 * TILE_SIZE], [70 * TILE_SIZE, 24.5 * TILE_SIZE], [4.5 * TILE_SIZE, 22.5 * TILE_SIZE], [70.2 * TILE_SIZE, 37.5 * TILE_SIZE]].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.9 });
      });

      for (const [px, py] of [[13 * TILE_SIZE, 34 * TILE_SIZE], [37 * TILE_SIZE, 24 * TILE_SIZE], [50 * TILE_SIZE, 13 * TILE_SIZE], [56 * TILE_SIZE, 28 * TILE_SIZE]]) {
        this.placeAnchoredPipe(px, py);
      }

      this.puddles.push({ x: 27 * TILE_SIZE, y: 38 * TILE_SIZE + 9, w: 22 * TILE_SIZE, h: 7 });
      for (const dx of [29, 34, 39, 44, 47]) {
        const x = dx * TILE_SIZE + 6;
        this.drips.push({ x, y: this.findAnchorUp(x, 22 * TILE_SIZE), cy: 20 * TILE_SIZE, vy: 0, targetY: 38 * TILE_SIZE + 9, timer: Math.random() * 2.5, active: false });
      }

      for (const [cx, cy, links, wt] of [[4.5 * TILE_SIZE, 6 * TILE_SIZE, 8, true], [12.5 * TILE_SIZE, 6 * TILE_SIZE, 10, false], [23.5 * TILE_SIZE, 6 * TILE_SIZE, 10, false], [44 * TILE_SIZE, 6 * TILE_SIZE, 9, true], [58.5 * TILE_SIZE, 6 * TILE_SIZE, 12, false], [19.5 * TILE_SIZE, 22 * TILE_SIZE, 9, false], [31.5 * TILE_SIZE, 22 * TILE_SIZE, 11, true]]) {
        this.placeAnchoredChain(cx, cy, links, wt, false, false);
      }
      this.placeAnchoredChain(16 * TILE_SIZE, 21 * TILE_SIZE, 7, false, false, true);
      this.placeAnchoredChain(41.5 * TILE_SIZE, 21 * TILE_SIZE, 8, false, false, true);
      this.placeAnchoredChain(60.5 * TILE_SIZE, 36 * TILE_SIZE, 5, false, false, true);
      for (const [vx, vy, links] of [[17.5 * TILE_SIZE, 22 * TILE_SIZE, 7], [25.5 * TILE_SIZE, 22 * TILE_SIZE, 8], [38 * TILE_SIZE, 22 * TILE_SIZE, 8], [49.5 * TILE_SIZE, 22 * TILE_SIZE, 9]]) {
        this.placeAnchoredChain(vx, vy, links, false, true, false);
      }
      for (const [x0, y0, x1, y1] of [[3.5 * TILE_SIZE, 5.5 * TILE_SIZE, 18 * TILE_SIZE, 5.5 * TILE_SIZE], [21 * TILE_SIZE, 5.5 * TILE_SIZE, 45 * TILE_SIZE, 5.5 * TILE_SIZE], [48 * TILE_SIZE, 5.5 * TILE_SIZE, 72 * TILE_SIZE, 5.5 * TILE_SIZE], [3.5 * TILE_SIZE, 30 * TILE_SIZE, 17 * TILE_SIZE, 30 * TILE_SIZE], [28 * TILE_SIZE, 22 * TILE_SIZE, 48 * TILE_SIZE, 22 * TILE_SIZE]]) {
        this.placeAnchoredCable(x0, y0, x1, y1, 1.14);
      }
    }

    // -----------------------------------------------------------------------
    // CHAPTER 2 (1): THE BLIND CRYO-ARCHIVE (PITCH-BLACK MONOLITH LABYRINTH)
    // -----------------------------------------------------------------------
    buildCryoArchive() {
      this.parseMap([
        '############################################################################', // 00
        '############################################################################', // 01
        '###............####..................####................................###', // 02
        '###............####..................####................................###', // 03
        '###............####..................####................................###', // 04
        '###......................................................................###', // 05
        '###......................................................................###', // 06
        '###......................................................................###', // 07
        '###..........................####........................................###', // 08
        '###......................................................................###', // 09
        '###......................................................................###', // 10
        '###......................####..########..................................###', // 11 (Cryo Core Deck)
        '###...................TTT................................................###', // 12
        '###......................................................................###', // 13
        '###..........................................TTTTT...............#######.###', // 14 (Vault Roof)
        '###...#####..............................................................###', // 15
        '###......................................................................###', // 16
        '###..........TTTT..................................########TTTT..........###', // 17 (Exit Dock Row)
        '###......................................................................###', // 18
        '###......................................................................###', // 19
        '###...............####.......................TTTTT.......................###', // 20
        '###......................................................................###', // 21
        '###......................................................................###', // 22
        '###.........................TTT....#####..TTTTT..######..................###', // 23 (Spotlight Span)
        '###......................................................................###', // 24
        '###......................................................................###', // 25
        '###.....................######...........................................###', // 26
        '###...................................TTTT...............................###', // 27
        '###...#########..........................................................###', // 28
        '###................TTTTT.................................................###', // 29
        '###..........................................TTTT........................###', // 30
        '###......................................................................###', // 31
        '###......................#####...........................................###', // 32
        '###...................................TTTT...............................###', // 33
        '###......................................................................###', // 34
        '###................TTTTT.................................................###', // 35
        '###..........................................#####.......................###', // 36
        '###......................................................................###', // 37
        '###..############........................................................###', // 38 (Spawn Deck)
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);

      // Fix step-up at row 17 -> 14 -> 11 & secret Blast Door vault at cols 65..72 rows 15..17:
      for (let c = 65; c <= 72; c++) {
        this.grid[14][c] = '#';
        this.grid[17][c] = '#';
      }
      // Also make row 17 cols 62..65 solid `#` landing under East Vault door at col 66:
      for (let c = 59; c <= 65; c++) this.grid[17][c] = '#';
      // Ensure Blast Door at col 66, rows 15..17? Wait: 48px door = 3 tiles (rows 15, 16, 17 -> ceiling row 14 `#`, floor row 18 `#`!).
      for (let c = 66; c <= 72; c++) {
        this.grid[17][c] = '.';
        this.grid[18][c] = '#';
      }
      // Step from row 17 cols 59..64 down 1 tile to row 18 col 65 `#` into vault:
      this.grid[18][65] = '#';
      this.grid[17][65] = '.';
      // Keep elevator shaft clear at cols 63..65? Wait: put Cryo Exit Elevator at cols 59..61? No, check rows 14..17!
      // Put Cryo Exit Elevator at cols 60..62 (`bottomY = 17*16`, `topY = 6*16`, `cwX = 58*16`)? Wait: row 14 has `TTTTT` at `45..49`, so `cols 58..63` from row 2 ceiling down to row 17 is 100% OPEN AIR!
      // Let's keep `cols 51..58` `#` at row 17, `cols 59..62` open for Elevator (`x = 59*16`, `cwX = 63*16`) + `cols 64..65` `#` at row 18? Wait: how do you cross to Vault Door at `col 66` if Elevator shaft is `59..63`? Put Vault at `col 3..10, row 28` or `col 66, row 36`!
      // Let's put Cryo Secret Blast Door Vault at LOWER RIGHT (`cols 66..72`, `rows 35..39`) -> ceiling row 35 (`#`), floor row 39 (`#`), door at `col 66, rows 36..38`! And put `row 37` `cols 56..60` `T` + `row 36` `cols 45..49` `#` + `row 38` `cols 52..65` `#` connecting to it!
      for (let c = 65; c <= 72; c++) {
        this.grid[14][c] = '.';
        this.grid[17][c] = '.';
        this.grid[18][c] = '.';
        this.grid[35][c] = '#';
        this.grid[36][c] = '.';
        this.grid[37][c] = '.';
        this.grid[38][c] = '.';
      }
      this.grid[35][65] = '.';
      for (let c = 52; c <= 65; c++) this.grid[39][c] = '#';
      for (let c = 51; c <= 58; c++) this.grid[17][c] = '#';
      for (let c = 59; c <= 64; c++) this.grid[17][c] = '.';

      this.spawn = { x: 4.5 * TILE_SIZE, y: 36 * TILE_SIZE };
      this.placeSign('cryo', 4.0 * TILE_SIZE, 33 * TILE_SIZE, 311);

      // Cryo Core Orb suspended above row 11 dais
      const orbX = 36.5 * TILE_SIZE, orbY = 7.8 * TILE_SIZE;
      this.orb = { x: orbX, y: orbY, anchorY: this.findAnchorUp(orbX, orbY), sprite: this.assets.cryoOrb, activated: false, pulseTimer: 0, chargeAnim: 0 };
      for (const cx of [31, 34, 39]) this.conduitLights.push({ x: cx * TILE_SIZE, y: 11 * TILE_SIZE - 2 });

      // East Cryo Exit Elevator (cols 59..61, bottomY=17*16, topY=6*16, cwX=63*16)
      const elevX = 59 * TILE_SIZE, elevAnchorY = this.findAnchorUp(elevX + 24, 6 * TILE_SIZE);
      this.machinery.addElevator({ id: 'cryo_exit_lift', x: elevX, topY: 6 * TILE_SIZE, bottomY: 17 * TILE_SIZE, anchorY: elevAnchorY, cwX: 63 * TILE_SIZE, cwTopY: elevAnchorY + 14, cwBottomY: 15 * TILE_SIZE, mode: 'exit', requiresCore: true, startAtTop: false });

      // 4 Acoustic Sonar Pulse Pylons revealing labyrinth silhouettes!
      this.machinery.addSonarPylon(9.5 * TILE_SIZE, 38 * TILE_SIZE);
      this.machinery.addSonarPylon(25.0 * TILE_SIZE, 26 * TILE_SIZE);
      this.machinery.addSonarPylon(53.0 * TILE_SIZE, 23 * TILE_SIZE);
      this.machinery.addSonarPylon(32.5 * TILE_SIZE, 11 * TILE_SIZE);

      // 4 Sweeping Ceiling Searchlights
      this.machinery.addSpotlight(24 * TILE_SIZE, this.findAnchorUp(24 * TILE_SIZE, 20 * TILE_SIZE), Math.PI * 0.5, 0.52, 0.9, 0.0);
      this.machinery.addSpotlight(42 * TILE_SIZE, this.findAnchorUp(42 * TILE_SIZE, 18 * TILE_SIZE), Math.PI * 0.5, 0.58, 1.1, 1.8);
      this.machinery.addSpotlight(52 * TILE_SIZE, this.findAnchorUp(52 * TILE_SIZE, 14 * TILE_SIZE), Math.PI * 0.5, 0.48, 0.85, 3.1);
      this.machinery.addSpotlight(36 * TILE_SIZE, this.findAnchorUp(36 * TILE_SIZE, 26 * TILE_SIZE), Math.PI * 0.5, 0.62, 1.05, 0.9);

      // Dripping Icicles & Vapor Mist
      for (const [ix, iy, iv] of [[7 * TILE_SIZE, 30 * TILE_SIZE, 0], [18 * TILE_SIZE, 10 * TILE_SIZE, 1], [30 * TILE_SIZE, 15 * TILE_SIZE, 0], [46 * TILE_SIZE, 15 * TILE_SIZE, 1], [56 * TILE_SIZE, 26 * TILE_SIZE, 0]]) {
        this.placeIcicle(ix, iy, iv);
      }

      // Dead Fiber-Optic Cable Curtains (shimmering only near player aura or sonar!)
      for (const [fx, fy, len] of [[16 * TILE_SIZE, 20 * TILE_SIZE, 10], [27 * TILE_SIZE, 15 * TILE_SIZE, 12], [41 * TILE_SIZE, 10 * TILE_SIZE, 11], [49 * TILE_SIZE, 26 * TILE_SIZE, 12], [61 * TILE_SIZE, 24 * TILE_SIZE, 11]]) {
        this.placeAnchoredChain(fx, fy, len, false, false, false, true);
      }

      // Sparse Ice-White Micro Lamps
      for (const [lx, ly, drop] of [[6 * TILE_SIZE, 32 * TILE_SIZE, 18], [36 * TILE_SIZE, 5 * TILE_SIZE, 18], [56 * TILE_SIZE, 12 * TILE_SIZE, 18]]) {
        this.placeLamp(lx, ly, drop, this.assets.cryoLamp);
      }

      // Switch on Central Chasm (col 55, row 23) unlocks Lower-Right Cryo Vault Blast Door (col 66, rows 36..38)!
      this.machinery.addSwitchAndDoor(55 * TILE_SIZE, 23 * TILE_SIZE, 66 * TILE_SIZE, 36 * TILE_SIZE, 'cryo_vault');

      this.placeTerminal('log_cryo_a', 12.2 * TILE_SIZE, 38 * TILE_SIZE, 'CRYO-ARCHIVE 00-A', ['OPTIC GRID FROZEN IN STASIS.', 'TOUCH SONAR PYLONS TO PING', 'ROOM GEOMETRY THROUGH DARKNESS.']);
      this.placeTerminal('log_cryo_b', 34.0 * TILE_SIZE, 11 * TILE_SIZE, 'SERVER CORE 00-B', ['COOLING RESERVOIRS LOCATED ABOVE.', 'RESTORE CRYO CORE TO UNLOCK', 'LIFT TO HYDRO-PUMP SECTOR 07.']);

      [[6 * TILE_SIZE, 26.5 * TILE_SIZE], [26 * TILE_SIZE, 9.5 * TILE_SIZE], [47 * TILE_SIZE, 34.5 * TILE_SIZE], [69 * TILE_SIZE, 37.5 * TILE_SIZE], [10 * TILE_SIZE, 13.5 * TILE_SIZE]].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.85 });
      });

      this.placeAnchoredChain(20 * TILE_SIZE, 10 * TILE_SIZE, 8, false, false, true);
      this.placeAnchoredChain(53 * TILE_SIZE, 28 * TILE_SIZE, 7, false, false, true);
    }

    // -----------------------------------------------------------------------
    // CHAPTER 3 (2): SECTOR 07 — HYDRO-PUMP & MYCELIUM CONDUITS
    // -----------------------------------------------------------------------
    buildSector07() {
      this.parseMap([
        '############################################################################', // 00
        '############################################################################', // 01
        '###...........................##.......................##................###', // 02
        '###...........................##.......................##................###', // 03
        '###...........................##.......................##................###', // 04
        '###...........................##.......................##................###', // 05
        '###...........................##.......................##................###', // 06
        '###...######..................##.......................##................###', // 07
        '###...........................##.......................##................###', // 08
        '###......................................................................###', // 09
        '###.........TTTTT........................................................###', // 10
        '###......................................................................###', // 11
        '###.....................###..............................................###', // 12
        '###...............################.......................................###', // 13
        '###...........................................###########TTTTT###........###', // 14
        '###......................................................................###', // 15
        '###......................................................................###', // 16
        '###.....TTTTT................................................TTTTT.......###', // 17
        '###......................................................................###', // 18
        '###......................................................................###', // 19
        '###...TTTTT.............................................TTTTT............###', // 20
        '###......................................................................###', // 21
        '###......................................................................###', // 22
        '###.....TTTTT................................................TTTTT.......###', // 23
        '###......................................................................###', // 24
        '###......................................................................###', // 25
        '###...TTTTT...................................................#########..###', // 26
        '###.............##........................##.............................###', // 27
        '###.............##........................##.............................###', // 28
        '###.....TTTTT.........................TTTT...............................###', // 29
        '###......................................................................###', // 30
        '###......................................................................###', // 31
        '###..###########...............................................#########..###', // 32
        '###...........................................................####.......###', // 33
        '###......................................................................###', // 34
        '###.............####...####...####...####...####...####...####...#######.###', // 35
        '###......................................................................###', // 36
        '###..........................................................##..........###', // 37
        '###.............HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH...........###', // 38
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);
      for (let c = 63; c <= 67; c++) this.grid[14][c] = '.';
      for (let c = 65; c <= 72; c++) { this.grid[35][c] = '#'; this.grid[36][c] = '.'; this.grid[37][c] = '.'; this.grid[38][c] = '.'; }

      this.spawn = { x: 5.5 * TILE_SIZE, y: 30 * TILE_SIZE };
      this.placeSign('biolab', 5 * TILE_SIZE, 27 * TILE_SIZE, 131);

      const orbX = 24 * TILE_SIZE, orbY = 8.8 * TILE_SIZE;
      this.orb = { x: orbX, y: orbY, anchorY: this.findAnchorUp(orbX, orbY), sprite: this.assets.bioOrb, activated: false, pulseTimer: 0, chargeAnim: 0 };
      for (const cx of [18, 22, 26, 30]) this.conduitLights.push({ x: cx * TILE_SIZE, y: 13 * TILE_SIZE - 2 });

      const g1L = this.findAnchorSide(24 * TILE_SIZE, 27.5 * TILE_SIZE, -1), g1R = this.findAnchorSide(24 * TILE_SIZE, 27.5 * TILE_SIZE, 1);
      this.machinery.addGondola({ id: 's07_gondola_low', leftWallX: g1L, rightWallX: g1R, trackY: 27 * TILE_SIZE, minX: g1L + 12, maxX: g1R - 56, dropLen: 24, travelTime: 3.1, pauseTime: 0.85, phaseOffset: 0 });
      const g2L = this.findAnchorSide(50 * TILE_SIZE, 24.5 * TILE_SIZE, -1), g2R = this.findAnchorSide(50 * TILE_SIZE, 24.5 * TILE_SIZE, 1);
      this.machinery.addGondola({ id: 's07_gondola_mid', leftWallX: g2L, rightWallX: g2R, trackY: 24 * TILE_SIZE, minX: 44 * TILE_SIZE, maxX: 57 * TILE_SIZE, dropLen: 24, travelTime: 2.8, pauseTime: 0.85, phaseOffset: 1 });
      const g3L = this.findAnchorSide(44 * TILE_SIZE, 8.5 * TILE_SIZE, -1), g3R = this.findAnchorSide(44 * TILE_SIZE, 8.5 * TILE_SIZE, 1);
      this.machinery.addGondola({ id: 's07_gondola_high', leftWallX: g3L, rightWallX: g3R, trackY: 8 * TILE_SIZE, minX: g3L + 12, maxX: g3R - 56, dropLen: 40, travelTime: 2.9, pauseTime: 0.85, phaseOffset: 0.5 });

      const elevX = 63 * TILE_SIZE, elevAnchorY = this.findAnchorUp(elevX + 24, 5 * TILE_SIZE);
      this.machinery.addElevator({ id: 's07_exit_lift', x: elevX, topY: 5 * TILE_SIZE, bottomY: 14 * TILE_SIZE, anchorY: elevAnchorY, cwX: 67 * TILE_SIZE, cwTopY: elevAnchorY + 12, cwBottomY: 12 * TILE_SIZE, mode: 'exit', requiresCore: true, startAtTop: false });

      this.placeAnchoredTurbine(20 * TILE_SIZE, 18 * TILE_SIZE, 6.2, 0.2);
      this.placeAnchoredTurbine(48 * TILE_SIZE, 19 * TILE_SIZE, -5.6, 1.4);
      this.machinery.addPiston(51 * TILE_SIZE, 14 * TILE_SIZE, 14, 2.8, 0.3);
      this.machinery.addPiston(10.5 * TILE_SIZE, 32 * TILE_SIZE, 12, 2.4, 1.5);
      this.placeAnchoredVent(16.5 * TILE_SIZE, 35 * TILE_SIZE, 0, -1, 3.8, 1.15, 0.5);
      this.placeAnchoredVent(55.5 * TILE_SIZE, 35 * TILE_SIZE, 0, -1, 4.4, 1.25, 2.1);
      this.placeBioVat(11.8 * TILE_SIZE, 31 * TILE_SIZE, false);
      this.placeBioVat(45.2 * TILE_SIZE, 13 * TILE_SIZE, false);
      this.placeBioVat(69.5 * TILE_SIZE, 37 * TILE_SIZE, false);
      this.machinery.addSwitchAndDoor(66 * TILE_SIZE, 26 * TILE_SIZE, 65 * TILE_SIZE, 36 * TILE_SIZE, 's07_vault');
      this.machinery.addDrone(26 * TILE_SIZE, 18 * TILE_SIZE, 34, 5, 1.5, 0);
      this.machinery.addDrone(50 * TILE_SIZE, 10 * TILE_SIZE, 28, 4, 1.3, 2.1);

      for (const [lx, ly, drop] of [[9 * TILE_SIZE, 25 * TILE_SIZE, 22], [24 * TILE_SIZE, 22 * TILE_SIZE, 20], [45 * TILE_SIZE, 22 * TILE_SIZE, 20], [68 * TILE_SIZE, 21 * TILE_SIZE, 22], [24 * TILE_SIZE, 4 * TILE_SIZE, 20], [49 * TILE_SIZE, 4 * TILE_SIZE, 20], [69 * TILE_SIZE, 5 * TILE_SIZE, 22]]) {
        this.placeLamp(lx, ly, drop, this.assets.bioLamp);
      }

      this.placeFloorProp(this.crystals, 12.2 * TILE_SIZE, 31 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crystals, 29 * TILE_SIZE, 34 * TILE_SIZE, this.assets.bioMushrooms[1]);
      this.placeFloorProp(this.crystals, 43 * TILE_SIZE, 34 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crystals, 69 * TILE_SIZE, 25 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crystals, 4.5 * TILE_SIZE, 6 * TILE_SIZE, this.assets.bioMushrooms[1]);
      this.placeFloorProp(this.crystals, 18 * TILE_SIZE, 12 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crates, 3.8 * TILE_SIZE, 31 * TILE_SIZE, this.assets.crates[1]);
      this.placeFloorProp(this.crates, 53.2 * TILE_SIZE, 13 * TILE_SIZE, this.assets.crates[0]);

      this.placeTerminal('log_07_a', 8.2 * TILE_SIZE, 31 * TILE_SIZE, 'HYDRO BAY 07-A', ['COOLANT SUMP CONTAMINATED.', 'RIDE OVERHEAD GONDOLAS OR HOP', 'ACROSS PUMP PIERS BELOW.']);
      this.placeTerminal('log_07_b', 47.5 * TILE_SIZE, 13 * TILE_SIZE, 'MYCOLOGY REPORT 07-B', ['FOSSILIZED AMBER REEF DETECTED', 'ABOVE HYDRO BAY. RESTORE CORE', 'TO ENGAGE UPPER TRANSFER LIFT.']);

      [[5 * TILE_SIZE, 5.5 * TILE_SIZE], [36.5 * TILE_SIZE, 33.5 * TILE_SIZE], [50.5 * TILE_SIZE, 33.5 * TILE_SIZE], [67.8 * TILE_SIZE, 37.5 * TILE_SIZE], [15.5 * TILE_SIZE, 11.5 * TILE_SIZE]].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 1.1 });
      });

      for (const [px, py] of [[12 * TILE_SIZE, 27 * TILE_SIZE], [45 * TILE_SIZE, 28 * TILE_SIZE], [27 * TILE_SIZE, 9 * TILE_SIZE]]) this.placeAnchoredPipe(px, py);
      this.hazards.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 6, w: 46 * TILE_SIZE, h: 10 });
      this.puddles.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 6, w: 46 * TILE_SIZE, h: 10 });

      for (const dx of [20, 26, 33, 41, 48]) {
        const x = dx * TILE_SIZE + 8;
        this.drips.push({ x, y: this.findAnchorUp(x, 26 * TILE_SIZE), cy: 26 * TILE_SIZE, vy: 0, targetY: 38 * TILE_SIZE + 6, timer: Math.random() * 2.2, active: false });
      }
      for (const [cx, cy, links, wt] of [[7 * TILE_SIZE, 6 * TILE_SIZE, 8, false], [21 * TILE_SIZE, 6 * TILE_SIZE, 9, true], [38 * TILE_SIZE, 6 * TILE_SIZE, 10, false], [58 * TILE_SIZE, 6 * TILE_SIZE, 9, true]]) this.placeAnchoredChain(cx, cy, links, wt, false, false);
      this.placeAnchoredChain(14 * TILE_SIZE, 24 * TILE_SIZE, 7, false, false, true);
      this.placeAnchoredChain(34 * TILE_SIZE, 22 * TILE_SIZE, 6, false, false, true);
      for (const [vx, vy, links] of [[13 * TILE_SIZE, 6 * TILE_SIZE, 8], [33 * TILE_SIZE, 6 * TILE_SIZE, 8], [48 * TILE_SIZE, 6 * TILE_SIZE, 7]]) this.placeAnchoredChain(vx, vy, links, false, true, false);
      for (const [x0, y0, x1, y1] of [[4 * TILE_SIZE, 5 * TILE_SIZE, 20 * TILE_SIZE, 5 * TILE_SIZE], [34 * TILE_SIZE, 5 * TILE_SIZE, 54 * TILE_SIZE, 5 * TILE_SIZE], [18 * TILE_SIZE, 21 * TILE_SIZE, 42 * TILE_SIZE, 21 * TILE_SIZE]]) this.placeAnchoredCable(x0, y0, x1, y1, 1.15);
    }

    // -----------------------------------------------------------------------
    // CHAPTER 4 (3): THE FOSSILIZED AMBER REEF (ORGANIC CORAL, BOUNCE PODS, RINGS)
    // -----------------------------------------------------------------------
    buildAmberReef() {
      this.parseMap([
        '############################################################################', // 00
        '############################################################################', // 01
        '###...........###....................###.................................###', // 02
        '###......................................................................###', // 03
        '###......................................................................###', // 04
        '###......................................................................###', // 05
        '###......................................................................###', // 06
        '###......................................................................###', // 07
        '###......................................................................###', // 08
        '###.......######.........................................................###', // 09
        '###......................................................................###', // 10
        '###......................................................................###', // 11
        '###..........................#############...............................###', // 12 (Amber Core Dome)
        '###......................................................................###', // 13
        '###......................................................................###', // 14
        '###......................................................................###', // 15
        '###.........................................................#####........###', // 16 (Exit Lift Landing)
        '###......................................................................###', // 17
        '###...#####..........................................TTTT................###', // 18
        '###......................................................................###', // 19
        '###.................................#######.......########...............###', // 20 (Upper Pod Deck)
        '###................########..............................................###', // 21 (West Pod Deck)
        '###......................................................................###', // 22
        '###......................................................................###', // 23
        '###......................................................................###', // 24
        '###......................................................................###', // 25
        '###............................................................########..###', // 26 (Vault Roof)
        '###..........................######....#######...........................###', // 27 (Mid Coral Terraces)
        '###......................................................................###', // 28
        '###......................................................................###', // 29
        '###...........................................................#########..###', // 30 (Vault Floor)
        '###....................#####.............................................###', // 31
        '###......................................................................###', // 32
        '###......................................................................###', // 33
        '###.........................####.........................................###', // 34
        '###..................####..........######.......#####....................###', // 35 (Coral Pods & Piers)
        '###......................................................................###', // 36
        '###..############........................................................###', // 37 (Spawn Terrace)
        '###.............HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH...###', // 38 (Honey-Amber Sump)
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);

      // Seal lower-right Amber Reef Blast Door vault cleanly (cols 65..72, rows 27..29, door at col 65)
      for (let c = 65; c <= 72; c++) { this.grid[26][c] = '#'; this.grid[30][c] = '#'; }
      this.grid[27][64] = '.'; this.grid[28][64] = '.'; this.grid[29][64] = '.';
      for (let c = 59; c <= 64; c++) this.grid[30][c] = '#';
      this.grid[33][53] = 'T'; this.grid[33][54] = 'T'; this.grid[33][55] = 'T'; this.grid[33][56] = 'T';
      for (let c = 63; c <= 67; c++) this.grid[16][c] = '.';

      this.spawn = { x: 4.5 * TILE_SIZE, y: 35 * TILE_SIZE };
      this.placeSign('amber', 7.2 * TILE_SIZE, 37 * TILE_SIZE, 412);

      // Amber Core Orb above Dome (col 33, row 8.8)
      const orbX = 33.5 * TILE_SIZE, orbY = 8.8 * TILE_SIZE;
      this.orb = { x: orbX, y: orbY, anchorY: this.findAnchorUp(orbX, orbY), sprite: this.assets.amberOrb, activated: false, pulseTimer: 0, chargeAnim: 0 };
      for (const cx of [28, 32, 36, 39]) this.conduitLights.push({ x: cx * TILE_SIZE, y: 12 * TILE_SIZE - 2 });

      // East Amber Exit Elevator (cols 63..65, bottomY = 16*16, topY = 5*16)
      const elevX = 63 * TILE_SIZE, elevAnchorY = this.findAnchorUp(elevX + 24, 5 * TILE_SIZE);
      this.machinery.addElevator({ id: 'amber_exit_lift', x: elevX, topY: 5 * TILE_SIZE, bottomY: 16 * TILE_SIZE, anchorY: elevAnchorY, cwX: 67 * TILE_SIZE, cwTopY: elevAnchorY + 14, cwBottomY: 14 * TILE_SIZE, mode: 'exit', requiresCore: true, startAtTop: false });

      // Bouncing Spore-Bladder Pods (launch PICO up 7 tiles into upper fossil domes!)
      this.machinery.addBouncePod(35.5 * TILE_SIZE, 35 * TILE_SIZE);
      this.machinery.addBouncePod(42.5 * TILE_SIZE, 27 * TILE_SIZE);
      this.machinery.addBouncePod(21.5 * TILE_SIZE, 21 * TILE_SIZE);

      // Embedded Rotating Tarnished-Brass Centrifuge Rings
      this.machinery.addCentrifugeRing(22 * TILE_SIZE, 26 * TILE_SIZE, 0.35, 0);
      this.machinery.addCentrifugeRing(46 * TILE_SIZE, 20 * TILE_SIZE, -0.45, 1.2);
      this.machinery.addCentrifugeRing(33 * TILE_SIZE, 14 * TILE_SIZE, 0.28, 2.4);

      this.machinery.addSwitchAndDoor(50.5 * TILE_SIZE, 20 * TILE_SIZE, 65 * TILE_SIZE, 27 * TILE_SIZE, 'amber_vault');

      for (const [lx, ly, drop] of [[6 * TILE_SIZE, 30 * TILE_SIZE, 20], [28 * TILE_SIZE, 16 * TILE_SIZE, 22], [50 * TILE_SIZE, 16 * TILE_SIZE, 20], [33 * TILE_SIZE, 4 * TILE_SIZE, 18], [67 * TILE_SIZE, 6 * TILE_SIZE, 22]]) {
        this.placeLamp(lx, ly, drop, this.assets.coralLamp);
      }

      this.placeFloorProp(this.crystals, 4.0 * TILE_SIZE, 36 * TILE_SIZE, this.assets.amberCrystals[0]);
      this.placeFloorProp(this.crystals, 29.0 * TILE_SIZE, 26 * TILE_SIZE, this.assets.amberCrystals[0]);
      this.placeFloorProp(this.crystals, 68.5 * TILE_SIZE, 29 * TILE_SIZE, this.assets.amberCrystals[0]);
      this.placeFloorProp(this.crystals, 38.0 * TILE_SIZE, 11 * TILE_SIZE, this.assets.amberCrystals[0]);
      this.placeBioVat(49.5 * TILE_SIZE, 19 * TILE_SIZE, true);

      this.placeTerminal('log_amb_a', 12.2 * TILE_SIZE, 36 * TILE_SIZE, 'AMBER ARCHIVE 08-A', ['ANCIENT RINGS TRAPPED IN RESIN.', 'BOUNCE ON GOLDEN SPORE PODS', 'TO LAUNCH INTO UPPER DOMES.']);
      this.placeTerminal('log_amb_b', 30.0 * TILE_SIZE, 11 * TILE_SIZE, 'FOSSIL SURVEY 08-B', ['THERMAL CONDUITS RUMBLE ABOVE.', 'ACTIVATE AMBER CORE TO ASCEND', 'INTO GEOTHERMAL REACTOR 09.']);

      [[5.5 * TILE_SIZE, 16.5 * TILE_SIZE], [27.0 * TILE_SIZE, 10.5 * TILE_SIZE], [68.5 * TILE_SIZE, 28.5 * TILE_SIZE], [47.5 * TILE_SIZE, 33.5 * TILE_SIZE], [11.5 * TILE_SIZE, 7.5 * TILE_SIZE]].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.95 });
      });

      this.hazards.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 5, w: 54 * TILE_SIZE, h: 11 });
      this.puddles.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 5, w: 54 * TILE_SIZE, h: 11 });

      // Slow Viscous Golden Amber Ceiling Drips
      for (const dx of [22, 31, 40, 49, 57]) {
        const x = dx * TILE_SIZE + 6;
        this.drips.push({ x, y: this.findAnchorUp(x, 20 * TILE_SIZE), cy: 20 * TILE_SIZE, vy: 0, targetY: 38 * TILE_SIZE + 5, timer: Math.random() * 3.0, active: false });
      }
      for (const [vx, vy, links] of [[18 * TILE_SIZE, 10 * TILE_SIZE, 9], [39 * TILE_SIZE, 10 * TILE_SIZE, 8], [52 * TILE_SIZE, 10 * TILE_SIZE, 10], [27 * TILE_SIZE, 22 * TILE_SIZE, 7]]) {
        this.placeAnchoredChain(vx, vy, links, false, true, false);
      }
    }

    // -----------------------------------------------------------------------
    // CHAPTER 5 (4): SECTOR 09 — GEOTHERMAL REACTOR (UP TO GALE VIADUCT!)
    // -----------------------------------------------------------------------
    buildSector09() {
      this.parseMap([
        '############################################################################', // 00
        '############################################################################', // 01
        '###..............................####....................................###', // 02
        '###......................................................................###', // 03
        '###......................................................................###', // 04
        '###......................................................................###', // 05
        '###......................................................................###', // 06
        '###......................................................................###', // 07
        '###.........................##############...............................###', // 08 (Top Reactor Deck)
        '###.....######..........................................#######..........###', // 09
        '###...............TTTTT...................TTTTT..........................###', // 10
        '###.....................................................#####............###', // 11
        '###......................................................................###', // 12
        '###.............................................#######..........######..###', // 13
        '###......................................................................###', // 14
        '###......................................................................###', // 15
        '###......................................................................###', // 16
        '###....................##........................##......................###', // 17
        '###....................##........................##......................###', // 18
        '###....................##........................##......................###', // 19
        '###...######.............................................................###', // 20
        '###...........TTTT.......................................................###', // 21
        '###................###...................................................###', // 22
        '###.............................................#######..................###', // 23
        '###....................TTTT..............................................###', // 24
        '###......................................................................###', // 25
        '###......................................................................###', // 26
        '###.....................#############....................................###', // 27
        '###......................................................................###', // 28
        '###......................................................................###', // 29
        '###.......................................................######.........###', // 30
        '###......................................................................###', // 31
        '###......................................................................###', // 32
        '###.............................................TTTTT....................###', // 33
        '###......................................................................###', // 34
        '###..................................####................................###', // 35
        '###..#############.....####...............####...................######..###', // 36
        '###......................................................................###', // 37
        '###.............HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH.....###', // 38
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);
      for (let c = 16; c <= 21; c++) this.grid[22][c] = '#';
      for (let c = 55; c <= 62; c++) this.grid[9][c] = '#';
      for (let c = 65; c <= 72; c++) { this.grid[9][c] = '#'; this.grid[10][c] = '.'; this.grid[11][c] = '.'; this.grid[12][c] = '.'; this.grid[13][c] = '#'; }
      this.grid[13][63] = '#'; this.grid[13][64] = '#';
      for (let c = 51; c <= 54; c++) this.grid[26][c] = 'T';
      for (let c = 41; c <= 46; c++) { this.grid[8][c] = (c <= 41) ? '#' : '.'; }
      for (let c = 56; c <= 60; c++) this.grid[11][c] = '.';

      this.spawn = { x: 4.5 * TILE_SIZE, y: 34 * TILE_SIZE };
      this.placeSign('reactor', 7.2 * TILE_SIZE, 36 * TILE_SIZE, 211);

      const e1X = 18 * TILE_SIZE, e1A = this.findAnchorUp(e1X + 24, 24 * TILE_SIZE);
      this.machinery.addElevator({ id: 's09_lift_1', x: e1X, topY: 27 * TILE_SIZE, bottomY: 36 * TILE_SIZE, anchorY: e1A, cwX: 16 * TILE_SIZE, cwTopY: e1A + 12, cwBottomY: 34 * TILE_SIZE, mode: 'cycle', travelTime: 2.3, pauseTime: 1.0, startAtTop: false });

      const g1L = this.findAnchorSide(35 * TILE_SIZE, 18.5 * TILE_SIZE, -1), g1R = this.findAnchorSide(35 * TILE_SIZE, 18.5 * TILE_SIZE, 1);
      this.machinery.addGondola({ id: 's09_gondola_mid', leftWallX: g1L, rightWallX: g1R, trackY: 18 * TILE_SIZE, minX: g1L + 12, maxX: g1R - 56, dropLen: 36, travelTime: 3.1, pauseTime: 0.9, phaseOffset: 0.4 });

      const e2X = 56 * TILE_SIZE, e2A = this.findAnchorUp(e2X + 24, 11 * TILE_SIZE);
      this.machinery.addElevator({ id: 's09_lift_2', x: e2X, topY: 13 * TILE_SIZE, bottomY: 23 * TILE_SIZE, anchorY: e2A, cwX: 60 * TILE_SIZE, cwTopY: e2A + 12, cwBottomY: 22 * TILE_SIZE, mode: 'cycle', travelTime: 2.5, pauseTime: 1.0, startAtTop: true });

      // Top Skyway Exit Lift up to Gale Viaduct (cols 42..44, bottomY=8*16, topY=2*16)
      const exX = 42 * TILE_SIZE, exA = this.findAnchorUp(exX + 24, 3 * TILE_SIZE);
      this.machinery.addElevator({ id: 's09_exit_lift', x: exX, topY: 2 * TILE_SIZE, bottomY: 8 * TILE_SIZE, anchorY: exA, cwX: 46 * TILE_SIZE, cwTopY: exA + 8, cwBottomY: 7 * TILE_SIZE, mode: 'exit', requiresCore: true, startAtTop: false });

      const orbX = 33.0 * TILE_SIZE, orbY = 5.2 * TILE_SIZE;
      this.orb = { x: orbX, y: orbY, anchorY: this.findAnchorUp(orbX, orbY), sprite: this.assets.reactorOrb, activated: false, pulseTimer: 0, chargeAnim: 0 };
      for (const cx of [29, 34, 39]) this.conduitLights.push({ x: cx * TILE_SIZE, y: 8 * TILE_SIZE - 2 });

      this.placeAnchoredTurbine(29 * TILE_SIZE, 29 * TILE_SIZE, 7.2, 0);
      this.placeAnchoredTurbine(40 * TILE_SIZE, 11 * TILE_SIZE, -6.5, 1.1);
      this.machinery.addPiston(51 * TILE_SIZE, 13 * TILE_SIZE, 14, 3.0, 0);
      this.machinery.addPiston(26 * TILE_SIZE, 27 * TILE_SIZE, 12, 2.5, 1.2);
      this.placeAnchoredVent(13.5 * TILE_SIZE, 35 * TILE_SIZE, 0, -1, 3.6, 1.1, 0);
      this.placeAnchoredVent(31.5 * TILE_SIZE, 26 * TILE_SIZE, 0, -1, 4.0, 1.15, 1.8);
      this.placeAnchoredVent(52.5 * TILE_SIZE, 22 * TILE_SIZE, 0, -1, 3.5, 1.05, 0.9);
      this.placeBioVat(14.0 * TILE_SIZE, 35 * TILE_SIZE, true);
      this.placeBioVat(69.5 * TILE_SIZE, 12 * TILE_SIZE, true);
      this.machinery.addSwitchAndDoor(60 * TILE_SIZE, 30 * TILE_SIZE, 65 * TILE_SIZE, 10 * TILE_SIZE, 's09_vault');
      this.machinery.addDrone(35 * TILE_SIZE, 14 * TILE_SIZE, 34, 4, 1.6, 0.2);
      this.machinery.addDrone(40 * TILE_SIZE, 24 * TILE_SIZE, 38, 6, 1.4, 2.5);

      for (const [lx, ly, drop] of [[6.5 * TILE_SIZE, 25 * TILE_SIZE, 22], [28 * TILE_SIZE, 22 * TILE_SIZE, 20], [47 * TILE_SIZE, 21 * TILE_SIZE, 22], [62 * TILE_SIZE, 16 * TILE_SIZE, 20], [23 * TILE_SIZE, 5 * TILE_SIZE, 18], [68 * TILE_SIZE, 4 * TILE_SIZE, 20]]) {
        this.placeLamp(lx, ly, drop, this.assets.amberLamp);
      }
      this.placeFloorProp(this.crates, 11.8 * TILE_SIZE, 35 * TILE_SIZE, this.assets.crates[0]);
      this.placeFloorProp(this.crates, 38.0 * TILE_SIZE, 7 * TILE_SIZE, this.assets.crates[1]);

      this.placeTerminal('log_09_a', 4.5 * TILE_SIZE, 35 * TILE_SIZE, 'REACTOR CONTROL 09-A', ['THERMAL PRESSURE CRITICAL.', 'RIDE PISTON LIFTS & GONDOLAS', 'TO REACH UPPER SKYWAY LIFT.']);
      this.placeTerminal('log_09_b', 28.2 * TILE_SIZE, 7 * TILE_SIZE, 'SKYWAY ACCESS 09-B', ['STORM WINDS HOWLING OUTSIDE.', 'ACTIVATE CORE TO BOARD LIFT', 'TO THE GALE VIADUCT BRIDGE.']);

      [[36.5 * TILE_SIZE, 33.5 * TILE_SIZE], [5.5 * TILE_SIZE, 18.5 * TILE_SIZE], [68 * TILE_SIZE, 11.5 * TILE_SIZE], [10 * TILE_SIZE, 7.5 * TILE_SIZE], [70.2 * TILE_SIZE, 11.5 * TILE_SIZE]].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.8 });
      });

      for (const [px, py] of [[24 * TILE_SIZE, 28 * TILE_SIZE], [52 * TILE_SIZE, 24 * TILE_SIZE], [10 * TILE_SIZE, 13 * TILE_SIZE]]) this.placeAnchoredPipe(px, py);
      this.hazards.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 5, w: 52 * TILE_SIZE, h: 11 });
      this.puddles.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 5, w: 52 * TILE_SIZE, h: 11 });

      for (const [cx, cy, links, wt] of [[10 * TILE_SIZE, 5 * TILE_SIZE, 10, true], [50 * TILE_SIZE, 5 * TILE_SIZE, 9, false], [66 * TILE_SIZE, 5 * TILE_SIZE, 9, true]]) this.placeAnchoredChain(cx, cy, links, wt, false, false);
      this.placeAnchoredChain(12 * TILE_SIZE, 25 * TILE_SIZE, 6, false, false, true);
      this.placeAnchoredChain(44 * TILE_SIZE, 21 * TILE_SIZE, 7, false, false, true);
      for (const [x0, y0, x1, y1] of [[4 * TILE_SIZE, 5 * TILE_SIZE, 25 * TILE_SIZE, 5 * TILE_SIZE], [4 * TILE_SIZE, 26 * TILE_SIZE, 18 * TILE_SIZE, 26 * TILE_SIZE]]) this.placeAnchoredCable(x0, y0, x1, y1, 1.14);
    }

    // -----------------------------------------------------------------------
    // CHAPTER 6 (5): THE GALE VIADUCT (OPEN-AIR SUSPENSION MEGA-BRIDGE, 92x42)
    // -----------------------------------------------------------------------
    buildGaleViaduct() {
      // Open sky across top! Bottom abyss triggers safe pier respawn!
      this.parseMap([
        '............................................................................................', // 00
        '............................................................................................', // 01
        '............................................................................................', // 02
        '............................................................................................', // 03
        '............................................................................................', // 04
        '...............................................................................#########....', // 05 (East Lift Roof)
        '............................................................................................', // 06
        '............................................................................................', // 07
        '.............................................#########......................................', // 08 (Central Tower Cap)
        '.............................................#########......................................', // 09
        '.............................................##.....##......................................', // 10
        '.............................................##.....##......................................', // 11
        '.............................................##.....##......................................', // 12
        '............................................................................................', // 13
        '............................................................................................', // 14
        '............................................................................................', // 15
        '............................................................................................', // 16
        '......................................................................#########....#####....', // 17 (East Pier Deck)
        '......................................................................##....................', // 18
        '..............................................................TTTTT...##....................', // 19
        '......................................................................##....................', // 20
        '......................................................................##....................', // 21
        '......................................................TTTTT...........##....................', // 22
        '###..################...TTTTT...#####...TTTTT..###########............##....................', // 23 (West Pier & Bridge Deck)
        '###..##............##..........................##.......##............##....................', // 24
        '###..##............##..........................##.......##............##....................', // 25
        '###..##............##..........................##.......##............##....................', // 26
        '###..##............##..........................##.......##............##....................', // 27
        '###..##............##..........................##.......##............##....................', // 28
        '###..##............##...TTTTT...#####...TTTTT..##.......##............##....................', // 29 (Lower Dangling Catwalk)
        '###..##............##..........................##.......##............##....................', // 30
        '###..##............##..........................##.......##............##....................', // 31
        '###..##............##..........................##.......##............##....................', // 32
        '###..##............##..........................##.......##............##....................', // 33
        '###..##............##..........................##.......##............##....................', // 34
        '###..##............##..........................##.......##............##....................', // 35
        '###..##............##..........................##.......##............##....................', // 36
        '###..##............##..........................##.......##............##....................', // 37
        '###..##............##..........................##.......##............##....................', // 38
        '###..##............##..........................##.......##............##....................', // 39
        '............................................................................................', // 40
        '............................................................................................'  // 41
      ]);

      // Connect West Pier step down to Lower Maintenance Catwalk (`col 20, row 26 T`)
      for (let c = 19; c <= 22; c++) this.grid[26][c] = 'T';
      // Ensure right edge solid barrier at col 89..91
      for (let r = 0; r < 42; r++) { this.grid[r][90] = '#'; this.grid[r][91] = '#'; }

      this.spawn = { x: 6.0 * TILE_SIZE, y: 21 * TILE_SIZE };
      this.placeSign('viaduct', 8.5 * TILE_SIZE, 23 * TILE_SIZE, 515);

      // Colossal Background Slow-Spinning Canvas Wind-Catchers
      this.machinery.windCatchers.push({ x: 24 * TILE_SIZE, y: 14 * TILE_SIZE, phase: 0 });
      this.machinery.windCatchers.push({ x: 58 * TILE_SIZE, y: 12 * TILE_SIZE, phase: 1.7 });
      this.machinery.windCatchers.push({ x: 82 * TILE_SIZE, y: 10 * TILE_SIZE, phase: 3.1 });

      // Central Tower Core Beacon Orb (col 49.5, row 18.5, hung from tower cap row 9)
      const orbX = 49.5 * TILE_SIZE, orbY = 18.5 * TILE_SIZE;
      this.orb = { x: orbX, y: orbY, anchorY: 10 * TILE_SIZE, sprite: this.assets.reactorOrb, activated: false, pulseTimer: 0, chargeAnim: 0 };
      for (const cx of [47, 51, 55]) this.conduitLights.push({ x: cx * TILE_SIZE, y: 23 * TILE_SIZE - 2 });

      // Steep Cable-Car Zip Gondola across the East Gorge (from Central Tower col 57 -> East Pier col 67)
      this.machinery.addZipGondola({
        id: 'viaduct_zip',
        x0: 57 * TILE_SIZE, y0: 19.5 * TILE_SIZE,
        x1: 66.5 * TILE_SIZE, y1: 14.5 * TILE_SIZE,
        sag: 16, travelTime: 3.6, pauseTime: 1.1
      });

      // East Tower Atrium Exit Elevator (cols 80..82, bottomY = 17*16, topY = 7*16, cwX = 84*16)
      const elevX = 80 * TILE_SIZE, elevA = 6 * TILE_SIZE;
      this.machinery.addElevator({ id: 'viaduct_exit_lift', x: elevX, topY: 7 * TILE_SIZE, bottomY: 17 * TILE_SIZE, anchorY: elevA, cwX: 84 * TILE_SIZE, cwTopY: elevA + 10, cwBottomY: 15 * TILE_SIZE, mode: 'exit', requiresCore: true, startAtTop: false });

      // Whipping Tattered Cloth Warning Pennants along bridge posts
      for (const px of [16, 33, 45, 72, 78]) {
        const floorY = this.findAnchorDown(px * TILE_SIZE, 20 * TILE_SIZE);
        this.verlet.addPennant(px * TILE_SIZE, floorY - 14, 6, 4, px === 45 ? '#ffd27d' : '#c93b4b');
      }

      // Hanging Bridge Lanterns & Under-Catwalk Chains
      for (const [lx, ly, drop] of [[48 * TILE_SIZE, 10 * TILE_SIZE, 22], [52 * TILE_SIZE, 10 * TILE_SIZE, 22], [82 * TILE_SIZE, 6 * TILE_SIZE, 20]]) {
        this.placeLamp(lx, ly, drop, this.assets.brassLamp);
      }
      for (const cx of [24, 34, 42]) {
        this.placeAnchoredChain(cx * TILE_SIZE, 24 * TILE_SIZE, 9, true, false, false);
      }

      this.placeFloorProp(this.crates, 5.0 * TILE_SIZE, 22 * TILE_SIZE, this.assets.crates[0]);
      this.placeTerminal('log_vdt_a', 15.0 * TILE_SIZE, 22 * TILE_SIZE, 'GALE VIADUCT 11-A', ['TAILWIND GUSTS BOOST JUMPS!', 'DROP TO LOWER CATWALK FOR SHARDS', 'OR CROSS TOWARD CENTRAL TOWER.']);
      this.placeTerminal('log_vdt_b', 47.0 * TILE_SIZE, 22 * TILE_SIZE, 'CENTRAL PIER 11-B', ['ACTIVATE PIER BEACON ABOVE,', 'THEN RIDE THE CABLE-CAR TRAM TO', 'THE SHATTERED GLASS ATRIUM.']);

      [[34 * TILE_SIZE, 27.5 * TILE_SIZE], [24 * TILE_SIZE, 27.5 * TILE_SIZE], [42 * TILE_SIZE, 27.5 * TILE_SIZE], [61.5 * TILE_SIZE, 17.5 * TILE_SIZE], [75 * TILE_SIZE, 15.5 * TILE_SIZE]].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.9 });
      });

      // Bottom gorge abyss hazard (safe checkpoint respawn)
      this.hazards.push({ x: 0, y: 40 * TILE_SIZE, w: this.worldW, h: 32 });
    }

    // -----------------------------------------------------------------------
    // CHAPTER 7 (6): THE SHATTERED GLASS ATRIUM (VERTICAL CATHEDRAL, 56x64)
    // -----------------------------------------------------------------------
    buildGlassAtrium() {
      // Soaring vertical glasshouse cathedral (56 cols x 64 rows = 896x1024 px)
      const rows = [];
      for (let r = 0; r < 64; r++) {
        if (r === 0 || r === 1) {
          // Cracked glasshouse skylight dome open to golden sunlight!
          rows.push('###.........##############################.........###');
        } else if (r >= 61) {
          rows.push('########################################################');
        } else {
          rows.push('###..................................................###');
        }
      }
      this.parseMap(rows);

      // Helper to carve solid '#' platform or 'T' iron stair mezzanine cleanly
      const setSpan = (r, c0, c1, ch = '#') => {
        for (let c = c0; c <= c1; c++) this.grid[r][c] = ch;
      };

      // Conservatory Ground Floor (`row 60` `#` is rows 61..63 -> wait: floor at `row 61` is solid across 0..55!)
      // Tier 1 Ascent (rows 61 -> 44)
      setSpan(58, 28, 35, 'T'); // Right iron stair 1
      setSpan(55, 36, 40, 'T'); // Boarding perch for Diagonal Gantry #1!
      setSpan(52, 10, 17, 'T'); // Left backup iron mezzanine
      setSpan(49, 19, 25, 'T');
      setSpan(46, 27, 32, 'T');

      // Tier 2 Garden Mezzanine (row 44)
      setSpan(44, 33, 52, '#'); // East sunlit balcony (Gantry #1 top drop!)
      setSpan(42, 23, 27, 'T'); // Bridge after Fern #2
      setSpan(39, 10, 21, '#'); // West conservatory terrace (Gantry #2 bottom boarding!)
      setSpan(36, 15, 20, 'T'); // Backup steps if not riding gantry
      setSpan(33, 21, 26, 'T');

      // Tier 3 Upper Choir & Dome Balcony (rows 27 -> 12)
      setSpan(27, 23, 36, '#'); // Central choir balcony (Gantry #2 top drop!)
      setSpan(24, 42, 51, '#'); // East sunlit fern terrace
      setSpan(21, 35, 40, 'T');
      setSpan(18, 27, 33, 'T');
      setSpan(15, 35, 39, 'T');

      // Shattered Skylight Dome Spire Platform (`row 12`)
      setSpan(12, 18, 36, '#');
      // Brass Gantry Wall Anchors
      setSpan(44, 48, 52, '#');

      this.spawn = { x: 6.5 * TILE_SIZE, y: 59 * TILE_SIZE };
      this.placeSign('atrium', 9.5 * TILE_SIZE, 61 * TILE_SIZE, 616);

      // Golden Sunbeam Columns pouring down through shattered skylights
      this.sunbeamXs = [15 * TILE_SIZE, 28 * TILE_SIZE, 41 * TILE_SIZE];

      // Sky Core Orb & Surface Broadcast Relay Spire at Top Dome (`row 12`)
      const orbX = 24.5 * TILE_SIZE, orbY = 8.8 * TILE_SIZE;
      this.orb = { x: orbX, y: orbY, anchorY: 2 * TILE_SIZE, sprite: this.assets.skyOrb, activated: false, pulseTimer: 0, chargeAnim: 0 };
      for (const cx of [21, 27, 33]) this.conduitLights.push({ x: cx * TILE_SIZE, y: 12 * TILE_SIZE - 2 });

      const gateX = 31 * TILE_SIZE, gateFloorY = 12 * TILE_SIZE;
      this.exitGate = {
        x: gateX - 17,
        y: gateFloorY - this.assets.exitGateSprite.height,
        cx: gateX,
        cy: gateFloorY - 22,
        activated: false,
        sprite: this.assets.exitGateSprite
      };

      // 2 Diagonal 45-Degree Glass-Cleaning Gantry Lifts!
      this.machinery.addDiagonalGantry({
        id: 'atrium_gantry_1',
        x0: 38 * TILE_SIZE, y0: 55 * TILE_SIZE,
        x1: 47 * TILE_SIZE, y1: 44 * TILE_SIZE,
        travelTime: 3.4, pauseTime: 1.0, phaseOffset: 0
      });
      this.machinery.addDiagonalGantry({
        id: 'atrium_gantry_2',
        x0: 11 * TILE_SIZE, y0: 39 * TILE_SIZE,
        x1: 23 * TILE_SIZE, y1: 27 * TILE_SIZE,
        travelTime: 3.6, pauseTime: 1.0, phaseOffset: 1.1
      });

      // Unfurling Giant Ferns (grow into walkable leaf bridges when approached!)
      this.machinery.addFern(23 * TILE_SIZE, 58 * TILE_SIZE, 1);
      this.machinery.addFern(29 * TILE_SIZE, 43 * TILE_SIZE, -1);
      this.machinery.addFern(38 * TILE_SIZE, 25 * TILE_SIZE, 1);

      // Rotating Brass Garden Sprinklers creating Rainbow Mist in Sunbeams!
      this.machinery.addSprinkler(14.5 * TILE_SIZE, 61 * TILE_SIZE, 0);
      this.machinery.addSprinkler(41.0 * TILE_SIZE, 44 * TILE_SIZE, 1.4);
      this.machinery.addSprinkler(27.5 * TILE_SIZE, 27 * TILE_SIZE, 2.7);

      // Fluttering Pale-Gold Moths orbiting sunbeams
      for (const [mx, my] of [[15 * TILE_SIZE, 52 * TILE_SIZE], [28 * TILE_SIZE, 40 * TILE_SIZE], [41 * TILE_SIZE, 36 * TILE_SIZE], [28 * TILE_SIZE, 20 * TILE_SIZE], [27 * TILE_SIZE, 9 * TILE_SIZE]]) {
        this.machinery.addMoth(mx, my);
      }

      // Flowering Brass Planters & Warm Golden Lamps
      this.placeFloorProp(this.crystals, 18 * TILE_SIZE, 60 * TILE_SIZE, this.assets.atriumPlanters[0]);
      this.placeFloorProp(this.crystals, 45 * TILE_SIZE, 43 * TILE_SIZE, this.assets.atriumPlanters[0]);
      this.placeFloorProp(this.crystals, 14 * TILE_SIZE, 38 * TILE_SIZE, this.assets.atriumPlanters[0]);
      this.placeFloorProp(this.crystals, 20 * TILE_SIZE, 11 * TILE_SIZE, this.assets.atriumPlanters[0]);

      for (const [lx, ly, drop] of [[8 * TILE_SIZE, 52 * TILE_SIZE, 20], [45 * TILE_SIZE, 38 * TILE_SIZE, 20], [27 * TILE_SIZE, 20 * TILE_SIZE, 20], [28 * TILE_SIZE, 4 * TILE_SIZE, 18]]) {
        this.placeLamp(lx, ly, drop, this.assets.brassLamp);
      }

      this.placeTerminal('log_atr_a', 20 * TILE_SIZE, 60 * TILE_SIZE, 'CONSERVATORY 12-A', ['MORNING SUNLIGHT DETECTED!', 'APPROACH FERNS TO UNFURL THEM', 'AND RIDE DIAGONAL GANTRY LIFTS.']);
      this.placeTerminal('log_atr_b', 20 * TILE_SIZE, 11 * TILE_SIZE, 'SKYLIGHT DOME 12-B', ['ALL LOWER SECTORS SYNCHRONIZED.', 'TOUCH THE BROADCAST SPIRE TO', 'TRANSMIT DAWN RECOVERY SIGNAL.']);

      [[12 * TILE_SIZE, 50.5 * TILE_SIZE], [49 * TILE_SIZE, 42.5 * TILE_SIZE], [12 * TILE_SIZE, 37.5 * TILE_SIZE], [48 * TILE_SIZE, 22.5 * TILE_SIZE], [35 * TILE_SIZE, 10.5 * TILE_SIZE]].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.7 });
      });

      for (const [vx, vy, links] of [[12 * TILE_SIZE, 6 * TILE_SIZE, 14], [42 * TILE_SIZE, 6 * TILE_SIZE, 15], [20 * TILE_SIZE, 3 * TILE_SIZE, 12], [34 * TILE_SIZE, 3 * TILE_SIZE, 11]]) {
        this.placeAnchoredChain(vx, vy, links, false, true, false);
      }
    }
  }
  GAME.LevelBuilder = LevelBuilder;
})();