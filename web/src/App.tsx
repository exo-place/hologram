import { A, Route, Router } from "@solidjs/router";
import { lazy } from "solid-js";

const EntityList = lazy(() => import("./views/EntityList"));
const EntityDetail = lazy(() => import("./views/EntityDetail"));
const Chat = lazy(() => import("./views/Chat"));
const Debug = lazy(() => import("./views/Debug"));
const Login = lazy(() => import("./views/Login"));
const Mutes = lazy(() => import("./views/Mutes"));
const Audit = lazy(() => import("./views/Audit"));

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
        <A href="/mutes" activeClass="nav__link--active" class="nav__link">
          Mutes
        </A>
        <A href="/audit" activeClass="nav__link--active" class="nav__link">
          Audit
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
      <Route path="/login" component={Login} />
      <Route path="/mutes" component={Mutes} />
      <Route path="/audit" component={Audit} />
    </Router>
  );
}
