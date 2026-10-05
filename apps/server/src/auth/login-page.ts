import { readFileSync } from "node:fs"
import { gateArtwork } from "@reading-studio/studio/gate-artwork"

const copiedEntranceStyles = ["tokens.css", "gate.css"]
  .map((file) =>
    readFileSync(new URL(`../../../studio/src/library/css/${file}`, import.meta.url), "utf8"),
  )
  .join("\n")

const sharedStyles = `
  :root {
    color-scheme: light;
    --paper: #f5f1e9;
    --paper-raised: #fffdf8;
    --ink: #172f2a;
    --green: #27634f;
    --green-soft: #d6e7b8;
    --focus: #8a3d27;
    --muted: #63716a;
    --line: #d7dbd1;
    --night: #0d1c18;
    --wall: #254a40;
    --wood: #43301f;
    --wood-deep: #2a1d12;
    --stone: #e4dfd1;
    --stone-deep: #b9b4a4;
    --verdigris: #5f8071;
    --verdigris-deep: #3f5d50;
    --plum: #b8456a;
    --gold: #d9b45b;
    --sky: #a9cdc6;
    --sky-low: #f1e9d3;
    --font-display: Georgia, "Times New Roman", serif;
    --font-display-ja: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, serif;
    --font-body: "Avenir Next", Avenir, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
    font-family: var(--font-body);
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  [lang="ja"] { letter-spacing: .035em; }
  button:focus-visible, input:focus-visible, a:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
`

const loginStyles = `
  ${sharedStyles}
  body { min-height: 100dvh; color: var(--paper); background: var(--night); }
  .gate { min-height: 100dvh; display: flex; align-items: center; justify-content: center; gap: clamp(1.5rem, 5vw, 4rem); padding: 1.5rem; overflow: auto; background: radial-gradient(ellipse at 35% 40%, var(--wall), var(--night) 75%); }
  .gate-scene { flex: none; width: min(30rem, 44vw); filter: drop-shadow(0 16px 24px #0005); }
  .scene-art { display: block; width: 100%; height: auto; }
  .scene-frame { fill: var(--wood); stroke: var(--gold); stroke-width: 2; }
  .scene-sky { fill: url(#sky); }
  .scene-hill { fill: var(--verdigris); }
  .scene-ground { fill: #d3c4a0; }
  .scene-path { fill: var(--stone); stroke: var(--stone-deep); stroke-width: 2; }
  .scene-roof { fill: var(--verdigris-deep); }
  .scene-wood { fill: var(--wood); }
  .scene-dark { fill: var(--wood-deep); }
  .scene-stone { fill: var(--stone); }
  .scene-plaque { fill: var(--wood-deep); stroke: var(--gold); }
  .scene-plaque-text { fill: var(--gold); font: 18px var(--font-display-ja); text-anchor: middle; }
  .scene-blossom { fill: #fbf3ee; stroke: var(--plum); stroke-width: 1; }
  .scene-branch { fill: none; stroke: var(--wood); stroke-width: 5; stroke-linecap: round; }
  .scene-crest { fill: none; stroke: var(--gold); stroke-width: 4; }
  .register { flex: none; width: min(25rem, 100%); padding: 2rem; color: var(--ink); background: var(--paper-raised); border: 1px solid var(--line); box-shadow: 0 12px 40px #0003; }
  .lockup { display: flex; gap: .75rem; align-items: center; margin-bottom: 1.5rem; }
  .brand-mark { flex: none; width: 2.75rem; height: 2.75rem; color: var(--plum); fill: none; stroke: currentColor; stroke-width: 4; }
  .lockup-name { margin: 0; font: 1.5rem var(--font-display); letter-spacing: .15em; }
  .lockup-sub { margin: .25rem 0 0; color: var(--muted); font-size: .6875rem; }
  .lockup-sub [lang="ja"], h1 [lang="ja"] { display: block; }
  .plate { margin: 0 0 .75rem; color: var(--muted); font-size: .6875rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .plate [lang="ja"] { margin-inline-start: .5rem; }
  h1 { margin: 0 0 .75rem; font: 400 1.9rem/1.15 var(--font-display); letter-spacing: -.02em; }
  h1 [lang="ja"] { margin-top: .25rem; font: 400 1.05rem/1.85 var(--font-display-ja); }
  .register-note { margin: 0 0 .25rem; color: var(--muted); font-size: .8125rem; line-height: 1.55; }
  .alert { margin: 1rem 0 0; padding: .75rem; border: 1px dashed var(--focus); color: var(--focus); background: var(--paper-raised); font-size: .8125rem; font-weight: 700; }
  label { display: block; margin-top: 1rem; font-size: .8125rem; font-weight: 600; }
  label small { margin-inline-start: .25rem; color: var(--muted); font-weight: 500; }
  input { display: block; width: 100%; margin-top: .25rem; padding: .75rem; border: 1px solid var(--line); border-radius: 2px; color: inherit; background: var(--paper); font: inherit; }
  button { display: inline-flex; width: 100%; align-items: baseline; justify-content: center; gap: .5rem; margin-top: 1.5rem; padding: .75rem 1rem; border: 1px solid var(--green); border-radius: 2px; color: var(--paper-raised); background: var(--green); font: 600 .875rem/1.3 var(--font-body); cursor: pointer; }
  button:hover { background: var(--ink); border-color: var(--ink); }
  button [lang="ja"] { font-size: .75rem; font-weight: 500; }
  .shrine-reference { margin: 1.5rem 0 0; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .75rem; line-height: 1.55; }
  .shrine-reference small { display: block; margin-top: .25rem; }
  .shrine-reference a { color: inherit; white-space: nowrap; }
  @media (max-width: 60rem) {
    .gate { flex-direction: column; justify-content: flex-start; gap: 1.5rem; padding: 1rem; }
    .gate-scene { width: min(20rem, 100%); }
    .register { padding: 1.5rem; }
  }
`

const ownerStyles = `
  ${sharedStyles}
  body { min-height: 100dvh; display: grid; place-items: center; padding: 1.5rem; color: var(--ink); background: radial-gradient(ellipse at 35% 40%, var(--wall), var(--night) 75%); }
  main { width: min(100%, 46rem); border: 8px solid var(--wood); border-top: 4px solid var(--gold); background: var(--paper-raised); padding: 2rem; }
  h1 { margin: 0 0 1rem; font: 400 clamp(3rem, 8vw, 6.5rem)/.98 var(--font-display); letter-spacing: -.045em; }
  p { line-height: 1.65; }
  form { margin-top: 1.5rem; }
  button { border: 1px solid var(--green); background: var(--green); color: var(--paper-raised); padding: .75rem 1rem; font: 700 1rem/1.4 var(--font-body); cursor: pointer; }
`

export function redirectWithCookies(authResponse: Response, location: string): Response {
  const headers = new Headers({ location })
  for (const cookie of authResponse.headers.getSetCookie()) headers.append("set-cookie", cookie)
  return new Response(null, { headers, status: 303 })
}

export function adaptAuthRequest(request: Request, path: string, body?: string): Request {
  const headers = new Headers(request.headers)
  headers.delete("content-length")
  if (body === undefined)
    return new Request(new URL(path, request.url), {
      headers,
      method: "POST",
      signal: request.signal,
    })
  headers.set("content-type", "application/json")
  return new Request(new URL(path, request.url), {
    body,
    headers,
    method: "POST",
    signal: request.signal,
  })
}

export function loginPage(
  loginFailed = false,
  mode: "login" | "authentication-required" = "login",
): string {
  let notice = ""
  switch (mode) {
    case "login":
      break
    case "authentication-required":
      notice =
        '<section role="alert"><h2>Authentication required / 再ログインが必要です</h2><p>Your owner session expired. Sign in to return to the hall.</p><p lang="ja">ログインして広間に戻ってください。</p><a href="/login">Sign in / ログイン</a></section>'
      break
    default: {
      const unreachable: never = mode
      return unreachable
    }
  }
  const alert = loginFailed
    ? '<p class="alert" role="alert">Login failed. Check your credentials and try again.<br><span lang="ja">ログインに失敗しました。入力内容を確認して、もう一度お試しください。</span></p>'
    : ""
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Members' entrance | Tenjinsan Reading Studio</title>
    <style>${loginStyles}${copiedEntranceStyles}.gate-scene{filter:none}.library-entrance .brand-mark{fill:none;stroke:currentColor;stroke-width:4}</style>
    <script src="/entrance-decoration.js" defer></script>
  </head>
  <body>
    <main id="gate" class="gate library-entrance" aria-labelledby="gate-title">
      <div class="gate-scene" aria-hidden="true">
        ${gateArtwork}
      </div>
      <form class="register" id="login" action="/login" method="post">
        <div class="lockup">
          <svg class="brand-mark" aria-hidden="true"><use href="#crest"/></svg>
          <div><p class="lockup-name" id="gate-title">TENJINSAN</p><p class="lockup-sub">Reading Studio <span lang="ja">問いからひらく読書</span></p></div>
        </div>
        <p class="plate">Members' entrance <span lang="ja">入館口</span></p>
        <h1 aria-label="Owner login">Enter the library <span lang="ja">図書室に入る</span></h1>
        <p class="register-note">A private library for one owner. There is no public sign-up.</p>
        <p class="register-note" lang="ja">個人専用の図書室です。新規登録はありません。</p>
        ${alert}
        ${notice}
        <label><span>Email <small lang="ja">メール</small></span><input name="email" type="email" autocomplete="username" required></label>
        <label><span>Password <small lang="ja">パスワード</small></span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary" type="submit" aria-label="Log in">Enter <span lang="ja">入館する</span></button>
        <p class="shrine-reference">A quiet place for literature and learning, inspired by <a href="https://ja.wikipedia.org/wiki/北野天満宮" lang="ja">北野天満宮</a>.<small lang="ja">学問の神さま、天神さんに着想を得た私の図書室。</small><small>Independent design study, not affiliated with the shrine.</small></p>
      </form>
    </main>
  </body>
</html>`
}

export function ownerPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Reading Studio</title>
    <style>${ownerStyles}</style>
  </head>
  <body>
    <main data-authenticated="true">
      <p>TENJINSAN <span lang="ja">私の図書室</span></p>
      <h1>Reading Studio</h1>
      <p>Your private owner session is active.</p>
      <p><a href="/sources">Read your sources</a></p>
      <form action="/logout" method="post"><button type="submit">Log out</button></form>
    </main>
  </body>
</html>`
}
