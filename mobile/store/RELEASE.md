# Releasing the Android app on Google Play (20 Nov 2026)

For the developer, at the Windows laptop with Android Studio. The listing text and form answers are in
`PLAY_STORE.md`; the graphics are in this folder.

## Files in this folder

| File | For |
|---|---|
| `play-store-icon-512.png` | Play Console → Store listing → App icon (512 × 512) |
| `feature-graphic-1024x500.png` | Play Console → Store listing → Feature graphic (1024 × 500) |
| `feature-graphic.html` | The graphic's source. To change it, edit and render again (below) |
| `screenshots/` | 2–8 phone screenshots, **sample patients only** – take them on a phone after deploying |

Render the feature graphic again after a change (Chrome already on the laptop; nothing to install):

```
cd C:\perinexa1\mobile\store
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --window-size=1024,500 --screenshot="$PWD\feature-graphic-1024x500.png" "file:///C:/perinexa1/mobile/store/feature-graphic.html"
```

## 1. The upload key – once, and keep it for ever

The upload key proves to Google that an update comes from us. With **Play App Signing** (the default for a new app)
Google keeps the real signing key; if the upload key is ever lost, Google can reset it – but that takes days, so keep it
safe.

1. Make a folder **outside the repository**, e.g. `C:\perinexa-keys\`. Never put the key in `C:\perinexa1`
   (`*.jks` is ignored by git, but keep it out anyway).
2. Android Studio → open `C:\perinexa1\mobile\android` → **Build → Generate Signed App Bundle or APK** →
   **Android App Bundle** → Next.
3. **Key store path → Create new…**
   - Key store path: `C:\perinexa-keys\perinexa-upload.jks`
   - Password: a long new password (a password manager can make one)
   - Alias: `upload`; key password: another long password (or the same one)
   - Validity: 25 years or more
   - Certificate: first and last name = the company's contact; organisation = Njeeva; city, state, country code = IN
   - OK
4. **Back up straight away:** the `.jks` file and both passwords in the company's password manager, and a copy of the
   `.jks` in a second safe place (not email, not WhatsApp, not GitHub).
5. Never type the passwords into a chat or a file in the repository.

## 2. Build the release file (.aab) – every release

1. Bring the laptop up to date and prepare the app folder:
   ```
   cd C:\perinexa1
   git checkout main
   git pull
   cd mobile
   npm ci
   npx cap sync android
   ```
   (`npx cap` here runs the Capacitor tool already listed in `mobile/package.json` – no download.)
2. **Every upload after the first:** raise `versionCode` by 1 in `mobile/android/app/build.gradle`, and set
   `versionName` (e.g. `"1.1"`). Commit that change. Google refuses a file whose versionCode it has seen before.
3. Android Studio → **Build → Generate Signed App Bundle or APK → Android App Bundle** → choose
   `C:\perinexa-keys\perinexa-upload.jks`, alias `upload`, the passwords → **release** → Create.
4. The file is `mobile\android\app\release\app-release.aab` (ignored by git – never commit it).

## 3. Upload

1. Play Console → the app → **Testing → Internal testing → Create new release**.
2. The first time: accept **Play App Signing**.
3. Upload `app-release.aab`, release name e.g. `1.0 (1)`, release notes: "First version."
4. Save → Review → **Start rollout to Internal testing**. Add testers' emails under **Testers**, send them the opt-in
   link, and install from the Play Store on a phone.
5. Then **Production** (or Closed testing first – see below) → create a release from the same build → send for review.

**A personal developer account made after 13 Nov 2023** must first run a **closed test with at least 12 testers for 14
days in a row** before Google lets it publish to Production. An organisation account does not have this rule.
Check which kind the account is: Play Console → Settings → Developer account → Account details.

## 4. After it is live

- A change to the screens needs only a deploy of the website – the app opens app.perinexa.com.
- A new store release is needed only when `mobile/` changes (icon, name, a phone feature): steps 2–3 again.
- Keep `PLAY_STORE.md`'s Data safety answers true whenever a feature that collects or sends data is added.
