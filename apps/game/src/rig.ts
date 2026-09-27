import {
  BoxGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  SphereGeometry,
  Texture,
  TextureLoader,
} from 'three/webgpu';
import { heightOf, postureOf, type FighterSpec, type FighterState, type HeightBand } from '@smkk/sim';

export const EMBLEM_URL = `${import.meta.env.BASE_URL}brand/shoemoney-emblem.png`;

let emblemTexture: Promise<Texture> | null = null;

/** One decode, shared by every gi in the bout. */
export function loadEmblem(url: string = EMBLEM_URL): Promise<Texture> {
  if (emblemTexture === null) {
    emblemTexture = new Promise<Texture>((resolve, reject) => {
      new TextureLoader().load(
        url,
        (texture) => {
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = 4;
          resolve(texture);
        },
        undefined,
        (error) => reject(error instanceof Error ? error : new Error(String(error))),
      );
    });
  }
  return emblemTexture;
}

/**
 * The fighter stands three-quarters on rather than in pure profile.
 *
 * Pure profile is the classic read, but a chest emblem in pure profile is a
 * line. Turning the body toward the camera keeps the side-on silhouette that
 * the spacing game depends on while giving the gi a front to wear a mark on.
 * In this local (pre-yaw) frame, "forward, toward the opponent" is +X, "up"
 * is +Y, and +Z runs across the fighter's shoulders/hips.
 */
const THREE_QUARTER_YAW = 0.62;

/** Which body part a technique animates. Never derived from display text. */
type TechniqueKind = 'punch' | 'kick' | 'knee' | 'sweep' | 'block';

/**
 * The 20 move ids the grammar can produce (packages/sim/src/grammar.ts),
 * mapped to the limb pair that performs them. This is the single source of
 * truth for "is this a kick" — never a string match on the display name.
 */
const MOVE_KIND: Readonly<Record<string, TechniqueKind>> = {
  lunge_punch: 'punch',
  jumping_punch: 'punch',
  crouching_punch: 'punch',
  stepping_lunge_punch: 'punch',
  back_fist: 'punch',
  reverse_punch: 'punch',
  somersault_kick: 'kick',
  crouching_reverse_punch: 'punch',
  back_kick: 'kick',
  spinning_back_kick: 'kick',
  front_kick: 'kick',
  jumping_front_kick: 'kick',
  rising_knee: 'knee',
  roundhouse_kick: 'kick',
  high_block: 'block',
  foot_sweep: 'sweep',
  jumping_sweep_kick: 'sweep',
  low_sweep: 'sweep',
  leg_sweep: 'sweep',
  low_block: 'block',
};

const GUARD_SHOULDER = 0.72;
const GUARD_ELBOW = -1.05;
const GUARD_HIP = 0.08;
const GUARD_KNEE = -0.15;

interface JointTargets {
  /** Angle at rest, between techniques. */
  readonly guard: number;
  /** Angle at the far end of startup, the instant before the strike fires. */
  readonly chamber: number;
  /** Angle for the whole `active` window — where the referee looks. */
  readonly active: number;
}

interface TechniquePose {
  readonly limb: 'arm' | 'leg';
  /** Shoulder for an arm technique, hip for a leg technique. */
  readonly primary: JointTargets;
  /** Elbow for an arm technique, knee for a leg technique. */
  readonly secondary: JointTargets;
}

/**
 * Chamber, then commit. Every technique pulls the limb away from guard during
 * startup and is at its target pose for the whole of `active` — the frame the
 * referee scores from never lies about reach.
 */
function techniquePose(kind: TechniqueKind, height: HeightBand): TechniquePose {
  switch (kind) {
    case 'punch': {
      const active = height === 'low' ? 0.85 : height === 'high' ? 1.55 : 1.3;
      return {
        limb: 'arm',
        primary: { guard: GUARD_SHOULDER, chamber: -0.4, active },
        secondary: { guard: GUARD_ELBOW, chamber: -2.3, active: -0.05 },
      };
    }
    case 'block': {
      const high = height === 'high';
      return {
        limb: 'arm',
        primary: { guard: GUARD_SHOULDER, chamber: GUARD_SHOULDER - 0.15, active: high ? 1.85 : 0.0 },
        secondary: { guard: GUARD_ELBOW, chamber: GUARD_ELBOW + 0.15, active: high ? -0.3 : -0.55 },
      };
    }
    case 'kick': {
      const active = height === 'low' ? 0.7 : height === 'high' ? 1.55 : 1.15;
      return {
        limb: 'leg',
        primary: { guard: GUARD_HIP, chamber: 1.7, active },
        secondary: { guard: GUARD_KNEE, chamber: -2.3, active: -0.12 },
      };
    }
    case 'knee': {
      // A knee strikes with the shin folded the whole time — it never snaps out.
      return {
        limb: 'leg',
        primary: { guard: GUARD_HIP, chamber: 1.5, active: 1.65 },
        secondary: { guard: GUARD_KNEE, chamber: -2.1, active: -2.05 },
      };
    }
    case 'sweep': {
      const active = height === 'high' ? 1.1 : 0.85;
      return {
        limb: 'leg',
        primary: { guard: GUARD_HIP, chamber: -0.45, active },
        secondary: { guard: GUARD_KNEE, chamber: -0.35, active: -0.08 },
      };
    }
  }
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function easeOutCubic(t: number): number {
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/** -1 (fully chambered) .. 0 (guard) .. 1 (fully committed, the active pose). */
function techniqueProgress(fighter: FighterState): number {
  const move = fighter.move;
  if (move === null) return 0;
  const t = fighter.phaseTicks;
  if (fighter.phase === 'startup') return -easeOutCubic(t / move.startup);
  if (fighter.phase === 'active') return 1;
  if (fighter.phase === 'recovery') return clamp01(1 - t / move.recovery);
  return 0;
}

function mix(targets: JointTargets, s: number): number {
  if (s < 0) return targets.guard + (targets.chamber - targets.guard) * -s;
  return targets.guard + (targets.active - targets.guard) * s;
}

/** How far a strike has reversed the counter-limb/torso twist, arm techniques. */
const REAR_COUNTER = 0.16;
const ARM_TWIST = 0.22;
const LEG_TWIST = 0.16;

/** Shared across every rig: shape never varies with fighter or colour. */
const geometry = {
  // Round stock, not lumber. The torso and hips are cylinders squashed on x
  // into an ellipse, tapered from chest to waist; limbs are capsules so the
  // joints meet in a curve instead of a corner.
  torso: new CylinderGeometry(0.21, 0.172, 0.6, 18, 1),
  hips: new CylinderGeometry(0.178, 0.192, 0.2, 16, 1),
  sash: new CylinderGeometry(0.206, 0.206, 0.09, 18, 1),
  lapel: new BoxGeometry(0.022, 0.2, 0.055),
  neck: new CylinderGeometry(0.062, 0.078, 0.13, 12),
  head: new SphereGeometry(0.152, 20, 16),
  shoulderCap: new SphereGeometry(0.06, 12, 10),
  upperArm: new CapsuleGeometry(0.052, 0.196, 4, 12),
  forearm: new CapsuleGeometry(0.045, 0.19, 4, 12),
  hand: new SphereGeometry(0.062, 12, 10),
  kneeCap: new SphereGeometry(0.058, 12, 10),
  thigh: new CapsuleGeometry(0.069, 0.262, 4, 12),
  shin: new CapsuleGeometry(0.056, 0.268, 4, 12),
  foot: new CapsuleGeometry(0.055, 0.11, 4, 10),
  cuff: new CylinderGeometry(1, 1, 1, 14),
  emblem: new PlaneGeometry(0.31, 0.31),
};

/** Chest and hips are elliptical: narrow front-to-back, broad shoulder to shoulder. */
const TORSO_SQUASH = 0.64;

/** Colour never varies with fighter for these: one instance, every rig. */
const skinMaterial = new MeshStandardMaterial({ color: '#d8a882', roughness: 0.75 });

const materialCache = new Map<string, MeshStandardMaterial>();

/** Two fighters that happen to share a colour also share the material. */
/** Multiplies a hex colour toward black, for seams and folds in the same cloth. */
function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number =>
    Math.max(0, Math.min(255, Math.round(((value >> shift) & 0xff) * factor)));
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}

function paint(color: string, roughness: number): MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  const cached = materialCache.get(key);
  if (cached !== undefined) return cached;
  const material = new MeshStandardMaterial({ color, roughness });
  materialCache.set(key, material);
  return material;
}

/** A cuff/trim band, its size baked into the mesh scale so the geometry stays shared. */
function band(material: MeshStandardMaterial, width: number, depth: number): Mesh {
  const mesh = new Mesh(geometry.cuff, material);
  mesh.scale.set(width / 2, 0.05, depth / 2);
  return mesh;
}

interface Limb {
  readonly shoulder: Group;
  readonly elbow: Group;
}

interface Leg {
  readonly hip: Group;
  readonly knee: Group;
}

export class FighterRig {
  readonly root = new Group();
  readonly emblem: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly body = new Group();
  private readonly torsoPivot = new Group();
  private readonly hipsPivot = new Group();
  private readonly leadArm: Limb;
  private readonly rearArm: Limb;
  private readonly leadLeg: Leg;
  private readonly rearLeg: Leg;
  private readonly head: Mesh;

  constructor(spec: FighterSpec, emblem: Texture) {
    const gi = paint(spec.giColor, 0.88);
    const trim = paint(spec.beltColor, 0.7);
    // A gi lapel is a seam in the same cloth, not a black strap. Belt-coloured
    // strips across the chest read as a harness and swallow the emblem.
    const lapelCloth = paint(shade(spec.giColor, 0.58), 0.95);

    this.body.add(this.hipsPivot, this.torsoPivot);
    this.root.add(this.body);

    // Hips carry the belt and stay put under the torso twist so a strike
    // reads as the shoulders and hips rotating together, feet still planted.
    const hips = new Mesh(geometry.hips, gi);
    hips.scale.x = TORSO_SQUASH;
    hips.position.y = 0.84;
    this.hipsPivot.add(hips);

    const sash = new Mesh(geometry.sash, trim);
    sash.scale.x = TORSO_SQUASH;
    sash.position.y = 0.9;
    this.hipsPivot.add(sash);

    const torso = new Mesh(geometry.torso, gi);
    torso.scale.x = TORSO_SQUASH;
    torso.position.y = 1.18;
    this.torsoPivot.add(torso);

    // An open V at the collar, not an X across the sternum. The lapels stop
    // above the chest plate on purpose: the emblem owns that space.
    // The torso is an ellipse now, so the chest surface falls away from centre.
    // A lapel parked at the centre-line depth would float in front of the ribs.
    const lapelLeft = new Mesh(geometry.lapel, lapelCloth);
    lapelLeft.position.set(0.122, 1.37, 0.088);
    lapelLeft.rotation.set(0.42, 0, -0.1);
    const lapelRight = new Mesh(geometry.lapel, lapelCloth);
    lapelRight.position.set(0.122, 1.37, -0.088);
    lapelRight.rotation.set(-0.42, 0, -0.1);
    this.torsoPivot.add(lapelLeft, lapelRight);

    const neck = new Mesh(geometry.neck, skinMaterial);
    neck.position.y = 1.49;
    this.torsoPivot.add(neck);

    this.head = new Mesh(geometry.head, skinMaterial);
    this.head.position.y = 1.63;
    this.torsoPivot.add(this.head);

    // The mark sits on the chest plate, a hair proud of the gi so it never
    // fights the torso for the same depth.
    this.emblem = new Mesh(
      geometry.emblem,
      new MeshStandardMaterial({
        map: emblem,
        transparent: true,
        alphaTest: 0.04,
        roughness: 0.85,
        metalness: 0,
      }),
    );
    this.emblem.name = 'gi-emblem';
    this.emblem.rotation.y = Math.PI / 2;
    this.emblem.position.set(0.139, 1.19, 0);
    this.torsoPivot.add(this.emblem);

    this.leadArm = this.buildArm(gi, trim, 0.215);
    this.rearArm = this.buildArm(gi, trim, -0.215);
    this.leadLeg = this.buildLeg(gi, trim, 0.11);
    this.rearLeg = this.buildLeg(gi, trim, -0.11);
  }

  private buildArm(gi: MeshStandardMaterial, trim: MeshStandardMaterial, z: number): Limb {
    const shoulder = new Group();
    shoulder.position.set(0.02, 1.46, z);
    this.torsoPivot.add(shoulder);

    const shoulderCap = new Mesh(geometry.shoulderCap, gi);
    shoulder.add(shoulderCap);

    const upperArm = new Mesh(geometry.upperArm, gi);
    upperArm.position.y = -0.15;
    shoulder.add(upperArm);

    const elbow = new Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);

    const elbowCap = new Mesh(geometry.shoulderCap, gi);
    elbowCap.scale.setScalar(0.85);
    elbow.add(elbowCap);

    const forearm = new Mesh(geometry.forearm, gi);
    forearm.position.y = -0.14;
    elbow.add(forearm);

    const cuff = band(trim, 0.1, 0.1);
    cuff.position.y = -0.29;
    elbow.add(cuff);

    const hand = new Mesh(geometry.hand, skinMaterial);
    hand.position.y = -0.34;
    elbow.add(hand);

    return { shoulder, elbow };
  }

  private buildLeg(gi: MeshStandardMaterial, trim: MeshStandardMaterial, z: number): Leg {
    const hip = new Group();
    hip.position.set(0.02, 0.84, z);
    this.body.add(hip);

    const thigh = new Mesh(geometry.thigh, gi);
    thigh.position.y = -0.2;
    hip.add(thigh);

    const knee = new Group();
    knee.position.y = -0.4;
    hip.add(knee);

    const kneeCap = new Mesh(geometry.kneeCap, gi);
    knee.add(kneeCap);

    const shin = new Mesh(geometry.shin, gi);
    shin.position.y = -0.19;
    knee.add(shin);

    const cuff = band(trim, 0.12, 0.12);
    cuff.position.y = -0.39;
    knee.add(cuff);

    const foot = new Mesh(geometry.foot, skinMaterial);
    foot.rotation.z = Math.PI / 2;
    foot.scale.y = 1;
    foot.scale.z = 0.92;
    foot.position.set(0.05, -0.42, 0);
    knee.add(foot);

    return { hip, knee };
  }

  apply(fighter: FighterState, elapsedTicks: number): void {
    this.root.position.x = fighter.x;
    this.root.rotation.y =
      fighter.facing === 1 ? -THREE_QUARTER_YAW : Math.PI + THREE_QUARTER_YAW;

    const posture = postureOf(fighter);
    const crouch = posture === 'crouch' ? -0.26 : 0;
    const bob = fighter.phase === 'neutral' ? Math.sin(elapsedTicks * 0.06) * 0.012 : 0;
    this.body.position.y = heightOf(fighter) + crouch + bob;

    const move = fighter.move;
    const s = techniqueProgress(fighter);
    const kind = move !== null ? MOVE_KIND[move.id] ?? (move.kind === 'block' ? 'block' : 'punch') : null;
    const pose = move !== null && kind !== null ? techniquePose(kind, move.height) : null;

    let leadShoulder = GUARD_SHOULDER;
    let leadElbow = GUARD_ELBOW;
    let leadHip = GUARD_HIP;
    let leadKnee = GUARD_KNEE;
    let rearShoulder = GUARD_SHOULDER * 0.85;
    let rearElbow = GUARD_ELBOW * 0.9;
    let rearHip = GUARD_HIP * 0.6;
    let rearKnee = GUARD_KNEE;
    let torsoTwist = 0;
    let hipsTwist = 0;

    if (pose !== null) {
      if (pose.limb === 'arm') {
        leadShoulder = mix(pose.primary, s);
        leadElbow = mix(pose.secondary, s);
        rearShoulder -= s * REAR_COUNTER;
        rearElbow += s * REAR_COUNTER * 0.6;
        torsoTwist = s * ARM_TWIST;
        hipsTwist = s * ARM_TWIST * 0.55;
      } else {
        leadHip = mix(pose.primary, s);
        leadKnee = mix(pose.secondary, s);
        rearShoulder -= s * REAR_COUNTER * 0.5;
        rearHip -= s * REAR_COUNTER * 0.4;
        torsoTwist = -s * LEG_TWIST * 0.6;
        hipsTwist = -s * LEG_TWIST;
      }
    }

    // A jump tucks whichever leg isn't busy throwing the technique.
    if (posture === 'air') {
      rearHip -= 0.2;
      rearKnee -= 0.5;
      if (pose === null || pose.limb !== 'leg') {
        leadHip += 0.3;
        leadKnee -= 0.35;
      }
    }

    this.leadArm.shoulder.rotation.z = leadShoulder;
    this.leadArm.elbow.rotation.z = leadElbow;
    this.rearArm.shoulder.rotation.z = rearShoulder;
    this.rearArm.elbow.rotation.z = rearElbow;
    this.leadLeg.hip.rotation.z = leadHip;
    this.leadLeg.knee.rotation.z = leadKnee;
    this.rearLeg.hip.rotation.z = rearHip;
    this.rearLeg.knee.rotation.z = rearKnee;
    this.torsoPivot.rotation.y = torsoTwist;
    this.hipsPivot.rotation.y = hipsTwist;
    this.head.rotation.z = -leadShoulder * 0.04;
  }
}
