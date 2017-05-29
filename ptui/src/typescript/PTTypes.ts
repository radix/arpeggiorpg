import * as JD from 'type-safe-json-decoder';
import { Decoder } from 'type-safe-json-decoder';
import * as Lodash from 'lodash';

type CreatureID = string;
type SceneID = string;
type AttrID = string;
type MapID = string;
type Color = string;

export interface App {
  snapshots: AppSnapshots
};

export type AppSnapshots = Array<{ snapshot: GameSnapshot, logs: Array<GameLog> }>

export interface GameSnapshot { };

export type GameLog =
  | {
    t: "AttributeCheckResult";
    cid: CreatureID;
    check: AttributeCheck;
    actual: number;
    success: boolean;
  }
  | { t: "CreateFolder"; path: string }
  | { t: "RenameFolder"; path: string; newName: string }
  | { t: "DeleteFolder"; path: string }
  | { t: "MoveFolderItem"; path: string; item: FolderItemID; newPath: string }
  | { t: "CreateNote"; path: string; note: Note }
  | { t: "EditNote"; path: string; name: string; newNote: Note }
  | { t: "DeleteNote"; path: string; name: string }
  | { t: "CreateScene"; path: string; scene: Scene }
  | { t: "EditScene"; scene: Scene }
  | { t: "DeleteScene"; scene_id: SceneID }
  | { t: "CreateMap"; path: string; map: Map }
  | { t: "StartCombat"; scene: SceneID; creatures: Array<{ cid: CreatureID; init: number }> }
  | { t: "StopCombat" }

export type FolderItemID =
  | { t: "SceneID"; id: SceneID }
  | { t: "MapID"; id: MapID }
  | { t: "CreatureID"; id: CreatureID }
  | { t: "NoteID"; id: string }
  | { t: "SubfolderID"; id: string }

interface Map {
  id: MapID,
  name: string,
  terrain: Array<Point3>,
  specials: Array<[Point3, Color, string, Visibility]>,
}

interface AttributeCheck {
  reliable: boolean;
  attr: AttrID;
  target: SkillLevel;
}

type SkillLevel = "Inept" | "Unskilled" | "Skilled" | "Expert" | "Supernatural"
let SkillLevel_values: Array<SkillLevel> = ["Inept", "Unskilled", "Skilled", "Expert", "Supernatural"];

interface Note {
  name: string,
  content: string,
}

interface Scene {
  id: SceneID,
  name: string,
  map: MapID,
  // creatures: { [index: string]: [Point3, Visibility] },
  // attribute_checks: { [index: string]: AttributeCheck },
}

type Point3 = [number, number, number];

export type Visibility =
  | { t: "GMOnly" }
  | { t: "AllPlayers" }

// CreateMap(FolderPath, Map),
// EditMap(Map),
// DeleteMap(MapID),
// CombatLog(CombatLog),
// /// A creature log wrapped in a game log.
// CreatureLog(CreatureID, CreatureLog),
// SetCreaturePos(SceneID, CreatureID, Point3),
// PathCreature(SceneID, CreatureID, Vec<Point3>),
// StartCombat(SceneID, Vec<(CreatureID, i16)>),
// StopCombat,
// CreateCreature(FolderPath, Creature),
// EditCreature(Creature),
// DeleteCreature(CreatureID),
// AddCreatureToCombat(CreatureID, i16),
// RemoveCreatureFromCombat(CreatureID),
// /// Indexes into snapshots and logs.
// Rollback(usize, usize),


/// Decoders

const decodePoint3: Decoder<Point3> = JD.tuple(JD.number(), JD.number(), JD.number());

const decodeVisibility: Decoder<Visibility> = JD.map((x): Visibility => {
  switch (x) {
    case "GMOnly": return { t: "GMOnly" };
    case "AllPlayers": return { t: "AllPlayers" };
    default: throw new Error(`Not a Visibility: ${x}.`);
  }
}, JD.string());

const decodeMap: Decoder<Map> = JD.object(
  ["id", JD.string()],
  ["name", JD.string()],
  ["terrain", JD.array(decodePoint3)],
  ["specials", JD.array(JD.tuple(decodePoint3, JD.string(), JD.string(), decodeVisibility))],
  (id, name, terrain, specials) => ({ id, name, terrain, specials })
);

const decodeSkillLevel: Decoder<SkillLevel> =
  JD.oneOf.apply(null, SkillLevel_values.map(JD.equal));

const decodeAttributeCheck: Decoder<AttributeCheck> =
  JD.object(["reliable", JD.boolean()], ["attr", JD.string()], ["target", decodeSkillLevel],
    (reliable, attr, target) => ({ reliable, attr, target }))

const decodeScene: Decoder<Scene> =
  JD.object(
    ["id", JD.string()],
    ["name", JD.string()],
    ["map", JD.string()],
    // ["creatures", JD.string()],
    // ["attribute_checks", JD.dict(decodeAttributeCheck)],
    (id, name, map,
      // creatures, 
      // attribute_checks
    ): Scene => ({
      id, name, map,
      //  creatures, 
      // attribute_checks
    })
  );
;

function _mkFolderItem(t: string): Decoder<FolderItemID> {
  return JD.map((id) => ({ t, id } as FolderItemID), JD.string());
}
const decodeFolderItemID: Decoder<FolderItemID> =
  sum<FolderItemID>("FolderItemID", {}, {
    "SceneID": _mkFolderItem("SceneID"),
    "MapID": _mkFolderItem("MapID"),
    "CreatureID": _mkFolderItem("CreatureID"),
    "NoteID": _mkFolderItem("NoteID"),
    "SubfolderID": _mkFolderItem("SubfolderID"),
  });

const decodeNote: Decoder<Note> =
  JD.object(
    ["name", JD.string()],
    ["content", JD.string()],
    (name, content) => ({ name, content })
  );


export const decodeGameLog: Decoder<GameLog> =
  sum<GameLog>("GameLog", { "StopCombat": { t: "StopCombat" } }, {
    "StartCombat": JD.map(
      ([scene, creatures]): GameLog => ({ t: "StartCombat", scene, creatures }),
      JD.tuple(
        JD.string(),
        JD.array(JD.map(([cid, init]) => ({ cid, init }), JD.tuple(JD.string(), JD.number())))
      )),
    "CreateFolder": JD.map((p): GameLog => ({ t: "CreateFolder", path: p }), JD.string()),
    "RenameFolder": JD.map(
      ([path, newName]): GameLog => ({ t: "RenameFolder", path, newName }),
      JD.tuple(JD.string(), JD.string())),
    "DeleteFolder": JD.map((path): GameLog => ({ t: "DeleteFolder", path }), JD.string()),
    "MoveFolderItem": JD.map(
      ([path, item, newPath]): GameLog => ({ t: "MoveFolderItem", path, item, newPath }),
      JD.tuple(JD.string(), decodeFolderItemID, JD.string())),
    "CreateNote": JD.map(
      ([path, note]): GameLog => ({ t: "CreateNote", path, note }),
      JD.tuple(JD.string(), decodeNote)),
    "EditNote": JD.map(
      ([path, name, newNote]): GameLog => ({ t: "EditNote", path, name, newNote }),
      JD.tuple(JD.string(), JD.string(), decodeNote)),
    "DeleteNote": JD.map(
      ([path, name]): GameLog => ({ t: "DeleteNote", path, name }),
      JD.tuple(JD.string(), JD.string())),
    "CreateScene": JD.map(
      ([path, scene]): GameLog => ({ t: "CreateScene", path, scene }),
      JD.tuple(JD.string(), decodeScene)),
    "EditScene": JD.map((scene): GameLog => ({ t: "EditScene", scene }), decodeScene),
    "DeleteScene": JD.map((scene_id): GameLog => ({ t: "DeleteScene", scene_id }), JD.string()),
    "CreateMap": JD.map(
      ([path, map]): GameLog => ({ t: "CreateMap", path, map }),
      JD.tuple(JD.string(), decodeMap)),
    "AttributeCheckResult": JD.map(
      ([cid, check, actual, success]): GameLog =>
        ({ t: "AttributeCheckResult", cid, check, actual, success }),
      JD.tuple(JD.string(), decodeAttributeCheck, JD.number(), JD.boolean())
    )
  });

export const decodeAppSnapshots: Decoder<AppSnapshots> =
  JD.array(JD.map(
    (ls) => ({ snapshot: {} as GameSnapshot, logs: ls }),
    JD.at([1], JD.array(decodeGameLog))))

// Utility Functions

export function sum<T>(
  name: string,
  nullaryValues: { [index: string]: T },
  decoders: { [index: string]: Decoder<T> }): Decoder<T> {
  /// This decoder is specific to the Serde-serialized JSON format:
  /// Nullary variants are just strings like "VariantName"
  /// Unary variants are {"VariantName": value}
  /// "tuple" variants are {"VariantName": [values, ...]}
  /// record variants are {"VariantName": {...}}

  function nullary(variant: string): T {
    if (nullaryValues.hasOwnProperty(variant)) {
      return nullaryValues[variant];
    } else {
      throw new Error(`Variant ${variant} is not a valid constructor for ${name}.`);
    }
  }

  let variants = Object.keys(decoders);
  let _decoders: Array<Decoder<T>> = variants.map(variant => JD.at([variant], decoders[variant]));

  return JD.oneOf(
    JD.map(nullary, JD.string()),
    JD.oneOf.apply(null, _decoders),
  );
}

function assertEq<T>(a: T, b: T, msg?: string) {
  if (!Lodash.isEqual(a, b)) {
    console.log("Not equal", a, "!==", b, msg);
    throw new Error(`Not equal (${msg}) ${a} !== ${b}`)
  }
}

function assertRaises(f: () => void, msg?: string) {
  try {
    f()
  } catch (e) {
    return;
  }
  throw new Error(`function did not raise (${msg}): ${f}.`)
}

export function test() {
  assertRaises(() => decodeSkillLevel.decodeAny("Foo"));
  assertEq(decodeSkillLevel.decodeAny("Skilled"), "Skilled");

  let exAttrCheck: AttributeCheck = { reliable: false, attr: "finesse", target: "Skilled" };
  assertEq(
    decodeAttributeCheck.decodeAny(exAttrCheck as any),
    exAttrCheck);

  let gameLogTests: [[any, any]] = [
    ["StopCombat", { t: "StopCombat" }],
    [
      { "StartCombat": ["coolScene", [["coolCreature", 5]]] },
      { t: "StartCombat", scene: "coolScene", creatures: [{ cid: "coolCreature", init: 5 }] }],
    [{ "CreateFolder": "foo/bar" }, { t: "CreateFolder", path: "foo/bar" }],
    [
      { "AttributeCheckResult": ["coolCreature", exAttrCheck, 50, true] },
      { t: "AttributeCheckResult", cid: "coolCreature", check: exAttrCheck, actual: 50, success: true }]
  ];
  for (let [x, y] of gameLogTests) {
    assertEq<GameLog>(decodeGameLog.decodeAny(x), y);
  }
  console.log("OK");
}

// test()
