# P&T

P&T is a social role-playing game. It's not a video game -- rather, it's akin to tabletop
role-playing games like Dungeons & Dragons, but instead of needing books and character sheets, the
app takes care of everything for you. It provides a tactical combat map and makes it easy for
players and the Game Master to use their abilities.

# Status: Early development. Not a game yet.

# License

MIT-licensed: http://opensource.org/licenses/MIT


# Building/running (for dev/test)

To start the backend:

```cd ptrpi; cargo run```

To load the UI:

```
cd ptui; elm reactor; open http://localhost:8000/src/GMTest.elm
```

Load PlayerTest.elm to load the Player UI.
