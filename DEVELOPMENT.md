# Development
## Prerequisites
- Node.js 14+
- npm or yarn

## Setup
```bash
npm install
```

## Running in Development
```bash
npm start
```

This will start:
- React dev server on http://localhost:3000
- Electron app with dev tools

## Building
```bash
npm run build
```

Builds the React app for production and packages it with Electron.

## Architecture

### Frontend (React)
- **App.jsx** - Main component with routing and state management
- **Components** - Reusable UI components
- **Styles** - CSS styling for each component

### Backend (Electron + Node.js)
- **electron.js** - Main process, window management, IPC handlers
- **database.js** - SQLite database with AES-256 encryption
- **cloudBackup.js** - Cloud storage integration (Google Drive, Dropbox)
- **preload.js** - Secure IPC bridge between React and Electron

### Security
- Master password with bcrypt (10 rounds)
- AES-256 encryption for all credentials
- Secure session management
- Audit logging for all operations
- No credentials stored in plain text

### Data Storage
- SQLite database stored in user's app data directory
- Automatic backup system
- Cloud sync support

## File Structure
```
src/
├── App.jsx                 # Main app component
├── index.js               # React entry point
├── index.css              # Global styles
├── components/
│   ├── AccountList.jsx
│   ├── AccountForm.jsx
│   ├── SecurityDashboard.jsx
│   ├── TwoFactorSetup.jsx
│   ├── CloudBackupManager.jsx
│   ├── CategoryFilter.jsx
│   └── Settings.jsx
└── styles/
    ├── App.css
    ├── AccountList.css
    ├── AccountForm.css
    ├── SecurityDashboard.css
    ├── TwoFactorSetup.css
    ├── CloudBackupManager.css
    ├── CategoryFilter.css
    └── Settings.css

public/
├── electron.js            # Electron main process
├── preload.js             # IPC preload script
├── database.js            # Database management
├── cloudBackup.js         # Cloud backup service
├── index.html             # HTML template
└── electron.js            # Electron config

package.json              # Dependencies and scripts
README.md                 # Documentation
```

## Testing

### Test Master Password
1. First launch - set master password
2. Close and reopen app
3. Enter master password to unlock

### Add Accounts
1. Click "+ Add Account"
2. Fill in account details
3. Click "Add Account"

### Test 2FA
1. Go to Security tab
2. Click "Enable 2FA" on an account
3. Select 2FA method
4. Complete setup

### Create Backup
1. Go to Backup tab
2. Click "Create Backup"
3. Can optionally upload to cloud

## Troubleshooting

### Port 3000 already in use
```bash
lsof -i :3000
kill -9 <PID>
```

### Database locked
Delete the `.db-shm` and `.db-wal` files in the app data directory

### Electron not starting
Make sure all dependencies are installed:
```bash
rm -rf node_modules package-lock.json
npm install
```

## Environment Variables
Create a `.env` file in the root directory:
```
REACT_APP_DEBUG=true
ELECTRON_START_URL=http://localhost:3000
```

## Key Bindings
- Cmd/Ctrl + Q - Quit application
- Cmd/Ctrl + Shift + I - Open DevTools (development only)

## Performance Tips
1. Keep master password complex (16+ characters)
2. Use strong account passwords
3. Enable 2FA on important accounts
4. Create regular backups
5. Monitor audit logs for suspicious activity
