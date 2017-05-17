use std::collections::VecDeque;

use types::*;
use indexed::IndexedHashMap;

// random misplaced notes
//
// A workflow:
//
// - player moves or whatever
// - player says they want to attack
// - they send Act with an ability
// - as soon as they target an... NPC? anyone?
//   - the resulting state goes back to the GM for vetting
//     - GM makes arbitrary changes to the game state, confirms
//     - OR GM outright denies the action, returning pre-Act state.
// - when to vet could be an option.
//   - ALL player commands
//   - only Actions on NPCs
//   - only Actions on anyone (including other PCs)
//   - never vet, give jesus the wheel
//   - ... well, it needs to be the GM's turn *some* time... top of initiative or something

// pending game state until vetted
// editable logs
// vetting creates a snapshot?

// When editing a log it may invalidate later logs. you can edit it, but a big red "X" will appear
// where an error occurred later on. This will require some model for ephemeral, uncommitted game
// modifications...
// I *think* that will need to be stored in the model (though perhaps not on disk), since we
// probably don't want to just accept a modify Game back from the client...
// But maybe that's okay actually, we would only be sending it to the GM.


impl App {
  pub fn new(g: Game) -> Self {
    let mut snapshots = VecDeque::with_capacity(1000);
    snapshots.push_back((g.clone(), Vec::with_capacity(100)));
    App {
      current_game: g,
      snapshots: snapshots,
      players: IndexedHashMap::new(),
    }
  }
  pub fn perform_unchecked(&mut self, cmd: GameCommand)
                           -> Result<(&Game, Vec<GameLog>), GameError> {
    match &cmd {
      &GameCommand::RegisterPlayer(ref pid) => self.register_player(pid),
      &GameCommand::UnregisterPlayer(ref pid) => self.unregister_player(pid),
      &GameCommand::GiveCreaturesToPlayer(ref pid, ref cids) => {
        self.give_creatures_to_player(pid, cids)
      }
      &GameCommand::RemoveCreaturesFromPlayer(ref pid, ref cids) => {
        self.remove_creatures_from_player(pid, cids)
      }
      &GameCommand::SetPlayerScene(ref pid, ref scene) => self.set_player_scene(pid, scene.clone()),
      &GameCommand::Rollback(ref snapshot_idx, ref log_idx) => {
        let newgame = self.rollback_to(*snapshot_idx, *log_idx)?;
        self.current_game = newgame;
        let log = GameLog::Rollback(*snapshot_idx, *log_idx);
        self.snapshots.back_mut().unwrap().1.push(log.clone());
        Ok((&self.current_game, vec![log]))
      }
      _ => {
        let (game, logs) = self.current_game.perform_unchecked(cmd.clone())?.done();

        if self.snapshots.len() == 0 || self.snapshots.back().unwrap().1.len() + logs.len() > 100 {
          self.snapshots.push_back((self.current_game.clone(), Vec::with_capacity(100)));
        }

        self.snapshots.back_mut().unwrap().1.extend(logs.clone());
        self.current_game = game;
        Ok((&self.current_game, logs))
      }
    }
  }

  /// Rollback to a particular point by replaying logs after a snapshot
  fn rollback_to(&self, snapshot_idx: usize, log_idx: usize) -> Result<Game, GameError> {
    println!("Calling rollback_to {:?}[{:?}]", snapshot_idx, log_idx);
    let &(ref baseline, ref logs_to_apply) = self.snapshots
      .get(snapshot_idx)
      .ok_or(GameErrorEnum::HistoryNotFound(snapshot_idx, log_idx))?;
    if logs_to_apply.len() - 1 < log_idx {
      bail!(GameErrorEnum::HistoryNotFound(snapshot_idx, log_idx));
    }
    println!("All logs: {:?}", logs_to_apply);
    let logs_to_apply = &logs_to_apply[..log_idx];
    Self::apply_game_logs(baseline.clone(), baseline.clone(), logs_to_apply)
  }

  fn apply_game_logs(baseline: Game, mut game: Game, logs: &[GameLog]) -> Result<Game, GameError> {
    for log in logs {
      println!("Applying log {:?}", log);
      if let &GameLog::Rollback(sni, li) = log {
        // 1. assert li is within bounds?
        // 2. need to handle SnapshotIndex -- this assumes it's always based on the same snapshot
        // 3. this is super inefficient
        // 4. if each Rollback also created a Snapshot, things could be easier... we would never
        //    need to apply a Rollback as a log in that case
        game = Self::apply_game_logs(baseline.clone(), baseline.clone(), &logs[..li])?;
      } else {
        game = game.apply_log(log)?;
      }
    }
    Ok(game)
  }

  fn register_player(&mut self, pid: &PlayerID) -> Result<(&Game, Vec<GameLog>), GameError> {
    if self.players.contains_key(&pid) {
      Err(GameErrorEnum::PlayerAlreadyExists(pid.clone()).into())
    } else {
      self.players.insert(Player::new(pid.clone()));
      Ok((&self.current_game, vec![]))
    }
  }

  fn unregister_player(&mut self, pid: &PlayerID) -> Result<(&Game, Vec<GameLog>), GameError> {
    self.players.remove(pid).ok_or_else(|| GameErrorEnum::PlayerNotFound(pid.clone()))?;
    Ok((&self.current_game, vec![]))
  }

  fn give_creatures_to_player(&mut self, pid: &PlayerID, cids: &[CreatureID])
                              -> Result<(&Game, Vec<GameLog>), GameError> {
    for cid in cids {
      self.current_game.check_creature_id(*cid)?;
    }
    self
      .players
      .mutate(pid, |mut p| {
        p.creatures.extend(cids);
        p
      })
      .ok_or_else(|| GameErrorEnum::PlayerNotFound(pid.clone()))?;
    Ok((&self.current_game, vec![]))
  }

  fn remove_creatures_from_player(&mut self, pid: &PlayerID, cids: &[CreatureID])
                                  -> Result<(&Game, Vec<GameLog>), GameError> {
    self
      .players
      .mutate(pid, |mut p| {
        for cid in cids {
          p.creatures.remove(cid);
        }
        p
      })
      .ok_or_else(|| GameErrorEnum::PlayerNotFound(pid.clone()))?;
    Ok((&self.current_game, vec![]))
  }

  fn set_player_scene(&mut self, pid: &PlayerID, scene: Option<SceneID>)
                      -> Result<(&Game, Vec<GameLog>), GameError> {
    self
      .players
      .mutate(pid, move |mut p| {
        p.scene = scene;
        p
      })
      .ok_or_else(|| GameErrorEnum::PlayerNotFound(pid.clone()))?;
    Ok((&self.current_game, vec![]))
  }

  pub fn game(&self) -> &Game {
    &self.current_game
  }

  pub fn get_movement_options(&self, scene: SceneID, creature_id: CreatureID)
                              -> Result<Vec<Point3>, GameError> {
    self.current_game.get_movement_options(scene, creature_id)
  }

  pub fn get_combat_movement_options(&self) -> Result<Vec<Point3>, GameError> {
    Ok(self.current_game.get_combat()?.current_movement_options()?)
  }

  pub fn get_target_options(&self, scene: SceneID, cid: CreatureID, abid: AbilityID)
                            -> Result<PotentialTargets, GameError> {
    self.current_game.get_target_options(scene, cid, abid)
  }

  pub fn get_creatures_and_terrain_in_volume(&self, sid: SceneID, pt: Point3, volume: Volume)
                                             -> Result<(Vec<CreatureID>, Vec<Point3>), GameError> {
    let scene = self.current_game.get_scene(sid)?;
    self.current_game.creatures_and_terrain_in_volume(scene, pt, volume)
  }
}

#[cfg(test)]
mod test {
  use app::*;
  use test::Bencher;
  use game::test::*;
  use types::test::*;

  pub fn t_app() -> App {
    App::new(t_game())
  }

  pub fn t_app_act(app: &mut App, ab: &str, dtarget: DecidedTarget) -> Result<(), GameError> {
    app.perform_unchecked(GameCommand::CombatAct(abid(ab), dtarget))?;
    Ok(())
  }

  #[bench]
  fn three_char_infinite_combat(bencher: &mut Bencher) {
    let mut app = t_app();
    app
      .perform_unchecked(GameCommand::StartCombat(t_scene_id(),
                                                  vec![cid_rogue(), cid_ranger(), cid_cleric()]))
      .unwrap();
    let iter = |app: &mut App| -> Result<(), GameError> {
      t_app_act(app, "punch", DecidedTarget::Creature(cid_ranger()))?;
      app.perform_unchecked(GameCommand::Done)?;
      app.perform_unchecked(GameCommand::Done)?;
      t_app_act(app, "heal", DecidedTarget::Creature(cid_ranger()))?;
      app.perform_unchecked(GameCommand::Done)?;
      Ok(())
    };
    bencher.iter(|| {
                   iter(&mut app).unwrap();
                   app.clone()
                 });
  }

  #[test]
  fn rollback() {
    // 0
    let mut app = t_app();
    // 1
    app
      .perform_unchecked(GameCommand::SetCreaturePos(t_scene_id(), cid_ranger(), (1, 1, 1)))
      .unwrap();
    app.perform_unchecked(GameCommand::Rollback(0, 0)).unwrap();
    let ranger = app.current_game.get_creature(cid_ranger()).unwrap();
    let scene = app.current_game.get_scene(t_scene_id()).unwrap();
    assert_eq!(scene.get_pos(ranger.id()).unwrap(), (0, 0, 0));
    let logs = &app.snapshots[0].1;
    println!("{:?}", logs);
    assert_eq!(logs.len(), 2);
  }

  /// bug test: ensure precedent logs are also applied, not just the one being rolled back to.
  #[test]
  fn rollback_reapplies_precedents() {
    // 0
    let mut app = t_app();
    // 1
    app
      .perform_unchecked(GameCommand::StartCombat(t_scene_id(),
                                                  vec![cid_ranger(), cid_rogue(), cid_cleric()]))
      .unwrap();
    // 2
    app.perform_unchecked(GameCommand::StopCombat).unwrap();
    // 3
    app
      .perform_unchecked(GameCommand::SetCreaturePos(t_scene_id(), cid_ranger(), (1, 1, 1)))
      .unwrap();
    app.perform_unchecked(GameCommand::Rollback(0, 2)).unwrap();
    assert_eq!(app.current_game.current_combat, None);
    let scene = app.current_game.get_scene(t_scene_id()).unwrap();
    assert_eq!(scene.get_pos(cid_ranger()).unwrap(), (0, 0, 0));
  }

  ///
  #[test]
  fn rollback_through_rollback() {
    // 0
    let mut app = t_app();
    // 1
    app
      .perform_unchecked(GameCommand::SetCreaturePos(t_scene_id(), cid_ranger(), (1, 1, 1)))
      .unwrap();
    // 2
    app.perform_unchecked(GameCommand::Rollback(0, 0)).unwrap(); // oops didn't mean to move ranger
    // 3
    app
      .perform_unchecked(GameCommand::SetCreaturePos(t_scene_id(), cid_cleric(), (1, 1, 1)))
      .unwrap();
    // 4
    app.perform_unchecked(GameCommand::Rollback(0, 2)).unwrap(); // oops didn't mean to move cleric
    // 5
    app
      .perform_unchecked(GameCommand::SetCreaturePos(t_scene_id(), cid_rogue(), (1, 1, 1)))
      .unwrap();
    let scene = app.current_game.get_scene(t_scene_id()).unwrap();
    assert_eq!(scene.get_pos(cid_cleric()).unwrap(), (0, 0, 0));
    assert_eq!(scene.get_pos(cid_rogue()).unwrap(), (1, 1, 1));
    assert_eq!(scene.get_pos(cid_ranger()).unwrap(), (0, 0, 0));
  }
}
