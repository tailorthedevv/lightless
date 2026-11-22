(() => {
  'use strict';

  const GAME = (window.GAME = window.GAME || {});
  const {
    PIXEL_W,
    PIXEL_H,
    TILE_SIZE,
    BIOME_PALETTES,
    SeededRNG,
    hash2D,
    clamp,
    lerp
  } = GAME;

  // =========================================================================
  // 1. VERLET PHYSICS SYSTEM (ANCHORED CHAINS, VINES, CABLES & GRASS/SPORES)
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

    addHangingChain(x, anchorY, links, segLen = 5, hasWeight = false, isVine = false) {
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
        type: isVine ? 'vine' : 'chain',
        anchorX: x,
        anchorY,
        nodes,
        segLen,
        hasWeight,
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
        nodes,
        segLen,
        hasWeight: false,
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

    update(dt, time, player) {
      const damping = 0.985;
      const gravity = 440 * dt * dt;
      const px = player.x + player.w * 0.5;
      const py = player.y + player.h * 0.5;

      for (const chain of this.chains) {
        const nodes = chain.nodes;
        const windAmp = chain.type === 'cable' ? 14 : 26;
        const wind =
          (Math.sin(time * 1.45 + chain.phase) * 0.65 +
            Math.sin(time * 3.1 + chain.phase * 1.7) * 0.35) *
          windAmp *
          dt *
          dt;

        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (n.pinned) continue;
          const vx = (n.x - n.ox) * damping;
          const vy = (n.y - n.oy) * damping;
          n.ox = n.x;
          n.oy = n.y;
          n.x += vx + wind * (0.4 + 0.6 * (i / nodes.length));
          n.y += vy + gravity;

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
        const windTarget = Math.sin(time * 2.1 + blade.x * 0.07 + blade.phase) * 0.22;
        const dx = blade.x - px;
        const dy = blade.y - (player.y + player.h);
        let playerPush = 0;
        if (Math.abs(dx) < 11 && Math.abs(dy) < 10) {
          const dir = dx >= 0 ? 1 : -1;
          playerPush = dir * (1 - Math.abs(dx) / 11) * 0.95 + (player.vx / 130) * 0.45;
        }
        const target = clamp(windTarget + playerPush, -1.05, 1.05);
        const force = (target - blade.angle) * 42;
        blade.vel = (blade.vel + force * dt) * 0.86;
        blade.angle += blade.vel * dt * 8;
      }
    }

    render(ctx, camX, camY, assets, biome) {
      const vineDark = biome === 'sector07' ? '#156159' : (biome === 'sector09' ? '#26181a' : '#1c5c46');
      const vineTip = biome === 'sector07' ? '#33e6c8' : (biome === 'sector09' ? '#4d332d' : '#38a86b');

      for (const chain of this.chains) {
        const nodes = chain.nodes;
        if (chain.type === 'cable') {
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
          // Draw riveted ceiling anchor plate flush on solid ceiling
          const ax = Math.round(chain.anchorX - camX);
          const ay = Math.round(chain.anchorY - camY);
          if (assets && assets.anchorPlate) {
            ctx.drawImage(assets.anchorPlate, ax - 5, ay - 1);
          }

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
        if (bx < -4 || bx > PIXEL_W + 4 || by < -8 || by > PIXEL_H + 8) continue;
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
  // 2. ATMOSPHERIC PARTICLE SYSTEM (MOTES, EMBERS, STEAM, DRIPS, SHOCKWAVES)
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

    spawnParticle(x, y, vx, vy, life, color, gravity = 0, size = 1) {
      this.particles.push({ x, y, vx, vy, life, maxLife: life, color, gravity, size });
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
          x,
          y,
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
          x,
          y,
          Math.cos(ang) * spd,
          Math.sin(ang) * spd,
          big ? 0.55 + Math.random() * 0.55 : 0.45,
          cols[i % cols.length],
          0,
          big && i % 3 === 0 ? 2 : 1
        );
      }
      this.shockwaves.push({
        x,
        y,
        r: 4,
        maxR: big ? 96 : 38,
        life: big ? 0.85 : 0.55,
        maxLife: big ? 0.85 : 0.55,
        color: big ? '#ffffff' : orbColor
      });
    }

    update(dt, time, level, audio) {
      const orb = level.orb;
      const vents = level.machinery ? level.machinery.steamVents : [];

      for (const m of this.motes) {
        m.x += (m.vx + Math.sin(time * 0.8 + m.phase) * 5.5) * dt;
        m.y += (m.vy + Math.cos(time * 0.6 + m.phase) * 2.5) * dt;

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

        // Steam vents gently push nearby dust motes
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

      // Emit lamp embers / bio spores
      for (const lamp of level.lamps) {
        if (Math.random() < dt * 4.5) {
          this.spawnEmber(lamp.x + 10, lamp.y + 15, level.biome);
        }
      }

      // Sector 09 rising geothermal furnace embers from bottom sumps
      if (level.biome === 'sector09' && Math.random() < dt * 16) {
        this.spawnEmber(60 + Math.random() * (this.worldW - 120), this.worldH - 42, 'sector09');
      }

      // Falling ceiling drips splashing into basins
      for (const drip of level.drips) {
        drip.timer -= dt;
        if (drip.timer <= 0) {
          drip.timer = 1.6 + Math.random() * 2.8;
          drip.active = true;
          drip.cy = drip.y;
          drip.vy = 15;
        }
        if (drip.active) {
          drip.vy += 260 * dt;
          drip.cy += drip.vy * dt;
          if (drip.cy >= drip.targetY) {
            drip.active = false;
            this.spawnWaterSplash(drip.x, drip.targetY, 3);
            if (Math.random() < 0.42 && audio) audio.playWaterDrip();
          }
        }
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const s = this.shockwaves[i];
        s.life -= dt;
        if (s.life <= 0) {
          this.shockwaves.splice(i, 1);
          continue;
        }
        const prog = 1 - s.life / s.maxLife;
        s.r = lerp(3, s.maxR, 1 - Math.pow(1 - prog, 2));
      }

      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.life -= dt;
        if (r.life <= 0) {
          this.ripples.splice(i, 1);
          continue;
        }
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

      for (const drip of level.drips) {
        if (!drip.active) continue;
        const dx = Math.round(drip.x - camX);
        const dy = Math.round(drip.cy - camY);
        ctx.fillStyle = this.palette.waterHighlight;
        ctx.fillRect(dx, dy - 1, 1, 2);
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
  // 3. MOVING MACHINERY SYSTEM (ELEVATORS, GONDOLAS, TURBINES, STEAM VENTS)
  // =========================================================================
  class MachinerySystem {
    constructor() {
      this.elevators = [];
      this.gondolas = [];
      this.turbines = [];
      this.steamVents = [];
    }

    clear() {
      this.elevators = [];
      this.gondolas = [];
      this.turbines = [];
      this.steamVents = [];
    }

    addElevator(spec) {
      const startY = spec.startAtTop ? spec.topY : spec.bottomY;
      this.elevators.push({
        id: spec.id,
        x: spec.x,
        y: startY,
        prevX: spec.x,
        prevY: startY,
        w: 48,
        h: 10,
        topY: spec.topY,
        bottomY: spec.bottomY,
        anchorY: spec.anchorY,
        cwX: spec.cwX,
        cwTopY: spec.cwTopY,
        cwBottomY: spec.cwBottomY,
        mode: spec.mode || 'cycle', // 'cycle' or 'exit'
        requiresCore: !!spec.requiresCore,
        unlocked: !spec.requiresCore,
        travelTime: spec.travelTime || 2.8,
        pauseTime: spec.pauseTime || 1.2,
        timer: spec.phaseOffset || 0,
        dir: spec.startAtTop ? 1 : -1,
        state: 'docked', // 'docked', 'moving', 'locked', 'ascending_exit'
        exitCharge: 0,
        exitTriggered: false,
        wheelAngle: 0,
        dx: 0,
        dy: 0
      });
    }

    addGondola(spec) {
      const startX = spec.startX !== undefined ? spec.startX : spec.minX;
      const carY = spec.trackY + 10 + spec.dropLen;
      const deckY = carY + 14;
      this.gondolas.push({
        id: spec.id,
        leftWallX: spec.leftWallX,
        rightWallX: spec.rightWallX,
        trackY: spec.trackY,
        minX: spec.minX,
        maxX: spec.maxX,
        dropLen: spec.dropLen,
        x: startX,
        y: deckY,
        prevX: startX,
        prevY: deckY,
        w: 44,
        h: 8,
        travelTime: spec.travelTime || 3.4,
        pauseTime: spec.pauseTime || 0.9,
        timer: spec.phaseOffset || 0,
        dir: 1,
        state: 'docked',
        dx: 0,
        dy: 0
      });
    }

    addTurbine(x, y, speed = 5.5, phase = 0) {
      this.turbines.push({
        x,
        y,
        speed,
        phase,
        lightPulse: 1.0
      });
    }

    addSteamVent(x, y, dirX, dirY, period = 4.2, duration = 1.25, phase = 0) {
      this.steamVents.push({
        x,
        y,
        dirX,
        dirY,
        period,
        duration,
        timer: phase,
        active: false,
        justFired: false
      });
    }

    getPlatforms() {
      const list = [];
      for (const e of this.elevators) list.push(e);
      for (const g of this.gondolas) list.push(g);
      return list;
    }

    update(dt, level, player, particles, audio, camera, onTriggerExit) {
      const coreActive = level.orb ? level.orb.activated : true;

      // 1. Update Counterweighted Freight Elevators
      for (const e of this.elevators) {
        e.prevX = e.x;
        e.prevY = e.y;
        e.unlocked = !e.requiresCore || coreActive;

        if (e.mode === 'exit') {
          if (!e.unlocked) {
            e.state = 'locked';
          } else if (e.state === 'ascending_exit') {
            const speed = 64;
            e.y = Math.max(e.topY, e.y - speed * dt);
            e.wheelAngle -= dt * 7;
            e.exitCharge += dt;
            if (Math.random() < dt * 8) {
              particles.spawnParticle(
                e.x + (Math.random() < 0.5 ? 4 : 43),
                e.y - 6,
                (Math.random() - 0.5) * 20,
                -15,
                0.2,
                '#ffaa33',
                60,
                1
              );
            }
            if (e.exitCharge >= 0.95 && !e.exitTriggered) {
              e.exitTriggered = true;
              if (onTriggerExit) onTriggerExit();
            }
          } else {
            e.state = 'docked';
            // Engage exit lift when player stands firmly on unlocked deck
            const onDeck =
              player.grounded &&
              player.ridingPlatformId === e.id &&
              Math.abs(player.y + player.h - e.y) <= 2;
            if (onDeck) {
              e.timer += dt;
              if (e.timer >= 0.28) {
                e.state = 'ascending_exit';
                e.exitCharge = 0;
                camera.shake(1.4);
                particles.spawnMachineryClunk(e.x + e.w * 0.5, e.y + 4);
                if (audio && audio.playMachineryStart) audio.playMachineryStart();
              }
            } else {
              e.timer = 0;
            }
          }
        } else {
          // Continuous automated cycle elevator (Sector 09 Reactor)
          e.timer += dt;
          if (e.state === 'docked') {
            if (e.timer >= e.pauseTime) {
              e.timer = 0;
              e.state = 'moving';
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
              e.y = toY;
              e.dir = -e.dir;
              e.timer = 0;
              e.state = 'docked';
              particles.spawnMachineryClunk(e.x + e.w * 0.5, e.y + 4);
              camera.shake(0.9);
              if (audio && audio.playMachineryDock) audio.playMachineryDock();
            }
          }
        }

        e.dx = e.x - e.prevX;
        e.dy = e.y - e.prevY;
      }

      // 2. Update Horizontal Monorail Gondolas
      for (const g of this.gondolas) {
        g.prevX = g.x;
        g.prevY = g.y;
        g.timer += dt;

        if (g.state === 'docked') {
          if (g.timer >= g.pauseTime) {
            g.timer = 0;
            g.state = 'moving';
            if (audio && audio.playMachineryStart) audio.playMachineryStart();
          }
        } else {
          const u = clamp(g.timer / g.travelTime, 0, 1);
          const smooth = 0.5 - 0.5 * Math.cos(u * Math.PI);
          const fromX = g.dir > 0 ? g.minX : g.maxX;
          const toX = g.dir > 0 ? g.maxX : g.minX;
          g.x = lerp(fromX, toX, smooth);

          if (u >= 1) {
            g.x = toX;
            g.dir = -g.dir;
            g.timer = 0;
            g.state = 'docked';
            particles.spawnMachineryClunk(g.x + g.w * 0.5, g.y + 4);
            if (audio && audio.playMachineryDock) audio.playMachineryDock();
          }
        }

        g.dx = g.x - g.prevX;
        g.dy = g.y - g.prevY;
      }

      // 3. Update Background Exhaust Turbines (light-slicing pulse)
      for (const tb of this.turbines) {
        tb.phase += tb.speed * dt;
        tb.lightPulse = 0.58 + 0.42 * Math.sin(tb.phase * 6);
      }

      // 4. Update Periodic Steam Vents
      for (const sv of this.steamVents) {
        const wasActive = sv.active;
        sv.timer = (sv.timer + dt) % sv.period;
        sv.active = sv.timer < sv.duration;
        if (sv.active) {
          if (!wasActive && audio && audio.playSteamHiss) {
            audio.playSteamHiss();
          }
          if (Math.random() < dt * 28) {
            particles.spawnSteamPlume(sv.x, sv.y, sv.dirX, sv.dirY);
          }
        }
      }
    }

    // Zero-slip riding helper: transfers platform delta onto player before player physics
    carryPlayer(player, level) {
      if (!player.grounded || !player.ridingPlatformId) return;
      const plat = this.getPlatforms().find(p => p.id === player.ridingPlatformId);
      if (!plat) {
        player.ridingPlatformId = null;
        return;
      }

      if (plat.dx !== 0) {
        player.x += plat.dx;
        player.resolveHorizontal(level);
      }
      if (plat.dy !== 0) {
        player.y += plat.dy;
      }
    }

    renderBackground(ctx, camX, camY, assets) {
      // Draw recessed background turbines BEFORE tiles/props
      for (const tb of this.turbines) {
        const tx = Math.round(tb.x - camX);
        const ty = Math.round(tb.y - camY);
        if (tx < -40 || tx > PIXEL_W + 40 || ty < -40 || ty > PIXEL_H + 40) continue;
        const fIdx = Math.floor((tb.phase / (Math.PI * 2)) * 24) % assets.turbineFrames.length;
        ctx.drawImage(assets.turbineFrames[(fIdx + 4) % 4], tx, ty);
      }
    }

    renderForeground(ctx, camX, camY, assets, time, alpha = 1) {
      // 1. Render Counterweighted Elevators
      for (const e of this.elevators) {
        const rx = Math.round(lerp(e.prevX, e.x, alpha) - camX);
        const ry = Math.round(lerp(e.prevY, e.y, alpha) - camY);
        const ay = Math.round(e.anchorY - camY);

        const pulleyCx = rx + 24;
        const pulleyCy = ay + 9;
        const cwScreenX = Math.round(e.cwX - camX);

        // Travel progress t in [0..1] (0 = topY, 1 = bottomY)
        const span = Math.max(1, e.bottomY - e.topY);
        const t = clamp((lerp(e.prevY, e.y, alpha) - e.topY) / span, 0, 1);
        const cwScreenY = Math.round(lerp(e.cwBottomY, e.cwTopY, t) - camY);

        // Parallel counterweight vertical guide rail & bolts
        ctx.fillStyle = '#0c121c';
        ctx.fillRect(cwScreenX + 5, ay, 4, Math.round(e.bottomY - e.anchorY + 14));
        ctx.fillStyle = '#253347';
        ctx.fillRect(cwScreenX + 6, ay, 2, Math.round(e.bottomY - e.anchorY + 14));

        // Taut steel hoist cables from ceiling pulley to cage top & counterweight
        ctx.fillStyle = '#5a7394';
        ctx.fillRect(pulleyCx, pulleyCy + 5, 1, Math.max(0, ry - 14 - (pulleyCy + 5)));
        ctx.fillStyle = '#3b4e69';
        ctx.fillRect(cwScreenX + 6, ay + 4, 1, Math.max(0, cwScreenY - (ay + 4)));
        // Horizontal overhead transfer cable to counterweight pulley
        const minC = Math.min(pulleyCx, cwScreenX + 6);
        const maxC = Math.max(pulleyCx, cwScreenX + 6);
        ctx.fillStyle = '#485f7d';
        ctx.fillRect(minC, ay + 3, maxC - minC + 1, 1);

        // Bolted Counterweight Pulley & Main Overhead Pulley Wheel
        ctx.drawImage(assets.anchorPlate, cwScreenX + 2, ay - 1);
        const fIdx = Math.abs(Math.floor((e.wheelAngle / (Math.PI * 2)) * 16)) % 4;
        ctx.drawImage(assets.pulleyWheelFrames[fIdx], pulleyCx - 9, ay);

        // Counterweight block
        ctx.drawImage(assets.counterweight, cwScreenX, cwScreenY);

        // Elevator cage body (drawn at ry - 14 so deck top is exact at ry)
        ctx.drawImage(assets.elevatorCage, rx, ry - 14);

        // Status Beacon Strips (magenta = locked, amber = moving, emerald = docked)
        let beaconCol = '#38e89e'; // emerald docked
        if (e.state === 'locked') {
          beaconCol = Math.sin(time * 5.2) > 0 ? '#ff66d9' : '#7b2cbf';
        } else if (e.state === 'moving' || e.state === 'ascending_exit') {
          beaconCol = Math.sin(time * 12) > 0 ? '#ffaa33' : '#ff5500';
        }
        for (const bc of assets.elevatorCage.beaconCoords) {
          ctx.fillStyle = '#090d14';
          ctx.fillRect(rx + bc.x - 1, ry - 14 + bc.y - 1, 4, 5);
          ctx.fillStyle = beaconCol;
          ctx.fillRect(rx + bc.x, ry - 14 + bc.y, 2, 3);
        }
      }

      // 2. Render Horizontal Monorail Gondolas
      for (const g of this.gondolas) {
        const lx = Math.round(g.leftWallX - camX);
        const rxWall = Math.round(g.rightWallX - camX);
        const ty = Math.round(g.trackY - camY);
        const gx = Math.round(lerp(g.prevX, g.x, alpha) - camX);
        const gy = Math.round(lerp(g.prevY, g.y, alpha) - camY);

        // Continuous riveted steel I-beam rail bolted into both stone walls
        const railW = Math.max(0, rxWall - lx);
        ctx.fillStyle = '#090d14';
        ctx.fillRect(lx, ty - 1, railW, 6);
        ctx.fillStyle = '#2c3d52';
        ctx.fillRect(lx, ty, railW, 4);
        ctx.fillStyle = '#607a9c';
        ctx.fillRect(lx, ty, railW, 1);
        for (let rx = lx + 6; rx < rxWall - 4; rx += 12) {
          ctx.fillStyle = '#8fa9c7';
          ctx.fillRect(rx, ty + 2, 1, 1);
        }
        // Bolted end-wall brackets
        ctx.drawImage(assets.wallBracketLeft, lx - 2, ty - 2);
        ctx.drawImage(assets.wallBracketRight, rxWall - 12, ty - 2);

        // Trolley on I-beam rail + suspension rod + gondola car
        const trolleyX = gx + Math.round(g.w * 0.5) - 10;
        ctx.drawImage(assets.gondolaTrolley, trolleyX, ty - 3);

        // Suspension steel cable down to gondola car yoke
        const rodX = gx + Math.round(g.w * 0.5);
        const carTopY = gy - 14;
        ctx.fillStyle = '#0c111a';
        ctx.fillRect(rodX - 1, ty + 7, 3, Math.max(0, carTopY - (ty + 7) + 2));
        ctx.fillStyle = '#5c7594';
        ctx.fillRect(rodX, ty + 7, 1, Math.max(0, carTopY - (ty + 7) + 2));

        ctx.drawImage(assets.gondolaCar, gx, carTopY);
      }

      // 3. Render Pressurized Steam Vent Valves
      for (const sv of this.steamVents) {
        const sx = Math.round(sv.x - camX - 7);
        const sy = Math.round(sv.y - camY - 7);
        ctx.drawImage(assets.steamValve, sx, sy);
        if (sv.active) {
          ctx.fillStyle = '#ffaa33';
          ctx.fillRect(sx + 6, sy + 6, 2, 2);
        }
      }
    }
  }
  GAME.MachinerySystem = MachinerySystem;

  // =========================================================================
  // 4. LEVEL BUILDER (3 INTERCONNECTED BIOME SECTORS + ZERO FLOATING PROPS)
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
      this.shards = [];
      this.crates = [];
      this.signs = [];
      this.pipes = [];
      this.drips = [];
      this.puddles = [];
      this.hazards = [];
      this.terminals = [];
      this.conduitLights = [];
      this.orb = null;
      this.exitGate = null;
      this.spawn = { x: 6 * TILE_SIZE, y: 36 * TILE_SIZE };
    }

    // -----------------------------------------------------------------------
    // RAYCAST ANCHORING HELPERS (ZERO FLOATING PROPS)
    // -----------------------------------------------------------------------
    isSolidAtTile(c, r) {
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return true;
      return this.grid[r][c] === '#';
    }

    isTrussAtTile(c, r) {
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
      return this.grid[r][c] === 'T';
    }

    isHazardAtTile(c, r) {
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
      return this.grid[r][c] === 'H';
    }

    // Trace upward tile-by-tile until hitting solid '#' block -> returns ceiling underside Y
    findAnchorUp(wx, wy, includeTruss = false) {
      const c = clamp(Math.floor(wx / TILE_SIZE), 0, this.cols - 1);
      let r = clamp(Math.floor(wy / TILE_SIZE), 0, this.rows - 1);
      while (r > 0) {
        if (this.isSolidAtTile(c, r) || (includeTruss && this.isTrussAtTile(c, r))) {
          return (r + 1) * TILE_SIZE;
        }
        r--;
      }
      return TILE_SIZE;
    }

    // Trace downward tile-by-tile until hitting solid '#' block -> returns floor top Y
    findAnchorDown(wx, wy) {
      const c = clamp(Math.floor(wx / TILE_SIZE), 0, this.cols - 1);
      let r = clamp(Math.floor(wy / TILE_SIZE), 0, this.rows - 1);
      while (r < this.rows - 1) {
        if (this.isSolidAtTile(c, r)) {
          return r * TILE_SIZE;
        }
        r++;
      }
      return (this.rows - 1) * TILE_SIZE;
    }

    // Trace horizontally until hitting solid '#' wall -> returns wall surface X
    findAnchorSide(wx, wy, dir) {
      const r = clamp(Math.floor(wy / TILE_SIZE), 0, this.rows - 1);
      let c = clamp(Math.floor(wx / TILE_SIZE), 0, this.cols - 1);
      while (c > 0 && c < this.cols - 1) {
        if (this.isSolidAtTile(c, r)) {
          return dir < 0 ? (c + 1) * TILE_SIZE : c * TILE_SIZE;
        }
        c += dir;
      }
      return dir < 0 ? TILE_SIZE : (this.cols - 1) * TILE_SIZE;
    }

    hasSolidFloorSpan(wx, floorY, width) {
      const r = Math.floor(floorY / TILE_SIZE);
      const c0 = Math.floor(wx / TILE_SIZE);
      const c1 = Math.floor((wx + width - 1) / TILE_SIZE);
      for (let c = c0; c <= c1; c++) {
        if (!this.isSolidAtTile(c, r) || this.isSolidAtTile(c, r - 1)) return false;
      }
      return true;
    }

    // -----------------------------------------------------------------------
    // ANCHORED PROP PLACEMENT HELPERS
    // -----------------------------------------------------------------------
    placeSign(key, approxX, approxY, flickerSeed) {
      const sprite = this.assets.signs[key];
      if (!sprite) return;
      const mount = sprite.mountType;

      if (mount === 'floor') {
        // Snap onto solid '#' ground verifying BOTH legs rest firmly on '#'
        const legL = sprite.legOffsets[0];
        const legR = sprite.legOffsets[1];
        let x = Math.round(approxX);
        const floorY = this.findAnchorDown(x + (legL + legR) * 0.5, approxY);
        // Ensure both leg columns are solid at floorY; nudge slightly if needed
        for (let shift = 0; shift <= 16; shift += 2) {
          for (const dir of [1, -1]) {
            const testX = x + shift * dir;
            const cL = Math.floor((testX + legL) / TILE_SIZE);
            const cR = Math.floor((testX + legR) / TILE_SIZE);
            const rF = Math.floor(floorY / TILE_SIZE);
            if (
              this.isSolidAtTile(cL, rF) &&
              this.isSolidAtTile(cR, rF) &&
              !this.isSolidAtTile(cL, rF - 1) &&
              !this.isSolidAtTile(cR, rF - 1)
            ) {
              this.signs.push({
                type: key,
                x: testX,
                y: floorY - sprite.height,
                sprite,
                flickerSeed,
                rods: null
              });
              return;
            }
          }
        }
      } else if (mount === 'ceiling') {
        const x = Math.round(approxX);
        const y = Math.round(approxY);
        const rods = sprite.legOffsets.map((offX) => {
          const rx = x + offX;
          const anchorY = this.findAnchorUp(rx, y);
          return { x: rx, topY: anchorY, botY: y + 2 };
        });
        this.signs.push({
          type: key,
          x,
          y,
          sprite,
          flickerSeed,
          rods
        });
      } else if (mount === 'wall') {
        const dir = sprite.wallSide === 'left' ? -1 : 1;
        const wallX = this.findAnchorSide(approxX, approxY + 18, dir);
        const x = sprite.wallSide === 'left' ? wallX : wallX - sprite.width;
        this.signs.push({
          type: key,
          x,
          y: Math.round(approxY),
          sprite,
          flickerSeed,
          rods: null
        });
      }
    }

    placeLamp(cx, approxY, dropLen, sprite) {
      const ceilingY = this.findAnchorUp(cx, approxY);
      const targetY = ceilingY + dropLen;
      const wallLeftX = this.findAnchorSide(cx, targetY + 6, -1);
      const wallRightX = this.findAnchorSide(cx, targetY + 6, 1);

      // If ceiling is very far (> 92px) and a solid wall is nearby, bolt to wall bracket arm!
      if (dropLen > 92 && (cx - wallLeftX <= 22 || wallRightX - cx <= 22)) {
        if (cx - wallLeftX <= wallRightX - cx) {
          this.lamps.push({
            x: wallLeftX + 10 - 10,
            y: targetY,
            anchorType: 'wallLeft',
            anchorX: wallLeftX,
            anchorY: targetY - 2,
            sprite,
            seed: cx * 0.13 + targetY
          });
        } else {
          this.lamps.push({
            x: wallRightX - 10 - 10,
            y: targetY,
            anchorType: 'wallRight',
            anchorX: wallRightX,
            anchorY: targetY - 2,
            sprite,
            seed: cx * 0.13 + targetY
          });
        }
      } else {
        this.lamps.push({
          x: Math.round(cx - 10),
          y: targetY,
          anchorType: 'ceiling',
          anchorX: Math.round(cx),
          anchorY: ceilingY,
          sprite,
          seed: cx * 0.13 + ceilingY
        });
      }
    }

    placeFloorProp(list, approxX, approxY, sprite) {
      const w = sprite.width;
      const h = sprite.height;
      const floorY = this.findAnchorDown(approxX + w * 0.5, approxY);
      let x = Math.round(approxX);
      // Ensure full footprint sits cleanly on solid floor without cliff overhang
      for (let shift = 0; shift <= 20; shift += 2) {
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

    placeTerminal(id, approxX, approxY, title, lines) {
      const spr = this.assets.terminalSprite;
      const floorY = this.findAnchorDown(approxX + 10, approxY);
      let x = Math.round(approxX);
      for (let shift = 0; shift <= 24; shift += 2) {
        for (const dir of [1, -1]) {
          const testX = x + shift * dir;
          if (this.hasSolidFloorSpan(testX + 2, floorY, spr.width - 4)) {
            this.terminals.push({
              id,
              x: testX,
              y: floorY - spr.height,
              floorY,
              title,
              lines,
              read: false,
              sprite: spr
            });
            return;
          }
        }
      }
    }

    placeAnchoredChain(wx, wy, links, hasWeight, isVine) {
      const anchorY = this.findAnchorUp(wx, wy);
      this.verlet.addHangingChain(wx, anchorY, links, 5, hasWeight, isVine);
    }

    // -----------------------------------------------------------------------
    // BUILD SECTOR BY INDEX (0 = SECTOR 04, 1 = SECTOR 07, 2 = SECTOR 09)
    // -----------------------------------------------------------------------
    build(sectorIndex = 0) {
      this.sectorIndex = clamp(sectorIndex, 0, 2);
      const biomes = ['sector04', 'sector07', 'sector09'];
      this.biome = biomes[this.sectorIndex];
      this.palette = BIOME_PALETTES[this.biome];

      this.verlet.clear();
      this.machinery.clear();
      this.lamps = [];
      this.crystals = [];
      this.shards = [];
      this.crates = [];
      this.signs = [];
      this.pipes = [];
      this.drips = [];
      this.puddles = [];
      this.hazards = [];
      this.terminals = [];
      this.conduitLights = [];
      this.orb = null;
      this.exitGate = null;

      if (this.sectorIndex === 0) this.buildSector04();
      else if (this.sectorIndex === 1) this.buildSector07();
      else this.buildSector09();

      this.computeTileMasks();
      this.populateGrassAndSpores();
    }

    computeTileMasks() {
      this.masks = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));
      this.variants = Array.from({ length: this.rows }, () => new Uint8Array(this.cols));

      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (this.grid[r][c] === '#') {
            const n = this.isSolidAtTile(c, r - 1) ? 1 : 0;
            const e = this.isSolidAtTile(c + 1, r) ? 2 : 0;
            const s = this.isSolidAtTile(c, r + 1) ? 4 : 0;
            const w = this.isSolidAtTile(c - 1, r) ? 8 : 0;
            this.masks[r][c] = n | e | s | w;
            this.variants[r][c] = Math.floor(hash2D(c, r, 313 + this.sectorIndex * 41) * this.assets.tileVariants);
          } else if (this.grid[r][c] === 'T') {
            this.variants[r][c] = Math.floor(hash2D(c, r, 555 + this.sectorIndex * 17) * 4);
          }
        }
      }
    }

    populateGrassAndSpores() {
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
                const gCol = grassCols[(c + i) % grassCols.length];
                this.verlet.addGrassBlade(gx, r * TILE_SIZE, gh, gCol, (i === 0 && glowTip) ? glowTip : null);
              }
            }
          }
        }
      }
    }

    parseMap(rawRows) {
      this.grid = rawRows.map((row) => row.padEnd(this.cols, '#').slice(0, this.cols).split(''));
    }

    // -----------------------------------------------------------------------
    // SECTOR 04: FLOODED SUBWAY (ACT I)
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
        '###..................................####..................######........###', // 07
        '###............................TTTTT.....................................###', // 08
        '###...#####.....................................................###......###', // 09
        '###..................................................TTTTTT..............###', // 10
        '###...............TTTTTTT...............TTTTTTT..........................###', // 11
        '###......................................................................###', // 12
        '###......................................................................###', // 13
        '###........#####.................#####..............TTTTT................###', // 14
        '###..###.................................................................###', // 15
        '###........................................###..............TTTTT........###', // 16
        '###...............................#####..................................###', // 17
        '###............########################################..........######..###', // 18 (Subway Deck + Lift Landing)
        '###......TTTT...............................................TTTTT........###', // 19
        '###......................................................................###', // 20
        '###..###..........................................###....................###', // 21
        '###.........................................................TTTTT........###', // 22
        '###...........###........................................................###', // 23
        '###..####.......................................#####....................###', // 24
        '###.......TTTT......######....................................TTTTT......###', // 25
        '###...............................................................######.###', // 26
        '###......................................................................###', // 27
        '###.............###...................................TTTTT..............###', // 28
        '###.....TTTT.............................................................###', // 29
        '###......................................................................###', // 30
        '###.........................................................TTTTT........###', // 31
        '###......................####............................................###', // 32
        '###.......TTTT.................TTTTTTTTTTTTTTTTT.........................###', // 33
        '###.........................................................TTTTT........###', // 34
        '###......................................................................###', // 35
        '###...................##.............###...............##................###', // 36
        '###.............####.....................................................###', // 37
        '###..........###...........WWWWWWWWWWWWWWWWWWWWWW..........TTTTT.........###', // 38
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);

      this.spawn = { x: 6.2 * TILE_SIZE, y: 37 * TILE_SIZE };

      // Anchored Signs (Floor + Ceiling-Suspended)
      this.placeSign('subway', 19.5 * TILE_SIZE, 18 * TILE_SIZE, 42);
      this.placeSign('tunnel', 36.0 * TILE_SIZE, 22 * TILE_SIZE, 99);

      // Central Energy Core Orb (anchored cleanly to ceiling above col 35.5)
      const orbX = 35.5 * TILE_SIZE;
      const orbY = 14.5 * TILE_SIZE;
      this.orb = {
        x: orbX,
        y: orbY,
        anchorY: this.findAnchorUp(orbX, orbY),
        sprite: this.assets.energyOrb,
        activated: false,
        pulseTimer: 0,
        chargeAnim: 0
      };
      for (const cx of [17, 29, 41, 51]) {
        this.conduitLights.push({ x: cx * TILE_SIZE, y: 18 * TILE_SIZE - 2 });
      }

      // East Counterweighted Freight Elevator (locked until Energy Core restored!)
      // Positioned cleanly in shaft cols 63..66 between row 18 deck and row 7 exit loft
      const elevX = 63 * TILE_SIZE;
      const elevAnchorY = this.findAnchorUp(elevX + 24, 7 * TILE_SIZE);
      this.machinery.addElevator({
        id: 's04_exit_lift',
        x: elevX,
        topY: 7 * TILE_SIZE,
        bottomY: 18 * TILE_SIZE,
        anchorY: elevAnchorY,
        cwX: elevX - 16,
        cwTopY: elevAnchorY + 18,
        cwBottomY: 16 * TILE_SIZE,
        mode: 'exit',
        requiresCore: true,
        startAtTop: false
      });

      // Background Spinning Turbine inside flooded vault
      this.machinery.addTurbine(23 * TILE_SIZE, 31 * TILE_SIZE, 5.2, 0.4);
      // Periodic Steam Vent on lower pipe bulkhead
      this.machinery.addSteamVent(14.5 * TILE_SIZE, 36 * TILE_SIZE, 0, -1, 4.5, 1.2, 1.0);

      // Anchored Crimson Cage Lamps
      const lampSpecs = [
        [8.5 * TILE_SIZE,  6 * TILE_SIZE,  20],
        [16.0 * TILE_SIZE, 10 * TILE_SIZE, 28],
        [49.0 * TILE_SIZE, 10 * TILE_SIZE, 28],
        [68.0 * TILE_SIZE, 5 * TILE_SIZE,  24],
        [60.0 * TILE_SIZE, 20 * TILE_SIZE, 22],
        [8.0 * TILE_SIZE,  32 * TILE_SIZE, 24],
        [27.0 * TILE_SIZE, 27 * TILE_SIZE, 22],
        [47.0 * TILE_SIZE, 26 * TILE_SIZE, 22]
      ];
      for (const [lx, ly, drop] of lampSpecs) {
        this.placeLamp(lx, ly, drop, this.assets.cageLamp);
      }

      // Anchored Floor Crystals, Crates & Interactive Lore Terminals
      this.placeFloorProp(this.crystals, 4.0 * TILE_SIZE, 37 * TILE_SIZE, this.assets.crystals[0]);
      this.placeFloorProp(this.crystals, 17.5 * TILE_SIZE, 36 * TILE_SIZE, this.assets.crystals[1]);
      this.placeFloorProp(this.crystals, 49.0 * TILE_SIZE, 37 * TILE_SIZE, this.assets.crystals[0]);
      this.placeFloorProp(this.crystals, 68.5 * TILE_SIZE, 24 * TILE_SIZE, this.assets.crystals[0]);
      this.placeFloorProp(this.crystals, 4.5 * TILE_SIZE, 23 * TILE_SIZE, this.assets.crystals[1]);
      this.placeFloorProp(this.crystals, 34.5 * TILE_SIZE, 6 * TILE_SIZE, this.assets.crystals[1]);

      this.placeFloorProp(this.crates, 10.2 * TILE_SIZE, 37 * TILE_SIZE, this.assets.crates[0]);
      this.placeFloorProp(this.crates, 11.9 * TILE_SIZE, 37 * TILE_SIZE, this.assets.crates[1]);
      this.placeFloorProp(this.crates, 15.2 * TILE_SIZE, 17 * TILE_SIZE, this.assets.crates[0]);
      this.placeFloorProp(this.crates, 43.2 * TILE_SIZE, 17 * TILE_SIZE, this.assets.crates[0]);
      this.placeFloorProp(this.crates, 6.8 * TILE_SIZE, 8 * TILE_SIZE, this.assets.crates[1]);

      // 2 Interactive Lore Terminals
      this.placeTerminal(
        'log_04_a',
        8.6 * TILE_SIZE,
        37 * TILE_SIZE,
        'UNIT-04 DIAGNOSTIC LOG',
        [
          'POWER GRID OFFLINE - 412 DAYS',
          'RESTORE SECTOR 04 CORE ABOVE',
          'TO UNLOCK EAST FREIGHT LIFT.'
        ]
      );
      this.placeTerminal(
        'log_04_b',
        31.2 * TILE_SIZE,
        17 * TILE_SIZE,
        'TRANSIT DISPATCH 04-B',
        [
          'SUBWAY LINES FLOODED AT B4.',
          'UPPER PUMP SECTOR 07 OVERRUN',
          'BY BIOLUMINESCENT FLORA.'
        ]
      );

      // 5 Collectible Ruby Shards
      const shardCoords = [
        [5.5 * TILE_SIZE,  7.5 * TILE_SIZE],
        [35.0 * TILE_SIZE, 5.5 * TILE_SIZE],
        [70.0 * TILE_SIZE, 24.5 * TILE_SIZE],
        [4.5 * TILE_SIZE,  22.5 * TILE_SIZE],
        [52.5 * TILE_SIZE, 37.5 * TILE_SIZE]
      ];
      shardCoords.forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.9 });
      });

      // Wall Pipes
      for (const [px, py] of [
        [13 * TILE_SIZE, 34 * TILE_SIZE],
        [28 * TILE_SIZE, 33 * TILE_SIZE],
        [50 * TILE_SIZE, 14 * TILE_SIZE],
        [57 * TILE_SIZE, 28 * TILE_SIZE]
      ]) {
        this.pipes.push({ x: px, y: py, sprite: this.assets.pipeFixtures[0] });
      }

      // Shallow Puddle & Drips
      this.puddles.push({ x: 27 * TILE_SIZE, y: 38 * TILE_SIZE + 9, w: 22 * TILE_SIZE, h: 7 });
      for (const dx of [29, 34, 39, 44, 47]) {
        const x = dx * TILE_SIZE + 6;
        this.drips.push({
          x,
          y: this.findAnchorUp(x, 22 * TILE_SIZE),
          cy: 20 * TILE_SIZE,
          vy: 0,
          targetY: 38 * TILE_SIZE + 9,
          timer: Math.random() * 2.5,
          active: false
        });
      }

      // Anchored Hanging Chains & Vines (traced strictly to ceiling '#' tiles)
      for (const [cx, cy, links, wt] of [
        [4.5 * TILE_SIZE,  6 * TILE_SIZE, 9, true],
        [12.5 * TILE_SIZE, 6 * TILE_SIZE, 10, false],
        [23.5 * TILE_SIZE, 6 * TILE_SIZE, 11, false],
        [44.0 * TILE_SIZE, 6 * TILE_SIZE, 10, true],
        [58.5 * TILE_SIZE, 6 * TILE_SIZE, 13, false],
        [19.5 * TILE_SIZE, 22 * TILE_SIZE, 10, false],
        [31.5 * TILE_SIZE, 22 * TILE_SIZE, 12, true],
        [41.5 * TILE_SIZE, 22 * TILE_SIZE, 10, false],
        [7.5 * TILE_SIZE,  28 * TILE_SIZE, 9, false]
      ]) {
        this.placeAnchoredChain(cx, cy, links, wt, false);
      }

      for (const [vx, vy, links] of [
        [17.5 * TILE_SIZE, 22 * TILE_SIZE, 7],
        [25.5 * TILE_SIZE, 22 * TILE_SIZE, 9],
        [38.0 * TILE_SIZE, 22 * TILE_SIZE, 8],
        [49.5 * TILE_SIZE, 22 * TILE_SIZE, 10]
      ]) {
        this.placeAnchoredChain(vx, vy, links, false, true);
      }

      // Anchored Overhead Sagging Power Cables (both ends anchored on '#' walls/ceilings)
      for (const [x0, y0, x1, y1] of [
        [3 * TILE_SIZE,  5.5 * TILE_SIZE, 18 * TILE_SIZE, 5.5 * TILE_SIZE],
        [21 * TILE_SIZE, 5.5 * TILE_SIZE, 45 * TILE_SIZE, 5.5 * TILE_SIZE],
        [48 * TILE_SIZE, 5.5 * TILE_SIZE, 73 * TILE_SIZE, 5.5 * TILE_SIZE],
        [3 * TILE_SIZE,  30 * TILE_SIZE,  17 * TILE_SIZE, 29 * TILE_SIZE],
        [28 * TILE_SIZE, 32.5 * TILE_SIZE, 48 * TILE_SIZE, 24.5 * TILE_SIZE]
      ]) {
        this.verlet.addPowerCable(x0, y0, x1, y1, 1.15, 14);
      }
    }

    // -----------------------------------------------------------------------
    // SECTOR 07: HYDRO-PUMP & MYCELIUM CONDUITS (ACT II)
    // -----------------------------------------------------------------------
    buildSector07() {
      this.parseMap([
        '############################################################################', // 00
        '############################################################################', // 01
        '###......................................................................###', // 02
        '###........####..........................................................###', // 03
        '###.......................................................###............###', // 04
        '###....................#####.............................................###', // 05
        '###..............................................###...........#######...###', // 06
        '###......................................................................###', // 07
        '###...#####..............................................................###', // 08
        '###......................................#####...........................###', // 09
        '###...............TTTTTT.................................................###', // 10
        '###..................................................TTTTTT..............###', // 11
        '###..........................#####.......................................###', // 12
        '###......................................................................###', // 13
        '###.........######.......................................................###', // 14
        '###...........................................#########........#######...###', // 15
        '###...####...............................................TTTTT...........###', // 16
        '###......................................................................###', // 17
        '###.......................................####...........................###', // 18
        '###....................####.................................TTTTT........###', // 19
        '###........#####.........................................................###', // 20
        '###..................................................###.................###', // 21
        '###.........................................................TTTTT........###', // 22
        '###......................................................................###', // 23
        '###...###.....................######.....................................###', // 24
        '###..................................................#####...............###', // 25
        '###..........#####..........................................TTTTT........###', // 26
        '###......................................................................###', // 27
        '###......................................###.............................###', // 28
        '###.........................................................TTTTT........###', // 29
        '###......................................................................###', // 30
        '###..............................................###.....................###', // 31
        '###..#########..............................................######.......###', // 32
        '###......................................................................###', // 33
        '###......................................................................###', // 34
        '###......................................................................###', // 35
        '###............###........####........####...............................###', // 36
        '###......................................................................###', // 37
        '###............HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH............###', // 38 (Coolant Sump Hazard)
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);

      this.spawn = { x: 5.0 * TILE_SIZE, y: 31 * TILE_SIZE };

      // Wall-Bracketed Bio-Pump Sign bolted onto left cavern wall (cols 0..2 -> x = 48)
      this.placeSign('biolab', 5 * TILE_SIZE, 27.5 * TILE_SIZE, 131);

      // Hydro Core Orb suspended in upper-center chamber (cols 27..31, row 12)
      const orbX = 28.5 * TILE_SIZE;
      const orbY = 8.5 * TILE_SIZE;
      this.orb = {
        x: orbX,
        y: orbY,
        anchorY: this.findAnchorUp(orbX, orbY),
        sprite: this.assets.bioOrb,
        activated: false,
        pulseTimer: 0,
        chargeAnim: 0
      };
      for (const cx of [16, 26, 31, 47]) {
        this.conduitLights.push({ x: cx * TILE_SIZE, y: 12 * TILE_SIZE - 2 });
      }

      // 2 Horizontal Tracked Cargo Gondolas over coolant basins!
      // Lower Bay Gondola (cols 14..38, track at row 27, deck at row 31)
      const g1Left = this.findAnchorSide(22 * TILE_SIZE, 26.5 * TILE_SIZE, -1);
      const g1Right = this.findAnchorSide(22 * TILE_SIZE, 26.5 * TILE_SIZE, 1);
      this.machinery.addGondola({
        id: 's07_gondola_low',
        leftWallX: g1Left,
        rightWallX: g1Right,
        trackY: 27 * TILE_SIZE,
        minX: 14.5 * TILE_SIZE,
        maxX: 35.5 * TILE_SIZE,
        dropLen: 38,
        travelTime: 3.4,
        pauseTime: 0.9,
        phaseOffset: 0
      });

      // Upper Bay Gondola (cols 36..54, track at row 12, deck at row 15)
      const g2Left = this.findAnchorSide(45 * TILE_SIZE, 11.5 * TILE_SIZE, -1);
      const g2Right = this.findAnchorSide(45 * TILE_SIZE, 11.5 * TILE_SIZE, 1);
      this.machinery.addGondola({
        id: 's07_gondola_high',
        leftWallX: g2Left,
        rightWallX: g2Right,
        trackY: 12 * TILE_SIZE,
        minX: 33 * TILE_SIZE,
        maxX: 43 * TILE_SIZE,
        dropLen: 26,
        travelTime: 2.8,
        pauseTime: 0.8,
        phaseOffset: 1.2
      });

      // Geothermal Transfer Exit Elevator (cols 62..65, deck row 15 -> row 6)
      const elevX = 63 * TILE_SIZE;
      const elevAnchorY = this.findAnchorUp(elevX + 24, 6 * TILE_SIZE);
      this.machinery.addElevator({
        id: 's07_exit_lift',
        x: elevX,
        topY: 6 * TILE_SIZE,
        bottomY: 15 * TILE_SIZE,
        anchorY: elevAnchorY,
        cwX: elevX - 16,
        cwTopY: elevAnchorY + 14,
        cwBottomY: 13 * TILE_SIZE,
        mode: 'exit',
        requiresCore: true,
        startAtTop: false
      });

      // Huge Spinning Hydro-Turbines slicing volumetric shafts
      this.machinery.addTurbine(23 * TILE_SIZE, 22 * TILE_SIZE, 6.2, 0.2);
      this.machinery.addTurbine(46 * TILE_SIZE, 20 * TILE_SIZE, -5.6, 1.4);

      // Pressurized Coolant Steam Vents
      this.machinery.addSteamVent(15 * TILE_SIZE, 26 * TILE_SIZE, 0, -1, 3.8, 1.15, 0.5);
      this.machinery.addSteamVent(52 * TILE_SIZE, 25 * TILE_SIZE, 0, -1, 4.4, 1.25, 2.1);

      // Anchored Cyan Bio-Lamps
      for (const [lx, ly, drop] of [
        [9.0 * TILE_SIZE,  25 * TILE_SIZE, 22],
        [22.0 * TILE_SIZE, 25 * TILE_SIZE, 20],
        [43.0 * TILE_SIZE, 22 * TILE_SIZE, 20],
        [66.0 * TILE_SIZE, 23 * TILE_SIZE, 24],
        [29.0 * TILE_SIZE, 5 * TILE_SIZE,  22],
        [52.0 * TILE_SIZE, 6 * TILE_SIZE,  20],
        [68.0 * TILE_SIZE, 6 * TILE_SIZE,  22]
      ]) {
        this.placeLamp(lx, ly, drop, this.assets.bioLamp);
      }

      // Bioluminescent Spore Mushroom Clusters
      this.placeFloorProp(this.crystals, 11.2 * TILE_SIZE, 31 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crystals, 27.5 * TILE_SIZE, 35 * TILE_SIZE, this.assets.bioMushrooms[1]);
      this.placeFloorProp(this.crystals, 39.2 * TILE_SIZE, 35 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crystals, 66.0 * TILE_SIZE, 31 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crystals, 10.5 * TILE_SIZE, 13 * TILE_SIZE, this.assets.bioMushrooms[1]);
      this.placeFloorProp(this.crystals, 26.2 * TILE_SIZE, 11 * TILE_SIZE, this.assets.bioMushrooms[0]);

      this.placeFloorProp(this.crates, 4.0 * TILE_SIZE, 31 * TILE_SIZE, this.assets.crates[1]);
      this.placeFloorProp(this.crates, 50.0 * TILE_SIZE, 14 * TILE_SIZE, this.assets.crates[0]);

      // 2 Interactive Lore Terminals
      this.placeTerminal(
        'log_07_a',
        8.5 * TILE_SIZE,
        31 * TILE_SIZE,
        'HYDRO BAY 07-A',
        [
          'COOLANT SUMP CONTAMINATED.',
          'AVOID GREEN CORROSIVE BASINS.',
          'USE OVERHEAD MONORAIL GONODLAS.'
        ]
      );
      this.placeTerminal(
        'log_07_b',
        47.0 * TILE_SIZE,
        14 * TILE_SIZE,
        'MYCOLOGY REPORT 07-B',
        [
          'SPORES HARVESTED REACTOR HEAT.',
          'RESTORE HYDRO CORE LEFT OF HERE',
          'TO ENGAGE GEOTHERMAL LIFT.'
        ]
      );

      // 5 Collectible Shards
      [
        [4.5 * TILE_SIZE,  15 * TILE_SIZE],
        [4.5 * TILE_SIZE,  7 * TILE_SIZE],
        [28.5 * TILE_SIZE, 34.5 * TILE_SIZE],
        [52.5 * TILE_SIZE, 23.5 * TILE_SIZE],
        [15.5 * TILE_SIZE, 12.5 * TILE_SIZE]
      ].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 1.1 });
      });

      // Pipe Fixtures
      for (const [px, py] of [
        [12 * TILE_SIZE, 28 * TILE_SIZE],
        [54 * TILE_SIZE, 29 * TILE_SIZE],
        [24 * TILE_SIZE, 14 * TILE_SIZE]
      ]) {
        this.pipes.push({ x: px, y: py, sprite: this.assets.pipeFixtures[0] });
      }

      // Coolant Hazard Sump Basin + Shallow Reflective Surface
      this.hazards.push({ x: 15 * TILE_SIZE, y: 38 * TILE_SIZE + 6, w: 46 * TILE_SIZE, h: 10 });
      this.puddles.push({ x: 15 * TILE_SIZE, y: 38 * TILE_SIZE + 6, w: 46 * TILE_SIZE, h: 10 });

      for (const dx of [19, 25, 33, 42, 50]) {
        const x = dx * TILE_SIZE + 8;
        this.drips.push({
          x,
          y: this.findAnchorUp(x, 28 * TILE_SIZE),
          cy: 28 * TILE_SIZE,
          vy: 0,
          targetY: 38 * TILE_SIZE + 6,
          timer: Math.random() * 2.2,
          active: false
        });
      }

      // Anchored Chains, Bio-Vines & Power Cables
      for (const [cx, cy, links, wt] of [
        [7 * TILE_SIZE,  6 * TILE_SIZE,  9, false],
        [21 * TILE_SIZE, 6 * TILE_SIZE,  10, true],
        [37 * TILE_SIZE, 6 * TILE_SIZE,  11, false],
        [55 * TILE_SIZE, 6 * TILE_SIZE,  10, true],
        [40 * TILE_SIZE, 22 * TILE_SIZE, 9, false]
      ]) {
        this.placeAnchoredChain(cx, cy, links, wt, false);
      }
      for (const [vx, vy, links] of [
        [13 * TILE_SIZE, 6 * TILE_SIZE, 8],
        [33 * TILE_SIZE, 6 * TILE_SIZE, 9],
        [48 * TILE_SIZE, 6 * TILE_SIZE, 7],
        [25 * TILE_SIZE, 22 * TILE_SIZE, 8]
      ]) {
        this.placeAnchoredChain(vx, vy, links, false, true);
      }
      for (const [x0, y0, x1, y1] of [
        [3 * TILE_SIZE, 5 * TILE_SIZE, 20 * TILE_SIZE, 5 * TILE_SIZE],
        [25 * TILE_SIZE, 5 * TILE_SIZE, 58 * TILE_SIZE, 4.5 * TILE_SIZE],
        [15 * TILE_SIZE, 20.5 * TILE_SIZE, 43 * TILE_SIZE, 18.5 * TILE_SIZE]
      ]) {
        this.verlet.addPowerCable(x0, y0, x1, y1, 1.15, 14);
      }
    }

    // -----------------------------------------------------------------------
    // SECTOR 09: GEOTHERMAL REACTOR & SURFACE SPIRE (ACT III FINALE)
    // -----------------------------------------------------------------------
    buildSector09() {
      this.parseMap([
        '###..............................########................................###', // 00 (Open Sky Shaft!)
        '###......................................................................###', // 01
        '###......................................................................###', // 02
        '###......................................................................###', // 03
        '###......................................................................###', // 04
        '###......................................................................###', // 05
        '###......................................................................###', // 06
        '###...............TTTTT..................................................###', // 07
        '###.........................##################...........................###', // 08 (Surface Relay Spire)
        '###......................................................................###', // 09
        '###......#####.......................................TTTTT...............###', // 10
        '###......................................................................###', // 11
        '###.........................................................#######......###', // 12
        '###...................#####..............................................###', // 13
        '###...............................................######.................###', // 14
        '###......................................................................###', // 15
        '###............TTTTT.....................................................###', // 16
        '###......................................................................###', // 17
        '###......................................#####...........................###', // 18
        '###...#####.................................................TTTTT........###', // 19
        '###......................................................................###', // 20
        '###..........................#####.......................................###', // 21
        '###...............................................#####..................###', // 22
        '###.............######...................................................###', // 23
        '###.........................................................#####........###', // 24
        '###...TTTTT..............................................................###', // 25
        '###......................................................................###', // 26
        '###.......................#########......................................###', // 27
        '###........................................TTTTT.........................###', // 28
        '###...........#####......................................................###', // 29
        '###.......................................................######.........###', // 30
        '###......................................................................###', // 31
        '###......................................................................###', // 32
        '###..###.................................................................###', // 33
        '###......................................................................###', // 34
        '###...........#####......................................................###', // 35
        '###..##########..................######........................###.......###', // 36
        '###......................................................................###', // 37
        '###............HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH......###', // 38 (Molten Geothermal Sump)
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);

      this.spawn = { x: 4.5 * TILE_SIZE, y: 34 * TILE_SIZE };

      // Anchored Reactor Floor Sign on wide lower titanium deck (cols 5..14, row 36)
      this.placeSign('reactor', 6.5 * TILE_SIZE, 36 * TILE_SIZE, 211);

      // Timed Counterweighted Elevator #1 (Lower Left Shaft: col 17.5, row 36 <-> row 27)
      const e1X = 18 * TILE_SIZE;
      const e1AnchorY = this.findAnchorUp(e1X + 24, 24 * TILE_SIZE);
      this.machinery.addElevator({
        id: 's09_lift_1',
        x: e1X,
        topY: 27 * TILE_SIZE,
        bottomY: 36 * TILE_SIZE,
        anchorY: e1AnchorY,
        cwX: e1X - 16,
        cwTopY: e1AnchorY + 12,
        cwBottomY: 34 * TILE_SIZE,
        mode: 'cycle',
        travelTime: 2.3,
        pauseTime: 1.0,
        startAtTop: false
      });

      // Mid-Reactor Horizontal Monorail Gondola (across magma chasm, track row 18, deck row 22)
      const g1Left = this.findAnchorSide(35 * TILE_SIZE, 18.5 * TILE_SIZE, -1);
      const g1Right = this.findAnchorSide(35 * TILE_SIZE, 18.5 * TILE_SIZE, 1);
      this.machinery.addGondola({
        id: 's09_gondola_mid',
        leftWallX: g1Left,
        rightWallX: g1Right,
        trackY: 18 * TILE_SIZE,
        minX: 25 * TILE_SIZE,
        maxX: 43 * TILE_SIZE,
        dropLen: 36,
        travelTime: 3.1,
        pauseTime: 0.9,
        phaseOffset: 0.4
      });

      // Timed Counterweighted Elevator #2 (East Reactor Tower: col 56, row 25 <-> row 14)
      const e2X = 56 * TILE_SIZE;
      const e2AnchorY = this.findAnchorUp(e2X + 24, 13 * TILE_SIZE);
      this.machinery.addElevator({
        id: 's09_lift_2',
        x: e2X,
        topY: 14 * TILE_SIZE,
        bottomY: 25 * TILE_SIZE,
        anchorY: e2AnchorY,
        cwX: e2X + 50,
        cwTopY: e2AnchorY + 14,
        cwBottomY: 24 * TILE_SIZE,
        mode: 'cycle',
        travelTime: 2.5,
        pauseTime: 1.0,
        startAtTop: true
      });

      // Surface Broadcast Relay Gate & Apex Core on top spire deck (cols 28..45, row 8)
      const gateX = 36 * TILE_SIZE;
      const gateFloorY = 8 * TILE_SIZE;
      this.exitGate = {
        x: gateX - 17,
        y: gateFloorY - this.assets.exitGateSprite.height,
        cx: gateX,
        cy: gateFloorY - 22,
        activated: false,
        sprite: this.assets.exitGateSprite
      };

      this.orb = {
        x: 32 * TILE_SIZE,
        y: 5.2 * TILE_SIZE,
        anchorY: 1 * TILE_SIZE,
        sprite: this.assets.reactorOrb,
        activated: false,
        pulseTimer: 0,
        chargeAnim: 0
      };
      for (const cx of [29, 34, 39, 44]) {
        this.conduitLights.push({ x: cx * TILE_SIZE, y: 8 * TILE_SIZE - 2 });
      }

      // Giant Reactor Exhaust Turbines
      this.machinery.addTurbine(29 * TILE_SIZE, 29 * TILE_SIZE, 7.2, 0);
      this.machinery.addTurbine(41 * TILE_SIZE, 11 * TILE_SIZE, -6.5, 1.1);

      // Periodic Pressurized Steam Vents
      this.machinery.addSteamVent(14 * TILE_SIZE, 34.5 * TILE_SIZE, 0, -1, 3.6, 1.1, 0);
      this.machinery.addSteamVent(30 * TILE_SIZE, 26.5 * TILE_SIZE, 0, -1, 4.0, 1.15, 1.8);
      this.machinery.addSteamVent(52 * TILE_SIZE, 21.5 * TILE_SIZE, 0, -1, 3.5, 1.05, 0.9);

      // Anchored Amber Reactor Lamps
      for (const [lx, ly, drop] of [
        [6.5 * TILE_SIZE,  25 * TILE_SIZE, 22],
        [28 * TILE_SIZE,   22 * TILE_SIZE, 20],
        [47 * TILE_SIZE,   21 * TILE_SIZE, 22],
        [62 * TILE_SIZE,   16 * TILE_SIZE, 20],
        [24 * TILE_SIZE,   5 * TILE_SIZE,  18],
        [46 * TILE_SIZE,   5 * TILE_SIZE,  18],
        [68 * TILE_SIZE,   4 * TILE_SIZE,  20]
      ]) {
        this.placeLamp(lx, ly, drop, this.assets.amberLamp);
      }

      // Crates & Terminals
      this.placeFloorProp(this.crates, 12.2 * TILE_SIZE, 35 * TILE_SIZE, this.assets.crates[0]);
      this.placeFloorProp(this.crates, 42.0 * TILE_SIZE, 7 * TILE_SIZE, this.assets.crates[1]);

      this.placeTerminal(
        'log_09_a',
        5.5 * TILE_SIZE,
        35 * TILE_SIZE,
        'REACTOR CONTROL 09-A',
        [
          'THERMAL PRESSURE CRITICAL.',
          'RIDE PISTON LIFTS & GONDOLAS',
          'TO REACH SURFACE SPIRE ABOVE.'
        ]
      );
      this.placeTerminal(
        'log_09_b',
        28.5 * TILE_SIZE,
        7 * TILE_SIZE,
        'SURFACE RELAY 09-B',
        [
          'NIGHT SKY DETECTED ABOVE.',
          'ACTIVATE CORE & BROADCAST SPIRE',
          'TO COMPLETE NETWORK RECOVERY.'
        ]
      );

      // 5 Collectible Shards
      [
        [34.5 * TILE_SIZE, 34.5 * TILE_SIZE],
        [5.5 * TILE_SIZE,  17.5 * TILE_SIZE],
        [66.0 * TILE_SIZE, 28.5 * TILE_SIZE],
        [9.5 * TILE_SIZE,  8.5 * TILE_SIZE],
        [66.0 * TILE_SIZE, 10.5 * TILE_SIZE]
      ].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.8 });
      });

      // Pipe Fixtures
      for (const [px, py] of [
        [24 * TILE_SIZE, 29 * TILE_SIZE],
        [49 * TILE_SIZE, 24 * TILE_SIZE],
        [22 * TILE_SIZE, 12 * TILE_SIZE]
      ]) {
        this.pipes.push({ x: px, y: py, sprite: this.assets.pipeFixtures[0] });
      }

      // Molten Geothermal Hazard Sump
      this.hazards.push({ x: 15 * TILE_SIZE, y: 38 * TILE_SIZE + 5, w: 52 * TILE_SIZE, h: 11 });
      this.puddles.push({ x: 15 * TILE_SIZE, y: 38 * TILE_SIZE + 5, w: 52 * TILE_SIZE, h: 11 });

      // Anchored Heavy Chains & High-Voltage Cables
      for (const [cx, cy, links, wt] of [
        [10 * TILE_SIZE, 6 * TILE_SIZE, 11, true],
        [49 * TILE_SIZE, 6 * TILE_SIZE, 9, false],
        [66 * TILE_SIZE, 6 * TILE_SIZE, 10, true],
        [24 * TILE_SIZE, 20 * TILE_SIZE, 8, false]
      ]) {
        this.placeAnchoredChain(cx, cy, links, wt, false);
      }

      for (const [x0, y0, x1, y1] of [
        [3 * TILE_SIZE,  6 * TILE_SIZE,  25 * TILE_SIZE, 5 * TILE_SIZE],
        [45 * TILE_SIZE, 6 * TILE_SIZE,  73 * TILE_SIZE, 5 * TILE_SIZE],
        [3 * TILE_SIZE,  29 * TILE_SIZE, 18 * TILE_SIZE, 27 * TILE_SIZE]
      ]) {
        this.verlet.addPowerCable(x0, y0, x1, y1, 1.14, 14);
      }
    }
  }
  GAME.LevelBuilder = LevelBuilder;
})();