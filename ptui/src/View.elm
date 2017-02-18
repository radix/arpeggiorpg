module View exposing (..)

import Array
import Dict
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Set

import Model as M
import Types as T
import Grid
import Update as U
import Elements exposing (..)

import Css as S


s = S.asPairs >> Html.Attributes.style

refreshButton : Html M.Msg
refreshButton = button [ onClick M.MorePlease ] [ text "Refresh From Server" ]

gmView : M.Model -> Html M.Msg
gmView model = vbox
  [ h2 [] [ text "P&T" ]
  , refreshButton
  , case model.app of
      Just app -> gmViewGame model app
      Nothing -> text "No app yet. Maybe reload."
  , hbox [text "Last error:", pre [] [text model.error]]
  ]

modalSelectingCreatures : T.App -> M.GotCreatures -> String -> Html M.Msg
modalSelectingCreatures app callback commandName =
  let checkbox creature =
        input [ type_ "checkbox", onClick (M.ToggleSelectedCreature creature.id)
              , s [S.height (S.px 100), S.width (S.px 100)]] []
      selectableCreature creature = hbox [checkbox creature, creatureCard creature]
  in vbox <|
    [ h3 [] [text <| "Select Creatures to " ++ commandName]
    ] ++ (List.map selectableCreature (Dict.values app.current_game.creatures))
    ++ [ hbox [button [onClick M.DoneSelectingCreatures] [text commandName]
              , button [onClick M.CancelSelectingCreatures] [text "Cancel"]]
    ]

gmViewGame : M.Model -> T.App -> Html M.Msg
gmViewGame model app =
  case model.selectingCreatures of
      Just (cb, commandName) -> modalSelectingCreatures app cb commandName
      Nothing -> gmViewGame_ model app

gmViewGame_ : M.Model -> T.App -> Html M.Msg
gmViewGame_ model app =
  let game = app.current_game
      center el = div [s [S.displayFlex, S.justifyContent S.spaceAround]] [el]
  in
  case (game.current_combat, model.moving) of
    (Nothing, Just mvmtReq) ->
      case mvmtReq.ooc_creature of
        Just creature -> center <| Grid.movementMap (M.MoveCreature creature.id) mvmtReq model.currentMap creature (Dict.values game.creatures)
        Nothing -> -- There's a combat movement request but no combat! It'd be nice if this were impossible to represent
                   fullUI model app game
    (Just combat, Just mvmtReq) ->
      let (creature, moveMessage, visibleCreatures) =
          case mvmtReq.ooc_creature of
            Just creature -> (creature, M.MoveCreature creature.id, (Dict.values game.creatures))
            Nothing -> (T.combatCreature combat, M.CombatMove, combat.creatures.data)
      in center <| Grid.movementMap moveMessage mvmtReq model.currentMap creature visibleCreatures
    _ -> fullUI model app game

fullUI : M.Model -> T.App -> T.Game -> Html M.Msg
fullUI model app game =
  if model.editingMap
  then Grid.editMap model.currentMap (visibleCreatures model game)
  else
  habox [s [S.justifyContent S.spaceAround]]
    [ vabox [s [S.width (S.px 500)]] <| [ h3 [] [text "Creatures"]
            , inactiveList model game
            ] ++ (case model.selectedAbility of
                    Just (cid, abid) -> if T.isCreatureOOC game cid
                                        then [targetSelector model game (M.ActCreature cid) abid]
                                        else []
                    Nothing -> []
            ) ++ [ playerControlList app , history app ]
    , vbox [ hbox [editMapButton, mapSelector game, oocToggler model ]
           , Grid.terrainMap (Maybe.withDefault True (Maybe.map (always False) game.current_combat)) model.currentMap (visibleCreatures model game)]
    , div [s [S.width (S.px 500)]] [
        case game.current_combat of
          Just combat -> combatArea model game combat
          Nothing -> startCombatButton
      ]
    ]

playerControlList app =
  let gotCreatures pid cids = U.sendCommand (T.GiveCreaturesToPlayer pid cids)
      selectCreatures pid = M.SelectCreatures (gotCreatures pid) ("Grant Creatures to " ++ pid)
      playerButton pid = [button [onClick (selectCreatures pid)] [text "Grant Creatures"]]
  in extPlayerList playerButton app.players

extPlayerList : (T.PlayerID -> List (Html M.Msg)) -> Dict.Dict T.PlayerID (Set.Set T.CreatureID) -> Html M.Msg
extPlayerList ext players =
  let playerEntry (pid, cids) =
        hbox ([strong [] [text pid], hbox (List.map text (Set.toList cids))] ++ ext pid)
  in vbox <| [h3 [] [text "Players"]] ++ (List.map playerEntry (Dict.toList players))

playerList : Dict.Dict T.PlayerID (Set.Set T.CreatureID) -> Html M.Msg
playerList = extPlayerList (always [])

oocToggler : M.Model -> Html M.Msg
oocToggler model =
  hbox [text "Show Out-of-Combat creatures: "
       , input [type_ "checkbox", checked model.showOOC, onClick M.ToggleShowOOC] []
       ]

editMapButton : Html M.Msg
editMapButton = button [onClick M.StartEditingMap] [text "Edit this map"]

visibleCreatures : M.Model -> T.Game -> List T.Creature
visibleCreatures model game =
  case game.current_combat of
    Just combat -> if model.showOOC then (combat.creatures.data) ++ (Dict.values game.creatures) else combat.creatures.data
    Nothing -> Dict.values game.creatures

playerView : M.Model -> Html M.Msg
playerView model = vbox
  [ h2 [] [ text "P&T" ]
  , refreshButton
  , case model.app of
      Just app ->
        let vGame = case model.playerID of
              Just playerID ->
                if T.playerIsRegistered app playerID
                then playerViewGame model app (T.getPlayerCreatures app playerID)
                else registerForm model
              Nothing -> registerForm model
        in vbox [vGame, playerList app.players]
      Nothing -> text "No app yet. Maybe reload."
  , hbox [text "Last error:", pre [] [text model.error]]
  ]

registerForm : M.Model -> Html M.Msg
registerForm model =
  hbox [ input [type_ "text", placeholder "player ID", onInput M.SetPlayerID ] []
       , button [onClick M.RegisterPlayer] [text "Register Player"]]

playerViewGame : M.Model -> T.App -> List T.Creature -> Html M.Msg
playerViewGame model app creatures = 
  let game = app.current_game in
  hbox
  [ case model.moving of
      Just movementRequest ->
        let {max_distance, movement_options, ooc_creature} = movementRequest in
        case ooc_creature of
          Just oocMovingCreature ->
            if List.member oocMovingCreature creatures
            then
              -- one of my characters is moving; render the movement map
              Grid.movementMap (M.MoveCreature oocMovingCreature.id) movementRequest
                               model.currentMap oocMovingCreature (visibleCreatures model game)
            else
              -- someone else is moving (TODO: render a non-interactive movement map to show what they're doing)
              playerGrid model game creatures
          Nothing -> -- we're moving in-combat.
            let currentCreature = Maybe.map T.combatCreature game.current_combat
            in case currentCreature of
                Just creature -> Grid.movementMap M.CombatMove movementRequest model.currentMap creature (visibleCreatures model game)
                Nothing -> playerGrid model game creatures
      Nothing -> playerGrid model game creatures
  ,
    case game.current_combat of
      Just combat ->
        let currentCreature = T.combatCreature combat
            bar = if List.member currentCreature creatures
                  then hbox [ strong [] [text currentCreature.id]
                            , actionBar game combat currentCreature]
                  else hbox [text "Current creature:", text currentCreature.id]
            selector = case model.selectedAbility of
                          Just (cid, abid) -> 
                                if T.isCreatureInCombat game cid
                                then [targetSelector model game M.CombatAct abid]
                                else []
                          Nothing -> []
            initiativeList = combatantList game combat
        in vbox <| [bar] ++ selector ++ [initiativeList]
      Nothing -> text "No Combat"
  ]
  -- TODO: a read-only "creatures nearby" list without details

-- render the grid and some OOC movement buttons for the given creatures
playerGrid : M.Model -> T.Game -> List T.Creature -> Html M.Msg
playerGrid model game myCreatures =
  let bar creature =
        if T.isCreatureInCombat game creature.id
        then Nothing
        else Just <| hbox <| [text creature.id, creatureStats creature, moveOOCButton creature] ++ (oocActionBar game creature)
      bars = List.filterMap bar myCreatures
      targetSel =
        case model.selectedAbility of
          Just (cid, abid) ->
            case T.listFind (\c -> c.id == cid) myCreatures of
              Just _ -> [targetSelector model game (M.ActCreature cid) abid]
              Nothing -> []
          Nothing -> []
  in
    vbox <| bars ++ targetSel ++ [Grid.terrainMap False model.currentMap (visibleCreatures model game)]
  
mapSelector : T.Game -> Html M.Msg
mapSelector game = vbox <|
  let mapSelectorItem name = button [onClick (M.SelectMap name)] [text name]
  in (List.map mapSelectorItem (Dict.keys game.maps))

inactiveList : M.Model -> T.Game -> Html M.Msg
inactiveList model game = div []
  [ div [] (List.map (inactiveEntry game model.selectedCreatures) (Dict.values game.creatures))
  , createCreatureForm model game
  ]

createCreatureForm : M.Model -> T.Game -> Html M.Msg
createCreatureForm model game = div []
    [ input [type_ "text", placeholder "id", onInput M.PendingCreatureId ] []
    , input [type_ "text", placeholder "name", onInput M.PendingCreatureName ] []
    , select [onInput M.PendingCreatureClass ]
             (List.map (\className -> option [value className] [text className])
                       (Dict.keys game.classes))
    , createCreatureButton model
    ]

createCreatureButton : M.Model -> Html M.Msg
createCreatureButton model =
  case (model.pendingCreatureId, model.pendingCreatureName, model.pendingCreatureClass) of
    (Just id, Just name, Just class) ->
      let cc = T.CreatureCreation id name class {x= 0, y= 0, z=0}
      in button [ onClick (M.CreateCreature cc) ] [text "Create Creature!"]
    _ -> button [disabled True] [text "Create Creature!"]

inactiveEntry : T.Game -> Set.Set String -> T.Creature -> Html M.Msg
inactiveEntry game pendingCreatures creature = vbox <|
  [hbox <|
    [ creatureCard creature
    ] ++ case game.current_combat of
        Just _ -> [engageButton creature]
        Nothing -> []
    ++ [
      deleteCreatureButton creature
    ], hbox (oocActionBar game creature)]

history : T.App -> Html M.Msg
history app = 
  let items =
        case Array.get ((Array.length app.snapshots) - 1) app.snapshots of
          Just (_, items) -> List.reverse items
          Nothing -> []
  in vbox
  ([ h3 [] [text "History"] ] ++ (List.map historyItem items))

historyItem : T.GameLog -> Html M.Msg
historyItem i = case i of
  T.GLSelectMap name ->  hbox [ text "Selected Map", text name]
  T.GLEditMap name _ -> hbox [text "Edited Map", text name]
  T.GLCreateCreature creature -> hbox [text "Created creature", text creature.id]
  T.GLRemoveCreature cid -> hbox [text "Deleted creature", text cid]
  T.GLStartCombat combatants -> hbox [text "Started Combat", text (String.join ", " combatants)]
  T.GLStopCombat -> text "Stopped combat"
  T.GLAddCreatureToCombat cid -> hbox [text cid, text "Added Creature to Combat"]
  T.GLRemoveCreatureFromCombat cid -> text <| "Removed creature from Combat: " ++ cid
  T.GLCreatureLog cid cl -> hbox [text cid, historyCreatureLog cl]
  T.GLCombatLog cl -> historyCombatLog cl

historyCombatLog : T.CombatLog -> Html M.Msg
historyCombatLog cl = case cl of
  T.ComLCreatureLog cid creatureLog -> hbox [text cid, historyCreatureLog creatureLog]
  T.ComLEndTurn cid -> hbox [text cid, text "Ended Turn"]

historyCreatureLog : T.CreatureLog -> Html M.Msg
historyCreatureLog cl = case cl of
  T.CLDamage dmg -> text <| "Took damage: " ++ toString dmg
  T.CLHeal dmg -> text <| "Healed: " ++ toString dmg
  T.CLGenerateEnergy nrg -> text <| "Regenerated energy: " ++ toString nrg
  T.CLReduceEnergy nrg -> text <| "Lost energy: " ++ toString nrg
  T.CLApplyCondition conid duration con -> text <| "Got condition: " ++ toString con
  T.CLRemoveCondition conid -> text <| "Lost condition: " ++ toString conid
  T.CLPathCreature {path, distance} -> text <| "Moved " ++ toString (toFloat distance / 100) ++ " to " ++ maybePos path
  T.CLDecrementConditionRemaining conID -> text <| "Tick condition: " ++ toString conID

maybePos : List T.Point3 -> String
maybePos path =
  case (List.head (List.reverse path)) of
    Just {x, y, z} -> toString x ++ "," ++ toString y
    Nothing -> "nowhere"

combatArea : M.Model -> T.Game -> T.Combat -> Html M.Msg
combatArea model game combat =
  let bar = actionBar game combat (T.combatCreature combat)
      disengageButtons = hbox (List.map disengageButton combat.creatures.data)
      combatView = vbox [ bar, combatantList game combat, stopCombatButton, disengageButtons]
  in case model.selectedAbility of
    Just (cid, abid) ->
      if T.isCreatureInCombat game cid
      then targetSelector model game M.CombatAct abid
      else combatView
    Nothing -> combatView

targetSelector : M.Model -> T.Game -> (T.AbilityID -> T.DecidedTarget -> M.Msg) -> String -> Html M.Msg
targetSelector model game msgConstructor abid =
  let creatures = List.filterMap (T.findCreature game) (T.potentialCreatureTargets model.potentialTargets)
  in hbox <| 
    [ case (Dict.get abid game.abilities) of
        Just ability -> case ability.target of
          T.Melee -> creatureTargetSelector (msgConstructor abid) T.DecidedMelee creatures
          T.Range distance -> creatureTargetSelector (msgConstructor abid) T.DecidedRange creatures
        Nothing -> text "Sorry, that ability was not found. Please reload."
    , button [onClick M.CancelAbility] [text "Cancel ability"]
    ]

creatureTargetSelector : (T.DecidedTarget -> M.Msg) -> (T.CreatureID -> T.DecidedTarget) -> List T.Creature -> Html M.Msg
creatureTargetSelector msgConstructor targetConstructor creatures = vbox <|
  let targetCreatureButton c = button [onClick (msgConstructor (targetConstructor c.id))] [text c.name]
  in List.map targetCreatureButton creatures

stopCombatButton : Html M.Msg
stopCombatButton = button [onClick M.StopCombat] [text "Stop Combat"]

startCombatButton : Html M.Msg
startCombatButton =
  let gotCreatures cids = U.sendCommand (T.StartCombat cids)
  in button [onClick (M.SelectCreatures gotCreatures "Start Combat")] [text "Start Combat"]

combatantList : T.Game -> T.Combat -> Html M.Msg
combatantList game combat =
  vbox (List.map (combatantEntry game combat) (List.indexedMap (,) combat.creatures.data))

engageButton : T.Creature -> Html M.Msg
engageButton creature =
  button [onClick (M.AddToCombat creature.id)] [text "Engage"]

combatantEntry : T.Game -> T.Combat -> (Int, T.Creature) -> Html M.Msg
combatantEntry game combat (idx, creature) = hbox <|
  let marker = if combat.creatures.cursor == idx
               then [datext [s [S.width (S.px 25)]] "▶️️"]
               else [div [s [S.width (S.px 25)]] []]
  in marker ++ [ creatureCard creature ]

oocActionBar : T.Game -> T.Creature -> List (Html M.Msg)
oocActionBar game creature =
  let abilities =
        case (Dict.get creature.class game.classes) of
          Just x -> x.abilities -- TODO: get ability *name*
          Nothing -> []
  in (List.map (actionButton creature) abilities)

actionBar : T.Game -> T.Combat -> T.Creature -> Html M.Msg
actionBar game combat creature =
  hbox (oocActionBar game creature ++ [moveButton combat creature] ++ [doneButton creature])

actionButton : T.Creature -> String -> Html M.Msg
actionButton creature abid =
  button
    [ onClick (M.SelectAbility creature.id abid)
    , disabled (not creature.can_act)]
    [text abid]

creatureCard : T.Creature -> Html M.Msg
creatureCard creature =
  let cellStyles color =
        [s [ plainBorder
           , S.backgroundColor color
           , S.borderRadius (S.px 10)
           , S.padding (S.px 3)]]
  in vabox [s [plainBorder, S.width (S.px 300), S.height (S.px 100), S.borderRadius (S.px 10), S.padding (S.px 3)]]
    [ hbox [strong [] [text creature.name ], classIcon creature]
    , hbox [ div (cellStyles (S.rgb 144 238 144))
              [text <| (toString creature.cur_health) ++ "/" ++ (toString creature.max_health)]
           , div (cellStyles (S.rgb 0 255 255))
              [text <| (toString creature.cur_energy) ++ "/" ++ (toString creature.max_energy)]
           , div (cellStyles (S.rgb 255 255 255))
              [text <| (toString creature.pos.x) ++ ", " ++ (toString creature.pos.y)]
           ]
    , habox [style [("width", "50px")]] (List.map creatureConds (Dict.values creature.conditions))
    ]

classIcon : T.Creature -> Html M.Msg
classIcon creature =
  case creature.class of
    "cleric" -> text "💉"
    "rogue" -> text "🗡️"
    "ranger" -> text "🏹"
    _ -> text "?"


creatureStats : T.Creature -> Html M.Msg
creatureStats creature = 
  habox [style [("width", "400px")]]
    [ div [style [("width", "150px")]] [strong [] [text creature.name]]
    , div [style [("width", "75px")]] [text "HP ", text (toString creature.cur_health)]
    , div [style [("width", "100px")]] [text "NRG ", text (toString creature.cur_energy)]
    , div [style [("width", "75px")]] [text "POS ", text <| (toString creature.pos.x) ++ "/" ++ (toString creature.pos.y)]
    ]

creatureConds : T.AppliedCondition -> Html M.Msg
creatureConds ac = case ac.condition of 
  T.RecurringEffect eff -> text (toString eff)
  T.Dead -> text "💀"
  T.Incapacitated -> text "😞"
  T.AddDamageBuff dmg -> text "😈"

disengageButton : T.Creature -> Html M.Msg
disengageButton creature =
  button [onClick (M.RemoveFromCombat creature.id)] [text ("Disengage " ++ creature.id)]

deleteCreatureButton : T.Creature -> Html M.Msg
deleteCreatureButton creature =
  button [onClick (M.RemoveFromGame creature.id)] [text "Delete"]

moveOOCButton : T.Creature -> Html M.Msg
moveOOCButton creature =
  button [ onClick (M.GetMovementOptions creature)
         , disabled (not creature.can_move)]
         [text "Move"]

doneButton : T.Creature -> Html M.Msg
doneButton creature =
  button [onClick M.TurnDone] [text "Done"]

moveButton : T.Combat -> T.Creature -> Html M.Msg
moveButton combat creature =
  let movement_left = creature.speed - combat.movement_used
  in button [ onClick (M.RequestMove <| M.MovementRequest movement_left combat.movement_options Nothing)
            , disabled (not creature.can_move) ]
            [text (String.join "" ["Move (", toString movement_left, ")"])]
