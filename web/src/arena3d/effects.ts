import * as THREE from "three";

/**
 * The marks a fight leaves in the air: a slash where a blow lands, chips flying
 * off it, dust under a body that starts running or stops falling, the light a
 * healer throws.
 *
 * WHY THESE EXIST AT ALL. A cut-out sliding up to another cut-out is two
 * pictures touching. What tells an audience that one HIT the other is the
 * thing that happens between them at that instant, and with single-frame art
 * there is no swing to draw - so the impact is drawn instead.
 *
 * Every effect is a flat quad with a lifetime and a function of how far
 * through it is. Nothing is pooled: a blow makes about ten of them and a fight
 * lands a blow every three quarters of a second, which is far below the point
 * where allocating them is worth being clever about.
 */

interface Effect {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  start: number;
  duration: number;
  /** `k` runs 0..1 over the effect's life; `dt` is seconds since the last frame. */
  step: (k: number, dt: number) => void;
}

function paint(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  draw(canvas.getContext("2d")!, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

export class Effects {
  private readonly live: Effect[] = [];
  private readonly quad = new THREE.PlaneGeometry(1, 1);
  private last = performance.now();
  /** While set, nothing new is drawn. The scene sets it for a frame that arrives very late. */
  muted = false;

  /** A crescent, thick in the middle and gone at the tips. */
  private readonly crescent = paint(64, (ctx, s) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s * 0.3, s * 0.5, s * 0.46, -1.15, 1.15);
    ctx.arc(s * 0.12, s * 0.5, s * 0.5, 0.95, -0.95, true);
    ctx.closePath();
    ctx.fill();
  });

  private readonly glow = paint(32, (ctx, s) => {
    const fill = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    fill.addColorStop(0, "rgba(255,255,255,1)");
    fill.addColorStop(0.35, "rgba(255,255,255,0.7)");
    fill.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, s, s);
  });

  private readonly hoop = paint(64, (ctx, s) => {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
  });

  constructor(private readonly scene: THREE.Scene) {}

  private spawn(
    at: THREE.Vector3,
    duration: number,
    options: { map?: THREE.Texture; color: THREE.Color; additive?: boolean },
    step: (mesh: Effect["mesh"], k: number, dt: number) => void,
  ): void {
    if (this.muted) return;
    const material = new THREE.MeshBasicMaterial({
      map: options.map ?? null,
      color: options.color,
      transparent: true,
      depthWrite: false,
      blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.quad, material);
    mesh.position.copy(at);
    // After the backdrop and the shadow sheet, which are also blended.
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.live.push({ mesh, start: performance.now(), duration, step: (k, dt) => step(mesh, k, dt) });
    step(mesh, 0, 0);
  }

  /** The cut. `direction` is the sign of the blow's travel along x, so the crescent opens the right way. */
  slash(at: THREE.Vector3, direction: number, crit: boolean): void {
    const size = crit ? 2.1 : 1.4;
    const tilt = (Math.random() - 0.5) * 1.1;
    const flip = direction >= 0 ? 1 : -1;
    this.spawn(at, crit ? 260 : 190, { map: this.crescent, color: new THREE.Color(crit ? 0xffd166 : 0xffffff), additive: true }, (mesh, k) => {
      const grow = 0.55 + 0.45 * (1 - (1 - k) ** 3);
      mesh.scale.set(size * grow * flip, size * grow, 1);
      mesh.rotation.z = tilt;
      mesh.material.opacity = 1 - k * k;
    });
  }

  /** Chips thrown off an impact, along the blow and up, falling back under gravity. */
  debris(at: THREE.Vector3, direction: THREE.Vector3, color: THREE.Color, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const velocity = new THREE.Vector3(
        direction.x * (1.5 + Math.random() * 3) + (Math.random() - 0.5) * 2,
        1.5 + Math.random() * 3.5,
        direction.z * 1.5 + (Math.random() - 0.5) * 1.5,
      );
      const size = 0.07 + Math.random() * 0.07;
      this.spawn(at, 380 + Math.random() * 220, { color }, (mesh, k, dt) => {
        velocity.y -= 14 * dt;
        mesh.position.addScaledVector(velocity, dt);
        // Chips stop at the floor rather than sinking through the painting.
        if (mesh.position.y < 0.04) mesh.position.y = 0.04;
        mesh.scale.setScalar(size);
        mesh.material.opacity = 1 - k * k;
      });
    }
  }

  /** Kicked up at floor level. */
  dust(at: THREE.Vector3, count: number): void {
    const color = new THREE.Color(0xb9b2a6);
    for (let i = 0; i < count; i += 1) {
      const drift = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 0.7, (Math.random() - 0.5) * 0.4);
      const size = 0.1 + Math.random() * 0.1;
      const origin = at.clone().setY(0.08);
      this.spawn(origin, 360 + Math.random() * 160, { color }, (mesh, k, dt) => {
        mesh.position.addScaledVector(drift, dt);
        mesh.scale.setScalar(size * (1 + k));
        mesh.material.opacity = 0.55 * (1 - k);
      });
    }
  }

  /**
   * Something thrown: a heal, or a blow from somebody who does not close.
   *
   * `to` is asked every frame rather than once, because the body it is aimed
   * at may be knocked or walking, and a light that lands where someone used to
   * be reads as a miss.
   */
  orb(from: THREE.Vector3, to: () => THREE.Vector3, duration: number, color: THREE.Color): void {
    const origin = from.clone();
    this.spawn(origin, duration, { map: this.glow, color, additive: true }, (mesh, k) => {
      mesh.position.lerpVectors(origin, to(), k);
      mesh.position.y += Math.sin(Math.PI * k) * 0.9;
      mesh.scale.setScalar(0.55 + 0.25 * Math.sin(Math.PI * k));
      mesh.material.opacity = 1;
    });
  }

  /** Light rising off a body that has just been healed. */
  motes(at: THREE.Vector3, color: THREE.Color): void {
    for (let i = 0; i < 7; i += 1) {
      const origin = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, Math.random() * 0.8, 0.02));
      const rise = 1.1 + Math.random() * 1.1;
      const size = 0.09 + Math.random() * 0.07;
      this.spawn(origin, 520 + Math.random() * 260, { color, additive: true }, (mesh, k, dt) => {
        mesh.position.y += rise * dt;
        mesh.scale.setScalar(size);
        mesh.material.opacity = 1 - k;
      });
    }
  }

  /** A hoop spreading across the floor from under a body using an ability. */
  ring(at: THREE.Vector3, color: THREE.Color): void {
    const origin = at.clone().setY(0.05);
    this.spawn(origin, 520, { map: this.hoop, color, additive: true }, (mesh, k) => {
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.setScalar(0.6 + 2.6 * (1 - (1 - k) ** 2));
      mesh.material.opacity = 1 - k;
    });
  }

  update(now: number): void {
    // Capped, so a tab coming back from being hidden does not hand every chip
    // one enormous step and throw it out of the scene.
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const effect = this.live[i]!;
      const k = (now - effect.start) / effect.duration;
      if (k >= 1) {
        this.scene.remove(effect.mesh);
        effect.mesh.material.dispose();
        this.live.splice(i, 1);
      } else {
        effect.step(k, dt);
      }
    }
  }

  dispose(): void {
    for (const effect of this.live) {
      this.scene.remove(effect.mesh);
      effect.mesh.material.dispose();
    }
    this.live.length = 0;
    this.quad.dispose();
    this.crescent.dispose();
    this.glow.dispose();
    this.hoop.dispose();
  }
}
