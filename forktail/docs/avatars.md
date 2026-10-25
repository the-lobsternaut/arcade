# Avatars and dialog

Everything a character is made of — the picture, the clip if there is one, and every line anyone
speaks — lives in **`assets/pack.bin`**. Not as a build step: that file *is* where these are kept,
on disk as well as in the game. There are no loose avatar files between edits.

## Why one file

The game fetches the pack once and slices it into blobs. Before, every portrait was its own
request on its own cache rules, which is how adding art could change nothing until a hard reload.
One file with one version stamp cannot drift.

## Adding or replacing an avatar

```
python3 tools/addportrait.py <character-id> <image-or-video> [face]
```

It unpacks, crops to the 1024 × 1536 frame the engine draws in (never squashes — too wide loses
slivers off both sides, too tall loses the bottom, because the head has to stay), writes the entry,
and packs again. Character ids come from the roster; a typo is rejected rather than silently
creating a character nobody references.

Hand it a **video** and the portrait animates. Audio is stripped — the game has its own, and it
refuses to ship a clip whose audio survived the encode. The clip runs while that character has a
line to deliver and parks on its first frame when they do not, so **author it with the mouth shut
on frame one** or it settles mid-syllable. Screens where someone is simply present rather than
mid-sentence (the hangar, a callout, a briefing card) let it run continuously instead.

The optional `face` is how far down the picture the eyes sit, 0 to 1. Leave it off unless the
head crop used by in-mission callouts misses: the default assumes a figure standing square with
their eyes in the upper fifth, and a turned or reclining pose sits lower than that.

## Editing dialog

```
python3 tools/packassets.py unpack      # writes assets/dialog.json and assets/portraits/
# edit assets/dialog.json
python3 tools/packassets.py pack        # rebuilds pack.bin and removes the loose copies
```

`dialog.json` holds the controller, the briefing roster, copilots, wingmen and the campaign
levels. `js/story.js` is logic only now; it reads these at boot.

Lines are dealt from a shuffled deck rather than drawn at random, reshuffled only when the deck
runs out, and a fresh deck never opens on the line the old one closed with — so a long list
genuinely does not repeat.

## No art, no character

A character with no entry in the pack does not appear and does not speak. Not a badge, not a
stand-in, nothing: the card is never built. Drawing an approximation of someone who has no art
looked worse than admitting it, and the monogram badge that replaced the generator was worse
again - a card with three initials in it is a character you have never seen pretending to be one
you have, which is how the ferry pilots, the copilots and the wingmen all ended up briefing you
from behind a disc.

Where that line still has to be delivered, Halo delivers it, because she has a face and she has
the radio: she reads out a copilot's file, names the wingman who went down, and keeps the only
voice in the air. None of it is hard-coded to her - every surface asks whether the speaker has a
portrait and takes the other path if not - so a character starts talking for herself the moment
her art lands in the pack, including the allied liaisons in boss briefings, who are picked from
whoever has been painted.

## Inspecting

```
python3 tools/packassets.py list
```
