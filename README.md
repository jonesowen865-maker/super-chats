# SuperChat

Live superchat alerts for streamers — website + Windows desktop app.

## Project Structure

```
super-chats/
├── server/          # Express + SQLite backend + website
├── desktop/         # Electron Windows app
└── render.yaml      # Render.com deployment config
```

---

## Website (server/)

### Local Dev

```bash
cd server
npm install
npm start
# Visit http://localhost:3000
```

### Deploy to Render.com

1. Push this repo to GitHub
2. Go to https://render.com → New Web Service
3. Connect your repo
4. Render auto-detects `render.yaml` and sets up everything
5. Your site will be live at `https://superchat.onrender.com`

---

## Desktop App (desktop/)

### Prerequisites

- Node.js 18+
- Windows 10/11

### Run in Dev

```bash
cd desktop
npm install
npm start
```

### Build SuperChatSetup.exe

```bash
cd desktop
npm install
npm run build
# Output: desktop/dist/SuperChatSetup.exe
```

The installer is a full NSIS Windows installer. Users can run it like any normal `.exe`.

### First-time setup

1. Open the app → enter your deployed server URL (e.g. `https://superchat.onrender.com`)
2. Sign up or log in
3. Minimize to tray
4. Share your link: `https://superchat.onrender.com/send?to=YourName`

---

## How it works

- Viewers go to `/send?to=username`, fill in name/message/amount + fake payment, hit Send
- Server saves superchat to SQLite
- Desktop app polls `/api/poll/:username` every 3 seconds
- New superchats trigger a colored overlay popup that fades after 8 seconds
- Overlay uses `alwaysOnTop: 'screen-saver'` — appears over browsers, Discord, windowed games
