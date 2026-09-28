const pageStyles = `
  :root {
    color-scheme: light;
    --color-paper: #f5f1e9;
    --color-paper-raised: #fffdf8;
    --color-ink: #172f2a;
    --color-green: #27634f;
    --color-focus: #8a3d27;
    --color-line: #d7dbd1;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-6: 24px;
    --space-8: 32px;
    background: var(--color-paper);
    color: var(--color-ink);
    font-family: "Avenir Next", Avenir, ui-sans-serif, system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { min-height: 100dvh; margin: 0; display: grid; place-items: center; padding: var(--space-6); }
  main { width: min(100%, 46rem); border: 1px solid var(--color-line); border-top: 4px solid var(--color-green); background: var(--color-paper-raised); padding: var(--space-8); }
  h1 { margin: 0 0 var(--space-4); font: 400 clamp(3rem, 8vw, 6.5rem)/.98 Georgia, "Times New Roman", serif; letter-spacing: -.045em; }
  p { line-height: 1.65; }
  form { display: grid; gap: var(--space-4); margin-top: var(--space-6); }
  label { display: grid; gap: var(--space-2); font-size: .75rem; font-weight: 700; line-height: 1.4; letter-spacing: .14em; }
  input { width: 100%; border: 1px solid var(--color-ink); background: var(--color-paper-raised); color: inherit; padding: var(--space-3); font: inherit; }
  button { border: 1px solid var(--color-green); background: var(--color-green); color: var(--color-paper-raised); padding: var(--space-3) var(--space-4); font: 700 1rem/1.4 "Avenir Next", Avenir, ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 3px solid var(--color-focus); outline-offset: 3px; }
  [role="alert"] { color: var(--color-focus); font-weight: 700; }
`

export function loginPage(loginFailed = false): string {
  const alert = loginFailed
    ? '<p role="alert">Login failed. Check your credentials and try again.</p>'
    : ""
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Owner login | Reading Studio</title>
    <style>${pageStyles}</style>
  </head>
  <body>
    <main>
      <h1>Owner login</h1>
      <p>This private studio accepts its offline-provisioned owner only.</p>
      ${alert}
      <form action="/login" method="post">
        <label>Email <input name="email" type="email" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">Log in</button>
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
    <style>${pageStyles}</style>
  </head>
  <body>
    <main data-authenticated="true">
      <h1>Reading Studio</h1>
      <p>Your private owner session is active.</p>
      <p><a href="/sources">Read your sources</a></p>
      <form action="/logout" method="post"><button type="submit">Log out</button></form>
    </main>
  </body>
</html>`
}
