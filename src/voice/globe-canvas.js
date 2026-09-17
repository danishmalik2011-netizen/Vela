(() => {
  "use strict";

  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ~2.3999632

  /**
   * Generates Fibonacci sphere points.
   * Equidistant distribution of points over a unit sphere.
   */
  function generateFibonacciSphere(numPoints = 750) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const y = 1 - (i / (numPoints - 1)) * 2; // from 1 down to -1
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN_ANGLE * i;

      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;

      points.push({ x, y, z, baseRadius: 1 });
    }
    return points;
  }

  /**
   * Generates orbital ring points at a specific inclination and radius.
   */
  function generateOrbitalRing(numPoints = 80, radius = 1.15, tiltX = 0, tiltZ = 0) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const theta = (i / numPoints) * Math.PI * 2;
      let x = Math.cos(theta) * radius;
      let y = 0;
      let z = Math.sin(theta) * radius;

      // Apply tilt
      if (tiltX) {
        const y1 = y * Math.cos(tiltX) - z * Math.sin(tiltX);
        const z1 = y * Math.sin(tiltX) + z * Math.cos(tiltX);
        y = y1;
        z = z1;
      }
      if (tiltZ) {
        const x1 = x * Math.cos(tiltZ) - y * Math.sin(tiltZ);
        const y1 = x * Math.sin(tiltZ) + y * Math.cos(tiltZ);
        x = x1;
        y = y1;
      }

      points.push({ x, y, z, baseRadius: radius, theta });
    }
    return points;
  }

  class VelaGlobeRenderer {
    constructor(canvas, options = {}) {
      if (!canvas) {
        throw new Error("VelaGlobeRenderer requires a canvas element.");
      }

      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.options = {
        pointCount: options.pointCount || 720,
        baseRadius: options.baseRadius || 140,
        cameraDistance: options.cameraDistance || 400,
        analyser: options.analyser || null,
        ...options
      };

      this.state = "idle"; // "idle" | "listening" | "thinking" | "speaking" | "interrupted"
      this.points = generateFibonacciSphere(this.options.pointCount);
      this.equatorRing = generateOrbitalRing(90, 1.12, 0.25, 0.15);
      this.orbitalRing1 = generateOrbitalRing(70, 1.25, -0.65, 0.4);
      this.orbitalRing2 = generateOrbitalRing(60, 1.35, 0.85, -0.5);

      this.yaw = 0;
      this.pitch = 0.2;
      this.roll = 0;
      this.ringYaw = 0;
      this.animId = null;
      this.isRunning = false;

      // Audio analysis properties
      this.analyser = this.options.analyser;
      this.freqData = null;
      if (this.analyser) {
        const binCount = this.analyser.frequencyBinCount || 128;
        this.freqData = new Uint8Array(binCount);
      }
      this.audioVolume = 0;
      this.smoothedVolume = 0;
      this.syntheticActivity = 0;

      // State animation timers
      this.interruptedTime = 0;
      this.startTime = Date.now();

      this._handleResize = this.resize.bind(this);
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("resize", this._handleResize);
      }
      this.resize();
    }

    setAudioAnalyser(analyser) {
      this.analyser = analyser;
      if (this.analyser) {
        const binCount = this.analyser.frequencyBinCount || 128;
        this.freqData = new Uint8Array(binCount);
      } else {
        this.freqData = null;
      }
    }

    setSyntheticActivity(level) {
      this.syntheticActivity = Math.max(0, Math.min(1, level));
    }

    setState(newState) {
      if (this.state === newState) return;
      const oldState = this.state;
      this.state = newState;

      if (newState === "interrupted") {
        this.interruptedTime = Date.now();
      }

      // If transition from interrupted after 450ms
      if (oldState === "interrupted" && newState !== "interrupted") {
        this.interruptedTime = 0;
      }
    }

    resize() {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const rect = typeof this.canvas.getBoundingClientRect === "function"
        ? this.canvas.getBoundingClientRect()
        : { width: this.canvas.width || 440, height: this.canvas.height || 440 };
      const width = rect.width || 440;
      const height = rect.height || 440;

      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.dpr = dpr;
      this.width = width;
      this.height = height;
      this.centerX = this.canvas.width / 2;
      this.centerY = this.canvas.height / 2;
      this.radius = Math.min(width, height) * 0.32 * dpr;
    }

    start() {
      if (this.isRunning) return;
      this.isRunning = true;
      const loop = () => {
        if (!this.isRunning) return;
        this.render();
        this.animId = requestAnimationFrame(loop);
      };
      this.animId = requestAnimationFrame(loop);
    }

    stop() {
      this.isRunning = false;
      if (this.animId) {
        cancelAnimationFrame(this.animId);
        this.animId = null;
      }
    }

    destroy() {
      this.stop();
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("resize", this._handleResize);
      }
      this.points = [];
      this.equatorRing = [];
      this.orbitalRing1 = [];
      this.orbitalRing2 = [];
    }

    _sampleAudio() {
      let volume = 0;
      if (this.analyser && this.freqData) {
        this.analyser.getByteFrequencyData(this.freqData);
        let sum = 0;
        const count = Math.min(this.freqData.length, 64);
        for (let i = 0; i < count; i++) {
          sum += this.freqData[i];
        }
        volume = sum / (count * 255);
      }

      if (this.syntheticActivity > 0) {
        volume = Math.max(volume, this.syntheticActivity);
      }

      this.smoothedVolume += (volume - this.smoothedVolume) * 0.22;
      return this.smoothedVolume;
    }

    render() {
      const { ctx, canvas, centerX, centerY, radius, dpr } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const time = (Date.now() - this.startTime) * 0.001;
      const audioLevel = this._sampleAudio();

      // State speeds and rotations
      let yawSpeed = 0.006;
      let pitchSpeed = 0.002;
      let pulse = Math.sin(time * 2) * 0.03;

      if (this.state === "listening") {
        yawSpeed = 0.014;
        pitchSpeed = 0.004;
        pulse = Math.sin(time * 3.5) * 0.04 + audioLevel * 0.35;
      } else if (this.state === "thinking") {
        yawSpeed = 0.024;
        pitchSpeed = 0.012;
        pulse = Math.sin(time * 5.0) * 0.08;
      } else if (this.state === "speaking") {
        yawSpeed = 0.016;
        pitchSpeed = 0.006;
        pulse = Math.sin(time * 4.0) * 0.05 + audioLevel * 0.4;
      } else if (this.state === "interrupted") {
        const elapsed = Date.now() - this.interruptedTime;
        const shock = Math.max(0, 1 - elapsed / 500);
        pulse = shock * 0.45;
        yawSpeed = 0.03 * shock;
      }

      this.yaw += yawSpeed;
      this.pitch += pitchSpeed;
      this.ringYaw -= yawSpeed * 1.5;

      const cosYaw = Math.cos(this.yaw);
      const sinYaw = Math.sin(this.yaw);
      const cosPitch = Math.cos(this.pitch);
      const sinPitch = Math.sin(this.pitch);

      // Render halo and central atmospheric glow
      this._renderAtmosphere(ctx, centerX, centerY, radius, pulse, audioLevel);

      // Project and collect all points for depth sorting
      const projectedList = [];

      // 1. Fibonacci sphere vertices
      const numPoints = this.points.length;
      for (let i = 0; i < numPoints; i++) {
        const p = this.points[i];

        // Apply audio/state deformation
        let def = pulse;
        if (this.state === "speaking") {
          const wave = Math.sin(p.y * 6 + time * 6) * audioLevel * 0.35;
          def += wave;
        } else if (this.state === "listening") {
          const wave = Math.sin(p.x * 4 + time * 4) * audioLevel * 0.3;
          def += wave;
        } else if (this.state === "thinking") {
          const wave = Math.cos(p.y * 8 + time * 5) * 0.12;
          def += wave;
        }

        const r = radius * (1 + def);

        // Rotation around Y
        const x1 = (p.x * cosYaw - p.z * sinYaw) * r;
        const z1 = (p.x * sinYaw + p.z * cosYaw) * r;
        // Rotation around X
        const y2 = p.y * r * cosPitch - z1 * sinPitch;
        const z2 = p.y * r * sinPitch + z1 * cosPitch;

        // Perspective
        const cameraDist = 450 * dpr;
        const scale = cameraDist / (cameraDist + z2);
        const screenX = centerX + x1 * scale;
        const screenY = centerY + y2 * scale;

        projectedList.push({
          type: "sphere",
          x: screenX,
          y: screenY,
          z: z2,
          scale,
          alpha: Math.max(0.12, (z2 + radius) / (2 * radius)),
          pointIndex: i
        });
      }

      // 2. Orbital rings
      this._projectRing(this.equatorRing, projectedList, cosYaw, sinYaw, cosPitch, sinPitch, radius, pulse, "ring-equator", time);
      this._projectRing(this.orbitalRing1, projectedList, cosYaw, sinYaw, cosPitch, sinPitch, radius, pulse, "ring-orbital1", time);
      this._projectRing(this.orbitalRing2, projectedList, cosYaw, sinYaw, cosPitch, sinPitch, radius, pulse, "ring-orbital2", time);

      // Depth sort
      projectedList.sort((a, b) => a.z - b.z);

      const splitIndex = projectedList.findIndex(p => p.z >= 0);
      const backPoints = splitIndex === -1 ? projectedList : projectedList.slice(0, splitIndex);
      const frontPoints = splitIndex === -1 ? [] : projectedList.slice(splitIndex);

      const colors = this._getStateColors();

      // Back waves
      this._renderSineWaves(ctx, centerX, centerY, radius, time, audioLevel, pulse, false);

      // Back points
      this._renderPoints(ctx, backPoints, colors, dpr);

      // Solid sphere core
      const isLight = typeof document !== 'undefined' && document.documentElement?.dataset?.theme === 'light';
      const rCore = radius * (1 + pulse);
      
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, rCore, 0, Math.PI * 2);
      
      const grad = ctx.createRadialGradient(
        centerX - rCore * 0.28, centerY - rCore * 0.28, rCore * 0.04,
        centerX, centerY, rCore
      );
      
      if (isLight) {
        grad.addColorStop(0, "rgba(255,255,252,0.8)");
        grad.addColorStop(0.5, colors.sphereMid || "rgba(200, 220, 215, 1)");
        grad.addColorStop(1, colors.sphereOuter || "rgba(160, 180, 175, 1)");
      } else {
        grad.addColorStop(0, "rgba(180,220,200,0.6)");
        grad.addColorStop(0.5, colors.sphereMid || colors.front);
        grad.addColorStop(1, colors.sphereOuter || "rgba(10,20,15,0.9)");
      }
      
      ctx.fillStyle = grad;
      ctx.fill();
      
      // Contour lines
      ctx.strokeStyle = isLight ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.arc(centerX, centerY, rCore * 0.9, -Math.PI * 0.8, -Math.PI * 0.3);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, rCore * 0.8, Math.PI * 0.2, Math.PI * 0.7);
      ctx.stroke();
      ctx.restore();

      // Front waves
      this._renderSineWaves(ctx, centerX, centerY, radius, time, audioLevel, pulse, true);

      // Front points
      this._renderPoints(ctx, frontPoints, colors, dpr);
    }

    _renderPoints(ctx, points, colors, dpr) {
      for (let i = 0; i < points.length; i++) {
        const item = points[i];
        const isFront = item.z > 0;
        let dotRadius = (isFront ? 2.0 : 1.2) * item.scale * dpr * 0.6;
        let color = colors.front;

        if (item.type !== "sphere") {
          dotRadius *= 0.85;
          color = colors.ring;
        }

        ctx.beginPath();
        ctx.arc(item.x, item.y, Math.max(0.4, dotRadius), 0, Math.PI * 2);
        ctx.fillStyle = isFront ? color : colors.back;
        ctx.globalAlpha = Math.min(0.25, item.alpha * 0.4);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;
    }

    _renderSineWaves(ctx, cx, cy, radius, time, audioLevel, pulse, drawFront) {
      const colors = this._getStateColors();
      const dpr = this.dpr || 1;
      const cosYaw = Math.cos(this.yaw);
      const sinYaw = Math.sin(this.yaw);
      const cosPitch = Math.cos(this.pitch);
      const sinPitch = Math.sin(this.pitch);

      const waves = [
        { k: 2, m: 1, phi: 0, amp: 0.12, color: colors.front, alpha: 0.6, lw: 2.5 },
        { k: 3, m: 1, phi: Math.PI/3, amp: 0.10, color: colors.ring, alpha: 0.45, lw: 2.0 },
        { k: 2, m: 2, phi: 2*Math.PI/3, amp: 0.08, color: colors.front, alpha: 0.35, lw: 1.6 },
        { k: 4, m: 1, phi: Math.PI, amp: 0.06, color: colors.ring, alpha: 0.25, lw: 1.2 }
      ];

      const segments = 64;
      const cameraDist = 450 * dpr;

      for (const wave of waves) {
        ctx.beginPath();
        let started = false;

        for (let i = 0; i <= segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          
          const bx = Math.cos(theta);
          const by = 0;
          const bz = Math.sin(theta);
          
          const A = wave.amp * (1 + audioLevel * 1.5);
          const dy = A * Math.sin(wave.k * theta + time * 2.5 + wave.phi) * Math.cos(wave.m * theta);
          
          const r = radius * (1 + pulse);
          
          const px = bx * r;
          const py = dy * r;
          const pz = bz * r;
          
          const x1 = px * cosYaw - pz * sinYaw;
          const z1 = px * sinYaw + pz * cosYaw;
          const y2 = py * cosPitch - z1 * sinPitch;
          const z2 = py * sinPitch + z1 * cosPitch;
          
          const isFront = z2 >= 0;
          
          if (isFront === drawFront) {
            const scale = cameraDist / (cameraDist + z2);
            const sx = cx + x1 * scale;
            const sy = cy + y2 * scale;
            
            if (!started) {
              ctx.moveTo(sx, sy);
              started = true;
            } else {
              ctx.lineTo(sx, sy);
            }
          } else {
            started = false;
          }
        }
        
        ctx.strokeStyle = wave.color;
        ctx.globalAlpha = wave.alpha;
        ctx.lineWidth = wave.lw * dpr;
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    _projectRing(ringPoints, outputList, cosYaw, sinYaw, cosPitch, sinPitch, radius, pulse, type, time) {
      const { centerX, centerY, dpr } = this;
      const cameraDist = 450 * dpr;
      const ringCos = Math.cos(this.ringYaw);
      const ringSin = Math.sin(this.ringYaw);

      for (let i = 0; i < ringPoints.length; i++) {
        const p = ringPoints[i];
        const r = radius * (p.baseRadius + pulse * 0.5);

        const rx = p.x * ringCos - p.z * ringSin;
        const rz = p.x * ringSin + p.z * ringCos;

        const x1 = (rx * cosYaw - rz * sinYaw) * r;
        const z1 = (rx * sinYaw + rz * cosYaw) * r;
        const y2 = p.y * r * cosPitch - z1 * sinPitch;
        const z2 = p.y * r * sinPitch + z1 * cosPitch;

        const scale = cameraDist / (cameraDist + z2);
        const screenX = centerX + x1 * scale;
        const screenY = centerY + y2 * scale;

        outputList.push({
          type,
          x: screenX,
          y: screenY,
          z: z2,
          scale,
          alpha: Math.max(0.08, (z2 + radius) / (2 * radius) * 0.8)
        });
      }
    }

    _renderAtmosphere(ctx, cx, cy, radius, pulse, audioLevel) {
      const colors = this._getStateColors();
      const glowRadius = radius * (1.18 + pulse * 0.4);

      const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, glowRadius);
      grad.addColorStop(0, colors.coreGlow);
      grad.addColorStop(0.65, colors.midGlow);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");

      ctx.save();
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _getStateColors() {
      const isLight = typeof document !== 'undefined' && document.documentElement?.dataset?.theme === 'light';
      
      if (isLight) {
        switch (this.state) {
          case "listening":
            return {
              front: "rgb(2, 132, 199)", 
              back: "rgba(5, 150, 105, 0.4)",
              ring: "rgb(14, 165, 233)",
              coreGlow: "rgba(2, 132, 199, 0.15)",
              midGlow: "rgba(5, 150, 105, 0.05)",
              sphereMid: "rgb(200, 220, 215)", 
              sphereOuter: "rgb(160, 180, 175)"
            };
          case "thinking":
            return {
              front: "rgb(217, 119, 6)", 
              back: "rgba(194, 65, 12, 0.4)", 
              ring: "rgb(245, 158, 11)",
              coreGlow: "rgba(217, 119, 6, 0.15)",
              midGlow: "rgba(5, 150, 105, 0.05)",
              sphereMid: "rgb(230, 215, 195)",
              sphereOuter: "rgb(190, 175, 155)"
            };
          case "speaking":
            return {
              front: "rgb(5, 150, 105)", 
              back: "rgba(4, 120, 87, 0.35)",
              ring: "rgb(234, 179, 8)", 
              coreGlow: "rgba(5, 150, 105, 0.2)",
              midGlow: "rgba(16, 185, 129, 0.08)",
              sphereMid: "rgb(205, 225, 210)",
              sphereOuter: "rgb(165, 185, 170)"
            };
          case "interrupted":
            return {
              front: "rgb(225, 29, 72)", 
              back: "rgba(190, 18, 60, 0.35)",
              ring: "rgb(244, 63, 94)",
              coreGlow: "rgba(225, 29, 72, 0.25)",
              midGlow: "rgba(190, 18, 60, 0.1)",
              sphereMid: "rgb(235, 205, 210)",
              sphereOuter: "rgb(195, 165, 170)"
            };
          case "idle":
          default:
            return {
              front: "rgb(5, 150, 105)", 
              back: "rgba(20, 83, 45, 0.3)", 
              ring: "rgba(5, 150, 105, 0.6)",
              coreGlow: "rgba(20, 83, 45, 0.12)",
              midGlow: "rgba(5, 150, 105, 0.03)",
              sphereMid: "rgb(220, 230, 225)", 
              sphereOuter: "rgb(180, 190, 185)" 
            };
        }
      } else {
        switch (this.state) {
          case "listening":
            return {
              front: "rgb(6, 182, 212)",
              back: "rgba(16, 185, 129, 0.4)",
              ring: "rgb(56, 189, 248)",
              coreGlow: "rgba(6, 182, 212, 0.22)",
              midGlow: "rgba(16, 185, 129, 0.08)",
              sphereMid: "rgb(6, 182, 212)",
              sphereOuter: "rgb(10, 20, 25)"
            };
          case "thinking":
            return {
              front: "rgb(245, 158, 11)",
              back: "rgba(234, 88, 12, 0.4)",
              ring: "rgb(251, 191, 36)",
              coreGlow: "rgba(245, 158, 11, 0.24)",
              midGlow: "rgba(16, 185, 129, 0.06)",
              sphereMid: "rgb(245, 158, 11)",
              sphereOuter: "rgb(25, 20, 10)"
            };
          case "speaking":
            return {
              front: "rgb(52, 211, 153)",
              back: "rgba(16, 185, 129, 0.35)",
              ring: "rgb(254, 240, 138)",
              coreGlow: "rgba(16, 185, 129, 0.28)",
              midGlow: "rgba(52, 211, 153, 0.12)",
              sphereMid: "rgb(52, 211, 153)",
              sphereOuter: "rgb(10, 25, 20)"
            };
          case "interrupted":
            return {
              front: "rgb(244, 63, 94)",
              back: "rgba(225, 29, 72, 0.35)",
              ring: "rgb(251, 113, 133)",
              coreGlow: "rgba(244, 63, 94, 0.38)",
              midGlow: "rgba(225, 29, 72, 0.14)",
              sphereMid: "rgb(244, 63, 94)",
              sphereOuter: "rgb(25, 10, 15)"
            };
          case "idle":
          default:
            return {
              front: "rgb(52, 211, 153)",
              back: "rgba(31, 91, 69, 0.3)",
              ring: "rgba(52, 211, 153, 0.6)",
              coreGlow: "rgba(31, 91, 69, 0.16)",
              midGlow: "rgba(16, 185, 129, 0.04)",
              sphereMid: "rgb(31, 91, 69)",
              sphereOuter: "rgb(5, 10, 8)"
            };
        }
      }
    }
  }

  globalThis.VelaGlobeRenderer = VelaGlobeRenderer;
  globalThis.generateFibonacciSphere = generateFibonacciSphere;
  globalThis.generateOrbitalRing = generateOrbitalRing;
})();
