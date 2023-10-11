use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::{anyhow, Context, Result as AEResult};
use futures::channel::oneshot;
use tokio::{sync::Mutex, time::timeout};
use tracing::{debug, error, info, instrument};

use crate::{
  storage::{load_game, Storage},
  types::{GameID, GameIndex, GameList, GameMetadata, GameProfile, InvitationID, Role, UserID},
};

use arpeggio::types::{self, Game, GMCommand, PlayerID, PlayerCommand};

#[derive(thiserror::Error, Debug)]
#[error("Authentication Error")]
pub struct AuthenticationError {
  #[from]
  pub from: anyhow::Error,
}

/// AuthenticatableService is a capability layer that hands out AuthenticatedServices to users who
/// authenticate.
#[derive(Clone)]
pub struct AuthenticatableService {
  pub storage: Arc<dyn Storage>,

  ping_service: Arc<PingService>,

  /// This is google client ID
  pub google_client_id: String,
  /// Cached certs for use by google_signin
  pub cached_certs: Arc<Mutex<google_signin::CachedCerts>>,
}

impl AuthenticatableService {
  pub fn new(storage: Arc<dyn Storage>, google_client_id: String) -> AuthenticatableService {
    AuthenticatableService {
      storage,
      google_client_id,
      cached_certs: Arc::new(Mutex::new(google_signin::CachedCerts::new())),
      ping_service: Arc::new(PingService::new()),
    }
  }

  /// Verify a google ID token and return an AuthenticatedService if it's valid.
  pub async fn authenticate(
    &self, google_id_token: String,
  ) -> Result<AuthenticatedService, AuthenticationError> {
    let user_id = self
      .validate_google_token(&google_id_token)
      .await
      .context("Validating Google ID Token".to_string())
      .map_err(|e| AuthenticationError { from: e })?;
    Ok(AuthenticatedService {
      user_id,
      storage: self.storage.clone(),
      ping_service: self.ping_service.clone(),
    })
  }

  async fn validate_google_token(&self, id_token: &str) -> AEResult<UserID> {
    let mut certs = self.cached_certs.lock().await;
    certs.refresh_if_needed().await?;
    let mut client = google_signin::Client::new();
    client.audiences.push(self.google_client_id.clone());
    let id_info = client.verify(id_token, &certs).await?;
    let expiry = std::time::UNIX_EPOCH + Duration::from_secs(id_info.exp);
    let time_until_expiry = expiry.duration_since(std::time::SystemTime::now());
    debug!(
      "validate-token: email={:?} name={:?} sub={:?} expires={:?} expires IN: {:?}",
      id_info.email, id_info.name, id_info.sub, id_info.exp, time_until_expiry
    );
    Ok(UserID(format!("google_{}", id_info.sub)))
  }
}

/// AuthenticatedService is a capability layer that exposes functionality to authenticated users.
/// One important responsibility is that this layer *authorizes* users to access specific games and
/// hands out PlayerServices and GMServices.
pub struct AuthenticatedService {
  pub user_id: UserID,
  pub storage: Arc<dyn Storage>,
  ping_service: Arc<PingService>,
}

impl AuthenticatedService {
  pub async fn new_game(&self, name: String) -> AEResult<GameID> {
    let game: Game = Default::default();
    let game_id = self.storage.create_game(&self.user_id, &game, &name).await?;
    Ok(game_id)
  }

  pub async fn list_games(&self) -> AEResult<GameList> {
    let usergames = self.storage.list_user_games(&self.user_id).await?;
    let mut games = vec![];
    for profile in usergames {
      games.push((profile.clone(), self.storage.load_game_metadata(&profile.game_id).await?));
    }
    Ok(GameList { games })
  }

  async fn find_game(&self, game_id: &GameID, role: Role) -> AEResult<(Game, GameIndex)> {
    let games = self.storage.list_user_games(&self.user_id).await?;
    for game in games {
      if game.user_id == self.user_id && game.role == Role::GM {
        return load_game(&*self.storage, game_id)
          .await
          .context(format!("Loading game {game_id:?}"));
      }
    }
    Err(anyhow!("User {:?} is not a {role:?} of game {game_id:?}", self.user_id))
  }

  pub async fn gm(&self, game_id: &GameID) -> AEResult<GMService> {
    let (game, game_index) = self.find_game(game_id, Role::GM).await?;
    Ok(GMService {
      storage: self.storage.clone(),
      game_id: *game_id,
      game,
      game_index,
      ping_service: self.ping_service.clone(),
    })
  }

  pub async fn player(&self, game_id: &GameID) -> AEResult<PlayerService> {
    let (game, game_index) = self.find_game(game_id, Role::Player).await?;
    let profiles = self.storage.list_user_games(&self.user_id).await?;
    // this is unfortunate; our storage layer makes it possible to have multiple GameProfiles for
    // the same UserID & game, but here we only get the first instead of letting the user select.
    let profile = profiles
      .into_iter()
      .find(|profile| profile.game_id == *game_id && profile.role == Role::Player);
    let profile = profile.ok_or(anyhow!("Couldn't find player ID for this game"))?;

    Ok(PlayerService {
      player_id: profile.profile_name,
      storage: self.storage.clone(),
      game_id: *game_id,
      game,
      game_index,
      ping_service: self.ping_service.clone(),
    })
  }

  // While these take GameIDs, they cannot be part of GMService because GMService represents
  // someone's already-authorized access to a Game, but you need to be able to check & accept
  // invitations before you have access to a game!
  pub async fn check_invitation(
    &self, game_id: &GameID, invitation_id: &InvitationID,
  ) -> AEResult<bool> {
    self.storage.check_invitation(game_id, invitation_id).await
  }

  pub async fn accept_invitation(
    &self, game_id: &GameID, invitation_id: &InvitationID, profile_name: PlayerID,
  ) -> AEResult<GameProfile> {
    // we need to tell the storage layer that we've accepted the invitation, but we also need to
    // register the player in the Game object itself.

    let profile =
      self.storage.accept_invitation(&self.user_id, game_id, invitation_id, profile_name).await?;
    let (game, _idx) = load_game(&*self.storage, game_id).await?;

    let command = GMCommand::RegisterPlayer(profile.profile_name.clone());
    // Probably need to share this code with GMService.perform_command
    let changed_game = game.perform_gm_command(command)?;
    self.storage.apply_game_logs(game_id, &changed_game.logs).await?;
    self.ping_service.ping(game_id).await?;

    Ok(profile)
  }
}

pub struct GMService {
  pub storage: Arc<dyn Storage>,
  pub game: Game,
  pub game_index: GameIndex,
  pub game_id: GameID,
  ping_service: Arc<PingService>,
}

impl GMService {
  pub async fn get_game(&self) -> AEResult<(&Game, GameIndex, GameMetadata)> {
    Ok((&self.game, self.game_index, self.storage.load_game_metadata(&self.game_id).await?))
  }

  /// Wait for a Game to change and then return it.
  #[instrument(level = "debug", skip(self))]
  pub async fn poll_game(&self, game_index: GameIndex) -> AEResult<()> {
    Ok(poll_game(self.game_id, self.game_index, &*self.ping_service).await?)
  }

  pub async fn invite(&self) -> AEResult<InvitationID> {
    Ok(self.storage.invite(&self.game_id).await?.id)
  }

  pub async fn list_invitations(&self) -> AEResult<Vec<InvitationID>> {
    Ok(self.storage.list_invitations(&self.game_id).await?.into_iter().map(|i| i.id).collect())
  }

  pub async fn perform_command(&self, command: GMCommand) -> AEResult<types::ChangedGame> {
    let log_cmd = command.clone();
    info!("perform_gm_command:start: {:?}", &log_cmd);
    let changed_game = self.game.perform_gm_command(command)?;
    self.storage.apply_game_logs(&self.game_id, &changed_game.logs).await?;
    self.ping_service.ping(&self.game_id).await?;
    debug!("perform_gm_command:done: {:?}", &log_cmd);
    Ok(changed_game)
  }

  pub async fn movement_options(
    &self, scene_id: types::SceneID, creature_id: types::CreatureID,
  ) -> AEResult<Vec<types::Point3>> {
    let options = self.game.get_movement_options(scene_id, creature_id)?;
    Ok(options)
  }

  pub async fn combat_movement_options(&self) -> AEResult<Vec<types::Point3>> {
    let options = self.game.get_combat()?.current_movement_options()?;
    Ok(options)
  }

  pub async fn target_options(
    &self, scene_id: types::SceneID, creature_id: types::CreatureID, ability_id: types::AbilityID,
  ) -> AEResult<types::PotentialTargets> {
    let options = self.game.get_target_options(scene_id, creature_id, ability_id)?;
    Ok(options)
  }

  pub async fn preview_volume_targets(
    &self, scene_id: types::SceneID, actor_id: types::CreatureID, ability_id: types::AbilityID,
    point: types::Point3,
  ) -> AEResult<(Vec<types::CreatureID>, Vec<types::Point3>)> {
    let scene = self.game.get_scene(scene_id)?;
    let targets = self.game.preview_volume_targets(scene, actor_id, ability_id, point)?;
    Ok(targets)
  }

  pub async fn load_into_folder(
    &self, game_id_to_load: &GameID, _folder_path: foldertree::FolderPath,
  ) -> AEResult<String> {
    let _game_to_load = load_game(&*self.storage, game_id_to_load).await?;
    Ok("".to_string())
    // RADIX FIXME TODO: update the GMCommand for LoadModule.
    // let command = GMCommand::LoadModule {
    //   game: game_to_load,
    //   path: folder_path,
    // };
    // self.perform_gm_command(command).await
  }
}

pub struct PlayerService {
  pub player_id: PlayerID,
  pub storage: Arc<dyn Storage>,
  pub game: Game,
  pub game_index: GameIndex,
  pub game_id: GameID,
  ping_service: Arc<PingService>,
}

impl PlayerService {
  pub async fn get_game(&self) -> AEResult<(&Game, GameIndex, GameMetadata)> {
    // TODO: Don't return Game, return PlayerGame!
    Ok((&self.game, self.game_index, self.storage.load_game_metadata(&self.game_id).await?))
  }

  /// Wait for a Game to change and then return it.
  #[instrument(level = "debug", skip(self))]
  pub async fn poll_game(&self, game_index: GameIndex) -> AEResult<()> {
    Ok(poll_game(self.game_id, game_index, &*self.ping_service.clone()).await?)
  }

  pub async fn invite(&self) -> AEResult<InvitationID> {
    Ok(self.storage.invite(&self.game_id).await?.id)
  }

  pub async fn list_invitations(&self) -> AEResult<Vec<InvitationID>> {
    Ok(self.storage.list_invitations(&self.game_id).await?.into_iter().map(|i| i.id).collect())
  }

  pub async fn perform_command(&self, command: PlayerCommand) -> AEResult<types::ChangedGame> {
    let log_cmd = command.clone();
    info!("perform_player_command:start: {:?}", &log_cmd);
    let changed_game = self.game.perform_player_command(self.player_id.clone(), command)?;
    self.storage.apply_game_logs(&self.game_id, &changed_game.logs).await?;
    self.ping_service.ping(&self.game_id).await?;
    debug!("perform_player_command:done: {:?}", &log_cmd);
    Ok(changed_game)
  }

  pub async fn movement_options(
    &self, scene_id: types::SceneID, creature_id: types::CreatureID,
  ) -> AEResult<Vec<types::Point3>> {
    // we accept scene_id here, but it really has to be identical to the current player's focus.
    let player =
      self.game.players.get(&self.player_id).ok_or(anyhow!("playerID should be there"))?;
    if player.scene != Some(scene_id) {
      return Err(anyhow!("Player is not on this scene."));
    }

    let options = self.game.get_movement_options(scene_id, creature_id)?;
    Ok(options)
  }

  // pub async fn combat_movement_options(&self) -> AEResult<Vec<types::Point3>> {
  //   let options = self.game.get_combat()?.current_movement_options()?;
  //   Ok(options)
  // }

  // pub async fn target_options(
  //   &self, scene_id: types::SceneID, creature_id: types::CreatureID, ability_id: types::AbilityID,
  // ) -> AEResult<types::PotentialTargets> {
  //   let options = self.game.get_target_options(scene_id, creature_id, ability_id)?;
  //   Ok(options)
  // }

  // pub async fn preview_volume_targets(
  //   &self, scene_id: types::SceneID, actor_id: types::CreatureID, ability_id: types::AbilityID,
  //   point: types::Point3,
  // ) -> AEResult<(Vec<types::CreatureID>, Vec<types::Point3>)> {
  //   let scene = self.game.get_scene(scene_id)?;
  //   let targets = self.game.preview_volume_targets(scene, actor_id, ability_id, point)?;
  //   Ok(targets)
  // }
}

/// The PingService coordinates the notification of all players in a game session so that they get
/// instantly updated whenever a change happens to the game they're playing.
// This should go away and be replaced with a CloudFlare Workers Durable Object using Hibernatable
// WebSockets.
struct PingService {
  waiters: Mutex<HashMap<GameID, Vec<oneshot::Sender<()>>>>,
}

impl PingService {
  pub fn new() -> PingService { PingService { waiters: Mutex::new(HashMap::new()) } }

  pub async fn register_waiter(&self, game_id: &GameID, sender: oneshot::Sender<()>) {
    let mut waiters = self.waiters.lock().await;
    let game_waiters = waiters.entry(*game_id);
    game_waiters.and_modify(|v| v.push(sender)).or_insert(vec![]);
  }

  pub async fn ping(&self, game_id: &GameID) -> AEResult<()> {
    let mut waiters = self.waiters.lock().await;

    if let Some(waiters) = waiters.get_mut(game_id) {
      for sender in waiters.drain(0..) {
        if let Err(e) = sender.send(()) {
          error!("game_changed:receiver-unavailable when sending {:?}", e);
        }
      }
    }
    Ok(())
  }
}

async fn poll_game(
  game_id: GameID, game_index: GameIndex, ping_service: &PingService,
) -> AEResult<()> {
  // First, if the app has already changed, return it immediately.
  if game_index != game_index {
    return Ok(());
  }
  // Now, we wait.
  let (sender, receiver) = oneshot::channel();
  ping_service.register_waiter(&game_id, sender).await;
  let event = timeout(Duration::from_secs(30), receiver).await;
  match event {
    Ok(_) => {
      // The oneshot was canceled. I'm not really sure what this means or why it happens.
    }
    Err(_) => {
      // Timeout; just return the state of the app
    }
  }
  Ok(())
}