# Shrine-library mockup contract

This standalone HTML/CSS/JavaScript proposal extends, not replaces, the root
Reading Studio design. It is inspired by 北野天満宮 and its connection to
scholarship, Sugawara no Michizane, plum blossoms, sacred oxen and 北野文庫.
Reference: https://ja.wikipedia.org/wiki/北野天満宮

## Materials and palette

Preserve existing Studio paper, green, coral, fonts and 4px spacing tokens.
Use the `--shrine-*` palette in `css/tokens.css` only for shrine details:
pale stone (#e4dfd1 / #b9b4a4), timber (#43301f / #2a1d12),
verdigris (#5f8071 / #3f5d50), plum (#b8456a / #fbf3ee),
banner vermilion (#bf3a28), gold (#d9b45b), gravel (#d3c4a0),
pine (#2d5546), and sky (#a9cdc6 / #f1e9d3).
Illustration-only shading may mix these tokens with white or black.

## Scene and primitives

An ema-shaped timber frame holds a layered shrine approach: stone torii,
paved path, lanterns, timber gate, red and white plum branches, reclining oxen.
The 560×680 SVG coordinate system is the artwork geometry, not UI spacing.
Its HTML door overlays x=212, y=308, width=136, height=150 and retains the
existing door-opening entrance transition. The plum crest is a simplified
mockup emblem, not official shrine artwork. Gate proportions are interpretive,
not an architectural reconstruction. No affiliation is implied.

Reuse the native input/button family, bilingual labels and existing ten-room
navigation unchanged. Add modest decorative ox/ema details in the hall.
Decorations are hidden from accessibility APIs and cannot intercept clicks.

## Responsive layout and motion

Wide screens pair artwork and the owner register. Narrow screens stack them,
with the gate owning vertical scrolling and no horizontal overflow. Artwork
scales by intrinsic width, not negative margin compensation. Short windows
can scroll the gate; no copy is hidden to make it fit.
Only the existing entry interaction animates transform/opacity. Plum blossom
placement is deterministic and static. Reduced motion removes transition
delays and duration. The hidden gate must not remain keyboard-focusable.

## Accepted prototype boundaries

This remains a local visual mockup with prefilled synthetic credentials and
no real authentication, uploads, provider calls or persisted reading changes.
Do not install React tools or alter the real app for this vanilla proposal.
Verify gate, hall, notes and all ten desks at desktop/tablet/phone widths,
plus entry/leave, deep links, keyboard focus and reduced motion.
