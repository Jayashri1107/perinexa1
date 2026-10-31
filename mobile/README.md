# Perinexa apps – Android (Play Store) and iPhone (App Store)

Made with **Capacitor** (31 Oct 2026). The app is a native shell that **opens https://app.perinexa.com**: the same
screens, sign-in, permissions and 30-minute sign-out as the website. A deploy of the website updates the apps at once;
a store update is needed only when the shell changes (name, icon, a phone feature such as notifications).

- **No patient data is kept on the phone.** Without internet the app shows its own "No internet connection" page
  (`www/index.html`).
- **Settings:** `capacitor.config.json` – app id `com.perinexa.app`, name `Perinexa`, the address it opens.
- **Its own packages** (`package.json` here): not part of the server's or the website's install or deploy.
- **Icons and splash screens:** made from the 128-pixel Perinexa mark. A 1024-pixel (or SVG) logo from the designer
  makes them sharper – replace the files under `android/app/src/main/res/mipmap-*` and
  `ios/App/App/Assets.xcassets`.

## Once, on a computer

```bash
cd mobile
npm ci
npx cap sync
```

`npx cap sync` again after changing `capacitor.config.json`, `www/` or the Capacitor packages.

## Android (this Windows laptop)

Needs **Android Studio** (it brings Java and the Android SDK).

**Try it on a phone:**
1. On the phone: Settings → About phone → tap **Build number** 7 times → Developer options → **USB debugging** on.
2. Connect the phone by USB. `npx cap open android` (opens Android Studio) → choose the phone → **Run**.
   Or install the test build: `android/app/build/outputs/apk/debug/app-debug.apk`.

**Build for the Play Store:**
1. Android Studio → **Build → Generate Signed App Bundle or APK → Android App Bundle**.
2. First time: **Create new** key store – keep the `.jks` file and its passwords **safe and out of git**, in a password
   manager with a backup. The same key is needed for every future update. (Or let Google keep the app signing key with
   Play App Signing and keep only the upload key.)
3. Choose **release** → the `.aab` file is in `android/app/release/`.
4. Every new version: raise `versionCode` (by 1) and `versionName` in `android/app/build.gradle`.

**Publish on Google Play:**
1. Google Play Console (https://play.google.com/console) – one-time **$25** registration, organisation account in the
   company's name.
2. **Create app** → name Perinexa, App, Free.
3. Fill in: app access (a **sample** test login for Google's reviewers – never a real one), ads (none), content rating,
   target audience (adults), **data safety** (what is collected: names, health information – sent to the server over
   HTTPS, not shared, not sold), **health apps declaration**, **privacy policy** address.
4. **Testing → Internal testing** first: upload the `.aab`, add testers' emails, install from the Play Store link.
5. Then **Production** → review (a few days for a new app).

## iPhone and iPad (needs a Mac)

Apple builds only on a Mac with **Xcode** (the current version from the Mac App Store).

1. Copy or clone the repository on the Mac. `cd mobile && npm ci && npx cap sync ios && npx cap open ios`.
2. Xcode → the **App** target → **Signing & Capabilities** → Team: the company's **Apple Developer** account
   (**$99 a year**, https://developer.apple.com – an organisation account needs a D-U-N-S number) → Bundle Identifier
   `com.perinexa.app`.
3. Try it: choose an iPhone (or a simulator) → **Run**.
4. For the App Store: **Product → Archive** → **Distribute App → App Store Connect → Upload**.
5. App Store Connect (https://appstoreconnect.apple.com): **TestFlight** for testers first; then the App Store listing
   – screenshots, description, privacy policy, **App Privacy** answers (health data, names), and **review notes with
   a sample test login**.
6. Every new version: raise **Version** and **Build** in Xcode → General.

**Apple's review:** Apple may refuse an app that is only a website in a shell (guideline 4.2). If that happens, the
usual answer is to add a phone feature – push notifications (e.g. a lab report is ready) or Face ID / fingerprint
sign-in – in this folder.

## Before real patients

Same rule as the website: sample data only until the owner's go-ahead and the go-live checklist
(`docs/HANDOVER.md`). Store listings must not show real patients in screenshots.
