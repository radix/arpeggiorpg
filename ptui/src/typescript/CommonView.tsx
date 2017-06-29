import * as I from 'immutable';
import * as LD from "lodash";
import * as React from "react";
import PanelGroup from 'react-panelgroup';
import { Provider } from 'react-redux';
import * as WindowSizeListener from 'react-window-size-listener';
import * as Redux from 'redux';

// import 'semantic-ui-css/semantic.min.css';
import {
  Accordion, Button, Dropdown, Form, Header, Icon, Input, Label, List, Menu, Message, Modal, Segment
} from 'semantic-ui-react';


import { PTUI } from './Model';
import * as M from './Model';
import * as T from './PTTypes';
import * as TextInput from './TextInput';

/** The threshold at which we switch from narrow to wide view.
 * I chose 500 because it's between portait and landscape mode on pretty much all phones, so
 * any phone user that switches to landscape mode should switch to wide view.
 */
const NARROW_THRESHOLD = 500;


interface MainProps {
  app?: object;
  rpi_url: string;
}
export class Main extends React.Component<MainProps, { store: Redux.Store<M.PTUI> | undefined; }> {
  app?: object;
  rpi_url: string;

  constructor(props: MainProps) {
    super(props);
    const ptui = props.app
      ? new M.PTUI(props.rpi_url, T.decodeApp.decodeAny(props.app))
      : undefined;
    const store = ptui ? Redux.createStore(M.update, ptui) : undefined;
    this.state = { store };
  }

  componentWillReceiveProps(nextProps: MainProps) {
    if (!M.isEqual(this.props, nextProps)) {
      if (this.state.store) {
        if (nextProps.app) {
          this.state.store.dispatch(
            { type: "RefreshApp", app: T.decodeApp.decodeAny(nextProps.app) });
        }
      } else {
        if (nextProps.app) {
          const ptui = new M.PTUI(
            nextProps.rpi_url, T.decodeApp.decodeAny(nextProps.app));
          const store = Redux.createStore(M.update, ptui);
          this.setState({ store });
        }
      }
    }
  }

  render(): JSX.Element {
    if (!this.state.store) {
      return <div>Waiting for initial data from server.</div>;
    }
    const ptui = this.state.store.getState();
    return <Provider store={this.state.store}>{this.props.children}</Provider>;
  }
}

export const CreatureCard = M.connectRedux(
  function CreatureCard(
    props: { creature: T.Creature; children?: JSX.Element | Array<JSX.Element>; menu?: JSX.Element }
      & M.ReduxProps): JSX.Element {
    const creature = props.creature;
    return <Segment style={{ width: "100%" }} raised={true}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ display: "flex" }}>
          <CreatureIcon app={props.ptui.app} creature={creature} size={80} />
          <div>
            <div style={{ display: "flex" }}>
              <Header>{creature.name}</Header> {classIcon(creature)}
            </div>
            <div>{LD.values(creature.conditions).map(ac => conditionIcon(ac.condition))}</div>
            {props.children}
          </div>
        </div>
        {props.menu}
      </div>
    </Segment>;

  });

export function classIcon(creature: T.Creature): string {
  switch (creature.class_) {
    case "cleric": return "💉";
    case "rogue": return "🗡️";
    case "ranger": return "🏹";
    case "creature": return "🙂";
    case "baddie": return "👹";
    default: return "";
  }
}

function square_style(size: number = 50) {
  return {
    width: `${size}px`, height: `${size}px`,
    borderRadius: "10px", border: "solid 1px black",
  };
}

export function CreatureIcon(
  { size = 50, app, creature }: { size?: number, app: T.App, creature: T.Creature }
): JSX.Element | null {
  if (creature.portrait_url !== "") {
    return <SquareImageIcon size={size} url={creature.portrait_url} />;
  } else {
    const class_ = app.current_game.classes.get(creature.class_);
    const color = class_ ? class_.color : "red";
    return <div style={{ backgroundColor: color, ...square_style(size) }}>{creature.name}</div>;
  }
}

export function SquareImageIcon({ url, size = 50 }: { url: string, size?: number }): JSX.Element {
  return <img src={url} style={square_style(size)} />;
}

export const CollapsibleInventory = M.connectRedux(
  function CollapsibleInventory({ creature }: { creature: T.Creature }): JSX.Element {
    return <Accordion panels={[{
      title: "Inventory",
      content: <CreatureInventory creature={creature} />,
    }]} />;
  });

interface CreatureInventoryProps {
  creature: T.Creature;
}
export const CreatureInventory = M.connectRedux(
  function CreatureInventory({ creature, ptui }: CreatureInventoryProps & M.ReduxProps)
    : JSX.Element {
    const inv = creature.inventory;
    const items = ptui.getItems(inv.keySeq().toArray());

    return <List relaxed={true}>
      {items.map(item => {
        const count = inv.get(item.id);
        if (!count) { return; }
        return <List.Item key={item.id}
          style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={{ flex: "1" }}>{item.name} ({inv.get(item.id)})</div>
          <Label circular={true}>
            <Dropdown text={count.toString()} icon='caret down'
              className='right' pointing={true} floating={true}>
              <Dropdown.Menu>
                <Dropdown.Header content={item.name} />
                <ModalMaker
                  button={open => <Dropdown.Item onClick={open} content='Give' />}
                  modal={close => [
                    <Modal.Header>Give {item.name}</Modal.Header>,
                    <Modal.Content>
                      <GiveItem giver={creature} item={item} onClose={close} />
                    </Modal.Content>
                  ]} />
                <ModalMaker
                  button={open => <Dropdown.Item onClick={open} content='Delete' />}
                  modal={close => [
                    <Modal.Header>Delete {item.name}</Modal.Header>,
                    <Modal.Content>
                      <DeleteItem creature={creature} item={item} onClose={close} />
                    </Modal.Content>
                  ]} />
              </Dropdown.Menu>
            </Dropdown>
          </Label>
        </List.Item>;
      }
      )}
    </List>;

  }
);

interface DeleteItemProps { creature: T.Creature; item: T.Item; onClose: () => void; }
class DeleteItemComp
  extends React.Component<DeleteItemProps & M.ReduxProps, { count: number | undefined }> {
  constructor(props: DeleteItemProps & M.ReduxProps) {
    super(props);
    this.state = { count: 1 };
  }
  render(): JSX.Element {
    const { creature, item, onClose } = this.props;
    const max_count = creature.inventory.get(item.id);
    if (!max_count) {
      return <div>No more!</div>;
    }
    return <Form>
      <Message>
        You have {creature.inventory.get(item.id)} of this item. How many would you like to delete?
      </Message>
      <PositiveIntegerInput label="count" max={max_count} value={this.state.count}
        onChange={num => this.setState({ count: num })} />
      <Form.Group>
        <Form.Button disabled={!this.state.count} onClick={() => this.delete()}>Delete</Form.Button>
        <Form.Button onClick={() => onClose()}>Cancel</Form.Button>
      </Form.Group>
    </Form>;
  }

  delete() {
    const { creature, item, onClose, ptui, dispatch } = this.props;
    const count = this.state.count;
    const has_count = creature.inventory.get(item.id);
    if (!(count && has_count)) { return; }
    const new_count = has_count - count;
    const inventory = new_count <= 0
      ? creature.inventory.delete(item.id)
      : creature.inventory.set(item.id, new_count);
    ptui.sendCommand(dispatch, { t: "EditCreature", creature: { ...creature, inventory } });
    onClose();
  }
}
export const DeleteItem = M.connectRedux(DeleteItemComp);

interface GiveItemProps {
  item: T.Item;
  giver: T.Creature;
  onClose: () => void;
}
export class GiveItemComp extends React.Component<
  GiveItemProps & M.ReduxProps,
  { receiver: T.CreatureID | undefined; count: number | undefined }> {
  constructor(props: GiveItemProps & M.ReduxProps) {
    super(props);
    this.state = { receiver: undefined, count: 1 };
  }
  render(): JSX.Element {
    const { item, giver, ptui } = this.props;
    const scene = this.props.ptui.focused_scene();
    if (!scene) { return <div>You can only transfer items in a scene.</div>; }
    const other_cids_in_scene = I.Set(scene.creatures.keySeq().toArray())
      .delete(this.props.giver.id).toArray();
    const other_creatures = ptui.getCreatures(other_cids_in_scene);
    if (!other_creatures) { return <div>There is nobody in this scene to give items to.</div>; }
    const giver_count = giver.inventory.get(item.id);
    if (!giver_count) { return <div>{giver.name} does not have any {item.name} to give.</div>; }
    const creature_options = other_creatures.map(
      creature => ({ key: creature.id, text: creature.name, value: creature.id }));
    return <Form>
      <Message>
        You have {giver.inventory.get(item.id)} of this item. How many would you like to delete?
      </Message>
      <Form.Group>
        <PositiveIntegerInput max={giver_count} label="Count" value={this.state.count}
          onChange={num => this.setState({ count: num })} />
        <Form.Select label="Creature" options={creature_options}
          placeholder="Select a Creature"
          onChange={(_, ev) => this.setState({ receiver: ev.value as T.CreatureID })} />
      </Form.Group>
      <Form.Group>
        <Form.Button
          disabled={!(this.state.receiver && this.state.count)}
          onClick={ev => this.give(giver)}>
          Give
            </Form.Button>
        <Form.Button onClick={ev => this.props.onClose()}>Cancel</Form.Button>
      </Form.Group>
    </Form>;
  }

  give(giver: T.Creature) {
    const count = this.state.count as number; // Protected by button `disabled`
    const receiver_id = this.state.receiver as T.CreatureID; // Protected by button `disabled`
    const receiver = this.props.ptui.app.current_game.creatures.get(receiver_id);
    if (!receiver) {
      console.log("[give] Receiver has disappeared", receiver_id);
      this.props.onClose();
      return;
    }

    const newGiver = LD.assign({}, giver,
      { inventory: M.removeFromInventory(giver.inventory, this.props.item.id, count) });
    const newReceiver = LD.assign({}, receiver,
      { inventory: M.addToInventory(receiver.inventory, this.props.item.id, count) });

    this.props.ptui.sendCommand(this.props.dispatch, { t: "EditCreature", creature: newGiver });
    this.props.ptui.sendCommand(this.props.dispatch, { t: "EditCreature", creature: newReceiver });
    this.props.onClose();
  }
}
export const GiveItem = M.connectRedux(GiveItemComp);


interface PositiveIntegerInputProps {
  max?: number; value: number | undefined;
  label?: string;
  onChange: (num: number | undefined) => void;
}
export class PositiveIntegerInput
  extends React.Component<PositiveIntegerInputProps & { [index: string]: any }, undefined> {
  render(): JSX.Element {
    return <Form.Input
      {...this.props}
      label={this.props.label}
      value={this.props.value === undefined ? "" : this.props.value}
      onChange={event => {
        let num = Number(event.currentTarget.value);
        if (event.currentTarget.value === "") {
          this.props.onChange(undefined);
        } else if (num) {
          if (this.props.max !== undefined && num > this.props.max) { num = this.props.max; }
          this.props.onChange(num);
        }
      }} />;
  }
}

export function conditionIcon(cond: T.Condition): string {
  switch (cond.t) {
    case "RecurringEffect": return cond.effect.toString();
    case "Dead": return "💀";
    case "Incapacitated": return "😞";
    case "AddDamageBuff": return "😈";
    case "DoubleMaxMovement": return "🏃";
    case "ActivateAbility": return "Ability Activated: " + cond.ability_id;
  }
}

type MenuSize = 'mini' | 'tiny' | 'small' | 'large' | 'huge' | 'massive';

interface TabbedViewProps {
  children: Array<JSX.Element | null>;
  menu_size: MenuSize;
}
export class TabbedView extends React.Component<TabbedViewProps, { selected: number }> {

  constructor(props: TabbedViewProps) {
    super(props);
    this.state = { selected: 0 };
  }

  render(): JSX.Element {
    const children_ = React.Children.map(
      this.props.children,
      c => c);
    const children: Array<Tab> = M.filterMap(
      children_, (c: any) => { if (c && c.type === Tab) { return c; } });
    if (!M.idx<JSX.Element | null>(this.props.children, this.state.selected)) {
      return <div>woops</div>;
    }
    return <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Menu pointing={true} compact={true} size={this.props.menu_size} secondary={true}>
        {children.map((child, index) =>
          <Menu.Item key={child.props.name} name={child.props.name}
            active={this.state.selected === index}
            onClick={() => this.setState({ selected: index })} />)
        }
      </Menu>
      <div style={{ overflowY: "auto", position: "relative", height: "100%" }}>
        {children.map((child, index) => {
          const style = index === this.state.selected
            ? {}
            : (child.props.always_render ?
              { zIndex: -100, visibility: "hidden" } : { display: "none" });
          return <div key={child.props.name}
            style={{ position: "absolute", height: "100%", width: "100%", ...style }}>
            {child}
          </div>;
        })}
      </div>
    </div>;
  }
}

interface TabProps { name: string; always_render?: boolean; }
export class Tab extends React.Component<TabProps, undefined> {
  render(): JSX.Element {
    return React.Children.only(this.props.children);
  }
}

interface CombatProps {
  combat: T.Combat;
  card?: React.ComponentType<{ creature: T.Creature }>;
  initiative?: (creature: T.Creature, init: number) => JSX.Element;
}
export const Combat = M.connectRedux(
  function Combat({ combat, card, ptui, initiative }: CombatProps & M.ReduxProps): JSX.Element {
    const creatures_with_init = M.filterMap(combat.creatures.data,
      ([cid, init]) => {
        const creature = ptui.getCreature(cid);
        if (creature) { return [creature, init]; }
      }) as Array<[T.Creature, number]>;

    const Card = card ? card : CreatureCard;
    return <Segment.Group>
      {creatures_with_init.map(([creature, init], index) => {
        const show_init = initiative ? initiative(creature, init) : null;
        return <Segment.Group key={creature.id} horizontal={true}>
          <Segment compact={true}
            style={{
              width: "25px", paddingLeft: 0, paddingRight: 0,
              display: "flex", flexDirection: "column", alignItems: "center",
            }}>
            <div style={{ height: "25px" }}>{index === combat.creatures.cursor ? "▶️" : ""}</div>
            <div>{show_init}</div>
          </Segment>
          <Card creature={creature} />
        </Segment.Group>;
      })
      }
    </Segment.Group>;
  });

export const ActionBar = M.connectRedux((
  props: { creature: T.Creature; combat?: T.Combat } & M.ReduxProps): JSX.Element => {
  const abilities = M.filterMap(LD.values(props.creature.abilities),
    abstatus => {
      const ability = M.get(props.ptui.app.current_game.abilities, abstatus.ability_id);
      if (ability) {
        return { ability_id: abstatus.ability_id, ability };
      }
    });

  let abilityButtons;
  if (props.combat) {
    const combat = props.combat;
    abilityButtons = abilities.map(abinfo =>
      <AbilityButton key={abinfo.ability_id}
        creature={props.creature} abinfo={abinfo}
        scene_id={combat.scene} />);
  } else {
    abilityButtons = <noscript />;
  }
  return <div style={{ display: "flex" }}>
    <CreatureIcon app={props.ptui.app} creature={props.creature} />
    {props.combat ? <DoneButton /> : <noscript />}
    <MoveButton creature={props.creature} combat={props.combat} />
    {abilityButtons}
  </div>;
});

export const DoneButton = M.connectRedux(({ ptui, dispatch }: M.ReduxProps): JSX.Element => {
  const command: T.GameCommand = { t: "Done" };
  return <Button
    style={{ height: "50px", flex: "1" }}
    onClick={() => ptui.sendCommand(dispatch, command)}>
    Done
  </Button>;
});

interface AbilityButtonProps {
  creature: T.Creature;
  abinfo: { ability_id: T.AbilityID; ability: T.Ability };
  scene_id: T.SceneID;
}
const AbilityButton = M.connectRedux((props: AbilityButtonProps & M.ReduxProps): JSX.Element => {
  const onClick = () =>
    props.ptui.requestCombatAbility(props.dispatch,
      props.creature.id, props.abinfo.ability_id, props.abinfo.ability, props.scene_id);
  return <Button style={{ height: "50px", flex: "1" }}
    onClick={onClick}>
    {props.abinfo.ability.name}
  </Button>;
});

const MoveButton = M.connectRedux((props: { creature: T.Creature; combat?: T.Combat } & M.ReduxProps)
  : JSX.Element => {
  const movement_left = props.combat ? props.creature.speed - props.combat.movement_used : 0;
  const suffix = props.combat ? " (" + Number(movement_left / 100).toFixed(0) + ")" : "";
  return <Button style={{ height: "50px", flex: "1" }}
    onClick={() => props.ptui.requestCombatMovement(props.dispatch)}>
    Move {suffix}
  </Button>;
});


/** A component which renders a very light grey translucent block over the entire screen,
 * and then renders child elements inside of it.
 *
 * Caveat: child elements should be position: fixed.
 */
export function ClickAway({ onClick, children }: { onClick: () => void, children: React.ReactNode })
  : JSX.Element {
  return <div><div style={{
    position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
    backgroundColor: "rgba(0,0,0, 0.1)",
    zIndex: 1,
  }}
    onClick={() => onClick()} />
    <div style={{ position: "fixed", zIndex: 2 }}>{children}</div>
  </div>;
}

function errorModal({ ptui, dispatch }: M.ReduxProps): JSX.Element {
  if (ptui.state.error) {
    return <Modal dimmer="inverted"
      open={true}
      onClose={() => dispatch({ type: "ClearError" })}>
      <Modal.Header>Error</Modal.Header>
      <Modal.Content>
        <div>{ptui.state.error}</div>
        <Button onClick={() => dispatch({ type: "ClearError" })}>Ok</Button>
      </Modal.Content>
    </Modal>;
  } else {
    return <noscript />;
  }
}
export const ErrorModal = M.connectRedux(errorModal);

interface TheLayoutProps {
  map: JSX.Element;
  tabs: Array<JSX.Element>;
  secondary?: JSX.Element;
  tertiary?: JSX.Element;
  bar_width: number;
  menu_size: MenuSize;
}
class TheLayoutComp extends React.Component<TheLayoutProps & M.ReduxProps,
  { width: number; height: number }> {

  constructor(props: TheLayoutProps & M.ReduxProps) {
    super(props);
    this.state = { width: window.innerWidth, height: window.innerHeight };
  }

  render(): JSX.Element {
    const { map, tabs, secondary, tertiary, ptui, dispatch, bar_width, menu_size } = this.props;

    const contents = this.state.width >= NARROW_THRESHOLD
      ? wideView()
      : narrowView(this.state.width);


    return <div style={{ height: "100%", width: "100%" }} >
      <WindowSizeListener
        onResize={({ windowWidth, windowHeight }) =>
          this.setState({ width: windowWidth, height: windowHeight })} />
      {contents}
      <ErrorModal />
    </div>;

    function bar(tabs_: Array<JSX.Element>, extra?: JSX.Element) {
      const tabbed_view = <TabbedView menu_size={menu_size}>{tabs_}</TabbedView>;
      return extra !== undefined
        ? <PanelGroup direction="column" borderColor="grey" spacing="8px">
          <div style={{ width: "100%" }}>{tabbed_view}</div>
          <div style={{ width: "100%" }}>{extra}</div>
        </PanelGroup>
        : tabbed_view;
    }

    function wideView() {
      return <div style={{ width: "100%", height: "100%", display: "flex" }}>
        {(secondary || tertiary)
          ? <div
            style={{
              height: "100%", width: "20%", minWidth: "20em",
            }}>
            <PanelGroup direction="column" borderColor="grey" spacing="8px" minHeight="10%">
              <div style={{ width: "100%", backgroundColor: "white", overflowY: "auto" }}>
                {tertiary}
              </div>
              <div style={{ width: "100%", backgroundColor: "white", overflowY: "auto" }}>
                {secondary}
              </div>
            </PanelGroup>
          </div>
          : null}
        <div style={{ flex: "1" }}>{map}</div>
        <div style={{ width: bar_width, height: "100%" }}>
          {bar(tabs)}
        </div>
      </div>;
    }

    function narrowView(width: number) {
      const amended_tabs = LD.concat(tabs,
        <Tab key="Map" name="Map" always_render={true}>{map}</Tab>);
      const scale = width / bar_width;
      return <div style={{
        height: "100%",
        width: bar_width,
        zoom: `${scale * 100}%`,
      }}>
        <div style={{ width: bar_width }}>
          {bar(amended_tabs, secondary)}
        </div>
      </div>;
    }
  }
}

export const TheLayout = M.connectRedux(TheLayoutComp);

export function MaterialIcon(props: { children: Array<any> | any }): JSX.Element {
  return <i
    className="material-icons"
    style={{ MozUserSelect: "none", WebKitUserSelect: "none", msUserSelect: "none" }}
  >{props.children}</i>;
}


/** The Note Editor
 * Complexities:
 * - The `name` prop may be undefined if we're creating a new note.
 * - Focusing on notes is done by name, since there is no ID. So if we rename a note, we must
 *   re-focus it as well. That's what afterSave is for.
 * - Player notes can't be renamed, hence disallow_rename.
 */
interface NoteEditorProps {
  path: T.FolderPath;
  name: string | undefined;
  disallow_rename?: boolean;
  afterSave?: (path: T.FolderPath, note: T.Note) => void;
}
class NoteEditorComp
  extends React.Component<NoteEditorProps & M.ReduxProps,
  { name: string | undefined; content: string | undefined }> {
  constructor(props: NoteEditorProps & M.ReduxProps) {
    super(props);
    this.state = { name: this.props.name, content: undefined };
  }

  componentWillReceiveProps(nextProps: NoteEditorProps & M.ReduxProps) {
    // Reasons this is called:
    // 1. clicking on a different note while a note is already loaded. We get new path and/or name
    // 2. new data from the server. We need to make sure we're displaying the latest data as long as
    //    user hasn't made any changes to the content.
    if (!M.isEqual([this.props.path, this.props.name], [nextProps.path, nextProps.name])) {
      this.setState({ name: nextProps.name, content: undefined });
    }
    if (nextProps.name !== undefined) {
      const existing = nextProps.ptui.getNote(nextProps.path, nextProps.name);
      if (existing !== undefined && existing.content === this.state.content) {
        this.setState({ content: undefined });
      }
    }
  }

  render(): JSX.Element {
    const self = this;
    const { path, disallow_rename, ptui, dispatch } = this.props;

    if (!ptui.getFolderNode(path)) {
      return <div>The path "{M.folderPathToString(path)}" does not exist.</div>;
    }
    const originalNote = this.props.name ? ptui.getNote(path, this.props.name) : undefined;
    const originalContent = originalNote ? originalNote.content : undefined;

    function chain<T>(arr: Array<T | undefined>): T | undefined {
      for (const el of arr) {
        if (el !== undefined) {
          return el;
        }
      }
    }
    const renderedContent = chain([this.state.content, originalContent, ""]);

    return <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: "xx-small" }}>{M.folderPathToString(path)}</span><br />
          <Toggler a={edit =>
            <div>
              <strong>{this.state.name === undefined ? "Enter a name" : this.state.name}</strong>
              {disallow_rename ? null
                : <Icon onClick={edit} name='edit' style={{ cursor: 'pointer' }} />}
            </div>}
            b={view =>
              <TextInput.TextInput defaultValue={this.state.name || ""}
                onSubmit={input => { this.setState({ name: input }); view(); }}
                onCancel={view} />}
          />
        </div>
        <Button
          disabled={this.state.name === undefined ||
            (renderedContent === originalContent && this.state.name === this.props.name)}
          onClick={() => this.submit()}>Save</Button>
      </div>
      <textarea style={{ flex: "1", resize: "none", width: "100%", height: "100%" }}
        value={renderedContent}
        onChange={e => this.setState({ content: e.currentTarget.value })} />
    </div>;
  }
  submit() {
    const { path, ptui, dispatch, afterSave } = this.props;
    if (!this.state.name) { console.log("I have no name"); return; }
    const name = this.state.name;
    const oldNote = this.props.name ? ptui.getNote(path, this.props.name) : undefined;
    const content = this.state.content === undefined && oldNote !== undefined
      ? oldNote.content : this.state.content;
    if (!content) { console.log("There's no content for me to save"); return; }
    const newNote = { name, content };
    const cmd: T.GameCommand = oldNote
      ? { t: "EditNote", path, name: oldNote.name, note: newNote }
      : { t: "CreateNote", path, note: newNote };
    ptui.sendCommand(dispatch, cmd);
    if (afterSave) { afterSave(path, newNote); }
  }

}
export const NoteEditor = M.connectRedux(NoteEditorComp);


export type ToggleFunc = () => void;
interface TogglerProps { a: (t: ToggleFunc) => JSX.Element; b: (t: ToggleFunc) => JSX.Element; }
export class Toggler extends React.Component<TogglerProps, { toggled: boolean }> {
  constructor(props: TogglerProps) {
    super(props);
    this.state = { toggled: false };
  }

  render(): JSX.Element {
    const self = this;
    function toggle() {
      self.setState({ toggled: !self.state.toggled });
    }
    if (this.state.toggled) {
      return this.props.b(toggle);
    } else {
      return this.props.a(toggle);
    }
  }
}


export function ModalMaker({ button, modal }: {
  button: (clicker: () => void) => JSX.Element,
  modal: (closer: () => void) => JSX.Element | Array<JSX.Element>,
}) {
  return <Toggler
    a={button}
    b={tf =>
      <div>{button}<Modal dimmer='inverted' open={true} onClose={tf}>{modal(tf)}</Modal></div>}
  />;
}
