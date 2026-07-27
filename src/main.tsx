import { render } from "preact";
import { App } from "./ui/App.js";
import { boot } from "./state/init.js";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/components.css";

// Boot before first render so the initial paint reflects restored state
// (localStorage autosave or share-URL payload), not the baked defaults.
boot();

render(<App />, document.getElementById("app")!);