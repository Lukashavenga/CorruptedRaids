import * as THREE from "three";
import type { PlacementFile } from "../../../src/character/layers.js";
import { BASELINE_Y, CANVAS } from "../../../src/character/layers.js";
import type { CombatOutcome } from "../../../src/engine/types.js";
import type { PlaybackAction } from "../hooks/useCombatPlayback.js";
import { enemySpriteUrl } from "../sprites.js";
import { characterKey, composeCharacter } from "./composeCharacter.js";
import { Effects } from "./effects.js";
import { CANVAS_WORLD, FOV, Projection, floorFor, layoutUnits, type Floor, type Slot } from "./stageGeometry.js";
import type { ArenaUnit } from "./types.js";

/**
 * The fight, in three dimensions.
 *
 * WHAT THIS IS AND IS NOT. The resolver decides a whole fight in one call and
 * the overlay replays the log (useCombatPlayback). That is unchanged: nothing
 * here decides anything, rolls anything, or knows what a stat is. What changes
 * is what a replayed event LOOKS like. In the flat overlay an attack is a
 * figure twitching in its rank while a number rises off somebody else. Here
 * the attacker crosses the floor, arrives as the blow lands, and stays in the
 * melee for a moment before falling back - so a fight is a thing happening in
 * a place rather than two columns exchanging arithmetic.
 *
 * The bodies are still the 2D art, stood upright on the floor as cut-outs.
 * There are no models and nothing to rig: the whole motion vocabulary is
 * moving, leaning, hopping and falling over, which is as much as a single
 * drawing can do and is enough to read as a brawl from across a room.
 *
 * Colour is deliberately unmanaged. Every pixel is finished pixel art that
 * should reach the screen as drawn, so textures are sampled raw and written
 * raw, with no lighting model in between to convert for.
 */
THREE.ColorManagement.enabled = false;

/**
 * How far the picture is slid up the stage, as a fraction of its height.
 *
 * The flat overlay centres the backdrop, which puts the last 26px of ground
 * under the pooled enemy bar. Nobody stood there, so it did not matter. Here
 * that strip is the front of the floor, and the front row's feet would be
 * behind the bar; sliding the view up hands those pixels back and spends sky
 * that the banner was covering anyway.
 */
const VIEW_SHIFT = 0.06;

/** How much the backdrop is pulled back while a fight is on the floor. */
const FIGHT_BRIGHTNESS = 0.55;
const FIGHT_SATURATION = 0.8;

/** How long a melee attacker stays where it struck before walking home, in ms. */
const LINGER_MS: [number, number] = [900, 1700];
const RETURN_MS = 420;
const FALL_MS = 460;

/** World height of an ordinary enemy drawing - the flat overlay draws one as tall as the character canvas. */
const ENEMY_HEIGHT = CANVAS_WORLD;
/** ...and a boss, at the 150px to 88px the flat overlay uses. */
const BOSS_HEIGHT = CANVAS_WORLD * (150 / 88);

const BACKDROP_VERTEX = /* glsl */ `
  uniform mat4 painting;
  varying vec4 vPainting;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPainting = painting * world;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const BACKDROP_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform float brightness;
  uniform float saturation;
  varying vec4 vPainting;
  void main() {
    if (vPainting.w <= 0.0) discard;
    vec2 uv = vPainting.xy / vPainting.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
    vec4 texel = texture2D(map, uv);
    if (texel.a < 0.01) discard;
    float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    // The scrim the flat overlay lays over its backdrop, heaviest at the
    // floor: that is where the paintings are busiest and where the bodies are.
    float scrim = mix(0.75, 1.0, uv.y);
    vec3 rgb = mix(vec3(luma), texel.rgb, saturation) * mix(1.0, scrim, 1.0 - brightness) * brightness;
    gl_FragColor = vec4(rgb, texel.a);
  }
`;

const SPRITE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Alpha-TESTED, not blended. A cut-out with a hard edge writes depth like any
// solid thing, so forty overlapping bodies sort themselves and nothing has to
// be drawn back to front. The art is outlined pixel art; it has no soft edge
// to lose.
const SPRITE_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 flashColor;
  uniform float flash;
  uniform float grey;
  uniform float shade;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(map, vUv);
    if (texel.a < 0.4) discard;
    float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    vec3 rgb = mix(texel.rgb, vec3(luma), grey) * shade;
    gl_FragColor = vec4(mix(rgb, flashColor, flash), 1.0);
  }
`;

const WHITE = new THREE.Color(0xffffff);
const HEAL = new THREE.Color(0x7dffa0);
const CRIT = new THREE.Color(0xffd166);
const CAST = new THREE.Color(0xc9a6ff);

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const easeOut = (k: number): number => 1 - (1 - k) ** 3;
/** 0 -> 1 -> 0 across the interval. */
const bump = (k: number): number => Math.sin(Math.PI * clamp01(k));

interface Tween {
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  duration: number;
  hop: number;
  /** Runs once, on arrival. */
  then?: () => void;
}

/** One body on the floor. */
class Actor {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** The dark patch under its feet. See the note on shadows in ArenaScene. */
  readonly shadow: THREE.Mesh;
  readonly position = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  unit: ArenaUnit;
  /** What its texture was built from, so a re-sync only redraws on a real change. */
  artKey = "";
  /** World size of the quad. Set when the art arrives. */
  width = 1;
  height = CANVAS_WORLD;
  /** Authored sprite scale. */
  scale = 1;
  /** Which way the ART looks before any flip: a composited character faces right, an enemy drawing left. */
  nativeFacing: 1 | -1 = 1;
  facing: 1 | -1;
  tween: Tween | null = null;
  /** True while away from home on an attack. */
  out = false;
  returnAt = 0;
  lunge: { start: number; x: number; z: number } | null = null;
  knock: { start: number; x: number; z: number } | null = null;
  flash: { start: number; duration: number } | null = null;
  cast = 0;
  fallen: { start: number; direction: number } | null = null;
  /** Which way the last blow pushed, so a body falls away from what killed it. */
  lastPush = 0;
  spawned = 0;
  readonly phase = Math.random() * Math.PI * 2;

  constructor(unit: ArenaUnit, geometry: THREE.PlaneGeometry, shadow: THREE.Mesh) {
    this.shadow = shadow;
    this.unit = unit;
    this.facing = unit.side === "party" ? 1 : -1;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: null },
        flashColor: { value: WHITE.clone() },
        flash: { value: 0 },
        grey: { value: 0 },
        shade: { value: 1 },
      },
      vertexShader: SPRITE_VERTEX,
      fragmentShader: SPRITE_FRAGMENT,
      // Facing is a negative x scale, which turns the quad's back to the camera.
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    // Hidden until its art arrives. A blank quad would be a white rectangle.
    this.mesh.visible = false;
    this.shadow.visible = false;
  }

  get defaultFacing(): 1 | -1 {
    return this.unit.side === "party" ? 1 : -1;
  }

  /** A body that throws rather than charges. */
  get ranged(): boolean {
    return this.unit.role === "healer";
  }

  /** Where it is headed, or where it is. Aiming at a moving body's CURRENT spot misses it. */
  get destination(): THREE.Vector3 {
    return this.tween ? this.tween.to : this.position;
  }

  /** A point on the body, `fraction` of the way up it. */
  at(fraction: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x, this.height * this.scale * fraction, this.position.z + 0.05);
  }

  moveTo(to: THREE.Vector3, now: number, duration: number, hop: number, then?: () => void): void {
    this.tween = { from: this.position.clone(), to: to.clone(), start: now, duration, hop, then };
    const dx = to.x - this.position.x;
    if (Math.abs(dx) > 0.05) this.facing = dx > 0 ? 1 : -1;
  }

  setTexture(texture: THREE.Texture, width: number, height: number, nativeFacing: 1 | -1): void {
    const old = this.mesh.material.uniforms.map!.value as THREE.Texture | null;
    this.mesh.material.uniforms.map!.value = texture;
    this.width = width;
    this.height = height;
    this.nativeFacing = nativeFacing;
    this.mesh.visible = true;
    this.shadow.visible = true;
    if (old && old.userData.owned) old.dispose();
  }

  update(now: number, outcome: CombatOutcome | null): void {
    const t = now / 1000;
    let lift = 0;
    let lean = 0;
    let offsetX = 0;
    let offsetZ = 0;

    if (this.tween) {
      const tw = this.tween;
      const k = clamp01((now - tw.start) / tw.duration);
      this.position.lerpVectors(tw.from, tw.to, easeOut(k));
      lift += bump(k) * tw.hop;
      // Leaning into a run is the cheapest thing that makes a slide look like
      // one. It eases off as the body arrives so it lands upright.
      lean += -Math.sign(tw.to.x - tw.from.x) * 0.16 * (1 - k);
      if (k >= 1) {
        this.tween = null;
        tw.then?.();
      }
    }

    if (this.lunge) {
      const k = (now - this.lunge.start) / 220;
      if (k >= 1) this.lunge = null;
      else {
        const f = bump(k);
        offsetX += this.lunge.x * 0.45 * f;
        offsetZ += this.lunge.z * 0.45 * f;
        lean += -Math.sign(this.lunge.x) * 0.38 * f;
      }
    }

    if (this.knock) {
      const k = (now - this.knock.start) / 300;
      if (k >= 1) this.knock = null;
      else {
        // Out fast, back slow: a shove, not a wobble.
        const f = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
        offsetX += this.knock.x * f;
        offsetZ += this.knock.z * f;
        lean += -Math.sign(this.knock.x) * 0.2 * f;
      }
    }

    let flash = 0;
    if (this.flash) {
      const k = (now - this.flash.start) / this.flash.duration;
      if (k >= 1) this.flash = null;
      else flash = 1 - k;
    }

    if (this.cast) {
      const k = (now - this.cast) / 320;
      if (k >= 1) this.cast = 0;
      else lift += bump(k) * 0.3;
    }

    const uniforms = this.mesh.material.uniforms;
    let squash = 1 + Math.sin(t * 2.1 + this.phase) * 0.012;
    let grey = 0;
    let shade = 1;

    if (this.fallen) {
      const k = clamp01((now - this.fallen.start) / FALL_MS);
      // Past flat and back: the body hits the floor and settles.
      const f = k < 0.7 ? easeOut(k / 0.7) * 1.08 : 1.08 - ((k - 0.7) / 0.3) * 0.08;
      lean = -this.fallen.direction * 1.45 * f;
      // Turned about its feet, half of a lying body is under the floor.
      lift = Math.min(this.width, this.height) * this.scale * 0.32 * clamp01(f);
      // Drained rather than blacked out: a body on the floor should still be
      // recognisably the person it was.
      grey = 0.75 * k;
      shade = 1 - 0.28 * k;
      squash = 1;
    } else if (this.unit.pose === "victory" || (outcome === "defeat" && this.unit.side === "enemy")) {
      lift += Math.abs(Math.sin(t * 5.2 + this.phase)) * 0.32;
    }

    const born = this.spawned ? clamp01((now - this.spawned) / 200) : 1;
    const size = this.scale * (0.6 + 0.4 * easeOut(born));

    this.mesh.position.set(this.position.x + offsetX, lift, this.position.z + offsetZ);
    this.mesh.rotation.z = lean;
    this.mesh.scale.set(this.facing * this.nativeFacing * this.width * size, this.height * size * squash, 1);
    uniforms.flash!.value = flash;
    uniforms.grey!.value = grey;
    uniforms.shade!.value = shade;

    // The shadow stays on the floor while the body leaves it, and tightens as
    // it rises - which is the one cue that says a hop went UP rather than
    // back. A character canvas is twice as wide as the body drawn on it.
    const body = (this.unit.character && !this.unit.sprite ? this.width * 0.5 : this.width * 0.8) * size;
    const lying = this.fallen ? this.height * size * 0.8 * clamp01((now - this.fallen.start) / FALL_MS) : 0;
    const tight = 1 / (1 + (this.fallen ? 0 : lift) * 1.6);
    this.shadow.position.set(this.mesh.position.x, 0.02, this.mesh.position.z);
    this.shadow.scale.set(Math.max(body, lying) * 1.25 * tight, 1, 0.75 * size * tight);
  }

  dispose(): void {
    const map = this.mesh.material.uniforms.map!.value as THREE.Texture | null;
    if (map && map.userData.owned) map.dispose();
    this.mesh.material.dispose();
  }
}

export class ArenaScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200);
  private readonly projection = new Projection();
  private readonly effects: Effects;
  private readonly actors = new Map<string, Actor>();
  private readonly quad: THREE.PlaneGeometry;
  private readonly characterQuad: THREE.PlaneGeometry;
  private readonly backdrop: THREE.ShaderMaterial;
  private readonly wall: THREE.Mesh;
  private readonly ground: THREE.Mesh;
  private readonly shadowQuad: THREE.PlaneGeometry;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private lastFrame = performance.now();
  private readonly enemyTextures = new Map<string, Promise<THREE.Texture | null>>();
  private readonly loader = new THREE.TextureLoader();
  /** Things due at a moment on the render clock. See `schedule`. */
  private timeline: { at: number; run: () => void }[] = [];
  private floor: Floor = floorFor(null);
  private backdropUrl: string | null = null;
  private brightness = 1;
  private saturation = 1;
  private mood: "full" | "fight" = "full";
  private outcome: CombatOutcome | null = null;
  private fighting = false;
  private units: readonly ArenaUnit[] = [];
  private placements: PlacementFile = {};
  private width = 1;
  private height = 1;
  private shake = 0;
  private punch = 0;
  private frame = 0;
  private disposed = false;
  private readonly still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(host: HTMLElement) {
    // Its own canvas, made here and removed in dispose(). React mounts every
    // effect twice in development, and a second renderer on a canvas that has
    // already given up its context gets that dead context back.
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    host.appendChild(this.renderer.domElement);

    // Unit quads stand on their bottom edge, so turning one about its origin
    // pivots it on its feet.
    this.quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    // The character canvas keeps its feet on BASELINE_Y, 42px above its
    // bottom edge, so that quad hangs below the floor by exactly that much.
    this.characterQuad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5 - (CANVAS - BASELINE_Y) / CANVAS, 0);

    this.backdrop = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: null },
        painting: { value: this.projection.matrix },
        brightness: { value: 1 },
        saturation: { value: 1 },
      },
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      // Blended, for the paintings' soft edges, and so drawn AFTER the bodies.
      // They are solid and have already written depth, so the picture simply
      // fails the depth test wherever somebody is standing in front of it.
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.backdrop);
    this.wall.renderOrder = 1;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.backdrop);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.renderOrder = 2;
    this.wall.visible = this.ground.visible = false;
    this.scene.add(this.wall, this.ground);

    // CONTACT SHADOWS, NOT CAST ONES - and cast ones were built first.
    //
    // A shadow map worked and was the wrong tool. The camera looks across the
    // floor at about fifteen degrees, so a silhouette cast along it is a
    // sliver a few pixels tall, and whichever way the light was put most of
    // that sliver lay behind the body casting it or under its neighbours: a
    // full render pass per frame for something measurably on screen and not
    // visibly there. A soft patch under the feet is what a low camera can
    // actually see, and it does the one job a shadow has here - it says which
    // bodies are standing on the floor and which are in the air.
    this.shadowQuad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const blot = document.createElement("canvas");
    blot.width = blot.height = 64;
    const ink = blot.getContext("2d")!;
    const fade = ink.createRadialGradient(32, 32, 0, 32, 32, 32);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(0.55, "rgba(0,0,0,0.75)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    ink.fillStyle = fade;
    ink.fillRect(0, 0, 64, 64);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(blot),
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    this.effects = new Effects(this.scene);
    this.setFloor(this.floor);
    this.frame = requestAnimationFrame(this.tick);
  }

  /** The stage's size in CSS px, and how many real pixels each of those is. */
  setSize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.setViewOffset(width, height, 0, Math.round(height * VIEW_SHIFT), width, height);
    this.relayout(performance.now());
  }

  setBackdrop(background: string | null, url: string | null): void {
    this.setFloor(floorFor(background));
    if (url === this.backdropUrl) return;
    this.backdropUrl = url;
    const old = this.backdrop.uniforms.map!.value as THREE.Texture | null;
    if (!url) {
      this.backdrop.uniforms.map!.value = null;
      this.wall.visible = this.ground.visible = false;
      old?.dispose();
      return;
    }
    this.loader.load(url, (texture) => {
      // A slower load for a scene the run has already left.
      if (this.disposed || url !== this.backdropUrl) {
        texture.dispose();
        return;
      }
      texture.magFilter = THREE.NearestFilter;
      this.backdrop.uniforms.map!.value = texture;
      this.wall.visible = this.ground.visible = true;
      old?.dispose();
    });
  }

  setMood(mood: "full" | "fight"): void {
    this.mood = mood;
  }

  setOutcome(outcome: CombatOutcome | null): void {
    this.outcome = outcome;
  }

  /** Stands the wall at the fold and runs the floor from it back to the camera. */
  private setFloor(floor: Floor): void {
    this.floor = floor;
    const back = this.projection.groundAt(0.5, floor.fold).z;
    this.wall.scale.set(200, 80, 1);
    this.wall.position.set(0, 40, back);
    this.ground.scale.set(200, -back, 1);
    this.ground.position.set(0, 0, back / 2);
    this.relayout(performance.now());
  }

  /** Brings the floor into line with who should be on it. */
  sync(units: readonly ArenaUnit[], placements: PlacementFile, fighting: boolean): void {
    const now = performance.now();
    const moved = fighting !== this.fighting || units.length !== this.units.length;
    this.units = units;
    this.placements = placements;
    this.fighting = fighting;

    const live = new Set<string>();
    let changed = moved;
    for (const unit of units) {
      live.add(unit.id);
      let actor = this.actors.get(unit.id);
      if (!actor) {
        const shadow = new THREE.Mesh(this.shadowQuad, this.shadowMaterial);
        // Over the floor it lies on, under every effect.
        shadow.renderOrder = 3;
        actor = new Actor(unit, unit.character && !unit.sprite ? this.characterQuad : this.quad, shadow);
        actor.spawned = now;
        this.actors.set(unit.id, actor);
        this.scene.add(actor.mesh, shadow);
        changed = true;
      }
      const wasDown = actor.unit.downed;
      // A different spot on the floor: the author moved it, or a party member
      // changed role mid-join and belongs in another rank.
      if (
        actor.unit.placed?.x !== unit.placed?.x ||
        actor.unit.placed?.y !== unit.placed?.y ||
        actor.unit.role !== unit.role
      ) {
        changed = true;
      }
      actor.unit = unit;
      if (unit.downed && !wasDown) this.fall(actor, now);
      if (!unit.downed && wasDown) {
        // Back on its feet for the next room of a raid - and it fell wherever
        // it was hit, which is rarely where it lives.
        actor.fallen = null;
        actor.moveTo(actor.home, now, 520, 0.12, () => (actor.facing = actor.defaultFacing));
      }
      this.dress(actor);
    }
    for (const [id, actor] of this.actors) {
      if (live.has(id)) continue;
      this.scene.remove(actor.mesh, actor.shadow);
      actor.dispose();
      this.actors.delete(id);
      changed = true;
    }
    if (changed) this.relayout(now);
  }

  /** Gives an actor its art, if what it should be drawn from has changed. */
  private dress(actor: Actor): void {
    const { unit } = actor;
    if (unit.sprite) {
      const key = `sprite:${unit.sprite}`;
      if (actor.artKey === key) return;
      actor.artKey = key;
      const height = unit.boss ? BOSS_HEIGHT : ENEMY_HEIGHT;
      void this.enemyTexture(enemySpriteUrl(unit.sprite)).then((texture) => {
        if (!texture || actor.artKey !== key || !this.actors.has(unit.id)) return;
        const image = texture.image as HTMLImageElement;
        actor.setTexture(texture, (height * image.naturalWidth) / image.naturalHeight, height, -1);
      });
      return;
    }
    if (!unit.character) return;
    const key = `character:${characterKey(unit.character, this.placements)}`;
    if (actor.artKey === key) return;
    actor.artKey = key;
    void composeCharacter(unit.character, this.placements).then((canvas) => {
      if (this.disposed || actor.artKey !== key || !this.actors.has(unit.id)) return;
      const texture = new THREE.CanvasTexture(canvas);
      this.filter(texture);
      texture.userData.owned = true;
      const size = unit.boss ? BOSS_HEIGHT : CANVAS_WORLD;
      actor.setTexture(texture, size, size, 1);
    });
  }

  /** One texture per enemy drawing, shared by every body that wears it. */
  private enemyTexture(url: string): Promise<THREE.Texture | null> {
    let pending = this.enemyTextures.get(url);
    if (!pending) {
      pending = new Promise((resolve) => {
        this.loader.load(
          url,
          (texture) => {
            this.filter(texture);
            resolve(texture);
          },
          undefined,
          () => resolve(null),
        );
      });
      this.enemyTextures.set(url, pending);
    }
    return pending;
  }

  /**
   * Sharp when enlarged, smooth when shrunk.
   *
   * The art is drawn far larger than it is shown, so on the stage it is always
   * being reduced - and nearest-neighbour reduction of a MOVING sprite crawls,
   * every pixel of it re-deciding which source pixel it is each frame.
   */
  private filter(texture: THREE.Texture): void {
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }

  /** Recomputes everybody's home and walks them to it. */
  private relayout(now: number): void {
    if (this.units.length === 0) return;
    const slots = layoutUnits(this.units, this.projection, this.floor, this.width / this.height, this.fighting);
    for (const [id, slot] of slots) {
      const actor = this.actors.get(id);
      if (actor) this.settle(actor, slot, now);
    }
  }

  private settle(actor: Actor, slot: Slot, now: number): void {
    actor.scale = slot.scale;
    const fresh = now - actor.spawned < 50;
    if (fresh) {
      actor.home.copy(slot.position);
      actor.position.copy(slot.position);
      // Somebody joining walks on from the wings. Everyone else - the enemy,
      // or a party already there when the page loaded mid-fight - is simply
      // found standing where they are.
      if (actor.unit.side === "party" && !this.fighting && !actor.unit.downed) {
        actor.position.x -= 5;
        actor.moveTo(actor.home, now, 700, 0.25);
      }
      return;
    }
    if (actor.home.distanceToSquared(slot.position) < 1e-4) return;
    actor.home.copy(slot.position);
    // A body out on an attack, or lying on the floor, is not called back by a
    // change of formation. It will find the new home when it next walks to it.
    if (actor.out || actor.fallen) return;
    actor.moveTo(actor.home, now, 520, 0.12, () => (actor.facing = actor.defaultFacing));
  }

  private fall(actor: Actor, now: number): void {
    actor.tween = null;
    actor.lunge = null;
    actor.out = false;
    const direction = actor.lastPush || -actor.defaultFacing;
    actor.fallen = { start: now, direction: Math.sign(direction) || 1 };
    this.effects.dust(actor.at(0), 6);
  }

  /**
   * Runs `run` at a moment on the RENDER clock.
   *
   * Not setTimeout. Everything here is drawn from requestAnimationFrame, which
   * a hidden OBS source stops; a timer would go on firing into a scene that is
   * not being drawn, and the picture would come back with the blows landed
   * and nobody having moved.
   */
  private schedule(at: number, run: () => void): void {
    this.timeline.push({ at, run });
  }

  /** A move the replay has announced, `leadMs` before its event lands. */
  act(action: PlaybackAction): void {
    const now = performance.now();
    const actor = this.actors.get(action.actorId);
    const target = this.actors.get(action.targetId);
    const lands = now + action.leadMs;
    // Either end may be missing - a party past the cap is not on the floor -
    // and the half that IS there still plays its part.

    if (action.kind === "ability") {
      if (!actor || actor.fallen) return;
      actor.cast = now;
      this.schedule(lands, () => {
        actor.flash = { start: lands, duration: 260 };
        actor.mesh.material.uniforms.flashColor!.value.copy(CRIT);
        this.effects.ring(actor.at(0), CRIT);
      });
      return;
    }

    if (action.kind === "heal") {
      if (actor && !actor.fallen) actor.cast = now;
      if (!target) return;
      if (actor && actor !== target) this.effects.orb(actor.at(0.8), () => target.at(0.5), action.leadMs, HEAL);
      this.schedule(lands, () => {
        target.flash = { start: lands, duration: 380 };
        target.mesh.material.uniforms.flashColor!.value.copy(HEAL);
        this.effects.motes(target.at(0.2), HEAL);
      });
      return;
    }

    // Which way the blow travels. Mostly along x - the sides face each other -
    // but a flanker comes in at whatever angle it stands at.
    const from = actor?.position ?? target?.position;
    const to = target?.destination ?? actor?.position;
    if (!from || !to) return;
    const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    if (direction.lengthSq() < 1e-4) {
      // Only one end is on the floor, so there is no line between them. A
      // blow comes from the other side's half and travels toward one's own.
      direction.set(actor ? actor.defaultFacing : target!.unit.side === "party" ? -1 : 1, 0, 0);
    }
    direction.normalize();

    if (actor && !actor.fallen) {
      if (actor.ranged || !target) {
        actor.cast = now;
        actor.facing = direction.x >= 0 ? 1 : -1;
        if (target) this.effects.orb(actor.at(0.75), () => target.at(0.55), action.leadMs, CAST);
      } else {
        // Stops a body's width short, on its own side of whoever it is hitting.
        const reach = (actor.width * actor.scale + target.width * target.scale) * 0.3;
        const strike = to.clone().addScaledVector(direction, -reach);
        strike.z += 0.02;
        actor.out = true;
        this.effects.dust(actor.at(0), 3);
        actor.moveTo(strike, now, action.leadMs * 0.85, 0.18);
        this.schedule(lands, () => {
          if (actor.fallen) return;
          actor.lunge = { start: lands, x: direction.x, z: direction.z };
        });
        actor.returnAt = lands + LINGER_MS[0] + Math.random() * (LINGER_MS[1] - LINGER_MS[0]);
      }
    }

    if (target) {
      this.schedule(lands, () => {
        const force = action.crit ? 0.6 : 0.32;
        target.lastPush = direction.x;
        if (!target.fallen) target.knock = { start: lands, x: direction.x * force, z: direction.z * force };
        target.flash = { start: lands, duration: action.crit ? 260 : 150 };
        target.mesh.material.uniforms.flashColor!.value.copy(action.crit ? CRIT : WHITE);
        this.effects.slash(target.at(0.5), direction.x, action.crit);
        this.effects.debris(target.at(0.5), direction, action.crit ? CRIT : WHITE, action.crit ? 9 : 5);
        if (action.crit) {
          this.shake = 1;
          this.punch = 1;
        }
      });
    }
  }

  /** Where a body's head is on the stage, as fractions of its width and height. */
  project(id: string): { x: number; y: number } | null {
    const actor = this.actors.get(id);
    if (!actor || !actor.mesh.visible) return null;
    const head = actor.at(actor.fallen ? 0.3 : 0.85).project(this.camera);
    return { x: (head.x + 1) / 2, y: (1 - head.y) / 2 };
  }

  private readonly tick = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    const now = performance.now();
    // A long gap means the source was hidden and has just come back, with
    // every blow that landed in the meantime due at once. They still LAND -
    // bodies must end up where the fight left them - but silently: forty
    // slashes on one frame is not a fight, it is a glitch.
    this.effects.muted = now - this.lastFrame > 400;
    this.lastFrame = now;

    if (this.timeline.length) {
      const due = this.timeline.filter((entry) => entry.at <= now);
      if (due.length) {
        this.timeline = this.timeline.filter((entry) => entry.at > now);
        for (const entry of due) entry.run();
      }
    }

    for (const actor of this.actors.values()) {
      if (actor.out && !actor.tween && !actor.fallen && now >= actor.returnAt) {
        actor.out = false;
        actor.moveTo(actor.home, now, RETURN_MS, 0.2, () => (actor.facing = actor.defaultFacing));
      }
      actor.update(now, this.outcome);
    }
    this.effects.muted = false;
    this.effects.update(now);

    // The backdrop eases between its two moods rather than cutting.
    const wantBright = this.mood === "fight" ? FIGHT_BRIGHTNESS : 1;
    const wantSat = this.mood === "fight" ? FIGHT_SATURATION : 1;
    this.brightness += (wantBright - this.brightness) * 0.06;
    this.saturation += (wantSat - this.saturation) * 0.06;
    this.backdrop.uniforms.brightness!.value = this.brightness;
    this.backdrop.uniforms.saturation!.value = this.saturation;

    this.frameCamera(now);
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * A slow drift around the point the painting was "taken" from.
   *
   * Small on purpose. The wall and floor are one picture folded in two, and
   * the illusion holds for as long as the camera stays near the spot it was
   * folded for; a real orbit would smear every painted lamp-post that stands
   * on the floor strip. A few degrees is enough to pull the layers apart.
   */
  private frameCamera(now: number): void {
    const t = now / 1000;
    const rest = this.projection.camera.position;
    const sway = this.still ? 0 : 1;
    this.shake *= 0.86;
    this.punch *= 0.9;
    const jolt = this.shake * sway * 0.12;
    this.camera.position.set(
      rest.x + Math.sin(t * 0.21) * 0.55 * sway,
      rest.y + Math.sin(t * 0.33) * 0.08 * sway,
      rest.z,
    );
    const focus = this.projection.focus;
    this.camera.lookAt(
      focus.x + (Math.random() - 0.5) * jolt,
      focus.y + (Math.random() - 0.5) * jolt,
      focus.z,
    );
    // A crit pushes in, and the end of the fight holds a little closer.
    const close = this.outcome ? 1.2 : 0;
    this.camera.fov = FOV - this.punch * 1.4 * sway - close * sway;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    for (const actor of this.actors.values()) actor.dispose();
    this.actors.clear();
    this.effects.dispose();
    for (const pending of this.enemyTextures.values()) void pending.then((texture) => texture?.dispose());
    (this.backdrop.uniforms.map!.value as THREE.Texture | null)?.dispose();
    this.backdrop.dispose();
    this.shadowMaterial.map?.dispose();
    this.shadowMaterial.dispose();
    this.shadowQuad.dispose();
    this.quad.dispose();
    this.characterQuad.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
