# Xela Account Manager

A secure desktop application for managing multiple accounts with encrypted storage, 2FA tracking, and cloud backup capabilities.

## Features

✅ **Account Management**
- Securely store account credentials (encrypted with AES-256)
- Organize by categories (Work, Personal, Gaming, etc.)
- Track account details (username, email, notes)
- Password strength validation
- Multi-account support

✅ **Two-Factor Authentication (2FA)**
- Track which accounts have 2FA enabled
- Support for TOTP (authenticator apps), SMS, and Email
- Backup codes generation and storage
- 2FA coverage dashboard
- Recovery code management

✅ **Security Features**
- Master password protection
- AES-256 encryption for all credentials
- Password history tracking
- Security audit logs
- Account activity monitoring
- Weak password detection

✅ **Cloud Backup**
- Encrypted backup storage
- Google Drive integration
- Dropbox integration
- Automatic scheduled backups
- One-click restore
- Backup version history

✅ **Security Dashboard**
- Real-time security statistics
- 2FA coverage percentage
- Weak password alerts
- Password age tracking
- Recent security events
- Risk assessment

## Installation

```bash
npm install
npm start
```

## Building

```bash
npm run build
npm run dist
```

## Project Structure

```
xela-account-manager/
├── public/
│   ├── electron.js          # Main Electron process
│   ├── preload.js           # IPC bridge
│   ├── database.js          # SQLite database & encryption
│   └── cloudBackup.js       # Cloud backup service
├── src/
│   ├── App.jsx              # Main app component
│   ├── components/
│   │   ├── AccountList.jsx
│   │   ├── AccountForm.jsx
│   │   ├── SecurityDashboard.jsx
│   │   ├── TwoFactorSetup.jsx
│   │   ├── CloudBackupManager.jsx
│   │   ├── CategoryFilter.jsx
│   │   └── Settings.jsx
│   └── styles/
│       └── *.css
└── package.json
```

## Usage

### First Time Setup
1. Launch the application
2. Set a master password
3. Start adding accounts

### Adding an Account
1. Click "+  Add Account"
2. Fill in account details
3. Set category and priority
4. Save

### Enabling 2FA
1. Go to Security dashboard
2. Select account without 2FA
3. Choose 2FA method
4. Follow setup instructions
5. Save backup codes

### Creating Backups
1. Go to Backup tab
2. Click "Create Backup"
3. Optionally upload to cloud
4. Save backup codes

## Security

- All passwords are encrypted with AES-256
- Master password uses bcrypt (10 rounds)
- No data sent to servers
- All data stored locally
- Audit logs for all actions
- Secure session management

## License

MIT
