use console_error_panic_hook;
use futures_util::stream::StreamExt;
use std::{
  panic,
  sync::{Arc, Mutex},
};
use wasm_bindgen::JsValue;
use worker::*;

use arpeggio::types::Game;

use crate::wsrpi::GameSession;

mod wsrpi;

// Things I've learned about error-handling in workers-rs:
// - any Err returned from the main worker doesn't seem to do anything other than "Error: The script
//   will never generate a response.". So there *must* be an error handler in main that produces a
//   custom Response. (turns out I'm wrong: see `respond_with_errors`)
//   - The same is not true for the Durable Object. When I return an Err from the DO, it ends up in
//     the HTTP response.

// - Panics in the worker do not get printed anywhere, as far as I can tell, and they result in the
//   same "The script will never generate a response" message.
//   - Panics in the Durable Object are even worse; the DO seems to disappear from the face of the
//     net and the Worker just hangs waiting from a response instead of getting some sort of error.

// So, we can just use a panic hook to log the panics. However, I'm still concerned about the fact
// that a panicking DO does not immediately return a 500 or even seem to drop the connection to the
// waiting Worker. I'll have to see what the behavior is in actual production; maybe this is just a
// behavior of the local dev environment.

#[event(start)]
fn start() { panic::set_hook(Box::new(console_error_panic_hook::hook)); }

#[event(fetch, respond_with_errors)]
async fn main(req: Request, env: Env, ctx: Context) -> Result<Response> {
  console_log!("[worker] Start");
  let result = Router::new()
    .on_async("/durable/:message", |_req, ctx| async move {
      let message = ctx.param("message").unwrap();
      let namespace = ctx.durable_object("ARPEGGIOGAME")?;
      let stub = namespace.id_from_name("chatty-b")?.get_stub()?;
      let mut headers = Headers::new();
      headers.set("content-type", "application/json")?;
      // I don't know why, but for some reason if I try to use
      // serde_wasem_bindgen to generate this RequestInit body, I just end up
      // getting "[object Map]".
      let body = serde_json::json!({"message": message});
      let body = serde_json::to_string(&body)?;
      let body = JsValue::from_str(&body);
      let mut init = RequestInit::new();
      init.with_headers(headers).with_method(Method::Post).with_body(Some(body));
      let req = Request::new_with_init("https://fake-host/message", &init)?;
      stub.fetch_with_request(req).await
    })
    .on_async("/arpeggio", |_req, ctx| async move {
      let namespace = ctx.durable_object("ARPEGGIOGAME")?;
      let stub = namespace.id_from_name("chatty-b")?.get_stub()?;
      stub.fetch_with_str("https://fake-host/arpeggio").await
    })
    .get("/websocket", |_, ctx| {
      console_log!("[worker] WEBSOCKET");
      let pair = WebSocketPair::new()?;
      let server = pair.server;
      server.accept()?;

      wasm_bindgen_futures::spawn_local(async move {
        let mut event_stream = server.events().expect("could not open stream");

        while let Some(event) = event_stream.next().await {
          match event.expect("received error in websocket") {
            WebsocketEvent::Message(msg) => {
              if let Some(text) = msg.text() {
                console_log!("[worker] Echoing text: {text:?}");
                server.send_with_str(text).expect("could not relay text");
              }
            }
            WebsocketEvent::Close(_) => {
              console_log!("[worker] Closed WebSocket");
            }
          }
        }
      });

      Response::from_websocket(pair.client)
    })
    .on_async("/game/:id", |req, ctx| async move {
      let id = ctx.param("id").expect("id should exist because it's in the route");
      console_log!("[worker] GAME {id}");
      let namespace = ctx.durable_object("ARPEGGIOGAME")?;
      let stub = namespace.id_from_name(id)?.get_stub()?;
      return Ok(stub.fetch_with_request(req).await?);
    })
    .run(req, env)
    .await;
  console_log!("[worker] Done");
  result
}

#[durable_object]
pub struct ArpeggioGame {
  state: State,
  env: Env,
  game: Arc<Mutex<Game>>,
}

#[durable_object]
impl DurableObject for ArpeggioGame {
  fn new(state: State, env: Env) -> Self { Self { state, env, game: Default::default() } }

  async fn fetch(&mut self, mut req: Request) -> Result<Response> {
    console_log!("[DO] start");
    let path = req.path();
    console_log!("[DO] method={:?} path={path:?} headers={:?}", req.method(), req.headers());
    let mut storage = self.state.storage();
    if path == "/message" {
      let json = &req.json::<serde_json::Value>().await?;
      console_log!("[DO] JSON: {json:?}");
      let message = json
        .get("message")
        .ok_or(Error::RustError("Can't find message in json body".to_string()))?;
      console_log!("[DO] Here's the message: {message:?}");

      let messages = storage.get::<Vec<String>>("messages").await;
      let mut messages = messages.unwrap_or_else(|_| vec![]);
      messages.push(message.to_string());
      storage.put("messages", messages.clone()).await?;
      let messages =
        messages.into_iter().map(|m| format!("<li>{m}</li>")).collect::<Vec<String>>().concat();
      let html = format!("<html><body><ul>{messages}</ul></body></html>");
      return Response::from_html(html);
    } else if path == "/arpeggio" {
      let game: Game = Default::default();
      return Response::from_json(&game);
    } else if path.starts_with("/game") {
      console_log!("[DO] GAME {path}");
      console_log!("[worker] WEBSOCKET");
      let pair = WebSocketPair::new()?;
      let server = pair.server;
      server.accept()?;

      let game = self.game.clone();

      wasm_bindgen_futures::spawn_local(async move {
        let live_game = GameSession::new(game.clone(), server);
        live_game.run().await;
      });

      Response::from_websocket(pair.client)
    } else {
      return Response::error("bad URL to DO", 404);
    }
  }
}
