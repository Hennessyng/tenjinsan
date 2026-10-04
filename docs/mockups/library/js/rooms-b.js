// Desk screens for rooms 6-10 (same { stamp, sheet, note } contract as rooms-a.js).
;(() => {
  window.TJ = window.TJ || {}
  const TJ = window.TJ
  TJ.screens = TJ.screens || {}

  const note = (titleEn, titleJa, en, ja) =>
    `<h3>${titleEn} <span lang="ja">${titleJa}</span></h3>${TJ.p(en, ja)}`

  const card = (n, en, ja, text, meta) =>
    `<div class="index-card"><h4>${n}. ${en} <span lang="ja">${ja}</span></h4><p>${text}</p><p class="meta">${meta}</p></div>`

  TJ.screens.catalogue = () => ({
    stamp: TJ.stamp("wait", "Needs your review", "確認待ち"),
    sheet: `
      <div class="paper">
        <h3>Outline cards <span lang="ja">構成カード</span></h3>
        ${TJ.p(
          "Each card is one theme of the lesson. Reorder or drop a card before it is made.",
          "カード1枚が授業の1テーマです。作成前に並べ替えや削除ができます。",
        )}
        <div class="cards">
          ${card(1, "Ask first", "先に問う", "Why a question beats a summary.", "About 4 min / 約4分")}
          ${card(2, "Read with a purpose", "目的を持って読む", "Marking only what answers the question.", "About 6 min / 約6分")}
          ${card(3, "Keep a note", "メモを残す", "One sentence per section, in your words.", "About 3 min / 約3分")}
        </div>
        <div class="btn-row">
          ${TJ.btn("btn-primary", "Looks right", "この構成でよい", "approve")}
          ${TJ.btn("btn-quiet", "Move a card", "カードを動かす", "move")}
          ${TJ.btn("btn-quiet", "Drop a card", "カードを外す", "drop")}
        </div>
      </div>`,
    note: note(
      "Why cards",
      "なぜカード？",
      "Cards are easier to rearrange than a long document.",
      "長い文書よりカードのほうが並べ替えやすいためです。",
    ),
  })

  const JOBS = [
    [
      "Lesson: Ask first",
      "Running",
      "実行中",
      "now",
      "62%",
      "Writing section 2 of 3 / 3節中2節を作成中",
    ],
    [
      "Lesson: Read with a purpose",
      "Queued",
      "待機中",
      "wait",
      "0%",
      "Starts after the current job / 実行中のジョブの後に開始",
    ],
    [
      "Lesson: Keep a note",
      "Paused",
      "一時停止",
      "stale",
      "35%",
      "Paused by you / あなたが一時停止",
    ],
    ["Quiz draft", "Completed", "完了", "done", "100%", "Finished 14:02 / 14:02に完了"],
    [
      "Glossary",
      "Failed",
      "失敗",
      "warn",
      "48%",
      "Stopped: provider unavailable. Retry is safe. / 提供元が利用できず停止。再実行できます。",
    ],
    [
      "Summary page",
      "Cancelled",
      "取消済み",
      "stale",
      "10%",
      "Cancelled by you / あなたが取り消し",
    ],
  ]

  TJ.screens.bindery = () => ({
    stamp: TJ.stamp("now", "1 job running", "実行中 1件"),
    sheet: `
      <div class="paper">
        <h3>Job ledger <span lang="ja">ジョブ台帳</span></h3>
        <ul class="ledger">
          ${JOBS.map(
            ([t, en, ja, cls, p, msg]) =>
              `<li><span>${t}</span>${TJ.stamp(cls, en, ja)}<div class="meter" role="img" aria-label="${p} complete / ${p} 完了"><i style="--p:${p}"></i></div><p>${msg}</p></li>`,
          ).join("")}
        </ul>
        <div class="btn-row">
          ${TJ.btn("btn-quiet", "Pause the running job", "実行中を一時停止", "pause")}
          ${TJ.btn("btn-quiet", "Retry failed", "失敗を再実行", "retry")}
        </div>
      </div>`,
    note: note(
      "Safe to leave",
      "離れても大丈夫",
      "Jobs keep going when you close this page. Each state is written in words.",
      "このページを閉じてもジョブは続きます。状態は必ず文字で表示されます。",
    ),
  })

  TJ.screens.review = () => ({
    stamp: TJ.stamp("warn", "1 item to check", "確認 1件"),
    sheet: `
      <div class="paper">
        <h3>Evidence <span lang="ja">根拠</span></h3>
        <ol class="chapters">
          <li><span class="cite">The question is the map.</span> Matches source p. 4 ${TJ.stamp("done", "Verified", "確認済")}</li>
          <li>A reader who asks first remembers more. ${TJ.stamp("done", "Verified", "確認済")}</li>
          <li>Notes fade within a week. ${TJ.stamp("warn", "No source found", "出典なし")}</li>
        </ol>
      </div>
      <div class="paper">
        <h3>Privacy <span lang="ja">プライバシー</span></h3>
        <dl class="slip">
          <dt>Personal names <small lang="ja">個人名</small></dt><dd>None found</dd>
          <dt>Private notes <small lang="ja">非公開メモ</small></dt><dd>Excluded (chapter 3)</dd>
        </dl>
        <div class="btn-row">
          ${TJ.btn("btn-primary", "Mark checked", "確認済みにする", "approve")}
          ${TJ.btn("btn-quiet", "Remove the claim", "主張を外す", "drop")}
        </div>
      </div>`,
    note: note(
      "Nothing leaves unchecked",
      "未確認のままは出ません",
      "Every claim shows its source or says plainly that none was found.",
      "すべての主張に出典が示されます。見つからない場合は、その旨が明記されます。",
    ),
  })

  TJ.screens.ledger = () => ({
    stamp: TJ.stamp("stale", "2 versions", "2版"),
    sheet: `
      <div class="paper">
        <h3>Version history <span lang="ja">版の履歴</span></h3>
        <ol class="timeline">
          <li data-now="1"><b>Version 2</b> (current / 最新)<br />Added a worked example to section 2. Today 14:10.</li>
          <li><b>Version 1</b><br />First draft from the approved outline. Today 13:20.</li>
        </ol>
        <div class="btn-row">
          ${TJ.btn("btn-primary", "Compare 1 and 2", "1版と2版を比較", "compare")}
          ${TJ.btn("btn-quiet", "Restore version 1", "1版に戻す", "restore")}
        </div>
      </div>`,
    note: note(
      "Nothing is overwritten",
      "上書きしません",
      "Old versions stay on the ledger, so a change can always be undone.",
      "古い版は台帳に残るため、変更はいつでも元に戻せます。",
    ),
  })

  TJ.screens.display = () => ({
    stamp: TJ.stamp("wait", "Needs your approval", "承認待ち"),
    sheet: `
      <div class="paper">
        <h3>Publication <span lang="ja">公開</span></h3>
        ${TJ.p(
          "Choose what happens with this version. Nothing is shared until you publish.",
          "この版をどうするか選んでください。公開するまで、他の人には共有されません。",
        )}
        <div class="btn-row">
          ${TJ.btn("btn-primary", "Publish", "公開する", "publish")}
          ${TJ.btn("btn-quiet", "Revise", "修正する", "revise")}
          ${TJ.btn("btn-quiet", "Keep private", "非公開のままにする", "private")}
        </div>
      </div>
      <div class="paper">
        <h3>Files, version 2 <span lang="ja">ファイル（2版）</span></h3>
        <div class="case">
          <div class="volume"><b>Lesson (HTML)</b>Opens in any browser. 38 KB.<br /><span lang="ja">どのブラウザでも開けます。</span><br />${TJ.btn("btn-quiet", "Download", "保存する", "download")}</div>
          <div class="volume" data-kind="pdf"><b>Lesson (PDF)</b>For printing. 212 KB.<br /><span lang="ja">印刷用です。</span><br />${TJ.btn("btn-quiet", "Download", "保存する", "download")}</div>
        </div>
      </div>`,
    note: note(
      "Last stop",
      "最後の部屋",
      "Files are versioned. Downloading never changes the published copy.",
      "ファイルは版ごとに保存されます。保存しても公開中の内容は変わりません。",
    ),
  })
})()
