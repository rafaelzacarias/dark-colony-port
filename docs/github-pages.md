# GitHub Pages

## Configured Two-Repository Deployment

The playable site is configured at
`https://rafaelzacarias.github.io/darkcolony-assets/`.
The private `rafaelzacarias/darkcolony-assets` repository owns the deployment
workflow and the generated `assets/generated/` tree. Its workflow checks out
this public game repository at a pinned commit, copies the assets into
`public/assets/generated/`, runs `npm ci`, validates assets and URL handling,
and builds/uploads the complete site.

Set **Settings > Pages > Source: GitHub Actions** in `darkcolony-assets`.
No additional token is required: that workflow can read its own private
repository and check out the public game source. The resulting Pages site
and deployed assets are public even though the asset repository is private.

To release a source update, advance the game source `ref` in the assets
repository's `.github/workflows/pages.yml` and its README together. Update
the generated assets if needed, then push to `main` or run **Deploy Dark Colony**
manually. Keep this project's package lock synchronized with `package.json`;
deployment installs through `npm ci`, not existing local dependencies.

The instructions below describe the alternative public-bundle deployment
owned by this source repository. Its `PAGES_ASSET_URL` and
`PAGES_ASSET_SHA256` variables are not needed for the two-repository setup.

## What You Need

- A GitHub repository with Pages available for your account/repository type.
- GitHub Actions enabled, and **Settings > Pages > Build and deployment >
  Source: GitHub Actions** selected.
- Permission to publicly distribute the original game assets. Owning a disc
  alone does not establish redistribution permission. Pages serves these files
  publicly, including when the source repository is private unless you have a
  separately configured access-controlled enterprise site.
- The generated web assets. Raw CD files, ISO/MDF files, dependencies and build
  output stay outside Git. The code-only repository cannot play without assets.

The remake is a static Vite application. HTTPS, audio, canvas and IndexedDB work
on Pages. Saves are browser-local and tied to the origin; they do not sync
between devices or automatically transfer from localhost to GitHub Pages.
Audio starts muted. The deployment does not imply that all campaign missions
have completed verification.

## Prepare Assets

From this workspace, after extracting your authorized disc data:

```sh
npm ci
npm run pages:check
npm run pages:assets
```

The packager creates ignored `pages-assets.tar.gz` and
`pages-assets.tar.gz.sha256` files in the repository root. The archive contains
only `assets/generated/`, including real copies of the current indexed assets.
The extractor's redundant `.indexed-generations` cache is excluded; other
symlinks are rejected. No media is uploaded by these commands.

The currently validated generated tree is approximately 461 MiB. Packaging
needs temporary disk space for a copy of that tree plus the compressed archive.
GitHub Pages has a 1 GB published-site limit and bandwidth limits; large media
may make a separate CDN preferable as traffic grows.

If redistribution is authorized, upload the archive as a GitHub Release asset
or host it at a stable HTTPS download URL. Do not commit this archive, the raw
disc, or the generated tree into Git. For example, after creating a release
tag named `web-assets`, its public download URL can be:

```text
https://github.com/OWNER/REPOSITORY/releases/download/web-assets/pages-assets.tar.gz
```

A public HTTPS URL is required by the supplied workflow. Private release URLs
need a separately designed authenticated download step; the current workflow
does not send credentials to arbitrary URLs.

## Configure And Deploy

1. Add your GitHub repository as `origin` and push the local branch:

   ```sh
   git remote add origin https://github.com/OWNER/REPOSITORY.git
   git push -u origin master
   ```

   Use your actual branch name if different. The workflow handles `main` and
   `master`; no branch rename is required.
2. Enable the GitHub Actions Pages source described above.
3. Under **Settings > Secrets and variables > Actions > Variables**, add:
   - `PAGES_ASSET_URL`: the authorized archive's HTTPS download URL.
   - `PAGES_ASSET_SHA256`: its 64-character hash, without the filename.
4. Open **Actions > Deploy GitHub Pages > Run workflow**. Subsequent pushes to
   `main` or `master` redeploy automatically. Without both variables, deployment
   jobs are skipped, preventing publication of an asset-less build.
5. The deployment job reports the site URL, normally
   `https://OWNER.github.io/REPOSITORY/`.

[The workflow](../.github/workflows/pages.yml) downloads and verifies the
archive, rejects unsafe paths/links and oversized archives, checks required
assets, runs URL tests, typechecks/builds, and uploads the static site through
the official Pages actions. It uses the base path returned by Configure Pages,
supporting repository URLs and root/custom-domain hosting. Do not move it to a
branch-based Jekyll deployment; the build output is supplied directly as an
artifact.

When updating generated assets, upload a versioned archive and update both
variables together. The workflow intentionally rejects a checksum mismatch.

## Local Production Check

```sh
PAGES_BASE_PATH=/darkcolony/ npm run build
PAGES_BASE_PATH=/darkcolony/ npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
```

Open `http://127.0.0.1:4174/darkcolony/`. Choose any unused port if4174 is busy.
Replace `/darkcolony/` with your intended repository path. Local development
still uses `npm run dev` at `/`; no global fetch override is used. Vite rewrites
CSS asset references, while runtime requests, images, cursors and audio use
[the asset URL helper](../src/asset-url.ts).

The complete historical QA suite includes tests needing the original raw disc
and optional native-analysis tools, so Pages CI does not run that whole suite.
The Pages build performs TypeScript checks and the focused URL test. Campaign
verification remains a separate requirement.

## Local Commit

This setup does not create a remote repository, upload game media, enable your
account's Pages settings, or push commits automatically. If no Git author was
configured when the deployment commit was created, it uses the explicitly
local automation identity `Dark Colony Deployment <deployment@localhost>`.
Set your preferred repository-local author before subsequent commits:

```sh
git config user.name "Your Name"
git config user.email "YOUR-GITHUB-NOREPLY-EMAIL"
```