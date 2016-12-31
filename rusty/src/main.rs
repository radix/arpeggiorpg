#![feature(proc_macro)]
extern crate pandt;
extern crate serde_json;
#[macro_use]
extern crate serde_derive;

use std::fs::File;
use std::io::Read;

mod types;

fn load_json() -> serde_json::error::Result<pandt::App> {
    let mut gamefile = File::open("game.json").unwrap();
    let mut data = "".to_owned();
    let _ = gamefile.read_to_string(&mut data);
    serde_json::from_str(&data)
}

fn main() {
    match load_json() {
        Ok(mut app) => {
            println!("{:?}", app);

            let r = app.act("Punch".to_string(), vec![1]);
            println!("Result of choosing ability: {:?}", r);
            println!("Current json: {}",
                     serde_json::to_string_pretty(&app).unwrap());
        }
        Err(e) => println!("Sorry, error loading json: {}", e),
    }
}
