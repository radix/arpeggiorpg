import * as I from 'immutable';
import "isomorphic-fetch";
import * as LD from 'lodash';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as JD from "type-safe-json-decoder";

import * as T from './PTTypes';

export type Action =
  | { type: "RefreshApp"; app: T.App }
  | { type: "RefreshGame"; game: T.Game; logs: Array<T.GameLog> }
  | { type: "DisplayError"; error: string }
  | { type: "ClearError" }

  | { type: "SetPlayerID"; pid: T.PlayerID; }

  | { type: "FocusGrid"; focus: GridFocus }
  | { type: "FocusSecondary"; focus: SecondaryFocus }

  | { type: "ActivateGridCreature"; cid: T.CreatureID; rect: Rect; }
  | {
    type: "DisplayMovementOptions"; cid?: T.CreatureID; options: Array<T.Point3>;
    teleport?: boolean;
  }
  | { type: "ClearMovementOptions" }
  | { type: "ToggleAnnotation"; pt: T.Point3; rect?: Rect }
  | {
    type: "DisplayPotentialTargets";
    cid: T.CreatureID; ability_id: T.AbilityID; options: T.PotentialTargets;
  }
  | { type: "ClearPotentialTargets" }
  | { type: "@@redux/INIT" };

export function update(ptui: PTUI, action: Action): PTUI {
  console.log("[Model.update]", action.type, action);
  switch (action.type) {
    case "RefreshApp":
      return new PTUI(ptui.rpi_url, action.app, ptui.state);
    case "RefreshGame":
      return update(ptui, { type: "RefreshApp", app: { ...ptui.app, current_game: action.game } });
    case "ActivateGridCreature":
      const new_active =
        (ptui.state.grid.active_menu && ptui.state.grid.active_menu.cid === action.cid)
          ? undefined
          : { cid: action.cid, rect: action.rect };
      return ptui.updateState(
        state => ({ ...state, grid: { ...ptui.state.grid, active_menu: new_active } }));
    case "SetPlayerID":
      return ptui.updateState(state => ({ ...state, player_id: action.pid }));

    case "FocusGrid":
      switch (action.focus.t) {
        case "Scene":
          const scene_id = action.focus.scene_id;
          return ptui.updateState(state => ({ ...state, grid_focus: { t: "Scene", scene_id } }));
        case "Map":
          const map = ptui.getMap(action.focus.map_id);
          const terrain = map ? I.Set(map.terrain.map(pt => I.List(pt)))
            : I.Set();
          const specials: I.Map<I.List<number>, T.SpecialTileData> = map
            ? I.Map(map.specials.map(
              ([pt, color, note, vis]): [I.List<number>, T.SpecialTileData] =>
                [I.List(pt), [color, note, vis]]))
            : I.Map();
          return ptui.updateState(
            state => ({
              ...state, grid_focus: {
                ...action.focus, terrain, specials,
                painting: { t: "Terrain" },
              },
            }));
      }
      return ptui; // this should not be necessary, exhaustiveness checks *should* realize it's not
    case "FocusSecondary":
      return ptui.updateState(state => ({ ...state, secondary_focus: action.focus }));

    // Grid-related
    case "ToggleAnnotation":
      const curDisplay = ptui.state.grid.display_annotation;
      const nv =
        (curDisplay && isEqual(curDisplay.pt, action.pt)) || !action.rect
          ? undefined
          : { pt: action.pt, rect: action.rect };
      return ptui.updateGridState(grid => ({ ...grid, display_annotation: nv }));
    case "DisplayMovementOptions":
      return ptui.updateGridState(
        grid => ({
          ...grid,
          movement_options: {
            cid: action.cid, options: action.options,
            teleport: action.teleport ? true : false,
          },
        }));
    case "DisplayPotentialTargets":
      const { cid, ability_id, options } = action;
      return ptui.updateGridState(
        grid => ({ ...grid, target_options: { cid, ability_id, options } }));
    case "ClearPotentialTargets":
      return ptui.updateGridState(grid => ({ ...grid, target_options: undefined }));
    case "ClearPotentialTargets":
      return ptui.updateGridState(grid => ({ ...grid, target_options: undefined }));
    case "ClearMovementOptions":
      return ptui.updateGridState(grid => ({ ...grid, movement_options: undefined }));

    case "DisplayError":
      return ptui.updateState(state => ({ ...state, error: action.error }));
    case "ClearError":
      return ptui.updateState(state => ({ ...state, error: undefined }));
    case "@@redux/INIT":
      return ptui;
  }
}

export interface Rect { nw: SVGPoint; ne: SVGPoint; se: SVGPoint; sw: SVGPoint; }

export interface GridModel {
  active_menu?: { cid: T.CreatureID; rect: Rect };
  movement_options?: {
    cid?: T.CreatureID; // undefined when we're moving in combat
    options: Array<T.Point3>;
    teleport: boolean;
  };
  display_annotation?: { pt: T.Point3, rect: Rect };
  target_options?: { cid: T.CreatureID; ability_id: T.AbilityID; options: T.PotentialTargets; };
}

export interface PTUIState {
  grid: GridModel;
  player_id?: T.PlayerID;
  error?: string;
  grid_focus?: GridFocus;
  secondary_focus?: SecondaryFocus;
}

export type GridFocus =
  | { t: "Scene"; scene_id: T.SceneID; }
  | { t: "Map"; map_id: T.MapID; }
  ;

export type SecondaryFocus =
  | { t: "Note"; path: T.FolderPath; name: string | undefined; }
  | { t: "Creature"; creature_id: T.CreatureID; }
  | { t: "Item"; item_id: T.ItemID; }
  ;


export function decodeFetch<J>(
  url: string, init: RequestInit | undefined,
  decoder: JD.Decoder<J>): Promise<J> {
  const p: Promise<Response> = fetch(url, init);
  const p2: Promise<any> = p.then(response => response.json());
  return p2.then(json => {
    try {
      return decoder.decodeAny(json);
    } catch (e) {
      throw { _pt_error: "JSON", original: e };
    }
  });
}

export function ptfetch<J, R>(
  dispatch: Dispatch, url: string, init: RequestInit | undefined,
  decoder: JD.Decoder<J>, then: (result: J) => R)
  : Promise<R> {
  const json_promise = decodeFetch(url, init, decoder);
  const p4: Promise<R> = json_promise.then(then);
  const p5: Promise<R> = p4.catch(
    e => {
      function extract_error_details(error: any): [string, string] {
        if (error._pt_error) {
          switch (error._pt_error) {
            case "JSON": return ["Failed to decode JSON", error.original];
            case "RPI": return ["Error received from server", error.message];
            default: return ["Unknown error", error.toString()];
          }
        } else {
          return ["Unknown error", error.toString()];
        }
      }

      const [prefix, suffix] = extract_error_details(e);
      dispatch({ type: "DisplayError", error: `${prefix}: ${suffix}` });
      throw e;
    });
  return p5;
}

export class PTUI {
  readonly app: T.App;
  readonly state: PTUIState;
  rpi_url: string;

  constructor(rpi_url: string, app: T.App, state: PTUIState = { grid: {} }) {
    this.app = app;
    this.state = state;
    this.rpi_url = rpi_url;
  }

  startPoll(dispatch: Dispatch) {
    function poll(rpi_url: string, app: T.App) {
      const num_snaps = app.snapshots.length;
      const snaps = app.snapshots[num_snaps - 1];
      const num_logs = snaps ? snaps.logs.length : 0;
      const url = `${rpi_url}poll/${num_snaps}/${num_logs}`;
      return ptfetch(dispatch, url, undefined, T.decodeApp,
        app => {
          dispatch({ type: "RefreshApp", app });
          poll(rpi_url, app);
        }
      );
    }
    poll(this.rpi_url, this.app);
  }

  updateState(updater: (state: PTUIState) => PTUIState): PTUI {
    return new PTUI(this.rpi_url, this.app, updater(this.state));
  }
  updateGridState(updater: (state: GridModel) => GridModel): PTUI {
    return this.updateState(state => ({ ...state, grid: updater(state.grid) }));
  }

  requestMove(dispatch: Dispatch, cid: T.CreatureID) {
    const scene = this.focused_scene();
    if (scene) {
      return ptfetch(dispatch, this.rpi_url + "/movement_options/" + scene.id + "/" + cid,
        undefined,
        JD.array(T.decodePoint3),
        options => dispatch({
          type: "DisplayMovementOptions",
          cid,
          options,
        }));
    }
  }

  moveCreature(dispatch: Dispatch, creature_id: T.CreatureID, dest: T.Point3) {
    dispatch({ type: "ClearMovementOptions" });
    const scene = this.focused_scene();
    if (scene) {
      this.sendCommand(dispatch, { t: "PathCreature", scene_id: scene.id, creature_id, dest });
    } else {
      throw new Error(`Tried moving when there is no scene`);
    }
  }

  setCreaturePos(dispatch: Dispatch, creature_id: T.CreatureID, dest: T.Point3) {
    dispatch({ type: 'ClearMovementOptions' });
    const scene = this.focused_scene();
    if (scene) {
      this.sendCommand(dispatch, { t: 'SetCreaturePos', scene_id: scene.id, creature_id, dest });
    }
  }

  moveCombatCreature(dispatch: Dispatch, dest: T.Point3) {
    dispatch({ type: "ClearMovementOptions" });
    this.sendCommand(dispatch, { t: "PathCurrentCombatCreature", dest });
  }

  sendCommand(dispatch: Dispatch, cmd: T.GameCommand): void {
    return sendCommand(cmd)(dispatch, () => this, undefined);
  }

  /// Send a Command and *don't* automatically handle errors.
  sendCommandWithResult(cmd: T.GameCommand)
    : Promise<T.RustResult<Array<T.GameLog>, string>> {
    const json = T.encodeGameCommand(cmd);
    console.log("[sendCommand:JSON]", json);
    const rpi_result = decodeFetch(
      this.rpi_url,
      {
        method: "POST",
        body: JSON.stringify(json),
        headers: { "content-type": "application/json" },
      },
      T.decodeRustResult(
        JD.map(
          ([_, logs]) => logs,
          T.decodeSendCommandResult),
        JD.string())
    );
    return rpi_result;
  }

  fetchSavedGames(dispatch: Dispatch): Promise<Array<string>> {
    return ptfetch(dispatch, this.rpi_url + 'saved_games', undefined, JD.array(JD.string()),
      x => x);
  }

  loadGame(dispatch: Dispatch, game: string): Promise<undefined> {
    return ptfetch(dispatch, `${this.rpi_url}saved_games/${game}/load`, { method: 'POST' },
      JD.succeed(undefined), x => x);
  }

  saveGame(dispatch: Dispatch, game: string): Promise<undefined> {
    return ptfetch(dispatch, `${this.rpi_url}/saved_games/${game}`, { method: 'POST' },
      JD.succeed(undefined), x => x);
  }

  focused_scene(): T.Scene | undefined {
    // oh for Rust's "?" operator
    const pid = this.state.player_id;
    if (pid) {
      const player = this.app.players.get(pid);
      if (player && player.scene) {
        return get(this.app.current_game.scenes, player.scene);
      }
    } else if (this.state.grid_focus && this.state.grid_focus.t === "Scene") {
      return get(this.app.current_game.scenes, this.state.grid_focus.scene_id);
    }
  }

  requestCombatMovement(dispatch: Dispatch) {
    return ptfetch(
      dispatch, this.rpi_url + "/combat_movement_options", undefined,
      JD.array(T.decodePoint3),
      options => dispatch({ type: "DisplayMovementOptions", options }));
  }

  selectAbility(
    dispatch: Dispatch, scene_id: T.SceneID, cid: T.CreatureID, ability_id: T.AbilityID) {
    ptfetch(dispatch,
      `${this.rpi_url}/target_options/${scene_id}/${cid}/${ability_id}`,
      undefined,
      T.decodePotentialTargets,
      options => dispatch({ type: "DisplayPotentialTargets", cid, ability_id, options }));
  }

  requestCombatAbility(
    dispatch: Dispatch, cid: T.CreatureID, ability_id: T.AbilityID, ability: T.Ability,
    scene_id: T.SceneID) {
    switch (ability.target.t) {
      case "Actor": return this.sendCommand(
        dispatch, { t: "CombatAct", ability_id, target: { t: "Actor" } });
      default: this.selectAbility(dispatch, scene_id, cid, ability_id);
    }
  }

  /** Execute an ability that has already been selected, with a target.
   * This relies on the state being set up ahead of time: we must have a target_options already.
   */
  executeCombatAbility(dispatch: Dispatch, target_id: T.CreatureID) {
    const opts = this.state.grid.target_options;
    if (!opts) { throw new Error(`Can't execute an ability if we haven't selected it first.`); }
    const { ability_id, options } = opts;
    if (options.t !== "CreatureIDs") { throw new Error(`Only support CreatureIDs for now`); }
    const target: T.DecidedTarget = { t: "Creature", creature_id: target_id };
    this.sendCommand(dispatch, { t: "CombatAct", ability_id, target });
    dispatch({ type: "ClearPotentialTargets" });
  }

  // Utility functions for interacting with the model
  // TODO: Consider making Game, Combat, Folder classes and moving these methods to those classes.
  // But I'm not sure it'd really matter -- if I find myself really needing to increase isolation
  // then it would be a good way forward, but I'm not sure it will be necessary.
  getCreature(cid: T.CreatureID): T.Creature | undefined {
    return getCreature(this.app, cid);
  }

  getCreatures(cids: Array<T.CreatureID>): Array<T.Creature> {
    return getCreatures(this.app, cids);
  }

  getItem(iid: T.ItemID): T.Item | undefined {
    return get(this.app.current_game.items, iid);
  }

  getItems(iids: Array<T.ItemID>): Array<T.Item> {
    return LD.sortBy(
      filterMap(iids, iid => this.getItem(iid)),
      i => i.name);
  }

  getScene(scene_id: T.SceneID): T.Scene | undefined {
    return get(this.app.current_game.scenes, scene_id);
  }
  getScenes(scene_ids: Array<T.SceneID>): Array<T.Scene> {
    return LD.sortBy(
      filterMap(scene_ids, sid => this.getScene(sid)),
      s => s.name);
  }
  getMap(mid: T.MapID): T.Map | undefined {
    return get(this.app.current_game.maps, mid);
  }
  getMaps(map_ids: Array<T.MapID>): Array<T.Map> {
    return LD.sortBy(
      filterMap(map_ids, mid => this.getMap(mid)),
      m => m.name);
  }

  getNote(path: T.FolderPath, name: string): T.Note | undefined {
    const fnode = this.getFolderNode(path);
    if (fnode && fnode.notes.hasOwnProperty(name)) {
      return fnode.notes[name];
    }
  }

  getFolderNode(path: T.FolderPath): T.FolderNode | undefined {
    let cur: T.Folder | undefined = this.app.current_game.campaign;
    for (const seg of path) {
      cur = cur.children.get(seg);
      if (!cur) { return undefined; }
    }
    return cur.data;
  }

  getCurrentCombatCreatureID(combat: T.Combat): T.CreatureID {
    const entry = idx(combat.creatures.data, combat.creatures.cursor);
    if (!entry) { throw new Error(`No combat creature at ${combat.creatures.cursor}`); }
    return entry[0];
  }

  getCurrentCombatCreature(combat: T.Combat): T.Creature {
    const cid = this.getCurrentCombatCreatureID(combat);
    const creature = this.getCreature(cid);
    if (!creature) { throw new Error(`Current combat creature does not exist: ${cid}`); }
    return creature;
  }

  creatureIsInCombat(combat: T.Combat, creature_id: T.CreatureID): boolean {
    return LD.find(
      combat.creatures.data,
      ([cid, _]) => cid === creature_id) !== undefined;
  }

  getSceneCreatures(scene: T.Scene): Array<T.Creature> {
    return this.getCreatures(scene.creatures.keySeq().toArray());
  }

  getSceneInventory(scene: T.Scene): I.List<[T.Item, number]> {
    const arr = filterMap(scene.inventory.entrySeq().toArray(),
      ([iid, count]) => optMap(this.getItem(iid), (i): [T.Item, number] => [i, count]));
    const list = I.List(arr);
    return list.sortBy(([i, _]) => i.name);
  }
}

export function filterMap<T, R>(coll: Array<T>, f: (t: T) => R | undefined): Array<R> {
  // I can't "naturally" convince TypeScript that this filter makes an
  // Array<R> instead of Array<R|undefined>, hence the assertion
  return coll.map(f).filter(el => el) as Array<R>;
}

export function filterMapValues<T, R>
  (obj: { [index: string]: T }, f: (val: T) => R | undefined): { [index: string]: R } {
  const result: { [index: string]: R } = {};
  for (const key of LD.keys(obj)) {
    const new_val = f(obj[key]);
    if (new_val !== undefined) { result[key] = new_val; }
  }
  return result;
}

type Inventory = I.Map<T.ItemID, number>;

// TODO: these functions should be replaced by GameCommands so the backend handles this stuff
export function addToInventory(inventory: Inventory, item_id: T.ItemID, count: number): Inventory {
  return inventory.set(item_id, inventory.get(item_id, 0) + count);
}

// TODO: this allows over-withdrawing from the inventory.
export function removeFromInventory(inventory: Inventory, item_id: T.ItemID, count: number):
  Inventory {
  const new_count = inventory.get(item_id, 0) - count;
  if (new_count <= 0) {
    return inventory.delete(item_id);
  } else {
    return inventory.set(item_id, new_count);
  }
}

export function folderPathToString(path: T.FolderPath): string {
  if (isEqual(path, [])) {
    return "Campaign Root";
  }
  return T.encodeFolderPath(path);
}

export function get<T>(obj: { [index: string]: T }, key: string): T | undefined {
  return obj[key];
}

export function idx<T>(arr: Array<T>, index: number): T | undefined {
  return arr[index];
}

/// A version of isEqual that requires both arguments to be the same type.
export function isEqual<T>(l: T, r: T): boolean {
  return LD.isEqual(l, r);
}

export function optMap<T, R>(x: T | undefined, f: ((t: T) => R)): R | undefined {
  if (x !== undefined) {
    return f(x);
  }
}

export function creatureIsInCombat(combat: T.Combat, creature_id: T.CreatureID): boolean {
  return LD.find(
    combat.creatures.data,
    ([cid, _]) => cid === creature_id) !== undefined;
}

export function getSceneCreatures(app: T.App, scene: T.Scene) {
  return getCreatures(app, scene.creatures.keySeq().toArray());
}

export function getCreatures(app: T.App, cids: Array<T.CreatureID>): Array<T.Creature> {
  return LD.sortBy(filterMap(cids, cid => getCreature(app, cid)), (c: T.Creature) => c.name);
}

export function getCreature(app: T.App, cid: T.CreatureID): T.Creature | undefined {
  return app.current_game.creatures.get(cid);
}


export const sendCommand = (cmd: T.GameCommand): ThunkAction<void> =>
  (dispatch, getState) => {
    const ptui = getState();
    const json = T.encodeGameCommand(cmd);
    console.log("[sendCommand:JSON]", json);
    ptfetch(
      dispatch,
      ptui.rpi_url,
      {
        method: "POST",
        body: JSON.stringify(json),
        headers: { "content-type": "application/json" },
      },
      T.decodeRustResult(T.decodeSendCommandResult, JD.string()),
      (x: T.RustResult<[T.Game, Array<T.GameLog>], string>) => {
        switch (x.t) {
          case "Ok":
            dispatch({ type: "RefreshGame", game: x.result[0], logs: x.result[1] });
            return;
          case "Err":
            throw { _pt_error: 'RPI', message: x.error };
        }
      });
  };

export const sendCommands = (cmds: Array<T.GameCommand>): ThunkAction<void> =>
  (dispatch, getState) => {
    for (const cmd of cmds) {
      sendCommand(cmd)(dispatch, getState, undefined);
    }
  };

// We define our own Dispatch type instead of using Redux.Dispatch because Redux.Dispatch does not
// have a type-parameter for the *type of Action*, only the *type of Store*. We don't want to allow
// call-sites to be able to dispatch action objects that don't actually fit the format of the
// `Action` interface (above), so we define our own more specific one.
export type Dispatch = (action: Action | ThunkAction<void>) => void;

type ThunkAction<R> = (dispatch: Dispatch, getState: () => PTUI, extraArgument: undefined) => R;


export interface DispatchProps { dispatch: Dispatch; }
export interface ReduxProps extends DispatchProps { ptui: PTUI; }

export function connectRedux<BaseProps extends {} & object>(
  x: React.ComponentType<BaseProps & ReduxProps>)
  : React.ComponentType<BaseProps> {
  const connector = ReactRedux.connect((ptui, _) => ({ ptui }), dispatch => ({ dispatch }));
  // Something in @types/react-redux between 4.4.43 and 4.4.44 changed, and so I needed to add this
  // `as any`, when I didn't need it previously.
  return (connector as any)(x);
}


export function specialsMapToRPI(specials: I.Map<I.List<number>, T.SpecialTileData>):
  Array<[T.Point3, T.Color, string, T.Visibility]> {
  return specials.entrySeq().toArray().map(
    ([pt, [color, note, vis]]): [T.Point3, T.Color, string, T.Visibility] =>
      [[pt.get(0)!, pt.get(1)!, pt.get(2)!], color, note, vis]);
}

export function specialsRPIToMap(specials: Array<[T.Point3, T.Color, string, T.Visibility]>)
  : I.Map<I.List<number>, T.SpecialTileData> {
  return I.Map(specials.map(
    ([pt, color, note, vis]): [I.List<number>, T.SpecialTileData] =>
      [I.List(pt), [color, note, vis]]));
}