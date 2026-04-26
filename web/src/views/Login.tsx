import "./Login.css";

export default function Login() {
  return (
    <div class="login">
      <div class="login__card">
        <div class="login__logo">Hologram</div>
        <p class="login__subtitle">Sign in to access moderation tools</p>
        <a href="/api/auth/discord/login" class="login__btn">
          Sign in with Discord
        </a>
      </div>
    </div>
  );
}
