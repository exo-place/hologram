import { A, Route, Router } from "@solidjs/router";
import { lazy } from "solid-js";

const EntityList = lazy(() => import("./views/EntityList"));
const EntityDetail = lazy(() => import("./views/EntityDetail"));
const Chat = lazy(() => import("./views/Chat"));
const Debug = lazy(() => import("./views/Debug"));

function Layout(props: { children?: any }) {
  return (
    <div class="layout">
      <nav class="layout__sidebar">
        <div class="nav__logo">Hologram</div>
        <A href="/entities" activeClass="nav__link--active" class="nav__link" end>
          Entities
        </A>
        <A href="/chat" activeClass="nav__link--active" class="nav__link">
          Chat
        </A>
        <A href="/debug" activeClass="nav__link--active" class="nav__link">
          Debug
        </A>
      </nav>
      <main class="layout__content">{props.children}</main>
    </div>
  );
}

export function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={EntityList} />
      <Route path="/entities" component={EntityList} />
      <Route path="/entities/:id" component={EntityDetail} />
      <Route path="/chat" component={Chat} />
      <Route path="/chat/:channelId" component={Chat} />
      <Route path="/debug" component={Debug} />
    </Router>
  );
}
