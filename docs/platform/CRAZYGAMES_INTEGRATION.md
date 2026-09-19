# CrazyGames Integration Guide

This document is the internal source of truth for preparing a non-gambling game build for CrazyGames. It covers platform separation, SDK behavior, ads, saves, quality requirements, and submission assets.

Joy8 runtime integration is defined in `GAME_PLATFORM_INTEGRATION.md`. A shared game core must still keep the two platform clients isolated.

Version: 1.1.

Last external requirements review: 2026-09-20. Recheck the official CrazyGames documentation before every submission because platform requirements may change.

## Eligibility

This guide applies only to non-gambling games.

Do not create a CrazyGames Client, build, SDK integration, ad flow, or store submission for a product whose core loop includes betting, wagering, payouts, a redeemable-value wallet, casino mechanics, or equivalent gambling behavior.

Classification is based on actual gameplay and transaction mechanics, not only Joy8's `games.type`. Every product in `D:\Studio\Project-Gaming` is treated as gambling unless the user explicitly moves and reclassifies it.

## Non-Negotiable Separation

A CrazyGames build:

- Uses the CrazyGames SDK and CrazyGames-approved services only.
- Does not read a Joy8 launch code or Gateway token.
- Does not call the Joy8 Gateway.
- Does not initialize a Joy8 wallet.
- Does not perform Joy8 bet, payout, refund, or round operations.

A Joy8 build must not initialize the CrazyGames SDK or load CrazyGames ads.

## Shared Game Architecture

```text
Shared Game Core
  └─ Explicit Platform Client
       ├─ Joy8 Client
       ├─ CrazyGames Client
       └─ Local Client
```

The CrazyGames Client owns:

- SDK initialization and environment validation.
- Gameplay start and stop events.
- Data-module saves.
- Midgame, rewarded, and banner ads.
- Platform mute and chat settings.
- User, multiplayer, invitation, and purchase modules when applicable.

It does not own Joy8 identity, sessions, credentials, Gateway calls, wallet operations, or settlement.

The platform client must finish `init()` before the game calls platform features. Expose platform capabilities explicitly and disable unsupported features safely.

The Local Client is for development only. If a CrazyGames build cannot initialize its platform client, show a clear error or disable affected platform features; do not silently switch to the Local Client.

## Build and Release Strategy

Recommended:

- One Git repository and shared gameplay source.
- One game version.
- Explicit platform entry points or build settings.
- A separate CrazyGames upload artifact.
- A separate Joy8 deployment URL.

Do not force the two platforms to share one production URL. They may contain the same gameplay version while producing distinct platform configurations and artifacts.

Select the platform from build configuration. Runtime detection is a secondary validation only; iframe state, hostname, or query parameters alone are not reliable enough.

## Launch Stages

### Basic Launch

- The game enters limited platform testing.
- SDK integration is optional.
- If the SDK is present, send Gameplay start when the player actually reaches interactive gameplay.
- Ads and in-game purchases are disabled.
- Every game flow must remain playable with no ads.
- Platform performance metrics are evaluation signals, not guaranteed acceptance thresholds.

### Full Launch

- The game has passed Basic Launch and platform selection.
- CrazyGames SDK integration and full QA are required.
- Gameplay start and stop events must be accurate.
- Ongoing progress must use an allowed save design.
- Games with platform accounts use the User module.
- Ads and revenue sharing become available.
- In-game purchases are available only to invited games.

## Technical Limits

- Maximum total game size: 250 MB.
- Maximum file count: 1,500.
- Maximum initial download: 50 MB.
- Mobile-homepage initial-download target: 20 MB or less.
- Without SDK loading signals, the platform may treat the full package as the initial download.
- A game that loads external assets should generally become playable within 20 seconds.
- Package resources use relative paths.
- Chrome and Edge must work.
- Safari may be disabled if the game cannot support it.
- The game should run acceptably on a Chromebook or Chromium OS device with about 4 GB of RAM.
- No critical errors, crashes, dead ends, or unrecoverable flows.
- A sitelock must allow the domains required by CrazyGames.

## Display, Device, and Input

- Desktop gameplay must work in landscape.
- Portrait games may use side bars or a background on desktop.
- Mobile support requires touch controls.
- Desktop requires appropriate mouse or keyboard controls.
- Text, images, and controls must remain readable on mobile, in a 16:9 iframe, and at device-pixel ratio 1.
- Mobile orientation is controlled by submission settings; do not force rotation independently.
- Full-screen mobile UI must respect safe areas.
- Prevent long-press and double-click browser behaviors from disrupting play where appropriate.
- Recover iOS audio after interruption when the player interacts again.
- Do not add an in-game full-screen button; CrazyGames provides full-screen behavior.

## Content and Quality

- The title, art, and game content must be original or properly licensed.
- Content must fit PEGI 12; the platform mainly serves players aged 13 and older.
- The game must provide English localization. Additional translations must be accurate, use the SDK locale when available, and fall back to English.
- Text and art must be clear, with no broken, blurred, or visibly degraded presentation.
- Do not promote another game portal or include external advertising.
- Do not link directly to the App Store or Google Play.
- Privacy policies and terms may remain.
- Community, Discord, and developer-site links belong in a menu and must not be the primary call to action.
- Steam or Epic links apply only to desktop games and belong in the main menu or at the end of a demo.
- A new Full Launch player should reach gameplay immediately or with at most one click when the game design requires it.
- Prefer in-context and skippable tutorials over large instruction blocks.
- Controls, art direction, resolution, audio, and volume should feel consistent.
- Buttons must not use delay, deception, or ad-click inducement.

## SDK Initialization and Gameplay Events

For CrazyGames SDK v3:

```js
await window.CrazyGames.SDK.init()
```

Do not call SDK features before initialization completes. Then validate:

```js
window.CrazyGames.SDK.environment
```

Use SDK features only when the environment is `local` or `crazygames`. Disable the CrazyGames platform features when it is `disabled`.

Gameplay event rules:

- Send Gameplay start when the player reaches real, interactive gameplay.
- Do not send it for the main menu or an extra loading screen.
- Send Gameplay stop when gameplay pauses, a level ends, or the player enters a menu.
- Send Gameplay start again after resume, revival, or the next level.
- Do not send stop merely because browser focus changes; the platform handles focus.
- Load start and stop are optional events for additional loading stages.

Platform settings:

- `muteAudio = true` must mute the game.
- Platform mute overrides the player's internal audio preference.
- Listen for settings changes instead of reading settings only once.
- If `disableChat = true`, disable the game's chat feature.

## Advertising

Use only CrazyGames SDK ads. Do not integrate another ad network, Joy8 ads, or another platform's ads in this build.

### Basic Launch

- Ads are disabled.
- The complete game remains playable.
- Rewarded-ad controls must not become dead buttons.
- Level changes, revivals, and settlement must not depend on an available ad.

### Midgame Ads

- Use only at natural breaks such as death, level completion, or stage transition.
- Do not interrupt active input.
- Do not show an ad before the player has experienced reasonable gameplay.
- Do not trigger ads from ordinary navigation such as home, settings, or shop buttons.
- Pause the game and block input during the ad request and playback.
- Mute when playback actually begins.
- Restore the game after success, no-fill, or error.

### Rewarded Ads

- The player chooses to watch.
- State the reward before the request.
- Keep the decline option immediately visible.
- Prefer a non-ad alternative.
- Grant the reward only after a confirmed complete playback.
- Do not grant it after cancellation, failure, AdBlock, or no-fill.
- The game must remain usable when no reward is granted.
- Do not require several consecutive ads for one reward.
- Do not make rewarded ads the only way to continue.
- Do not combine a midgame ad and a rewarded-ad request at the same transition.

### Banner Ads

- Place banners only on content screens where players normally stay for about five seconds or more.
- Do not place banners over active gameplay.
- Do not cover interface controls.
- Separate ads visually from game content.
- Use at most two banners on one screen.
- Verify both desktop and mobile layout.

### AdBlock

- Basic gameplay must remain available.
- Do not deliberately degrade core game capability.
- An ad-funded optional feature may be unavailable, but explain it clearly.
- Remove or disable controls that cannot work.

## Saves, Accounts, and Player Data

The CrazyGames Client chooses the save design:

- When using the Data module, use it as the save source instead of also writing the same game save to `localStorage`.
- The platform manages local guest data and signed-in synchronization.
- The Data module limit is 1 MB.
- Load existing data before writing to avoid overwriting progress.
- Enable the correct Progress Save or Data Module submission option.
- A custom backend must integrate the CrazyGames User module.
- Use Automatic Progress Save only when the game meets platform conditions; do not use it with in-game purchases.

Account rules:

- Guests can play without forced login.
- Basic Launch does not offer Facebook, Google, email, or another external login.
- At Full Launch, a player already signed into CrazyGames should be signed into or mapped to the game account automatically.
- Use CrazyGames `userId` as the stable identifier, not the changeable username.
- Switch progress correctly when the CrazyGames account changes.
- A login button must not block the game or open a login dialog automatically.

If the game collects personal data beyond the SDK's standard events, provide the required privacy policy or terms.

## Multiplayer, Chat, and Purchases

When multiplayer applies:

- Report room identity, joinability, and room state to the SDK.
- Use Invite Link or Instant Multiplayer when supporting friend invitations.
- Keep the player group together for another match after a round.
- Use CrazyGames player names and avatars where required.
- Honor `disableChat`.
- Filter or moderate chat and user-generated content.

In-game purchases apply only to invited games:

- Do not enable purchases during Basic Launch.
- At invited Full Launch, use the CrazyGames-designated Xsolla flow.
- Only signed-in players may purchase.
- Bind orders to the CrazyGames user.
- Disable sandbox and test orders before production submission.
- Hide or disable payment flows unsupported by the CrazyGames App.

## Submission Media

Game covers:

- Landscape: 1920 x 1080, 16:9.
- Portrait: 800 x 1200, 2:3.
- Square: 800 x 800, 1:1.
- Keep one coherent visual style across all three.
- Do not add borders.
- Only the game title may appear as cover text.
- Do not use blurred, unauthorized, or misleading content.
- Do not add Play Now, New, Updated, app-store, or social icons.

Preview videos:

- 15 to 20 seconds; longer footage may be trimmed.
- Maximum 50 MB.
- Supply 16:9 landscape and 2:3 portrait versions.
- No audio.
- No black frames, logo transitions, letterboxing, or default mouse cursor.
- No Play Now, app-store, or social icons.
- Do not artificially speed up footage.

Submission data:

- A working web build.
- English title, description, and controls.
- Platform metadata.
- Three covers.
- Landscape and portrait preview videos.

## Pre-Submission Checklist

- [ ] The game is confirmed non-gambling.
- [ ] The CrazyGames platform target is explicit.
- [ ] The build contains no Joy8 Gateway or wallet call.
- [ ] Total size is at most 250 MB and file count at most 1,500.
- [ ] Initial download is at most 50 MB; mobile-homepage target is at most 20 MB.
- [ ] Chrome, Edge, mobile, and a 4 GB Chromebook-class device pass.
- [ ] Orientation, touch, mouse, keyboard, and safe areas work.
- [ ] There is no custom full-screen button, external ad, or prohibited link.
- [ ] English text, tutorial, and control instructions are complete.
- [ ] No platform feature runs before SDK initialization.
- [ ] Gameplay start and stop events are accurate.
- [ ] Basic Launch remains complete without ads.
- [ ] Midgame, rewarded, and banner placements follow the rules.
- [ ] Ads pause input and audio and restore the game after every outcome.
- [ ] Rewarded content is granted only after confirmed completion.
- [ ] Save and account behavior follows the selected CrazyGames modules.
- [ ] Platform mute and settings changes are handled.
- [ ] PEGI 12, originality, external-link, privacy, and moderation checks pass.
- [ ] Three covers and two preview videos are complete.
- [ ] CrazyGames Preview and QA tools pass.
- [ ] The official requirements have been rechecked for the current submission date.

## Official Sources

- [Requirements Introduction](https://docs.crazygames.com/requirements/intro/)
- [Technical Requirements](https://docs.crazygames.com/requirements/technical/)
- [Gameplay Requirements](https://docs.crazygames.com/requirements/gameplay/)
- [Advertisement Requirements](https://docs.crazygames.com/requirements/ads/)
- [Account Integration](https://docs.crazygames.com/requirements/account-integration/)
- [Multiplayer Requirements](https://docs.crazygames.com/requirements/multiplayer/)
- [Game Covers](https://docs.crazygames.com/requirements/game-covers/)
- [Quality Guidelines](https://docs.crazygames.com/requirements/quality/)
- [SDK Introduction](https://docs.crazygames.com/sdk/intro/)
- [Game Module](https://docs.crazygames.com/sdk/game/)
- [Video Ads](https://docs.crazygames.com/sdk/video-ads/)
- [Data Module](https://docs.crazygames.com/sdk/data/)
- [In-Game Purchases](https://docs.crazygames.com/sdk/in-game-purchases/)
