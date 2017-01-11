use std::collections::VecDeque;
use std::collections::HashMap;

use types::*;
use creature::*;
use combat::*;

/// A data structure maintaining state for the whole app. It keeps track of the history of the
/// whole game, and exposes the top-level methods that run simulations on the game.
#[derive(Clone, Eq, PartialEq, Debug, Serialize, Deserialize)]
pub struct App {
    // We need to keep track of the history of more things.
    combat_history: VecDeque<Combat>,
    current_combat: Option<Combat>,
    abilities: HashMap<AbilityID, Ability>,
    creatures: HashMap<CreatureID, Creature>,
}

// type GMID = String;
// type PlayerID = String;
//
// pub struct GMCommand {
//     gm_id: GMID,
//     command: Command,
// }
//
// pub struct PlayerCommand {
//     player_id: PlayerID,
//     command: Command,
// }
//
// enum Command {
//     CreatureCommand(CreatureID, CreatureCommand),
//     ControlCommand(ControlCommand),
// }
//
// enum ControlCommand {
//     StartCombat,
//     StopCombat,
// }
//
// pub enum CreatureCommand {
//     Act(AbilityID, DecidedTarget),
//     Move(Point3),
//     RetrieveFromInventory(ThingID),
//     StowInInventory(ThingID),
// }

// Generic methods for any kind of App regardless of the CreatureState.
impl App {
    pub fn new() -> Self {
        App {
            combat_history: VecDeque::new(),
            abilities: HashMap::new(),
            current_combat: None,
            creatures: HashMap::new(),
        }
    }

    pub fn get_ability(&self, ability_id: &AbilityID) -> Result<Ability, GameError> {
        Ok(self.abilities.get(ability_id).ok_or(GameError::NoAbility(ability_id.clone()))?.clone())
    }

    /// Return an AppCap according to the current state of the app.
    pub fn capability(&self) -> AppCap {
        enum X {
            Able,
            Incap,
            NoCombat,
        }

        let x = match self.current_combat {
            Some(ref combat) => {
                match combat.capability() {
                    CombatCap::Able(_) => X::Able,
                    CombatCap::Incap(_) => X::Incap,
                }
            }
            None => X::NoCombat,
        };
        match x {
            X::Able => AppCap::Able(AppAble { app: self }),
            X::Incap => AppCap::Incap(AppIncap { app: self }),
            X::NoCombat => AppCap::NoCombat(AppNoCombat { app: self }),
        }
    }

    fn stop_combat(&self) -> App {
        // TODO: Either copy all the creatures out of current_combat and back into self.creatures,
        // or ... something else.
        let mut newapp = self.clone();
        if let Some(c) = newapp.current_combat {
            newapp.combat_history.push_back(c.clone());
        }
        newapp.current_combat = None;
        newapp
    }

    pub fn get_creature(&self, cid: &CreatureID) -> Result<&Creature, GameError> {
        self.creatures.get(cid).ok_or(GameError::CreatureNotFound(cid.clone()))
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct AppIncap<'a> {
    app: &'a App,
}
impl<'a> AppIncap<'a> {
    pub fn skip(&self) -> App {
        let newcombat = match self.app.current_combat {
            Some(ref combat) => {
                match combat.capability() {
                    CombatCap::Incap(ref incap) => incap.skip(),
                    _ => panic!("AppIncap contained something other than CombatIncap"),
                }
            }
            _ => panic!("AppIncap contained something other than CombatIncap"),
        };
        App { current_combat: Some(newcombat), ..self.app.clone() }
    }
    pub fn stop_combat(&self) -> App {
        self.app.stop_combat()
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct AppAble<'a> {
    app: &'a App,
}

impl<'a> AppAble<'a> {
    fn perform_able_op<F>(&self, op: F) -> Result<App, GameError>
        where F: FnOnce(&CombatAble) -> Result<Combat, GameError>
    {
        let prev_combat = self.app.current_combat.clone().unwrap();
        let g = match self.app.current_combat {
            Some(ref combat) => {
                match combat.capability() {
                    CombatCap::Able(ref able) => op(able)?,
                    _ => panic!("AppAble contained something other than CombatAble!"),
                }
            }
            _ => panic!("AppAble contained something other than CombatAble!"),
        };
        let mut newapp = self.app.clone();
        if newapp.combat_history.len() >= 1000 {
            let _ = newapp.combat_history.pop_front();
        }

        newapp.combat_history.push_back(prev_combat);
        newapp.current_combat = Some(g);
        Ok(newapp)
    }

    pub fn act(&self, ability_id: AbilityID, target: DecidedTarget) -> Result<App, GameError> {
        let ability = self.app.get_ability(&ability_id)?;
        self.perform_able_op(move |able| {
            if able.combat.current_creature().has_ability(&ability_id) {
                able.act(&ability, target)
            } else {
                Err(GameError::CreatureLacksAbility(ability_id.clone()))
            }
        })
    }
    pub fn stop_combat(&self) -> App {
        self.app.stop_combat()
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct AppNoCombat<'a> {
    pub app: &'a App,
}
impl<'a> AppNoCombat<'a> {
    /// Create a Combat and return a new App with it.
    pub fn start_combat(&self, cids: Vec<CreatureID>) -> Result<App, GameError> {
        let combatants: Vec<Creature> = cids.iter()
            .map(|cid| self.app.get_creature(cid).map(Clone::clone))
            .collect::<Result<_, GameError>>()?;
        Ok(App { current_combat: Some(Combat::new(combatants)?), ..self.app.clone() })
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub enum AppCap<'a> {
    Incap(AppIncap<'a>),
    Able(AppAble<'a>),
    NoCombat(AppNoCombat<'a>),
}

#[cfg(test)]
pub fn t_able_app<'a>(app: &'a App) -> AppAble<'a> {
    match app.capability() {
        AppCap::Able(a) => a,
        _ => panic!("Not an Able App"),
    }
}

#[cfg(test)]
pub fn t_start_combat<'a>(app: App, combatants: Vec<CreatureID>) -> App {
    let nocomb = t_nocombat(&app);
    nocomb.start_combat(combatants).unwrap()
}

#[cfg(test)]
pub fn t_nocombat<'a>(app: &'a App) -> AppNoCombat<'a> {
    match app.capability() {
        AppCap::NoCombat(a) => a,
        _ => panic!("App is not in NoCombat state"),
    }
}

#[test]
fn workflow() {
    let mut creatures = HashMap::new();
    let punch = t_punch();
    let punch_id = abid("punch");
    let bob_id = cid("bob");
    let creature = Creature::build("bob")
        .abilities(vec![punch_id.clone()])
        .build()
        .unwrap();
    creatures.insert(bob_id.clone(), creature);
    let mut abilities = HashMap::new();
    abilities.insert(punch_id.clone(), punch);
    let app = App {
        combat_history: VecDeque::new(),
        abilities: abilities,
        current_combat: None,
        creatures: creatures,
    };
    let app = t_start_combat(app, vec![bob_id.clone()]);
    let next = t_able_app(&app).act(punch_id.clone(), DecidedTarget::Melee(bob_id.clone()));
    let next: App = next.expect("punch did not succeed");
    let next = t_able_app(&next);
    let _: App = next.stop_combat();
}


#[test]
fn start_combat_not_found() {
    let app = App::new();
    let non = cid("nonexistent");
    assert_eq!(t_nocombat(&app).start_combat(vec![non.clone()]),
               Err(GameError::CreatureNotFound(non)));
}

#[test]
fn combat_must_have_creatures() {
    let app = App::new();
    assert_eq!(t_nocombat(&app).start_combat(vec![]),
               Err(GameError::CombatMustHaveCreatures));
}
