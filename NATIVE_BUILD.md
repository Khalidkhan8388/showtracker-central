# Braintape — Native App (iOS + Android)

Braintape is wrapped with **Capacitor**, so the same web app you're using now
can be built as a real iOS and Android app that installs from Xcode / Android
Studio and (eventually) the App Store & Play Store. It already works fully
offline (IndexedDB + service worker cache).

## One-time setup

You need a real Mac (for iOS) or any machine (for Android) with:
- **Node 20+** and **npm** or **bun**
- **Xcode 15+** (iOS) — Mac only
- **Android Studio** with Android SDK (Android)
- CocoaPods (`sudo gem install cocoapods`) for iOS

Then, from the project root on your machine:

```bash
# 1. Get the code (use Lovable's GitHub export or clone)
git clone <your-repo> braintape && cd braintape

# 2. Install
npm install

# 3. Add the native projects (one time)
npx cap add ios
npx cap add android
```

## Build & run

Every time you change the app:

```bash
# 1. Build the web app
npm run build

# 2. Copy the built web assets into the native projects
npx cap sync

# 3a. Open iOS in Xcode → press Run
npx cap open ios

# 3b. Open Android in Android Studio → press Run
npx cap open android
```

## App identity

- App ID: `app.braintape.mobile`
- App name: `Braintape`
- Change these in `capacitor.config.ts` before you first `cap add` if you want
  a different bundle identifier.

## Offline

Braintape stores all your notes, images, and voice memos locally in
IndexedDB. The included service worker (`public/sw.js`) also caches the app
shell using stale-while-revalidate, so cold launches are fast and the app
opens even with no network. TMDB posters and web-link previews still need
internet the first time they're fetched.

## Publishing to the stores

- iOS: in Xcode, Product → Archive → Distribute App → App Store Connect
- Android: in Android Studio, Build → Generate Signed Bundle / APK → AAB

You'll need an Apple Developer account ($99/yr) and a Google Play Console
account ($25 one-time).
