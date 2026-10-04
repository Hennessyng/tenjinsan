// Desk screens for rooms 1-5. Every screen returns { stamp, sheet, note } and is
// rendered into the same desk-panel frame by desk.js. All data is synthetic.
;(() => {
  window.TJ = window.TJ || {}
  const TJ = window.TJ
  TJ.screens = TJ.screens || {}

  // Shared button helper: one place for the paired EN / JA button label.
  TJ.btn = (cls, en, ja, act) =>
    `<button type="button" class="btn ${cls}" data-act="${act}">${TJ.bi(en, ja)}</button>`

  const note = (titleEn, titleJa, en, ja) =>
    `<h3>${titleEn} <span lang="ja">${titleJa}</span></h3>${TJ.p(en, ja)}`

  TJ.screens.accession = () => ({
    stamp: TJ.stamp("done", "Accessioned", "受入済み"),
    sheet: `
      <div class="paper">
        <h3>Intake tray <span lang="ja">受入トレイ</span></h3>
        ${TJ.p(
          "Place a book on the counter. It stays here until you decide what happens next.",
          "本をカウンターに置いてください。次の操作を決めるまで、ここに保管されます。",
        )}
        <div class="tray">
          <b>Sample Lecture Notes.pdf</b>
          <span>2.4 MB, 18 pages</span>
          <span lang="ja">2.4 MB・18ページ</span>
        </div>
        <div class="btn-row">
          ${TJ.btn("btn-primary", "Choose another book", "別の本を選ぶ", "choose")}
          ${TJ.btn("btn-quiet", "Open in the stacks", "書庫で開く", "go:stacks")}
        </div>
      </div>
      <div class="paper">
        <h3>Chapter coverage <span lang="ja">章の取り込み状況</span></h3>
        <ol class="chapters">
          <li>1. Why questions come first ${TJ.stamp("done", "Read", "取込済")}</li>
          <li>2. Reading as a conversation ${TJ.stamp("done", "Read", "取込済")}</li>
          <li>3. Notes that survive a month ${TJ.stamp("warn", "Partly read", "一部のみ")}</li>
        </ol>
      </div>`,
    note: note(
      "Why it exists",
      "ここは何のため？",
      "Accession is the front door for any source. It only receives the file.",
      "受入は資料の入口です。ファイルを受け取るだけで、何も外へは送りません。",
    ),
  })

  const SPINES = [
    ["Lecture 1", "#27634f"],
    ["Lecture 2", "#c75b4a"],
    ["Notes", "#8a6a3a"],
    ["Paper", "#3d5a80"],
    ["Handout", "#6b4c7a"],
  ]

  TJ.screens.stacks = () => ({
    stamp: TJ.stamp("done", "Source ready", "資料の準備完了"),
    sheet: `
      <div class="paper">
        <h3>Pick a book <span lang="ja">本を選ぶ</span></h3>
        <div class="shelf-row" role="group" aria-label="Sources on the shelf / 書棚の資料">
          ${SPINES.map(
            ([t, c], i) =>
              `<button type="button" class="spine-btn" style="--sc:${c}" aria-pressed="${i === 0}" data-act="spine">${t}</button>`,
          ).join("")}
        </div>
      </div>
      <div class="paper">
        <h3>Lecture 1: Why questions come first <span lang="ja">第1講</span></h3>
        <ol class="chapters">
          <li>A reader who asks first remembers more.</li>
          <li><span class="cite">The question is the map; the text is the territory.</span> (p. 4)</li>
          <li>Three kinds of question: what, why, so what.</li>
        </ol>
        <p lang="ja">先に問いを立てて読むと、読後の記憶が定着しやすくなります。</p>
        <div class="btn-row">
          ${TJ.btn("btn-primary", "Set up a study", "学習を設定する", "go:lending")}
          ${TJ.btn("btn-quiet", "Highlight a passage", "箇所に印をつける", "mark")}
        </div>
      </div>`,
    note: note(
      "Reading only",
      "読むだけの部屋",
      "Highlights stay on this shelf. Nothing here is sent anywhere.",
      "印をつけた箇所はこの書棚に残るだけで、外部には送られません。",
    ),
  })

  TJ.screens.lending = () => ({
    stamp: TJ.stamp("done", "Slip ready", "貸出票あり"),
    sheet: `
      <div class="paper">
        <h3>Lending slip <span lang="ja">貸出票</span></h3>
        ${TJ.p(
          "Only the chapters you tick below would leave the library.",
          "チェックした章だけが、外部に渡る対象になります。",
        )}
        <label class="field">Provider <small lang="ja">提供元</small>
          <select><option>Provider A (sample)</option><option>Provider B (sample)</option></select>
        </label>
        <label class="field">Model <small lang="ja">モデル</small>
          <select><option>Standard</option><option>Careful</option></select>
        </label>
        <fieldset>
          <legend>Chapters to send <span lang="ja">渡す章</span></legend>
          <label class="choice"><input type="checkbox" checked /><span>1. Why questions come first</span></label>
          <label class="choice"><input type="checkbox" checked /><span>2. Reading as a conversation</span></label>
          <label class="choice"><input type="checkbox" /><span>3. Notes that survive a month <small>Left out: contains private notes / 非公開メモを含むため除外</small></span></label>
        </fieldset>
        <dl class="slip">
          <dt>Leaves <small lang="ja">外部へ</small></dt><dd>2 of 3 chapters, about 5,200 characters</dd>
          <dt>Stays <small lang="ja">手元に残る</small></dt><dd>Chapter 3 and all your highlights</dd>
        </dl>
        <div class="btn-row">
          ${TJ.btn("btn-primary", "Send", "送る", "send")}
          ${TJ.btn("btn-quiet", "Revise", "修正する", "revise")}
          ${TJ.btn("btn-quiet", "Cancel", "取り消す", "cancel")}
        </div>
      </div>`,
    note: note(
      "You are in control",
      "決めるのはあなた",
      "This is the one place where text can leave. Send is explicit and can be cancelled.",
      "外部へ出るのはこの手続きだけです。送信は明示的で、取り消せます。",
    ),
  })

  TJ.screens.reference = () => ({
    stamp: TJ.stamp("now", "Question 3 of 5", "質問 3 / 5"),
    sheet: `
      <div class="paper">
        <div class="progress-dots" role="img" aria-label="3 of 5 answered / 5問中3問目">
          <i data-on="1"></i><i data-on="1"></i><i data-on="1"></i><i></i><i></i>
        </div>
        <h3>What do you already know? <span lang="ja">すでに知っていること</span></h3>
        ${TJ.p(
          "Before reading chapter 2, what would you say a good question looks like?",
          "第2章を読む前に、良い問いとはどんなものだと思いますか。",
        )}
        <label class="field">Your answer <small lang="ja">あなたの答え</small>
          <textarea rows="4">One that I cannot answer from the title alone.</textarea>
        </label>
        <div class="btn-row">
          ${TJ.btn("btn-primary", "Save and continue", "保存して次へ", "next")}
          ${TJ.btn("btn-quiet", "Skip this one", "この問いを飛ばす", "skip")}
        </div>
      </div>
      <div class="cards">
        <div class="index-card"><h4>Q1 <span lang="ja">質問1</span></h4><p>Why are you reading this?</p><p class="meta">Answered / 回答済み</p></div>
        <div class="index-card"><h4>Q2 <span lang="ja">質問2</span></h4><p>What would change if you understood it?</p><p class="meta">Answered / 回答済み</p></div>
      </div>`,
    note: note(
      "Short on purpose",
      "あえて短く",
      "A few questions only. You can leave and return; answers are saved.",
      "質問は少数です。途中で離れても、回答は保存されます。",
    ),
  })

  TJ.screens.reading = () => ({
    stamp: TJ.stamp("wait", "Needs your approval", "承認待ち"),
    sheet: `
      <div class="paper">
        <h3>Reading brief <span lang="ja">読書の方針</span></h3>
        <dl class="slip">
          <dt>Your question <small lang="ja">元の問い</small></dt><dd>How do I read faster?</dd>
          <dt>Refined <small lang="ja">整えた問い</small></dt><dd>Which reading habits help me remember an argument after a month?</dd>
          <dt>Focus <small lang="ja">重点</small></dt><dd>Chapters 1 and 2</dd>
        </dl>
        ${TJ.p(
          "The refined question is a suggestion. Approve it, revise it, or leave it for later.",
          "整えた問いは提案です。承認・修正・保留のいずれかを選べます。",
        )}
        <div class="btn-row">
          ${TJ.btn("btn-primary", "Approve", "承認する", "approve")}
          ${TJ.btn("btn-quiet", "Revise", "修正する", "revise")}
          ${TJ.btn("btn-quiet", "Defer", "保留する", "defer")}
        </div>
      </div>`,
    note: note(
      "Nothing is final",
      "まだ確定ではありません",
      "Approving only moves the study to the outline. You can come back and change it.",
      "承認すると構成案の作成に進みます。あとから戻って変更もできます。",
    ),
  })
})()
