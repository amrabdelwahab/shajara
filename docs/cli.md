# Shajara from the terminal, with Claude

`tools/shajara` reads and edits a Shajara space through the same API as the app, with the space's passcode.
It only needs Python 3. It comes with a Claude Code skill, so you can just ask Claude
("show me our Klunkerkranich set", "in Yemeni, put Roudi on drums from the Groove on").

## Install (once)

```sh
curl -fsSL https://amrabdelwahab.github.io/shajara/tools/install.sh | sh
```

It installs `shajara` into `~/.local/bin`, adds the Claude Code skill, and asks for your space's passcode
and your name. From a checkout of this repo, `make install-cli` does the same.
The passcode is saved in `~/.config/shajara/config.json`, readable only by you.

## Reading

```sh
shajara whoami
shajara sets
shajara set show "Klunker"          # every track, section, line-up, cue, beat and task
shajara track show "Yemeni"
shajara people                      # members, instruments, sounds
shajara guide                       # how the tree model works
```

## Changing

Sections are named `Track:Section` or `Track:<number>`; names can be partial.

```sh
shajara section edit "Yemeni:Intro" --energy 1 --notes "Low dynamics"
shajara section add "Yemeni" "Outro" --at 8
shajara section move "Yemeni:Outro" 3
shajara lineup put "Yemeni:Groove" roudi rhythm --on Drums --part "The groove"
shajara lineup drop "Yemeni:Groove" roudi
shajara cue set "Yemeni:Barra" amr "after one round of the groove, barra barra"
shajara beat presets
shajara beat set "Last judgement:2" "Rock ballad"
shajara task add "Klunker" "Add voices to the strings sound" --for Sherif
shajara task done "Klunker" voices
shajara set move "Klunker" "Precussion" 10
```

Layers: `bloom`/`melody`, `bark`/`harmony`, `ground`/`bass`, `substrate`/`rhythm`.
Deleting a section or a set's track, or emptying a line-up, asks for `--yes`.
Add `--json` to any read for raw data. `shajara <command> --help` lists every option.
