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
  // 1. VERLET PHYSICS SYSTEM (CHAINS, SPARKING BROKEN CABLES, VINES, GRASS)
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

    addHangingChain(x, anchorY, links, segLen = 5, hasWeight = false, isVine = false, broken = false) {
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
        type: broken ? 'broken_cable' : (isVine ? 'vine' : 'chain'),
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

    update(dt, time, player) {
      const damping = 0.985;
      const gravity = 440 * dt * dt;
      const px = player.x + player.w * 0.5;
      const py = player.y + player.h * 0.5;

      for (const chain of this.chains) {
        const nodes = chain.nodes;
        const windAmp = chain.type === 'cable' ? 14 : (chain.type === 'broken_cable' ? 30 : 24);
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
          // Bolted junction boxes at both anchored cable ends
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
          // Exposed copper core tip
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
  // 2. ATMOSPHERIC PARTICLE SYSTEM (MOTES, SPARKS, BUBBLES, STEAM, SHOCKWAVES)
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

    spawnElectricSparks(x, y, count = 6) {
      const cols = ['#ffffff', '#8ce8ff', '#ffaa33'];
      for (let i = 0; i < count; i++) {
        this.spawnParticle(
          x,
          y,
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

      // Live sparking broken cables inside VerletSystem
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

      // Liquid coolant & molten magma bubbling simulation
      if (level.puddles && level.puddles.length > 0 && level.biome !== 'sector04') {
        if (Math.random() < dt * 11) {
          const pd = level.puddles[Math.floor(Math.random() * level.puddles.length)];
          this.liquidBubbles.push({
            x: pd.x + 6 + Math.random() * Math.max(8, pd.w - 12),
            y: pd.y + pd.h - 2,
            targetY: pd.y + 1,
            vy: -9 - Math.random() * 8,
            size: Math.random() < 0.35 ? 2 : 1,
            color: level.biome === 'sector07' ? '#99fff0' : '#ffd875'
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
        if (Math.random() < dt * 4.5) {
          this.spawnEmber(lamp.x + 10, lamp.y + 15, level.biome);
        }
      }

      if (level.biome === 'sector09' && Math.random() < dt * 16) {
        this.spawnEmber(60 + Math.random() * (this.worldW - 120), this.worldH - 42, 'sector09');
      }

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

      for (const b of this.liquidBubbles) {
        const bx = Math.round(b.x - camX);
        const by = Math.round(b.y - camY);
        ctx.fillStyle = b.color;
        ctx.fillRect(bx, by, b.size, b.size);
      }

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
  // 3. MOVING MACHINERY SYSTEM (ELEVATORS, GONDOLAS, PISTONS, DOORS, DRONES)
  // =========================================================================
  class MachinerySystem {
    constructor() {
      this.elevators = [];
      this.gondolas = [];
      this.turbines = [];
      this.steamVents = [];
      this.pistons = [];
      this.switches = [];
      this.blastDoors = [];
      this.drones = [];
    }

    clear() {
      this.elevators = [];
      this.gondolas = [];
      this.turbines = [];
      this.steamVents = [];
      this.pistons = [];
      this.switches = [];
      this.blastDoors = [];
      this.drones = [];
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
        mode: spec.mode || 'cycle',
        requiresCore: !!spec.requiresCore,
        unlocked: !spec.requiresCore,
        travelTime: spec.travelTime || 2.8,
        pauseTime: spec.pauseTime || 1.2,
        timer: spec.phaseOffset || 0,
        dir: spec.startAtTop ? 1 : -1,
        state: 'docked',
        exitCharge: 0,
        exitTriggered: false,
        wheelAngle: 0,
        dx: 0,
        dy: 0
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
        leftWallX: spec.leftWallX,
        rightWallX: spec.rightWallX,
        trackY: spec.trackY,
        minX,
        maxX,
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

    addTurbine(x, y, anchorTopY, anchorBotY, speed = 5.5, phase = 0) {
      this.turbines.push({
        x,
        y,
        anchorTopY,
        anchorBotY,
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
        active: false
      });
    }

    addPiston(x, floorY, stroke = 14, speed = 2.6, phase = 0) {
      this.pistons.push({
        x,
        y: floorY - 40,
        floorY,
        stroke,
        speed,
        phase,
        offset: 0,
        wasBottom: false
      });
    }

    addSwitchAndDoor(switchX, switchFloorY, doorX, doorTopY, doorId) {
      this.switches.push({
        id: `sw_${doorId}`,
        doorId,
        x: switchX,
        y: switchFloorY - 10,
        pressed: false
      });
      this.blastDoors.push({
        id: doorId,
        x: doorX,
        y: doorTopY,
        openProgress: 0,
        opening: false
      });
    }

    addDrone(baseX, baseY, rangeX = 36, rangeY = 6, speed = 1.4, phase = 0) {
      this.drones.push({
        baseX,
        baseY,
        x: baseX,
        y: baseY,
        rangeX,
        rangeY,
        speed,
        phase,
        facing: 1,
        frameIdx: 0
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
      const time = (level._time = (level._time || 0) + dt);

      // 1. Update Counterweighted Elevators
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

        g.dx = g.x - eDeltaZero(g.prevX);
        g.dx = g.x - g.prevX;
        g.dy = g.y - g.prevY;
      }

      // 3. Update Background Turbines
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
          if (!wasActive && audio && audio.playSteamHiss) audio.playSteamHiss();
          if (Math.random() < dt * 28) particles.spawnSteamPlume(sv.x, sv.y, sv.dirX, sv.dirY);
        }
      }

      // 5. Update Hydraulic Pumping Pistons
      for (const p of this.pistons) {
        p.phase += p.speed * dt;
        const cycle = 0.5 - 0.5 * Math.cos(p.phase);
        p.offset = Math.round(cycle * p.stroke);
        const atBottom = cycle > 0.94;
        if (atBottom && !p.wasBottom) {
          particles.spawnSteamPlume(p.x + 11, p.floorY - 2, (Math.random() - 0.5) * 0.6, -0.6);
        }
        p.wasBottom = atBottom;
      }

      // 6. Update Pressure Switches & Sliding Armored Blast Doors
      const px = player.x + player.w * 0.5;
      const py = player.y + player.h;
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
          if (Math.random() < dt * 14) {
            particles.spawnDustPuff(d.x + 8, d.y + 46 - d.openProgress * 42, 1);
          }
        }
      }

      // 7. Update Hovering Maintenance Drones
      for (const dr of this.drones) {
        const oldX = dr.x;
        dr.phase += dr.speed * dt;
        dr.x = dr.baseX + Math.sin(dr.phase) * dr.rangeX;
        dr.y = dr.baseY + Math.sin(dr.phase * 2.1) * dr.rangeY;
        if (Math.abs(dr.x - oldX) > 0.02) dr.facing = dr.x >= oldX ? 1 : -1;
        dr.frameIdx = Math.floor(time * 9 + dr.phase) % 4;
        if (Math.random() < dt * 12) {
          particles.spawnParticle(dr.x + 8, dr.y + 12, (Math.random() - 0.5) * 8, 22, 0.22, '#8ce8ff', 10, 1);
        }
      }

      // 8. Update Swinging Pendulum Lamps (wind + player passing impulse)
      for (const lamp of level.lamps) {
        if (lamp.anchorType !== 'ceiling') continue;
        const windForce = Math.sin(time * 1.8 + lamp.seed) * 0.9;
        const targetAng = windForce * 0.055;
        let impulse = 0;
        if (Math.hypot(px - (lamp.x + 10), player.y + 9 - (lamp.y + 14)) < 18) {
          impulse = clamp(player.vx * 0.014, -1.8, 1.8);
        }
        lamp.angVel = (lamp.angVel + (targetAng - lamp.angle) * 26 * dt + impulse * dt * 18) * 0.96;
        lamp.angle = clamp(lamp.angle + lamp.angVel * dt, -0.22, 0.22);
        lamp.x = lamp.anchorX - 10 + Math.sin(lamp.angle) * lamp.cordLen;
        lamp.y = lamp.anchorY + Math.cos(lamp.angle) * lamp.cordLen;
      }
    }

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

    renderBackground(ctx, camX, camY, assets, time = 0) {
      // Anchored Wall Bulkhead Pipe Columns (drawn floor-to-ceiling behind props)
      // And Anchored Background Exhaust Turbines inside structural duct columns
      for (const tb of this.turbines) {
        const tx = Math.round(tb.x - camX);
        const ty = Math.round(tb.y - camY);
        if (tx < -44 || tx > PIXEL_W + 44 || ty < -44 || ty > PIXEL_H + 44) continue;

        // Vertical riveted steel duct housing anchoring turbine to floor & ceiling
        const topY = Math.round(tb.anchorTopY - camY);
        const botY = Math.round(tb.anchorBotY - camY);
        ctx.fillStyle = '#070b12';
        ctx.fillRect(tx + 8, topY, 20, Math.max(0, botY - topY));
        ctx.fillStyle = '#182230';
        ctx.fillRect(tx + 10, topY, 16, Math.max(0, botY - topY));
        ctx.fillStyle = '#2d3d54';
        ctx.fillRect(tx + 11, topY, 2, Math.max(0, botY - topY));
        if (assets.anchorPlate) {
          ctx.drawImage(assets.anchorPlate, tx + 13, topY - 1);
          ctx.drawImage(assets.anchorPlate, tx + 13, botY - 4);
        }

        const fIdx = Math.floor((tb.phase / (Math.PI * 2)) * 24) % assets.turbineFrames.length;
        ctx.drawImage(assets.turbineFrames[(fIdx + 4) % 4], tx, ty);
      }
    }

    renderForeground(ctx, camX, camY, assets, time, alpha = 1) {
      // 1. Sliding Blast Doors & Floor Pressure Switches
      for (const sw of this.switches) {
        const sx = Math.round(sw.x - camX);
        const sy = Math.round(sw.y - camY);
        ctx.drawImage(assets.switchFrames[sw.pressed ? 1 : 0], sx, sy);
      }
      for (const d of this.blastDoors) {
        const dx = Math.round(d.x - camX);
        const dy = Math.round(d.y - camY);
        const liftY = Math.round(d.openProgress * 42);
        // Clip door inside shaft so it slides smoothly up into ceiling stone
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

      // 2. Hydraulic Pumping Pistons
      for (const p of this.pistons) {
        const px = Math.round(p.x - camX);
        const py = Math.round(p.y - camY);
        if (px < -28 || px > PIXEL_W + 28) continue;
        // Moving chrome piston head drawn inside base frame
        ctx.drawImage(assets.pistonHead, px, py - 14 + p.offset);
        ctx.drawImage(assets.pistonBase, px, py);
        // Animated sight-strip pulse
        const sr = assets.pistonBase.sightRect;
        const levelH = 3 + Math.round((p.offset / Math.max(1, p.stroke)) * (sr.h - 4));
        ctx.fillStyle = '#33e6c8';
        ctx.fillRect(px + sr.x + 1, py + sr.y + sr.h - levelH, 1, levelH);
      }

      // 3. Counterweighted Elevators
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

      // 4. Horizontal Monorail Gondolas
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
        for (let rx = lx + 6; rx < rxWall - 4; rx += 12) {
          ctx.fillStyle = '#8fa9c7';
          ctx.fillRect(rx, ty + 2, 1, 1);
        }
        ctx.drawImage(assets.wallBracketLeft, lx - 2, ty - 2);
        ctx.drawImage(assets.wallBracketRight, rxWall - 12, ty - 2);

        const trolleyX = gx + Math.round(g.w * 0.5) - 10;
        ctx.drawImage(assets.gondolaTrolley, trolleyX, ty - 3);

        const rodX = gx + Math.round(g.w * 0.5);
        const carTopY = gy - 14;
        ctx.fillStyle = '#0c111a';
        ctx.fillRect(rodX - 1, ty + 7, 3, Math.max(0, carTopY - (ty + 7) + 2));
        ctx.fillStyle = '#5c7594';
        ctx.fillRect(rodX, ty + 7, 1, Math.max(0, carTopY - (ty + 7) + 2));
        ctx.drawImage(assets.gondolaCar, gx, carTopY);
      }

      // 5. Steam Vent Valves
      for (const sv of this.steamVents) {
        const sx = Math.round(sv.x - camX - 7);
        const sy = Math.round(sv.y - camY - 7);
        ctx.drawImage(assets.steamValve, sx, sy);
        if (sv.active) {
          ctx.fillStyle = '#ffaa33';
          ctx.fillRect(sx + 6, sy + 6, 2, 2);
        }
      }

      // 6. Hovering Facility Maintenance Drones
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
  function eDeltaZero(v) { return v; }
  GAME.MachinerySystem = MachinerySystem;

  // =========================================================================
  // 4. LEVEL BUILDER (STRICT JUMP-AUDITED 3 SECTORS + ZERO FLOATING PROPS)
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

    isGridSolid(c, r) {
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return true;
      return this.grid[r][c] === '#';
    }

    // Solid check including active closed Sliding Blast Doors for player physics
    isSolidAtTile(c, r) {
      if (this.isGridSolid(c, r)) return true;
      if (this.machinery && this.machinery.blastDoors.length > 0) {
        const wx = c * TILE_SIZE + 8;
        const wy = r * TILE_SIZE + 8;
        for (const d of this.machinery.blastDoors) {
          if (d.openProgress < 0.72) {
            if (wx >= d.x && wx < d.x + 16 && wy >= d.y && wy < d.y + 48) {
              return true;
            }
          }
        }
      }
      return false;
    }

    isTrussAtTile(c, r) {
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
      return this.grid[r][c] === 'T';
    }

    isHazardAtTile(c, r) {
      if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return false;
      return this.grid[r][c] === 'H';
    }

    // -----------------------------------------------------------------------
    // RAYCAST ANCHORING HELPERS (ZERO FLOATING PROPS)
    // -----------------------------------------------------------------------
    findAnchorUp(wx, wy, includeTruss = false) {
      const c = clamp(Math.floor(wx / TILE_SIZE), 0, this.cols - 1);
      let r = clamp(Math.floor(wy / TILE_SIZE), 0, this.rows - 1);
      while (r > 0) {
        if (this.isGridSolid(c, r) || (includeTruss && this.isTrussAtTile(c, r))) {
          return (r + 1) * TILE_SIZE;
        }
        r--;
      }
      return TILE_SIZE;
    }

    findAnchorDown(wx, wy) {
      const c = clamp(Math.floor(wx / TILE_SIZE), 0, this.cols - 1);
      let r = clamp(Math.floor(wy / TILE_SIZE), 0, this.rows - 1);
      while (r < this.rows - 1) {
        if (this.isGridSolid(c, r)) {
          return r * TILE_SIZE;
        }
        r++;
      }
      return (this.rows - 1) * TILE_SIZE;
    }

    findAnchorSide(wx, wy, dir) {
      const r = clamp(Math.floor(wy / TILE_SIZE), 0, this.rows - 1);
      let c = clamp(Math.floor(wx / TILE_SIZE), 0, this.cols - 1);
      while (c > 0 && c < this.cols - 1) {
        if (this.isGridSolid(c, r)) {
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
        if (!this.isGridSolid(c, r) || this.isGridSolid(c, r - 1)) return false;
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
        const legL = sprite.legOffsets[0];
        const legR = sprite.legOffsets[1];
        const x = Math.round(approxX);
        const floorY = this.findAnchorDown(x + (legL + legR) * 0.5, approxY);
        for (let shift = 0; shift <= 24; shift += 2) {
          for (const dir of [1, -1]) {
            const testX = x + shift * dir;
            const cL = Math.floor((testX + legL) / TILE_SIZE);
            const cR = Math.floor((testX + legR) / TILE_SIZE);
            const rF = Math.floor(floorY / TILE_SIZE);
            if (
              this.isGridSolid(cL, rF) &&
              this.isGridSolid(cR, rF) &&
              !this.isGridSolid(cL, rF - 1) &&
              !this.isGridSolid(cR, rF - 1)
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
        this.signs.push({ type: key, x, y, sprite, flickerSeed, rods });
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

      if (dropLen > 92 && (cx - wallLeftX <= 22 || wallRightX - cx <= 22)) {
        if (cx - wallLeftX <= wallRightX - cx) {
          this.lamps.push({
            x: wallLeftX,
            y: targetY,
            anchorType: 'wallLeft',
            anchorX: wallLeftX,
            anchorY: targetY - 2,
            cordLen: 0,
            angle: 0,
            angVel: 0,
            sprite,
            seed: cx * 0.13 + targetY
          });
        } else {
          this.lamps.push({
            x: wallRightX - 20,
            y: targetY,
            anchorType: 'wallRight',
            anchorX: wallRightX,
            anchorY: targetY - 2,
            cordLen: 0,
            angle: 0,
            angVel: 0,
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
          cordLen: dropLen,
          angle: 0,
          angVel: 0,
          sprite,
          seed: cx * 0.13 + ceilingY
        });
      }
    }

    placeFloorProp(list, approxX, approxY, sprite) {
      const w = sprite.width;
      const h = sprite.height;
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
            this.bioVats.push({
              x: testX,
              y: floorY - 34,
              frames,
              phase: Math.random() * 4
            });
            return;
          }
        }
      }
    }

    placeAnchoredPipe(approxX, approxY) {
      const x = Math.round(approxX);
      const anchorTopY = this.findAnchorUp(x + 16, approxY);
      const anchorBotY = this.findAnchorDown(x + 16, approxY);
      const y = clamp(Math.round(approxY), anchorTopY, Math.max(anchorTopY, anchorBotY - 48));
      this.pipes.push({
        x,
        y,
        anchorTopY,
        anchorBotY,
        frames: this.assets.pipeFixtures
      });
    }

    placeAnchoredTurbine(approxX, approxY, speed = 5.5, phase = 0) {
      const x = Math.round(approxX);
      const y = Math.round(approxY);
      const anchorTopY = this.findAnchorUp(x + 18, y + 18);
      const anchorBotY = this.findAnchorDown(x + 18, y + 18);
      this.machinery.addTurbine(x, y, anchorTopY, anchorBotY, speed, phase);
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
      const ax0 = x0;
      const ay0 = this.findAnchorUp(x0, y0);
      const ax1 = x1;
      const ay1 = this.findAnchorUp(x1, y1);
      this.verlet.addPowerCable(ax0, ay0, ax1, ay1, slack, 14);
    }

    placeTerminal(id, approxX, approxY, title, lines) {
      const spr = this.assets.terminalSprite;
      const floorY = this.findAnchorDown(approxX + 10, approxY);
      const x = Math.round(approxX);
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

    placeAnchoredChain(wx, wy, links, hasWeight, isVine, broken = false) {
      const anchorY = this.findAnchorUp(wx, wy);
      this.verlet.addHangingChain(wx, anchorY, links, 5, hasWeight, isVine, broken);
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
      this.bioVats = [];
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
    // SECTOR 04: FLOODED SUBWAY (ACT I) — STRICTLY REACHABLE <=3 TILE STEPS
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
        '###.............................#######..................................###', // 09 (Shard #2 loft)
        '###...######.............................................................###', // 10 (Shard #1 loft)
        '###......................................................................###', // 11
        '###.........................TTTTTTT..TTTTTT..............................###', // 12
        '###..........#####.......................................................###', // 13
        '###......................................................................###', // 14
        '###..................TTTTTT...................TTTTTT.....................###', // 15
        '###......................................................................###', // 16
        '###.................................#####................................###', // 17 (Orb Dais)
        '###.............#######################################TTTTT###..........###', // 18 (Subway Deck + Lift Deck)
        '###.......TTTTT..........................................................###', // 19
        '###......................................................................###', // 20
        '###........................................................TTTTT.........###', // 21
        '###....TTTTT.............................................................###', // 22
        '###......................................................................###', // 23
        '###...#####....####...................................TTTTT..............###', // 24
        '###......................................................................###', // 25
        '###...............................................................######.###', // 26 (Shard #3 alcove)
        '###.....TTTTT..............................................TTTTT.........###', // 27
        '###......................................................................###', // 28
        '###......................................................................###', // 29
        '###.............#####.................................TTTTT..............###', // 30
        '###......................................................................###', // 31
        '###......................................................................###', // 32
        '###.....TTTTT...........#####..TTTTTTTTTTTTTTTTT...........TTTTT.........###', // 33 (Chasm Bridge)
        '###......................................................................###', // 34
        '###...............................................................#######..###', // 35 (Blast Door Vault Roof)
        '###.............#####..####.......####............####....TTTTT..........###', // 36 (Switch & Piers)
        '###......................................................................###', // 37
        '###........................WWWWWWWWWWWWWWWWWWWWWW........................###', // 38 (Shallow Reflective Basin)
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);

      this.spawn = { x: 6.2 * TILE_SIZE, y: 37 * TILE_SIZE };

      // Anchored Floor & Ceiling Signs
      this.placeSign('subway', 19.0 * TILE_SIZE, 18 * TILE_SIZE, 42);
      this.placeSign('tunnel', 36.0 * TILE_SIZE, 22 * TILE_SIZE, 99);

      // Central Energy Core Orb anchored cleanly above row 17 dais
      const orbX = 35.5 * TILE_SIZE;
      const orbY = 14.2 * TILE_SIZE;
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

      // East Counterweighted Freight Elevator (cols 63..65, clear shaft up to row 2)
      const elevX = 63 * TILE_SIZE;
      const elevAnchorY = this.findAnchorUp(elevX + 24, 7 * TILE_SIZE);
      this.machinery.addElevator({
        id: 's04_exit_lift',
        x: elevX,
        topY: 7 * TILE_SIZE,
        bottomY: 18 * TILE_SIZE,
        anchorY: elevAnchorY,
        cwX: 67 * TILE_SIZE,
        cwTopY: elevAnchorY + 18,
        cwBottomY: 16 * TILE_SIZE,
        mode: 'exit',
        requiresCore: true,
        startAtTop: false
      });

      // Anchored Background Turbine, Hydraulic Piston, Steam Vent, Bio-Vat & Drone
      this.placeAnchoredTurbine(23 * TILE_SIZE, 28 * TILE_SIZE, 5.2, 0.4);
      this.machinery.addPiston(51.5 * TILE_SIZE, 39 * TILE_SIZE, 14, 2.5, 0);
      this.placeAnchoredVent(18.5 * TILE_SIZE, 36 * TILE_SIZE, 0, -1, 4.5, 1.2, 1.0);
      this.placeBioVat(47.2 * TILE_SIZE, 17 * TILE_SIZE, false);
      this.machinery.addDrone(28 * TILE_SIZE, 10 * TILE_SIZE, 36, 5, 1.3, 0.4);

      // Pressure Switch (on col 49..52 pier at row 36) -> Sliding Blast Door guarding lower-right vault (col 66, rows 36..38)!
      this.machinery.addSwitchAndDoor(49.5 * TILE_SIZE, 36 * TILE_SIZE, 66 * TILE_SIZE, 36 * TILE_SIZE, 's04_vault');

      // Anchored Crimson Cage Lamps (all ceiling/wall bracketed with pendulum sway)
      for (const [lx, ly, drop] of [
        [8.5 * TILE_SIZE,  5 * TILE_SIZE,  20],
        [16.0 * TILE_SIZE, 8 * TILE_SIZE,  28],
        [49.0 * TILE_SIZE, 8 * TILE_SIZE,  28],
        [69.0 * TILE_SIZE, 5 * TILE_SIZE,  24],
        [60.0 * TILE_SIZE, 20 * TILE_SIZE, 22],
        [8.0 * TILE_SIZE,  32 * TILE_SIZE, 24],
        [27.0 * TILE_SIZE, 26 * TILE_SIZE, 22],
        [47.0 * TILE_SIZE, 26 * TILE_SIZE, 22]
      ]) {
        this.placeLamp(lx, ly, drop, this.assets.cageLamp);
      }

      // Anchored Crystals, Crates & Lore Terminals
      this.placeFloorProp(this.crystals, 4.0 * TILE_SIZE, 37 * TILE_SIZE, this.assets.crystals[0]);
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
        30.6 * TILE_SIZE,
        17 * TILE_SIZE,
        'TRANSIT DISPATCH 04-B',
        [
          'SUBWAY LINES FLOODED AT B4.',
          'UPPER PUMP SECTOR 07 OVERRUN',
          'BY BIOLUMINESCENT FLORA.'
        ]
      );

      // 5 Collectible Ruby Shards (including #5 inside Blast Door vault!)
      [
        [5.0 * TILE_SIZE,  8.5 * TILE_SIZE],
        [35.0 * TILE_SIZE, 7.5 * TILE_SIZE],
        [70.0 * TILE_SIZE, 24.5 * TILE_SIZE],
        [4.5 * TILE_SIZE,  22.5 * TILE_SIZE],
        [70.2 * TILE_SIZE, 37.5 * TILE_SIZE]
      ].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.9 });
      });

      // Anchored Wall Pipes (with floor-to-ceiling conduit columns)
      for (const [px, py] of [
        [13 * TILE_SIZE, 34 * TILE_SIZE],
        [37 * TILE_SIZE, 24 * TILE_SIZE],
        [50 * TILE_SIZE, 13 * TILE_SIZE],
        [56 * TILE_SIZE, 28 * TILE_SIZE]
      ]) {
        this.placeAnchoredPipe(px, py);
      }

      // Shallow Reflective Water Basin & Ceiling Drips
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

      // Anchored Hanging Chains, Vines & Sparking Broken Cables
      for (const [cx, cy, links, wt] of [
        [4.5 * TILE_SIZE,  6 * TILE_SIZE, 8, true],
        [12.5 * TILE_SIZE, 6 * TILE_SIZE, 10, false],
        [23.5 * TILE_SIZE, 6 * TILE_SIZE, 10, false],
        [44.0 * TILE_SIZE, 6 * TILE_SIZE, 9, true],
        [58.5 * TILE_SIZE, 6 * TILE_SIZE, 12, false],
        [19.5 * TILE_SIZE, 22 * TILE_SIZE, 9, false],
        [31.5 * TILE_SIZE, 22 * TILE_SIZE, 11, true]
      ]) {
        this.placeAnchoredChain(cx, cy, links, wt, false, false);
      }

      // 3 Severed Sparking Broken Cables
      this.placeAnchoredChain(16.0 * TILE_SIZE, 21 * TILE_SIZE, 7, false, false, true);
      this.placeAnchoredChain(41.5 * TILE_SIZE, 21 * TILE_SIZE, 8, false, false, true);
      this.placeAnchoredChain(60.5 * TILE_SIZE, 36 * TILE_SIZE, 5, false, false, true);

      for (const [vx, vy, links] of [
        [17.5 * TILE_SIZE, 22 * TILE_SIZE, 7],
        [25.5 * TILE_SIZE, 22 * TILE_SIZE, 8],
        [38.0 * TILE_SIZE, 22 * TILE_SIZE, 8],
        [49.5 * TILE_SIZE, 22 * TILE_SIZE, 9]
      ]) {
        this.placeAnchoredChain(vx, vy, links, false, true, false);
      }

      for (const [x0, y0, x1, y1] of [
        [3.5 * TILE_SIZE,  5.5 * TILE_SIZE, 18 * TILE_SIZE, 5.5 * TILE_SIZE],
        [21 * TILE_SIZE, 5.5 * TILE_SIZE, 45 * TILE_SIZE, 5.5 * TILE_SIZE],
        [48 * TILE_SIZE, 5.5 * TILE_SIZE, 72 * TILE_SIZE, 5.5 * TILE_SIZE],
        [3.5 * TILE_SIZE,  30 * TILE_SIZE,  17 * TILE_SIZE, 30 * TILE_SIZE],
        [28 * TILE_SIZE, 22 * TILE_SIZE, 48 * TILE_SIZE, 22 * TILE_SIZE]
      ]) {
        this.placeAnchoredCable(x0, y0, x1, y1, 1.14);
      }
    }

    // -----------------------------------------------------------------------
    // SECTOR 07: HYDRO-PUMP & MYCELIUM CONDUITS (ACT II) — REDESIGNED & AUDITED
    // -----------------------------------------------------------------------
    buildSector07() {
      this.parseMap([
        '############################################################################', // 00
        '############################################################################', // 01
        '###...........................##.......................##................###', // 02 (Gondola #3 wall drops)
        '###...........................##.......................##................###', // 03
        '###...........................##.......................##................###', // 04
        '###...........................##.......................##................###', // 05
        '###...........................##.......................##................###', // 06
        '###...######..................##.......................##................###', // 07 (Shard #2 loft)
        '###...........................##.......................##................###', // 08 (Gondola #3 I-beam)
        '###......................................................................###', // 09
        '###.........TTTTT........................................................###', // 10
        '###......................................................................###', // 11
        '###.....................###..............................................###', // 12 (Hydro Core Dais)
        '###...............################.......................................###', // 13 (Hydro Core Deck)
        '###...........................................###########TTTTT###........###', // 14 (Upper East + Lift Deck)
        '###......................................................................###', // 15
        '###......................................................................###', // 16
        '###.....TTTTT................................................TTTTT.......###', // 17
        '###......................................................................###', // 18
        '###......................................................................###', // 19
        '###...TTTTT.............................................TTTTT............###', // 20
        '###......................................................................###', // 21
        '###......................................................................###', // 22
        '###.....TTTTT................................................TTTTT.......###', // 23
        '###......................................................................###', // 24 (Gondola #2 I-beam)
        '###......................................................................###', // 25
        '###...TTTTT...................................................#########..###', // 26 (East Switch Deck)
        '###.............##........................##.............................###', // 27 (Gondola #1 I-beam)
        '###.............##........................##.............................###', // 28
        '###.....TTTTT.........................TTTT...............................###', // 29 (Mid transfer bridge)
        '###......................................................................###', // 30
        '###......................................................................###', // 31
        '###..###########...............................................#########..###', // 32 (Arrival & Vault Roof)
        '###...........................................................####.......###', // 33 (Wait: 66..72 secret vault!)
        '###......................................................................###', // 34
        '###.............####...####...####...####...####...####...####...........###', // 35 (Coolant Piers, dx=3)
        '###......................................................................###', // 36
        '###......................................................................###', // 37
        '###.............HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH...........###', // 38 (Coolant Sump Hazard)
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);

      // Fix row 32..37 East Secret Blast Door Vault cleanly (cols 65..72 open interior at rows 35..37? Wait: row 32 is ceiling, put floor at row 36!)
      // Let's cleanly patch rows 32..36 on East bank in code so ASCII above stays exact 76 chars:
      // East bank floor is row 39 (`###`), ceiling of East lower vault is row 32 (`cols 63..72`), doorway at `col 64, rows 36..38`?
      // Better: let's put solid ceiling at row 35 (`cols 65..72 #`), floor at row 39 (`#`), doorway at `col 65, rows 36..38`!
      // And keep row 32 `cols 63..72` `#` as East Lower Arrival deck (`row 32` step up `3` from `row 35` pier)!
      // Wait: if `row 32` is `cols 63..72 #`, then `rows 33..38` below it (`cols 65..72`) is an enclosed lower-right secret room!
      // Let's carve rows 35..38 at col 64 open (`.`) and place the **Sliding Blast Door** right at `col 65, rows 36..38` (`y = 36*16`), with ceiling `#` at `row 35` (`cols 65..72`) and floor at `row 39`!
      for (let c = 65; c <= 72; c++) {
        this.grid[35][c] = '#';
        this.grid[36][c] = '.';
        this.grid[37][c] = '.';
        this.grid[38][c] = '.';
      }
      for (let c = 61; c <= 64; c++) {
        this.grid[33][c] = '.';
      }
      // Make sure col 65 at row 35 is `#` ceiling above the Blast Door (rows 36..38), and cols 60..64 at row 35..38 open/step:
      // Actually row 35 already has `####` at cols 58..61 (`cols 58..61 #`), so from col 61 (`row 35`) walk straight across col 62..64 (`row 39`? Wait: row 39 is 4 below 35, wait: add `cols 62..64` at `row 37` `#` step or extend `row 39` -> step up 3 to `row 36`!).
      for (let c = 61; c <= 64; c++) this.grid[36][c] = '#'; // step at row 36 leading straight into Blast Door at col 65, rows 36..38? No! Door stands ON row 39 floor -> put step at row 39 (`cols 61..64` is already solid at `row 39`, and `cols 58..61` pier is `row 35` -> `4` down is safe, and climbing BACK UP from `row 39` to `row 35` is 4 tiles -> let's put `cols 61..63` `#` at `row 37` so `39 -> 37 (2 up) -> 35 (2 up)` is effortless!).
      this.grid[37][61] = '#';
      this.grid[37][62] = '#';
      // Wait: if Blast Door sits on `row 39` (`rows 36..38`), `col 65` must have open `row 36..38` and `#` above at `row 35`! And `col 63..64` stays open at `rows 36..38` so you stand on `row 39` floor right in front of the Blast Door!
      this.grid[36][61] = '.';
      this.grid[36][62] = '.';
      this.grid[36][63] = '.';
      this.grid[36][64] = '.';
      this.grid[37][60] = '#';
      this.grid[37][61] = '#';

      this.spawn = { x: 5.5 * TILE_SIZE, y: 30 * TILE_SIZE };

      // Wall-Bracketed Bio-Pump Sign bolted onto left cavern wall (col 3)
      this.placeSign('biolab', 5 * TILE_SIZE, 27.0 * TILE_SIZE, 131);

      // Hydro Core Orb above dais (cols 23..25, row 12)
      const orbX = 24.0 * TILE_SIZE;
      const orbY = 8.8 * TILE_SIZE;
      this.orb = {
        x: orbX,
        y: orbY,
        anchorY: this.findAnchorUp(orbX, orbY),
        sprite: this.assets.bioOrb,
        activated: false,
        pulseTimer: 0,
        chargeAnim: 0
      };
      for (const cx of [18, 22, 26, 30]) {
        this.conduitLights.push({ x: cx * TILE_SIZE, y: 13 * TILE_SIZE - 2 });
      }

      // 3 Horizontal Tracked Cargo Gondolas (wall-bolted on BOTH ends!)
      // Gondola #1 (Lower Bay: walls at col 16..17 and col 42..43, track at row 27, deck at row 30)
      const g1Left = this.findAnchorSide(24 * TILE_SIZE, 27.5 * TILE_SIZE, -1);
      const g1Right = this.findAnchorSide(24 * TILE_SIZE, 27.5 * TILE_SIZE, 1);
      this.machinery.addGondola({
        id: 's07_gondola_low',
        leftWallX: g1Left,
        rightWallX: g1Right,
        trackY: 27 * TILE_SIZE,
        minX: g1Left + 12,
        maxX: g1Right - 56,
        dropLen: 24,
        travelTime: 3.1,
        pauseTime: 0.85,
        phaseOffset: 0
      });

      // Gondola #2 (Mid-East Bay: left wall col 43, right wall col 72, track row 24, deck row 27)
      const g2Left = this.findAnchorSide(50 * TILE_SIZE, 24.5 * TILE_SIZE, -1);
      const g2Right = this.findAnchorSide(50 * TILE_SIZE, 24.5 * TILE_SIZE, 1);
      this.machinery.addGondola({
        id: 's07_gondola_mid',
        leftWallX: g2Left,
        rightWallX: g2Right,
        trackY: 24 * TILE_SIZE,
        minX: 44 * TILE_SIZE,
        maxX: 57 * TILE_SIZE,
        dropLen: 24,
        travelTime: 2.8,
        pauseTime: 0.85,
        phaseOffset: 1.0
      });

      // Gondola #3 (Upper Bio-Vault: walls col 31 and col 56, track row 8, deck row 12)
      const g3Left = this.findAnchorSide(44 * TILE_SIZE, 8.5 * TILE_SIZE, -1);
      const g3Right = this.findAnchorSide(44 * TILE_SIZE, 8.5 * TILE_SIZE, 1);
      this.machinery.addGondola({
        id: 's07_gondola_high',
        leftWallX: g3Left,
        rightWallX: g3Right,
        trackY: 8 * TILE_SIZE,
        minX: g3Left + 12,
        maxX: g3Right - 56,
        dropLen: 40,
        travelTime: 2.9,
        pauseTime: 0.85,
        phaseOffset: 0.5
      });

      // Geothermal Exit Elevator (cols 63..65, bottomY = 14*16, topY = 5*16)
      const elevX = 63 * TILE_SIZE;
      const elevAnchorY = this.findAnchorUp(elevX + 24, 5 * TILE_SIZE);
      this.machinery.addElevator({
        id: 's07_exit_lift',
        x: elevX,
        topY: 5 * TILE_SIZE,
        bottomY: 14 * TILE_SIZE,
        anchorY: elevAnchorY,
        cwX: 67 * TILE_SIZE,
        cwTopY: elevAnchorY + 12,
        cwBottomY: 12 * TILE_SIZE,
        mode: 'exit',
        requiresCore: true,
        startAtTop: false
      });

      // Anchored Turbines, Pistons, Bio-Vats, Steam Vents, Drones & Blast Door Switch
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

      // Anchored Cyan Bio-Lamps
      for (const [lx, ly, drop] of [
        [9.0 * TILE_SIZE,  25 * TILE_SIZE, 22],
        [24.0 * TILE_SIZE, 22 * TILE_SIZE, 20],
        [45.0 * TILE_SIZE, 22 * TILE_SIZE, 20],
        [68.0 * TILE_SIZE, 21 * TILE_SIZE, 22],
        [24.0 * TILE_SIZE, 4 * TILE_SIZE,  20],
        [49.0 * TILE_SIZE, 4 * TILE_SIZE,  20],
        [69.0 * TILE_SIZE, 5 * TILE_SIZE,  22]
      ]) {
        this.placeLamp(lx, ly, drop, this.assets.bioLamp);
      }

      // Bioluminescent Mushrooms, Crates & Terminals
      this.placeFloorProp(this.crystals, 12.2 * TILE_SIZE, 31 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crystals, 29.0 * TILE_SIZE, 34 * TILE_SIZE, this.assets.bioMushrooms[1]);
      this.placeFloorProp(this.crystals, 43.0 * TILE_SIZE, 34 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crystals, 69.0 * TILE_SIZE, 25 * TILE_SIZE, this.assets.bioMushrooms[0]);
      this.placeFloorProp(this.crystals, 4.5 * TILE_SIZE, 6 * TILE_SIZE, this.assets.bioMushrooms[1]);
      this.placeFloorProp(this.crystals, 18.0 * TILE_SIZE, 12 * TILE_SIZE, this.assets.bioMushrooms[0]);

      this.placeFloorProp(this.crates, 3.8 * TILE_SIZE, 31 * TILE_SIZE, this.assets.crates[1]);
      this.placeFloorProp(this.crates, 53.2 * TILE_SIZE, 13 * TILE_SIZE, this.assets.crates[0]);

      this.placeTerminal(
        'log_07_a',
        8.2 * TILE_SIZE,
        31 * TILE_SIZE,
        'HYDRO BAY 07-A',
        [
          'COOLANT SUMP CONTAMINATED.',
          'RIDE OVERHEAD GONDOLAS OR HOP',
          'ACROSS PUMP PIERS BELOW.'
        ]
      );
      this.placeTerminal(
        'log_07_b',
        47.5 * TILE_SIZE,
        13 * TILE_SIZE,
        'MYCOLOGY REPORT 07-B',
        [
          'SPORES HARVESTED REACTOR HEAT.',
          'RESTORE HYDRO CORE LEFT OF HERE',
          'TO ENGAGE GEOTHERMAL LIFT.'
        ]
      );

      // 5 Collectible Shards
      [
        [5.0 * TILE_SIZE,  5.5 * TILE_SIZE],
        [36.5 * TILE_SIZE, 33.5 * TILE_SIZE],
        [50.5 * TILE_SIZE, 33.5 * TILE_SIZE],
        [67.8 * TILE_SIZE, 37.5 * TILE_SIZE],
        [15.5 * TILE_SIZE, 11.5 * TILE_SIZE]
      ].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 1.1 });
      });

      // Anchored Wall Pipes
      for (const [px, py] of [
        [12 * TILE_SIZE, 27 * TILE_SIZE],
        [45 * TILE_SIZE, 28 * TILE_SIZE],
        [27 * TILE_SIZE, 9 * TILE_SIZE]
      ]) {
        this.placeAnchoredPipe(px, py);
      }

      // Coolant Hazard Sump Basin + Reflective Surface
      this.hazards.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 6, w: 46 * TILE_SIZE, h: 10 });
      this.puddles.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 6, w: 46 * TILE_SIZE, h: 10 });

      for (const dx of [20, 26, 33, 41, 48]) {
        const x = dx * TILE_SIZE + 8;
        this.drips.push({
          x,
          y: this.findAnchorUp(x, 26 * TILE_SIZE),
          cy: 26 * TILE_SIZE,
          vy: 0,
          targetY: 38 * TILE_SIZE + 6,
          timer: Math.random() * 2.2,
          active: false
        });
      }

      // Anchored Chains, Sparking Broken Cables & Vines
      for (const [cx, cy, links, wt] of [
        [7 * TILE_SIZE,  6 * TILE_SIZE,  8, false],
        [21 * TILE_SIZE, 6 * TILE_SIZE,  9, true],
        [38 * TILE_SIZE, 6 * TILE_SIZE,  10, false],
        [58 * TILE_SIZE, 6 * TILE_SIZE,  9, true],
        [39 * TILE_SIZE, 22 * TILE_SIZE, 8, false]
      ]) {
        this.placeAnchoredChain(cx, cy, links, wt, false, false);
      }
      this.placeAnchoredChain(14 * TILE_SIZE, 24 * TILE_SIZE, 7, false, false, true);
      this.placeAnchoredChain(34 * TILE_SIZE, 22 * TILE_SIZE, 6, false, false, true);
      this.placeAnchoredChain(60 * TILE_SIZE, 16 * TILE_SIZE, 7, false, false, true);

      for (const [vx, vy, links] of [
        [13 * TILE_SIZE, 6 * TILE_SIZE, 8],
        [33 * TILE_SIZE, 6 * TILE_SIZE, 8],
        [48 * TILE_SIZE, 6 * TILE_SIZE, 7],
        [25 * TILE_SIZE, 22 * TILE_SIZE, 8]
      ]) {
        this.placeAnchoredChain(vx, vy, links, false, true, false);
      }
      for (const [x0, y0, x1, y1] of [
        [4 * TILE_SIZE, 5 * TILE_SIZE, 20 * TILE_SIZE, 5 * TILE_SIZE],
        [34 * TILE_SIZE, 5 * TILE_SIZE, 54 * TILE_SIZE, 5 * TILE_SIZE],
        [18 * TILE_SIZE, 21 * TILE_SIZE, 42 * TILE_SIZE, 21 * TILE_SIZE]
      ]) {
        this.placeAnchoredCable(x0, y0, x1, y1, 1.15);
      }
    }

    // -----------------------------------------------------------------------
    // SECTOR 09: GEOTHERMAL REACTOR & SURFACE SPIRE (ACT III FINALE)
    // -----------------------------------------------------------------------
    buildSector09() {
      this.parseMap([
        '###.......................####.....####.................................###', // 00 (Open Night Sky Windows!)
        '###.......................####.....####.................................###', // 01 (Steel Gantry at 30..34!)
        '###......................................................................###', // 02
        '###......................................................................###', // 03
        '###......................................................................###', // 04
        '###......................................................................###', // 05
        '###......................................................................###', // 06
        '###......................................................................###', // 07
        '###.........................################.............................###', // 08 (Surface Broadcast Spire)
        '###.....######..........................................#######..........###', // 09 (Shard #4 & Secret Roof)
        '###...............TTTTT...................TTTTT..........................###', // 10
        '###.....................................................#####............###', // 11
        '###......................................................................###', // 12
        '###.............................................#######..........######..###', // 13 (Upper Reactor Deck)
        '###......................................................................###', // 14
        '###......................................................................###', // 15
        '###......................................................................###', // 16
        '###....................##........................##......................###', // 17 (Gondola Wall Drops)
        '###....................##........................##......................###', // 18 (Gondola I-beam)
        '###....................##........................##......................###', // 19
        '###...######.............................................................###', // 20 (Shard #2 ledge)
        '###...........TTTT.......................................................###', // 21
        '###................###...................................................###', // 22 (Lift #1 Anchor Cap)
        '###.............................................#######..................###', // 23 (East Mid Deck)
        '###....................TTTT..............................................###', // 24
        '###......................................................................###', // 25
        '###......................................................................###', // 26
        '###.....................#############....................................###', // 27 (Mid Reactor Deck)
        '###......................................................................###', // 28
        '###......................................................................###', // 29
        '###.......................................................######.........###', // 30 (Switch Alcove)
        '###......................................................................###', // 31
        '###......................................................................###', // 32
        '###.............................................TTTTT....................###', // 33
        '###......................................................................###', // 34
        '###..................................####................................###', // 35 (Lower Magma Pier)
        '###..#############.....####...............####...................######..###', // 36 (Arrival Deck + Piers)
        '###......................................................................###', // 37
        '###.............HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH.....###', // 38 (Molten Geothermal Sump)
        '############################################################################', // 39
        '############################################################################', // 40
        '############################################################################'  // 41
      ]);

      // Fix Sector 09 Spire Gantry & East Vault clean geometry:
      // 1. Central Sky Gantry at row 0..1 (`cols 30..34`) so Apex Core Orb bolts cleanly while sky windows on both sides remain open!
      for (let c = 26; c <= 47; c++) {
        this.grid[0][c] = (c >= 30 && c <= 34) ? '#' : '.';
        this.grid[1][c] = (c >= 30 && c <= 34) ? '#' : '.';
      }
      // 2. Ceiling anchor block above Lift #1 (cols 16..21 at row 22):
      for (let c = 16; c <= 21; c++) this.grid[22][c] = '#';
      // 3. Ceiling anchor block above Lift #2 (cols 55..62 at row 9):
      for (let c = 55; c <= 62; c++) this.grid[9][c] = '#';
      // 4. Lower-right Blast Door Vault (`cols 65..72` at rows 9..13? No! Row 9..13 is top right: `row 9` ceiling `cols 65..72`, `row 13` floor `cols 63..72`, Blast Door at `col 65, rows 10..12`!).
      for (let c = 65; c <= 72; c++) {
        this.grid[9][c] = '#';
        this.grid[10][c] = '.';
        this.grid[11][c] = '.';
        this.grid[12][c] = '.';
        this.grid[13][c] = '#';
      }
      this.grid[13][63] = '#';
      this.grid[13][64] = '#';
      // Also allow reaching row 30 switch alcove easily from row 36 east pier (`cols 42..45` -> `cols 48..52` `row 33` `T` -> `cols 58..63` `row 30` `#` -> jump back left or step to `row 27`? Put `T` at `row 26, cols 51..54` to connect smoothly!).
      for (let c = 51; c <= 54; c++) this.grid[26][c] = 'T';

      this.spawn = { x: 4.5 * TILE_SIZE, y: 34 * TILE_SIZE };

      // Anchored Reactor Floor Sign on lower titanium arrival deck (cols 4..14, row 36)
      this.placeSign('reactor', 7.2 * TILE_SIZE, 36 * TILE_SIZE, 211);

      // Timed Counterweighted Elevator #1 (cols 18..20, bottomY=36*16, topY=27*16, cwX=16*16)
      const e1X = 18 * TILE_SIZE;
      const e1AnchorY = this.findAnchorUp(e1X + 24, 24 * TILE_SIZE);
      this.machinery.addElevator({
        id: 's09_lift_1',
        x: e1X,
        topY: 27 * TILE_SIZE,
        bottomY: 36 * TILE_SIZE,
        anchorY: e1AnchorY,
        cwX: 16 * TILE_SIZE,
        cwTopY: e1AnchorY + 12,
        cwBottomY: 34 * TILE_SIZE,
        mode: 'cycle',
        travelTime: 2.3,
        pauseTime: 1.0,
        startAtTop: false
      });

      // Mid-Reactor Horizontal Monorail Gondola (wall-bolted between col 24 and col 49, track row 18, deck row 22)
      const g1Left = this.findAnchorSide(35 * TILE_SIZE, 18.5 * TILE_SIZE, -1);
      const g1Right = this.findAnchorSide(35 * TILE_SIZE, 18.5 * TILE_SIZE, 1);
      this.machinery.addGondola({
        id: 's09_gondola_mid',
        leftWallX: g1Left,
        rightWallX: g1Right,
        trackY: 18 * TILE_SIZE,
        minX: g1Left + 12,
        maxX: g1Right - 56,
        dropLen: 36,
        travelTime: 3.1,
        pauseTime: 0.9,
        phaseOffset: 0.4
      });

      // Timed Counterweighted Elevator #2 (cols 56..58, bottomY=23*16, topY=13*16, cwX=60*16)
      const e2X = 56 * TILE_SIZE;
      const e2AnchorY = this.findAnchorUp(e2X + 24, 11 * TILE_SIZE);
      this.machinery.addElevator({
        id: 's09_lift_2',
        x: e2X,
        topY: 13 * TILE_SIZE,
        bottomY: 23 * TILE_SIZE,
        anchorY: e2AnchorY,
        cwX: 60 * TILE_SIZE,
        cwTopY: e2AnchorY + 12,
        cwBottomY: 22 * TILE_SIZE,
        mode: 'cycle',
        travelTime: 2.5,
        pauseTime: 1.0,
        startAtTop: true
      });

      // Surface Broadcast Relay Spire & Apex Core on top deck (cols 27..41, row 8)
      const gateX = 37 * TILE_SIZE;
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
        x: 32.0 * TILE_SIZE,
        y: 5.2 * TILE_SIZE,
        anchorY: this.findAnchorUp(32.0 * TILE_SIZE, 5.2 * TILE_SIZE),
        sprite: this.assets.reactorOrb,
        activated: false,
        pulseTimer: 0,
        chargeAnim: 0
      };
      for (const cx of [29, 34, 39]) {
        this.conduitLights.push({ x: cx * TILE_SIZE, y: 8 * TILE_SIZE - 2 });
      }

      // Anchored Turbines, Pistons, Magma Vats, Steam Vents, Drones & Upper Vault Blast Door
      this.placeAnchoredTurbine(29 * TILE_SIZE, 29 * TILE_SIZE, 7.2, 0);
      this.placeAnchoredTurbine(40 * TILE_SIZE, 11 * TILE_SIZE, -6.5, 1.1);

      this.machinery.addPiston(51 * TILE_SIZE, 13 * TILE_SIZE, 14, 3.0, 0);
      this.machinery.addPiston(26 * TILE_SIZE, 27 * TILE_SIZE, 12, 2.5, 1.2);

      this.placeAnchoredVent(13.5 * TILE_SIZE, 35 * TILE_SIZE, 0, -1, 3.6, 1.1, 0);
      this.placeAnchoredVent(31.5 * TILE_SIZE, 26 * TILE_SIZE, 0, -1, 4.0, 1.15, 1.8);
      this.placeAnchoredVent(52.5 * TILE_SIZE, 22 * TILE_SIZE, 0, -1, 3.5, 1.05, 0.9);

      this.placeBioVat(14.0 * TILE_SIZE, 35 * TILE_SIZE, true);
      this.placeBioVat(69.5 * TILE_SIZE, 12 * TILE_SIZE, true);

      // Switch on east lower overlook (col 60, row 30) opens Blast Door on upper east vault (col 65, rows 10..12)!
      this.machinery.addSwitchAndDoor(60 * TILE_SIZE, 30 * TILE_SIZE, 65 * TILE_SIZE, 10 * TILE_SIZE, 's09_vault');

      this.machinery.addDrone(35 * TILE_SIZE, 14 * TILE_SIZE, 34, 4, 1.6, 0.2);
      this.machinery.addDrone(40 * TILE_SIZE, 24 * TILE_SIZE, 38, 6, 1.4, 2.5);

      // Anchored Amber Reactor Lamps
      for (const [lx, ly, drop] of [
        [6.5 * TILE_SIZE,  25 * TILE_SIZE, 22],
        [28 * TILE_SIZE,   22 * TILE_SIZE, 20],
        [47 * TILE_SIZE,   21 * TILE_SIZE, 22],
        [62 * TILE_SIZE,   16 * TILE_SIZE, 20],
        [23 * TILE_SIZE,   5 * TILE_SIZE,  18],
        [49 * TILE_SIZE,   5 * TILE_SIZE,  18],
        [68 * TILE_SIZE,   4 * TILE_SIZE,  20]
      ]) {
        this.placeLamp(lx, ly, drop, this.assets.amberLamp);
      }

      // Crates & Lore Terminals
      this.placeFloorProp(this.crates, 11.8 * TILE_SIZE, 35 * TILE_SIZE, this.assets.crates[0]);
      this.placeFloorProp(this.crates, 40.0 * TILE_SIZE, 7 * TILE_SIZE, this.assets.crates[1]);

      this.placeTerminal(
        'log_09_a',
        4.5 * TILE_SIZE,
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
        28.2 * TILE_SIZE,
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
        [36.5 * TILE_SIZE, 33.5 * TILE_SIZE],
        [5.5 * TILE_SIZE,  18.5 * TILE_SIZE],
        [68.0 * TILE_SIZE, 11.5 * TILE_SIZE],
        [10.0 * TILE_SIZE, 7.5 * TILE_SIZE],
        [70.2 * TILE_SIZE, 11.5 * TILE_SIZE]
      ].forEach(([sx, sy], idx) => {
        this.shards.push({ id: idx, x: sx, y: sy, collected: false, phase: idx * 0.8 });
      });

      // Anchored Wall Pipes
      for (const [px, py] of [
        [24 * TILE_SIZE, 28 * TILE_SIZE],
        [52 * TILE_SIZE, 24 * TILE_SIZE],
        [10 * TILE_SIZE, 13 * TILE_SIZE]
      ]) {
        this.placeAnchoredPipe(px, py);
      }

      // Molten Geothermal Hazard Sump
      this.hazards.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 5, w: 52 * TILE_SIZE, h: 11 });
      this.puddles.push({ x: 16 * TILE_SIZE, y: 38 * TILE_SIZE + 5, w: 52 * TILE_SIZE, h: 11 });

      // Anchored Heavy Chains, Sparking Broken Cables & High-Voltage Cables
      for (const [cx, cy, links, wt] of [
        [10 * TILE_SIZE, 5 * TILE_SIZE, 10, true],
        [50 * TILE_SIZE, 5 * TILE_SIZE, 9, false],
        [66 * TILE_SIZE, 5 * TILE_SIZE, 9, true],
        [26 * TILE_SIZE, 21 * TILE_SIZE, 7, false]
      ]) {
        this.placeAnchoredChain(cx, cy, links, wt, false, false);
      }
      this.placeAnchoredChain(12 * TILE_SIZE, 25 * TILE_SIZE, 6, false, false, true);
      this.placeAnchoredChain(44 * TILE_SIZE, 21 * TILE_SIZE, 7, false, false, true);
      this.placeAnchoredChain(58 * TILE_SIZE, 28 * TILE_SIZE, 6, false, false, true);

      for (const [x0, y0, x1, y1] of [
        [4 * TILE_SIZE,  5 * TILE_SIZE,  25 * TILE_SIZE, 5 * TILE_SIZE],
        [48 * TILE_SIZE, 5 * TILE_SIZE,  72 * TILE_SIZE, 5 * TILE_SIZE],
        [4 * TILE_SIZE,  26 * TILE_SIZE, 18 * TILE_SIZE, 26 * TILE_SIZE]
      ]) {
        this.placeAnchoredCable(x0, y0, x1, y1, 1.14);
      }
    }
  }
  GAME.LevelBuilder = LevelBuilder;
})();