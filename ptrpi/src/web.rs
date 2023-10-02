use actix_web::{web, HttpResponse, Responder};
use anyhow::Error;
use log::error;

use pandt::types::{AbilityID, CreatureID, GameCommand, ModuleSource, Point3, SceneID};

use crate::actor::AppActor;

pub fn router(actor: AppActor, config: &mut web::ServiceConfig) {
  config
    .app_data(web::Data::new(actor))
    .service(web::resource("/").route(web::get().to(get_app)).route(web::post().to(post_command)))
    .route("poll/{snapshot_len}/{log_len}", web::get().to(poll_app))
    .service(
      web::resource("movement_options/{scene_id}/{cid}").route(web::get().to(movement_options)),
    )
    .service(web::resource("combat_movement_options").route(web::get().to(combat_movement_options)))
    .service(
      web::resource("target_options/{scene_id}/{cid}/{abid}").route(web::get().to(target_options)),
    )
    .service(
      web::resource("preview_volume_targets/{scene_id}/{actor_id}/{ability_id}/{x}/{y}/{z}")
        .route(web::post().to(preview_volume_targets)),
    )
    .service(web::resource("saved_games/{source}/{name}/load_into").route(web::post().to(load_into_folder)))
    .service(web::resource("validate_google_token").route(web::post().to(validate_google_token)));
}

async fn validate_google_token(actor: web::Data<AppActor>, body: web::Bytes) -> impl Responder {
  async fn result(actor: web::Data<AppActor>, body: &[u8]) -> Result<String, Error> {
    let idtoken = std::str::from_utf8(body)?.to_string();
    actor.validate_google_token(idtoken).await?;
    Ok("{}".to_string())
  }

  response(result(actor, &*body).await)
}

async fn get_app(actor: web::Data<AppActor>) -> impl Responder {
  string_json_response(actor.get_app().await?)
}

async fn poll_app(actor: web::Data<AppActor>, path: web::Path<(usize, usize)>) -> impl Responder {
  string_json_response(actor.poll_app(path.0, path.1).await?)
}

async fn post_command(
  actor: web::Data<AppActor>, command: web::Json<GameCommand>,
) -> impl Responder {
  string_json_response(actor.perform_command(command.into_inner()).await?)
}

async fn movement_options(
  actor: web::Data<AppActor>, path: web::Path<(SceneID, CreatureID)>,
) -> impl Responder {
  string_json_response(actor.movement_options(path.0, path.1).await?)
}

async fn combat_movement_options(actor: web::Data<AppActor>) -> impl Responder {
  string_json_response(actor.combat_movement_options().await?)
}

async fn target_options(
  actor: web::Data<AppActor>, path: web::Path<(SceneID, CreatureID, AbilityID)>,
) -> impl Responder {
  string_json_response(actor.target_options(path.0, path.1, path.2).await?)
}

async fn preview_volume_targets(
  actor: web::Data<AppActor>, path: web::Path<(SceneID, CreatureID, AbilityID, i64, i64, i64)>,
) -> impl Responder {
  let point = Point3::new(path.3, path.4, path.5);
  let targets = actor.preview_volume_targets(path.0, path.1, path.2, point).await?;
  string_json_response(serde_json::to_string(&targets)?)
}

#[derive(serde::Deserialize)]
struct LoadIntoFolderPath {

  path: String
}

async fn load_into_folder(actor: web::Data<AppActor>, route: web::Path<(String, String)>, query: web::Query<LoadIntoFolderPath>) -> impl Responder {
  let source_string = route.0.as_ref();
  let source = match source_string {
    "saved_game" => ModuleSource::SavedGame,
    "module" => ModuleSource::Module,
    _ => return string_json_response(format!("{{'error': 'bad source {source_string}'}}"))
  };
  let name = route.1.clone();
  println!("Trying to parse {}: {:?}", &query.path, query.path.parse::<foldertree::FolderPath>());
  let path: foldertree::FolderPath = query.path.parse::<foldertree::FolderPath>()?;
  println!("Loading {source:?} {name} at {path}");
  string_json_response(actor.load_into_folder(source, name, path).await?)
}

async fn load_module_as_game(
  actor: web::Data<AppActor>, path: web::Path<String>,
) -> impl Responder {
  string_json_response(actor.load_saved_game(&path.into_inner(), ModuleSource::Module).await?)
}

async fn save_module(
  actor: web::Data<AppActor>, path: web::Path<String>,
  folder_path: web::Json<::foldertree::FolderPath>,
) -> impl Responder {
  string_json_response(actor.save_module(path.into_inner(), folder_path.into_inner()).await?)
}

fn string_json_response(body: String) -> Result<HttpResponse, Box<dyn ::std::error::Error>> {
  Ok(HttpResponse::Ok().content_type("application/json").body(body))
}


fn response(response: Result<String, Error>) -> impl Responder {
  match response {
    Ok(s) => string_json_response(s),
    Err(e) => {
      let mut obj = std::collections::HashMap::new();
      obj.insert("error", format!("{e:?}"));
      let json = serde_json::to_string(&obj).expect("this had better not fail");
      error!("Web Error: {e:?}");
      Ok(HttpResponse::InternalServerError().content_type("application/json").body(json))
    },
  }
}
