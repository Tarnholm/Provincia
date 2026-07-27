# RIS wiki: Git LFS vs GitHub Pages — decision brief

**For:** the owner of `rtr-imperium-surrectum` (self-hosted GitLab, `rtris.org`).
**Status:** investigation only. Nothing in `C:/RIS` was modified.
**Snapshot:** `C:/RIS` branch `alternate_map`, HEAD `f5b411f18` (2026-07-27 20:36 +0200), measured 2026-07-27 20:52.

## Headline

The problem is **real in mechanism but hypothetical in practice**: there is no GitHub remote, no
Pages site, and no Pages config anywhere. And the mod repo could never be a Pages source anyway —
it is **81.24 GiB** with ten files over GitHub's hard 100 MiB push limit. So changing the repo's LFS
configuration buys nothing. If a public wiki is wanted, publish the wiki as its **own small repo**
(149.81 MiB) without LFS.

Two premise corrections up front: it is **2,827** wiki PNGs, not ~10,244; and the weight is
**117.57 MiB** total, not ~104 MB. The "104 MB" figure matches the `cards/` folder alone measured in
decimal MB (102.7 MB).

## 1. The LFS tracking — confirmed

`C:/RIS/.gitattributes` (repo root, single file — no other `.gitattributes` exists in the repo)
contains one blanket, repo-wide pattern that catches every wiki image:

```
*.png filter=lfs diff=lfs merge=lfs -text
```

It sits in an `# Images` block alongside `*.tga`, `*.psd`, `*.dds`, `*.jpg` and others. There is no
path scoping, so `RIS/wiki/**` is caught by the same rule as the mod's own art.

Verified with `git check-attr` on one file per folder:

```
$ git check-attr filter diff merge -- RIS/wiki/cards/achaian_epilektoi.png
RIS/wiki/cards/achaian_epilektoi.png: filter: lfs
RIS/wiki/cards/achaian_epilektoi.png: diff: lfs
RIS/wiki/cards/achaian_epilektoi.png: merge: lfs
$ git check-attr filter -- RIS/wiki/icons/anatolian__region_base.png   → filter: lfs
$ git check-attr filter -- RIS/wiki/maps/acarnania.png                 → filter: lfs
```

And the committed blob really is a pointer, not an image:

```
$ git cat-file -p HEAD:RIS/wiki/cards/achaian_epilektoi.png
version https://git-lfs.github.com/spec/v1
oid sha256:3a61cfd174bf8af414849eef9b083b119e4f1dc313afd68db4426c3995cab9e0
size 56927
```

That blob is **130 bytes** in git; the real file is **56,927 bytes**. A static host that does not
speak LFS serves those 130 bytes as the image.

## 2. Measured weight

Taken from the `size` field of the committed LFS pointers at HEAD, so it is exact and reproducible
without depending on the working tree:

| Folder | Files | Size | Avg/image | Share |
|---|---:|---:|---:|---:|
| `cards/` | 2,263 | 97.98 MiB | 44.3 KiB | 83.3% |
| `maps/` | 215 | 12.12 MiB | 57.7 KiB | 10.3% |
| `icons/` | 307 | 7.24 MiB | 24.1 KiB | 6.2% |
| `resource-icons/` | 42 | 0.23 MiB | 5.6 KiB | 0.2% |
| **PNG total** | **2,827** | **117.57 MiB** (123.3 MB dec) | 42.6 KiB | |
| `.md` pages | 2,804 | 31.78 MiB | | |
| other (3 `.html`, `.js`, `.json`, `.sh`, `.bat`) | 7 | 0.46 MiB | | |
| **Whole wiki at HEAD** | **5,638** | **149.81 MiB** (157.1 MB dec) | | |

**Caveat — this is a moving target.** At snapshot time `git status RIS/wiki` showed **2,009
uncommitted changes**, and the working tree already held 3,163 PNGs including a new `art/` folder
(226 files) that did not exist 20 minutes earlier. Expect these numbers to drift upward.

For scale: the whole working tree excluding `.git` is **92,982 files / 81.24 GiB**. The wiki PNGs are
**0.14%** of the repo. The local `.git/lfs` object store is 65,473 files / 104.37 GiB.

## 3. Is GitHub Pages actually in use? No — and not configured anywhere

Checked in `C:/RIS`:

- Sole remote: `origin → https://rtris.org/rtr/rtr-imperium-surrectum.git`. **No GitHub remote.**
- No `.github/`, no workflows, no `CNAME`, no root `docs/`.
- No `gh-pages` branch. Branches are: `alternate_map`, `Roman_name_change`,
  `Woppers_Horde_Playground`, `bug_fixes`, `development`, `master`, `roman_civil_war`,
  `september_1158`.
- The only `github` string in config is a **global** credential username
  (`credential.https://github.com.username=Tarnholm`) — not repo-local, unrelated to this repo.
- No GitHub mirror exists: `api.github.com/repos/Tarnholm/rtr-imperium-surrectum` → **404**. A
  GitHub search for `rtr-imperium-surrectum` returns one unrelated repo (`LeoVen/rtris`, a Rust
  Tetris clone).

Checked in `C:/dev/Provincia`:

- Has a GitHub remote (`github.com/Tarnholm/Provincia`, public) and three workflows —
  `build-mac.yml`, `ci.yml`, `ship-guard.yml`. **None** references `pages` or `lfs`.
- GitHub API reports `"has_pages": false`; `https://tarnholm.github.io/Provincia/` → **404**.
- No `.gitattributes` at all, so no LFS here.
- Contains only the wiki *generators* (`scripts/gen-ris-wiki.js`, `gen-ris-wiki-html.js`,
  `serve-ris-wiki.js`, `verify-ris-wiki.js`) — **not** the wiki content.

The only in-repo trace of the requirement is prose in `RIS/wiki/README.md`:

- line 43: *"For anything you want to sort or search rather than read, these work on GitHub Pages with no server"*
- line 27: *"GitHub renders these pages if you browse the repository."*

Both are aspirational rather than configured, and both are inaccurate today because the repo is not
on GitHub at all. **Not determined:** whether the owner intends to publish to Pages. What would
settle it: the owner saying so, or a GitHub remote / Pages config appearing.

## 4. The constraint, verified from GitHub's own documentation

From *About Git Large File Storage* — a note under the "Pointer file format" heading, quoted verbatim:

> - Git LFS cannot be used with GitHub Pages sites.
> - Git LFS cannot be used with template repositories.

Source: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage

So the premise is correct: LFS-tracked images on a Pages site do not resolve. Note GitHub states the
limitation flatly and does **not** explain the failure mode, so "it serves the pointer text" is the
expected behaviour rather than a documented guarantee.

Three further limits matter more than the LFS one, same docs set:

> Published GitHub Pages sites may be no larger than 1 GB.
> GitHub Pages source repositories have a recommended limit of 1 GB.
> GitHub Pages sites have a *soft* bandwidth limit of 100 GB per month.
> GitHub Pages sites have a *soft* limit of 10 builds per hour. This limit does not apply if you build and publish your site with a custom GitHub Actions workflow.

Source: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits

> GitHub blocks files larger than 100 MiB.
> If you attempt to add or update a file that is larger than 50 MiB, you will receive a warning from Git.
> We recommend repositories remain small, ideally less than 1 GB, and less than 5 GB is strongly recommended.

Source: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github

**This is the decisive finding.** The RIS repo is 81.24 GiB and contains **ten files over the 100 MiB
hard block**, including `RIS/data/sounds/music.dat.feral` (1,744 MB) and six map PSD/TGA sources of
151–308 MB. Against a 1 GB recommendation and a 1 GB published-site ceiling, this repo can never be a
GitHub Pages source — with or without LFS. "Make the wiki work on Pages" can therefore only mean
publishing the wiki *separately*; it cannot mean reconfiguring the mod repo.

## 5. Options

| | What it does | What breaks | Cost | Reversible? |
|---|---|---|---|---|
| **(a) Leave as is** | Wiki PNGs stay LFS-tracked | Nothing today. Images resolve on GitLab and in `view-wiki.bat`. Would break *if* ever served from Pages — which is impossible for this repo anyway (§4) | Zero | n/a |
| **(b) Scoped un-LFS rule in the mod repo** | Add `RIS/wiki/**/*.png -filter -diff -merge text=auto` and re-add the files | Nothing functionally; images become ordinary blobs | ~117.57 MiB into the pack permanently, growing with every regeneration. Does **not** make the repo Pages-viable (§4), so it buys nothing | **No** — only by rewriting history |
| **(c) Materialise LFS at deploy** | Actions workflow: `actions/checkout` with `lfs: true` → `upload-pages-artifact` → `deploy-pages` | — | Requires two things that are false today: the wiki must live in a GitHub repo, and its LFS objects must sit on GitHub's LFS server (they are on `rtris.org`), consuming GitHub LFS quota | Yes — delete the workflow |
| **(d) Reduce image weight** | Recompress / re-quantise cards | Quantisation is lossy (see below); further downscale degrades visibly | Generator change + full regeneration | Yes — regenerate |
| **(e) Separate wiki repo** ★ | Publish the generated wiki to its own GitHub repo, plain git, no LFS, Pages from a branch | Nothing in the mod repo | 149.81 MiB in a new repo = **15% of the 1 GB Pages limit**. Mod repo untouched | Yes — delete the repo |

### Notes on (b)

The premise's concern that "existing LFS-committed blobs stay in history regardless" is **much weaker
than it sounds**, and worth correcting: what is in git history today for these images is *pointers
only* — 130 bytes each, so roughly **0.35 MiB** across all 2,827 files (uncompressed; the real bytes
live in the LFS store, not in the pack). Un-tracking would therefore add ~117.57 MiB **once**, going
forward, and a history rewrite is *not* required to keep clone size sane. The 28 existing wiki commits
would keep referring to LFS objects, which a plain clone fetches only for the checked-out ref.

*Estimate, not measured:* pack growth should be close to 1:1 with the 117.57 MiB, because PNG is
already deflate-compressed and delta compression across unrelated images gains ~nothing. I did not
verify this by writing objects, deliberately — that would have modified the repo.

### Notes on (c) — confidence

The mechanism is *plausible and documented in its parts*, but **I did not test it**. In favour:
Pages' Actions publishing path is documented to "upload the static files as an artifact" via
`actions/upload-pages-artifact` and then deploy with `actions/deploy-pages`, and `actions/checkout`
has a documented `lfs` input — *"Whether to download Git-LFS files"*, default `false`. Since Pages
then serves artifact bytes rather than the git tree, real images should be published.

Against: GitHub's own note says flatly *"Git LFS cannot be used with GitHub Pages sites"* without
carving out the Actions route, so **I cannot claim from the documentation that this is sanctioned**.
Treat (c) as untested and moderately confident at best. It is also moot unless the content is on
GitHub in the first place.

### Notes on (d) — measured, on a random sample

The cards are **already downscaled 2×** by the generator: the source
`RIS/data/ui/units/achaea/#achaian_epilektoi.tga` is 328×448 RGBA; the published card is 164×224. And
the markdown embeds it at `width="164"` — i.e. **displayed at native size, no headroom**. Card
dimensions overall: 164×224 (1,597), 82×112 (532), 160×210 (67), 96×128 (51), 80×105 (13), 328×448 (3).

Re-encode test, 200 randomly sampled cards:

| Approach | Per image | Change | `cards/` would become | Lossless? |
|---|---:|---:|---:|---|
| as-is | 42.04 KiB | — | 97.98 MiB | — |
| PNG `optimize=True` | 37.70 KiB | **−10.3%** | ~87.9 MiB (saves ~10 MiB) | **Yes** |
| 256-colour quantise | 9.50 KiB | **−77.4%** | ~22.1 MiB (saves ~76 MiB) | **No** |
| 2× downscale | 11.72 KiB | −72.1% | ~27.3 MiB | No — below display size |

Quantisation is the only large lever, and it **is lossy**: the cards hold 3,264–18,190 unique RGBA
colours (median 11,128), and **0 of 120** sampled cards were already within 256 colours. Measured
error after quantising: mean absolute per-channel deviation **2.78/255**, max 5.36 — small, but
expect mild banding on smooth gradients. Eyeball a dozen cards before adopting it.

`maps/` are 1020×700 24-bit RGB holding only **6 unique colours**. An exact 8-colour palette
conversion is **pixel-identical (verified)** but saves just 3.3% (12.12 → 11.72 MiB) — not worth the
churn. PIL's optimiser actually makes maps *worse* (+20.4%).

*Estimate, not measured:* a real optimiser (`oxipng -o4`, `zopflipng`) would likely beat the 10.3%
lossless figure. None is installed on this machine, so that is unverified.

## 6. Recommendation

**Do nothing to `C:/RIS/.gitattributes`. Choose (a) now, and (e) if and when a public wiki is
actually wanted.**

Reasoning:

1. **The stated problem cannot be solved where it is posed.** An 81.24 GiB repo with ten
   over-100-MiB files is not a candidate GitHub Pages source under any configuration. Option (b) pays
   117.57 MiB of permanent, irreversible pack weight for a capability the repo still would not have.
2. **Nothing is broken today.** Images resolve on the self-hosted GitLab and in the local viewer.
   Pages is not configured anywhere, in either repo. The requirement traces to two sentences of
   README prose.
3. **(e) is strictly better than (b).** The wiki is already a generated artifact — `gen-ris-wiki.js`
   in Provincia rebuilds it from source. Emitting it into a dedicated repo with no `.gitattributes`
   gives real PNGs on Pages, at 149.81 MiB against a 1 GB ceiling, with the mod repo untouched and
   the whole thing reversible by deleting the repo. It also sidesteps (c) entirely: no LFS, so
   nothing to materialise at deploy.
4. **Do not bother with (d) yet.** At 15% of the Pages limit there is no pressure. If the wiki grows
   several-fold, take the lossless ~10% first and only consider quantisation after a visual check.

Small, independent cleanup worth doing regardless: `RIS/wiki/README.md` lines 27 and 43 tell readers
that GitHub renders these pages and that the tables work on GitHub Pages. Neither is true while the
repo lives only on `rtris.org`. Either correct the wording or make it conditional.

## What I am unsure about

- **Whether Pages is wanted at all.** The entire requirement rests on two README sentences. Only the
  owner can confirm.
- **Whether option (c) works.** Untested, and GitHub's blanket note gives no explicit exemption for
  the Actions-artifact route.
- **Pack growth for (b)** is an estimate (~1:1); I did not write objects into the repo to confirm.
- **Whether `oxipng`/`zopflipng` beat the measured 10.3%** lossless saving — no optimiser installed.
- **All sizes drift upward.** 2,009 uncommitted wiki changes and a new `art/` folder appeared during
  this investigation; re-measure before acting on a specific number.
- **GitLab Pages is not evaluated.** The repo already lives on self-hosted GitLab, and a CI job doing
  `git lfs pull` before publishing would be the natural home for this wiki. Whether Pages is enabled
  on `rtris.org` is **not determined** — it needs authenticated access to that instance to check.
